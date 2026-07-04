'use strict';

/**
 * index.js
 *
 * Cloud execution entry point with HTTP server support for Google Cloud Run.
 *
 * Modes:
 *   1. HTTP Server (Cloud Run): Listens on PORT, provides /health and /trigger endpoints
 *   2. CLI/Batch (Lambda): Direct execution when run as script
 *   3. Lambda Handler: Exports handler function for AWS Lambda
 *
 * Google Cloud Run: Automatically runs as HTTP server on PORT 8080
 * Local/CI: Set RUN_HTTP_SERVER=true to start server, or run as batch job
 */

require('dotenv').config();
const express = require('express');
const printifyService = require('./services/printifyService');
const shopifyService = require('./services/shopifyService');
const trendService = require('./services/trendService');
const digitalProductsService = require('./services/digitalProductsService');
const cleanupService = require('./services/cleanupService');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  DRY_RUN: String(process.env.DRY_RUN || '').toLowerCase() === 'true',
  STYLING_TEMPLATES: {
    typography: 'vintage distressed typography design, bold text art',
    vector: 'minimalist aesthetic vector art, flat design',
    abstract: 'abstract artistic interpretation, modern digital painting',
    retro: 'retro vintage aesthetic, nostalgic color palette',
    minimalist: 'minimalist design, clean lines, monochrome',
    psychedelic: 'psychedelic trippy visuals, vibrant colors, surreal',
    cyberpunk: 'cyberpunk neon aesthetic, futuristic digital art',
    watercolor: 'watercolor painting style, soft pastel tones',
  },
};

const LOG_PREFIX = '[index]';

function log(message, data) {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`${LOG_PREFIX}[${ts}] ${message}`, data);
  } else {
    console.log(`${LOG_PREFIX}[${ts}] ${message}`);
  }
}

function logError(message, err) {
  const ts = new Date().toISOString();
  console.error(`${LOG_PREFIX}[${ts}] ${message}`, {
    error: err && err.message,
    stack: err && err.stack,
  });
}

// ---------------------------------------------------------------------------
// Styling Template Selector
// ---------------------------------------------------------------------------

function pickStyleTemplate(concept) {
  const clean = concept.toLowerCase();

  if (/typography|text|font|quote/.test(clean)) return CONFIG.STYLING_TEMPLATES.typography;
  if (/vector|geometric|minimal|simple/.test(clean)) return CONFIG.STYLING_TEMPLATES.vector;
  if (/abstract|surreal|digital|art/.test(clean)) return CONFIG.STYLING_TEMPLATES.abstract;
  if (/retro|vintage|nostalgia|80s|90s/.test(clean)) return CONFIG.STYLING_TEMPLATES.retro;
  if (/minimalist|minimal|clean|simple/.test(clean)) return CONFIG.STYLING_TEMPLATES.minimalist;
  if (/psychedelic|trippy|vibrant|colorful/.test(clean)) return CONFIG.STYLING_TEMPLATES.psychedelic;
  if (/cyber|neon|futuristic|tech/.test(clean)) return CONFIG.STYLING_TEMPLATES.cyberpunk;
  if (/watercolor|paint|soft|pastel/.test(clean)) return CONFIG.STYLING_TEMPLATES.watercolor;

  // Default: rotate through templates based on hash
  const templates = Object.values(CONFIG.STYLING_TEMPLATES);
  const hash = clean.split('').reduce((h, c) => h + c.charCodeAt(0), 0);
  return templates[hash % templates.length];
}

/**
 * Builds a dynamic, styled image generation prompt from a trending concept.
 * Combines the trend with a contextual styling instruction.
 */
function buildStyledPrompt(concept) {
  const style = pickStyleTemplate(concept);
  return `${concept}, ${style}`;
}

/**
 * Sanitizes a concept for use as a product title/tag.
 * Removes extra punctuation, normalizes casing.
 */
function sanitizeForTitle(concept) {
  return concept
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove special chars except hyphen/space
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim();
}

/**
 * Extracts searchable tags from a concept.
 * Example: "bohemian wall decor" -> ["bohemian", "wall decor", "boho"]
 */
function extractTags(concept) {
  const words = concept.split(/\s+/).filter((w) => w.length > 2);
  const tags = [...words];

  // Add common aliases
  if (/bohemian|boho/.test(concept)) tags.push('boho');
  if (/vintage|retro/.test(concept)) tags.push('vintage');
  if (/minimalist|minimal/.test(concept)) tags.push('minimalist');
  if (/gothic|dark/.test(concept)) tags.push('gothic');
  if (/abstract|art/.test(concept)) tags.push('art');

  return [...new Set(tags)];
}

// ---------------------------------------------------------------------------
// Trend-Driven Generation Loop
// ---------------------------------------------------------------------------

/**
 * Generate complete product suite for a single concept:
 *   1. Canvas/wall art via Printify
 *   2. T-shirt design via Printify
 *   3. Font (digital download)
 *   4. Graphics pack (SVG + high-res, digital download)
 */
async function generateProductSuite({ concept, styledPrompt, title, tags, conceptId, dryRun = false }) {
  const printProducts = [];
  const digitalProducts = [];

  // Generate digital assets once (fonts + graphics)
  let digitalAssets = null;
  try {
    digitalAssets = await digitalProductsService.generateDigitalProducts(concept);
  } catch (err) {
    log(`generateProductSuite [${conceptId}]`, `Digital assets generation failed: ${err.message}`);
  }

  // 1. Generate canvas/wall art via Printify
  try {
    const canvasResult = await printifyService.runPipeline({
      jobId: `${conceptId}-canvas`,
      prompt: styledPrompt,
      title: `${title} Canvas`,
      description: `Stunning canvas print featuring ${concept}. Perfect for modern homes and offices. Premium quality art ready to hang.`,
      tags: [...tags, 'canvas', 'wall-art'],
      dryRun,
    });
    printProducts.push({
      type: 'canvas',
      productId: canvasResult.product.id,
      title: `${title} Canvas`,
    });
  } catch (err) {
    log(`generateProductSuite [${conceptId}]`, `Canvas generation failed: ${err.message}`);
  }

  // 2. Generate t-shirt design via Printify
  try {
    const tshirtResult = await printifyService.runPipeline({
      jobId: `${conceptId}-tshirt`,
      prompt: styledPrompt,
      title: `${title} T-Shirt`,
      description: `Comfortable, stylish t-shirt featuring ${concept}. Made from premium cotton blend. Express yourself with unique, eye-catching design.`,
      tags: [...tags, 'apparel', 'tshirt'],
      dryRun,
    });
    printProducts.push({
      type: 'tshirt',
      productId: tshirtResult.product.id,
      title: `${title} T-Shirt`,
    });
  } catch (err) {
    log(`generateProductSuite [${conceptId}]`, `T-shirt generation failed: ${err.message}`);
  }

  // 3. Generate digital font product
  if (digitalAssets) {
    try {
      const shopifyClient = shopifyService.createShopifyClient({ dryRun });
      const fontPrice = 2999; // $29.99 for fonts
      const fontProductPayload = {
        title: digitalAssets.font.payload.title,
        description: digitalAssets.font.payload.description,
        files: digitalAssets.font.payload.files,
        tags: [...tags, 'font', 'digital-download'],
        price: fontPrice,
      };
      const fontResult = await shopifyService.createDigitalProduct(shopifyClient, fontProductPayload, { dryRun });
      digitalProducts.push({
        type: 'font',
        productId: fontResult.product.id,
        title: fontResult.product.title,
        price: fontPrice,
      });
    } catch (err) {
      log(`generateProductSuite [${conceptId}]`, `Font product creation failed: ${err.message}`);
    }
  }

  // 4. Generate digital graphics pack
  if (digitalAssets) {
    try {
      const shopifyClient = shopifyService.createShopifyClient({ dryRun });
      const graphicsPrice = 3999; // $39.99 for graphics packs
      const graphicsProductPayload = {
        title: digitalAssets.graphics.payload.title,
        description: digitalAssets.graphics.payload.description,
        files: digitalAssets.graphics.payload.files,
        tags: [...tags, 'graphics', 'digital-download', 'svg'],
        price: graphicsPrice,
      };
      const graphicsResult = await shopifyService.createDigitalProduct(shopifyClient, graphicsProductPayload, { dryRun });
      digitalProducts.push({
        type: 'graphics',
        productId: graphicsResult.product.id,
        title: graphicsResult.product.title,
        price: graphicsPrice,
      });
    } catch (err) {
      log(`generateProductSuite [${conceptId}]`, `Graphics product creation failed: ${err.message}`);
    }
  }

  return { printProducts, digitalProducts };
}

/**
 * Generates print products from trending concepts.
 * Each concept is processed independently; one failure doesn't crash the batch.
 */
async function generateFromTrends(concepts) {
  log('generateFromTrends', `Processing ${concepts.length} concept(s)`);

  const results = {
    total: concepts.length,
    succeeded: 0,
    failed: 0,
    products: [],
    errors: [],
  };

  for (let i = 0; i < concepts.length; i += 1) {
    const concept = concepts[i];
    const conceptId = `trend-${i + 1}-${Date.now()}`;

    try {
      log(`Concept ${i + 1}/${concepts.length}`, `Processing: "${concept}"`);

      // Step 1: Build styled prompt
      const styledPrompt = buildStyledPrompt(concept);
      log(`Concept ${i + 1}`, `Styled prompt: ${styledPrompt}`);

      // Step 2: Sanitize for product metadata
      const title = sanitizeForTitle(concept);
      const tags = extractTags(concept);
      log(`Concept ${i + 1}`, `Product title: ${title}, tags: ${tags.join(', ')}`);

      // Step 3: Generate all 4 product types from single concept
      const allProducts = await generateProductSuite({
        concept,
        styledPrompt,
        title,
        tags,
        conceptId,
        dryRun: CONFIG.DRY_RUN,
      });

      results.succeeded += 1;
      results.products.push({
        concept,
        conceptId,
        title,
        tags,
        printProducts: allProducts.printProducts,
        digitalProducts: allProducts.digitalProducts,
      });

      log(`Concept ${i + 1}`, `✓ SUCCESS — Generated ${allProducts.printProducts.length + allProducts.digitalProducts.length} products`, {
        concept,
        printProducts: allProducts.printProducts.length,
        digitalProducts: allProducts.digitalProducts.length,
      });
    } catch (err) {
      results.failed += 1;
      results.errors.push({
        concept,
        conceptId,
        error: err.message,
        stage: err.stage || 'unknown',
      });

      logError(`Concept ${i + 1} FAILED`, err);
      // Continue to next concept instead of crashing
      log(`Concept ${i + 1}`, 'Skipping to next concept...');
    }
  }

  log('generateFromTrends', `Batch complete`, {
    total: results.total,
    succeeded: results.succeeded,
    failed: results.failed,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Shopify Enrichment (Optional, called after bulk generation)
// ---------------------------------------------------------------------------

async function enrichGeneratedProducts() {
  log('enrichGeneratedProducts', 'Starting Shopify enrichment...');

  try {
    const shopifyClient = shopifyService.createShopifyClient({ dryRun: CONFIG.DRY_RUN });
    const enrichResult = await shopifyService.enrichPrintifyProducts(shopifyClient, {
      maxProducts: 50, // enrich up to 50 recent products
      dryRun: CONFIG.DRY_RUN,
    });

    log('enrichGeneratedProducts', `Enriched ${enrichResult.processed} products`, {
      collections: enrichResult.results.length,
    });

    return enrichResult;
  } catch (err) {
    logError('enrichGeneratedProducts failed', err);
    return { processed: 0, results: [] };
  }
}

// ---------------------------------------------------------------------------
// Cleanup & Replacement (Remove stale products, add new trending ones)
// ---------------------------------------------------------------------------

async function cleanupAndReplace() {
  log('cleanupAndReplace', 'Starting inventory cleanup cycle...');

  try {
    const shopifyClient = shopifyService.createShopifyClient({ dryRun: CONFIG.DRY_RUN });

    // Step 1: Run cleanup (delete 2-3 old products with 0 sales)
    const cleanupResult = await cleanupService.runCleanupCycle(shopifyClient, {
      dryRun: CONFIG.DRY_RUN,
    });

    log('cleanupAndReplace', `Cleanup result: ${cleanupResult.deleteCount} products deleted`, {
      deleted: cleanupResult.deleted.map((p) => p.title),
    });

    // Step 2: Generate replacement products if any were deleted
    if (cleanupResult.deleteCount > 0) {
      log('cleanupAndReplace', `Generating ${cleanupResult.deleteCount} replacement product(s)...`);

      // Fetch fresh trending concepts
      const trends = await trendService.getDailyTrendingConcepts({ limit: cleanupResult.deleteCount + 2 });
      const replacementConcepts = trends.slice(0, cleanupResult.deleteCount);

      log('cleanupAndReplace', `Generating replacements from ${replacementConcepts.length} trend concept(s)`);

      // Generate new products from trends
      for (let i = 0; i < replacementConcepts.length; i += 1) {
        const concept = replacementConcepts[i];
        const conceptId = `replacement-${i + 1}-${Date.now()}`;

        try {
          const styledPrompt = buildStyledPrompt(concept);
          const title = sanitizeForTitle(concept);
          const tags = extractTags(concept);

          await generateProductSuite({
            concept,
            styledPrompt,
            title,
            tags,
            conceptId,
            dryRun: CONFIG.DRY_RUN,
          });

          log('cleanupAndReplace', `✓ Generated replacement from: "${concept}"`);
        } catch (err) {
          log('cleanupAndReplace', `Failed to generate replacement for "${concept}": ${err.message}`);
        }
      }
    }

    return {
      deleted: cleanupResult.deleteCount,
      generated: cleanupResult.deleteCount,
    };
  } catch (err) {
    logError('cleanupAndReplace failed', err);
    return { deleted: 0, generated: 0, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

async function cloudExecutionRun() {
  log('cloudExecutionRun', 'Starting cloud execution run', {
    dryRun: CONFIG.DRY_RUN,
    timestamp: new Date().toISOString(),
  });

  const executionResult = {
    startTime: new Date(),
    endTime: null,
    duration: null,
    trends: null,
    generation: null,
    enrichment: null,
    summary: {},
  };

  try {
    // -------------------------------------------------------
    // Step 1: Fetch daily trending concepts
    // -------------------------------------------------------
    log('cloudExecutionRun', 'Step 1/3: Fetching trending concepts');
    executionResult.trends = await trendService.getDailyTrendingConcepts({
      limit: 5, // Generate up to 5 trending products per run
      dryRun: CONFIG.DRY_RUN,
    });

    log('cloudExecutionRun', `Fetched ${executionResult.trends.concepts.length} trending concept(s)`, {
      concepts: executionResult.trends.concepts,
      safe: executionResult.trends.safeCount,
      total: executionResult.trends.totalProcessed,
    });

    // -------------------------------------------------------
    // Step 2: Generate products from trending concepts
    // -------------------------------------------------------
    log('cloudExecutionRun', 'Step 2/3: Generating products from trends');
    executionResult.generation = await generateFromTrends(executionResult.trends.concepts);

    log('cloudExecutionRun', `Generated ${executionResult.generation.succeeded}/${executionResult.generation.total}`, {
      failed: executionResult.generation.failed,
      errors: executionResult.generation.errors.length,
    });

    // -------------------------------------------------------
    // Step 3: Enrich Shopify products
    // -------------------------------------------------------
    log('cloudExecutionRun', 'Step 3/4: Enriching Shopify products');
    executionResult.enrichment = await enrichGeneratedProducts();

    log('cloudExecutionRun', `Enriched ${executionResult.enrichment.processed} products`);

    // -------------------------------------------------------
    // Step 4: Cleanup stale products & replace with new ones
    // -------------------------------------------------------
    log('cloudExecutionRun', 'Step 4/4: Running inventory cleanup');
    executionResult.cleanup = await cleanupAndReplace();

    log('cloudExecutionRun', `Cleanup complete`, {
      deleted: executionResult.cleanup.deleted,
      generated: executionResult.cleanup.generated,
    });

    // -------------------------------------------------------
    // Summary
    // -------------------------------------------------------
    executionResult.endTime = new Date();
    executionResult.duration = executionResult.endTime - executionResult.startTime;

    executionResult.summary = {
      trendsFound: executionResult.trends.concepts.length,
      productsGenerated: executionResult.generation.succeeded,
      productsFailed: executionResult.generation.failed,
      productsEnriched: executionResult.enrichment.processed,
      productsDeleted: executionResult.cleanup.deleted,
      productsReplaced: executionResult.cleanup.generated,
      durationMs: executionResult.duration,
      successRate: `${Math.round((executionResult.generation.succeeded / executionResult.generation.total) * 100)}%`,
    };

    log('cloudExecutionRun', '✓ EXECUTION COMPLETE', executionResult.summary);

    return executionResult;
  } catch (err) {
    logError('cloudExecutionRun FAILED', err);
    executionResult.endTime = new Date();
    executionResult.duration = executionResult.endTime - executionResult.startTime;
    executionResult.summary.error = err.message;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports (for Lambda, Cloud Functions, etc.)
// ---------------------------------------------------------------------------

module.exports = {
  cloudExecutionRun,
  generateFromTrends,
  enrichGeneratedProducts,
  buildStyledPrompt,
  sanitizeForTitle,
  extractTags,
  pickStyleTemplate,
};

/**
 * AWS Lambda handler signature
 */
exports.handler = async (event, context) => {
  log('handler', 'Lambda invoked', { event, context: { functionName: context.functionName } });

  try {
    const result = await cloudExecutionRun();
    return {
      statusCode: 200,
      body: JSON.stringify(result.summary),
    };
  } catch (err) {
    logError('handler failed', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ---------------------------------------------------------------------------
// CLI: Run directly with `node src/index.js`
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HTTP Server (Google Cloud Run)
// ---------------------------------------------------------------------------

function startHttpServer() {
  const app = express();
  const PORT = process.env.PORT || 8080;

  // Health check endpoint (Cloud Run startup/readiness probe)
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'pod-automation-pipeline',
    });
  });

  // Live probe (Cloud Run liveness check)
  app.get('/live', (req, res) => {
    res.status(200).json({ alive: true });
  });

  // Trigger cloud execution manually
  app.post('/execute', express.json(), async (req, res) => {
    log('/execute', 'Received manual execution request');

    try {
      const result = await cloudExecutionRun();
      res.status(200).json({
        success: true,
        summary: result.summary,
      });
    } catch (err) {
      log('/execute', 'Execution failed', err.message);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  // Root endpoint
  app.get('/', (req, res) => {
    res.status(200).json({
      service: 'Print-on-Demand Automation Pipeline',
      version: '0.1.0',
      endpoints: {
        health: 'GET /health',
        live: 'GET /live',
        execute: 'POST /execute',
      },
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    log('startHttpServer', `Server listening on http://0.0.0.0:${PORT}`, { PORT });
    log('startHttpServer', 'Ready for Cloud Run deployment');
  });

  return app;
}

// ---------------------------------------------------------------------------
// Entry Point Decision Logic
// ---------------------------------------------------------------------------

if (require.main === module) {
  const shouldRunHttpServer =
    String(process.env.RUN_HTTP_SERVER || '').toLowerCase() === 'true' ||
    String(process.env.CLOUD_RUN_ENVIRONMENT || '').toLowerCase() !== 'false';

  if (shouldRunHttpServer) {
    // Cloud Run mode: start HTTP server
    log('main', 'Starting in HTTP server mode (Cloud Run)');
    startHttpServer();
  } else {
    // Batch/Lambda mode: run once and exit
    log('main', 'Starting in batch execution mode');
    cloudExecutionRun()
      .then((result) => {
        console.log('\n=== EXECUTION SUMMARY ===');
        console.log(JSON.stringify(result.summary, null, 2));
        process.exitCode = 0;
      })
      .catch((err) => {
        console.error('\n=== EXECUTION FAILED ===');
        console.error(err);
        process.exitCode = 1;
      });
  }
}

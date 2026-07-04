'use strict';

/**
 * app.js
 *
 * Autonomous print-on-demand pipeline with trend-jacking.
 *
 * Connects:
 *   0. trendService — fetches daily trending concepts, filters for IP safety
 *   1. printifyService — generates assets from trends, creates products, publishes to Printify
 *   2. shopifyService — discovers Printify products, enriches (SEO, pricing, collections)
 *   3. Scheduling — runs every 24 hours by default (configurable)
 *
 * Run with: node src/app.js
 *   or NODE_ENV=production node src/app.js
 *   or set DRY_RUN=true for dry-run testing
 */

require('dotenv').config();
const cron = require('node-cron');
const printifyService = require('./services/printifyService');
const shopifyService = require('./services/shopifyService');
const trendService = require('./services/trendService');
const browserAuth = require('./utils/browserAuth');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  DRY_RUN: String(process.env.DRY_RUN || '').toLowerCase() === 'true',
  SCHEDULE_CRON: process.env.SCHEDULE_CRON || '0 0 * * *', // 0:00 UTC daily
  MAX_PRODUCTS_PER_RUN: Number(process.env.MAX_PRODUCTS_PER_RUN || 10),
  MAX_RETRIES: Number(process.env.MAX_RETRIES || 3),
};

let pipelineRunning = false;
let lastRunTimestamp = null;
let runCount = 0;
let successCount = 0;
let failureCount = 0;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(message, data) {
  const ts = new Date().toISOString();
  const prefix = `[app][${ts}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function logError(message, err) {
  const ts = new Date().toISOString();
  console.error(`[app][${ts}] ${message}`, {
    error: err && err.message,
    stack: err && err.stack,
  });
}

// ---------------------------------------------------------------------------
// Pipeline execution
// ---------------------------------------------------------------------------

/**
 * Main pipeline: Asset generation → Printify product creation → Shopify enrichment.
 *
 * 1. Generate a new asset (or batch of assets)
 * 2. Create Printify product(s) from the asset(s)
 * 3. Discover newly synced products in Shopify
 * 4. Enrich them (collections, SEO, pricing)
 */
async function executePipeline() {
  if (pipelineRunning) {
    log('Pipeline already running. Skipping this cycle.');
    return { skipped: true };
  }

  pipelineRunning = true;
  runCount += 1;
  lastRunTimestamp = new Date();

  log('Pipeline execution starting', { run: runCount, dryRun: CONFIG.DRY_RUN });

  const result = {
    runNumber: runCount,
    startTime: lastRunTimestamp,
    endTime: null,
    duration: null,
    stages: {},
    errors: [],
  };

  try {
    // -----------------------------------------------
    // Stage 0: Fetch trending design concepts
    // -----------------------------------------------
    log('Stage 0/4: Fetching trending design concepts for trend-jacking');

    let prompts = [];
    try {
      const trends = await trendService.getDailyTrendingConcepts({
        limit: 2,
        dryRun: CONFIG.DRY_RUN,
      });
      prompts = trends.concepts.map((concept) => ({
        prompt: `a print design inspired by ${concept}, artistic interpretation, trending aesthetic`,
        title: `Trending Print: ${concept}`,
      }));
      log(`✓ Loaded ${trends.concepts.length} trending concept(s) for design generation`, trends.concepts);
      result.stages.trends = trends;
    } catch (err) {
      logError('Failed to fetch trends, falling back to default concepts', err);
      prompts = [
        { prompt: 'a minimalist mountain landscape, flat design', title: 'Minimalist Mountain Landscape Canvas' },
        { prompt: 'abstract geometric patterns in cool blues and teals', title: 'Abstract Geometry Canvas' },
      ];
    }

    // -----------------------------------------------
    // Stage 1: Generate asset and create Printify product
    // -----------------------------------------------
    log('Stage 1/4: Asset generation & Printify product creation');

    const printifyResults = [];
    for (const { prompt, title } of prompts) {
      try {
        const pipelineResult = await printifyService.runPipeline({
          jobId: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          prompt,
          title,
          description: `Auto-generated print design: ${prompt}`,
          tags: ['automated', 'print-on-demand'],
          dryRun: CONFIG.DRY_RUN,
        });

        log(`✓ Printify product created: ${title}`, {
          productId: pipelineResult.product.id,
          status: pipelineResult.publishResult.status,
        });

        printifyResults.push(pipelineResult);
      } catch (err) {
        logError(`✗ Failed to create Printify product for "${title}"`, err);
        result.errors.push({ stage: 'printify', title, error: err.message });
      }
    }

    result.stages.printify = {
      attempted: prompts.length,
      succeeded: printifyResults.length,
      results: printifyResults,
    };

    // -----------------------------------------------
    // Stage 2: Let Printify → Shopify sync happen
    // -----------------------------------------------
    log('Stage 2/4: Waiting for Shopify sync (Printify publishes to Shopify automatically)');
    log('In production, this would wait for a webhook. For now, proceeding after a small delay.');

    if (!CONFIG.DRY_RUN) {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // give Printify/Shopify a moment
    }

    // -----------------------------------------------
    // Stage 3: Enrich Shopify products
    // -----------------------------------------------
    log('Stage 3/4: Discovering & enriching Shopify products from Printify');

    const shopifyClient = shopifyService.createShopifyClient({ dryRun: CONFIG.DRY_RUN });
    const enrichResult = await shopifyService.enrichPrintifyProducts(shopifyClient, {
      maxProducts: CONFIG.MAX_PRODUCTS_PER_RUN,
      dryRun: CONFIG.DRY_RUN,
    });

    result.stages.shopify = enrichResult;
    log(`✓ Shopify enrichment complete`, {
      processed: enrichResult.processed,
      results: enrichResult.results.length,
    });

    successCount += 1;
  } catch (err) {
    logError('Pipeline execution failed', err);
    result.errors.push({ stage: 'orchestration', error: err.message });
    failureCount += 1;
  } finally {
    result.endTime = new Date();
    result.duration = result.endTime - result.startTime;

    pipelineRunning = false;
    log('Pipeline execution complete', {
      duration: `${result.duration}ms`,
      run: result.runNumber,
      successCount,
      failureCount,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let scheduledJob = null;

/**
 * Starts the autonomous scheduler.
 * By default, runs every day at 0:00 UTC (set via SCHEDULE_CRON).
 */
function startScheduler() {
  if (scheduledJob) {
    log('Scheduler is already running.');
    return;
  }

  log('Starting scheduler', { cron: CONFIG.SCHEDULE_CRON });

  scheduledJob = cron.schedule(CONFIG.SCHEDULE_CRON, () => {
    log('Scheduled pipeline execution triggered');
    executePipeline().catch((err) => {
      logError('Unhandled error in scheduled pipeline', err);
    });
  });

  log('Scheduler started successfully');
}

function stopScheduler() {
  if (!scheduledJob) {
    log('Scheduler is not running.');
    return;
  }

  scheduledJob.stop();
  scheduledJob = null;
  log('Scheduler stopped');
}

// ---------------------------------------------------------------------------
// Health & status
// ---------------------------------------------------------------------------

function getStatus() {
  return {
    environment: CONFIG.NODE_ENV,
    dryRun: CONFIG.DRY_RUN,
    schedulerRunning: !!scheduledJob,
    pipelineRunning,
    totalRuns: runCount,
    successfulRuns: successCount,
    failedRuns: failureCount,
    lastRunTime: lastRunTimestamp,
    schedulePattern: CONFIG.SCHEDULE_CRON,
  };
}

// ---------------------------------------------------------------------------
// CLI / entry point
// ---------------------------------------------------------------------------

async function main() {
  log('Pod automation pipeline initializing', {
    version: '0.1.0',
    environment: CONFIG.NODE_ENV,
    dryRun: CONFIG.DRY_RUN,
  });

  // Verify credentials
  log('Verifying credentials...');
  try {
    const credentialStatus = await browserAuth.verifyAllCredentials();
    log('Credential verification complete', credentialStatus);

    if (!credentialStatus.shopify.configured || !credentialStatus.printify.configured) {
      console.error('\n⚠ Missing credentials. Please configure .env with:');
      console.error('  - SHOPIFY_STORE_DOMAIN');
      console.error('  - SHOPIFY_ADMIN_API_ACCESS_TOKEN (or SHOPIFY_API_KEY + SHOPIFY_API_SECRET)');
      console.error('  - PRINTIFY_API_TOKEN');
      console.error('  - PRINTIFY_SHOP_ID');
      console.error('\nSee .env.example for details.');

      if (!CONFIG.DRY_RUN) {
        process.exitCode = 1;
        return;
      }
    }
  } catch (err) {
    logError('Credential verification error', err);
    if (!CONFIG.DRY_RUN) {
      process.exitCode = 1;
      return;
    }
  }

  // Run once immediately in dev/dry-run, then start scheduler
  if (CONFIG.DRY_RUN || CONFIG.NODE_ENV === 'development') {
    log('Running immediate pipeline execution (dev/dry-run mode)');
    try {
      const result = await executePipeline();
      log('Immediate execution complete', {
        errors: result.errors.length,
        stages: Object.keys(result.stages),
      });
    } catch (err) {
      logError('Immediate execution failed', err);
    }

    if (CONFIG.DRY_RUN) {
      log('Dry-run complete. Exiting.');
      process.exitCode = 0;
      return;
    }
  }

  // Start the scheduler for production
  log('Starting autonomous scheduler...');
  startScheduler();

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('Received SIGINT. Shutting down gracefully...');
    stopScheduler();
    setTimeout(() => {
      log('Shutdown complete.');
      process.exit(0);
    }, 1000);
  });

  process.on('SIGTERM', () => {
    log('Received SIGTERM. Shutting down gracefully...');
    stopScheduler();
    setTimeout(() => {
      log('Shutdown complete.');
      process.exit(0);
    }, 1000);
  });

  // Keep process alive
  log('Pipeline is running autonomously. Press Ctrl+C to stop.');
}

// ---------------------------------------------------------------------------
// Exports (for testing / external use)
// ---------------------------------------------------------------------------

module.exports = {
  CONFIG,
  executePipeline,
  startScheduler,
  stopScheduler,
  getStatus,
};

// ---------------------------------------------------------------------------
// Run if executed directly
// ---------------------------------------------------------------------------

if (require.main === module) {
  main().catch((err) => {
    logError('Fatal error in main', err);
    process.exitCode = 1;
  });
}

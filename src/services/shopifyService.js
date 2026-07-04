'use strict';

/**
 * shopifyService.js
 *
 * Shopify Admin API automation for the print-on-demand pipeline:
 *   listProductsFromPrintify() -> parseAndCollect() -> updateSEO() -> applyPricing()
 *
 * Key tasks:
 *   1. Discover products recently synced from Printify (tagged/marked as auto-generated)
 *   2. Automatically assign them to Collections based on title/tags
 *   3. Generate SEO descriptions from templates based on product type
 *   4. Apply a profit margin to the Printify cost to set the final Shopify price
 *
 * Pass { dryRun: true } to any function to get validated payloads without hitting the API.
 */

require('dotenv').config();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN || '',
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || '',
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || '2024-10',
  // Profit margin rules: percentage markup on cost
  PROFIT_MARGIN_PERCENT: Number(process.env.PROFIT_MARGIN_PERCENT || 50),
  // Collections strategy: auto-create or use existing
  AUTO_CREATE_COLLECTIONS: String(process.env.AUTO_CREATE_COLLECTIONS || 'true').toLowerCase() === 'true',
};

const DRY_RUN_DEFAULT = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(step, message, data) {
  const ts = new Date().toISOString();
  const prefix = `[shopifyService][${ts}][${step}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function logError(step, message, err) {
  const ts = new Date().toISOString();
  console.error(`[shopifyService][${ts}][${step}] ${message}`, {
    error: err && err.message,
    status: err && err.response && err.response.status,
    body: err && err.response && err.response.body,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Custom error type
// ---------------------------------------------------------------------------

class ShopifyServiceError extends Error {
  constructor(operation, cause) {
    super(`Shopify operation "${operation}" failed: ${cause.message}`);
    this.name = 'ShopifyServiceError';
    this.operation = operation;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Shopify API client factory
// ---------------------------------------------------------------------------

function createShopifyClient({ dryRun = false } = {}) {
  if (dryRun) {
    return { dryRun: true };
  }

  if (!CONFIG.SHOPIFY_STORE_DOMAIN || !CONFIG.SHOPIFY_ADMIN_API_ACCESS_TOKEN) {
    throw new Error(
      'SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_ACCESS_TOKEN must be set. Pass { dryRun: true } to skip real API calls.'
    );
  }

  // The @shopify/shopify-api library requires sessionStorage (browser) or similar.
  // For a backend Node.js script, we'll use a simple fetch-based wrapper instead
  // to avoid session complexity.
  return {
    domain: CONFIG.SHOPIFY_STORE_DOMAIN,
    token: CONFIG.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
    apiVersion: CONFIG.SHOPIFY_API_VERSION,
    dryRun: false,
  };
}

/**
 * Make a REST call to the Shopify Admin API.
 * Returns the response body on 2xx, throws on error.
 */
async function shopifyRequest(client, method, path, { body, query } = {}) {
  if (client.dryRun) {
    log('shopifyRequest', `[DRY-RUN] ${method} ${path}`, body ? { body } : query ? { query } : undefined);
    await sleep(50);
    return { mock: true, message: `Mocked ${method} ${path}` };
  }

  const baseUrl = `https://${client.domain}/admin/api/${client.apiVersion}`;
  const url = new URL(`${baseUrl}${path}`);

  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        v.forEach((item) => url.searchParams.append(k, item));
      } else {
        url.searchParams.append(k, v);
      }
    });
  }

  log('shopifyRequest', `${method} ${url.pathname}${url.search ? '?' + url.search : ''}`);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'X-Shopify-Access-Token': client.token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = { error: text };
    }
    logError('shopifyRequest', `${method} ${path} (status ${response.status})`, { response: parsed });
    throw new Error(`Shopify API error: ${response.status} ${JSON.stringify(parsed)}`);
  }

  const data = await response.json();
  log('shopifyRequest', `Response OK (${response.status})`, data);
  return data;
}

// ---------------------------------------------------------------------------
// Stage 1: List products from Printify (tagged or by source)
// ---------------------------------------------------------------------------

/**
 * Lists products recently synced from Printify. Looks for a tag or handle
 * pattern indicating Printify origin (e.g., "printify-auto", "pod-*").
 */
async function listProductsFromPrintify(client, { limit = 50, cursor = null, dryRun = false } = {}) {
  const query = {
    limit,
    status: 'any', // include drafts, archived, etc.
    fields: 'id,title,handle,status,tags,vendor,created_at,product_type,variants',
  };

  if (cursor) {
    query.cursor = cursor;
  }

  // Add a filter: look for "printify-auto" tag OR vendor containing "Printify"
  // In a real scenario, you'd use GraphQL for complex filters, but REST API
  // doesn't support tag filtering directly, so we fetch and filter in-memory.
  query.vendor = 'Printify';

  if (dryRun) {
    log('listProductsFromPrintify', '[DRY-RUN] Fetching products from Shopify (vendor: Printify)');
    await sleep(50);
    const mocked = {
      products: [
        {
          id: 'gid://shopify/Product/7234567890',
          title: 'Minimalist Mountain Landscape Canvas',
          handle: 'minimalist-mountain-landscape-canvas',
          status: 'draft',
          tags: ['automated', 'print-on-demand', 'canvas'],
          vendor: 'Printify',
          created_at: new Date().toISOString(),
          product_type: 'Canvas Prints',
          variants: [
            { id: 'gid://shopify/ProductVariant/1001', price: '24.99', sku: 'canvas-12x18' },
            { id: 'gid://shopify/ProductVariant/1002', price: '34.99', sku: 'canvas-16x24' },
          ],
        },
        {
          id: 'gid://shopify/Product/7234567891',
          title: 'Abstract Waves Typography Tee',
          handle: 'abstract-waves-typography-tee',
          status: 'draft',
          tags: ['automated', 'print-on-demand', 't-shirt'],
          vendor: 'Printify',
          created_at: new Date().toISOString(),
          product_type: 'Apparel',
          variants: [{ id: 'gid://shopify/ProductVariant/1003', price: '16.99', sku: 'tee-s' }],
        },
      ],
    };
    log('listProductsFromPrintify', '[DRY-RUN] Mocked response', mocked);
    return mocked;
  }

  return shopifyRequest(client, 'GET', '/products.json', { query });
}

// ---------------------------------------------------------------------------
// Collection assignment strategy
// ---------------------------------------------------------------------------

const COLLECTION_RULES = [
  {
    name: 'Canvas Prints',
    matchPatterns: [/canvas/i, /print/i, /wall art/i],
    matchTags: ['canvas', 'prints'],
  },
  {
    name: 'Typography & Text',
    matchPatterns: [/typography/i, /text/i, /font/i, /quote/i],
    matchTags: ['typography', 'text', 'quote'],
  },
  {
    name: 'Abstract & Minimalist',
    matchPatterns: [/abstract/i, /minimalist/i, /geometric/i, /simple/i],
    matchTags: ['abstract', 'minimalist', 'geometric'],
  },
  {
    name: 'Apparel',
    matchPatterns: [/t-shirt|tee|shirt|hoodie|sweatshirt/i],
    matchTags: ['t-shirt', 'apparel', 'clothing'],
  },
];

/**
 * Determines which Collections a product should belong to based on title and tags.
 */
function suggestCollections(product) {
  const suggestions = [];
  const { title = '', tags = '' } = product;
  const tagArray = typeof tags === 'string' ? tags.split(',').map((t) => t.trim().toLowerCase()) : tags;
  const titleLower = title.toLowerCase();

  COLLECTION_RULES.forEach((rule) => {
    const matchesPattern = rule.matchPatterns.some((pattern) => pattern.test(titleLower));
    const matchesTag = rule.matchTags.some((tag) => tagArray.includes(tag));

    if (matchesPattern || matchesTag) {
      suggestions.push(rule.name);
    }
  });

  log('suggestCollections', `Suggested collections for "${title}"`, suggestions);
  return suggestions;
}

// ---------------------------------------------------------------------------
// Stage 2: Get or create Collections
// ---------------------------------------------------------------------------

async function listCollections(client, { dryRun = false } = {}) {
  if (dryRun) {
    log('listCollections', '[DRY-RUN] Fetching collections');
    await sleep(50);
    const mocked = {
      custom_collections: [
        { id: 'gid://shopify/Collection/1001', title: 'Canvas Prints', handle: 'canvas-prints' },
        { id: 'gid://shopify/Collection/1002', title: 'Typography & Text', handle: 'typography-text' },
      ],
    };
    log('listCollections', '[DRY-RUN] Mocked collections', mocked);
    return mocked;
  }

  return shopifyRequest(client, 'GET', '/custom_collections.json', {
    query: { limit: 250, fields: 'id,title,handle' },
  });
}

async function createCollection(client, { title, handle }, { dryRun = false } = {}) {
  const body = { custom_collection: { title, handle } };

  if (dryRun) {
    log('createCollection', `[DRY-RUN] Creating collection: ${title}`, body);
    await sleep(50);
    const mocked = {
      custom_collection: {
        id: `gid://shopify/Collection/${Date.now()}`,
        title,
        handle,
        created_at: new Date().toISOString(),
      },
    };
    log('createCollection', '[DRY-RUN] Mocked collection created', mocked);
    return mocked;
  }

  return shopifyRequest(client, 'POST', '/custom_collections.json', { body });
}

/**
 * Returns collection ID for a given name, creating it if it doesn't exist
 * and AUTO_CREATE_COLLECTIONS is true.
 */
async function ensureCollection(client, collectionName, { dryRun = false } = {}) {
  const { custom_collections = [] } = await listCollections(client, { dryRun });

  let collection = custom_collections.find(
    (c) => c.title.toLowerCase() === collectionName.toLowerCase() || c.handle === slugify(collectionName)
  );

  if (collection) {
    log('ensureCollection', `Found existing collection: ${collectionName}`, collection.id);
    return collection;
  }

  if (!CONFIG.AUTO_CREATE_COLLECTIONS) {
    log('ensureCollection', `Collection "${collectionName}" not found. AUTO_CREATE_COLLECTIONS is disabled.`);
    return null;
  }

  log('ensureCollection', `Creating new collection: ${collectionName}`);
  const created = await createCollection(client, { title: collectionName, handle: slugify(collectionName) }, { dryRun });
  return created.custom_collection;
}

// ---------------------------------------------------------------------------
// Stage 3: Assign products to Collections
// ---------------------------------------------------------------------------

async function assignProductToCollection(client, productId, collectionId, { dryRun = false } = {}) {
  const body = { collect: { product_id: productId, collection_id: collectionId } };

  if (dryRun) {
    log('assignProductToCollection', `[DRY-RUN] Assigning product ${productId} to collection ${collectionId}`, body);
    await sleep(50);
    const mocked = {
      collect: {
        id: `gid://shopify/Collect/${Date.now()}`,
        product_id: productId,
        collection_id: collectionId,
        position: 1,
        sort_value: '0',
      },
    };
    log('assignProductToCollection', '[DRY-RUN] Mocked assignment', mocked);
    return mocked;
  }

  return shopifyRequest(client, 'POST', '/collects.json', { body });
}

// ---------------------------------------------------------------------------
// Stage 4: SEO description generation
// ---------------------------------------------------------------------------

/**
 * Template-based SEO description builder. Generates a description based on:
 *   1. Product type inference from title/tags
 *   2. Key selling points (quality, speed, uniqueness)
 *   3. Call-to-action
 */
function generateSEODescription(product) {
  const { title = '', product_type = '', tags = '' } = product;
  const tagArray = typeof tags === 'string' ? tags.split(',').map((t) => t.trim()) : tags;

  let category = 'Product';
  let material = 'premium quality';
  let useCase = 'unique home decor';

  if (tagArray.includes('canvas') || product_type.toLowerCase().includes('canvas')) {
    category = 'Canvas Print';
    material = 'professionally printed canvas';
    useCase = 'sophisticated wall art for modern spaces';
  } else if (tagArray.includes('t-shirt') || product_type.toLowerCase().includes('apparel')) {
    category = 'Custom Tee';
    material = 'premium 100% cotton blend';
    useCase = 'comfortable everyday wear';
  } else if (tagArray.includes('typography') || /typography|text|quote/i.test(title)) {
    category = 'Typography Art';
    material = 'carefully crafted typography';
    useCase = 'inspirational wall art';
  }

  // Build a template-based description
  const desc = `${category} featuring "${title}". ` +
    `This ${material} piece is perfect for ${useCase}. ` +
    `Each print is made-to-order, ensuring freshness and quality. ` +
    `Ideal for gifting or personal collection. `;

  return desc;
}

// ---------------------------------------------------------------------------
// Stage 5: Pricing rule engine
// ---------------------------------------------------------------------------

/**
 * Pricing rules determine final Shopify price based on cost + margin.
 * Rules can be:
 *   - Flat margin: cost + N%
 *   - Tiered: different margins by price bracket
 *   - Bundle: variant-specific adjustments
 */
function calculatePrice(costCents, { marginPercent = CONFIG.PROFIT_MARGIN_PERCENT, roundingMode = 'up' } = {}) {
  const markup = costCents * (marginPercent / 100);
  let finalCents = costCents + markup;

  if (roundingMode === 'up') {
    finalCents = Math.ceil(finalCents / 10) * 10; // round to nearest 10¢ (.99 habit)
  } else if (roundingMode === 'down') {
    finalCents = Math.floor(finalCents / 10) * 10;
  }

  return finalCents;
}

/**
 * Applies pricing rules to a product's variants.
 * Assumes variant.price is a string like "24.99", converts to cents, applies margin,
 * returns updated variant array.
 */
function applyPricingRules(product, { marginPercent = CONFIG.PROFIT_MARGIN_PERCENT } = {}) {
  const { variants = [] } = product;

  const updated = variants.map((v) => {
    const costCents = Math.round(parseFloat(v.price || 0) * 100);
    const finalCents = calculatePrice(costCents, { marginPercent });
    const finalPrice = (finalCents / 100).toFixed(2);

    return {
      ...v,
      price: finalPrice,
      _costCents: costCents,
      _marginCents: finalCents - costCents,
      _marginPercent: marginPercent,
    };
  });

  log('applyPricingRules', `Applied ${marginPercent}% margin to product "${product.title}"`, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Stage 6: Update product metadata in Shopify
// ---------------------------------------------------------------------------

async function updateProduct(client, productId, updates, { dryRun = false } = {}) {
  const body = { product: updates };

  if (dryRun) {
    log('updateProduct', `[DRY-RUN] Updating product ${productId}`, body);
    await sleep(50);
    const mocked = {
      product: {
        ...updates,
        id: productId,
        updated_at: new Date().toISOString(),
      },
    };
    log('updateProduct', '[DRY-RUN] Mocked update', mocked);
    return mocked;
  }

  // Extract numeric ID from gid://shopify/Product/ID
  const numericId = productId.split('/').pop();
  return shopifyRequest(client, 'PUT', `/products/${numericId}.json`, { body });
}

// ---------------------------------------------------------------------------
// Orchestration: full enrichment pipeline
// ---------------------------------------------------------------------------

/**
 * End-to-end: fetch Printify products, assign to collections, enrich SEO, apply pricing.
 */
async function enrichPrintifyProducts(client, { maxProducts = 10, dryRun = false } = {}) {
  log('enrichPrintifyProducts', 'Starting enrichment pipeline', { maxProducts, dryRun });

  // Step 1: List products
  const { products = [] } = await listProductsFromPrintify(client, { limit: maxProducts, dryRun });
  log('enrichPrintifyProducts', `Found ${products.length} Printify product(s)`);

  if (products.length === 0) {
    log('enrichPrintifyProducts', 'No products to enrich.');
    return { processed: 0, results: [] };
  }

  const results = [];

  for (const product of products) {
    try {
      log('enrichPrintifyProducts', `Processing product: "${product.title}"`);

      // Step 2: Suggest and assign collections
      const suggestedCollections = suggestCollections(product);
      const collectionAssignments = [];

      for (const collName of suggestedCollections) {
        const collection = await ensureCollection(client, collName, { dryRun });
        if (collection) {
          const assignment = await assignProductToCollection(client, product.id, collection.id, { dryRun });
          collectionAssignments.push({ collectionName: collName, assignment });
        }
      }

      // Step 3: Generate SEO description and update product
      const seoDescription = generateSEODescription(product);
      const pricedVariants = applyPricingRules(product);

      const existingTags = Array.isArray(product.tags)
        ? product.tags
        : (product.tags || '')
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t);
      const allTags = [...new Set([...existingTags, 'auto-enriched'])];

      const updatePayload = {
        title: product.title, // keep as-is or enhance
        body_html: seoDescription,
        tags: allTags.join(','),
        status: 'active', // publish to storefront
      };

      // Step 4: Update in Shopify
      const updated = await updateProduct(client, product.id, updatePayload, { dryRun });

      results.push({
        productId: product.id,
        title: product.title,
        collections: suggestedCollections,
        collectionAssignments,
        seoDescription: updatePayload.body_html,
        pricedVariants,
        updated: updated.product,
      });

      log('enrichPrintifyProducts', `✓ Enriched: ${product.title}`);
    } catch (err) {
      logError('enrichPrintifyProducts', `Failed to enrich "${product.title}"`, err);
      results.push({
        productId: product.id,
        title: product.title,
        error: err.message,
      });
    }
  }

  log('enrichPrintifyProducts', `Pipeline complete. Processed ${results.length} product(s).`);
  return { processed: results.length, results };
}

// ---------------------------------------------------------------------------
// Utility: slugify for handles
// ---------------------------------------------------------------------------

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CONFIG,
  createShopifyClient,
  shopifyRequest,
  listProductsFromPrintify,
  suggestCollections,
  listCollections,
  createCollection,
  ensureCollection,
  assignProductToCollection,
  generateSEODescription,
  calculatePrice,
  applyPricingRules,
  updateProduct,
  enrichPrintifyProducts,
  ShopifyServiceError,
};

// ---------------------------------------------------------------------------
// Dry-run demo — `node src/services/shopifyService.js`
// ---------------------------------------------------------------------------

if (require.main === module) {
  const client = createShopifyClient({ dryRun: true });

  enrichPrintifyProducts(client, { maxProducts: 2, dryRun: true })
    .then((result) => {
      console.log('\n=== DRY RUN SUCCEEDED ===');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('\n=== DRY RUN FAILED ===');
      console.error(err);
      process.exitCode = 1;
    });
}

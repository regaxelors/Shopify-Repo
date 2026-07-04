'use strict';

/**
 * printifyService.js
 *
 * Backend automation engine for the print-on-demand pipeline:
 *   fetchGeneratedAsset() -> uploadImage() -> buildProductPayload() -> createProduct() -> publishProduct()
 *
 * Every network call goes through request(), which centralizes retry/backoff,
 * rate-limit handling, and logging. Set DRY_RUN=true (or pass { dryRun: true }
 * to runPipeline) to exercise the full payload-construction logic against
 * canned mock responses instead of hitting the real APIs.
 */

require('dotenv').config();
const axios = require('axios');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  PRINTIFY_API_BASE_URL: process.env.PRINTIFY_API_BASE_URL || 'https://api.printify.com/v1',
  PRINTIFY_API_TOKEN: process.env.PRINTIFY_API_TOKEN || '',
  PRINTIFY_SHOP_ID: process.env.PRINTIFY_SHOP_ID || '',
  HUGGINGFACE_API_TOKEN: process.env.HUGGINGFACE_API_TOKEN || '',
  HUGGINGFACE_MODEL: process.env.HUGGINGFACE_MODEL || 'stabilityai/stable-diffusion-xl-base-1.0',
  PRINTIFY_BLUEPRINT_ID: process.env.PRINTIFY_BLUEPRINT_ID || null,
  PRINTIFY_BLUEPRINT_TITLE_HINT: process.env.PRINTIFY_BLUEPRINT_TITLE_HINT || 'Canvas',
  MAX_RETRIES: Number(process.env.PRINTIFY_MAX_RETRIES || 5),
  BASE_BACKOFF_MS: Number(process.env.PRINTIFY_BASE_BACKOFF_MS || 500),
  DEFAULT_PRICE_CENTS: Number(process.env.DEFAULT_PRICE_CENTS || 2499),
  // Personalization config
  ENABLE_PERSONALIZATION: String(process.env.ENABLE_PERSONALIZATION || 'true').toLowerCase() === 'true',
  PERSONALIZATION_TEXT_LIMIT: Number(process.env.PERSONALIZATION_TEXT_LIMIT || 50),
  PERSONALIZATION_HOLD_FOR_REVIEW: String(process.env.PERSONALIZATION_HOLD_FOR_REVIEW || 'true').toLowerCase() === 'true',
};

const DRY_RUN_DEFAULT = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(step, message, data) {
  const ts = new Date().toISOString();
  const prefix = `[printifyService][${ts}][${step}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function logError(step, message, err) {
  const ts = new Date().toISOString();
  console.error(`[printifyService][${ts}][${step}] ${message}`, {
    error: err && err.message,
    status: err && err.response && err.response.status,
    body: err && err.response && err.response.data,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Custom error type so callers can tell which pipeline stage failed
// ---------------------------------------------------------------------------

class PipelineStageError extends Error {
  constructor(stage, cause) {
    super(`Pipeline failed at stage "${stage}": ${cause.message}`);
    this.name = 'PipelineStageError';
    this.stage = stage;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Mock router — canned Printify-shaped responses used when dryRun is true.
// Lets the real request-building code run without ever hitting the network.
// ---------------------------------------------------------------------------

function mockResponseFor(method, url, data) {
  if (/\/catalog\/blueprints\.json$/.test(url)) {
    return [
      { id: 384, title: 'Matte Canvas, Stretched, 1.25"', brand: 'Generic', model: 'Canvas' },
      { id: 5, title: "Unisex Jersey Short Sleeve Tee", brand: 'Bella+Canvas', model: '3001' },
    ];
  }
  if (/\/catalog\/blueprints\/\d+\/print_providers\.json$/.test(url)) {
    return [
      { id: 29, title: 'Monster Digital' },
      { id: 99, title: 'Generic Print Co (mock)' },
    ];
  }
  if (/\/catalog\/blueprints\/\d+\/print_providers\/\d+\/variants\.json$/.test(url)) {
    return {
      variants: [
        { id: 33742, title: '12" x 18"', placeholders: [{ position: 'front', height: 3600, width: 2400 }] },
        { id: 33743, title: '16" x 24"', placeholders: [{ position: 'front', height: 4800, width: 3200 }] },
        { id: 33744, title: '18" x 24"', placeholders: [{ position: 'front', height: 4800, width: 3600 }] },
      ],
    };
  }
  if (/\/uploads\/images\.json$/.test(url) && method === 'POST') {
    return {
      id: 'mock-upload-5f2c1a9e',
      file_name: data && data.file_name,
      height: 1024,
      width: 1024,
      size: 245678,
      mime_type: 'image/png',
      preview_url: 'https://images.printify.com/mock/preview.png',
      upload_time: new Date().toISOString(),
    };
  }
  if (/\/shops\/[^/]+\/products\.json$/.test(url) && method === 'POST') {
    return {
      id: 'mock-product-9a7d3e21',
      title: data && data.title,
      description: data && data.description,
      tags: data && data.tags,
      blueprint_id: data && data.blueprint_id,
      print_provider_id: data && data.print_provider_id,
      variants: data && data.variants,
      images: [],
      visible: false,
      created_at: new Date().toISOString(),
    };
  }
  if (/\/shops\/[^/]+\/products\/[^/]+\/publish\.json$/.test(url) && method === 'POST') {
    return { status: 'accepted', product_id: url.split('/products/')[1].split('/')[0] };
  }

  throw new Error(`No mock configured for ${method} ${url}`);
}

// ---------------------------------------------------------------------------
// Core HTTP layer: retries, rate-limit (429) handling, dry-run short-circuit
// ---------------------------------------------------------------------------

const printifyClient = axios.create({
  baseURL: CONFIG.PRINTIFY_API_BASE_URL,
  timeout: 20000,
});

/**
 * Performs a Printify API request with exponential backoff + rate-limit
 * awareness. In dry-run mode, no network call is made — a canned mock
 * response matching Printify's real response shape is returned instead, so
 * downstream payload-construction code is still fully exercised.
 */
async function request(method, url, { data, params } = {}, { retries = CONFIG.MAX_RETRIES, dryRun = false } = {}) {
  if (dryRun) {
    log('request', `[DRY-RUN] ${method} ${url}`, data ? { data } : undefined);
    await sleep(50); // simulate network latency so logs read like a real sequence
    const mocked = mockResponseFor(method, url, data);
    log('request', `[DRY-RUN] mocked response for ${method} ${url}`, mocked);
    return mocked;
  }

  if (!CONFIG.PRINTIFY_API_TOKEN) {
    throw new Error('PRINTIFY_API_TOKEN is not set. Configure your .env or pass { dryRun: true }.');
  }

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      log('request', `${method} ${url} (attempt ${attempt}/${retries})`);
      const response = await printifyClient.request({
        method,
        url,
        data,
        params,
        headers: {
          Authorization: `Bearer ${CONFIG.PRINTIFY_API_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'NodeJS-POD-Automation/1.0',
        },
      });
      return response.data;
    } catch (err) {
      const status = err.response && err.response.status;
      const isRateLimited = status === 429;
      const isServerError = status >= 500 && status < 600;
      const isNetworkError = !err.response; // timeout, DNS, connection reset, etc.
      const canRetry = (isRateLimited || isServerError || isNetworkError) && attempt < retries;

      if (!canRetry) {
        logError('request', `${method} ${url} failed permanently after ${attempt} attempt(s)`, err);
        throw err;
      }

      let delayMs;
      if (isRateLimited && err.response.headers && err.response.headers['retry-after']) {
        delayMs = Number(err.response.headers['retry-after']) * 1000;
        log('request', `Rate limited (429). Honoring Retry-After header: waiting ${delayMs}ms`);
      } else {
        delayMs = CONFIG.BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        log('request', `Transient error (${status || 'network'}). Backing off ${delayMs}ms before retry`);
      }
      await sleep(delayMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 1: Asset generation
// ---------------------------------------------------------------------------

/**
 * Fetches (or generates) an image to use as print artwork.
 *
 * - If HUGGINGFACE_API_TOKEN is configured and dryRun is false, calls the
 *   Hugging Face Inference API (free tier) for a real text-to-image result.
 * - Otherwise, simulates asset generation via a deterministic placeholder
 *   image URL, so the rest of the pipeline still has something to work with.
 */
async function fetchGeneratedAsset({ prompt = 'a minimalist mountain landscape, flat design', jobId = Date.now(), dryRun = DRY_RUN_DEFAULT } = {}) {
  const fileName = `asset-${jobId}.png`;

  if (dryRun || !CONFIG.HUGGINGFACE_API_TOKEN) {
    const url = `https://picsum.photos/seed/${encodeURIComponent(String(jobId))}/1024/1024`;
    log('fetchGeneratedAsset', `Using placeholder asset source (dryRun=${dryRun}, hasHfToken=${!!CONFIG.HUGGINGFACE_API_TOKEN})`, { url, prompt });
    return { source: 'placeholder', fileName, url, prompt };
  }

  const endpoint = `https://api-inference.huggingface.co/models/${CONFIG.HUGGINGFACE_MODEL}`;
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      log('fetchGeneratedAsset', `Requesting image from Hugging Face (attempt ${attempt}/${maxAttempts})`, { model: CONFIG.HUGGINGFACE_MODEL, prompt });
      const response = await axios.post(
        endpoint,
        { inputs: prompt },
        {
          headers: { Authorization: `Bearer ${CONFIG.HUGGINGFACE_API_TOKEN}` },
          responseType: 'arraybuffer',
          timeout: 60000,
          validateStatus: () => true, // handle non-2xx ourselves to read the JSON error body
        }
      );

      const contentType = response.headers['content-type'] || '';

      if (response.status === 200 && contentType.startsWith('image/')) {
        const contents = Buffer.from(response.data).toString('base64');
        log('fetchGeneratedAsset', 'Received generated image from Hugging Face', { bytes: response.data.length });
        return { source: 'huggingface', fileName, contents, mimeType: contentType, prompt };
      }

      // Non-image response: model may still be loading (503) or an error occurred.
      const bodyText = Buffer.from(response.data).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch (_) {
        parsed = { error: bodyText };
      }

      if (response.status === 503 && parsed.estimated_time) {
        const waitMs = Math.min(Math.ceil(parsed.estimated_time * 1000), 30000);
        log('fetchGeneratedAsset', `Model is loading, retrying in ${waitMs}ms`, parsed);
        await sleep(waitMs);
        continue;
      }

      throw new Error(`Hugging Face API error (status ${response.status}): ${parsed.error || bodyText}`);
    } catch (err) {
      if (attempt === maxAttempts) {
        logError('fetchGeneratedAsset', 'Exhausted retries against Hugging Face API', err);
        throw err;
      }
      const backoff = CONFIG.BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logError('fetchGeneratedAsset', `Retrying after error (backoff ${backoff}ms)`, err);
      await sleep(backoff);
    }
  }

  throw new Error('fetchGeneratedAsset: unreachable retry exhaustion');
}

// ---------------------------------------------------------------------------
// Stage 2: Printify catalog lookups
// ---------------------------------------------------------------------------

async function getBlueprints({ dryRun = DRY_RUN_DEFAULT } = {}) {
  return request('GET', '/catalog/blueprints.json', {}, { dryRun });
}

async function getPrintProviders(blueprintId, { dryRun = DRY_RUN_DEFAULT } = {}) {
  return request('GET', `/catalog/blueprints/${blueprintId}/print_providers.json`, {}, { dryRun });
}

async function getVariants(blueprintId, printProviderId, { dryRun = DRY_RUN_DEFAULT } = {}) {
  return request(
    'GET',
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`,
    {},
    { dryRun }
  );
}

/**
 * Picks a blueprint (product type), its first available print provider, and
 * a small set of variants to publish with. Prefers CONFIG.PRINTIFY_BLUEPRINT_ID
 * if pinned; otherwise matches on CONFIG.PRINTIFY_BLUEPRINT_TITLE_HINT.
 */
async function selectBlueprintAndVariants({ dryRun = DRY_RUN_DEFAULT, maxVariants = 3 } = {}) {
  const blueprints = await getBlueprints({ dryRun });

  let blueprint;
  if (CONFIG.PRINTIFY_BLUEPRINT_ID) {
    blueprint = blueprints.find((bp) => String(bp.id) === String(CONFIG.PRINTIFY_BLUEPRINT_ID));
  }
  if (!blueprint) {
    // Randomly select from all blueprints (instead of always picking first "Canvas")
    blueprint = blueprints[Math.floor(Math.random() * blueprints.length)];
  }
  if (!blueprint) {
    throw new Error('No Printify blueprints available to select from.');
  }
  log('selectBlueprintAndVariants', 'Selected blueprint', blueprint);

  const printProviders = await getPrintProviders(blueprint.id, { dryRun });
  const printProvider = printProviders[0];
  if (!printProvider) {
    throw new Error(`No print providers available for blueprint ${blueprint.id}.`);
  }
  log('selectBlueprintAndVariants', 'Selected print provider', printProvider);

  const variantData = await getVariants(blueprint.id, printProvider.id, { dryRun });
  const variants = (variantData.variants || []).slice(0, maxVariants);
  if (variants.length === 0) {
    throw new Error(`No variants available for blueprint ${blueprint.id} / provider ${printProvider.id}.`);
  }
  log('selectBlueprintAndVariants', `Selected ${variants.length} variant(s)`, variants);

  return { blueprint, printProvider, variants };
}

// ---------------------------------------------------------------------------
// Stage 2 (cont.): Upload image to Printify media library
// ---------------------------------------------------------------------------

async function uploadImage(asset, { dryRun = DRY_RUN_DEFAULT } = {}) {
  const body = { file_name: asset.fileName };
  if (asset.contents) {
    body.contents = asset.contents; // base64, no data-URI prefix
  } else if (asset.url) {
    body.url = asset.url;
  } else {
    throw new Error('uploadImage: asset must include either "contents" (base64) or "url".');
  }

  log('uploadImage', 'Uploading asset to Printify media library', { file_name: body.file_name, via: body.url ? 'url' : 'base64' });
  const uploaded = await request('POST', '/uploads/images.json', { data: body }, { dryRun });
  log('uploadImage', 'Upload complete', uploaded);
  return uploaded;
}

// ---------------------------------------------------------------------------
// Personalization Layer Builder
// ---------------------------------------------------------------------------

/**
 * Builds a personalizable text layer for customer input.
 * Enables buyers to add custom text (e.g., names, monograms, messages).
 */
function buildTextPersonalizationLayer({
  layerTitle = 'Enter your custom text',
  characterLimit = CONFIG.PERSONALIZATION_TEXT_LIMIT,
  placeholderText = 'Your text here',
  position = 'front',
  fontFamily = 'Arial',
  fontSize = 24,
  textColor = '#000000',
} = {}) {
  return {
    type: 'text',
    title: layerTitle,
    placeholder: placeholderText,
    limits: {
      character_limit: characterLimit,
    },
    fonts: [fontFamily],
    position,
    default_font_size: fontSize,
    default_color: textColor,
    allowed_fonts: [fontFamily, 'Helvetica', 'Times New Roman', 'Courier'],
  };
}

/**
 * Builds a personalizable image upload layer for customer artwork.
 * Enables buyers to upload their own images/designs.
 */
function buildImagePersonalizationLayer({
  layerTitle = 'Upload your image',
  allowedFormats = ['jpg', 'png', 'gif'],
  maxFileSizeMb = 10,
  position = 'front',
} = {}) {
  return {
    type: 'image',
    title: layerTitle,
    position,
    limits: {
      allowed_formats: allowedFormats,
      max_file_size_mb: maxFileSizeMb,
    },
  };
}

/**
 * Wraps personalization layers into a Printify product personalization object.
 * Returns null if personalization is disabled in config.
 */
function buildPersonalizationPayload({
  personalizationType = 'text', // 'text' | 'image' | 'both'
  textLayerTitle = 'Personalize your item',
  imageLayerTitle = 'Add your design',
  characterLimit = CONFIG.PERSONALIZATION_TEXT_LIMIT,
} = {}) {
  if (!CONFIG.ENABLE_PERSONALIZATION) {
    return null;
  }

  const personalization = {
    enabled: true,
    layers: [],
  };

  if (personalizationType === 'text' || personalizationType === 'both') {
    personalization.layers.push(
      buildTextPersonalizationLayer({
        layerTitle: textLayerTitle,
        characterLimit,
      })
    );
  }

  if (personalizationType === 'image' || personalizationType === 'both') {
    personalization.layers.push(
      buildImagePersonalizationLayer({
        layerTitle: imageLayerTitle,
      })
    );
  }

  return personalization.layers.length > 0 ? personalization : null;
}

// ---------------------------------------------------------------------------
// Stage 2 (cont.): Build + create the product
// ---------------------------------------------------------------------------

function buildProductPayload({
  blueprintSelection,
  uploadedImage,
  title,
  description,
  tags = [],
  priceCents = CONFIG.DEFAULT_PRICE_CENTS,
  personalizationType = null, // 'text' | 'image' | 'both' or null for no personalization
}) {
  const { blueprint, printProvider, variants } = blueprintSelection;

  // Add personalization tags to Shopify listing
  const enrichedTags = [...tags];
  let personalization = null;

  if (personalizationType) {
    personalization = buildPersonalizationPayload({ personalizationType });
    if (personalization) {
      enrichedTags.push('personalizable');
      if (personalizationType === 'text' || personalizationType === 'both') {
        enrichedTags.push('custom-text');
      }
      if (personalizationType === 'image' || personalizationType === 'both') {
        enrichedTags.push('custom-image');
      }
    }
  }

  const payload = {
    title,
    description,
    tags: enrichedTags,
    blueprint_id: blueprint.id,
    print_provider_id: printProvider.id,
    variants: variants.map((v) => ({
      id: v.id,
      price: priceCents,
      is_enabled: true,
    })),
    print_areas: [
      {
        variant_ids: variants.map((v) => v.id),
        placeholders: [
          {
            position: 'front',
            images: [
              {
                id: uploadedImage.id,
                x: 0.5,
                y: 0.5,
                scale: 1,
                angle: 0,
              },
            ],
          },
        ],
      },
    ],
  };

  // Add personalization object if enabled
  if (personalization) {
    payload.personalization = personalization;
    log('buildProductPayload', 'Added personalization layer(s)', {
      type: personalizationType,
      layers: personalization.layers.length,
    });
  }

  // Set product status based on personalization review requirement
  if (CONFIG.PERSONALIZATION_HOLD_FOR_REVIEW && personalization) {
    payload.status = 'draft'; // Hold for review before auto-publishing
    log('buildProductPayload', 'Product status set to DRAFT for personalization review');
  }

  log('buildProductPayload', 'Constructed product payload', {
    title: payload.title,
    hasPersonalization: !!personalization,
    status: payload.status || 'active',
  });
  return payload;
}

async function createProduct(payload, { dryRun = DRY_RUN_DEFAULT } = {}) {
  if (!CONFIG.PRINTIFY_SHOP_ID && !dryRun) {
    throw new Error('PRINTIFY_SHOP_ID is not set. Configure your .env or pass { dryRun: true }.');
  }
  const shopId = CONFIG.PRINTIFY_SHOP_ID || 'mock-shop-id';
  log('createProduct', `Creating product in shop ${shopId}`);
  const product = await request('POST', `/shops/${shopId}/products.json`, { data: payload }, { dryRun });
  log('createProduct', 'Product created', product);
  return product;
}

// ---------------------------------------------------------------------------
// Stage 3: Publish to the connected store (Printify pushes to Shopify)
// ---------------------------------------------------------------------------

async function publishProduct(productId, { dryRun = DRY_RUN_DEFAULT } = {}) {
  const shopId = CONFIG.PRINTIFY_SHOP_ID || 'mock-shop-id';
  const body = {
    title: true,
    description: true,
    images: true,
    variants: true,
    tags: true,
    keyFeatures: true,
    shipping_template: true,
  };
  log('publishProduct', `Publishing product ${productId} to connected store`);
  const result = await request('POST', `/shops/${shopId}/products/${productId}/publish.json`, { data: body }, { dryRun });
  log('publishProduct', 'Publish request accepted', result);
  return result;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * End-to-end pipeline: asset generation → Printify upload → product creation → publishing.
 *
 * Supports dynamic prompts: can accept static prompts or styled/trending concepts.
 * Example styled prompt: "bohemian wall decor, minimalist aesthetic vector art"
 *
 * Each pipeline execution is idempotent and keyed by jobId, so it can be
 * safely resumed after a partial failure without duplicating products.
 */
async function runPipeline({
  jobId = Date.now(),
  prompt = 'a minimalist mountain landscape, flat design',
  title = 'Automated Print — Mountain Landscape',
  description = 'Generated automatically by the print-on-demand pipeline.',
  tags = ['automated', 'print-on-demand'],
  dryRun = DRY_RUN_DEFAULT,
  personalizationType = null, // 'text' | 'image' | 'both' or null
} = {}) {
  log('runPipeline', `Starting pipeline for job ${jobId} (dryRun=${dryRun})`);

  let asset;
  try {
    asset = await fetchGeneratedAsset({ prompt, jobId, dryRun });
  } catch (err) {
    throw new PipelineStageError('fetchGeneratedAsset', err);
  }

  let blueprintSelection;
  try {
    blueprintSelection = await selectBlueprintAndVariants({ dryRun });
  } catch (err) {
    throw new PipelineStageError('selectBlueprintAndVariants', err);
  }

  let uploadedImage;
  try {
    uploadedImage = await uploadImage(asset, { dryRun });
  } catch (err) {
    throw new PipelineStageError('uploadImage', err);
  }

  let product;
  try {
    const payload = buildProductPayload({
      blueprintSelection,
      uploadedImage,
      title,
      description,
      tags,
      personalizationType,
    });
    product = await createProduct(payload, { dryRun });
  } catch (err) {
    throw new PipelineStageError('createProduct', err);
  }

  let publishResult;
  try {
    publishResult = await publishProduct(product.id, { dryRun });
  } catch (err) {
    throw new PipelineStageError('publishProduct', err);
  }

  log('runPipeline', `Pipeline complete for job ${jobId}`);
  return { jobId, asset, blueprintSelection, uploadedImage, product, publishResult };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CONFIG,
  fetchGeneratedAsset,
  getBlueprints,
  getPrintProviders,
  getVariants,
  selectBlueprintAndVariants,
  uploadImage,
  buildProductPayload,
  createProduct,
  publishProduct,
  runPipeline,
  PipelineStageError,
  // Personalization exports
  buildTextPersonalizationLayer,
  buildImagePersonalizationLayer,
  buildPersonalizationPayload,
};

// ---------------------------------------------------------------------------
// Dry-run demo — `node src/services/printifyService.js`
// ---------------------------------------------------------------------------

if (require.main === module) {
  runPipeline({ dryRun: true, jobId: 'demo-job-001' })
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

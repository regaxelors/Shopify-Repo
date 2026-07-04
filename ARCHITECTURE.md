# Print-on-Demand Automation Pipeline — Architecture

## Goal

A low-cost, autonomous pipeline that generates print-ready artwork, turns it into
products on Printify, and keeps a Shopify storefront in sync — with minimal human
intervention beyond approving/curating designs (optional) and monitoring for errors.

## High-Level Flow

```
 ┌───────────────────┐     ┌──────────────────────┐     ┌───────────────────────┐     ┌─────────────────────┐
 │ 1. Asset          │     │ 2. Printify           │     │ 3. Shopify            │     │ 4. Monitoring /     │
 │    Generation     │ --> │    Product Creation   │ --> │    Sync & Publish     │ --> │    Feedback Loop    │
 └───────────────────┘     └──────────────────────┘     └───────────────────────┘     └─────────────────────┘
```

## Stage 1 — Asset Generation

**Purpose:** Produce print-ready image files (and optionally font/typography-based
designs) with zero/near-zero marginal cost per design.

**Components**
- `src/generation/promptEngine.js` — builds/varies prompts (themes, styles, niches)
  from a config or trend list.
- `src/generation/imageProvider.js` — thin adapter over a free/cheap image API
  (e.g. Hugging Face Inference API or Replicate) so the underlying provider can be
  swapped without touching callers.
- `src/generation/fontRenderer.js` — for text/typography-based designs, renders
  phrases onto transparent PNGs using `node-canvas` or `sharp` with licensed/free
  fonts (Google Fonts), skipping the image-gen API entirely for text-only products.
- `src/generation/postProcess.js` — validates output (min resolution, DPI for print,
  transparent background where required), normalizes to Printify's accepted
  formats (PNG/JPEG, sRGB).
- Output: files land in `assets/generated/{jobId}/*.png` plus a `manifest.json`
  describing title, tags, description, and source prompt for the next stage.

**Autonomy hooks:** a scheduled job (`cron` or a simple `node-cron` task) can pull
the next N prompts from a queue/config, generate assets, and hand off to Stage 2
automatically. Failed generations are logged and retried with backoff.

## Stage 2 — Printify Product Creation

**Purpose:** Turn a validated asset + manifest into one or more Printify products
across chosen blueprints (t-shirt, poster, mug, etc.) and variants.

**Components**
- `src/printify/client.js` — thin Axios wrapper around the Printify Admin API
  (auth via Bearer token from `.env`), with retry/backoff and rate-limit handling.
- `src/printify/uploadImage.js` — uploads the generated PNG to Printify's Images
  endpoint, returns an `image_id`.
- `src/printify/createProduct.js` — given `image_id` + manifest, selects a
  blueprint/print-provider/variant set (from a config map, e.g.
  `config/blueprints.json`), computes pricing (cost + margin), and calls
  `POST /shops/{shop_id}/products.json`.
- `src/printify/publish.js` — calls Printify's publish endpoint, which is what
  triggers Printify's own push into the connected Shopify store.

**Autonomy hooks:** this stage is triggered automatically once Stage 1 writes a
new manifest; a small orchestrator (`src/orchestrator/pipeline.js`) watches the
`assets/generated` queue (or is invoked directly by Stage 1) and drives the
Printify calls end-to-end, recording the resulting `product_id` back into the job
record for traceability.

## Stage 3 — Shopify Syncing

**Purpose:** Because Printify's "Publish" action already pushes product data to a
connected Shopify store, this stage is mostly about *verification and enrichment*
rather than re-uploading:

**Components**
- `src/shopify/client.js` — `@shopify/shopify-api` REST/GraphQL client
  authenticated with an Admin API access token.
- `src/shopify/verifySync.js` — polls Shopify for the product (by matching
  Printify's external handle/SKU) to confirm it landed, since Printify's publish
  webhook can lag.
- `src/shopify/enrichProduct.js` — applies anything Printify doesn't manage well:
  SEO title/description, collections, tags, metafields, theme-specific metadata.
- `src/shopify/inventoryPolicy.js` — sets `inventory_policy` / fulfillment service
  flags so Shopify treats the product as dropship (no local stock tracking).
- Webhook receiver (`src/webhooks/printifyWebhook.js`,
  `src/webhooks/shopifyWebhook.js`) mounted on the Express app to react to
  `product:publish:started` / `succeeded` / `failed` events from Printify instead
  of polling, when available.

## Stage 4 — Monitoring & Feedback Loop

- `src/dashboard/` — minimal Express-served dashboard (small React or server-
  rendered EJS view) showing: jobs in flight, generated-vs-published counts,
  failures needing attention, and per-product cost/margin.
- Structured logging (`pino` or plain JSON console logs) so failures at any stage
  are traceable by `jobId`.
- Optional: a nightly job that retries failed jobs and prunes stale generated
  assets that never made it to Printify.

## Orchestration

```
src/orchestrator/pipeline.js
  runPipeline(jobConfig)
    1. generateAssets(jobConfig)      -> manifest
    2. createPrintifyProduct(manifest) -> printifyProduct
    3. publishToShopify(printifyProduct) -> shopifyProduct
    4. verifyAndEnrich(shopifyProduct)
    5. recordJobResult(...)
```

Each step is idempotent and keyed by `jobId`, so the orchestrator can be safely
re-run/resumed after a partial failure without duplicating products.

## Directory Layout (target)

```
/
├── ARCHITECTURE.md
├── package.json
├── .env.example
├── .gitignore
├── server.js                     # Express entrypoint (dashboard + webhooks)
├── config/
│   └── blueprints.json           # Printify blueprint/provider/variant/pricing map
├── src/
│   ├── generation/
│   │   ├── promptEngine.js
│   │   ├── imageProvider.js
│   │   ├── fontRenderer.js
│   │   └── postProcess.js
│   ├── printify/
│   │   ├── client.js
│   │   ├── uploadImage.js
│   │   ├── createProduct.js
│   │   └── publish.js
│   ├── shopify/
│   │   ├── client.js
│   │   ├── verifySync.js
│   │   ├── enrichProduct.js
│   │   └── inventoryPolicy.js
│   ├── webhooks/
│   │   ├── printifyWebhook.js
│   │   └── shopifyWebhook.js
│   ├── orchestrator/
│   │   └── pipeline.js
│   └── dashboard/
│       └── (minimal UI)
└── assets/
    └── generated/                # gitignored — generated art + manifests
```

## Cost-Control Principles

- Prefer free-tier image generation (Hugging Face Inference API free tier,
  Replicate free credits) over paid APIs; make the provider swappable via
  `imageProvider.js` so a paid tier can be dropped in later without refactoring.
- Cache/reuse generated assets across variants (one image -> many blueprints).
- No Shopify product upload code needed beyond verification — let Printify's
  native Shopify integration do the heavy lifting of syncing product data, which
  avoids duplicating logic and double-billing API calls.

## Next Steps (subsequent tasks)

1. Scaffold `src/printify/client.js` and `src/shopify/client.js` with auth wiring.
2. Build `config/blueprints.json` for the first 2-3 product types.
3. Implement Stage 1 with a free image API and a manual trigger before adding
   scheduling.
4. Wire the Express server with a `/health` route and a `/webhooks/printify`
   receiver.

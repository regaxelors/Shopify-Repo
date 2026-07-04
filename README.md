# Print-on-Demand Automation Pipeline

Autonomous, zero-cost end-to-end pipeline for generating print-ready artwork, publishing to Printify, and syncing with Shopify storefronts. Runs every 24 hours as a background routine.

## Quick Start

### 1. Verify the System
```bash
npm run verify
```

Checks:
- ✓ All dependencies installed
- ✓ All modules import cleanly  
- ✓ No broken promise chains
- ✓ Configuration (optional; dry-run works without credentials)

### 2. Test in Dry-Run Mode (No API Keys Needed)
```bash
npm run dry-run
```

Exercises the full pipeline with mocked API responses:
- Asset generation → Printify product creation → Shopify enrichment
- Takes ~1.5s, returns zero errors
- Safe to run anytime to verify the system works

### 3. Check Credentials
```bash
npm run check-creds
```

Verifies that your `.env` file has:
- Shopify credentials (store domain + admin token)
- Printify credentials (API token + shop ID)

### 4. Run the Autonomous Pipeline
```bash
npm start
```

Starts the background scheduler. By default, runs once daily at 00:00 UTC (configurable via `SCHEDULE_CRON`).

## Architecture

```
Asset Generation
    ↓
Printify Product Creation
    ↓
Shopify Sync (Printify publishes automatically)
    ↓
Shopify Enrichment (SEO, Collections, Pricing)
```

### Services

| Service | Purpose |
|---------|---------|
| `src/services/printifyService.js` | Generate assets, create Printify products, publish |
| `src/services/shopifyService.js` | List Printify products from Shopify, enrich (SEO, pricing, collections) |
| `src/app.js` | Orchestrate pipeline, manage scheduler |
| `src/utils/browserAuth.js` | OAuth token management, credential verification |

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

### Required (for real API calls; optional for dry-run)
- `SHOPIFY_STORE_DOMAIN` → e.g., `your-store.myshopify.com`
- `SHOPIFY_ADMIN_API_ACCESS_TOKEN` → [Create a custom app](https://shopify.dev/docs/apps/admin-api/custom-apps) with product write/read scopes
- `PRINTIFY_API_TOKEN` → [Get from Printify settings](https://printify.com/app/account/api)
- `PRINTIFY_SHOP_ID` → Found on same page as API token

### Optional (tuning)
- `DRY_RUN` → `true` to skip real API calls (default: `false`)
- `SCHEDULE_CRON` → Cron pattern for scheduler (default: `0 0 * * *` = daily at 0:00 UTC)
- `MAX_PRODUCTS_PER_RUN` → Products to enrich per run (default: `10`)
- `NODE_ENV` → `production` or `development` (default: `development`)
- `PROFIT_MARGIN_PERCENT` → Markup % on Printify cost (default: `50`)

### Cron Examples
```
0 0 * * *        Every day at 0:00 UTC
0 */4 * * *      Every 4 hours
0 0 * * MON      Every Monday at 0:00 UTC
*/30 * * * *     Every 30 minutes
```

## Key Features

### 1. Asset Generation
- Calls free Hugging Face Inference API (Stable Diffusion XL) to generate artwork
- Falls back to placeholder images if no token configured
- Fully customizable prompts

### 2. Printify Integration
- Fetches available blueprints (canvas, t-shirt, etc.)
- Uploads generated images to Printify media library
- Creates products with variants, pricing, and print areas
- Publishes to connected Shopify store via Printify's native integration

### 3. Shopify Enrichment
- Discovers products synced from Printify
- Auto-assigns to Collections based on title/tags:
  - **Canvas Prints** → matches `/canvas|print|wall art/i`
  - **Typography & Text** → matches `/typography|text|font|quote/i`
  - **Abstract & Minimalist** → matches `/abstract|minimalist|geometric/i`
  - **Apparel** → matches `/t-shirt|tee|shirt|hoodie/i`
- Generates template-based SEO descriptions (product-type aware)
- Applies intelligent pricing (cost + margin %, rounded to $X.X9)

### 4. Rate-Limit Handling
- Exponential backoff with jitter
- Respects `Retry-After` headers from APIs
- Max 5 retries per request (configurable)

### 5. Autonomous Scheduling
- Uses `node-cron` for background scheduling
- Runs in the same process; graceful shutdown on SIGINT/SIGTERM
- Prevents concurrent runs (skips if already executing)
- Detailed execution logging with timing

### 6. Dry-Run / Verification
- All API calls can be mocked via `dryRun` flag
- Test payload construction without credentials
- Validate entire pipeline logic in seconds

## NPM Scripts

```bash
npm start              # Start the autonomous pipeline (production)
npm run dev            # Dry-run test (development)
npm run dry-run        # Alias for dev
npm run verify         # System health check
npm run check-creds    # Verify .env credentials
npm run test:printify  # Test Printify service in isolation
npm run test:shopify   # Test Shopify service in isolation
```

## Testing Individual Services

### Printify Service
```bash
node src/services/printifyService.js
```
Outputs: Asset generation → product creation → publishing pipeline

### Shopify Service
```bash
node src/services/shopifyService.js
```
Outputs: Product discovery → collection assignment → SEO + pricing

## Monitoring & Logs

Every pipeline run produces detailed timestamped logs:

```
[app][2026-07-04T17:47:30.743Z] Pod automation pipeline initializing
[app][2026-07-04T17:47:30.743Z] Stage 1/3: Asset generation & Printify product creation
[printifyService][2026-07-04T17:47:30.795Z] Selected blueprint ...
[shopifyService][2026-07-04T17:47:51.663Z] Applied 50% margin to product ...
[app][2026-07-04T17:47:51.714Z] Pipeline execution complete { duration: '1436ms', ... }
```

Key fields logged:
- Timestamp (UTC)
- Service/stage name
- Operation details
- Errors (if any)

## Architecture Diagram

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed design decisions and future roadmap.

## Pricing Strategy

### Current (Flat Margin)
```
Cost (from Printify) + 50% markup = Final Shopify price
Example: $24.99 canvas → 50% margin → $37.50 Shopify price
```

### Configurable
Edit `PROFIT_MARGIN_PERCENT` in `.env` or modify `calculatePrice()` in `src/services/shopifyService.js` for tiered/dynamic pricing.

## Cost Breakdown (Monthly Estimate)

| Component | Cost | Notes |
|-----------|------|-------|
| Shopify | $29–$299 | Depending on plan |
| Printify | $0 | Freemium; pay-per-unit print costs only |
| Asset Generation | $0 | Hugging Face free tier (5 concurrent requests/month on base tier) |
| Hosting | $0–$5 | Run on local machine, VPS, or AWS Lambda |
| **Total** | **$29–$304** | Plus print costs per order |

## Deployment Options

### Local Machine
```bash
npm start
# Leave running in a terminal
# Or use `pm2` for background process:
npm install -g pm2
pm2 start src/app.js --name "pod-pipeline"
```

### Cloud (AWS, Heroku, Render, etc.)
- Deploy the repo
- Set environment variables (`.env`)
- Run `npm start`
- Scheduler will run every 24 hours without manual intervention

### Docker
```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src ./src
ENV NODE_ENV=production
CMD ["npm", "start"]
```

## Troubleshooting

### Pipeline not running
1. Check credentials: `npm run check-creds`
2. Verify system: `npm run verify`
3. Test in dry-run: `npm run dry-run`

### "Module not found" error
```bash
npm install
```

### API rate limits
- Printify: 30 requests/sec soft limit; service backs off automatically
- Shopify: 2 requests/sec for REST; service honors backoff

### No Shopify products created after Printify publish
- Printify → Shopify sync can take 5–10 seconds
- Service includes a 2-second wait; increase if needed in `src/app.js`

## Development

### Adding a New Collection Category
Edit `COLLECTION_RULES` in `src/services/shopifyService.js`:

```javascript
{
  name: 'My New Collection',
  matchPatterns: [/my|pattern/i],
  matchTags: ['my', 'tag'],
}
```

### Custom Pricing Strategy
Modify `calculatePrice()` in `src/services/shopifyService.js`:

```javascript
function calculatePrice(costCents, { tiered = false } = {}) {
  if (tiered) {
    if (costCents < 1000) return costCents * 2.0;       // 100% margin under $10
    if (costCents < 2500) return costCents * 1.75;      // 75% margin $10–$25
    return costCents * 1.50;                            // 50% margin over $25
  }
  // ... existing logic
}
```

### Using a Different Image Provider
Replace the Hugging Face call in `fetchGeneratedAsset()`:

```javascript
// Current: Hugging Face Inference API
// Alternative: Replicate, Stable Diffusion API, Midjourney, etc.
```

## License

MIT

## Support

- **Issues/Bugs**: Check logs, run `npm run verify`, test in dry-run mode
- **Feature Requests**: Modify the corresponding service (`src/services/*.js`)
- **API Docs**: [Shopify Admin API](https://shopify.dev/docs/admin-api) | [Printify API](https://printify.com/api/)

---

**Last Updated**: 2026-07-04  
**Version**: 0.1.0  
**Status**: Ready for autonomous operation

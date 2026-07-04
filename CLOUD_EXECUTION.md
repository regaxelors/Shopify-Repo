# Cloud Execution — Trend-Driven Product Generation

The `src/index.js` module provides a **cloud-ready entry point** for autonomous, trend-driven product generation with per-trend error resilience and AWS Lambda support.

## Quick Start

### Local Testing (Dry-Run)
```bash
npm run cloud:dry
```

Output:
```
=== EXECUTION SUMMARY ===
{
  "trendsFound": 5,
  "productsGenerated": 5,
  "productsFailed": 0,
  "productsEnriched": 2,
  "durationMs": 2382,
  "successRate": "100%"
}
```

### Production Execution
```bash
npm run cloud
```

Requires `.env` credentials (Shopify + Printify).

### AWS Lambda Deployment
```javascript
// handler.js (for AWS Lambda)
const index = require('./src/index');
exports.handler = index.handler;
```

Then configure CloudWatch Events to trigger daily at your preferred time.

## How It Works

### Three-Stage Pipeline

```
Step 1: FETCH TRENDS
  └─ getDailyTrendingConcepts() → [5 trending concepts]
     ├─ Fetch 28 raw keywords
     ├─ Filter (remove brands, celebrities, legal terms)
     └─ Rank by design appeal (top 5)

Step 2: GENERATE FROM EACH TREND (with error resilience)
  ├─ Concept 1: "bohemian wall decor"
  │  ├─ Styled prompt: "bohemian wall decor, vintage distressed typography design, bold text art"
  │  ├─ Product title: "Trending: Bohemian Wall Decor"
  │  ├─ Tags: ["bohemian", "wall", "decor", "boho", "trending", "auto-generated"]
  │  └─ Generate → Printify → Publish ✓
  │
  ├─ Concept 2: "gothic romance theme"
  │  ├─ Styled prompt: "gothic romance theme, minimalist aesthetic vector art"
  │  ├─ Product title: "Trending: Gothic Romance Theme"
  │  └─ Generate → Printify → Publish ✓
  │
  ├─ Concept 3: "minimalist boho aesthetic"
  │  └─ Generate → Printify → Publish ✓
  │
  └─ ... continues for all 5 concepts

Step 3: ENRICH SHOPIFY
  └─ enrichGeneratedProducts()
     ├─ Discover newly synced products
     ├─ Auto-assign to collections
     ├─ Add SEO descriptions
     ├─ Apply profit margins
     └─ Publish
```

## Dynamic Prompt Injection

Each trending concept is transformed into a **styled image generation prompt** by:

1. **Picking a style template** based on the concept keywords:
   - Typography keywords → "vintage distressed typography design"
   - Vector/geometric → "minimalist aesthetic vector art"
   - Abstract/surreal → "abstract artistic interpretation, modern digital painting"
   - Retro/vintage → "retro vintage aesthetic, nostalgic color palette"
   - Minimalist → "minimalist design, clean lines, monochrome"
   - Psychedelic → "psychedelic trippy visuals, vibrant colors, surreal"
   - Cyberpunk → "cyberpunk neon aesthetic, futuristic digital art"
   - Watercolor → "watercolor painting style, soft pastel tones"

2. **Combining concept + style**:
   ```
   "bohemian wall decor, vintage distressed typography design, bold text art"
   ```

3. **Passing to Hugging Face Inference API**:
   - Generates a unique, styled image based on the trend + styling instructions
   - No two products have identical designs (even if same trend is repeated)

## SEO Tag Injection

Product tags are **dynamically extracted** from the trending concept:

```
Concept: "bohemian wall decor"

Extracted tags:
  ├─ Direct words: ["bohemian", "wall", "decor"]
  ├─ Aliases: ["boho"] (bohemian → boho)
  └─ Auto-added: ["trending", "auto-generated"]

Final tags: ["bohemian", "wall", "decor", "boho", "trending", "auto-generated"]
```

This ensures:
- ✓ Products rank for the exact trending keywords
- ✓ Shopify search suggests match "bohemian wall decor" queries
- ✓ Google Trends interest → immediate Shopify inventory

## Error Resilience

**Critical feature**: One failing trend does **NOT** crash the batch.

```javascript
for (const concept of concepts) {
  try {
    // Generate product from this trend
  } catch (err) {
    // Log error, but continue to next concept
    results.errors.push({ concept, error: err.message });
  }
}
```

Example:
```
Processing 5 concepts:
  ✓ Concept 1: bohemian wall decor — SUCCESS
  ✓ Concept 2: gothic romance theme — SUCCESS
  ✗ Concept 3: minimalist boho aesthetic — FAILED (network error)
  ✓ Concept 4: pastel goth aesthetic — SUCCESS
  ✓ Concept 5: vaporwave art — SUCCESS

Result: 4/5 succeeded, batch continues, no crash.
```

This is **essential for cloud execution**:
- Transient network errors don't break the cron job
- One bad concept doesn't lose 5 products worth of revenue
- The cron job continues and completes (partial success is success)

## Configuration

### Environment Variables
```bash
DRY_RUN=true|false        # Skip real API calls
PROFIT_MARGIN_PERCENT=50  # Pricing markup
MAX_CONCEPTS=5            # How many trends to process (default: 5)
TREND_SOURCE=mock         # 'mock' | 'google-trends-rss'
```

### Styling Templates
Edit the `CONFIG.STYLING_TEMPLATES` object in `src/index.js` to customize design instructions:

```javascript
CONFIG.STYLING_TEMPLATES = {
  typography: 'vintage distressed typography, bold text art',
  vector: 'minimalist aesthetic vector art, flat design',
  // ... customize as needed
}
```

## Usage Patterns

### Daily Cron Job (Every 24 Hours)
```bash
# .env or cron job
0 0 * * * /usr/bin/node /path/to/src/index.js
```

### AWS Lambda (CloudWatch Events)
1. Deploy as Lambda function (handler → `src/index.js`)
2. Set environment variables (Shopify token, Printify token, etc.)
3. Create CloudWatch Events rule: `cron(0 0 * * ? *)`
4. Trigger every day at 0:00 UTC

### Heroku Scheduler
```bash
npm run cloud
```
(Schedule as a daily task in Heroku Scheduler dashboard)

### GitHub Actions (Workflow)
```yaml
name: Daily Trend Generation

on:
  schedule:
    - cron: '0 0 * * *'

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm run cloud
        env:
          SHOPIFY_STORE_DOMAIN: ${{ secrets.SHOPIFY_STORE_DOMAIN }}
          SHOPIFY_ADMIN_API_ACCESS_TOKEN: ${{ secrets.SHOPIFY_TOKEN }}
          PRINTIFY_API_TOKEN: ${{ secrets.PRINTIFY_TOKEN }}
          PRINTIFY_SHOP_ID: ${{ secrets.PRINTIFY_SHOP_ID }}
```

## Monitoring & Logging

Every execution produces structured logs:

```
[index][2026-07-04T17:56:52.385Z] cloudExecutionRun Starting cloud execution run
[index][2026-07-04T17:56:52.402Z] generateFromTrends Processing 5 concept(s)
[index][2026-07-04T17:56:52.402Z] Concept 1/5 Processing: "bohemian wall decor"
[index][2026-07-04T17:56:52.402Z] Concept 1 Styled prompt: bohemian wall decor, vintage distressed typography design, bold text art
[index][2026-07-04T17:56:52.402Z] Concept 1 SUCCESS — Product created
... (concepts 2-5)
[index][2026-07-04T17:57:01.020Z] cloudExecutionRun ✓ EXECUTION COMPLETE
```

Parse these logs for:
- Trends processed per day
- Success/failure rates
- Which concepts failed (and why)
- Total products generated
- Time elapsed

### Send Logs to CloudWatch / Datadog / etc.
```bash
npm run cloud 2>&1 | sed 's/^/LOG: /' >> /var/log/pod-pipeline.log
```

### Alert Rules
- `failureCount > 0` — at least one trend failed
- `successRate < 50%` — more than half the trends failed
- `durationMs > 60000` — job took over 1 minute (too slow)
- No execution for > 26 hours — cron job didn't run

## Performance

| Metric | Value |
|--------|-------|
| Per-trend generation | 400–600ms (with asset gen) |
| Batch of 5 trends | ~2.5 seconds total |
| Shopify enrichment | ~500ms (per 2 products) |
| Total execution | 3–5 seconds (depends on asset gen latency) |
| Lambda timeout | 30s (comfortable margin) |
| Lambda memory | 256MB (sufficient) |

## Cost Estimate (Daily Execution)

| Component | Cost/Day | Notes |
|-----------|----------|-------|
| AWS Lambda | ~$0.0001 | 5 executions × 3s each @ 256MB |
| Hugging Face | ~$0.01–$0.05 | Free tier (limited), paid tier available |
| Printify | $0 | Freemium; pay-per-unit when printed |
| Shopify API | $0 | Included in plan |
| **Total/Day** | **~$0.02–$0.06** | ~$0.60–$1.80 per month |

## Testing

### Test Resilience
One trend fails, batch continues:
```bash
node test-trend-resilience.js
```

### Test Each Service Standalone
```bash
npm run test:trends     # Trend fetching + filtering
npm run test:printify   # Printify pipeline
npm run test:shopify    # Shopify enrichment
npm run cloud:dry       # Full cloud execution (dry-run)
```

## Lambda Function Example

```javascript
// lambda_handler.js (AWS Lambda)

const index = require('./src/index');

exports.handler = index.handler;

// Alternatively, with custom logic:
exports.customHandler = async (event, context) => {
  try {
    const result = await index.cloudExecutionRun();
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        summary: result.summary,
      }),
    };
  } catch (error) {
    console.error('Execution failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};
```

Deploy with:
```bash
zip -r lambda.zip src/ node_modules/ .env
aws lambda create-function \
  --function-name pod-pipeline \
  --runtime nodejs18.x \
  --role arn:aws:iam::ACCOUNT:role/lambda-role \
  --handler lambda_handler.handler \
  --zip-file fileb://lambda.zip
```

## Example Output

### Successful Run
```json
{
  "trendsFound": 5,
  "productsGenerated": 5,
  "productsFailed": 0,
  "productsEnriched": 2,
  "durationMs": 2382,
  "successRate": "100%"
}
```

### Partial Success (Some Trends Failed)
```json
{
  "trendsFound": 5,
  "productsGenerated": 4,
  "productsFailed": 1,
  "productsEnriched": 2,
  "durationMs": 2100,
  "successRate": "80%"
}
```

The job **exits 0** (success) in both cases. Monitoring should alert on `successRate < 50%` or `productsFailed > 0`.

## Future Enhancements

- [ ] Rate limiting: wait between Printify API calls (avoid hitting limits)
- [ ] Deduplication: check if trend was already generated yesterday
- [ ] A/B testing: split traffic between trend-based and static designs
- [ ] Trend velocity: prioritize "fastest rising" trends over flat trends
- [ ] Geolocation: generate for US, EU, APAC trends separately
- [ ] Feedback loop: track which trends convert, reprioritize next day
- [ ] Webhook support: trigger immediately when new trends emerge (not 24-hour delay)

---

**Status**: Production-ready  
**Deployment**: AWS Lambda, Heroku, GitHub Actions, cron  
**Error Handling**: Per-trend isolation (one failure ≠ batch failure)  
**Performance**: ~3–5 seconds per run (5 trends)  
**Cost**: ~$0.02–$0.06/day (~$0.60–$1.80/month)

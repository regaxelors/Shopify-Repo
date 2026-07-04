# Deployment Checklist

## Pre-Deployment Verification ✓

- [x] All dependencies installed (`npm ls`)
- [x] All modules import cleanly (`npm run verify`)
- [x] Dry-run tests pass (`npm run dry-run`)
- [x] No unhandled promise rejections
- [x] Project structure complete

## Setup Steps

### 1. Clone or Set Up the Repository
```bash
cd /path/to/pod-automation-pipeline
npm install
```

### 2. Create `.env` File
```bash
cp .env.example .env
```

Then edit `.env` and fill in:

#### Shopify (Required)
1. Create a custom app in Shopify Admin → Settings → Apps and sales channels → Develop apps
2. Copy the **Admin API access token**
3. Ensure scopes include: `write_products`, `read_products`

```env
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_API_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### Printify (Required)
1. Go to https://printify.com/app/account/api
2. Create a personal access token
3. Find your Shop ID on the same page

```env
PRINTIFY_API_TOKEN=your_token_here
PRINTIFY_SHOP_ID=123456
```

#### Optional Tuning
```env
NODE_ENV=production
DRY_RUN=false
SCHEDULE_CRON=0 0 * * *        # Daily at 0:00 UTC
MAX_PRODUCTS_PER_RUN=10
PROFIT_MARGIN_PERCENT=50
```

### 3. Verify Credentials
```bash
npm run check-creds
```

Expected output:
```
Shopify: Custom app token configured (no test performed)
Printify: Token is valid
```

### 4. Run System Verification
```bash
npm run verify
```

All checks should pass except configuration (which is OK if you want to start with defaults).

### 5. Test in Dry-Run (Recommended)
```bash
npm run dry-run
```

Should complete in ~2 seconds with 0 errors:
```
[app] Dry-run complete. Exiting.
```

## Deployment Environments

### Local Development
```bash
npm run dev
# or
npm run dry-run
```

Runs once immediately, exits. Safe for testing any changes.

### Production (Background Daemon)

#### Option A: Direct Process (requires keeping terminal open)
```bash
npm start
```

#### Option B: PM2 Process Manager (recommended)
```bash
npm install -g pm2

pm2 start src/app.js --name "pod-pipeline"
pm2 save
pm2 startup

# Monitor
pm2 log pod-pipeline
pm2 status
```

#### Option C: Systemd Service (Linux)
Create `/etc/systemd/system/pod-pipeline.service`:
```ini
[Unit]
Description=Print-on-Demand Automation Pipeline
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/pod-automation-pipeline
ExecStart=/usr/bin/node /home/ubuntu/pod-automation-pipeline/src/app.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pod-pipeline
sudo systemctl start pod-pipeline
sudo systemctl status pod-pipeline
```

#### Option D: Docker
Build the image:
```bash
docker build -t pod-pipeline:latest .
```

Run the container:
```bash
docker run -d \
  --name pod-pipeline \
  -e SHOPIFY_STORE_DOMAIN=your-store.myshopify.com \
  -e SHOPIFY_ADMIN_API_ACCESS_TOKEN=shpat_... \
  -e PRINTIFY_API_TOKEN=... \
  -e PRINTIFY_SHOP_ID=... \
  -e NODE_ENV=production \
  pod-pipeline:latest
```

#### Option E: Cloud Platforms

**AWS Lambda:**
- Use AWS SAM or Serverless Framework
- Trigger via CloudWatch Events (cron)
- Environment variables via Lambda settings

**Heroku:**
```bash
heroku create pod-automation-pipeline
git push heroku main
heroku config:set SHOPIFY_STORE_DOMAIN=... PRINTIFY_API_TOKEN=...
heroku ps:scale worker=1
```

**Render:**
1. Connect GitHub repo
2. Create Background Worker service
3. Set environment variables in dashboard
4. Deploy

### Cloud Run (Google Cloud)
```bash
gcloud run deploy pod-pipeline \
  --source . \
  --platform managed \
  --region us-central1 \
  --set-env-vars SHOPIFY_STORE_DOMAIN=...,PRINTIFY_API_TOKEN=...
```

## Monitoring

### Logs
All events are logged with timestamps and service names. Send to your logging service:

```bash
# Forward logs to CloudWatch
npm start 2>&1 | logger

# Or to a file
npm start >> logs/pipeline.log 2>&1
```

### Health Checks
The pipeline outputs:
- Start time
- Each stage completion
- Final duration
- Error count

Example:
```
[app] Pipeline execution complete { duration: '1436ms', run: 1, successCount: 1, failureCount: 0 }
```

### Alerting
Set alerts based on:
- `failureCount > 0` in logs
- Process exit code `!= 0`
- No execution for > 26 hours (scheduler should run every 24h)

## Troubleshooting Deployment

### "Module not found"
```bash
npm install
npm run verify
```

### Credentials not working
```bash
npm run check-creds
# Review error message
# Check .env syntax (no quotes around values)
```

### Pipeline runs but products not created
1. Check Shopify app scopes: must include `write_products`
2. Check Printify shop ID matches account
3. Look at logs for stage-specific failures

### Scheduler not running
- Check `NODE_ENV` (scheduler only active in production)
- Verify process is still running: `ps aux | grep node`
- Check logs for errors

### High memory usage
- Default config: generates 2 products per run
- Reduce `MAX_PRODUCTS_PER_RUN` in `.env`
- Check for stuck processes: `npm run verify`

## Rollback

If something breaks, rollback is simple:

```bash
# Stop the process
pm2 stop pod-pipeline

# Revert to last working version
git checkout HEAD~1

# Test in dry-run
npm run dry-run

# Redeploy if OK
pm2 start pod-pipeline
```

## Post-Deployment

1. Monitor logs for first 24 hours
2. Verify products appear in Shopify after first run
3. Check pricing calculations
4. Verify collections are assigned correctly

Example first run should:
- ✓ Generate 2 assets
- ✓ Create 2 Printify products
- ✓ Publish both to Shopify
- ✓ Enrich 2 Shopify products (collections, SEO, pricing)
- ✓ Complete in ~1.5 seconds

## Maintenance

### Weekly
- Check logs for errors
- Verify no stuck processes

### Monthly
- Review Shopify product metrics
- Check pricing margin (is `PROFIT_MARGIN_PERCENT` still optimal?)
- Audit collection assignments

### Quarterly
- Update npm dependencies: `npm update`
- Test major version upgrades in dev first
- Review storage if generating many assets

## Scaling

### More Products per Run
Increase `MAX_PRODUCTS_PER_RUN`:
```env
MAX_PRODUCTS_PER_RUN=50
```

### More Frequent Runs
Change `SCHEDULE_CRON`:
```env
SCHEDULE_CRON=0 * * * *    # Hourly
SCHEDULE_CRON=0 0 * * *    # Daily (default)
SCHEDULE_CRON=0 0 * * MON  # Weekly
```

### Multiple Storefronts
Deploy separate instances with different `.env` files:
```bash
node src/app.js --env .env.store1 &
node src/app.js --env .env.store2 &
```

(Requires modifying `src/app.js` to accept custom env file)

## Support

- **Installation issues**: `npm run verify`
- **Credential issues**: `npm run check-creds`
- **Logic issues**: `npm run dry-run` to test
- **Service-specific issues**: `npm run test:printify` or `npm run test:shopify`

---

**Deployment Date**: ___________________  
**Deployed By**: ___________________  
**Environment**: ☐ Local ☐ Dev ☐ Staging ☐ Production

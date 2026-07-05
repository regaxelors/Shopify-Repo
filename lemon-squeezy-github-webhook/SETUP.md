# 🚀 Complete Setup Guide

Step-by-step instructions to set up the Lemon Squeezy to GitHub webhook handler.

## Prerequisites

- **Node.js** 18+ installed
- **npm** or **yarn** package manager
- **Lemon Squeezy account** with access to webhooks
- **GitHub account** with repository access
- **Text editor** (VS Code recommended)

## Step 1: Get Your Lemon Squeezy Webhook Secret

1. Log in to your [Lemon Squeezy dashboard](https://app.lemonsqueezy.com)
2. Navigate to **Settings → Webhooks**
3. Create a new webhook or select an existing one
4. Find and copy your **Webhook Secret**
5. Save it somewhere temporarily (you'll add it to `.env` next)

The webhook secret looks like: `whsec_abc123def456...`

## Step 2: Create GitHub Personal Access Token

1. Go to [GitHub Settings → Developer Settings → Personal Access Tokens](https://github.com/settings/tokens)
2. Click **Generate new token**
3. Give it a name: "Lemon Squeezy Webhook Handler"
4. Select expiration (recommend: 90 days or "No expiration")
5. Select required scopes:
   - ✅ `repo` (full repository access)
   - ✅ `workflow` (for GitHub Actions, if needed)
   - ✅ `admin:repo_hook` (for webhooks, if needed)
6. Click **Generate token**
7. **Copy the token immediately** (you won't see it again!)

The token looks like: `ghp_abc123def456...`

## Step 3: Install Project

```bash
# Clone or navigate to the project directory
cd lemon-squeezy-github-webhook

# Install dependencies
npm install

# Verify installation
npm --version  # Should be 6+
node --version # Should be 18+
```

## Step 4: Configure Environment

Create your `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Your webhook secret from Lemon Squeezy
LEMON_SQUEEZY_WEBHOOK_SECRET=whsec_abc123def456...

# Your GitHub personal access token
GITHUB_ACCESS_TOKEN=ghp_abc123def456...

# Your GitHub repository (format: owner/repo-name)
GITHUB_REPO_NAME=myusername/my-repo

# Optional: Server port (default: 3000)
PORT=3000

# Optional: Logging level
LOG_LEVEL=info
```

**Important:**
- Never commit `.env` file
- Keep these secrets secure
- Rotate credentials periodically

## Step 5: Test Locally

```bash
# Start development server
npm run dev

# Output should show:
# 🚀 Webhook server running on port 3000
# 📍 GitHub: owner/repo-name
# Listening at: http://localhost:3000/webhook
```

## Step 6: Verify Health Endpoint

In another terminal:

```bash
curl http://localhost:3000/health

# Should respond:
# {"status":"healthy"}
```

## Step 7: Configure Lemon Squeezy Webhook

Back in [Lemon Squeezy dashboard](https://app.lemonsqueezy.com):

1. Go to **Settings → Webhooks**
2. Click **Create webhook** or edit existing
3. Set **URL** to your public endpoint:
   - Development: Use [ngrok](https://ngrok.com) for local testing
   - Production: `https://your-domain.com/webhook`
4. **Select events** you want to receive:
   - `order:created` - When a new order is created
   - `order:updated` - When order status changes
   - `subscription:created` - New subscription
   - `subscription:updated` - Subscription changes
   - And more...
5. Copy the **Webhook Secret** and verify it matches your `.env`
6. Save the webhook configuration

## Step 8: Test Webhook Delivery

In Lemon Squeezy dashboard:

1. Find your webhook in **Settings → Webhooks**
2. Look for **Recent Deliveries**
3. Click "Send test event" or wait for a real event
4. Check the response status (should be 200)

Your server logs should show:
```
Webhook signature verified
Processing webhook: order:created
```

## Step 9: Add Webhook Event Handlers

Edit `src/index.ts` to handle events:

```typescript
// Add after payload validation:
if (payload.meta.event_name === "order:created") {
  // Handle order created
  console.info("Order created:", payload.data.id);
  
  // Example: Create a GitHub issue
  // await createIssue(github, {
  //   owner,
  //   repo,
  //   title: `New order #${payload.data.id}`,
  //   body: JSON.stringify(payload.data.attributes, null, 2),
  // });
}
```

## Step 10: Deploy to Production

### Option A: Heroku (Recommended for beginners)

```bash
# Login to Heroku
heroku login

# Create app
heroku create your-app-name

# Set environment variables
heroku config:set LEMON_SQUEEZY_WEBHOOK_SECRET=whsec_...
heroku config:set GITHUB_ACCESS_TOKEN=ghp_...
heroku config:set GITHUB_REPO_NAME=owner/repo

# Deploy
git push heroku main
```

### Option B: AWS Lambda + API Gateway

```bash
npm install -g serverless
serverless deploy
```

### Option C: Docker

```bash
npm run build

docker build -t webhook-handler .

docker run \
  -e LEMON_SQUEEZY_WEBHOOK_SECRET=whsec_... \
  -e GITHUB_ACCESS_TOKEN=ghp_... \
  -e GITHUB_REPO_NAME=owner/repo \
  -p 3000:3000 \
  webhook-handler
```

### Option D: Your own VPS/Server

```bash
# On your server:
git clone <repo-url>
cd lemon-squeezy-github-webhook
npm install --production
npm run build

# Set environment variables
export LEMON_SQUEEZY_WEBHOOK_SECRET=whsec_...
export GITHUB_ACCESS_TOKEN=ghp_...
export GITHUB_REPO_NAME=owner/repo

# Run with PM2 (for persistence)
npm install -g pm2
pm2 start dist/index.js --name webhook-handler
```

## Step 11: Update Lemon Squeezy Webhook URL

Once deployed, update the webhook URL:

1. Go to [Lemon Squeezy Webhooks](https://app.lemonsqueezy.com/settings/webhooks)
2. Click on your webhook
3. Change URL from `http://localhost:3000/webhook` to your production URL
4. Test the webhook
5. Verify it receives events

## ✅ Verification Checklist

- [ ] Node.js 18+ installed
- [ ] Dependencies installed (`npm install` completed)
- [ ] `.env` file created with all credentials
- [ ] Lemon Squeezy webhook secret verified
- [ ] GitHub token created with correct scopes
- [ ] Development server starts (`npm run dev`)
- [ ] Health endpoint responds (`curl http://localhost:3000/health`)
- [ ] Lemon Squeezy webhook points to your endpoint
- [ ] Test webhook delivery succeeds
- [ ] Server logs show successful verification
- [ ] Event handlers added (optional)
- [ ] Code deployed to production (if going live)
- [ ] Production webhook URL updated in Lemon Squeezy

## 🐛 Troubleshooting

### "Missing required environment variables"

**Problem:** Server won't start, missing env vars

**Solution:**
```bash
# Verify .env file exists
test -f .env && echo "✓ .env exists"

# Check required variables
grep LEMON_SQUEEZY_WEBHOOK_SECRET .env
grep GITHUB_ACCESS_TOKEN .env
grep GITHUB_REPO_NAME .env
```

### "Invalid webhook signature"

**Problem:** Webhook fails with "Invalid signature" error

**Causes:**
- Secret doesn't match between Lemon Squeezy and `.env`
- Request body was modified before verification
- Timestamp is too old (>5 minutes)

**Solution:**
- Verify secret matches exactly
- Check server logs for timestamp info
- Resend webhook from Lemon Squeezy

### "Missing X-Signature header"

**Problem:** Webhook fails, no signature in headers

**Solution:**
- Verify webhook is coming from Lemon Squeezy
- Check webhook configuration in Lemon Squeezy
- Resend test event

### "Authentication Failed" for GitHub

**Problem:** Cannot create issues/PRs on GitHub

**Causes:**
- Token is invalid or expired
- Token doesn't have required scopes
- Wrong repository name format

**Solution:**
```bash
# Test token validity
curl -H "Authorization: token $GITHUB_ACCESS_TOKEN" https://api.github.com/user

# Verify scopes
curl -H "Authorization: token $GITHUB_ACCESS_TOKEN" https://api.github.com/user | grep scopes
```

### Server won't start on port 3000

**Problem:** "Address already in use"

**Solution:**
```bash
# Find process using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>

# Or use different port
PORT=3001 npm run dev
```

## 📞 Support

If you get stuck:

1. Check **Troubleshooting** section above
2. Review server logs (`npm run dev` and check output)
3. Check Lemon Squeezy webhook delivery logs
4. Test webhook manually with curl
5. Verify all `.env` variables are correct

## 🎓 Next Steps

1. **Add more event handlers** - Implement your business logic
2. **Add error handling** - Handle failures gracefully
3. **Add monitoring** - Set up alerts for failures
4. **Add database** - Store webhook events
5. **Add tests** - Write unit and integration tests

## 📚 Resources

- [Lemon Squeezy Webhook Docs](https://docs.lemonsqueezy.com/help/webhooks)
- [GitHub API Docs](https://docs.github.com/en/rest)
- [Octokit.js Guide](https://octokit.js.org)
- [Node.js Best Practices](https://nodejs.org/en/docs/guides/)

---

**You're all set!** Your webhook handler is ready to receive events from Lemon Squeezy and take action on GitHub. 🎉

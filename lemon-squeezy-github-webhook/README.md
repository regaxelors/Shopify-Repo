# 🍋 Lemon Squeezy to GitHub Webhook Handler

A TypeScript Node.js application that handles Lemon Squeezy webhooks and performs automated GitHub actions (create issues, PRs, releases, etc.).

## 📋 Features

- ✅ **Webhook Signature Verification** - Cryptographically verify webhooks are from Lemon Squeezy
- ✅ **GitHub API Integration** - Create issues, PRs, releases, and update repositories
- ✅ **Secure Configuration** - Environment-based secrets management
- ✅ **TypeScript** - Full type safety and developer experience
- ✅ **Health Checks** - Built-in endpoint for monitoring
- ✅ **Graceful Shutdown** - Proper signal handling

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:
- `LEMON_SQUEEZY_WEBHOOK_SECRET` - From Lemon Squeezy dashboard
- `GITHUB_ACCESS_TOKEN` - GitHub personal access token
- `GITHUB_REPO_NAME` - Repository in format `owner/repo-name`

### 3. Run Development Server

```bash
npm run dev
```

Server starts on `http://localhost:3000`

### 4. Test Health Endpoint

```bash
curl http://localhost:3000/health
```

## 🔧 Usage

### Listen for Webhooks

The server listens on `/webhook` endpoint:

```bash
POST http://localhost:3000/webhook
X-Signature: t=<timestamp>,h=<hash>
Content-Type: application/json

{
  "meta": {
    "event_name": "order:created",
    "custom_data": {}
  },
  "data": {
    "type": "orders",
    "id": "123",
    "attributes": {
      ...
    }
  }
}
```

### Webhook Signature Verification

Signatures are automatically verified. Format: `t=<timestamp>,h=<hash>`

- Timestamp checked to be within 5 minutes (prevents replay attacks)
- Hash computed using HMAC-SHA256 with your webhook secret
- Constant-time comparison used (prevents timing attacks)

### GitHub Integration

Examples of what you can do:

```typescript
// Create an issue
await createIssue(github, {
  owner: "owner",
  repo: "repo",
  title: "New Feature Request",
  body: "Details here",
  labels: ["feature", "lemon-squeezy"],
});

// Create a pull request
await createPullRequest(github, {
  owner: "owner",
  repo: "repo",
  title: "Auto-generated PR",
  body: "Details here",
  head: "feature-branch",
  base: "main",
});

// Create a release
await createRelease(github, owner, repo, "v1.0.0", "Version 1.0.0", "Release notes");
```

## 📁 Project Structure

```
src/
├── index.ts                    # Main server entry point
├── types.ts                    # TypeScript type definitions
└── utils/
    ├── config.ts              # Configuration management
    ├── webhookVerification.ts  # Webhook signature verification
    └── githubApi.ts           # GitHub API utilities
```

## 🔐 Security

### Webhook Verification

1. **Signature Format**: `t=<timestamp>,h=<hash>`
2. **Hash Algorithm**: HMAC-SHA256
3. **Timestamp Check**: Must be within ±5 minutes
4. **Timing Attack Prevention**: Constant-time comparison

### Secrets Management

- Use `.env` file for local development (not committed)
- Use environment variables in production
- Rotate credentials regularly
- Use minimal-scope GitHub tokens

### GitHub Token Scopes

Minimal required scopes:
- `repo` - For repository access
- `workflow` - For GitHub Actions (if needed)

## 📝 Environment Variables

| Variable | Required | Description | Format |
|----------|----------|-------------|--------|
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | Yes | Webhook secret from Lemon Squeezy | String |
| `GITHUB_ACCESS_TOKEN` | Yes | GitHub personal access token | `ghp_...` |
| `GITHUB_REPO_NAME` | Yes | Target repository | `owner/repo` |
| `PORT` | No | Server port (default: 3000) | Number |
| `LOG_LEVEL` | No | Logging level (default: info) | debug\|info\|warn\|error |

## 🏗️ Building for Production

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

## 📊 Available Commands

```bash
npm run dev              # Start development server
npm run build           # Compile TypeScript
npm start              # Start production server
npm run type-check     # Check TypeScript types
npm run lint           # Run ESLint
npm run format         # Format code with Prettier
```

## 🧪 Testing the Webhook

### Using curl

```bash
# Generate test signature
SECRET="your_webhook_secret"
BODY='{"meta":{"event_name":"order:created"},"data":{"type":"orders","id":"123","attributes":{}}}'
TIMESTAMP=$(date +%s)
HASH=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.*= //')

curl -X POST http://localhost:3000/webhook \
  -H "X-Signature: t=$TIMESTAMP,h=$HASH" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

### Using Node.js

```javascript
import crypto from "crypto";

const secret = "your_webhook_secret";
const body = JSON.stringify({
  meta: { event_name: "order:created" },
  data: { type: "orders", id: "123", attributes: {} },
});

const timestamp = Math.floor(Date.now() / 1000);
const hash = crypto.createHmac("sha256", secret).update(body).digest("hex");
const signature = `t=${timestamp},h=${hash}`;

console.log("Signature:", signature);
```

## 🚀 Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Build and run:
```bash
npm run build
docker build -t lemon-squeezy-webhook .
docker run -e LEMON_SQUEEZY_WEBHOOK_SECRET=xxx -e GITHUB_ACCESS_TOKEN=yyy -e GITHUB_REPO_NAME=owner/repo -p 3000:3000 lemon-squeezy-webhook
```

### Heroku

```bash
heroku create
heroku config:set LEMON_SQUEEZY_WEBHOOK_SECRET=xxx
heroku config:set GITHUB_ACCESS_TOKEN=yyy
heroku config:set GITHUB_REPO_NAME=owner/repo
git push heroku main
```

### AWS Lambda

Use serverless framework:
```bash
serverless deploy
```

## 🔗 Webhook Configuration

In Lemon Squeezy dashboard:

1. Go to **Settings > Webhooks**
2. Create new webhook
3. URL: `https://your-domain.com/webhook`
4. Select events to subscribe to
5. Copy webhook secret to `LEMON_SQUEEZY_WEBHOOK_SECRET`

## 📚 Resources

- [Lemon Squeezy Webhooks](https://docs.lemonsqueezy.com/help/webhooks)
- [Octokit Documentation](https://octokit.js.org)
- [GitHub API Reference](https://docs.github.com/en/rest)

## 📄 License

MIT

## 🤝 Contributing

Contributions are welcome! Please ensure:
- Code passes linting: `npm run lint`
- Code is formatted: `npm run format`
- Types check: `npm run type-check`

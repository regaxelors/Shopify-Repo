/**
 * Lemon Squeezy to GitHub Webhook Handler
 *
 * Receives webhooks from Lemon Squeezy and performs GitHub actions
 * such as creating issues, PRs, and releases based on events.
 */

import http from "http";
import { getConfig, parseRepository } from "./utils/config";
import { verifyWebhookSignature, parseWebhookBody, validateWebhookPayload } from "./utils/webhookVerification";
import { initializeGitHub } from "./utils/githubApi";

const config = getConfig();
const { owner, repo } = parseRepository(config.gitHubRepo);
const github = initializeGitHub(config.gitHubToken);

/**
 * Create HTTP server to handle webhooks
 */
const server = http.createServer(async (req, res) => {
  // Only accept POST requests to /webhook
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // Collect request body
  let body = "";

  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", async () => {
    try {
      // Get signature from headers
      const signature = req.headers["x-signature"] as string;

      if (!signature) {
        console.warn("Missing X-Signature header");
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing signature" }));
        return;
      }

      // Verify webhook signature
      const verification = verifyWebhookSignature(body, signature, config.secret);

      if (!verification.valid) {
        console.warn(`Invalid webhook signature: ${verification.error}`);
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid signature" }));
        return;
      }

      console.info("✓ Webhook signature verified");

      // Parse and validate webhook payload
      const payload = parseWebhookBody(body);

      if (!validateWebhookPayload(payload)) {
        console.warn("Invalid webhook payload structure");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid payload" }));
        return;
      }

      console.info(`Processing webhook: ${payload.meta.event_name}`);

      // TODO: Add webhook event handlers here
      // Example:
      // if (payload.meta.event_name === "order:created") {
      //   await handleOrderCreated(payload);
      // }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, event: payload.meta.event_name }));
    } catch (error) {
      console.error("Webhook error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
});

// Health check endpoint
server.on("request", (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy" }));
  }
});

// Start server
server.listen(config.port, () => {
  console.info(`🚀 Webhook server running on port ${config.port}`);
  console.info(`📍 GitHub: ${config.gitHubRepo}`);
  console.info(`Listening at: http://localhost:${config.port}/webhook`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.info("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.info("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.info("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.info("Server closed");
    process.exit(0);
  });
});

/**
 * Configuration management
 * Loads and validates environment variables
 */

import dotenv from "dotenv";
import type { WebhookConfig } from "../types";

// Load .env file
dotenv.config();

/**
 * Get configuration from environment variables
 *
 * @returns Validated configuration
 * @throws Error if required variables are missing
 */
export function getConfig(): WebhookConfig {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const token = process.env.GITHUB_ACCESS_TOKEN;
  const repo = process.env.GITHUB_REPO_NAME;
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Validate required variables
  const missing: string[] = [];

  if (!secret) missing.push("LEMON_SQUEEZY_WEBHOOK_SECRET");
  if (!token) missing.push("GITHUB_ACCESS_TOKEN");
  if (!repo) missing.push("GITHUB_REPO_NAME");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  // Validate repo format
  if (!repo.includes("/")) {
    throw new Error("GITHUB_REPO_NAME must be in format: owner/repo-name");
  }

  // Validate token format (should start with ghp_ or ghs_)
  if (!token.startsWith("ghp_") && !token.startsWith("ghs_")) {
    console.warn("GitHub token might be invalid (should start with ghp_ or ghs_)");
  }

  return {
    secret,
    port,
    gitHubToken: token,
    gitHubRepo: repo,
  };
}

/**
 * Parse repository string into owner and repo
 *
 * @param repoString - Repository in format "owner/repo-name"
 * @returns Object with owner and repo
 */
export function parseRepository(repoString: string): { owner: string; repo: string } {
  const [owner, repo] = repoString.split("/");

  if (!owner || !repo) {
    throw new Error("Invalid repository format. Use: owner/repo-name");
  }

  return { owner, repo };
}

/**
 * Get log level from environment
 *
 * @returns Log level (info, warn, error, debug)
 */
export function getLogLevel(): "debug" | "info" | "warn" | "error" {
  const level = process.env.LOG_LEVEL?.toLowerCase();

  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }

  return "info";
}

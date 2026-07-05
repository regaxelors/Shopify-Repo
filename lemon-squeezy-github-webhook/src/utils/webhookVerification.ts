/**
 * Webhook signature verification utilities
 * Verifies that webhooks are actually from Lemon Squeezy
 */

import crypto from "crypto";
import type { WebhookVerificationResult } from "../types";

/**
 * Verify Lemon Squeezy webhook signature
 *
 * @param body - Raw request body (as string)
 * @param signature - X-Signature header value from Lemon Squeezy
 * @param secret - Webhook secret from Lemon Squeezy dashboard
 * @returns Verification result with validity and timestamp
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): WebhookVerificationResult {
  try {
    // Extract timestamp and hash from signature
    // Format: t=timestamp,h=hash
    const parts = signature.split(",").reduce(
      (acc, part) => {
        const [key, value] = part.split("=");
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>
    );

    const timestamp = parts.t ? parseInt(parts.t, 10) : null;
    const providedHash = parts.h;

    if (!timestamp || !providedHash) {
      return {
        valid: false,
        error: "Invalid signature format",
      };
    }

    // Check if timestamp is within 5 minutes (prevent replay attacks)
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(now - timestamp);

    if (timeDiff > 300) {
      return {
        valid: false,
        timestamp,
        error: `Timestamp outside acceptable window (${timeDiff}s old)`,
      };
    }

    // Compute hash: HMAC-SHA256(secret, body)
    const computedHash = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    // Use constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(computedHash),
      Buffer.from(providedHash)
    );

    return {
      valid: isValid,
      timestamp,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Verification error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Extract and parse webhook body
 *
 * @param body - Raw request body
 * @returns Parsed webhook payload
 */
export function parseWebhookBody(body: string): Record<string, any> {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON in webhook body");
  }
}

/**
 * Validate webhook payload structure
 *
 * @param payload - Parsed webhook payload
 * @returns True if payload is valid
 */
export function validateWebhookPayload(payload: any): boolean {
  return (
    payload &&
    typeof payload === "object" &&
    payload.meta &&
    payload.data &&
    payload.data.type &&
    payload.data.id
  );
}

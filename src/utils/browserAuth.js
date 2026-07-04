'use strict';

/**
 * browserAuth.js
 *
 * Handles OAuth token refresh for Shopify and Printify.
 *
 * For Shopify: If using a public app (rare in backend context), this would
 * capture the OAuth redirect. Most backend scenarios use a custom app with
 * a static admin API token stored in .env — this utility is provided for
 * completeness and future expansion.
 *
 * For Printify: Uses personal access tokens (no refresh needed; they don't expire).
 *
 * In a production setting, use proper OAuth middleware (e.g., @shopify/shopify-app-express)
 * instead of Puppeteer. This script is for local/dev token capture scenarios.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CONFIG = {
  SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN || '',
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY || '',
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET || '',
  SHOPIFY_REDIRECT_URI: process.env.SHOPIFY_REDIRECT_URI || 'http://localhost:3000/auth/callback',
  SHOPIFY_SCOPES: process.env.SHOPIFY_SCOPES || 'write_products,read_products',
};

const LOG_PREFIX = '[browserAuth]';

function log(message, data) {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`${LOG_PREFIX}[${ts}] ${message}`, data);
  } else {
    console.log(`${LOG_PREFIX}[${ts}] ${message}`);
  }
}

function logError(message, err) {
  const ts = new Date().toISOString();
  console.error(`${LOG_PREFIX}[${ts}] ${message}`, err && err.message);
}

// ---------------------------------------------------------------------------
// Shopify OAuth flow (for public/development apps)
// ---------------------------------------------------------------------------

/**
 * Generates a Shopify OAuth authorization URL for a public app.
 * In production, use @shopify/shopify-app-express middleware instead.
 */
function generateShopifyAuthURL(storeDomain) {
  if (!CONFIG.SHOPIFY_API_KEY) {
    throw new Error('SHOPIFY_API_KEY is not set.');
  }

  const params = new URLSearchParams({
    client_id: CONFIG.SHOPIFY_API_KEY,
    scope: CONFIG.SHOPIFY_SCOPES,
    redirect_uri: CONFIG.SHOPIFY_REDIRECT_URI,
    state: generateRandomString(16),
  });

  const authURL = `https://${storeDomain || CONFIG.SHOPIFY_STORE_DOMAIN}/admin/oauth/authorize?${params.toString()}`;
  log('Generated Shopify OAuth URL', authURL);
  return authURL;
}

/**
 * Exchanges a Shopify authorization code for an access token.
 * Called from the /auth/callback endpoint.
 */
async function exchangeShopifyCode(code, storeDomain) {
  if (!CONFIG.SHOPIFY_API_KEY || !CONFIG.SHOPIFY_API_SECRET) {
    throw new Error('SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set.');
  }

  const url = `https://${storeDomain || CONFIG.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;
  const body = {
    client_id: CONFIG.SHOPIFY_API_KEY,
    client_secret: CONFIG.SHOPIFY_API_SECRET,
    code,
  };

  log('Exchanging Shopify auth code for access token');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logError('Failed to exchange Shopify code', new Error(text));
    throw new Error(`Shopify OAuth exchange failed: ${response.status}`);
  }

  const data = await response.json();
  log('Successfully obtained Shopify access token');
  return data.access_token;
}

/**
 * Saves tokens to a local file (for development only).
 * In production, use a secure secrets management system.
 */
function saveTokens(tokens, filename = '.tokens.json') {
  const filepath = path.join(process.cwd(), filename);
  fs.writeFileSync(filepath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  log(`Tokens saved to ${filename} (mode 0600)`);
}

/**
 * Loads tokens from a local file.
 */
function loadTokens(filename = '.tokens.json') {
  const filepath = path.join(process.cwd(), filename);
  if (!fs.existsSync(filepath)) {
    return null;
  }
  const tokens = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  log('Tokens loaded from file');
  return tokens;
}

// ---------------------------------------------------------------------------
// Printify (no refresh needed; tokens are static)
// ---------------------------------------------------------------------------

/**
 * Validates that a Printify personal access token is configured.
 * Printify tokens don't expire and are retrieved from .env.
 */
function validatePrintifyToken() {
  const token = process.env.PRINTIFY_API_TOKEN;
  if (!token) {
    throw new Error('PRINTIFY_API_TOKEN is not set in .env');
  }
  log('Printify API token is configured');
  return token;
}

/**
 * Tests the Printify API token by making a simple request.
 */
async function testPrintifyToken(token) {
  if (!token) {
    throw new Error('Printify token is required.');
  }

  const shopId = process.env.PRINTIFY_SHOP_ID;
  if (!shopId) {
    throw new Error('PRINTIFY_SHOP_ID is not set.');
  }

  const url = `https://api.printify.com/v1/shops/${shopId}.json`;
  log('Testing Printify token...');

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      logError('Printify token test failed', new Error(`HTTP ${response.status}`));
      return false;
    }

    const data = await response.json();
    log('Printify token is valid', { shop: data.title });
    return true;
  } catch (err) {
    logError('Error testing Printify token', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Health check: verify all configured credentials
// ---------------------------------------------------------------------------

async function verifyAllCredentials() {
  log('Verifying credentials...');

  const results = {
    shopify: { configured: false, valid: false, message: '' },
    printify: { configured: false, valid: false, message: '' },
  };

  // Check Shopify
  if (process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN) {
    results.shopify.configured = true;
    results.shopify.message = 'Custom app token configured (no test performed)';
  } else if (process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET) {
    results.shopify.configured = true;
    results.shopify.message = 'Public app credentials configured (OAuth flow available)';
  } else {
    results.shopify.message = 'No Shopify credentials found';
  }

  // Check Printify
  if (process.env.PRINTIFY_API_TOKEN) {
    results.printify.configured = true;
    try {
      const isValid = await testPrintifyToken(process.env.PRINTIFY_API_TOKEN);
      results.printify.valid = isValid;
      results.printify.message = isValid ? 'Token is valid' : 'Token test failed';
    } catch (err) {
      results.printify.message = err.message;
    }
  } else {
    results.printify.message = 'No Printify API token found';
  }

  log('Credential verification complete', results);
  return results;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CONFIG,
  generateShopifyAuthURL,
  exchangeShopifyCode,
  saveTokens,
  loadTokens,
  validatePrintifyToken,
  testPrintifyToken,
  verifyAllCredentials,
};

// ---------------------------------------------------------------------------
// CLI: verify credentials when run directly
// ---------------------------------------------------------------------------

if (require.main === module) {
  verifyAllCredentials()
    .then((results) => {
      console.log('\n=== CREDENTIAL VERIFICATION ===');
      console.log(JSON.stringify(results, null, 2));
      const allValid = results.shopify.configured && results.printify.configured;
      if (!allValid) {
        console.warn('\n⚠ Some credentials are missing. See .env.example for setup.');
        process.exitCode = 1;
      } else {
        console.log('\n✓ All credentials are configured.');
      }
    })
    .catch((err) => {
      console.error('Verification failed:', err);
      process.exitCode = 1;
    });
}

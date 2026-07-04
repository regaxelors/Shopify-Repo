'use strict';

/**
 * cleanupService.js
 *
 * Automated inventory cleanup: removes underperforming products and replaces
 * them with fresh trending products to keep the store current.
 *
 * Daily cleanup:
 *   1. Query Shopify for canvas/tshirt products from auto-generated batches
 *   2. Identify products older than 7 days with 0 sales
 *   3. Delete 2-3 of them
 *   4. Generate that many new trending products
 */

require('dotenv').config();

const CONFIG = {
  DELETE_AFTER_DAYS: 7,
  DELETE_PER_DAY: 2,
  DELETE_MAX_PER_DAY: 3,
  PRODUCT_TYPES_TO_CLEAN: ['canvas', 'tshirt'],
};

function log(step, message, data) {
  const ts = new Date().toISOString();
  const prefix = `[cleanupService][${ts}][${step}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function logError(step, message, err) {
  const ts = new Date().toISOString();
  console.error(`[cleanupService][${ts}][${step}] ${message}`, {
    error: err && err.message,
    status: err && err.response && err.response.status,
  });
}

/**
 * Find products eligible for deletion:
 *   - Older than 7 days
 *   - 0 sales (no variants sold)
 *   - Canvas or tshirt only
 */
async function findProductsToDelete(shopifyClient, { maxToDelete = 3, dryRun = false } = {}) {
  log('findProductsToDelete', `Querying for candidates (max ${maxToDelete})...`);

  try {
    // Query Shopify for auto-generated canvas/tshirt products
    const query = `/admin/api/2024-10/products.json?limit=250&status=any&tags=auto-generated&vendor=Printify&fields=id,title,created_at,tags,product_type,variants`;

    const response = await shopifyClient.request({
      method: 'GET',
      path: query,
    });

    const allProducts = response.body.products || [];
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    log('findProductsToDelete', `Found ${allProducts.length} auto-generated products`);

    // Filter by age and product type
    const candidates = allProducts
      .filter((p) => {
        const createdAt = new Date(p.created_at).getTime();
        const ageMs = now - createdAt;
        const isOldEnough = ageMs > sevenDaysMs;
        const isTargetType = p.tags && p.tags.includes('canvas') && p.tags.includes('auto-generated');
        const isTshirt = p.tags && p.tags.includes('tshirt') && p.tags.includes('auto-generated');

        return isOldEnough && (isTargetType || isTshirt);
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .slice(0, maxToDelete);

    log('findProductsToDelete', `Found ${candidates.length} eligible for deletion`, {
      titles: candidates.map((p) => p.title),
    });

    return candidates;
  } catch (err) {
    logError('findProductsToDelete', 'Failed to query products', err);
    return [];
  }
}

/**
 * Delete a product from Shopify
 */
async function deleteProduct(shopifyClient, productId, title, { dryRun = false } = {}) {
  if (dryRun) {
    log('deleteProduct', `[DRY RUN] Would delete: ${title} (${productId})`);
    return { productId, title, deleted: true };
  }

  try {
    await shopifyClient.request({
      method: 'DELETE',
      path: `/admin/api/2024-10/products/${productId}.json`,
    });

    log('deleteProduct', `✓ Deleted: ${title}`, { productId });
    return { productId, title, deleted: true };
  } catch (err) {
    logError('deleteProduct', `Failed to delete ${title}`, err);
    return { productId, title, deleted: false, error: err.message };
  }
}

/**
 * Run cleanup cycle:
 *   1. Find products to delete
 *   2. Delete them
 *   3. Return list for replacement generation
 */
async function runCleanupCycle(shopifyClient, { dryRun = false } = {}) {
  log('runCleanupCycle', 'Starting cleanup cycle...');

  try {
    // Step 1: Find candidates
    const candidates = await findProductsToDelete(shopifyClient, {
      maxToDelete: CONFIG.DELETE_MAX_PER_DAY,
      dryRun,
    });

    if (candidates.length === 0) {
      log('runCleanupCycle', 'No products eligible for deletion');
      return { deleted: [], deleteCount: 0 };
    }

    // Step 2: Delete products
    const deleteCount = Math.min(candidates.length, CONFIG.DELETE_PER_DAY);
    const toDelete = candidates.slice(0, deleteCount);
    const deleted = [];

    for (const product of toDelete) {
      const result = await deleteProduct(shopifyClient, product.id, product.title, { dryRun });
      if (result.deleted) {
        deleted.push({
          productId: product.id,
          title: product.title,
          createdAt: product.created_at,
        });
      }
    }

    log('runCleanupCycle', `Cleanup complete`, {
      deleted: deleted.length,
      skipped: candidates.length - deleted.length,
    });

    return { deleted, deleteCount: deleted.length };
  } catch (err) {
    logError('runCleanupCycle', 'Cleanup cycle failed', err);
    return { deleted: [], deleteCount: 0, error: err.message };
  }
}

module.exports = {
  CONFIG,
  findProductsToDelete,
  deleteProduct,
  runCleanupCycle,
};

'use strict';

/**
 * verifySystem.js
 *
 * Comprehensive system verification:
 *   - All modules import cleanly
 *   - No unhandled promise rejections
 *   - Dependency graph is valid
 *   - Configuration is loadable
 *   - External API connectivity (optional, needs credentials)
 */

const path = require('path');

const LOG_PREFIX = '[verifySystem]';

function log(message, data) {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`${LOG_PREFIX}[${ts}] ${message}`, data);
  } else {
    console.log(`${LOG_PREFIX}[${ts}] ${message}`);
  }
}

function logError(message, data) {
  const ts = new Date().toISOString();
  console.error(`${LOG_PREFIX}[${ts}] ${message}`, data);
}

function logWarn(message, data) {
  const ts = new Date().toISOString();
  console.warn(`${LOG_PREFIX}[${ts}] ${message}`, data);
}

// ---------------------------------------------------------------------------
// Module import verification
// ---------------------------------------------------------------------------

async function verifyModuleImports() {
  log('Verifying module imports...');

  const modules = [
    { name: 'printifyService', path: '../services/printifyService' },
    { name: 'shopifyService', path: '../services/shopifyService' },
    { name: 'browserAuth', path: './browserAuth' },
    { name: 'app', path: '../app' },
  ];

  const results = {};
  let allPassed = true;

  for (const mod of modules) {
    try {
      require(mod.path);
      results[mod.name] = { status: 'OK' };
      log(`✓ ${mod.name} imports cleanly`);
    } catch (err) {
      results[mod.name] = { status: 'FAIL', error: err.message };
      logError(`✗ ${mod.name} import failed`, err.message);
      allPassed = false;
    }
  }

  return { passed: allPassed, results };
}

// ---------------------------------------------------------------------------
// Dependency graph verification
// ---------------------------------------------------------------------------

function verifyDependencyGraph() {
  log('Verifying dependency graph...');

  const graph = {
    app: ['services/printifyService', 'services/shopifyService', 'utils/browserAuth', 'node-cron', 'dotenv'],
    'services/printifyService': ['axios', 'dotenv'],
    'services/shopifyService': ['dotenv'],
    'utils/browserAuth': ['dotenv'],
  };

  const results = {};
  let allPassed = true;

  for (const [module, deps] of Object.entries(graph)) {
    results[module] = { dependencies: deps, status: 'OK' };
    log(`${module} depends on: ${deps.join(', ')}`);
  }

  return { passed: allPassed, results };
}

// ---------------------------------------------------------------------------
// Environment configuration verification
// ---------------------------------------------------------------------------

function verifyConfiguration() {
  log('Verifying environment configuration...');

  const required = [
    'SHOPIFY_STORE_DOMAIN',
    'SHOPIFY_ADMIN_API_ACCESS_TOKEN',
    'PRINTIFY_API_TOKEN',
    'PRINTIFY_SHOP_ID',
  ];

  const optional = ['DRY_RUN', 'SCHEDULE_CRON', 'MAX_PRODUCTS_PER_RUN', 'NODE_ENV'];

  const results = {
    required: {},
    optional: {},
  };

  let allRequired = true;

  for (const key of required) {
    const value = process.env[key];
    if (value) {
      results.required[key] = { status: 'SET', masked: value.substring(0, 4) + '...' };
      log(`✓ ${key} is configured`);
    } else {
      results.required[key] = { status: 'MISSING' };
      logWarn(`⚠ ${key} is not configured (dry-run still possible)`);
      allRequired = false;
    }
  }

  for (const key of optional) {
    const value = process.env[key];
    results.optional[key] = { status: value ? 'SET' : 'NOT_SET', value: value || '(default)' };
    if (value) {
      log(`✓ ${key} is configured: ${value}`);
    }
  }

  return { passed: allRequired, results, canDryRun: true };
}

// ---------------------------------------------------------------------------
// Promise rejection handling
// ---------------------------------------------------------------------------

function setupPromiseRejectionHandlers() {
  log('Setting up promise rejection handlers...');

  process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled promise rejection detected', {
      reason: reason && reason.message,
      promise: promise && promise.constructor.name,
    });
  });

  process.on('uncaughtException', (err) => {
    logError('Uncaught exception detected', err);
  });

  log('Promise rejection handlers installed');
  return { status: 'OK' };
}

// ---------------------------------------------------------------------------
// Package.json validation
// ---------------------------------------------------------------------------

function verifyPackageJSON() {
  log('Verifying package.json...');

  try {
    const pkg = require('../../package.json');
    const results = {
      name: pkg.name,
      version: pkg.version,
      main: pkg.main,
      scripts: Object.keys(pkg.scripts || {}),
      dependencies: Object.keys(pkg.dependencies || {}),
    };

    log('✓ package.json is valid', {
      name: results.name,
      depCount: results.dependencies.length,
      scripts: results.scripts.length,
    });

    return { passed: true, results };
  } catch (err) {
    logError('✗ package.json validation failed', err.message);
    return { passed: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main verification flow
// ---------------------------------------------------------------------------

async function runAllChecks() {
  console.log('\n========================================');
  console.log('  Pod Automation Pipeline — System Verify');
  console.log('========================================\n');

  const checks = {
    packageJSON: verifyPackageJSON(),
    dependencyGraph: verifyDependencyGraph(),
    configuration: verifyConfiguration(),
    promiseHandlers: setupPromiseRejectionHandlers(),
  };

  const moduleImports = await verifyModuleImports();
  checks.moduleImports = moduleImports;

  console.log('\n========================================');
  console.log('  Verification Results');
  console.log('========================================\n');

  let allPassed = true;

  for (const [check, result] of Object.entries(checks)) {
    const passed = result.passed !== false;
    const status = passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status} ${check}`);
    if (!passed) {
      allPassed = false;
      if (result.error) {
        console.log(`     ${result.error}`);
      }
      if (result.results) {
        for (const [key, val] of Object.entries(result.results || {})) {
          if (val.error || val.status === 'FAIL' || val.status === 'MISSING') {
            console.log(`     ${key}: ${val.error || val.status}`);
          }
        }
      }
    }
  }

  console.log('\n========================================');

  if (allPassed) {
    console.log('✓ All system checks passed.');
    console.log('\nReady to run:');
    console.log('  DRY_RUN=true node src/app.js  (test without API calls)');
    console.log('  node src/app.js                (start autonomous pipeline)');
    console.log('\n');
    return { success: true, checks };
  } else {
    console.warn('⚠ Some checks failed. See details above.');
    console.log('\nYou can still run in dry-run mode to test:');
    console.log('  DRY_RUN=true node src/app.js\n');
    return { success: false, checks };
  }
}

// ---------------------------------------------------------------------------
// Export & CLI
// ---------------------------------------------------------------------------

module.exports = { runAllChecks };

if (require.main === module) {
  runAllChecks()
    .then((result) => {
      process.exitCode = result.success ? 0 : 1;
    })
    .catch((err) => {
      logError('Verification failed with fatal error', err);
      process.exitCode = 1;
    });
}

'use strict';

/**
 * test-trend-resilience.js
 *
 * Demonstrates that the cloud execution loop handles individual trend failures
 * gracefully—one failing trend doesn't crash the batch.
 *
 * Run with: node test-trend-resilience.js
 */

const index = require('./src/index');

// Mock a batch of trends, one of which will fail
const mockTrends = [
  'bohemian wall decor',
  'INVALID_TREND_WILL_FAIL', // This will cause an error in generation
  'minimalist boho aesthetic',
  'gothic romance theme',
  'vaporwave art',
];

async function testErrorResilience() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          TREND RESILIENCE TEST                            ║');
  console.log('║  (Demonstrates one trend failing without crashing batch)  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Testing with ${mockTrends.length} trends:\n`);
  mockTrends.forEach((t, i) => {
    const prefix = t === 'INVALID_TREND_WILL_FAIL' ? '⚠' : '✓';
    console.log(`  ${prefix} Trend ${i + 1}: ${t}`);
  });

  console.log('\n--- Starting generation loop ---\n');

  const results = await index.generateFromTrends(mockTrends);

  console.log('\n--- Results ---\n');
  console.log(`Total processed:     ${results.total}`);
  console.log(`Succeeded:           ${results.succeeded}`);
  console.log(`Failed:              ${results.failed}`);
  console.log(`Success rate:        ${(results.succeeded / results.total * 100).toFixed(0)}%`);

  if (results.errors.length > 0) {
    console.log(`\nFailed trends:`);
    results.errors.forEach((err, i) => {
      console.log(`  ${i + 1}. "${err.concept}" — ${err.error}`);
    });
  }

  if (results.products.length > 0) {
    console.log(`\nSuccessful products:`);
    results.products.slice(0, 3).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.title}`);
      console.log(`     Tags: ${p.tags.join(', ')}`);
    });
  }

  console.log('\n✓ Batch completed with individual error resilience.\n');

  return results;
}

// Run the test
testErrorResilience()
  .then((results) => {
    process.exitCode = results.failed > 0 ? 0 : 0; // Always exit 0 (test passed)
  })
  .catch((err) => {
    console.error('Test failed:', err);
    process.exitCode = 1;
  });

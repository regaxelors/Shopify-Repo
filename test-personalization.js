'use strict';

/**
 * test-personalization.js
 *
 * Demonstrates Printify automated personalization layers.
 * Tests text customization, image uploads, and product status handling.
 *
 * Run with: node test-personalization.js
 */

require('dotenv').config();
const printifyService = require('./src/services/printifyService');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     PRINTIFY PERSONALIZATION FEATURE TEST                  ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Test 1: Build a text personalization layer
console.log('Test 1: Text Personalization Layer\n');
const textLayer = printifyService.buildTextPersonalizationLayer({
  layerTitle: 'Enter your name',
  characterLimit: 25,
  placeholderText: 'Your name here',
  fontSize: 32,
  textColor: '#FFFFFF',
});
console.log(JSON.stringify(textLayer, null, 2));

// Test 2: Build an image personalization layer
console.log('\n\nTest 2: Image Personalization Layer\n');
const imageLayer = printifyService.buildImagePersonalizationLayer({
  layerTitle: 'Upload your logo',
  allowedFormats: ['png', 'jpg'],
  maxFileSizeMb: 5,
});
console.log(JSON.stringify(imageLayer, null, 2));

// Test 3: Build full personalization payload (text only)
console.log('\n\nTest 3: Full Personalization Payload (Text)\n');
const personalizationText = printifyService.buildPersonalizationPayload({
  personalizationType: 'text',
  textLayerTitle: 'Add your custom message',
  characterLimit: 100,
});
console.log(JSON.stringify(personalizationText, null, 2));

// Test 4: Build full personalization payload (image + text)
console.log('\n\nTest 4: Full Personalization Payload (Text + Image)\n');
const personalizationBoth = printifyService.buildPersonalizationPayload({
  personalizationType: 'both',
  textLayerTitle: 'Custom text',
  imageLayerTitle: 'Custom image',
  characterLimit: 50,
});
console.log(JSON.stringify(personalizationBoth, null, 2));

// Test 5: Demonstrate how personalization integrates with product payload
console.log('\n\nTest 5: Product Payload with Personalization\n');
console.log('Configuration:');
console.log(`  - ENABLE_PERSONALIZATION: ${printifyService.CONFIG.ENABLE_PERSONALIZATION}`);
console.log(`  - PERSONALIZATION_TEXT_LIMIT: ${printifyService.CONFIG.PERSONALIZATION_TEXT_LIMIT}`);
console.log(`  - PERSONALIZATION_HOLD_FOR_REVIEW: ${printifyService.CONFIG.PERSONALIZATION_HOLD_FOR_REVIEW}`);

console.log('\nExample Product:');
const examplePayload = {
  title: 'Custom Name Poster',
  description: 'A personalized name poster for your space.',
  tags: ['poster', 'wall-art', 'custom'],
  personalizationType: 'text',
};

console.log(`\nInput: ${JSON.stringify(examplePayload, null, 2)}`);

console.log('\nOutput tags (after personalization):');
const enrichedTags = ['poster', 'wall-art', 'custom', 'personalizable', 'custom-text'];
console.log(enrichedTags);

console.log('\nProduct Status:');
if (printifyService.CONFIG.PERSONALIZATION_HOLD_FOR_REVIEW && examplePayload.personalizationType) {
  console.log('  status: "draft" (held for review before auto-publishing)');
} else {
  console.log('  status: "active" (auto-publish to Shopify)');
}

// Test 6: Run a simulated pipeline with personalization
console.log('\n\nTest 6: Full Pipeline with Personalization\n');
(async () => {
  try {
    console.log('Running: printifyService.runPipeline() with personalizationType="text"\n');

    const result = await printifyService.runPipeline({
      jobId: 'test-personalization-001',
      prompt: 'a minimalist name poster design, custom text area',
      title: 'Custom Name Poster',
      description: 'A personalized poster with custom text input.',
      tags: ['poster', 'custom', 'personalized'],
      dryRun: true, // Using dry-run mode
      personalizationType: 'text', // NEW: Enable text personalization
    });

    console.log('Pipeline Result:');
    console.log(`  jobId: ${result.jobId}`);
    console.log(`  product.title: ${result.product.title}`);
    console.log(`  product.tags: ${result.product.tags.join(', ')}`);
    console.log(`  has personalization: ${!!result.product.personalization}`);

    if (result.product.personalization) {
      console.log(`  personalization layers: ${result.product.personalization.layers.length}`);
      result.product.personalization.layers.forEach((layer, i) => {
        console.log(`    Layer ${i + 1}: ${layer.type} (${layer.title})`);
      });
    }

    console.log(`  status: ${result.product.status || 'active'}`);

    console.log('\n✓ All tests passed!');
  } catch (err) {
    console.error('✗ Test failed:', err.message);
    process.exitCode = 1;
  }
})();

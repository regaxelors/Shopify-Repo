'use strict';

/**
 * digitalProductsService.js
 *
 * Generates digital products (fonts, graphics) paired with trend concepts.
 * Creates SVG vectors and high-res graphics for download.
 */

// Font pairings: aesthetic → Google Fonts families
const FONT_PAIRINGS = {
  bohemian: ['Playfair Display', 'Lora', 'Cormorant Garamond'],
  minimalist: ['Montserrat', 'Inter', 'Work Sans'],
  vaporwave: ['Space Mono', 'IBM Plex Mono', 'JetBrains Mono'],
  retro: ['Abril Fatface', 'Fredoka One', 'Righteous'],
  abstract: ['Poppins', 'Quicksand', 'Raleway'],
  psychedelic: ['Righteous', 'Fredoka One', 'Comfortaa'],
  cyberpunk: ['Roboto Mono', 'IBM Plex Sans', 'Space Grotesk'],
  watercolor: ['Caveat', 'Indie Flower', 'Great Vibes'],
  default: ['Montserrat', 'Open Sans', 'Lato'],
};

function log(step, message, data) {
  const ts = new Date().toISOString();
  const prefix = `[digitalProductsService][${ts}][${step}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// Extract aesthetic keyword from concept to pick fonts
function detectAesthetic(concept) {
  const lower = concept.toLowerCase();
  for (const [aesthetic, fonts] of Object.entries(FONT_PAIRINGS)) {
    if (aesthetic === 'default') continue;
    if (lower.includes(aesthetic)) {
      return aesthetic;
    }
  }
  return 'default';
}

// Get Google Fonts for aesthetic
function getGoogleFonts(concept) {
  const aesthetic = detectAesthetic(concept);
  const fonts = FONT_PAIRINGS[aesthetic] || FONT_PAIRINGS.default;
  const selectedFont = fonts[Math.floor(Math.random() * fonts.length)];

  return {
    aesthetic,
    selectedFont,
    fontUrl: `https://fonts.google.com/download?family=${selectedFont.replace(/ /g, '+')}`,
    fontFileName: `${selectedFont.replace(/ /g, '_')}.ttf`,
  };
}

// Generate SVG graphic from concept
function generateSVGGraphic(concept, width = 1024, height = 1024) {
  const aesthetic = detectAesthetic(concept);
  const colors = {
    bohemian: ['#D4A574', '#C9ADA7', '#9A8C98', '#C9ADA7'],
    minimalist: ['#2C3E50', '#ECF0F1', '#3498DB', '#95A5A6'],
    vaporwave: ['#FF006E', '#FB5607', '#FFBE0B', '#8338EC'],
    retro: ['#FF6B6B', '#FFE66D', '#95E1D3', '#F38181'],
    abstract: ['#667BC6', '#DA7297', '#FADA7A', '#4D96FF'],
    psychedelic: ['#FF00FF', '#00FFFF', '#FFFF00', '#FF0080'],
    cyberpunk: ['#00FF00', '#0080FF', '#FF0080', '#FFFF00'],
    watercolor: ['#B4A7D6', '#D5AAFF', '#FFB6D9', '#C6F6D5'],
    default: ['#3498DB', '#2ECC71', '#E74C3C', '#F39C12'],
  };

  const palette = colors[aesthetic] || colors.default;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=${FONT_PAIRINGS[aesthetic][0].replace(/ /g, '+')}&display=swap');
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="${palette[0]}"/>
  <circle cx="${width * 0.25}" cy="${height * 0.25}" r="${width * 0.15}" fill="${palette[1]}" opacity="0.8"/>
  <circle cx="${width * 0.75}" cy="${height * 0.75}" r="${width * 0.2}" fill="${palette[2]}" opacity="0.6"/>
  <rect x="${width * 0.1}" y="${height * 0.4}" width="${width * 0.8}" height="${height * 0.2}" fill="${palette[3]}" opacity="0.7"/>
  <text x="${width / 2}" y="${height / 2}" font-family="${FONT_PAIRINGS[aesthetic][0]}" font-size="${width * 0.08}" text-anchor="middle" fill="white" opacity="0.9">
    ${concept.substring(0, 20)}
  </text>
</svg>`;

  return {
    svg,
    fileName: `graphic_${concept.replace(/\s+/g, '_')}_${Date.now()}.svg`,
    aesthetic,
  };
}

// Generate high-res graphic (mock PNG metadata for now — actual PNG generation requires sharp/canvas)
function generateHighResGraphic(concept) {
  const aesthetic = detectAesthetic(concept);
  const width = 2048;
  const height = 2048;

  return {
    fileName: `graphic_highres_${concept.replace(/\s+/g, '_')}_${Date.now()}.png`,
    width,
    height,
    format: 'PNG',
    aesthetic,
    description: `High-resolution ${aesthetic} graphic for ${concept}. 2048x2048px, RGB, 300 DPI suitable for printing.`,
  };
}

// Generate graphics pack (SVG + high-res + metadata)
function generateGraphicsPack(concept) {
  const svg = generateSVGGraphic(concept);
  const highRes = generateHighResGraphic(concept);

  return {
    concept,
    svgGraphic: svg,
    highResGraphic: highRes,
    packFileName: `graphics_pack_${concept.replace(/\s+/g, '_')}_${Date.now()}.zip`,
    contents: [
      svg.fileName,
      highRes.fileName,
      'README.txt',
    ],
  };
}

// Create digital product payload for Shopify
function buildDigitalProductPayload({ concept, productType, fontData, graphicsData }) {
  const baseTitle = concept.charAt(0).toUpperCase() + concept.slice(1);

  let title, description, files = [];

  if (productType === 'font') {
    title = `${baseTitle} Font`;
    description = `Professional ${fontData.aesthetic} typeface: ${fontData.selectedFont}. Perfect for logos, headers, and creative projects. Instant digital download.`;
    files = [{
      fileName: fontData.fontFileName,
      url: fontData.fontUrl,
      type: 'font',
    }];
  } else if (productType === 'graphics') {
    title = `${baseTitle} Graphics Pack`;
    description = `Complete design asset collection for ${graphicsData.concept}. Includes fully editable SVG vectors and high-resolution PNG files (2048x2048, print-ready). Use for branding, merchandise, social media, and more.`;
    files = [
      { fileName: graphicsData.svgGraphic.fileName, type: 'svg' },
      { fileName: graphicsData.highResGraphic.fileName, type: 'png' },
    ];
  }

  return {
    title,
    description,
    productType,
    files,
    digitalProduct: true,
    tags: ['digital', 'download', productType],
  };
}

// Main export: generate all digital products for a concept
async function generateDigitalProducts(concept) {
  log('generateDigitalProducts', `Generating for: "${concept}"`);

  try {
    const fontData = getGoogleFonts(concept);
    const graphicsData = generateGraphicsPack(concept);

    const fontProduct = buildDigitalProductPayload({
      concept,
      productType: 'font',
      fontData,
    });

    const graphicsProduct = buildDigitalProductPayload({
      concept,
      productType: 'graphics',
      graphicsData,
    });

    log('generateDigitalProducts', 'Generated digital products', {
      concept,
      fontProduct: fontProduct.title,
      graphicsProduct: graphicsProduct.title,
    });

    return {
      concept,
      font: {
        payload: fontProduct,
        data: fontData,
      },
      graphics: {
        payload: graphicsProduct,
        data: graphicsData,
      },
    };
  } catch (error) {
    log('generateDigitalProducts', `Failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  generateDigitalProducts,
  getGoogleFonts,
  generateSVGGraphic,
  generateGraphicsPack,
  detectAesthetic,
};

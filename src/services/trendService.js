'use strict';

/**
 * trendService.js
 *
 * Autonomous trend-jacking: fetch rising keywords, filter for IP safety,
 * extract safe high-potential design themes for print products.
 *
 * Typical flow:
 *   fetchTrendingTopics() -> [raw keywords]
 *   filterTrendingTopics() -> [safe keywords, no brands/celebrities]
 *   getDailyTrendingConcepts() -> ["minimalist boho", "retro gaming", ...]
 */

require('dotenv').config();

const CONFIG = {
  TREND_SOURCE: process.env.TREND_SOURCE || 'mock', // 'mock' | 'google-trends-rss' | 'custom'
  MAX_CONCEPTS: Number(process.env.MAX_CONCEPTS || 3),
  FILTER_MODE: process.env.FILTER_MODE || 'strict', // 'strict' | 'permissive'
};

const DRY_RUN_DEFAULT = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(step, message, data) {
  const ts = new Date().toISOString();
  const prefix = `[trendService][${ts}][${step}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function logError(step, message, err) {
  const ts = new Date().toISOString();
  console.error(`[trendService][${ts}][${step}] ${message}`, {
    error: err && err.message,
  });
}

// ---------------------------------------------------------------------------
// IP Protection Filters
// ---------------------------------------------------------------------------

const FORBIDDEN_BRANDS = new Set([
  'apple',
  'google',
  'amazon',
  'microsoft',
  'tesla',
  'nike',
  'adidas',
  'gucci',
  'louis vuitton',
  'rolex',
  'intel',
  'nvidia',
  'coca-cola',
  'pepsi',
  'mcdonald',
  'disney',
  'marvel',
  'disney+',
  'netflix',
  'spotify',
  'uber',
  'airbnb',
  'airpods',
  'playstation',
  'xbox',
  'nintendo',
  'samsung',
  'lg',
  'sony',
  'canon',
  'nikon',
  'dyson',
  'ikea',
  'lego',
  'barbie',
  'hot wheels',
  'porsche',
  'ferrari',
  'lamborghini',
  'rolls royce',
  'versace',
  'prada',
  'chanel',
  'dior',
  'hermès',
  'cartier',
]);

const FORBIDDEN_CELEBRITY_KEYWORDS = new Set([
  'kardashian',
  'beyoncé',
  'beyonce',
  'taylor swift',
  'drake',
  'rihanna',
  'oprah',
  'elon musk',
  'jeff bezos',
  'bill gates',
  'musk',
  'bezos',
  'gates',
  'bezos',
  'winfrey',
  'kardashians',
  'tiktok',
  'kim kardashian',
  'kanye',
  'celebrity',
  'celebrity',
  'influencer',
  'youtuber',
  'streamer',
]);

const FORBIDDEN_LEGAL_TERMS = new Set([
  'copyright',
  'trademark',
  'patent',
  'license',
  'dmca',
  'fair use',
]);

const FORBIDDEN_ADULT_CONTENT = new Set([
  'adult',
  'explicit',
  'xxx',
  '18+',
  'nsfw',
  'pornography',
  'mature',
]);

const UNSAFE_PATTERNS = [
  /\b(?:nike|adidas|gucci|lv|rolex|tesla|apple|microsoft|google|amazon)\b/gi,
  /\b(?:kardashian|beyoncé|taylor|drake|rihanna|oprah|elon)\b/gi,
  /\b(?:copyright|trademark|patent|dmca|license)\b/gi,
  /\b(?:adult|explicit|xxx|18\+|nsfw|pornography)\b/gi,
  /(?:™|®|©|®|™|©)/g, // trademark, registered, copyright symbols
];

/**
 * Removes punctuation and normalizes whitespace.
 */
function cleanKeyword(keyword) {
  return keyword
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove special chars except hyphen
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim();
}

/**
 * Checks if a keyword contains forbidden brand, celebrity, or legal terms.
 * Returns true if SAFE, false if UNSAFE.
 */
function isKeywordSafe(keyword) {
  const clean = cleanKeyword(keyword);
  const words = clean.split(/[\s-]+/);

  // Check forbidden brand names
  if (FORBIDDEN_BRANDS.has(clean)) return false;
  for (const word of words) {
    if (FORBIDDEN_BRANDS.has(word)) return false;
  }

  // Check forbidden celebrity keywords
  if (FORBIDDEN_CELEBRITY_KEYWORDS.has(clean)) return false;
  for (const word of words) {
    if (FORBIDDEN_CELEBRITY_KEYWORDS.has(word)) return false;
  }

  // Check forbidden legal terms
  if (FORBIDDEN_LEGAL_TERMS.has(clean)) return false;
  for (const word of words) {
    if (FORBIDDEN_LEGAL_TERMS.has(word)) return false;
  }

  // Check forbidden adult content
  if (FORBIDDEN_ADULT_CONTENT.has(clean)) return false;
  for (const word of words) {
    if (FORBIDDEN_ADULT_CONTENT.has(word)) return false;
  }

  // Check unsafe patterns (symbols, etc)
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(keyword)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Trend Data Sources
// ---------------------------------------------------------------------------

/**
 * Mock trending topics for testing. In production, would fetch from:
 *   - Google Trends RSS (https://trends.google.com/trends/trendingsearches/daily/rss?geo=US)
 *   - Pytrends (unofficial)
 *   - BuzzSumo
 *   - Semrush
 */
function getMockTrendingTopics() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  log('fetchTrendingTopics', `[MOCK] Generating trending topics for ${today}`);

  return [
    // Safe, generic trend concepts
    'minimalist boho aesthetic',
    'cottagecore fashion',
    'retro gaming nostalgia',
    'sustainable living',
    'dark academia aesthetic',
    'maximalist interior design',
    'vaporwave art',
    'solarpunk design',
    'cottagecore kitchen',
    'indie sleaze',

    // Potentially unsafe (should be filtered)
    'Apple Intelligence new features', // brand
    'Taylor Swift tour dates', // celebrity
    'Nike Air Max release', // brand
    'Kardashian sisters latest', // celebrity
    'Disney+ new shows', // brand
    'Gucci luxury collection', // brand
    'Elon Musk news', // celebrity
    'Copyright free music', // legal term

    // Safe design themes
    'pastel goth aesthetic',
    'brutalist architecture',
    'steampunk goggles',
    'cyberpunk neon',
    'art deco patterns',
    'bohemian wall decor',
    'urban jungle plants',
    'cottagecore embroidery',
    'retro space age',
    'gothic romance theme',
  ];
}

async function fetchTrendingTopics() {
  if (CONFIG.TREND_SOURCE === 'mock') {
    return getMockTrendingTopics();
  }

  if (CONFIG.TREND_SOURCE === 'google-trends-rss') {
    try {
      log('fetchTrendingTopics', 'Fetching from Google Trends RSS');
      const response = await fetch('https://trends.google.com/trends/trendingsearches/daily/rss?geo=US');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const xml = await response.text();
      const titles = xml.match(/<title>([^<]+)<\/title>/g) || [];
      return titles
        .map((t) => t.replace(/<\/?title>/g, ''))
        .filter((t) => t.length > 0)
        .slice(0, 20);
    } catch (err) {
      logError('fetchTrendingTopics', 'Failed to fetch Google Trends', err);
      return getMockTrendingTopics();
    }
  }

  log('fetchTrendingTopics', `Unknown TREND_SOURCE: ${CONFIG.TREND_SOURCE}. Falling back to mock.`);
  return getMockTrendingTopics();
}

// ---------------------------------------------------------------------------
// Filtering & Scoring
// ---------------------------------------------------------------------------

/**
 * Scores a keyword based on characteristics safe for print design.
 * Higher = better for our product market (design/art focused, generic).
 */
function scoreKeyword(keyword) {
  const clean = cleanKeyword(keyword);
  let score = 0;

  // Aesthetic/design keywords are high value
  if (/aesthetic|design|art|decor|style|theme|pattern|look|vibe/.test(clean)) score += 30;

  // Short, memorable keywords
  if (clean.length <= 30) score += 10;
  if (clean.length <= 20) score += 10;

  // Adjective-based keywords (easily turned into designs)
  if (/minimalist|retro|vintage|modern|classic|bohemian|gothic|cyber|neon|pastel/.test(clean)) score += 20;

  // Activity/hobby keywords
  if (/gaming|crafting|reading|cooking|gardening|hiking|yoga/.test(clean)) score += 15;

  // General popularity proxy: longer trend lists suggest popularity
  score += 5;

  return score;
}

/**
 * Filters trending topics to safe, design-friendly concepts.
 */
function filterTrendingTopics(topics) {
  log('filterTrendingTopics', `Filtering ${topics.length} topics (mode: ${CONFIG.FILTER_MODE})`);

  const safe = [];
  const unsafe = [];

  for (const topic of topics) {
    if (isKeywordSafe(topic)) {
      safe.push(topic);
    } else {
      unsafe.push(topic);
    }
  }

  if (unsafe.length > 0) {
    log('filterTrendingTopics', `Filtered out ${unsafe.length} unsafe keyword(s)`, unsafe.slice(0, 3));
  }

  return safe;
}

/**
 * Scores and ranks safe keywords by design appeal.
 */
function rankKeywords(keywords) {
  const scored = keywords.map((kw) => ({
    keyword: kw,
    score: scoreKeyword(kw),
  }));

  scored.sort((a, b) => b.score - a.score);

  log('rankKeywords', `Top 3 ranked concepts:`, scored.slice(0, 3));
  return scored;
}

/**
 * Extracts design-friendly phrases from top ranked keywords.
 */
function extractDesignConcepts(ranked, limit = CONFIG.MAX_CONCEPTS) {
  return ranked
    .slice(0, limit)
    .map((r) => r.keyword)
    .filter((kw) => kw.length > 0);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetches daily trending concepts safe for autonomous product generation.
 * Returns top N trending design themes, filtered for brand/celebrity/IP safety.
 */
async function getDailyTrendingConcepts({ limit = CONFIG.MAX_CONCEPTS, dryRun = DRY_RUN_DEFAULT } = {}) {
  log('getDailyTrendingConcepts', `Fetching daily trends (limit: ${limit}, dryRun: ${dryRun})`);

  try {
    // Step 1: Fetch raw topics
    const topics = await fetchTrendingTopics();
    log('getDailyTrendingConcepts', `Fetched ${topics.length} raw topics`);

    // Step 2: Filter for IP safety
    const safe = filterTrendingTopics(topics);
    log('getDailyTrendingConcepts', `${safe.length} topics passed safety filter`);

    // Step 3: Rank by design appeal
    const ranked = rankKeywords(safe);

    // Step 4: Extract top concepts
    const concepts = extractDesignConcepts(ranked, limit);
    log('getDailyTrendingConcepts', `Extracted ${concepts.length} design concept(s)`, concepts);

    return {
      timestamp: new Date().toISOString(),
      concepts,
      totalProcessed: topics.length,
      safeCount: safe.length,
      rankedScores: ranked.slice(0, limit).map((r) => ({ keyword: r.keyword, score: r.score })),
    };
  } catch (err) {
    logError('getDailyTrendingConcepts', 'Failed to get trending concepts', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Testing utilities
// ---------------------------------------------------------------------------

/**
 * Tests the keyword filter against known safe/unsafe examples.
 */
function runFilterTests() {
  const testCases = [
    // (keyword, shouldBeSafe, description)
    ['minimalist boho', true, 'safe aesthetic keyword'],
    ['cottagecore kitchen', true, 'safe design theme'],
    ['retro gaming', true, 'safe hobby theme'],
    ['Apple Intelligence', false, 'contains brand name'],
    ['Taylor Swift tour', false, 'contains celebrity name'],
    ['Nike Air Max', false, 'contains brand name'],
    ['Kardashian sisters', false, 'contains celebrity name'],
    ['Gucci luxury', false, 'contains brand name'],
    ['sustainable living', true, 'safe lifestyle keyword'],
    ['Disney+ shows', false, 'contains brand name'],
    ['Elon Musk news', false, 'contains celebrity name'],
    ['dark academia', true, 'safe aesthetic'],
    ['Copyright™ free', false, 'contains trademark symbol and legal term'],
    ['vaporwave art', true, 'safe art style'],
    ['cyberpunk neon', true, 'safe design theme'],
    ['Rolex watches', false, 'contains brand name'],
    ['pastel goth', true, 'safe aesthetic'],
    ['adult content', false, 'contains adult keyword'],
    ['steampunk goggles', true, 'safe design theme'],
    ['urban jungle', true, 'safe interior design'],
  ];

  let passed = 0;
  let failed = 0;

  console.log('\n=== KEYWORD FILTER TESTS ===\n');

  for (const [keyword, shouldBeSafe, description] of testCases) {
    const actual = isKeywordSafe(keyword);
    const status = actual === shouldBeSafe ? '✓' : '✗';
    const result = `${status} "${keyword}"`;

    if (actual === shouldBeSafe) {
      passed += 1;
      console.log(`${result} (${description})`);
    } else {
      failed += 1;
      console.log(`${result} (${description}) — FAILED: expected ${shouldBeSafe}, got ${actual}`);
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Passed: ${passed}/${testCases.length}`);
  console.log(`Failed: ${failed}/${testCases.length}`);
  console.log('');

  return { passed, failed, total: testCases.length };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CONFIG,
  cleanKeyword,
  isKeywordSafe,
  filterTrendingTopics,
  rankKeywords,
  extractDesignConcepts,
  fetchTrendingTopics,
  getDailyTrendingConcepts,
  runFilterTests,
};

// ---------------------------------------------------------------------------
// CLI: test & demo
// ---------------------------------------------------------------------------

if (require.main === module) {
  (async () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║        TREND SERVICE TEST SUITE        ║');
    console.log('╚════════════════════════════════════════╝\n');

    // Run filter tests
    const results = runFilterTests();

    // Run live trend fetch
    console.log('=== LIVE TREND FETCH ===\n');
    try {
      const trends = await getDailyTrendingConcepts({ limit: 3 });
      console.log('Trending concepts for designs:\n');
      trends.concepts.forEach((concept, i) => {
        const score = trends.rankedScores[i];
        console.log(`  ${i + 1}. "${concept}" (score: ${score.score})`);
      });
      console.log(`\nStats: ${trends.safeCount}/${trends.totalProcessed} topics passed safety filter`);
    } catch (err) {
      console.error('Failed to fetch trends:', err.message);
      process.exitCode = 1;
    }

    process.exitCode = results.failed > 0 ? 1 : 0;
  })();
}

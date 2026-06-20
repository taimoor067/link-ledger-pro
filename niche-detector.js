/**
 * niche-detector.js
 * Lightweight keyword-based niche classifier for outreach link-building tools.
 *
 * Usage:
 *   const result = await detectNiche("https://benzinga.com");
 *   // result = { niche: "Finance & Investing", confidence: 0.82, scores: {...}, matched: [...] }
 *
 * No external APIs required (besides fetching the target page itself).
 * Works in browser (fetch) — for cross-origin sites you'll likely need a
 * CORS proxy or to fetch server-side. See fetchPageText() below.
 */

// ---------------------------------------------------------------------------
// 1. Keyword dictionary — SHORT keywords only (1-2 words), weighted by
//    specificity. Higher weight = more decisive signal for that niche.
// ---------------------------------------------------------------------------
const NICHE_KEYWORDS = {
  "Hosting / Infrastructure": {
    high: ["vps", "dedicated server", "cpanel", "uptime", "bandwidth", "ssl certificate", "nameserver", "cdn", "colocation", "managed hosting", "shared hosting"],
    med: ["hosting", "server", "domain", "datacenter", "data center", "ddos", "migration"],
    low: ["plan", "renew", "uptime guarantee"]
  },
  "SaaS / Software": {
    high: ["api key", "free trial", "dashboard", "integration", "workspace", "saas", "subscription tier", "onboarding", "webhook", "sso"],
    med: ["software", "platform", "automation", "workflow", "cloud-based", "no-code"],
    low: ["pricing plan", "upgrade plan", "demo"]
  },
  "E-commerce / Retail": {
    high: ["add to cart", "checkout", "free shipping", "sku", "return policy", "wishlist", "shopify", "storefront"],
    med: ["shop now", "discount", "coupon", "order", "delivery", "retail"],
    low: ["sale", "deal", "buy now"]
  },
  "Finance & Investing": {
    high: ["stock price", "ticker", "ipo", "etf", "portfolio", "dividend", "brokerage", "market cap", "nasdaq", "nyse", "crypto exchange", "trading platform"],
    med: ["investing", "stocks", "trading", "earnings", "interest rate", "mutual fund", "hedge fund"],
    low: ["finance", "market", "economy"]
  },
  "Insurance": {
    high: ["get a quote", "premium", "policyholder", "deductible", "underwriting", "claims process"],
    med: ["insurance", "coverage", "policy", "insurer"],
    low: ["protect your"]
  },
  "Legal Services": {
    high: ["law firm", "attorney", "personal injury", "free consultation", "litigation", "case evaluation"],
    med: ["lawyer", "legal advice", "lawsuit", "settlement"],
    low: ["legal"]
  },
  "Healthcare / Medical": {
    high: ["patient portal", "telehealth", "diagnosis", "clinical trial", "appointment booking", "prescription"],
    med: ["doctor", "clinic", "treatment", "symptoms", "healthcare"],
    low: ["health", "wellness"]
  },
  "Real Estate": {
    high: ["mls listing", "square footage", "mortgage rate", "property listing", "open house", "realtor"],
    med: ["real estate", "for sale", "for rent", "listing", "home buying"],
    low: ["property", "homes"]
  },
  "Education / E-learning": {
    high: ["enroll now", "course catalog", "certification program", "lms", "syllabus", "online degree"],
    med: ["course", "tutorial", "curriculum", "e-learning", "student"],
    low: ["learn", "education"]
  },
  "Travel / Hospitality": {
    high: ["book a room", "flight booking", "itinerary", "check-in date", "hotel deal", "vacation package"],
    med: ["travel", "hotel", "flight", "resort", "destination"],
    low: ["trip", "vacation"]
  },
  "Marketing / SEO Agency": {
    high: ["link building", "backlink", "domain authority", "serp ranking", "keyword research", "guest post"],
    med: ["seo", "marketing agency", "ppc", "content marketing"],
    low: ["marketing", "agency"]
  },
  "News / Media": {
    high: ["breaking news", "subscribe to newsletter", "editorial team", "press release", "opinion column"],
    med: ["news", "article", "journalist", "magazine"],
    low: ["read more", "latest"]
  },
  "Food & Beverage": {
    high: ["menu item", "reservation", "recipe card", "nutrition facts", "delivery app"],
    med: ["recipe", "restaurant", "menu", "cuisine"],
    low: ["food", "drink"]
  },
  "Fitness / Wellness": {
    high: ["workout plan", "personal trainer", "membership pricing", "class schedule", "meal plan"],
    med: ["gym", "fitness", "workout", "nutrition"],
    low: ["health", "exercise"]
  },
  "Automotive": {
    high: ["vin number", "trade-in value", "lease offer", "mpg rating", "dealership"],
    med: ["car", "vehicle", "auto", "dealer"],
    low: ["drive", "model"]
  }
};

// ---------------------------------------------------------------------------
// 2. Fetch + extract visible text from a page
// ---------------------------------------------------------------------------
async function fetchPageText(url) {
  // Routed through our Netlify function (netlify/functions/fetch-page.js)
  // so we avoid CORS issues when fetching arbitrary external domains.
  const proxyUrl = `/.netlify/functions/fetch-page?url=${encodeURIComponent(url)}`;

  const res = await fetch(proxyUrl);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Failed to fetch ${url}: ${res.status}`);
  }

  const html = data.html;

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const h1Matches = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gis)].map(m => stripTags(m[1]));
  const bodyText = stripTags(html).slice(0, 20000); // cap for performance

  const title = titleMatch ? stripTags(titleMatch[1]) : "";
  const description = descMatch ? descMatch[1] : "";

  // Title + meta description + H1s are weighted more heavily by being
  // repeated into the combined text (cheap way to boost their signal).
  return `${title} ${title} ${description} ${description} ${h1Matches.join(" ")} ${bodyText}`.toLowerCase();
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// 3. Score text against the keyword dictionary
// ---------------------------------------------------------------------------
const WEIGHTS = { high: 5, med: 2, low: 1 };

function scoreText(text) {
  const scores = {};
  const matchedKeywords = {};

  for (const [niche, tiers] of Object.entries(NICHE_KEYWORDS)) {
    let score = 0;
    const matches = [];

    for (const [tier, keywords] of Object.entries(tiers)) {
      const weight = WEIGHTS[tier];
      for (const kw of keywords) {
        // Word-boundary-safe count of occurrences (capped at 3 to avoid
        // one repeated word dominating the score).
        const count = Math.min(countOccurrences(text, kw), 3);
        if (count > 0) {
          score += count * weight;
          matches.push(kw);
        }
      }
    }

    if (score > 0) {
      scores[niche] = score;
      matchedKeywords[niche] = matches;
    }
  }

  return { scores, matchedKeywords };
}

function countOccurrences(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "gi");
  const found = text.match(regex);
  return found ? found.length : 0;
}

// ---------------------------------------------------------------------------
// 4. Main entry point
// ---------------------------------------------------------------------------
async function detectNiche(url) {
  const text = await fetchPageText(url);
  const { scores, matchedKeywords } = scoreText(text);

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return { niche: "Unknown / General", confidence: 0, scores: {}, matched: [] };
  }

  const [topNiche, topScore] = sorted[0];
  const totalScore = sorted.reduce((sum, [, s]) => sum + s, 0);
  const confidence = Math.min(topScore / totalScore, 0.97); // never claim full certainty

  return {
    niche: topNiche,
    confidence: Math.round(confidence * 100) / 100,
    scores: Object.fromEntries(sorted),
    matched: matchedKeywords[topNiche]
  };
}

// ---------------------------------------------------------------------------
// 5. Export (works as <script> global or ES module)
// ---------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = { detectNiche, scoreText, fetchPageText };
} else {
  window.detectNiche = detectNiche;
}

// ---------------------------------------------------------------------------
// Example:
// detectNiche("https://benzinga.com").then(console.log);
// → { niche: "Finance & Investing", confidence: 0.78, scores: {...}, matched: [...] }
// ---------------------------------------------------------------------------
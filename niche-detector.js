/**
 * niche-detector.js
 * Lightweight keyword-based niche classifier for outreach link-building tools.
 *
 * Always classifies into one of these 16 fixed categories (or "Unknown / General"
 * if confidence is too low to commit to one):
 *
 *   SaaS / Software & Tech, Business & Finance, Marketing & SEO,
 *   Health & Wellness, Lifestyle, Travel, Education, Real Estate,
 *   Legal, Automotive, Food & Beverage, Fashion & Beauty,
 *   Home Improvement, Parenting & Family, Sports, Gaming
 *
 * Usage:
 *   const result = await detectNiche("https://benzinga.com");
 *   // result = { niche: "Business & Finance", confidence: 0.82, scores: {...}, matched: [...] }
 *
 * No external APIs required (besides fetching the target page itself).
 * Routed through a Netlify serverless function (see netlify/functions/fetch-page.js)
 * to avoid CORS issues when fetching arbitrary external domains.
 */

// ---------------------------------------------------------------------------
// 1. Keyword dictionary — SHORT phrases only (2-4 words), weighted by
//    specificity. Higher weight = more decisive signal for that niche.
//    Generic single words are deliberately avoided since they cause
//    false positives across unrelated categories (e.g. "drive", "plan").
// ---------------------------------------------------------------------------
const NICHE_KEYWORDS = {
  "SaaS / Software & Tech": {
    high: ["api key", "free trial", "saas platform", "cloud-based software", "webhook integration", "sso login", "admin dashboard", "open-source platform", "white-label software", "self-hosted solution"],
    med: ["software platform", "developer tools", "automation workflow", "no-code platform", "vps hosting", "cpanel access", "ssl certificate", "cdn network", "app development", "tech startup"],
    low: ["tech company"]
  },
  "Business & Finance": {
    high: ["stock price", "ticker symbol", "ipo filing", "dividend yield", "brokerage account", "market cap", "venture capital", "quarterly earnings", "business loan", "tax deduction"],
    med: ["small business", "entrepreneurship tips", "financial planning", "accounting software", "b2b sales", "startup funding", "crypto exchange", "trading platform"],
    low: ["business strategy"]
  },
  "Marketing & SEO": {
    high: ["link building", "backlink profile", "domain authority", "serp ranking", "keyword research", "guest post", "ppc campaign", "conversion rate optimization"],
    med: ["digital marketing", "content marketing", "social media strategy", "email marketing", "brand awareness", "seo agency"],
    low: ["marketing tips"]
  },
  "Health & Wellness": {
    high: ["patient portal", "telehealth visit", "clinical trial", "workout plan", "personal trainer", "meal plan", "mental health support", "nutrition coaching"],
    med: ["medical clinic", "fitness routine", "gym membership", "wellness program", "healthy recipes", "treatment plan"],
    low: ["health tips"]
  },
  "Lifestyle": {
    high: ["daily routine tips", "self-care ideas", "minimalist living", "life hacks"],
    med: ["lifestyle blog", "personal essay", "home decor ideas", "online store", "add to cart", "free shipping"],
    low: ["lifestyle tips"]
  },
  "Travel": {
    high: ["book a room", "flight booking", "travel itinerary", "hotel deal", "vacation package", "visa requirements"],
    med: ["travel guide", "hotel booking", "beach resort", "backpacking tips"],
    low: ["travel blog"]
  },
  "Education": {
    high: ["enroll now", "course catalog", "certification program", "learning management system", "online degree", "scholarship application"],
    med: ["online course", "video tutorial", "curriculum design", "student portal"],
    low: ["education blog"]
  },
  "Real Estate": {
    high: ["mls listing", "square footage", "mortgage rate", "property listing", "open house", "realtor license"],
    med: ["real estate agent", "homes for sale", "homes for rent", "home buying"],
    low: ["real estate blog"]
  },
  "Legal": {
    high: ["law firm", "personal injury", "free consultation", "litigation process", "case evaluation", "legal services"],
    med: ["attorney advice", "legal advice", "lawsuit settlement"],
    low: ["legal blog"]
  },
  "Automotive": {
    high: ["vin number", "trade-in value", "lease offer", "mpg rating", "car dealership", "test drive"],
    med: ["vehicle inventory", "auto repair", "car dealer", "auto financing"],
    low: ["car blog"]
  },
  "Food & Beverage": {
    high: ["menu item", "table reservation", "recipe card", "nutrition facts", "food delivery app", "craft brewery"],
    med: ["recipe ingredients", "restaurant menu", "cuisine style", "coffee shop"],
    low: ["food blog"]
  },
  "Fashion & Beauty": {
    high: ["skincare routine", "makeup tutorial", "fashion week", "beauty products", "cosmetic brand", "style guide"],
    med: ["fashion trends", "beauty blog", "clothing brand", "haircare tips"],
    low: ["fashion blog"]
  },
  "Home Improvement": {
    high: ["diy project", "home renovation", "interior design ideas", "home remodeling", "kitchen remodel"],
    med: ["home decor", "flooring options", "home improvement tips"],
    low: ["home blog"]
  },
  "Parenting & Family": {
    high: ["parenting tips", "baby gear", "toddler activities", "family vacation ideas", "pregnancy advice"],
    med: ["parenting blog", "family life", "kids activities"],
    low: ["family blog"]
  },
  "Sports": {
    high: ["match highlights", "game schedule", "player stats", "championship game", "sports betting odds", "team roster"],
    med: ["sports news", "fantasy league", "sports blog"],
    low: ["sports update"]
  },
  "Gaming": {
    high: ["video game review", "gameplay walkthrough", "esports tournament", "game release date", "in-game purchases"],
    med: ["gaming news", "game guide", "console gaming"],
    low: ["gaming blog"]
  }
};

// ---------------------------------------------------------------------------
// 2. Fetch + extract visible text from a page (via the Netlify proxy function)
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
const WEIGHTS = { high: 6, med: 2, low: 0.5 };

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
        // one repeated phrase dominating the score).
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

  // Minimum score floor: a single low-tier hit (worth 0.5) or one stray
  // med-tier hit (worth 2) isn't enough evidence to commit to a niche.
  const MIN_SCORE_THRESHOLD = 4;
  if (topScore < MIN_SCORE_THRESHOLD) {
    return { niche: "Unknown / General", confidence: 0, scores: Object.fromEntries(sorted), matched: [] };
  }

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
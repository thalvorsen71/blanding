const API_ENDPOINT = "/.netlify/functions/analyze";
const LEAD_ENDPOINT = "/.netlify/functions/capture-lead";
const SCRAPE_ENDPOINT = "/.netlify/functions/scrape-fallback";

function parseJSON(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("JSON parse failed");
  }
}

class RateLimitError extends Error {
  constructor(retryAfter = 60) {
    super("Rate limited — waiting before retry");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter; // seconds
  }
}

async function callAPI(messages, useSearch = false, model = "claude-sonnet-4-20250514") {
  const body = { model, max_tokens: useSearch ? 3000 : 2000, messages };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const controller = new AbortController();
  const timeoutMs = useSearch ? 55000 : 30000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Check HTTP 429 from our proxy before parsing body
    if (resp.status === 429) {
      throw new RateLimitError(60);
    }

    const data = await resp.json();

    // Detect rate limits from Anthropic API (proxied through our function)
    if (data.error) {
      const errMsg = typeof data.error === "string" ? data.error : data.error.message || "";
      if (errMsg.includes("rate limit") || errMsg.includes("429") || errMsg.includes("too many requests")) {
        const retryMatch = errMsg.match(/try again in (\d+)/);
        throw new RateLimitError(retryMatch ? parseInt(retryMatch[1]) : 60);
      }
      throw new Error(errMsg);
    }
    // Also check for 429 status from our proxy
    if (data.type === "error" && data.error?.type === "rate_limit_error") {
      throw new RateLimitError(60);
    }

    return data.content?.map(b => b.text || "").filter(Boolean).join("\n") || "";
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "RateLimitError") throw err;
    if (err.name === "AbortError") throw new Error("Request timed out — try again");
    throw err;
  }
}

/* ─── SCRAPING: CHEERIO-FIRST, CLAUDE-FALLBACK ─── */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Primary scraper: Cheerio (deterministic, zero hallucination).
 * Falls back to Claude web_search only when cheerio gets too little content.
 */
async function fetchPageViaCheerio(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch(SCRAPE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    data._source = "cheerio"; // tag source for transparency
    return data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Secondary scraper: Claude web_search. Used ONLY when cheerio
 * returns very little content (JS-heavy pages).
 * Tightly constrained to prevent hallucination.
 */
async function fetchPageViaClaude(url) {
  const raw = await callAPI([{
    role: "user",
    content: `Search for and visit this EXACT URL: ${url}

YOUR ONLY JOB: Extract ALL the literal text content visible on THIS page. You are a copy machine — be EXHAUSTIVE.

CRITICAL: Many university homepages have MULTIPLE content sections: hero text, featured stories, news items, event highlights, research spotlights, statistics, and institutional copy. You MUST capture text from ALL sections — not just the first paragraph. Scroll through the entire page.

ABSOLUTE RULES:
1. ONLY return text that literally appears on THIS specific URL right now.
2. Do NOT include text from sub-pages or other URLs.
3. Do NOT include information from your training data.
4. If a field has no content on this page, return empty string or empty array.
5. For body_text: Be EXHAUSTIVE. Include the hero/banner text, ALL featured story headlines and descriptions, ALL news headlines, event names, research highlights, statistics, pull quotes, and any institutional copy. Copy the text from EVERY section of the page. Aim for 3000-5000 characters. The MORE text you capture, the better.
6. For unique_claims and stock_phrases: ONLY phrases verbatim on THIS page.

Return ONLY a JSON object (no markdown, no backticks, no preamble):
{
  "title": "exact page <title> tag",
  "meta_description": "exact meta description content or empty string",
  "h1": ["exact H1 texts"],
  "h2s": ["first 12 H2 texts exactly as written — include featured story headlines"],
  "nav_items": ["main navigation labels"],
  "body_text": "ALL text from EVERY section of the page: hero, features, news, events, stats, research, quotes, institutional copy. Max 5000 chars. Skip only nav links and footer legal text.",
  "ctas": ["CTA button/link texts exactly as written"],
  "page_type": "homepage|admissions|about|academics|student-life|other",
  "linked_pages": ["up to 6 internal section URLs found on this page"],
  "unique_claims": ["specific concrete claims with numbers, dates, names, or facts from the page"],
  "stock_phrases": ["generic marketing phrases literally on the page"]
}`
  }], true); // Sonnet: only model that actually executes web_search tool
  const result = parseJSON(raw);
  result._source = "claude_websearch"; // tag source
  return result;
}

const MIN_BODY_CHARS = 200; // if cheerio gets less than this, try Claude

/**
 * Fetch a page: cheerio first (reliable, no hallucinations), then Claude if needed.
 *
 * @param {string} url
 * @param {function} onProgress - (msg) => void
 * @returns {object|null}
 */
export async function fetchPage(url, onProgress) {
  let cheerioData = null; // Keep cheerio result as fallback even if below threshold

  // Step 1: Try cheerio (deterministic, fast, zero hallucination)
  try {
    const data = await fetchPageViaCheerio(url);
    const bodyLen = (data.body_text || "").trim().length;

    if (bodyLen >= MIN_BODY_CHARS) {
      return data; // Cheerio got enough content — use it
    }

    // Cheerio got SOME content but below threshold — save as fallback
    cheerioData = data;

    // Try Claude for richer extraction
    if (onProgress) onProgress("Page uses dynamic content, trying AI scraper...");
  } catch (err) {
    // Cheerio failed entirely — try Claude
    if (onProgress) onProgress("Retrying with AI scraper...");
  }

  // Step 2: Fall back to Claude web_search (max 2 attempts, rate-limit-aware)
  for (let i = 0; i < 2; i++) {
    try {
      if (onProgress && i > 0) onProgress("AI scraper retry...");
      return await fetchPageViaClaude(url);
    } catch (err) {
      if (err.name === "RateLimitError") {
        if (i === 0) {
          // Wait out the rate limit window (default 60s) then retry once
          const waitSec = Math.min(err.retryAfter || 60, 90);
          if (onProgress) onProgress(`Rate limited — waiting ${waitSec}s before retry...`);
          await sleep(waitSec * 1000);
          continue;
        }
        // Already retried once after rate limit — use whatever cheerio got
        if (onProgress) onProgress("AI scraper unavailable (rate limited). Using available content.");
        return cheerioData; // May be partial content, but better than nothing
      }
      // Non-rate-limit error: retry once after brief pause
      if (i === 0) { await sleep(2000); continue; }
      return cheerioData; // Fall back to partial cheerio content
    }
  }
  return cheerioData; // Return whatever we have, even if sparse
}

/**
 * Fetch a sub-page: cheerio ONLY (no Claude fallback).
 * This conserves Sonnet rate limits for the homepage scrape + analysis.
 */
export async function fetchSubPage(url) {
  try {
    const data = await fetchPageViaCheerio(url);
    if ((data.body_text || "").trim().length >= MIN_BODY_CHARS) return data;
  } catch {}
  return null; // Skip Claude for sub-pages to stay within rate limits
}

export async function deepAnalysis(url, text, allText) {
  const combinedText = (text + " " + allText).trim();
  const wordCount = combinedText.split(/\s+/).length;

  const isEmptyContent = wordCount < 30;

  const prompt = isEmptyContent
    ? `Higher ed brand critic. The homepage at ${url} returned almost no scrapable text. The scraper found only: "${text.substring(0, 300)}"

Diagnose what this means for the brand. A homepage that yields no text to a scraper is invisible to search engines and AI tools.

Return JSON only:
{
  "voice_score": 2,
  "specificity_score": 1,
  "specificity_ratio": 5,
  "consistency_score": 3,
  "tone_diagnosis": "describe this empty homepage as a person at a dinner party, 2 sentences, funny",
  "biggest_sin": "diagnose what it means when your homepage has no readable text, 1 sentence",
  "best_moment": "find anything remotely distinctive, or roast the emptiness with wit",
  "weak_sentence": "NO_CONTENT",
  "rewrite": "NO_CONTENT",
  "differentiation_killer": "explain how absence of text makes differentiation impossible",
  "missed_opportunity": "what should this homepage be communicating",
  "rx_language": "what words should be on this homepage, 2 sentences",
  "rx_strategy": "how to fix a homepage invisible to search and AI, 2 sentences"
}`
    : `You are a brutally honest higher ed brand critic. Evaluate the BRAND STRATEGY this homepage is executing.

Homepages use different strategies. Some lead with institutional copy ("world-class faculty, commitment to excellence"). Some lead with news/stories/spotlights featuring real research, events, or people. Some are purely functional (search box, directory). Each is a brand choice worth evaluating.

IMPORTANT: A homepage full of specific stories, named events, real research highlights, current news, and concrete details is VERY DIFFERENT from a homepage full of generic platitudes — even if both contain a few stock phrases. Evaluate the OVERALL IMPRESSION, not just the worst moments. A site that leads with "LunarFest 2026" and "free tuition for families earning under $100K" is making a fundamentally different brand choice than one that leads with "transformative experience."

Your job: What strategy is this page using? How well does it execute? Does a first-time visitor leave knowing what makes this institution DIFFERENT? Give credit where credit is due for specific, vivid, timely content.

URL: ${url}
=== SCRAPED TEXT (THIS IS THE ONLY CONTENT ON THE PAGE) ===
${text.substring(0, 4000)}
=== END OF SCRAPED TEXT ===
Other pages sampled: ${allText.substring(0, 800)}

CRITICAL GROUNDING RULES — READ CAREFULLY:
1. You may ONLY reference text that literally appears in the SCRAPED TEXT above. If a phrase isn't in the text above, you CANNOT mention it.
2. Do NOT bring in any outside knowledge about this institution. You know NOTHING about this school except what is in the text above.
3. When you reference content, use the actual words from the scraped text. If you can't find supporting text above, say "the page lacks..." rather than inventing something.
4. No claims about visual layout, design, images, or video. You can only see words.
5. For weak_sentence: COPY-PASTE an exact sentence from the scraped text above. It must appear verbatim in the text. If no suitable sentence exists, write "NO_CONTENT".
6. For rewrite: Rewrite that exact sentence with more personality and specificity. If weak_sentence is "NO_CONTENT", write "NO_CONTENT".
7. For biggest_sin, best_moment, differentiation_killer, missed_opportunity: QUOTE specific phrases from the scraped text to support your claims. Use quotation marks around phrases you are citing.

RATIO ASSESSMENT — This is critical:
Look at ALL the text on the page. What percentage is genuinely specific (names, dates, numbers, unique programs, real stories) vs. generic filler (platitudes, stock CTAs, boilerplate)? A page with one great story buried in 90% generic copy is NOT a specific page. A page that is 80% real content with a few stock CTAs IS specific. Score the RATIO, not the best moment.

SCORING CALIBRATION — USE THE FULL RANGE:
Do NOT cluster scores in the 4-7 range. Use the ENTIRE 1-10 scale. Here are anchors:
- voice_score 9-10: A page so distinctive you could identify the school with the logo removed. Specific stories, named people, unique turns of phrase.
- voice_score 5-6: Mix of institutional personality and generic marketing. Some distinctive moments buried in boilerplate.
- voice_score 1-3: Could be ANY school. Pure stock phrases, no institutional personality whatsoever.
- specificity_score 9-10: The page is overwhelmingly concrete — named professors, specific research, real numbers, dated events.
- specificity_score 5-6: Some real content alongside significant generic filler.
- specificity_score 1-3: Wall-to-wall platitudes. "World-class faculty committed to transformative excellence."
If the page is genuinely excellent, score it 8-10. If it's genuinely bad, score it 1-3. Do not default to the middle.

Return JSON only:
{
  "voice_score": 1-10 (USE FULL RANGE — 1=could be any school, 10=unmistakably this institution. Specific stories, named events, real news all contribute to voice),
  "specificity_score": 1-10 (USE FULL RANGE — 1=all vague platitudes, 10=overwhelmingly concrete with named people, events, numbers, programs),
  "specificity_ratio": 0-100 (what PERCENTAGE of total page content is genuinely specific? 0=entirely generic, 100=every word is concrete. A page that is 90% boilerplate = 10-15. A page that is mostly real content with a few stock CTAs = 70-85. Be honest.),
  "consistency_score": 1-10 (USE FULL RANGE — 1=scattered identity, 10=every element reinforces who they are),
  "tone_diagnosis": "describe the brand personality based on ALL the content in the scraped text. As a person at a dinner party, 2 sentences, funny and specific. Reference actual phrases from the text.",
  "biggest_sin": "the biggest brand strategy failure — reference QUOTED phrases from the scraped text. 1-2 sentences.",
  "best_moment": "the most distinctive content, QUOTING actual phrases from the scraped text. If nothing distinctive, say so.",
  "weak_sentence": "EXACT verbatim sentence copied from the scraped text, or NO_CONTENT",
  "rewrite": "rewrite with personality and strategic intent, or NO_CONTENT",
  "differentiation_killer": "why a visitor wouldn't know what makes this school different, referencing QUOTED text from above",
  "missed_opportunity": "what content in the scraped text COULD be a differentiator but isn't used that way. QUOTE the specific text.",
  "rx_language": "fix the voice/language, 2 sentences",
  "rx_strategy": "fix the content strategy, 2 sentences"
}`;

  const raw = await callAPI([{ role: "user", content: prompt }], false, "claude-haiku-4-5-20251001");
  try { return parseJSON(raw); } catch { return null; }
}

export async function captureLead(email, schoolName, score, name = "", title = "", source = "pdf_export") {
  try {
    await fetch(LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, schoolName, score, name, title, source }),
    });
    return true;
  } catch {
    return false;
  }
}

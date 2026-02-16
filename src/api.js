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

async function callAPI(messages, useSearch = false, model = "claude-sonnet-4-20250514") {
  const body = { model, max_tokens: 2000, messages };
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
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.content?.map(b => b.text || "").filter(Boolean).join("\n") || "";
  } catch (err) {
    clearTimeout(timeout);
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

YOUR ONLY JOB: Extract the literal text content visible on THIS page. You are a copy machine, not an analyst.

ABSOLUTE RULES — VIOLATIONS WILL CAUSE ERRORS:
1. ONLY return text that literally, verbatim appears on THIS specific URL at this moment.
2. Do NOT include any text from sub-pages, linked pages, or other URLs on the same domain.
3. Do NOT include any information you "know" about this institution from training data.
4. If a field has no content on this page, return an empty string or empty array. NEVER guess.
5. For body_text: Copy-paste the visible text. If you're not 100% sure a sentence is on this page, OMIT it.
6. For unique_claims and stock_phrases: ONLY phrases you can see verbatim on THIS page right now.

Return ONLY a JSON object (no markdown, no backticks, no preamble):
{
  "title": "exact page <title> tag",
  "meta_description": "exact meta description content or empty string",
  "h1": ["exact H1 texts"],
  "h2s": ["first 12 H2 texts exactly as written"],
  "nav_items": ["main navigation labels"],
  "body_text": "verbatim main content text from THIS URL only, max 5000 chars, skip nav/footer",
  "ctas": ["CTA button/link texts exactly as written"],
  "page_type": "homepage|admissions|about|academics|student-life|other",
  "linked_pages": ["up to 6 internal section URLs found on this page"],
  "unique_claims": ["specific concrete claims literally on the page with numbers or facts"],
  "stock_phrases": ["generic marketing phrases literally on the page"]
}`
  }], true, "claude-haiku-4-5-20251001"); // Haiku: faster, cheaper, higher rate limits
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
  // Step 1: Try cheerio (deterministic, fast, zero hallucination)
  try {
    const data = await fetchPageViaCheerio(url);
    const bodyLen = (data.body_text || "").trim().length;

    if (bodyLen >= MIN_BODY_CHARS) {
      return data; // Cheerio got enough content — use it
    }

    // Cheerio got too little content (likely JS-heavy page) — try Claude
    if (onProgress) onProgress("Page uses dynamic content, trying AI scraper...");
  } catch (err) {
    // Cheerio failed entirely — try Claude
    if (onProgress) onProgress("Retrying with AI scraper...");
  }

  // Step 2: Fall back to Claude web_search (with retries)
  const delays = [0, 1000, 2500];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    try {
      if (onProgress && i > 0) onProgress(`AI scraper retry ${i + 1}...`);
      return await fetchPageViaClaude(url);
    } catch {
      if (i === delays.length - 1) return null;
    }
  }
  return null;
}

/**
 * Fetch a sub-page: cheerio first, Claude fallback
 */
export async function fetchSubPage(url) {
  try {
    const data = await fetchPageViaCheerio(url);
    if ((data.body_text || "").trim().length >= MIN_BODY_CHARS) return data;
  } catch {}
  try {
    return await fetchPageViaClaude(url);
  } catch {
    return null;
  }
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

Return JSON only:
{
  "voice_score": 1-10 (1=no distinct voice, 10=unmistakably this institution. NOTE: specific stories, named events, and real news contribute to voice even if some generic language also exists),
  "specificity_score": 1-10 (1=all vague platitudes, 10=concrete details, named people/events/programs, specific numbers. Give HIGH scores to pages with real news stories, named events, specific research, concrete facts — even if they also have some generic CTAs),
  "consistency_score": 1-10 (1=scattered identity, 10=every element reinforces who they are),
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

export async function captureLead(email, schoolName, score) {
  try {
    await fetch(LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, schoolName, score }),
    });
    return true;
  } catch {
    return false;
  }
}

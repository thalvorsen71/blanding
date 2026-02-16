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
  const body = { model, max_tokens: 1500, messages };
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

/* ─── RETRY WITH EXPONENTIAL BACKOFF ─── */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPageViaClaude(url) {
  const raw = await callAPI([{
    role: "user",
    content: `Search for and visit this URL: ${url}

CRITICAL RULES:
- Return ONLY content that appears on THIS specific URL. Do NOT include text from other pages on the same website (e.g. don't pull in mission statement pages, policy pages, or deep sub-pages).
- This is a homepage or primary landing page audit. Only capture what a visitor to THIS URL would actually see.
- For body_text: Copy the actual visible text content from THIS page verbatim. Do not pull in content from sub-pages or other URLs on the same domain.
- For unique_claims and stock_phrases: Only include phrases that literally appear on THIS page.
- If you cannot access the page or certain fields are empty, use empty strings/arrays. Do NOT fabricate placeholder content.

Return ONLY a JSON object (no markdown, no backticks, no preamble) with these fields:
- "title": the exact page title
- "meta_description": the exact meta description tag content
- "h1": array of all H1 text exactly as written
- "h2s": array of first 12 H2 texts exactly as written
- "nav_items": array of main navigation labels exactly as written
- "body_text": verbatim main body text content from THIS URL ONLY (first 2500 chars, skip nav/footer). Do NOT include text from linked pages or sub-pages.
- "ctas": array of CTA button/link text exactly as written
- "page_type": "homepage"|"admissions"|"about"|"academics"|"student-life"|"other"
- "linked_pages": array of up to 6 internal section URLs
- "unique_claims": array of specific concrete claims that literally appear on the page
- "stock_phrases": array of generic phrases that literally appear on the page`
  }], true);
  return parseJSON(raw);
}

async function fetchPageViaFallback(url) {
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
    return data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Fetch a page with retry + fallback strategy.
 * Primary: Claude web_search (up to 3 attempts with exponential backoff)
 * Fallback: Cheerio-based lightweight scraper
 *
 * @param {string} url - URL to fetch
 * @param {function} onProgress - callback for progress updates: (msg, attempt) => void
 * @returns {object|null} - parsed page data or null on total failure
 */
export async function fetchPage(url, onProgress) {
  const delays = [0, 800, 2000]; // exponential-ish backoff
  const maxAttempts = 3;

  for (let i = 0; i < maxAttempts; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    try {
      if (onProgress && i > 0) onProgress(`Retry ${i + 1}/${maxAttempts}...`, i);
      return await fetchPageViaClaude(url);
    } catch (err) {
      if (i === maxAttempts - 1) {
        // All Claude attempts exhausted — try fallback
        if (onProgress) onProgress("Trying lightweight scraper...", -1);
        try {
          return await fetchPageViaFallback(url);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Fetch a sub-page (shorter timeout, single Claude attempt + fallback)
 */
export async function fetchSubPage(url) {
  try {
    return await fetchPageViaClaude(url);
  } catch {
    try {
      return await fetchPageViaFallback(url);
    } catch {
      return null;
    }
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
    : `Brutally honest higher ed brand critic. Evaluate the BRAND STRATEGY this homepage is executing — not just whether it has a mission statement.

Homepages use different strategies. Some lead with institutional copy ("world-class faculty, commitment to excellence"). Some lead with news/stories/spotlights. Some are purely functional (search box, directory). Each is a brand choice worth evaluating.

Your job: What strategy is this page using? How well does it execute? Does a first-time visitor leave knowing what makes this institution DIFFERENT?

URL: ${url}
--- SCRAPED TEXT ---
${text.substring(0, 2000)}
--- END ---
Other pages: ${allText.substring(0, 500)}

RULES:
- Only reference text that appears in the SCRAPED TEXT above.
- No claims about visual layout or design. You can only see words.
- Evaluate whatever IS on the page — news headlines, student quotes, research spotlights, institutional copy, ALL of it is brand communication.
- For weak_sentence: Find the most generic or strategically weakest sentence and copy it EXACTLY from the text above. If no complete sentence exists, write "NO_CONTENT".
- For rewrite: Rewrite that sentence with more personality and specificity. If weak_sentence is "NO_CONTENT", write "NO_CONTENT".

Return JSON only:
{
  "voice_score": 1-10 (1=no distinct voice, 10=unmistakably this institution),
  "specificity_score": 1-10 (1=vague/generic, 10=concrete details only this school could claim),
  "consistency_score": 1-10 (1=scattered identity, 10=every word reinforces who they are),
  "tone_diagnosis": "describe the brand personality based on ALL the content — copy, headlines, stories, whatever is there. As a person at a dinner party, 2 sentences, funny and specific",
  "biggest_sin": "the biggest brand strategy failure on this page — could be generic copy, missed storytelling, wasted real estate, or letting content exist without a throughline. 1-2 sentences referencing actual text",
  "best_moment": "the most distinctive or specific content, whether it's institutional copy, a student quote, a research headline, or a concrete detail. Reference the actual words",
  "weak_sentence": "EXACT verbatim sentence from the scraped text, or NO_CONTENT",
  "rewrite": "rewrite with personality and strategic intent, or NO_CONTENT",
  "differentiation_killer": "why a first-time visitor still wouldn't know what makes this school different after reading this page",
  "missed_opportunity": "what specific content on this page COULD be a differentiator but isn't being used that way",
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

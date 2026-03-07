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
  const body = { model, max_tokens: useSearch ? 1500 : 4000, messages };
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
    if (err.name === "AbortError") {
      console.warn(`[Blanding] API call timed out after ${timeoutMs / 1000}s (model: ${model})`);
      throw new Error(`Request timed out after ${timeoutMs / 1000}s — try again`);
    }
    console.warn("[Blanding] API call error:", err.message);
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

const MIN_BODY_CHARS = 200; // threshold for "full" vs "partial" quality tag

/**
 * Fetch a page: cheerio ONLY. No AI fallback. Zero hallucination guarantee.
 *
 * If cheerio can reach the site, we use whatever it gets — even if sparse.
 * If cheerio can't reach the site (403, timeout), we return null and the
 * UI tells the user honestly that we couldn't scrape it.
 *
 * The old Claude websearch fallback was removed because it could fabricate
 * H1 tags, body text, and structural elements. A transparent "couldn't
 * scrape this" is better than a confident-sounding fabrication.
 *
 * @param {string} url
 * @param {function} onProgress - (msg) => void
 * @returns {object|null}
 */
export async function fetchPage(url, onProgress) {
  try {
    const data = await fetchPageViaCheerio(url);
    const bodyLen = (data.body_text || "").trim().length;

    if (bodyLen >= MIN_BODY_CHARS) {
      data._scrapeQuality = "full";
    } else if (bodyLen > 0) {
      data._scrapeQuality = "partial"; // Got HTML but sparse body (JS-heavy SPA)
      if (onProgress) onProgress("Limited text extracted — site may use heavy JavaScript rendering");
    } else {
      data._scrapeQuality = "empty"; // HTML returned but zero usable body text
      if (onProgress) onProgress("Site returned HTML but no readable text content");
    }

    data._wasBlocked = false;
    return data;
  } catch (err) {
    const errMsg = err.message || "";
    const wasBlocked = /403|405|406|forbidden|blocked|captcha|fetch failed|ECONNRESET|ECONNREFUSED/i.test(errMsg);

    if (onProgress) {
      onProgress(wasBlocked
        ? "Site blocks automated scrapers — cannot audit without accessible content"
        : "Could not reach this site: " + (errMsg.substring(0, 80)));
    }
    return null;
  }
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

// Sanitize user-supplied text to prevent prompt injection.
// Strips common injection patterns while preserving legitimate content.
function sanitizeInput(str) {
  if (!str || typeof str !== "string") return "";
  return str
    // Strip attempts to break out of the content block
    .replace(/={3,}/g, "---")
    // Strip XML/HTML-style instruction tags that could redefine context
    .replace(/<\/?(?:system|instruction|prompt|assistant|human|user|role|rules?|override|ignore|command)[^>]*>/gi, "")
    // Strip common injection prefixes
    .replace(/^(ignore|disregard|forget|override|new instructions?|system prompt|you are now|act as)\b[^.]*[.:]/gim, "[REMOVED] ")
    // Cap length: 15K chars is ~3K words, more than any homepage
    .substring(0, 15000);
}

export async function deepAnalysis(url, text, allText, h1s = [], h2s = [], metaDesc = "", homepageH1s = [], wasBlocked = false) {
  // Sanitize all text inputs before they enter the prompt
  text = sanitizeInput(text);
  allText = sanitizeInput(allText);
  metaDesc = sanitizeInput(metaDesc);
  h1s = (h1s || []).map(s => sanitizeInput(s));
  h2s = (h2s || []).map(s => sanitizeInput(s));
  homepageH1s = (homepageH1s || []).map(s => sanitizeInput(s));

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

BRAND THEATRE DETECTION — This is critical in the age of AI search:
"Brand theatre" is the appearance of meaning without the discipline of solving. It's language that SOUNDS branded but doesn't actually tell a prospective student what specific problem this institution solves for them. Examples: "We Push What's Possible" — sounds distinctive, but what does it MEAN for a student choosing a school? "Where Leaders Are Made" — branded-sounding but functionally empty.
AI search engines (ChatGPT, Perplexity, Gemini) are now decision engines, not browsing tools. They don't reward institutions for being attractive — they reward them for being DEPENDABLE and SPECIFIC. If a student asks an AI "which school is best for marine biology research?" — does this page give the AI anything concrete to work with? Or is it all aspiration and no substance?
Evaluate: Does the content answer "why HERE instead of somewhere else?" with something a machine could actually index and recommend? Or is it just performing a brand identity without delivering one?

URL: ${url}
=== HOMEPAGE H1 (the hero tagline — this is THE primary brand statement visitors see first) ===
${homepageH1s.length > 0 ? homepageH1s.join(" | ") : "NONE FOUND — the homepage has no H1 tag, which is itself a brand problem."}
=== ALL H1 TAGS ACROSS SITE (homepage + sub-pages) ===
${h1s.length > 0 ? h1s.join(" | ") : "NONE FOUND"}
=== KEY HEADINGS (H2 tags — these frame the page's content sections) ===
${h2s.length > 0 ? h2s.slice(0, 15).join(" | ") : "NONE FOUND"}
=== META DESCRIPTION (what search engines show) ===
${metaDesc || "NONE FOUND"}
=== FULL PAGE TEXT ===
${text.substring(0, 6000)}
=== END OF PAGE TEXT ===
Other pages sampled: ${allText.substring(0, 2000)}
${wasBlocked ? `
=== CRAWL ACCESSIBILITY WARNING ===
This website BLOCKED our automated scraper (returned HTTP 403 Forbidden). The content above was captured via a secondary AI-assisted method and may be INCOMPLETE — the actual page likely contains significantly more content than what you see above.

This is a CRITICAL strategic finding: if this site blocks automated crawlers, it is likely also blocking or degrading access for AI search engines (ChatGPT, Perplexity, Gemini, Google AI Overviews). This means prospective students using AI tools to research colleges may receive incomplete or outdated information about this institution. Factor this into your ai_readiness_score and ai_readiness_diagnosis — a school that blocks bots is invisible to the fastest-growing discovery channel in higher ed.

NOTE: Because the scraped text above may be incomplete, be generous in your content quality assessment — acknowledge that you may be seeing a fraction of what the page actually contains. But be HARSH on the crawl-blocking itself, because that is a strategic choice with real consequences.
` : ""}
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

CONTENT TYPE HIERARCHY — NOT ALL CONTENT IS EQUAL:
The H1 and H2 tags are listed SEPARATELY above. These are the primary brand statements. Assess them FIRST before looking at body text.
- H1 (hero headline/tagline) → HIGHEST weight. This is THE brand statement. A distinctive H1 like "Start Ahead. Stay There." or "Think Independently" is a major brand asset that should be called out in your analysis. A generic H1 like "Welcome to [School]" or "Transform Your Future" is a brand failure. ALWAYS reference the H1 in your biggest_sin or best_moment.
- H2s (section headings) → HIGH weight. These frame the page's narrative. Generic H2s ("Academics," "Campus Life") vs. distinctive ones ("Not Everyone Is Built to Defy Limits") signal brand commitment.
- Feature descriptions, program overviews, about-us copy → HIGH weight. This is core messaging.
- News headlines, event announcements, press releases → LOW weight. Having specific news items (names, dates, achievements) shows a real institution exists, but it does NOT prove brand differentiation. A school can have great news and still have zero brand voice. News specificity should contribute modestly to specificity_score (cap its contribution at +1-2 points) but should NOT boost voice_score at all.
- CTAs, navigation labels, footer boilerplate → IGNORE for scoring purposes.

SCORING CALIBRATION — USE THE FULL RANGE:
Do NOT cluster scores in the 4-7 range. Use the ENTIRE 1-10 scale. Here are anchors:
- voice_score 9-10: A page so distinctive you could identify the school with the logo removed. Specific stories, named people, unique turns of phrase.
- voice_score 5-6: Mix of institutional personality and generic marketing. Some distinctive moments buried in boilerplate.
- voice_score 1-3: Could be ANY school. Pure stock phrases, no institutional personality whatsoever.
- specificity_score 9-10: The page is overwhelmingly concrete — named professors, specific research, real numbers, dated events.
- specificity_score 5-6: Some real content alongside significant generic filler.
- specificity_score 1-3: Wall-to-wall platitudes. "World-class faculty committed to transformative excellence."
If the page is genuinely excellent, score it 8-10. If it's genuinely bad, score it 1-3. Do not default to the middle.

BRAND THEATRE SCORING — BE HARSH:
A page full of news items and event listings is NOT the same as a page with clear brand positioning. Specific content ≠ strategic content. A school can name every Fulbright scholar and still never answer "why should I come HERE instead of a comparable school?"
- brand_theatre_score 1-2: Rare. Content directly answers "why here?" with concrete differentiators a student could act on.
- brand_theatre_score 3-4: Mostly substance. Clear positioning with only minor aspirational fluff.
- brand_theatre_score 5-6: The page has real content but avoids making a strategic claim. News, events, and achievements are listed but never framed as "this is what makes us different." A student would leave informed but not persuaded.
- brand_theatre_score 7-8: Aspiration without evidence. Slogans, taglines, and emotional language that sound branded but don't solve a student's decision. "We Push What's Possible" territory.
- brand_theatre_score 9-10: Pure theatre. Every sentence could belong to any school. Brand performance with zero substance.

AI SEARCH READINESS — MOST SCHOOLS WILL SCORE LOW:
The bar is: if a student asks ChatGPT "which school should I attend for X?" — can the AI cite THIS page with a specific, differentiated answer? Having news items isn't enough. The AI needs clear claims: "Bowdoin has X that makes it different from Colby/Middlebury because Y."
- ai_readiness_score 8-10: AI could confidently recommend this school for specific queries with concrete evidence from the page.
- ai_readiness_score 5-7: Some indexable content but AI couldn't differentiate this school from competitors. Generic achievements any school could claim.
- ai_readiness_score 3-4: Mostly vague. AI would lump this school in with dozens of similar institutions.
- ai_readiness_score 1-2: Nothing for AI to work with. Invisible to AI-powered discovery.

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
  "hero_assessment": "1-2 sentences specifically assessing the H1 hero tagline. Is it distinctive or generic? Does the rest of the page support it or undermine it?",
  "brand_theatre_score": 1-10 (1=zero theatre, content solves real questions; 10=pure performance, sounds branded but says nothing actionable),
  "brand_theatre_diagnosis": "1-2 sentences: Is this page performing a brand or delivering one? QUOTE the most theatrical language. Would a student know why to choose this school after reading it?",
  "ai_readiness_score": 1-10 (1=invisible to AI search, 10=AI could confidently recommend this school for specific queries based on this content alone),
  "ai_readiness_diagnosis": "1-2 sentences: If a student asked ChatGPT 'which school is best for X?' — could an AI cite anything specific from this page? What's missing?",
  "rx_language": "fix the voice/language, 2 sentences",
  "rx_strategy": "fix the content strategy, 2 sentences",
  "rx_ai_readiness": "what this institution should change so AI search engines can actually recommend them, 2 sentences",
  "verified_unique_claims": ["ONLY institutional facts that differentiate THIS school from peers. Each must be a short factual statement (under 120 chars) containing a number, percentage, named program/center/initiative, or concrete outcome. Examples: 'Student-faculty ratio is 7:1', '94% of students live on campus all four years', '3-2 engineering program with Caltech', 'Center for Civic Engagement pairs every student with a community partner', 'Students work with professors on over 300 research projects annually', 'The Reed Commitment guarantees mentored research by junior year'. Look for NAMED programs, centers, guarantees, and commitments unique to this school — not just stats. Do NOT include: news headlines, fundraising campaigns, event listings, press mentions, taglines, slogans, or marketing copy. Max 10 items. If fewer than 3 real differentiators exist on the page, return fewer."]
}`;

  const raw = await callAPI([{ role: "user", content: prompt }], false, "claude-haiku-4-5-20251001");
  try {
    return parseJSON(raw);
  } catch (e) {
    console.error("[Blanding] deepAnalysis JSON parse failed:", e.message, "| Raw response (first 500 chars):", (raw || "").substring(0, 500));
    return null;
  }
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

/**
 * Batch re-audit endpoint: scrapes a single school, runs analysis, saves to leaderboard.
 * Called by the batch driver script. Requires admin secret.
 *
 * POST { secret, url }
 * Returns { success, slug, score, wordCount } or { error }
 */
import { connectLambda, getStore } from "@netlify/blobs";
import * as cheerio from "cheerio";

const ADMIN_SECRET = "blanding2026";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ---- Cheerio scraper (same logic as scrape-fallback.js) ----
async function scrapePage(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);

  // Remove noise
  $("script, style, noscript, iframe, svg, [aria-hidden='true']").remove();

  const title = $("title").text().trim();
  const h1 = [];
  $("h1").each((_, el) => { const t = $(el).text().trim(); if (t && h1.length < 5) h1.push(t); });
  const h2s = [];
  $("h2").each((_, el) => { const t = $(el).text().trim(); if (t && h2s.length < 12) h2s.push(t); });
  const metaDesc = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";

  // Body text
  $("nav, footer, [role='navigation'], [role='contentinfo']").remove();
  $("select, datalist, [role='listbox']").remove();

  let bodyEl = $("main, [role='main'], #main-content, .main-content, article").first();
  if (!bodyEl.length) bodyEl = $("body");
  const bodyClone = bodyEl.clone();
  bodyClone.find("nav, footer, script, style").remove();
  let bodyText = bodyClone.text().replace(/\s+/g, " ").trim().substring(0, 15000);

  if (bodyText.length < 300) {
    const fullClone = $("body").clone();
    fullClone.find("nav, footer, [role='navigation'], [role='contentinfo'], script, style").remove();
    const fullText = fullClone.text().replace(/\s+/g, " ").trim().substring(0, 15000);
    if (fullText.length > bodyText.length) bodyText = fullText;
  }

  // Linked pages
  const linkedPages = [];
  const seen = new Set();
  $("a[href]").each((_, el) => {
    if (linkedPages.length >= 4) return false;
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim().toLowerCase();
    if (/about|academics|admission|program/i.test(text) || /about|academics|admission|program/i.test(href)) {
      try {
        const full = new URL(href, url).href;
        if (!seen.has(full) && full.startsWith("http")) {
          seen.add(full);
          linkedPages.push(full);
        }
      } catch {}
    }
  });

  // Page type detection
  const urlLower = url.toLowerCase();
  let pageType = "homepage";
  if (/about/i.test(urlLower)) pageType = "about";
  else if (/admis/i.test(urlLower)) pageType = "admissions";
  else if (/academ|program/i.test(urlLower)) pageType = "academics";

  return { title, h1, h2s, meta_description: metaDesc, body_text: bodyText, linked_pages: linkedPages, page_type: pageType };
}

// ---- Analysis via Anthropic API ----
async function analyze(url, text, allText, h1s, h2s, metaDesc, homepageH1s, apiKey) {
  function sanitize(str) {
    if (!str || typeof str !== "string") return "";
    return str
      .replace(/={3,}/g, "---")
      .replace(/<\/?(?:system|instruction|prompt|assistant|human|user|role|rules?|override|ignore|command)[^>]*>/gi, "")
      .replace(/^(ignore|disregard|forget|override|new instructions?|system prompt|you are now|act as)\b[^.]*[.:]/gim, "[REMOVED] ")
      .substring(0, 30000);
  }

  text = sanitize(text);
  allText = sanitize(allText);
  metaDesc = sanitize(metaDesc);
  h1s = (h1s || []).map(s => sanitize(s));
  h2s = (h2s || []).map(s => sanitize(s));
  homepageH1s = (homepageH1s || []).map(s => sanitize(s));

  const combinedText = (text + " " + allText).trim();
  const wordCount = combinedText.split(/\s+/).length;
  const isEmptyContent = wordCount < 30;

  const prompt = isEmptyContent
    ? `Higher ed brand critic. The homepage at ${url} returned almost no scrapable text. The scraper found only: "${text.substring(0, 300)}"
Diagnose what this means for the brand. Return JSON only:
{"voice_score":2,"specificity_score":1,"specificity_ratio":5,"consistency_score":3,"tone_diagnosis":"describe this empty homepage","biggest_sin":"1 sentence","best_moment":"find anything or roast","weak_sentence":"NO_CONTENT","rewrite":"NO_CONTENT","differentiation_killer":"1 sentence","missed_opportunity":"1 sentence","rx_language":"2 sentences","rx_strategy":"2 sentences"}`
    : `You are a brutally honest higher ed brand critic. Evaluate the BRAND STRATEGY this homepage is executing.

Homepages use different strategies. Some lead with institutional copy. Some lead with news/stories. Some are purely functional. Each is a brand choice worth evaluating.

IMPORTANT: A homepage full of specific stories, named events, real research highlights, current news, and concrete details is VERY DIFFERENT from a homepage full of generic platitudes. Evaluate the OVERALL IMPRESSION, not just the worst moments.

BRAND THEATRE DETECTION:
"Brand theatre" is the appearance of meaning without the discipline of solving. AI search engines don't reward institutions for being attractive—they reward them for being DEPENDABLE and SPECIFIC. Does the content answer "why HERE instead of somewhere else?" with something a machine could actually index and recommend?

URL: ${url}
=== HOMEPAGE H1 ===
${homepageH1s.length > 0 ? homepageH1s.join(" | ") : "NONE FOUND"}
=== ALL H1 TAGS ACROSS SITE ===
${h1s.length > 0 ? h1s.join(" | ") : "NONE FOUND"}
=== KEY HEADINGS (H2) ===
${h2s.length > 0 ? h2s.slice(0, 15).join(" | ") : "NONE FOUND"}
=== META DESCRIPTION ===
${metaDesc || "NONE FOUND"}
=== FULL PAGE TEXT ===
${text.substring(0, 12000)}
=== END OF PAGE TEXT ===
Other pages sampled: ${allText.substring(0, 10000)}

CRITICAL GROUNDING RULES:
1. Quote ONLY text that appears verbatim above. If you can't find it above, don't reference it.
2. Every claim must trace to text in the content block.
3. H1 analysis must use exact H1 text shown.
4. "Best moment" must quote real text from above.
5. Never invent programs, statistics, or quotes.

Return ONLY a JSON object:
{
  "voice_score": <1-10>,
  "specificity_score": <1-10>,
  "specificity_ratio": <1-100 pct of content that is institution-specific vs generic>,
  "consistency_score": <1-10>,
  "brand_theatre_score": <1-10 where 10=pure theatre>,
  "ai_readiness_score": <1-10>,
  "tone_diagnosis": "<2 sentences: what personality does this page project?>",
  "biggest_sin": "<2 sentences>",
  "best_moment": "<2 sentences quoting real text>",
  "weak_sentence": "<exact quote of weakest sentence>",
  "rewrite": "<rewrite of that sentence with actual substance>",
  "differentiation_killer": "<1-2 sentences>",
  "missed_opportunity": "<2 sentences>",
  "brand_theatre_diagnosis": "<2 sentences on brand theatre>",
  "ai_readiness_diagnosis": "<2 sentences on AI search readiness>",
  "rx_language": "<2 sentences: language prescription>",
  "rx_strategy": "<2 sentences: strategy prescription>",
  "verified_unique_claims": ["factual differentiators only, max 10"]
}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errBody.substring(0, 200)}`);
  }

  const data = await resp.json();
  const raw = data.content?.[0]?.text || "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  return { ai: JSON.parse(jsonMatch[0]), wordCount };
}

// ---- Cliché counter (simplified version) ----
const CLICHE_LIST = [
  "world-class", "cutting-edge", "state-of-the-art", "innovative", "transformative",
  "holistic", "dynamic", "robust", "synergy", "leverage", "empower", "foster",
  "cultivate", "nurture", "diverse", "inclusive", "vibrant", "thriving",
  "commitment to excellence", "rigorous", "comprehensive", "hands-on",
  "real-world", "global perspective", "lifelong learning", "thought leader",
  "best-in-class", "next-generation", "groundbreaking", "trailblazing",
  "passionate", "dedicated", "engaged", "inspired", "community of scholars",
  "tradition of excellence", "preparing leaders", "shaping the future",
  "making a difference", "changing the world", "push the boundaries",
  "at the forefront", "second to none", "like no other", "unlike any other",
];

function countCliches(text) {
  const lower = text.toLowerCase();
  const results = [];
  for (const c of CLICHE_LIST) {
    const regex = new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = lower.match(regex);
    if (matches) results.push({ phrase: c, count: matches.length });
  }
  return results.sort((a, b) => b.count - a.count);
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "POST only" }) };

  try { connectLambda(event); } catch {}

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: "No API key" }) };

  const { secret, url: inputUrl } = JSON.parse(event.body || "{}");
  if (secret !== ADMIN_SECRET) return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: "Unauthorized" }) };
  if (!inputUrl) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "url required" }) };

  const url = inputUrl.startsWith("http") ? inputUrl : "https://" + inputUrl;
  let hostname;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Invalid URL" }) };
  }

  console.log(`[reaudit] Starting: ${hostname}`);

  // 1. Scrape homepage
  let hp;
  try {
    hp = await scrapePage(url);
  } catch (err) {
    console.log(`[reaudit] Scrape failed for ${hostname}: ${err.message}`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: false, slug: hostname, error: "scrape_failed", detail: err.message }) };
  }

  const bodyLen = (hp.body_text || "").trim().length;
  if (bodyLen < 50) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: false, slug: hostname, error: "empty_content", bodyLen }) };
  }

  // 2. Scrape sub-pages
  const pages = [{ url, data: hp, type: "homepage" }];
  const linked = (hp.linked_pages || []).slice(0, 3);
  for (const subUrl of linked) {
    try {
      const subData = await scrapePage(subUrl);
      if ((subData.body_text || "").trim().length >= 200) {
        pages.push({ url: subUrl, data: subData, type: subData.page_type || "other" });
      }
    } catch {}
  }

  // 3. Run analysis
  const allH1 = pages.flatMap(p => p.data.h1 || []);
  const allH2 = pages.flatMap(p => p.data.h2s || []);
  const allBody = pages.map(p => p.data.body_text || "").join(" ");

  let ai, wordCount;
  try {
    const result = await analyze(url, hp.body_text || "", allBody, allH1, allH2, hp.meta_description || "", hp.h1 || [], apiKey);
    ai = result.ai;
    wordCount = result.wordCount;
  } catch (err) {
    console.log(`[reaudit] Analysis failed for ${hostname}: ${err.message}`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: false, slug: hostname, error: "analysis_failed", detail: err.message }) };
  }

  // 4. Score calculation (mirrors App.jsx logic)
  const cliches = countCliches(allBody + " " + allH1.join(" ") + " " + allH2.join(" "));
  const totalCliches = cliches.reduce((s, c) => s + c.count, 0);

  const voiceRaw = ((ai.voice_score || 5) / 10) * 100;
  const specRaw = ((ai.specificity_score || 5) / 10) * 100;
  const consistRaw = ((ai.consistency_score || 5) / 10) * 100;
  const theatreRaw = ai.brand_theatre_score ? (1 - (ai.brand_theatre_score / 10)) * 100 : 50;
  const aiReadyRaw = ai.ai_readiness_score ? ((ai.ai_readiness_score / 10) * 100) : 50;

  const langScore = Math.round(voiceRaw * 0.5 + specRaw * 0.3 + consistRaw * 0.2);
  const stratScore = Math.round(theatreRaw * 0.35 + aiReadyRaw * 0.35 + (ai.specificity_ratio || 50) * 0.3);
  const overall = Math.round(langScore * 0.55 + stratScore * 0.45);

  const clampScore = (v) => Math.max(0, Math.min(100, Math.round(v)));

  // 5. Save to leaderboard (retry to handle read-modify-write races)
  const store = getStore("leaderboard");
  const newEntry = {
    name: (hp.title || hostname).substring(0, 100),
    url: hostname,
    overall: clampScore(overall),
    language: clampScore(langScore),
    strategy: clampScore(stratScore),
    cliches: totalCliches,
    pagesAudited: pages.length,
    lastAudited: new Date().toISOString(),
    ai,
    homepageH1: hp.h1 || [],
    allH1,
    allH2: allH2.slice(0, 15),
    metaDesc: hp.meta_description || "",
    uniqueClaims: ai.verified_unique_claims || [],
    scrapeSource: "cheerio",
    scrapeQuality: bodyLen >= 200 ? "full" : "partial",
    wasBlocked: false,
    pagesScraped: pages.map(p => p.url),
    contentHash: "",
    wordCount,
    topCliches: cliches.slice(0, 10),
    clicheBreakdown: null,
  };

  // Write with verification: read, modify, write, then verify it stuck
  let oldScore = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await store.get("schools");
    const data = raw ? JSON.parse(raw) : {};
    const existing = data[hostname];
    if (attempt === 0) oldScore = existing?.overall || null;
    data[hostname] = { ...(existing || {}), ...newEntry, runs: (existing?.runs || 0) + 1 };
    await store.set("schools", JSON.stringify(data));

    // Verify the write persisted
    const verify = await store.get("schools");
    const verifyData = verify ? JSON.parse(verify) : {};
    if (verifyData[hostname]?.overall === clampScore(overall)) {
      break; // Write confirmed
    }
    console.log(`[reaudit] Write verification failed for ${hostname}, attempt ${attempt + 1}`);
    await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
  }

  console.log(`[reaudit] Done: ${hostname} → ${overall}`);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      success: true,
      slug: hostname,
      score: overall,
      language: langScore,
      strategy: stratScore,
      wordCount,
      pagesAudited: pages.length,
      oldScore,
    }),
  };
}

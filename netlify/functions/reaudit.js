/**
 * Batch re-audit endpoint: scrapes a single school, runs analysis, saves to leaderboard.
 * Called by the batch driver script. Requires admin secret.
 *
 * POST { secret, url }
 * Returns { success, slug, score, wordCount } or { error }
 */
import { connectLambda, getStore } from "@netlify/blobs";
import * as cheerio from "cheerio";
import { calculateScores } from "../../src/scoring.js";

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
async function analyze(url, text, allText, h1s, h2s, metaDesc, homepageH1s, apiKey, wasBlocked = false) {
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
${text.substring(0, 12000)}
=== END OF PAGE TEXT ===
Other pages sampled: ${allText.substring(0, 10000)}
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

// Cliché counting and scoring now use the shared module (src/scoring.js + src/constants.js)
// to guarantee identical results between live audits and batch re-audits.

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

  // 4. Score calculation — uses shared module (src/scoring.js)
  // Same cliché database, same penalties, same formula as live audits.
  const uniqueClaims = ai.verified_unique_claims || [];
  const { language: langScore, strategy: stratScore, overall, cliches, totalCliches } = calculateScores({
    allBody, allH1, allH2, metaDesc: hp.meta_description || "", uniqueClaims, ai,
  });

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
    hasAI: true,
    pagesScraped: pages.map(p => p.url),
    contentHash: "",
    wordCount,
    topCliches: cliches.slice(0, 10).map(c => ({ phrase: c.phrase, count: c.count })),
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

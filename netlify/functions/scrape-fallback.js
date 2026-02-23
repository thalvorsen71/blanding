// Lightweight fallback scraper using cheerio when Claude web_search fails.
// Returns the same JSON shape that fetchPage() expects from Claude.
const cheerio = require("cheerio");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { url } = JSON.parse(event.body);
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: "URL required" }) };

    // Only allow .edu domains
    try {
      const hostname = new URL(url).hostname;
      if (!hostname.endsWith(".edu")) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "Only .edu domains are supported" }) };
      }
    } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid URL" }) }; }

    // Fetch with a reasonable timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Strip noise
    $("script, style, noscript, iframe, svg, [hidden], .sr-only").remove();

    // Title
    const title = $("title").first().text().trim() || "";

    // Meta description
    const metaDesc = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";

    // H1s
    const h1 = [];
    $("h1").each((_, el) => { const t = $(el).text().trim(); if (t) h1.push(t); });

    // H2s (first 12)
    const h2s = [];
    $("h2").each((_, el) => { const t = $(el).text().trim(); if (t && h2s.length < 12) h2s.push(t); });

    // Nav items
    const navItems = [];
    $("nav a, header a, [role='navigation'] a").each((_, el) => {
      const t = $(el).text().trim();
      if (t && t.length < 40 && !t.includes("\n") && navItems.length < 20) {
        if (!navItems.includes(t)) navItems.push(t);
      }
    });

    // Body text — get main content area, fall back to body
    let bodyEl = $("main, [role='main'], #main-content, .main-content, article").first();
    if (!bodyEl.length) bodyEl = $("body");

    // Remove ONLY site-chrome elements, preserve content sections
    const bodyClone = bodyEl.clone();
    bodyClone.find("[role='navigation'], [role='contentinfo']").remove();
    // Remove footer but keep header (some sites put hero/featured content in header area)
    bodyClone.find("footer").remove();
    // Remove nav elements but preserve their parent sections
    bodyClone.find("nav").remove();

    let bodyText = bodyClone.text().replace(/\s+/g, " ").trim().substring(0, 6000);

    // If main content area was too sparse, try the full body minus just nav/footer
    if (bodyText.length < 300) {
      const fullClone = $("body").clone();
      fullClone.find("nav, footer, [role='navigation'], [role='contentinfo'], script, style").remove();
      const fullText = fullClone.text().replace(/\s+/g, " ").trim().substring(0, 6000);
      if (fullText.length > bodyText.length) {
        bodyText = fullText;
      }
    }

    // CTAs
    const ctas = [];
    $("a, button").each((_, el) => {
      const t = $(el).text().trim();
      const href = $(el).attr("href") || "";
      const cls = ($(el).attr("class") || "").toLowerCase();
      const isCTA = cls.includes("btn") || cls.includes("cta") || cls.includes("button") ||
                    el.tagName === "button" ||
                    /^(apply|request|visit|explore|learn more|get started|schedule|register|sign up|contact|give|donate)/i.test(t);
      if (isCTA && t && t.length < 50 && ctas.length < 10) {
        if (!ctas.includes(t)) ctas.push(t);
      }
    });

    // Detect page type
    const urlLower = url.toLowerCase();
    let pageType = "homepage";
    if (urlLower.includes("admission")) pageType = "admissions";
    else if (urlLower.includes("about")) pageType = "about";
    else if (urlLower.includes("academic")) pageType = "academics";
    else if (urlLower.includes("student") || urlLower.includes("campus-life")) pageType = "student-life";

    // Internal links (for sub-page discovery)
    const linkedPages = [];
    const base = new URL(url);
    $("a[href]").each((_, el) => {
      try {
        const href = $(el).attr("href");
        if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
        const resolved = new URL(href, url);
        if (resolved.hostname === base.hostname && resolved.pathname !== base.pathname && linkedPages.length < 6) {
          const full = resolved.origin + resolved.pathname;
          if (!linkedPages.includes(full)) linkedPages.push(full);
        }
      } catch {}
    });

    // Fallback: if no internal links found, try common .edu sub-pages
    if (linkedPages.length === 0) {
      const fallbackPaths = ["/about", "/admissions", "/academics", "/student-life", "/about-us", "/why"];
      for (const p of fallbackPaths) {
        if (linkedPages.length >= 3) break;
        linkedPages.push(base.origin + p);
      }
    }

    // Unique claims: ONLY sentences with concrete, verifiable facts
    // Must contain a number/percentage/dollar amount AND be specific to this institution
    const uniqueClaims = [];
    const stockPhrases = [];

    // Stock phrase patterns: generic CTAs and structural phrases
    const stockCTAs = [];
    const ctaPatterns = [
      /^learn more$/i, /^apply now$/i, /^request info/i, /^schedule a visit/i,
      /^explore our/i, /^why choose/i, /^what makes us/i, /^get started/i,
      /^discover/i, /^visit campus/i, /^contact us$/i, /^find out/i,
    ];
    for (const cta of ctas) {
      if (ctaPatterns.some(p => p.test(cta.trim())) && stockCTAs.length < 8) {
        stockCTAs.push(cta.trim());
      }
    }

    // Unique claims: sentences with real numbers that indicate concrete facts
    // Must have a number AND not be a generic marketing sentence
    const numberPattern = /\b\d[\d,.]*%?(?:\s*(?:to|[-–])\s*\d[\d,.]*%?)?\b/;
    const genericFilters = [
      /world-class/i, /cutting-edge/i, /state-of-the-art/i, /transforming/i,
      /vibrant/i, /holistic/i, /innovative/i, /tradition of/i, /empower/i,
      /inclusive/i, /beautiful campus/i, /pushing boundaries/i, /make a difference/i,
      /unlock/i, /imagine the/i, /explore this section/i, /jump to/i,
    ];
    const sentences = bodyText.match(/[^.!?]+[.!?]+/g) || [];
    for (const sent of sentences.slice(0, 50)) {
      const trimmed = sent.trim();
      if (trimmed.length < 20 || trimmed.length > 200) continue;
      // Must contain an actual number (not just any digit)
      if (!numberPattern.test(trimmed)) continue;
      // Skip generic marketing sentences that happen to contain numbers
      if (genericFilters.some(p => p.test(trimmed))) continue;
      // Skip navigation-style text (all caps, very short, etc.)
      if (trimmed.split(/\s+/).length < 5) continue;
      if (uniqueClaims.length < 15) uniqueClaims.push(trimmed.substring(0, 150));
    }

    const result = {
      title,
      meta_description: metaDesc,
      h1,
      h2s,
      nav_items: navItems,
      body_text: bodyText,
      ctas,
      page_type: pageType,
      linked_pages: linkedPages.slice(0, 6),
      unique_claims: uniqueClaims,
      stock_phrases: stockCTAs,
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Scrape timed out" : err.message;
    return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
  }
};

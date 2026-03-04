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

    // Only allow .edu and .ca domains (higher education)
    try {
      const hostname = new URL(url).hostname;
      if (!hostname.endsWith(".edu") && !hostname.endsWith(".ca")) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "Only .edu and .ca domains are supported" }) };
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

    // Extract H1s and H2s BEFORE stripping noise — many schools use
    // sr-only H1s as an accessibility pattern (visual hero is a logo/video,
    // semantic H1 is hidden for screen readers). We need to capture these.
    const h1 = [];
    $("h1").each((_, el) => { const t = $(el).text().trim(); if (t) h1.push(t); });

    const h2s = [];
    $("h2").each((_, el) => { const t = $(el).text().trim(); if (t && h2s.length < 12) h2s.push(t); });

    // Title (also before noise removal, lives in <head>)
    const title = $("title").first().text().trim() || "";

    // Meta description
    const metaDesc = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";

    // NOW strip noise for body text extraction
    $("script, style, noscript, iframe, svg, [hidden], .sr-only").remove();

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
    // Remove search widgets, autocomplete, keyword dumps, form options
    bodyClone.find("select, datalist, [role='listbox'], .autocomplete, .search-results, .search-suggestions").remove();
    // Remove hidden/collapsed elements that often contain keyword lists
    bodyClone.find("[aria-hidden='true'], [hidden], .visually-hidden, .sr-only").remove();

    let bodyText = bodyClone.text().replace(/\s+/g, " ").trim();
    // Strip keyword dumps: sequences of 15+ short items (1-2 words each) that aren't sentences
    bodyText = bodyText.replace(/(?:\b[A-Za-z&'-]{2,20}\b\s+){15,}/g, (match) => {
      // If this run has almost no sentence structure (very few words >15 chars), it's a keyword dump
      const words = match.trim().split(/\s+/);
      const longWords = words.filter(w => w.length > 15);
      if (longWords.length < words.length * 0.1) return " "; // <10% long words = keyword dump
      return match;
    });
    bodyText = bodyText.replace(/\s+/g, " ").trim().substring(0, 6000);

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
    // Strategy: collect ALL internal links, then prioritize brand-relevant pages.
    // A random /news/2024/faculty-award page tells us nothing about brand voice;
    // /about, /admissions, /academics are where brand messaging lives.
    const allLinks = [];
    const base = new URL(url);
    $("a[href]").each((_, el) => {
      try {
        const href = $(el).attr("href");
        if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
        const resolved = new URL(href, url);
        if (resolved.hostname === base.hostname && resolved.pathname !== base.pathname) {
          const full = resolved.origin + resolved.pathname.replace(/\/+$/, "");
          if (!allLinks.includes(full)) allLinks.push(full);
        }
      } catch {}
    });

    // Priority tiers for sub-page selection (highest value for brand audit first)
    const priorityPatterns = [
      // Tier 1: Core brand pages — where the real messaging lives
      /\/(about|about-us|who-we-are|our-story|our-mission|mission|at-a-glance)\b/i,
      /\/(admissions?|apply|undergraduate-admissions?|future-students?|prospective)\b/i,
      /\/(academics?|programs?|majors|areas-of-study|schools?-and-colleges)\b/i,
      // Tier 2: Differentiator pages — why-us, student experience, outcomes
      /\/(why|why-us|why-[a-z]+|student-life|campus-life|experience|outcomes?|results)\b/i,
      /\/(discover|explore|visit|welcome|overview)\b/i,
      // Tier 3: Identity pages — values, diversity, research
      /\/(research|innovation|values|diversity|community|tradition|history)\b/i,
    ];

    // Score each link by priority tier (lower = better)
    const scored = allLinks.map(link => {
      const path = new URL(link).pathname.toLowerCase();
      // Skip deep paths (3+ segments are usually news articles, events, profiles)
      const segments = path.split("/").filter(Boolean);
      if (segments.length > 2) return { link, score: 100 };
      // Skip obvious non-brand pages
      if (/\/(news|events?|calendar|directory|library|login|search|map|careers?|jobs?|hr|faculty|staff|giving|donate|alumni|athletics|sports|store|shop|parking|it-help|help-desk|policy|policies|privacy|terms|sitemap|feed|rss|api|wp-|tag|category)(\b|\/)/i.test(path)) return { link, score: 100 };
      for (let i = 0; i < priorityPatterns.length; i++) {
        if (priorityPatterns[i].test(path)) return { link, score: i };
      }
      return { link, score: 50 }; // unmatched but not excluded
    });

    // Sort by priority, take top 6
    scored.sort((a, b) => a.score - b.score);
    const linkedPages = scored.filter(s => s.score < 100).slice(0, 6).map(s => s.link);

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

    // Unique claims: institutional facts that differentiate this school
    // Must have a meaningful number AND describe the institution itself
    const numberPattern = /\b\d[\d,.]*%?(?:\s*(?:to|[-–])\s*\d[\d,.]*%?)?\b/;
    // Generic marketing language filter
    const genericFilters = [
      /world-class/i, /cutting-edge/i, /state-of-the-art/i, /transforming/i,
      /vibrant/i, /holistic/i, /innovative/i, /tradition of/i, /empower/i,
      /inclusive/i, /beautiful campus/i, /pushing boundaries/i, /make a difference/i,
      /unlock/i, /imagine the/i, /explore this section/i, /jump to/i,
    ];
    // News/press/events noise filter — these have numbers but aren't brand facts
    const noiseFilters = [
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i, // news dates: "February 3, 2026"
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, // day names in news
      /\b(prof\.|professor)\s/i, // faculty news bylines
      /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/, // phone numbers: (800) 543-5317, 800-543-5317
      /\bgift|giving|donat|fundrais|campaign|contribut/i, // fundraising content
      /\bin\s+(the\s+)?news\b/i, // "In the News" sections
      /\b(la\s+opinión|washington post|new york times|nbc|cnn|forbes|reuters)\b/i, // press mentions
      /\bwant to know what/i, // "Want to know what's coming up?"
      /\bfeatured events?\b/i, // event calendar headers
      /\bfinancial\.\s*$/i, // truncated contact info
      /open\s+post\s+by\b/i, // Instagram/social media embeds
      /\b\d{10,}\b/, // Very long numeric IDs (Instagram, social media)
      /\b(instagram|facebook|twitter|tiktok|youtube)\b/i, // Social media references
      /\boffice\s+hours\b/i, // Office hours/contact info
      /\b(EST|CST|MST|PST)\b/, // Timezone references (contact info)
      /\bvisit\s+our\s+campus\b/i, // Generic CTA mixed with numbers
      /\bstill\s+not\s+sure\b/i, // Indecision prompts
    ];
    const sentences = bodyText.match(/[^.!?]+[.!?]+/g) || [];
    for (const sent of sentences.slice(0, 50)) {
      const trimmed = sent.trim();
      if (trimmed.length < 20 || trimmed.length > 200) continue;
      // Must contain an actual number
      if (!numberPattern.test(trimmed)) continue;
      // Skip generic marketing language
      if (genericFilters.some(p => p.test(trimmed))) continue;
      // Skip news, press, fundraising, contact info noise
      if (noiseFilters.some(p => p.test(trimmed))) continue;
      // Skip navigation-style text
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
      stock_phrases: [...new Set(stockCTAs)],
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Scrape timed out" : err.message;
    return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
  }
};

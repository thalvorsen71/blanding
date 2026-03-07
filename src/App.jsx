import { useState, useRef, useEffect, useCallback } from 'react';
import { T, scoreColor, scoreLabel, scoreVerdict, countCliches, countWeightedCliches, highlightCliches, contentRichnessBonus } from './constants';
import { fetchPage, fetchSubPage, deepAnalysis, captureLead } from './api';
import { exportPDF } from './pdf';
import { generateScorecard } from './scorecard';
import { generateBingoCard } from './bingo';
// Logo import removed — tool is personal project, not company-branded

// Simple djb2 hash for content fingerprinting (not cryptographic — just change detection)
function contentHash(str) {
  const s = (str || "").substring(0, 5000);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36); // unsigned, base-36 for compactness
}

/* ═══ SMALL COMPONENTS ═══ */
// Module-level tracker: once a score has animated, it never re-animates
// (even if the component remounts from scrolling). Cleared on new audit.
let _animatedScores = new Set();
function AnimNum({ value, dur = 1400 }) {
  const alreadyDone = _animatedScores.has(value);
  const [d, setD] = useState(alreadyDone ? value : 0);
  const r = useRef(null);
  useEffect(() => {
    if (alreadyDone) { setD(value); return; }
    let s = null;
    const go = ts => { if (!s) s = ts; const p = Math.min((ts - s) / dur, 1); setD(Math.round((1 - Math.pow(1 - p, 3)) * value)); if (p < 1) r.current = requestAnimationFrame(go); else _animatedScores.add(value); };
    r.current = requestAnimationFrame(go);
    return () => cancelAnimationFrame(r.current);
  }, [value, dur, alreadyDone]);
  return <span>{d}</span>;
}

function Ring({ score, size = 140, sw = 5 }) {
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} role="img" aria-label={`Score: ${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a1a1a" strokeWidth={sw} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(score)} strokeWidth={sw}
        strokeDasharray={c} strokeDashoffset={c - (c * score / 100)} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.16,1,0.3,1)" }} />
    </svg>
  );
}

function Pill({ children, color = T.accent }) {
  return <span style={{ background: color + "12", border: "1px solid " + color + "30", borderRadius: 5, padding: "4px 10px", fontSize: 13, color, fontFamily: T.mono, display: "inline-block" }}>{children}</span>;
}

function Spinner({ size = 14 }) {
  return <span role="status" aria-label="Loading" style={{ width: size, height: size, border: "2px solid #222", borderTopColor: T.accent, borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />;
}

/* ═══ SHARE HELPERS ═══ */
const SITE_URL = "https://blandingaudit.netlify.app";

function getShareText(res) {
  return `Our higher ed website just scored ${res.overall}/100 on Blanding.\n\n"${scoreLabel(res.overall)}" — ${scoreVerdict(res.overall)}\n\n${res.totalCliches} clichés across ${res.pagesAnalyzed.length} page${res.pagesAnalyzed.length > 1 ? "s" : ""}.\n\nDoes YOUR .edu actually say anything — or just sound like it does?\n${SITE_URL}\n\n#HigherEd #Branding #Blanding`;
}

function shareTwitter(res) {
  const text = `Our higher ed site scored ${res.overall}/100 on Blanding — "${scoreLabel(res.overall)}"\n\n${res.totalCliches} clichés found. Does YOUR .edu say anything — or just sound like it?\n\n${SITE_URL}\n\n#HigherEd #Blanding`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "width=550,height=420");
}

function shareLinkedIn(res) {
  window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE_URL)}`, "_blank", "width=550,height=420");
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

/* ═══ MAIN APP ═══ */
export default function App() {
  const [mode, setMode] = useState("single");
  const [url1, setUrl1] = useState("");
  const [url2, setUrl2] = useState("");
  const [inputText, setInputText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState([]);
  const [result, setResult] = useState(null);
  const [result2, setResult2] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [copyFB, setCopyFB] = useState(false);
  const [emailModal, setEmailModal] = useState(false);
  const [shareModal, setShareModal] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [challengeUrl, setChallengeUrl] = useState("");
  const [stayName, setStayName] = useState("");
  const [stayEmail, setStayEmail] = useState("");
  const [stayTitle, setStayTitle] = useState("");
  const [staySent, setStaySent] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [auditCount, setAuditCount] = useState(0);
  const [showMethodology, setShowMethodology] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [cachedPrompt, setCachedPrompt] = useState(null); // { entry, url } when a domain has a cached score
  const lastTextHash = useRef(null); // dedup paste-text submissions
  const lastTextTime = useRef(0);    // throttle paste-text (ms)
  const resultRef = useRef(null);
  const methRef = useRef(null);
  const disclaimerRef = useRef(null);
  const progressRef = useRef(null);
  const cachedPromptRef = useRef(null);

  // Fetch audit count on mount for social proof
  useEffect(() => {
    fetch("/.netlify/functions/leaderboard").then(r => r.json()).then(d => {
      if (d.count) setAuditCount(d.count);
      if (d.schools?.length) setLeaderboard(d.schools);
    }).catch(() => {});
  }, []);

  const addProg = useCallback((msg, status = "loading") => {
    setProgress(p => [...p.map(i => i.status === "loading" ? { ...i, status: "done" } : i), { msg, status, id: Date.now() }]);
  }, []);

  const norm = u => { let x = u.trim(); if (!x.match(/^https?:\/\//)) x = "https://" + x; return x; };
  const isEdu = u => { try { const h = new URL(norm(u)).hostname; return h.endsWith(".edu") || h.endsWith(".ca"); } catch { return false; } };

  const fetchLeaderboard = useCallback(async () => {
    if (lbLoading) return;
    setLbLoading(true);
    try {
      const r = await fetch("/.netlify/functions/leaderboard");
      const d = await r.json();
      if (d.schools?.length) setLeaderboard(d.schools);
    } catch (e) { console.warn("Leaderboard fetch failed:", e); }
    setLbLoading(false);
  }, [lbLoading]);

  // Auto-fetch leaderboard on mount for landing page preview
  useEffect(() => { fetchLeaderboard(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitToLeaderboard = useCallback(async (res) => {
    if (!res?.url || !res?.schoolName) return;
    // Only submit to leaderboard if AI analysis succeeded.
    // Without AI, scores are mechanical-only and significantly lower —
    // we don't want a degraded audit to overwrite a good one.
    if (!res.ai) {
      console.warn("[Blanding] Skipping leaderboard submit — AI analysis was unavailable, score would be degraded");
      // Still re-fetch the leaderboard to show current data
      try {
        const r = await fetch("/.netlify/functions/leaderboard");
        const d = await r.json();
        if (d.schools?.length) setLeaderboard(d.schools);
        if (d.count) setAuditCount(d.count);
      } catch {}
      return;
    }
    try {
      await fetch("/.netlify/functions/leaderboard", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: res.schoolName, url: res.url, overall: res.overall,
          language: res.scores?.language, strategy: res.scores?.strategy,
          cliches: res.totalCliches, pagesAudited: res.pagesAnalyzed?.length || 1,
          // Full AI analysis — the meat for reports
          ai: res.ai ? {
            voice_score: res.ai.voice_score,
            specificity_score: res.ai.specificity_score,
            specificity_ratio: res.ai.specificity_ratio,
            consistency_score: res.ai.consistency_score,
            tone_diagnosis: res.ai.tone_diagnosis,
            biggest_sin: res.ai.biggest_sin,
            best_moment: res.ai.best_moment,
            weak_sentence: res.ai.weak_sentence,
            rewrite: res.ai.rewrite,
            differentiation_killer: res.ai.differentiation_killer,
            missed_opportunity: res.ai.missed_opportunity,
            hero_assessment: res.ai.hero_assessment,
            brand_theatre_score: res.ai.brand_theatre_score,
            brand_theatre_diagnosis: res.ai.brand_theatre_diagnosis,
            ai_readiness_score: res.ai.ai_readiness_score,
            ai_readiness_diagnosis: res.ai.ai_readiness_diagnosis,
            rx_language: res.ai.rx_language,
            rx_strategy: res.ai.rx_strategy,
            rx_ai_readiness: res.ai.rx_ai_readiness,
            verified_unique_claims: res.ai.verified_unique_claims,
          } : null,
          // Additional context for reports
          homepageH1: res.homepageH1,
          allH1: res.allH1 || [],
          allH2: (res.allH2 || []).slice(0, 15),
          metaDesc: res.metaDesc,
          uniqueClaims: res.uniqueClaims,
          scrapeSource: res.scrapeSource,
          scrapeQuality: res.scrapeQuality,
          wasBlocked: res.wasBlocked || false,
          pagesScraped: res.pagesScraped || [],
          contentHash: res.contentHash || "",
          wordCount: res.bodyText ? res.bodyText.split(/\s+/).length : 0,
          // Top clichés with severity + placement (for cross-school reporting)
          topCliches: (res.cliches || []).slice(0, 15).map(c => ({
            phrase: c.phrase, count: c.count, severity: c.severity,
          })),
          clicheBreakdown: res.weighted ? {
            h1Count: res.weighted.h1Count,
            h2Count: res.weighted.h2Count,
            weightedTotal: res.weighted.weightedTotal,
            h1Phrases: (res.weighted.h1Cliches || []).map(c => c.phrase),
            h2Phrases: (res.weighted.h2Cliches || []).map(c => c.phrase),
          } : null,
        }),
      });
      // Re-fetch leaderboard after successful submit so new entries appear immediately
      const r = await fetch("/.netlify/functions/leaderboard");
      const d = await r.json();
      if (d.schools?.length) setLeaderboard(d.schools);
      if (d.count) setAuditCount(d.count);
    } catch (e) { console.warn("Leaderboard submit failed:", e); }
  }, []);

  /* ─── AUDIT ENGINE (with retry + parallel sub-pages) ─── */
  async function runAudit(inputUrl, prefix = "") {
    const url = norm(inputUrl);
    if (!isEdu(url)) {
      addProg(prefix + "Only .edu and .ca domains are supported — this tool is built for higher education.", "error");
      return null;
    }
    addProg(prefix + "Fetching: " + url);

    // fetchPage now handles retries + fallback internally
    const hp = await fetchPage(url, (msg) => addProg(prefix + msg));

    if (!hp) {
      addProg(prefix + "Could not reach this site", "error");
      return null;
    }

    // Check for effectively empty content (site blocks scrapers but returns 200)
    const bodyLen = (hp.body_text || "").trim().length;
    const h1Len = (hp.h1 || []).join("").length;
    if (bodyLen < 50 && h1Len < 10) {
      addProg(prefix + "Could not reach this site", "error");
      return null;
    }

    addProg(prefix + 'Loaded: "' + (hp.title || "Untitled") + '"');

    const scrapeSource = hp._source || "unknown"; // "cheerio" or "claude_websearch"
    const scrapeQuality = hp._scrapeQuality || "unknown"; // "full", "partial", or "degraded"
    const wasBlocked = hp._wasBlocked || false; // true if server returned 403/405 to our scraper
    const pages = [{ url, data: hp, type: "homepage" }];
    const linked = (hp.linked_pages || []).slice(0, 3);

    // Fetch sub-pages in parallel
    if (linked.length) {
      addProg(prefix + "Scanning " + linked.length + " sub-pages...");
      const subResults = await Promise.allSettled(
        linked.map(pu => fetchSubPage(pu))
      );
      subResults.forEach((sr, i) => {
        if (sr.status === "fulfilled" && sr.value) {
          pages.push({ url: linked[i], data: sr.value, type: sr.value.page_type || "other" });
        }
      });
      addProg(prefix + `Loaded ${pages.length - 1} sub-page${pages.length - 1 !== 1 ? "s" : ""}`);
    }

    const allH1 = pages.flatMap(p => p.data.h1 || []);
    const allH2 = pages.flatMap(p => p.data.h2s || []);

    addProg(prefix + "Running AI brand analysis...");
    const allBody = pages.map(p => p.data.body_text || "").join(" ");
    let ai;
    try {
      ai = await deepAnalysis(url, hp.body_text || JSON.stringify(hp), allBody, allH1, allH2, hp.meta_description || "", hp.h1 || [], wasBlocked);
    } catch (e) {
      console.warn("[Blanding] Deep analysis attempt 1 failed:", e.message);
      // Rate-limit-aware retry: wait longer for 429s, short wait for other errors
      const isRateLimit = e.name === "RateLimitError" || /rate.?limit|429|too many/i.test(e.message);
      const waitSec = isRateLimit ? Math.min(e.retryAfter || 30, 90) : 3;
      try {
        if (isRateLimit) addProg(prefix + `Rate limited — waiting ${waitSec}s before retry...`);
        else addProg(prefix + "Retrying AI analysis...");
        await new Promise(r => setTimeout(r, waitSec * 1000));
        ai = await deepAnalysis(url, hp.body_text || JSON.stringify(hp), allBody, allH1, allH2, hp.meta_description || "", hp.h1 || [], wasBlocked);
      } catch (e2) {
        console.warn("[Blanding] Deep analysis attempt 2 failed:", e2.message);
        addProg(prefix + "AI analysis unavailable — using cliché data only", "error");
        ai = null;
      }
    }
    // Prefer AI-curated unique claims (from deep analysis) over Cheerio regex guesses
    const cheerioUniq = [...new Set(pages.flatMap(p => p.data.unique_claims || []))].slice(0, 10);
    const uniq = (ai?.verified_unique_claims?.length > 0) ? ai.verified_unique_claims : cheerioUniq;
    const cliches = countCliches(allBody + " " + allH1.join(" ") + " " + allH2.join(" "));
    const totalC = cliches.reduce((s, c) => s + c.count, 0);
    const wc = allBody.split(/\s+/).length;

    // Weighted cliché analysis: H1 clichés hurt 3x, H2/meta 2x, body 1x
    const weighted = countWeightedCliches(allBody, allH1, allH2, hp.meta_description || "");

    // Content richness bonus: rewards specific, distinctive content (0-30 pts)
    const richness = contentRichnessBonus(allBody, allH1, allH2, uniq);

    // H1/H2 brand quality: reward distinctive headlines, penalize generic ones
    const h1Cliches = weighted.h1Count;
    const h2Cliches = weighted.h2Count;
    const h1Total = allH1.filter(h => h.trim().length > 3).length;
    const h2Total = allH2.filter(h => h.trim().length > 3).length;
    // If most headlines are cliché-free, that's a brand voice signal
    const headlineQuality = (h1Total + h2Total) > 0
      ? Math.round(((h1Total + h2Total - h1Cliches - h2Cliches) / (h1Total + h2Total)) * 10)
      : 0;

    // Language score: penalizes cliché usage with logarithmic curve.
    // Logarithmic penalty: first few clichés hurt a lot, diminishing pain after that.
    // log(1+1)*14=9.7, log(5+1)*14=25.1, log(10+1)*14=33.5, log(20+1)*14=42.6, log(40+1)*14=52
    const countPenalty = Math.min(Math.log(cliches.length + 1) * 14, 50);
    // Density penalty: clichés per 100 words, weighted by severity + placement.
    const densityPenalty = Math.min((weighted.weightedTotal / Math.max(wc / 100, 1)) * 4, 35);
    // Non-additive: take the WORSE of count vs density, then add 30% of the other.
    // This prevents double-punishing — a page shouldn't lose -45 AND -35.
    const primaryPenalty = Math.max(countPenalty, densityPenalty);
    const secondaryPenalty = Math.min(countPenalty, densityPenalty);
    let lang = 100 - primaryPenalty - (secondaryPenalty * 0.3) - (uniq.length < 2 ? 8 : 0);
    // H1 cliché penalty: using platitudes in your headline is a brand crime
    if (weighted.h1Count > 0) lang -= Math.min(weighted.h1Count * 5, 15);
    // "Rich content bonus": if you have strong specific content, give partial credit back.
    // Previously this was a PENALTY for having rich content + clichés — that's backwards.
    // Now: rich content earns back some of what clichés took away.
    if (richness > 12) lang += Math.min(Math.round(richness * 0.4), 8);
    // Thin content penalty: saying nothing isn't the same as being distinctive.
    if (wc < 300) lang -= Math.round((300 - wc) / 25);
    // AI voice score: dynamic blend based on mechanical score confidence.
    // High mechanical scores (lots of data) = trust mechanical more.
    // Low mechanical scores (thin data) = lean on AI more.
    const mechWeight = 0.4 + (Math.min(lang, 80) / 100) * 0.25; // range: 0.4 to 0.6
    if (ai?.voice_score) lang = Math.round(lang * mechWeight + ai.voice_score * 10 * (1 - mechWeight));
    lang = Math.max(0, Math.min(100, Math.round(lang)));

    // Strategy score: mechanical base from content signals, then one-step AI blend.
    // All AI inputs are combined in a single weighted average to avoid cascading dilution.
    // Unique claims have diminishing returns: first 3 = full value (5pts each),
    // next 3 = half value (2.5pts each), beyond 6 = minimal (1pt each, cap 5).
    // This prevents news-feed-heavy pages from inflating strategy through volume alone.
    const uniqBase = Math.min(uniq.length, 3) * 5;
    const uniqMid = Math.min(Math.max(uniq.length - 3, 0), 3) * 2.5;
    const uniqTail = Math.min(Math.max(uniq.length - 6, 0), 5) * 1;
    const uniqContrib = uniqBase + uniqMid + uniqTail; // max ~27.5 (was unlimited at 5 per)
    let mechStrat = 30 + uniqContrib + Math.min(richness * 0.5, 10) + Math.min(headlineQuality, 8);
    mechStrat = Math.max(0, Math.min(100, mechStrat));
    let strat;
    if (ai?.specificity_score && ai?.consistency_score) {
      // Single-step blend: 55% mechanical, 20% specificity, 15% consistency, 10% ratio
      const aiSpec = ai.specificity_score * 10;
      const aiCons = ai.consistency_score * 10;
      const aiRatio = ai.specificity_ratio != null ? Math.max(0, Math.min(100, ai.specificity_ratio)) : aiSpec;
      strat = Math.round(mechStrat * 0.55 + aiSpec * 0.20 + aiCons * 0.15 + aiRatio * 0.10);
    } else {
      strat = mechStrat;
    }
    // Ratio ceiling: a mostly-generic page can't score above its reality
    if (ai?.specificity_ratio != null) {
      const ratioCeiling = Math.max(0, Math.min(100, ai.specificity_ratio)) + 20;
      if (strat > ratioCeiling) strat = Math.round(strat * 0.6 + ratioCeiling * 0.4);
    }
    // Brand theatre penalty: strategy-only modifier (theatre is a positioning problem, not a language one)
    // Kicks in at 4+, gentle curve, caps at -15. This is a supporting signal, not a primary dimension.
    if (ai?.brand_theatre_score && ai.brand_theatre_score >= 4) {
      const theatrePenalty = Math.min((ai.brand_theatre_score - 3) * 2.5, 15);
      strat -= theatrePenalty;
    }
    // AI readiness: gentle nudge on strategy only
    // 5 is neutral; each point away from 5 = ±2 points (range: -8 to +10)
    if (ai?.ai_readiness_score) {
      const aiReadinessImpact = (ai.ai_readiness_score - 5) * 2;
      strat += Math.max(-8, Math.min(10, aiReadinessImpact));
    }
    strat = Math.max(0, Math.min(100, Math.round(strat)));

    const overall = Math.round(lang * 0.55 + strat * 0.45);
    return {
      url, schoolName: hp.title || url, pagesAnalyzed: pages, overall,
      scores: { language: lang, strategy: strat },
      cliches, totalCliches: totalC,
      uniqueClaims: uniq,
      homepageH1: hp.h1 || [], allH1, allH2, metaDesc: hp.meta_description || "", bodyText: allBody, ai,
      scrapeSource, scrapeQuality, wasBlocked, weighted,
      pagesScraped: pages.map(p => p.url), // actual URLs scraped for transparency
      contentHash: contentHash(allBody),   // fingerprint for change detection
    };
  }

  const scrollToResult = () => setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);

  // Check if a domain already has a cached leaderboard entry
  const findCachedEntry = (inputUrl) => {
    try {
      const hostname = new URL(norm(inputUrl)).hostname.replace(/^www\./, "");
      return leaderboard.find(e => e.url === hostname);
    } catch { return null; }
  };

  const runFreshAudit = async () => {
    setCachedPrompt(null);
    _animatedScores.clear(); setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview");
    const r = await runAudit(url1);
    if (r) { setResult(r); submitToLeaderboard(r); }
    setProgress(p => p.map(i => i.status === "error" ? i : { ...i, status: "done" }));
    setAnalyzing(false);
    if (r) scrollToResult(); else setTimeout(() => progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };

  const runSingle = async () => {
    // Clear previous results so UI resets
    setResult(null); setResult2(null); setProgress([]);
    // Check for cached leaderboard entry before burning API calls
    const cached = findCachedEntry(url1);
    if (cached) {
      setCachedPrompt(cached);
      setTimeout(() => cachedPromptRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      return; // Show cached prompt UI instead of running audit
    }
    runFreshAudit();
  };

  const runCompare = async () => { _animatedScores.clear(); setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview"); addProg("Starting head-to-head audit..."); const r1 = await runAudit(url1, "A → "); const r2 = await runAudit(url2, "B → "); if (r1) { setResult(r1); submitToLeaderboard(r1); } if (r2) { setResult2(r2); submitToLeaderboard(r2); } setProgress(p => p.map(i => i.status === "error" ? i : { ...i, status: "done" })); setAnalyzing(false); if (r1 || r2) scrollToResult(); else setTimeout(() => progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300); };

  const runText = async () => {
    if (inputText.trim().length < 50) return;
    // Dedup: skip if identical text was just analyzed (hash match + 10s throttle)
    const hash = contentHash(inputText);
    const now = Date.now();
    if (hash === lastTextHash.current && now - lastTextTime.current < 10000) {
      console.warn("[Blanding] Skipping duplicate paste-text analysis (same content within 10s)");
      return;
    }
    lastTextHash.current = hash;
    lastTextTime.current = now;
    _animatedScores.clear(); setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview");
    addProg("Analyzing copy..."); const cl = countCliches(inputText); const tc = cl.reduce((s, c) => s + c.count, 0);
    addProg("Running AI analysis..."); const ai = await deepAnalysis("(pasted text)", inputText, "");
    let lang = 100 - Math.min(cl.length * 3, 50) - Math.min((tc / Math.max(inputText.split(/\s+/).length / 100, 1)) * 7, 30);
    if (ai?.voice_score) lang = Math.round(lang * 0.6 + ai.voice_score * 10 * 0.4);
    lang = Math.max(0, Math.min(100, lang));
    setResult({ url: null, schoolName: "Your Copy", pagesAnalyzed: [{ type: "text" }], overall: lang, scores: { language: lang, strategy: null }, cliches: cl, totalCliches: tc, uniqueClaims: [], allH1: [], allH2: [], metaDesc: "", bodyText: inputText, ai });
    setProgress(p => p.map(i => i.status === "error" ? i : { ...i, status: "done" })); setAnalyzing(false); scrollToResult();
  };

  const handleStayInTouch = async () => {
    if (!stayEmail.includes("@")) return;
    await captureLead(stayEmail, result?.schoolName, result?.overall, stayName, stayTitle, "stay_in_touch");
    setStaySent(true);
    // Bonus: auto-generate their PDF report as a thank-you
    if (result) setTimeout(() => exportPDF(result), 800);
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(getShareText(result));
    setCopyFB(true); setTimeout(() => setCopyFB(false), 2500);
  };

  const handleExport = () => { setEmailModal(true); };

  const handleEmailSubmit = async () => {
    if (!email.includes("@")) return;
    await captureLead(email, result?.schoolName, result?.overall);
    setEmailSent(true);
    setTimeout(() => { setEmailModal(false); setEmailSent(false); exportPDF(result); }, 1000);
  };

  const handleScorecard = async () => {
    if (!result) return;
    const canvas = await generateScorecard(result);
    downloadCanvas(canvas, `blanding-${result.schoolName.replace(/\s+/g, "-").toLowerCase()}.png`);
  };

  const handleBingo = async () => {
    if (!result) return;
    const canvas = await generateBingoCard(result);
    downloadCanvas(canvas, `bingo-${result.schoolName.replace(/\s+/g, "-").toLowerCase()}.png`);
  };

  const handleChallenge = () => {
    if (!challengeUrl.trim() || !result) return;
    setMode("compare");
    setUrl1(result.url || "");
    setUrl2(challengeUrl);
    setResult(null); setResult2(null); setProgress([]);
    setTimeout(() => runCompare(), 100);
  };

  /* ═══ RESULT BLOCK ═══ */
  function ResultBlock({ res, compact }) {
    if (!res) return null;
    const dims = [{ key: "language", label: "Language & Voice" }, { key: "strategy", label: "Content Strategy" }].filter(d => res.scores[d.key] != null);
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="result-card" style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 14, padding: compact ? "24px 16px" : "36px 28px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 280, height: 280, background: `radial-gradient(circle, ${scoreColor(res.overall)}11 0%, transparent 70%)`, pointerEvents: "none" }} />
          {res.url && <div style={{ fontSize: 13, fontFamily: T.mono, color: T.dim, marginBottom: 4, position: "relative", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{res.url}</div>}
          <div style={{ fontSize: 12, fontFamily: T.mono, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14, position: "relative" }}>{res.pagesAnalyzed.length} page{res.pagesAnalyzed.length > 1 ? "s" : ""} audited</div>
          <div style={{ position: "relative", display: "inline-block" }}>
            <Ring score={res.overall} size={compact ? 110 : 140} />
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: compact ? 36 : 46, fontFamily: T.serif, color: scoreColor(res.overall), lineHeight: 1 }}><AnimNum value={res.overall} /></div>
              <div style={{ fontSize: 13, color: T.dim, fontFamily: T.mono }}>/100</div>
            </div>
          </div>
          <div style={{ fontSize: compact ? 16 : 20, fontFamily: T.serif, fontStyle: "italic", color: scoreColor(res.overall), marginTop: 8, position: "relative" }}>{scoreLabel(res.overall)}</div>
          {!compact && <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, maxWidth: 480, margin: "12px auto 0", position: "relative" }}>{scoreVerdict(res.overall)}</p>}
          {dims.length > 1 && (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${dims.length}, 1fr)`, gap: 1, marginTop: 20, background: T.border, borderRadius: 8, overflow: "hidden", position: "relative" }}>
              {dims.map(d => <div key={d.key} style={{ background: "#121212", padding: compact ? "10px 4px" : "14px 6px" }}><div style={{ fontSize: compact ? 20 : 26, fontFamily: T.serif, color: scoreColor(res.scores[d.key]) }}>{res.scores[d.key]}</div><div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, marginTop: 2, textTransform: "uppercase" }}>{d.label}</div></div>)}
            </div>
          )}
        </div>
        {!compact && leaderboard.length >= 3 && (() => {
          const verified = leaderboard.filter(s => s.scrapeSource !== "claude_websearch");
          if (verified.length < 3) return null;
          const below = verified.filter(s => s.overall < res.overall).length;
          const pct = Math.round((below / verified.length) * 100);
          return (
            <div style={{ marginTop: 12, position: "relative" }}>
              <Pill color={scoreColor(res.overall)}>Better than {pct}% of {verified.length} verified institutions</Pill>
            </div>
          );
        })()}
        {!compact && res.pagesAnalyzed?.length <= 1 && (res.bodyText || "").split(/\s+/).length < 400 && (
          <div style={{ background: "#1a1a00", border: "1px solid #3d3d00", borderRadius: 8, padding: "10px 14px", marginTop: 10, display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            <span style={{ fontSize: 14 }}>⚠</span>
            <div style={{ fontSize: 13, color: "#cca700", margin: 0, fontFamily: T.mono, lineHeight: 1.6 }}>
              <p style={{ margin: 0 }}>Limited content detected — this site likely uses heavy JavaScript rendering. Score based on what we could extract; full picture may differ.</p>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#aa8800" }}>Worth noting: if our scraper can't read this site, neither can AI search tools like ChatGPT, Perplexity, or Claude. That means prospective students using AI to research schools may not see this institution's content at all. <a href="https://web.dev/articles/rendering-on-the-web" target="_blank" rel="noopener noreferrer" style={{ color: "#cca700", textDecoration: "underline" }}>Learn how to fix this →</a></p>
            </div>
          </div>
        )}
        {res.ai?.tone_diagnosis && (
          <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "18px", marginTop: 12, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${T.accent}, ${T.accentLight}, ${T.accent})` }} />
            <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Brand Personality</div>
            <p style={{ fontSize: compact ? 13 : 15, fontFamily: T.serif, fontStyle: "italic", color: T.text, lineHeight: 1.5, margin: 0, paddingLeft: 12, borderLeft: "2px solid " + T.accent }}>{res.ai.tone_diagnosis}</p>
          </div>
        )}
      </div>
    );
  }

  /* ═══ TAB CONTENT ═══ */
  function TabContent({ res }) {
    const tabs = ["overview", "language", "highlighted", "strategy", "leaderboard", "prescriptions", "methodology"];
    const labels = { overview: "Overview", language: "Clichés", highlighted: "Highlighted Text", strategy: "Strategy", leaderboard: "Leaderboard", prescriptions: "Rx: Fix It", methodology: "How We Score" };
    const avail = tabs.filter(t => {
      if (t === "strategy") return res.scores.strategy != null;
      if (t === "highlighted") return res.bodyText && res.bodyText.trim().length > 100;
      if (t === "prescriptions") return !!res.ai?.rx_language;
      return true;
    });

    return (
      <>
        <div className="tab-bar" role="tablist" aria-label="Audit result tabs" style={{ display: "flex", gap: 4, marginTop: 20, overflowX: "auto", paddingBottom: 4 }}>
          {avail.map(t => <button key={t} role="tab" aria-selected={activeTab === t} onClick={() => { setActiveTab(t); if (t === "leaderboard") fetchLeaderboard(); }} style={{ padding: "7px 14px", borderRadius: 6, border: `1px solid ${activeTab === t ? T.accent : T.borderLight}`, background: activeTab === t ? T.accent + "15" : "transparent", color: activeTab === t ? T.accent : T.dim, fontSize: 13, fontFamily: T.mono, whiteSpace: "nowrap" }}>{labels[t]}</button>)}
        </div>
        <div style={{ marginTop: 14 }}>

          {/* OVERVIEW */}
          {activeTab === "overview" && res.ai && (
            <div style={{ display: "grid", gap: 12 }}>
              {/* HERO TAGLINE — show the HOMEPAGE H1 only */}
              {res.homepageH1 && res.homepageH1.length > 0 && (
                <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", letterSpacing: "0.08em" }}>Hero Tagline (H1)</span>
                  </div>
                  <p style={{ fontSize: 18, fontFamily: T.serif, fontStyle: "italic", color: T.text, margin: "0 0 8px", lineHeight: 1.4 }}>"{res.homepageH1[0]}"</p>
                  {res.ai.hero_assessment && <p style={{ fontSize: 13, color: T.dim, lineHeight: 1.55, margin: 0 }}>{res.ai.hero_assessment}</p>}
                </div>
              )}
              <div className="overview-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[{ l: "Biggest Sin", v: res.ai.biggest_sin, c: "#ef4444" }, { l: "Best Moment", v: res.ai.best_moment, c: "#22c55e" }, { l: "Differentiation Killer", v: res.ai.differentiation_killer, c: "#f97316" }, { l: "Missed Opportunity", v: res.ai.missed_opportunity, c: "#eab308" }].map((it, i) => (
                  <div key={i} style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 12, fontFamily: T.mono, color: it.c, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{it.l}</div>
                    <p style={{ fontSize: 14, color: T.text, lineHeight: 1.55, margin: 0 }}>{it.v}</p>
                  </div>
                ))}
              </div>
              {/* BRAND THEATRE & AI READINESS */}
              {(res.ai.brand_theatre_diagnosis || res.ai.ai_readiness_diagnosis) && (
                <div className="overview-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {res.ai.brand_theatre_diagnosis && (
                    <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 16 }}>
                      <div style={{ fontSize: 12, fontFamily: T.mono, color: "#a855f7", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Brand Theatre {res.ai.brand_theatre_score ? <span style={{ opacity: 0.7 }}>({res.ai.brand_theatre_score}/10)</span> : ""}</div>
                      <p style={{ fontSize: 14, color: T.text, lineHeight: 1.55, margin: 0 }}>{res.ai.brand_theatre_diagnosis}</p>
                    </div>
                  )}
                  {res.ai.ai_readiness_diagnosis && (
                    <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 16 }}>
                      <div style={{ fontSize: 12, fontFamily: T.mono, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>AI Search Readiness {res.ai.ai_readiness_score ? <span style={{ opacity: 0.7 }}>({res.ai.ai_readiness_score}/10)</span> : ""}</div>
                      <p style={{ fontSize: 14, color: T.text, lineHeight: 1.55, margin: 0 }}>{res.ai.ai_readiness_diagnosis}</p>
                    </div>
                  )}
                </div>
              )}
              {/* BOT-BLOCKING ALERT */}
              {res.wasBlocked && (
                <div style={{ background: "linear-gradient(135deg, #1a0f00 0%, #1a1000 100%)", border: "1px solid #b45309", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 16 }}>🚫</span> Bot-Blocking Detected
                  </div>
                  <p style={{ fontSize: 14, color: "#fbbf24", lineHeight: 1.6, margin: "0 0 8px 0" }}>
                    This website actively blocks automated crawlers. Our scraper received an HTTP 403 (Forbidden) response, which means AI search engines like ChatGPT, Perplexity, and Google AI Overviews likely cannot access this content either.
                  </p>
                  <p style={{ fontSize: 13, color: "#d4a259", lineHeight: 1.55, margin: 0 }}>
                    <strong style={{ color: "#fbbf24" }}>Why this matters:</strong> A growing share of prospective students use AI tools to research colleges. If your site blocks bots, AI cannot recommend you — no matter how good your content is. This score is based on limited data we could access; the actual page may contain stronger content than what we were able to evaluate.
                  </p>
                </div>
              )}
              {res.ai.weak_sentence && res.ai.rewrite && res.ai.weak_sentence !== "NO_CONTENT" && !res.ai.weak_sentence.toLowerCase().includes("no clear example") && !res.ai.rewrite.toLowerCase().includes("cannot rewrite") && !res.ai.rewrite.includes("NO_CONTENT") && (
                <div style={{ background: T.cardAlt, borderRadius: 10, overflow: "hidden", border: "1px solid " + T.border }}>
                  <div style={{ padding: "8px 16px", borderBottom: "1px solid " + T.border, fontSize: 12, fontFamily: T.mono, color: T.accent, textTransform: "uppercase" }}>What If You Actually Said Something?</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: T.border }}>
                    <div style={{ background: T.cardAlt, padding: "14px 16px" }}><div style={{ fontSize: 11, fontFamily: T.mono, color: "#ef4444", textTransform: "uppercase", marginBottom: 6 }}>Their Version</div><p style={{ fontSize: 14, color: "#888", lineHeight: 1.55, margin: 0, fontStyle: "italic" }}>"{res.ai.weak_sentence}"</p></div>
                    <div style={{ background: T.cardAlt, padding: "14px 16px" }}><div style={{ fontSize: 11, fontFamily: T.mono, color: "#22c55e", textTransform: "uppercase", marginBottom: 6 }}>With a Pulse</div><p style={{ fontSize: 14, color: T.text, lineHeight: 1.55, margin: 0 }}>"{res.ai.rewrite}"</p></div>
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === "overview" && !res.ai && (
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "24px 20px", textAlign: "center" }}>
              <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, margin: 0 }}>AI brand analysis wasn't available for this scan — this can happen with JavaScript-heavy sites or when the analysis times out. The cliché and strategy scores above are still based on what we could extract. Try scanning again, or check the <strong>Clichés</strong> and <strong>Strategy</strong> tabs for details.</p>
            </div>
          )}

          {/* CLICHÉS — word cloud */}
          {activeTab === "language" && (
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, textTransform: "uppercase" }}>Cliché Inventory</span>
                <span style={{ fontSize: 13, fontFamily: T.mono, color: T.dim }}>{res.totalCliches} total / {res.cliches.length} unique</span>
              </div>
              {res.cliches.length === 0 ? <p style={{ color: "#22c55e", fontSize: 13 }}>No common clichés detected.</p> :
                (() => {
                  const maxCount = Math.max(...res.cliches.map(c => c.count));
                  const sorted = [...res.cliches].sort(() => Math.random() - 0.5); // shuffle for cloud feel
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", padding: "10px 0" }}>
                      {sorted.map((c, i) => {
                        const weight = c.count / maxCount;
                        const size = 12 + Math.round(weight * 16);
                        const opacity = 0.45 + weight * 0.55;
                        return (
                          <span key={i} style={{
                            fontSize: size, fontFamily: T.serif, fontStyle: "italic",
                            color: `rgba(239, 68, 68, ${opacity})`,
                            padding: "4px 10px", borderRadius: 6,
                            background: `rgba(239, 68, 68, ${0.04 + weight * 0.08})`,
                            border: `1px solid rgba(239, 68, 68, ${0.1 + weight * 0.15})`,
                            whiteSpace: "nowrap", lineHeight: 1.3,
                          }}>
                            {c.phrase}{c.count > 1 && <span style={{ fontSize: 12, fontFamily: T.mono, opacity: 0.6, marginLeft: 4 }}>×{c.count}</span>}
                          </span>
                        );
                      })}
                    </div>
                  );
                })()
              }
            </div>
          )}

          {/* HIGHLIGHTED TEXT */}
          {activeTab === "highlighted" && res.bodyText && (
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, textTransform: "uppercase" }}>Your Copy — Clichés Highlighted</div>
                {res.scrapeSource && (
                  <span style={{ fontSize: 11, fontFamily: T.mono, color: res.scrapeSource === "cheerio" ? "#22c55e" : "#eab308", background: res.scrapeSource === "cheerio" ? "#22c55e12" : "#eab30812", border: `1px solid ${res.scrapeSource === "cheerio" ? "#22c55e30" : "#eab30830"}`, borderRadius: 4, padding: "2px 8px" }}>
                    {res.scrapeSource === "cheerio" ? "✓ Direct HTML extract" : "⚠ AI-assisted scrape"}
                  </span>
                )}
              </div>
              {res.pagesScraped?.length > 0 && (
                <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, margin: "6px 0 10px", lineHeight: 1.6 }}>
                  <span style={{ color: T.muted }}>Pages scanned:</span>{" "}
                  {res.pagesScraped.map((u, i) => (
                    <span key={i}>{i > 0 && " · "}<a href={u.startsWith("http") ? u : "https://" + u} target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "none", borderBottom: "1px solid " + T.accent + "40" }}>{u.replace(/^https?:\/\/(www\.)?/, "")}</a></span>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 13, fontFamily: T.mono, color: T.dim, marginBottom: 14 }}>
                {res.scrapeSource === "cheerio"
                  ? <>This is the <strong style={{ color: "#22c55e" }}>exact text</strong> extracted from the page HTML. Every <span style={{ background: "#ef444425", color: "#ef4444", padding: "1px 4px", borderRadius: 3 }}>highlighted phrase</span> could appear on any college website.</>
                  : <>This text was extracted using AI web search (the site may use heavy JavaScript). Every <span style={{ background: "#ef444425", color: "#ef4444", padding: "1px 4px", borderRadius: 3 }}>highlighted phrase</span> could appear on any college website.</>
                }
              </p>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: "#bbb", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {highlightCliches(res.bodyText.substring(0, 4000)).map((seg, i) =>
                  seg.hl ? <span key={i} style={{ background: "#ef444420", color: "#ef4444", padding: "1px 3px", borderRadius: 3, borderBottom: "2px solid #ef444460", fontWeight: 500 }}>{seg.text}</span> : <span key={i}>{seg.text}</span>
                )}
              </div>
            </div>
          )}

          {/* STRATEGY */}
          {activeTab === "strategy" && (
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 12, fontFamily: T.mono, color: "#22c55e", textTransform: "uppercase", marginBottom: 8 }}>Unique Claims ({res.uniqueClaims.length})</div>
              {res.uniqueClaims.length ? res.uniqueClaims.map((c, i) => <p key={i} style={{ fontSize: 13, color: T.text, lineHeight: 1.5, margin: "0 0 6px", padding: "4px 0", borderBottom: i < res.uniqueClaims.length - 1 ? "1px solid " + T.border : "none" }}>{c}</p>) : <p style={{ fontSize: 13, color: "#ef4444" }}>No ownable claims found.</p>}
            </div>
          )}

          {/* LEADERBOARD */}
          {activeTab === "leaderboard" && (() => {
            const verified = leaderboard.filter(s => s.scrapeSource !== "claude_websearch");
            const limited = leaderboard.filter(s => s.scrapeSource === "claude_websearch");
            return (
            <div style={{ display: "grid", gap: 12 }}>
              {/* ZONE 1: VERIFIED AUDITS */}
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "20px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", letterSpacing: "0.1em" }}>✓ Verified Audits</div>
                    <div style={{ fontSize: 13, color: T.dim, marginTop: 2 }}>{verified.length} institutions ranked by full HTML analysis</div>
                  </div>
                  <button onClick={fetchLeaderboard} disabled={lbLoading}
                    style={{ padding: "6px 14px", background: T.cardAlt, border: "1px solid " + T.borderLight, borderRadius: 6, color: T.dim, fontSize: 12, fontFamily: T.mono }}>
                    {lbLoading ? "Loading..." : "Refresh"}
                  </button>
                </div>
                {verified.length === 0 && !lbLoading && (
                  <p style={{ color: T.dim, fontSize: 13, textAlign: "center", padding: "30px 20px", fontFamily: T.serif, fontStyle: "italic" }}>No schools ranked yet. Every audit automatically adds to the leaderboard — yours could be first.</p>
                )}
                {verified.map((s, i) => {
                  const isYou = res.url && s.url && res.url.includes(s.url);
                  return (
                    <div key={s.url} style={{
                      display: "grid", gridTemplateColumns: "32px 1fr 60px 60px 60px", gap: 8, alignItems: "center",
                      padding: "10px 12px", borderRadius: 8, marginBottom: 2,
                      background: isYou ? T.accent + "12" : (i % 2 === 0 ? "transparent" : T.cardAlt),
                      border: isYou ? "1px solid " + T.accent + "40" : "1px solid transparent",
                    }}>
                      <span style={{ fontSize: 14, fontFamily: T.mono, color: i < 3 ? T.accent : T.dim, fontWeight: i < 3 ? 700 : 400, textAlign: "center" }}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: isYou ? T.accent : T.text, fontWeight: isYou ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.name}{isYou && <span style={{ fontSize: 12, marginLeft: 6, color: T.accent, fontFamily: T.mono }}>← YOU</span>}
                          {s.wasBlocked && <span title="This site blocks automated crawlers (AI search engines likely can't access it either)" style={{ fontSize: 10, marginLeft: 6, color: "#f59e0b", fontFamily: T.mono, cursor: "help" }}>🚫 blocks bots</span>}
                          {!s.wasBlocked && s.scrapeQuality && s.scrapeQuality !== "full" && s.scrapeQuality !== "unknown" && <span title="Score is based on limited data and may be lower than actual" style={{ fontSize: 10, marginLeft: 6, color: "#e6a817", fontFamily: T.mono, cursor: "help" }}>⚠ partial data</span>}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim }}>{s.url}</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontFamily: T.serif, color: scoreColor(s.overall) }}>{s.overall}</div>
                        <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Overall</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontFamily: T.serif, color: s.language != null ? scoreColor(s.language) : T.dim }}>{s.language ?? "–"}</div>
                        <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Lang</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontFamily: T.serif, color: s.strategy != null ? scoreColor(s.strategy) : T.dim }}>{s.strategy ?? "–"}</div>
                        <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Strat</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ZONE DIVIDER */}
              {limited.length > 0 && (
                <div style={{ background: "#1a1a00", border: "1px solid #3d3d00", borderRadius: 8, padding: "14px 20px" }}>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color: "#eab308", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>⚠ Limited Data Zone</div>
                  <p style={{ fontSize: 13, color: "#cca700", margin: 0, lineHeight: 1.6 }}>
                    The following {limited.length} schools blocked direct HTML scraping. Their scores are based on AI web search (avg ~162 words vs. ~1,671 for verified audits) and are not directly comparable. They are listed alphabetically, unranked, until they can be re-audited with better data.
                  </p>
                </div>
              )}

              {/* ZONE 2: LIMITED DATA (unranked) */}
              {limited.length > 0 && (
                <div style={{ background: T.card, border: "1px solid #3d3d00", borderRadius: 10, padding: "20px 24px" }}>
                  {[...limited].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((s) => {
                    const isYou = res.url && s.url && res.url.includes(s.url);
                    return (
                      <div key={s.url} style={{
                        display: "grid", gridTemplateColumns: "32px 1fr 60px 60px 60px", gap: 8, alignItems: "center",
                        padding: "10px 12px", borderRadius: 8, marginBottom: 2,
                        background: isYou ? T.accent + "12" : "transparent",
                        border: isYou ? "1px solid " + T.accent + "40" : "1px solid transparent",
                        opacity: 0.7,
                      }}>
                        <span style={{ fontSize: 12, fontFamily: T.mono, color: "#eab308", textAlign: "center" }}>⚠</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: isYou ? T.accent : T.text, fontWeight: isYou ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.name}{isYou && <span style={{ fontSize: 12, marginLeft: 6, color: T.accent, fontFamily: T.mono }}>← YOU</span>}
                          </div>
                          <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim }}>{s.url}</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 16, fontFamily: T.serif, color: "#eab308" }}>{s.overall}<span style={{ fontSize: 10, verticalAlign: "super" }}>*</span></div>
                          <div style={{ fontSize: 9, fontFamily: T.mono, color: "#eab308", textTransform: "uppercase" }}>Limited</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 14, fontFamily: T.serif, color: "#eab308" }}>{s.language ?? "–"}<span style={{ fontSize: 10, verticalAlign: "super" }}>*</span></div>
                          <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Lang</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 14, fontFamily: T.serif, color: "#eab308" }}>{s.strategy ?? "–"}<span style={{ fontSize: 10, verticalAlign: "super" }}>*</span></div>
                          <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Strat</div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ textAlign: "center", marginTop: 8 }}>
                    <span style={{ fontSize: 11, fontFamily: T.mono, color: "#eab308" }}>* Scores based on limited AI web search data, not direct HTML analysis</span>
                  </div>
                </div>
              )}

              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 8, padding: "14px 20px", textAlign: "center" }}>
                <p style={{ fontSize: 13, color: T.dim, margin: 0, fontFamily: T.mono }}>Scores update automatically as institutions are audited. Challenge a rival with Head-to-Head mode.</p>
              </div>
            </div>
            );
          })()}

          {/* PRESCRIPTIONS */}
          {activeTab === "prescriptions" && res.ai && (
            <div style={{ display: "grid", gap: 10 }}>
              {[
                { l: "Language & Voice", t: res.ai.rx_language, c: T.accent },
                { l: "Content Strategy", t: res.ai.rx_strategy, c: "#22c55e" },
                { l: "AI Search Readiness", t: res.ai.rx_ai_readiness, c: "#8b5cf6" },
              ].filter(r => r.t).map((r, i) => (
                <div key={i} style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 20px", borderLeft: "3px solid " + r.c }}>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color: r.c, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Rx: {r.l}</div>
                  <p style={{ fontSize: 14, color: T.text, lineHeight: 1.6, margin: 0 }}>{r.t}</p>
                </div>
              ))}
              {res.pagesAnalyzed?.length <= 1 && (res.bodyText || "").split(/\s+/).length < 400 && (
                <div style={{ background: "#1a1a00", border: "1px solid #3d3d00", borderRadius: 10, padding: "18px 20px", borderLeft: "3px solid #cca700" }}>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color: "#cca700", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Rx: AI Visibility</div>
                  <p style={{ fontSize: 14, color: T.text, lineHeight: 1.6, margin: 0 }}>
                    This site appears to use heavy JavaScript rendering, which limited what our scraper could extract. This isn't just a scoring issue — <strong style={{ color: "#cca700" }}>69% of AI crawlers can't execute JavaScript</strong>. That means tools like ChatGPT, Perplexity, and Claude may not be able to read this site's content either. As more prospective students use AI to research schools, a JS-heavy site without server-side rendering risks being invisible to an entire discovery channel.
                  </p>
                  <p style={{ fontSize: 13, color: "#aa8800", margin: "8px 0 0", lineHeight: 1.5 }}>
                    Fix: Ask your web team about server-side rendering (SSR) or pre-rendering. <a href="https://web.dev/articles/rendering-on-the-web" target="_blank" rel="noopener noreferrer" style={{ color: "#cca700", textDecoration: "underline" }}>Google's guide to rendering strategies →</a>
                  </p>
                </div>
              )}
              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 8, padding: "16px 20px", textAlign: "center" }}>
                <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.6 }}>These are starting points — the kind of questions every institution should be asking about their web presence.</p>
              </div>
            </div>
          )}

          {/* METHODOLOGY */}
          {activeTab === "methodology" && (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>How Blanding Scores Your Site</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 14px" }}>
                  Every audit produces two sub-scores that combine into your overall rating. Here's exactly what we measure and how.
                </p>
              </div>

              {/* LANGUAGE & VOICE */}
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid " + T.accent }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, fontWeight: 600, marginBottom: 10 }}>Language & Voice — 55% of overall</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Starts at 100 and penalizes downward. We scan every page for matches against a dictionary of 300+ higher ed clichés — phrases like "world-class," "transformative experience," and "leaders of tomorrow" that appear on virtually every college website.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    { label: "Cliché penalty (logarithmic)", desc: "Clichés hurt on a curve: the first few matter most, diminishing after that. Going from 5→10 clichés hurts more than 15→20. This rewards schools that have mostly cleaned up their language.", weight: "up to −50" },
                    { label: "Density penalty", desc: "Clichés per 100 words, weighted by severity and placement. Count and density don't stack — we take the worse of the two, then add a fraction of the other.", weight: "non-additive" },
                    { label: "H1 cliché penalty", desc: "Using clichés in your primary headline is a brand crime worth extra punishment. Your H1 is the first thing students and AI see — filling it with platitudes costs you.", weight: "up to −15" },
                    { label: "Rich content bonus", desc: "If your page has strong specific content (names, dates, data, quotes), you earn back some of what clichés took away. Having good stuff matters.", weight: "up to +8" },
                    { label: "Thin content penalty", desc: "Pages under 300 words get dinged — every 25 missing words costs a point. Saying nothing isn't the same as being distinctive.", weight: "up to −12" },
                    { label: "Unique content minimum", desc: "Pages with fewer than 2 concrete, institution-specific claims lose additional points. Generic pages with no proof of life get flagged.", weight: "−8 if missing" },
                    { label: "AI voice assessment", desc: "An AI evaluator reads the full text and scores how distinctive the voice feels. The blend adapts: pages with strong mechanical data lean more on the numbers; thin pages lean more on AI judgment.", weight: "40–60% blend" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: T.bg, borderRadius: 6, padding: "10px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{item.label}</span>
                        <span style={{ fontSize: 12, fontFamily: T.mono, color: T.dim }}>{item.weight}</span>
                      </div>
                      <p style={{ fontSize: 13, color: T.dim, lineHeight: 1.55, margin: 0 }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* CONTENT STRATEGY */}
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid #22c55e" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: "#22c55e", fontWeight: 600, marginBottom: 10 }}>Content Strategy — 45% of overall</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Starts at a base of 30 and builds upward from content signals. Mechanical signals make up 55% of the strategy score; the remaining 45% comes from AI evaluation blended in a single weighted step.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    { label: "Unique claims bonus", desc: "Institutional facts that differentiate you from peers — verified by AI analysis. Must contain specific numbers, percentages, named programs, or concrete outcomes (e.g. 'student-faculty ratio is 7:1,' '94% of students live on campus'). Taglines, news headlines, and marketing copy don't count. Three tiers with diminishing returns: first 3 claims earn 5 pts each, next 3 earn 2.5 pts each, beyond that 1 pt each (capped).", weight: "up to ~27 pts" },
{ label: "Content richness bonus", desc: "Specific dates, proper nouns, data points, direct quotes, diverse section headings — signals of real, timely content.", weight: "up to +10" },
                    { label: "Headline quality bonus", desc: "H1 and H2 tags that avoid clichés are rewarded. The percentage of non-cliché headlines boosts your strategy score — clear, specific headings signal brand intentionality.", weight: "up to +8" },
                    { label: "AI specificity score", desc: "How concrete and specific is the content? Named events, real research, actual numbers vs. vague platitudes. Part of the 45% AI evaluation blend.", weight: "20% of AI blend" },
                    { label: "AI consistency score", desc: "Does every element reinforce a coherent identity, or does the messaging scatter? Part of the 45% AI evaluation blend.", weight: "15% of AI blend" },
                    { label: "Specificity ratio + ceiling", desc: "What percentage of the total page content is genuinely specific vs. generic filler? This also enforces a reality ceiling — a mostly-generic page can't score above its actual specificity level, no matter how well other signals perform.", weight: "10% of AI blend" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: T.bg, borderRadius: 6, padding: "10px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{item.label}</span>
                        <span style={{ fontSize: 12, fontFamily: T.mono, color: T.dim }}>{item.weight}</span>
                      </div>
                      <p style={{ fontSize: 13, color: T.dim, lineHeight: 1.55, margin: 0 }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* BRAND THEATRE & AI READINESS */}
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid #a855f7" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: "#a855f7", fontWeight: 600, marginBottom: 10 }}>Score Modifiers — Brand Theatre & AI Search Readiness</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 12px" }}>
                  On top of the two core scores, we evaluate two additional dimensions that gently nudge your strategy score up or down. These aren't primary scoring factors — they're context checks that reward schools doing the work and flag those coasting on vibes.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    { label: "Brand Theatre detection", desc: "\"Brand theatre\" is language that sounds branded but doesn't solve anything — aspirational slogans, emotional taglines, and personality-driven copy that never tells a student what specific problem this school solves for them. A high theatre score (4+) penalizes strategy.", weight: "up to −15 strategy" },
                    { label: "AI Search Readiness", desc: "AI search engines (ChatGPT, Perplexity, Gemini) are now decision engines. They don't reward schools for being attractive — they reward being specific and dependable. Can an AI cite your page when a student asks 'which school should I attend for X?' A low score nudges strategy down; a high score nudges it up.", weight: "−8 to +10 strategy" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: T.bg, borderRadius: 6, padding: "10px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{item.label}</span>
                        <span style={{ fontSize: 12, fontFamily: T.mono, color: T.dim }}>{item.weight}</span>
                      </div>
                      <p style={{ fontSize: 13, color: T.dim, lineHeight: 1.55, margin: 0 }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* RATING SCALE */}
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.text, fontWeight: 600, marginBottom: 12 }}>Rating Scale</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {[
                    { range: "80–100", label: "Standing Out", color: "#22c55e", desc: "Real brand texture. A prospective student would know what makes you different." },
                    { range: "65–79", label: "Getting There", color: "#84cc16", desc: "Sparks of personality buried under institutional safety. The bones are good." },
                    { range: "45–64", label: "Blending In", color: "#eab308", desc: "You sound like a college. Swap your name with any peer and nobody notices." },
                    { range: "25–44", label: "Wallpaper", color: "#f97316", desc: "Institutional wallpaper. Every page reads like it was approved by committee." },
                    { range: "0–24", label: "Invisible", color: "#ef4444", desc: "The higher ed greatest hits album. Could belong to any institution in the country." },
                  ].map((tier, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: T.bg, borderRadius: 6 }}>
                      <span style={{ fontSize: 11, fontFamily: T.mono, color: tier.color, fontWeight: 700, minWidth: 50 }}>{tier.range}</span>
                      <span style={{ fontSize: 12, color: T.text, fontWeight: 500, minWidth: 90 }}>{tier.label}</span>
                      <span style={{ fontSize: 12, color: T.dim }}>{tier.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* WHAT WE SCAN */}
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.text, fontWeight: 600, marginBottom: 10 }}>What We Scan</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 8px" }}>
                  We scrape your homepage plus up to 3 linked sub-pages (About, Admissions, Academics). We extract all visible text, headings, and meta descriptions. An AI model then reads the full content as a "brand critic" — evaluating voice, specificity, consistency, brand theatre, and AI search readiness independent of the mechanical scoring.
                </p>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  The final score blends mechanical analysis (cliché matching, content signals) with AI evaluation (voice, specificity, consistency). Mechanical signals are weighted more heavily because they're deterministic and reproducible — the AI layer adds qualitative judgment about how the whole page <em>feels</em>, but can't override what the data shows.
                </p>
              </div>

              {/* HONEST LIMITATIONS */}
              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, fontWeight: 600, marginBottom: 10 }}>Honest Limitations</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 8px" }}>
                  This tool measures <em>language differentiation</em> and <em>strategic specificity</em> — whether your website copy sounds like you or sounds like everyone, and whether it says something concrete enough for both humans and AI to act on. It doesn't measure brand strategy effectiveness, enrollment outcomes, or whether your messaging resonates with your specific audience. A school can score well here and still have the wrong message; a school can score poorly and still enroll students. But if you sound like everyone else, you're making your marketing team's job harder than it needs to be — and increasingly invisible to the AI tools students use to find you.
                </p>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Scores may vary slightly between runs due to the AI evaluation component. JS-heavy sites that don't render HTML may not be fully scrapable. The cliché dictionary, while extensive, focuses on North American higher education language patterns.
                </p>
              </div>

              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 8, padding: "16px 20px", textAlign: "center" }}>
                <p style={{ fontSize: 13, color: T.muted, margin: "0 0 8px", lineHeight: 1.6 }}>Questions about the methodology? Disagree with a score? I'd love to hear from you.</p>
                <a href="mailto:th@helloadeo.com" style={{ fontSize: 13, color: T.accent, fontWeight: 600, textDecoration: "none" }}>th@helloadeo.com</a>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  /* ═══ RENDER ═══ */
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.sans, position: "relative" }}>
      {/* Grain + glow */}
      <div style={{ position: "fixed", inset: 0, opacity: 0.03, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`, pointerEvents: "none", zIndex: 1 }} />
      <div style={{ position: "fixed", top: "-30%", right: "-10%", width: "60%", height: "60%", background: "radial-gradient(ellipse, rgba(200,120,60,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

      <main id="main-content" style={{ position: "relative", zIndex: 2, maxWidth: 940, margin: "0 auto", padding: "0 24px" }}>

        {/* HEADER */}
        <header style={{ paddingTop: 40, paddingBottom: 12 }}>
          <div style={{ marginBottom: 40 }}></div>
          <span style={{ display: "inline-block", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: T.accent, fontFamily: T.mono, marginBottom: 12 }}>Higher Ed Edition</span>
          <h1 style={{ fontSize: "clamp(38px, 6.5vw, 64px)", fontFamily: T.serif, fontWeight: 400, lineHeight: 1.0, margin: 0, letterSpacing: "-0.02em" }}>
            Blanding
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: "#aaa", maxWidth: 540, marginTop: 16, fontWeight: 300 }}>
            An AI-powered brand audit for higher ed websites. We scan your homepage and key landing pages for clichés, brand theatre, and the kind of copy that makes every school invisible to students <em>and</em> the AI tools they're using to find one.
          </p>
          {auditCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e80" }} />
              <span style={{ fontSize: 13, fontFamily: T.mono, color: T.dim }}>{auditCount} institutions audited and counting</span>
            </div>
          )}
        </header>

        {/* INPUT */}
        <section style={{ marginTop: 32 }}>
          <div style={{ display: "flex", gap: 2, marginBottom: 16, background: T.card, borderRadius: 8, padding: 3, width: "fit-content" }}>
            {[{ l: "Single Audit", v: "single" }, { l: "Head-to-Head", v: "compare" }, { l: "Paste Text", v: "text" }].map(m => (
              <button key={m.v} onClick={() => { setMode(m.v); setResult(null); setResult2(null); setProgress([]); setCachedPrompt(null); }}
                style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: mode === m.v ? T.accent : "transparent", color: mode === m.v ? "#fff" : T.dim, fontSize: 13, fontFamily: T.mono, fontWeight: 500 }}>{m.l}</button>
            ))}
          </div>

          {mode === "single" && (
            <div>
              <div className="audit-input-row" style={{ display: "flex", gap: 10 }}>
                <input value={url1} onChange={e => setUrl1(e.target.value)} placeholder="e.g. bowdoin.edu" onKeyDown={e => e.key === "Enter" && url1.trim() && isEdu(url1) && runSingle()}
                  aria-label="School website URL" aria-invalid={url1.trim() && !isEdu(url1) ? "true" : undefined} aria-describedby={url1.trim() && !isEdu(url1) ? "edu-error" : undefined}
                  style={{ flex: 1, background: T.card, border: "1px solid " + (url1.trim() && !isEdu(url1) ? "#ef4444" : T.borderLight), borderRadius: 10, padding: "15px 18px", color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = url1.trim() && !isEdu(url1) ? "#ef4444" : T.accent} onBlur={e => e.target.style.borderColor = url1.trim() && !isEdu(url1) ? "#ef4444" : T.borderLight} />
                <button onClick={runSingle} disabled={analyzing || !url1.trim() || !isEdu(url1)} aria-label="Audit this site"
                  style={{ padding: "15px 26px", background: (!url1.trim() || !isEdu(url1)) ? "#1a1a1a" : `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 10, color: (!url1.trim() || !isEdu(url1)) ? "#444" : "#fff", fontSize: 14, fontWeight: 600, fontFamily: T.sans, whiteSpace: "nowrap" }}>
                  {analyzing ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner />Auditing...</span> : "Audit Site"}
                </button>
              </div>
              {url1.trim() && !isEdu(url1) && <p id="edu-error" role="alert" style={{ margin: "8px 0 0", fontSize: 12, fontFamily: T.mono, color: "#ef4444" }}>Only .edu and .ca domains — this tool is built for higher education sites.</p>}
            </div>
          )}

          {mode === "compare" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
                <input value={url1} onChange={e => setUrl1(e.target.value)} placeholder="School A — e.g. williams.edu"
                  aria-label="School A website URL" aria-invalid={url1.trim() && !isEdu(url1) ? "true" : undefined}
                  style={{ background: T.card, border: "1px solid " + (url1.trim() && !isEdu(url1) ? "#ef4444" : T.borderLight), borderRadius: 10, padding: "15px 18px", color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
                <span className="compare-vs" style={{ fontSize: 14, fontFamily: T.serif, fontStyle: "italic", color: T.dim }}>vs</span>
                <input value={url2} onChange={e => setUrl2(e.target.value)} placeholder="School B — e.g. amherst.edu"
                  aria-label="School B website URL" aria-invalid={url2.trim() && !isEdu(url2) ? "true" : undefined}
                  style={{ background: T.card, border: "1px solid " + (url2.trim() && !isEdu(url2) ? "#ef4444" : T.borderLight), borderRadius: 10, padding: "15px 18px", color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
              </div>
              {((url1.trim() && !isEdu(url1)) || (url2.trim() && !isEdu(url2))) && <p style={{ margin: 0, fontSize: 12, fontFamily: T.mono, color: "#ef4444" }}>Only .edu and .ca domains — this tool is built for higher education sites.</p>}
              <button onClick={runCompare} disabled={analyzing || !url1.trim() || !url2.trim() || !isEdu(url1) || !isEdu(url2)}
                style={{ padding: "15px", background: (!url1.trim() || !url2.trim()) ? "#1a1a1a" : `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 10, color: (!url1.trim() || !url2.trim()) ? "#444" : "#fff", fontSize: 14, fontWeight: 600, fontFamily: T.sans }}>
                {analyzing ? "Running Head-to-Head..." : "Compare These Schools"}
              </button>
            </div>
          )}

          {mode === "text" && (
            <>
              <textarea value={inputText} onChange={e => setInputText(e.target.value.slice(0, 15000))} maxLength={15000} aria-label="Paste marketing text to analyze" placeholder="Paste your homepage copy, about page, or any marketing text..."
                style={{ width: "100%", minHeight: 170, background: T.card, border: "1px solid " + T.borderLight, borderRadius: 10, padding: "16px 20px", color: T.text, fontSize: 14, lineHeight: 1.7, fontFamily: T.sans, resize: "vertical", outline: "none" }}
                onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
              {inputText.length > 12000 && <div style={{ fontSize: 11, fontFamily: T.mono, color: "#eab308", marginTop: 4 }}>{inputText.length.toLocaleString()} / 15,000 characters</div>}
              <button onClick={runText} disabled={analyzing || inputText.trim().length < 50}
                style={{ marginTop: 10, width: "100%", padding: "15px", background: inputText.trim().length < 50 ? "#1a1a1a" : `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 10, color: inputText.trim().length < 50 ? "#444" : "#fff", fontSize: 14, fontWeight: 600, fontFamily: T.sans }}>
                {analyzing ? "Analyzing..." : "Analyze Copy"}
              </button>
            </>
          )}

          {/* Samples */}
          {mode !== "text" && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>Try:</span>
              {(mode === "compare"
                ? [{ l: "Williams vs Amherst", a: "williams.edu", b: "amherst.edu" }, { l: "Harvard vs MIT", a: "harvard.edu", b: "mit.edu" }]
                : [{ l: "bowdoin.edu" }, { l: "asu.edu" }, { l: "snhu.edu" }, { l: "liberty.edu" }]
              ).map((s, i) => (
                <button key={i} onClick={() => { if (mode === "compare") { setUrl1(s.a); setUrl2(s.b); } else setUrl1(s.l); }}
                  style={{ background: "#141414", border: "1px solid " + T.borderLight, borderRadius: 5, padding: "3px 10px", color: T.dim, fontSize: 10, fontFamily: T.mono }}
                  onMouseEnter={e => { e.target.style.borderColor = T.accent; e.target.style.color = T.accent; }}
                  onMouseLeave={e => { e.target.style.borderColor = T.borderLight; e.target.style.color = T.dim; }}>
                  {s.l || `${s.a} vs ${s.b}`}
                </button>
              ))}
            </div>
          )}
          {/* CACHED RESULT PROMPT — domain already audited (positioned right below input so it's visible) */}
          {cachedPrompt && !analyzing && !result && (
            <section ref={cachedPromptRef} style={{ marginTop: 20 }}>
              <div style={{ background: T.card, border: `1px solid ${T.accent}40`, borderRadius: 12, padding: "22px 24px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 18 }}>📋</span>
                  <span style={{ fontSize: 14, fontFamily: T.mono, color: T.accent }}>Previously Audited</span>
                </div>
                <p style={{ fontSize: 14, color: T.text, lineHeight: 1.6, margin: "0 0 4px" }}>
                  <strong style={{ color: T.text }}>{cachedPrompt.name}</strong> was already audited{cachedPrompt.lastAudited ? ` on ${new Date(cachedPrompt.lastAudited).toLocaleDateString()}` : ""}.
                </p>
                <div style={{ display: "flex", gap: 16, alignItems: "center", margin: "14px 0" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: scoreColor(cachedPrompt.overall), fontFamily: T.mono }}>{cachedPrompt.overall}</div>
                    <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>Overall</div>
                  </div>
                  {cachedPrompt.language != null && (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 600, color: scoreColor(cachedPrompt.language), fontFamily: T.mono }}>{cachedPrompt.language}</div>
                      <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>Language</div>
                    </div>
                  )}
                  {cachedPrompt.strategy != null && (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 600, color: scoreColor(cachedPrompt.strategy), fontFamily: T.mono }}>{cachedPrompt.strategy}</div>
                      <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>Strategy</div>
                    </div>
                  )}
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: scoreColor(cachedPrompt.overall), fontFamily: T.mono }}>{scoreLabel(cachedPrompt.overall)}</div>
                    <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>Verdict</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button onClick={runFreshAudit}
                    style={{ padding: "10px 20px", background: `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: T.sans }}>
                    Re-audit Fresh
                  </button>
                  <button onClick={() => setCachedPrompt(null)}
                    style={{ padding: "10px 20px", background: "transparent", border: "1px solid " + T.borderLight, borderRadius: 8, color: T.dim, fontSize: 13, fontFamily: T.sans }}>
                    Dismiss
                  </button>
                </div>
                <p style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, margin: "12px 0 0" }}>
                  This is the cached score from the leaderboard. Hit "Re-audit Fresh" to run a new analysis (uses API credits).
                </p>
              </div>
            </section>
          )}

          {/* LANDING LEADERBOARD PREVIEW — shows before any audit (verified only) */}
          {!result && !result2 && !analyzing && progress.length === 0 && (() => {
            const verifiedLb = leaderboard.filter(s => s.scrapeSource !== "claude_websearch");
            return verifiedLb.length >= 3 ? (
            <div style={{ marginTop: 32, background: T.card, border: "1px solid " + T.border, borderRadius: 12, padding: "22px 24px", overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", letterSpacing: "0.1em" }}>Leaderboard</div>
                  <div style={{ fontSize: 13, color: T.dim, marginTop: 2 }}>{verifiedLb.length} verified institutions ranked — where does yours land?</div>
                </div>
              </div>
              {verifiedLb.slice(0, 8).map((s, i) => (
                <div key={s.url} style={{
                  display: "grid", gridTemplateColumns: "28px 1fr 55px 55px 55px", gap: 6, alignItems: "center",
                  padding: "8px 10px", borderRadius: 6, marginBottom: 1,
                  background: i % 2 === 0 ? "transparent" : T.cardAlt,
                }}>
                  <span style={{ fontSize: 13, fontFamily: T.mono, color: i < 3 ? T.accent : T.dim, fontWeight: i < 3 ? 700 : 400, textAlign: "center" }}>
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: T.text, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontFamily: T.serif, color: scoreColor(s.overall) }}>{s.overall}</div>
                    <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Score</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontFamily: T.serif, color: s.language != null ? scoreColor(s.language) : T.dim }}>{s.language ?? "–"}</div>
                    <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Lang</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontFamily: T.serif, color: s.strategy != null ? scoreColor(s.strategy) : T.dim }}>{s.strategy ?? "–"}</div>
                    <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Strat</div>
                  </div>
                </div>
              ))}
              {verifiedLb.length > 8 && (
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <span style={{ fontSize: 12, fontFamily: T.mono, color: T.dim }}>+ {verifiedLb.length - 8} more — audit a site to see the full list</span>
                </div>
              )}
            </div>
            ) : null;
          })()}
        </section>


        {/* PROGRESS */}
        {progress.length > 0 && !result && (
          <section ref={progressRef} style={{ marginTop: 28 }}>
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 22px" }}>
              {progress.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", opacity: p.status === "done" ? 0.45 : 1, transition: "opacity 0.3s" }}>
                  {p.status === "loading" ? <Spinner /> : p.status === "error" ? <span style={{ color: "#ef4444", fontSize: 13 }}>✗</span> : <span style={{ color: "#22c55e", fontSize: 13 }}>✓</span>}
                  <span style={{ fontSize: 12, fontFamily: T.mono, color: p.status === "error" ? "#ef4444" : T.muted }}>{p.msg}</span>
                </div>
              ))}
            </div>
            {/* If failed, show AI visibility diagnostic + paste fallback */}
            {progress.some(p => p.status === "error" && p.msg.includes("Could not reach")) && !analyzing && (
              <div style={{ marginTop: 16 }}>
                {/* Diagnostic card */}
                <div style={{ background: "#1a0a0a", border: "1px solid #3d1515", borderRadius: 10, padding: "22px 24px", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 18 }}>🚫</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#ef4444", fontFamily: T.mono, letterSpacing: "0.04em" }}>Site Blocking Automated Access</span>
                  </div>
                  <p style={{ fontSize: 14, color: T.text, lineHeight: 1.7, margin: "0 0 10px" }}>
                    This site's server is actively rejecting non-browser requests. Our scraper tried multiple methods and was blocked each time.
                  </p>
                  <p style={{ fontSize: 13, color: "#cca700", lineHeight: 1.7, margin: "0 0 10px", background: "#1a1a00", border: "1px solid #3d3d00", borderRadius: 6, padding: "10px 14px" }}>
                    <strong>Why this matters:</strong> AI search tools like ChatGPT, Perplexity, and Claude use similar automated requests to index content. If our scraper can't get through, there's a good chance theirs can't either — meaning this institution may be <strong>invisible to AI-powered search and discovery</strong>.
                  </p>
                  <p style={{ fontSize: 12, color: T.dim, lineHeight: 1.6, margin: 0 }}>
                    This is a server configuration issue, not a content issue. It's fixable — the web team can whitelist AI crawlers or adjust bot-detection rules without compromising security. <a href="https://web.dev/articles/rendering-on-the-web" target="_blank" rel="noopener noreferrer" style={{ color: "#cca700", textDecoration: "underline" }}>Learn more →</a>
                  </p>
                </div>
                {/* Paste text fallback */}
                <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 8, padding: "14px 18px", textAlign: "center" }}>
                  <p style={{ fontSize: 13, color: T.muted, margin: "0 0 8px" }}>Want a Language & Voice score anyway? Copy your homepage text and paste it below.</p>
                  <button onClick={() => { setMode("text"); setProgress([]); }}
                    style={{ padding: "8px 18px", background: T.accent + "20", border: "1px solid " + T.accent + "40", borderRadius: 6, color: T.accent, fontSize: 12, fontFamily: T.mono, cursor: "pointer" }}>
                    Switch to Paste Text
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* RESULTS */}
        {result && (
          <section ref={resultRef} style={{ marginTop: 40, paddingBottom: 80 }}>

            {/* COMPARE */}
            {mode === "compare" && result2 ? (
              <>
                <div className="compare-results" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <ResultBlock res={result} compact />
                  <div className="compare-vs" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", flexShrink: 0 }}>
                    <span style={{ fontSize: 20, fontFamily: T.serif, fontStyle: "italic", color: T.dim }}>vs</span>
                  </div>
                  <ResultBlock res={result2} compact />
                </div>
                <div style={{ marginTop: 16, background: T.card, border: "1px solid " + T.border, borderRadius: 12, padding: 24, textAlign: "center" }}>
                  {result.overall === result2.overall ? <p style={{ fontSize: 16, fontFamily: T.serif, color: T.muted, margin: 0 }}>Dead heat. Both equally... <span style={{ fontStyle: "italic", color: T.accent }}>institutional</span>.</p> : (
                    <>
                      <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>More Differentiated</div>
                      <div style={{ fontSize: 24, fontFamily: T.serif, color: scoreColor(Math.max(result.overall, result2.overall)) }}>{result.overall > result2.overall ? result.schoolName : result2.schoolName}</div>
                      <p style={{ fontSize: 13, color: T.muted, marginTop: 8, marginBottom: 0 }}>Leading by {Math.abs(result.overall - result2.overall)} points</p>
                    </>
                  )}
                </div>
                <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
                  {[{ key: "language", label: "Language & Voice" }, { key: "strategy", label: "Content Strategy" }].map(d => {
                    const s1 = result.scores[d.key], s2 = result2.scores[d.key];
                    if (s1 == null || s2 == null) return null;
                    return (
                      <div key={d.key} className="compare-bar-row" style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 8, padding: "12px 16px", display: "grid", gridTemplateColumns: "70px 1fr auto 1fr 70px", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20, fontFamily: T.serif, color: scoreColor(s1), textAlign: "right" }}>{s1}</span>
                        <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: "hidden", direction: "rtl" }}><div style={{ height: "100%", width: `${s1}%`, background: scoreColor(s1), borderRadius: 3, transition: "width 1s ease" }} /></div>
                        <span className="compare-bar-label" style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase", textAlign: "center", minWidth: 55 }}>{d.label}</span>
                        <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: "hidden" }}><div style={{ height: "100%", width: `${s2}%`, background: scoreColor(s2), borderRadius: 3, transition: "width 1s ease" }} /></div>
                        <span style={{ fontSize: 20, fontFamily: T.serif, color: scoreColor(s2) }}>{s2}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <ResultBlock res={result} />
                <TabContent res={result} />
              </>
            )}

            {/* SHARE + ACTIONS */}
            <div className="action-grid" style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              <button onClick={() => setShareModal(true)}
                style={{ background: T.card, border: "1px solid " + T.borderLight, borderRadius: 9, padding: "14px 12px", color: T.muted, fontSize: 11, fontWeight: 500 }}
                onMouseEnter={e => { e.target.style.borderColor = T.accent; e.target.style.color = T.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = T.borderLight; e.target.style.color = T.muted; }}>
                Share Results
              </button>
              <button onClick={handleScorecard}
                style={{ background: T.card, border: "1px solid " + T.borderLight, borderRadius: 9, padding: "14px 12px", color: T.muted, fontSize: 11, fontWeight: 500 }}
                onMouseEnter={e => { e.target.style.borderColor = T.accent; e.target.style.color = T.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = T.borderLight; e.target.style.color = T.muted; }}>
                Download Scorecard
              </button>
              <button onClick={handleExport}
                style={{ background: T.card, border: "1px solid " + T.borderLight, borderRadius: 9, padding: "14px 12px", color: T.muted, fontSize: 11, fontWeight: 500 }}
                onMouseEnter={e => { e.target.style.borderColor = T.accent; e.target.style.color = T.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = T.borderLight; e.target.style.color = T.muted; }}>
                Export PDF
              </button>
              <a href="mailto:th@helloadeo.com"
                style={{ background: T.card, border: "1px solid " + T.borderLight, borderRadius: 9, padding: "14px 12px", color: T.muted, fontSize: 11, fontWeight: 500, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
                onMouseEnter={e => { e.target.style.borderColor = T.accent; e.target.style.color = T.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = T.borderLight; e.target.style.color = T.muted; }}>
                Feedback
              </a>
            </div>

            {/* CHALLENGE MODE */}
            {result && !result2 && result.url && (
              <div style={{ marginTop: 16, background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "20px 24px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", letterSpacing: "0.1em" }}>Challenge Mode</span>
                  <span style={{ fontSize: 12, color: T.dim }}>Think a rival school can beat this score?</span>
                </div>
                <div className="audit-input-row" style={{ display: "flex", gap: 8 }}>
                  <input value={challengeUrl} onChange={e => setChallengeUrl(e.target.value)}
                    placeholder="Enter rival school URL..." onKeyDown={e => e.key === "Enter" && challengeUrl.trim() && isEdu(challengeUrl) && handleChallenge()}
                    aria-label="Rival school URL" aria-invalid={challengeUrl.trim() && !isEdu(challengeUrl) ? "true" : undefined}
                    style={{ flex: 1, background: T.bg, border: "1px solid " + (challengeUrl.trim() && !isEdu(challengeUrl) ? "#ef4444" : T.borderLight), borderRadius: 8, padding: "10px 14px", color: T.text, fontSize: 13, fontFamily: T.sans, outline: "none" }}
                    onFocus={e => e.target.style.borderColor = challengeUrl.trim() && !isEdu(challengeUrl) ? "#ef4444" : T.accent} onBlur={e => e.target.style.borderColor = challengeUrl.trim() && !isEdu(challengeUrl) ? "#ef4444" : T.borderLight} />
                  <button onClick={handleChallenge} disabled={!challengeUrl.trim() || !isEdu(challengeUrl)}
                    style={{ padding: "10px 18px", background: (challengeUrl.trim() && isEdu(challengeUrl)) ? T.accent : "#1a1a1a", border: "none", borderRadius: 8, color: (challengeUrl.trim() && isEdu(challengeUrl)) ? "#fff" : "#444", fontSize: 12, fontWeight: 600, fontFamily: T.mono, whiteSpace: "nowrap" }}>
                    Head-to-Head →
                  </button>
                </div>
                {challengeUrl.trim() && !isEdu(challengeUrl) && <p role="alert" style={{ margin: "6px 0 0", fontSize: 11, fontFamily: T.mono, color: "#ef4444" }}>Only .edu and .ca domains supported.</p>}
              </div>
            )}

            <div style={{ marginTop: 32, padding: "28px 24px", background: T.cardAlt, borderRadius: 10, border: "1px solid #161616", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.65, margin: 0, maxWidth: 540, marginLeft: "auto", marginRight: "auto" }}>
                This tool catches the sameness — in your language, your strategy, and how AI sees you. Fixing it takes a deeper conversation — one about brand, not just words.
              </p>
            </div>
          </section>
        )}

        <footer style={{ paddingTop: 32, paddingBottom: 24, borderTop: "1px solid #151515", marginTop: result ? 0 : 80, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: T.faint, fontFamily: T.mono }}>© 2026 Tracey Halvorsen</span>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <button onClick={() => { setShowMethodology(m => !m); setShowDisclaimer(false); setTimeout(() => methRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}
              style={{ background: "none", border: "none", padding: 0, fontSize: 10, color: T.faint, fontFamily: T.mono, textDecoration: "none", cursor: "pointer" }}
              onMouseEnter={e => { e.target.style.color = T.accent; }} onMouseLeave={e => { e.target.style.color = T.faint; }}>
              How We Score
            </button>
            <button onClick={() => { setShowDisclaimer(d => !d); setShowMethodology(false); setTimeout(() => disclaimerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}
              style={{ background: "none", border: "none", padding: 0, fontSize: 10, color: T.faint, fontFamily: T.mono, textDecoration: "none", cursor: "pointer" }}
              onMouseEnter={e => { e.target.style.color = T.accent; }} onMouseLeave={e => { e.target.style.color = T.faint; }}>
              Disclaimer
            </button>
            <a href="mailto:th@helloadeo.com" style={{ fontSize: 10, color: T.faint, fontFamily: T.mono, textDecoration: "none" }}
              onMouseEnter={e => { e.target.style.color = T.accent; }} onMouseLeave={e => { e.target.style.color = T.faint; }}>th@helloadeo.com</a>
          </div>
        </footer>

        {/* STANDALONE METHODOLOGY (footer link) */}
        {showMethodology && (
          <section ref={methRef} style={{ paddingBottom: 60 }}>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 18, fontFamily: T.serif, color: T.text }}>How Blanding <span style={{ fontStyle: "italic", color: T.accent }}>Scores</span></div>
                  <button onClick={() => setShowMethodology(false)} style={{ background: "none", border: "none", color: T.dim, fontSize: 11, fontFamily: T.mono, cursor: "pointer" }}>Close ✕</button>
                </div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "12px 0 0" }}>
                  Every audit produces two sub-scores — Language & Voice and Content Strategy — that combine into your overall rating. The score blends deterministic text analysis (cliché matching, content signals) with AI-powered evaluation (voice, specificity, brand theatre, AI search readiness). Mechanical signals anchor the score; the AI layer adds qualitative judgment that can nudge but not override what the data shows.
                </p>
              </div>

              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid " + T.accent }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, fontWeight: 600, marginBottom: 10 }}>Language & Voice — 55% of overall</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Starts at 100, then penalizes for cliché usage on a logarithmic curve — the first few clichés hurt the most, with diminishing impact after that. We scan against 300+ higher ed clichés. Count and density penalties don't fully stack; we use the worse of the two, then add a fraction of the other. Clichés in your H1 headline cost extra (up to −15). Pages under 300 words lose points for thin content. Pages with rich, specific content earn partial credit back. An AI voice assessment blends in dynamically (40–60%) to capture the qualitative feel that pure pattern-matching misses.
                </p>
              </div>

              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid #22c55e" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: "#22c55e", fontWeight: 600, marginBottom: 10 }}>Content Strategy — 45% of overall</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Builds upward from a base of 30, rewarding AI-verified unique claims — institutional facts with specific numbers, named programs, or concrete outcomes that differentiate you from peers (three tiers with diminishing returns). Concrete details, rich content signals, and cliché-free headlines add points; generic CTAs ('Learn More,' 'Apply Now') pull the score down. Mechanical signals make up 55% of strategy; the remaining 45% comes from AI evaluation (specificity, consistency, and a specificity ratio that enforces a reality ceiling). Two modifiers then adjust the final strategy score: <em>brand theatre detection</em> (up to −15) penalizes language that sounds branded but never tells a student what problem you solve; <em>AI search readiness</em> (−8 to +10) nudges the score based on whether AI engines could cite your page with a specific answer.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 6 }}>
                {[
                  { range: "80–100", label: "Standing Out", color: "#22c55e" },
                  { range: "65–79", label: "Getting There", color: "#84cc16" },
                  { range: "45–64", label: "Blending In", color: "#eab308" },
                  { range: "25–44", label: "Wallpaper", color: "#f97316" },
                  { range: "0–24", label: "Invisible", color: "#ef4444" },
                ].map((tier, i) => (
                  <div key={i} style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 8, padding: "12px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontFamily: T.mono, color: tier.color, fontWeight: 700 }}>{tier.range}</div>
                    <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>{tier.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 24px" }}>
                <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, fontWeight: 600, marginBottom: 8 }}>What this tool doesn't measure</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  This scores <em>language differentiation</em> and <em>strategic specificity</em> — whether your website copy sounds like you or sounds like everyone else, and whether it gives humans and AI something concrete to act on. It doesn't measure brand strategy effectiveness, enrollment outcomes, or audience resonance. Scores may vary slightly between runs due to the AI component. JS-heavy sites may not be fully scrapable.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* STANDALONE DISCLAIMER (footer link) */}
        {showDisclaimer && (
          <section ref={disclaimerRef} style={{ paddingBottom: 60 }}>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 18, fontFamily: T.serif, color: T.text }}>Disclaimer & <span style={{ fontStyle: "italic", color: T.accent }}>Terms of Use</span></div>
                  <button onClick={() => setShowDisclaimer(false)} style={{ background: "none", border: "none", color: T.dim, fontSize: 11, fontFamily: T.mono, cursor: "pointer" }}>Close ✕</button>
                </div>
              </div>

              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, fontWeight: 600, marginBottom: 10 }}>What This Tool Does</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Blanding reads publicly accessible web pages — the same content any visitor sees in a browser. It does not access password-protected areas, bypass authentication, extract private data, or circumvent any technical restrictions. The tool respects robots.txt directives and standard web access protocols.
                </p>
              </div>

              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, fontWeight: 600, marginBottom: 10 }}>Editorial Commentary & Fair Use</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Scores, ratings, and all commentary generated by this tool constitute editorial opinion and analysis — not statements of objective fact about institutional quality, value, or outcomes. The tool analyzes <em>language patterns</em> (cliché frequency, word diversity, content specificity) and produces transformative commentary about writing style. No institution's content is republished, redistributed, or displayed in its original form. Brief quotations used in audit results are for purposes of criticism and commentary.
                </p>
              </div>

              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, fontWeight: 600, marginBottom: 10 }}>No Endorsement or Affiliation</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  This tool is not affiliated with, endorsed by, or connected to any institution it analyzes. School names and URLs are used solely to identify the subject of analysis. Scores do not reflect the quality of education, student outcomes, or institutional value — only the distinctiveness of publicly visible website language.
                </p>
              </div>

              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, fontWeight: 600, marginBottom: 10 }}>Limitation of Liability</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  This is an experimental tool provided "as is" for informational and entertainment purposes. Scores may vary between runs due to the AI analysis component. No warranties are made about the accuracy, completeness, or reliability of scores, and they should not be the basis for institutional decisions. If you believe your institution has been unfairly characterized, <a href="mailto:th@helloadeo.com" style={{ color: T.accent }}>reach out</a>.
                </p>
              </div>

              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, fontWeight: 600, marginBottom: 10 }}>Data & Privacy</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  We do not store the content of pages we analyze. Text is processed in memory during the audit and discarded. We do not build databases of institutional content. Email addresses submitted for PDF reports are used solely to deliver reports and are not sold or shared with third parties.
                </p>
              </div>

              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 24px" }}>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Built by Tracey Halvorsen as a personal experiment. Questions or concerns? <a href="mailto:th@helloadeo.com" style={{ color: T.accent, textDecoration: "none" }}>th@helloadeo.com</a>
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* SHARE MODAL */}
      {shareModal && result && (
        <div role="dialog" aria-modal="true" aria-label="Share your score" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setShareModal(false)}>
          <div style={{ background: "#151515", border: "1px solid " + T.borderLight, borderRadius: 16, padding: "32px 28px", maxWidth: 420, width: "100%", textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 400, margin: "0 0 6px" }}>Share Your <span style={{ fontStyle: "italic", color: T.accent }}>Score</span></h3>
            <p style={{ fontSize: 13, color: T.muted, margin: "0 0 20px" }}>{result.schoolName}: {result.overall}/100</p>
            <div style={{ display: "grid", gap: 8 }}>
              <button onClick={() => { shareTwitter(result); setShareModal(false); }}
                style={{ width: "100%", padding: "12px", background: "#1a1a1a", border: "1px solid " + T.borderLight, borderRadius: 8, color: T.text, fontSize: 13, fontWeight: 500 }}>
                Share on X / Twitter
              </button>
              <button onClick={() => { shareLinkedIn(result); setShareModal(false); }}
                style={{ width: "100%", padding: "12px", background: "#1a1a1a", border: "1px solid " + T.borderLight, borderRadius: 8, color: T.text, fontSize: 13, fontWeight: 500 }}>
                Share on LinkedIn
              </button>
              <button onClick={() => { handleCopy(); setShareModal(false); }}
                style={{ width: "100%", padding: "12px", background: "#1a1a1a", border: "1px solid " + T.borderLight, borderRadius: 8, color: T.text, fontSize: 13, fontWeight: 500 }}>
                Copy Share Text
              </button>
              <button onClick={() => { handleScorecard(); setShareModal(false); }}
                style={{ width: "100%", padding: "12px", background: "#1a1a1a", border: "1px solid " + T.borderLight, borderRadius: 8, color: T.text, fontSize: 13, fontWeight: 500 }}>
                Download Scorecard PNG
              </button>
              {result.cliches.length >= 5 && (
                <button onClick={() => { handleBingo(); setShareModal(false); }}
                  style={{ width: "100%", padding: "12px", background: "#1a1a1a", border: "1px solid " + T.borderLight, borderRadius: 8, color: T.text, fontSize: 13, fontWeight: 500 }}>
                  Download Cliché Bingo Card
                </button>
              )}
            </div>
            <button onClick={() => setShareModal(false)} style={{ background: "none", border: "none", color: T.dim, fontSize: 12, marginTop: 14, fontFamily: T.mono }}>Close</button>
          </div>
        </div>
      )}

      {/* EMAIL MODAL */}
      {emailModal && (
        <div role="dialog" aria-modal="true" aria-label="Get your full report" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setEmailModal(false)}>
          <div style={{ background: "#151515", border: "1px solid " + T.borderLight, borderRadius: 16, padding: "36px 32px", maxWidth: 420, width: "100%", textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ margin: "0 auto 20px", display: "flex", justifyContent: "center" }}><span style={{ fontSize: 24, fontFamily: T.serif, fontWeight: 400 }}>📊</span></div>
            <h3 style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 400, margin: "0 0 8px" }}>Get Your <span style={{ fontStyle: "italic", color: T.accent }}>Full Report</span></h3>
            <p style={{ fontSize: 13, color: T.muted, margin: "0 0 24px", lineHeight: 1.6 }}>Enter your email and we'll generate a branded PDF audit you can share with your team.</p>
            {emailSent ? (
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                <p style={{ color: "#22c55e", fontSize: 14 }}>Generating your report...</p>
              </div>
            ) : (
              <>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@institution.edu" type="email" aria-label="Your email address"
                  onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
                  style={{ width: "100%", background: T.bg, border: "1px solid " + T.borderLight, borderRadius: 8, padding: "14px 16px", color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none", marginBottom: 12 }}
                  onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
                <button onClick={handleEmailSubmit}
                  style={{ width: "100%", padding: "14px", background: `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: T.sans }}>
                  Generate Report
                </button>
                <button onClick={() => { setEmailModal(false); exportPDF(result); }}
                  style={{ background: "none", border: "none", color: T.dim, fontSize: 12, marginTop: 12, fontFamily: T.mono }}>
                  Skip — just show me the report
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

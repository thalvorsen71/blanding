import { useState, useRef, useEffect, useCallback } from 'react';
import { T, scoreColor, scoreLabel, scoreVerdict, countCliches, highlightCliches, contentRichnessBonus } from './constants';
import { fetchPage, fetchSubPage, deepAnalysis, captureLead } from './api';
import { exportPDF } from './pdf';
import { generateScorecard } from './scorecard';
import { generateBingoCard } from './bingo';
import { AdeoLogo } from './logo.jsx';

/* ═══ SMALL COMPONENTS ═══ */
function AnimNum({ value, dur = 1400 }) {
  const [d, setD] = useState(0);
  const r = useRef(null);
  const hasAnimated = useRef(null);
  useEffect(() => {
    // Only animate when the value actually changes (new audit result)
    if (hasAnimated.current === value) { setD(value); return; }
    let s = null;
    const go = ts => { if (!s) s = ts; const p = Math.min((ts - s) / dur, 1); setD(Math.round((1 - Math.pow(1 - p, 3)) * value)); if (p < 1) r.current = requestAnimationFrame(go); else hasAnimated.current = value; };
    r.current = requestAnimationFrame(go);
    return () => cancelAnimationFrame(r.current);
  }, [value, dur]);
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
  return <span style={{ background: color + "12", border: "1px solid " + color + "30", borderRadius: 5, padding: "4px 10px", fontSize: 12, color, fontFamily: T.mono, display: "inline-block" }}>{children}</span>;
}

function Spinner({ size = 14 }) {
  return <span role="status" aria-label="Loading" style={{ width: size, height: size, border: "2px solid #222", borderTopColor: T.accent, borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />;
}

/* ═══ SHARE HELPERS ═══ */
const SITE_URL = "https://blandingaudit.netlify.app";

function getShareText(res) {
  return `Our higher ed website just scored ${res.overall}/100 on the Blanding Detector.\n\n"${scoreLabel(res.overall)}" — ${scoreVerdict(res.overall)}\n\n${res.totalCliches} clichés across ${res.pagesAnalyzed.length} page${res.pagesAnalyzed.length > 1 ? "s" : ""}.\n\nHow generic is YOUR institution? Try it free:\n${SITE_URL}\n\n#HigherEd #Branding #BlandingDetector`;
}

function shareTwitter(res) {
  const text = `Our higher ed site scored ${res.overall}/100 on the Blanding Detector — "${scoreLabel(res.overall)}"\n\n${res.totalCliches} clichés found. How generic is YOUR institution?\n\n${SITE_URL}\n\n#HigherEd #BlandingDetector`;
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
  const resultRef = useRef(null);
  const methRef = useRef(null);

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
  const isEdu = u => { try { return new URL(norm(u)).hostname.endsWith(".edu"); } catch { return false; } };

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

  const submitToLeaderboard = useCallback(async (res) => {
    if (!res?.url || !res?.schoolName) return;
    try {
      await fetch("/.netlify/functions/leaderboard", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: res.schoolName, url: res.url, overall: res.overall,
          language: res.scores?.language, strategy: res.scores?.strategy,
          cliches: res.totalCliches, pagesAudited: res.pagesAnalyzed?.length || 1,
        }),
      });
    } catch (e) { console.warn("Leaderboard submit failed:", e); }
  }, []);

  /* ─── AUDIT ENGINE (with retry + parallel sub-pages) ─── */
  async function runAudit(inputUrl, prefix = "") {
    const url = norm(inputUrl);
    if (!isEdu(url)) {
      addProg(prefix + "Only .edu domains are supported — this tool is built for higher education.", "error");
      return null;
    }
    addProg(prefix + "Fetching: " + url);

    // fetchPage now handles retries + fallback internally
    const hp = await fetchPage(url, (msg) => addProg(prefix + msg));

    if (!hp) {
      addProg(prefix + "Could not reach this site", "error");
      return null;
    }
    addProg(prefix + 'Loaded: "' + (hp.title || "Untitled") + '"');

    const scrapeSource = hp._source || "unknown"; // "cheerio" or "claude_websearch"
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

    addProg(prefix + "Running AI brand analysis...");
    const allBody = pages.map(p => p.data.body_text || "").join(" ");
    let ai;
    try { ai = await deepAnalysis(url, hp.body_text || JSON.stringify(hp), allBody); } catch (e) { addProg(prefix + "AI analysis timed out — using cliché data only", "error"); ai = null; }

    const allH1 = pages.flatMap(p => p.data.h1 || []);
    const allH2 = pages.flatMap(p => p.data.h2s || []);
    const uniq = pages.flatMap(p => p.data.unique_claims || []);
    const stock = pages.flatMap(p => p.data.stock_phrases || []);
    const cliches = countCliches(allBody + " " + allH1.join(" ") + " " + allH2.join(" "));
    const totalC = cliches.reduce((s, c) => s + c.count, 0);
    const wc = allBody.split(/\s+/).length;

    // Content richness bonus: rewards specific, distinctive content (0-30 pts)
    const richness = contentRichnessBonus(allBody, allH1, allH2, uniq);

    // Language score: penalizes cliché usage. More clichés found = lower score.
    // With expanded dictionary, expect more hits — each unique cliché costs 3pts (was 4),
    // but density penalty is stricter and "you know better" penalty kicks in harder.
    let lang = 100 - Math.min(cliches.length * 3, 50) - Math.min((totalC / Math.max(wc / 100, 1)) * 7, 30) - (uniq.length < 2 ? 10 : 0);
    // "You know better" penalty: if content is rich but you still use clichés,
    // it proves you CAN be specific but chose platitudes in spots.
    if (richness > 10 && cliches.length > 3) lang -= Math.min(cliches.length * 2, 15);
    // Thin content penalty: saying nothing isn't the same as being distinctive.
    if (wc < 300) lang -= Math.round((300 - wc) / 25);
    // AI voice score blended at 40% AI / 60% mechanical (was 50/50)
    if (ai?.voice_score) lang = Math.round(lang * 0.6 + ai.voice_score * 10 * 0.4);
    lang = Math.max(0, Math.min(100, Math.round(lang)));

    // Strategy score: mechanical base from content signals, then one-step AI blend.
    // All AI inputs are combined in a single weighted average to avoid cascading dilution.
    let mechStrat = 30 + uniq.length * 5 - stock.length * 4 + Math.min(richness * 0.7, 15);
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
    strat = Math.max(0, Math.min(100, Math.round(strat)));

    const overall = Math.round(lang * 0.55 + strat * 0.45);
    return {
      url, schoolName: hp.title || url, pagesAnalyzed: pages, overall,
      scores: { language: lang, strategy: strat },
      cliches, totalCliches: totalC,
      uniqueClaims: uniq, stockPhrases: stock,
      allH1, allH2, metaDesc: hp.meta_description || "", bodyText: allBody, ai,
      scrapeSource,
    };
  }

  const scrollToResult = () => setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);

  const runSingle = async () => { setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview"); const r = await runAudit(url1); if (r) { setResult(r); submitToLeaderboard(r); } setProgress(p => p.map(i => ({ ...i, status: "done" }))); setAnalyzing(false); scrollToResult(); };

  const runCompare = async () => { setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview"); addProg("Starting head-to-head audit..."); const r1 = await runAudit(url1, "A → "); const r2 = await runAudit(url2, "B → "); if (r1) { setResult(r1); submitToLeaderboard(r1); } if (r2) { setResult2(r2); submitToLeaderboard(r2); } setProgress(p => p.map(i => ({ ...i, status: "done" }))); setAnalyzing(false); scrollToResult(); };

  const runText = async () => {
    if (inputText.trim().length < 50) return;
    setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview");
    addProg("Analyzing copy..."); const cl = countCliches(inputText); const tc = cl.reduce((s, c) => s + c.count, 0);
    addProg("Running AI analysis..."); const ai = await deepAnalysis("(pasted text)", inputText, "");
    let lang = 100 - Math.min(cl.length * 3, 50) - Math.min((tc / Math.max(inputText.split(/\s+/).length / 100, 1)) * 7, 30);
    if (ai?.voice_score) lang = Math.round(lang * 0.6 + ai.voice_score * 10 * 0.4);
    lang = Math.max(0, Math.min(100, lang));
    setResult({ url: null, schoolName: "Your Copy", pagesAnalyzed: [{ type: "text" }], overall: lang, scores: { language: lang, strategy: null }, cliches: cl, totalCliches: tc, uniqueClaims: [], stockPhrases: [], allH1: [], allH2: [], metaDesc: "", bodyText: inputText, ai });
    setProgress(p => p.map(i => ({ ...i, status: "done" }))); setAnalyzing(false); scrollToResult();
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
          {res.url && <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, marginBottom: 4, position: "relative", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{res.url}</div>}
          <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14, position: "relative" }}>{res.pagesAnalyzed.length} page{res.pagesAnalyzed.length > 1 ? "s" : ""} audited</div>
          <div style={{ position: "relative", display: "inline-block" }}>
            <Ring score={res.overall} size={compact ? 110 : 140} />
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: compact ? 36 : 46, fontFamily: T.serif, color: scoreColor(res.overall), lineHeight: 1 }}><AnimNum value={res.overall} /></div>
              <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>/100</div>
            </div>
          </div>
          <div style={{ fontSize: compact ? 16 : 20, fontFamily: T.serif, fontStyle: "italic", color: scoreColor(res.overall), marginTop: 8, position: "relative" }}>{scoreLabel(res.overall)}</div>
          {!compact && <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, maxWidth: 480, margin: "12px auto 0", position: "relative" }}>{scoreVerdict(res.overall)}</p>}
          {dims.length > 1 && (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${dims.length}, 1fr)`, gap: 1, marginTop: 20, background: T.border, borderRadius: 8, overflow: "hidden", position: "relative" }}>
              {dims.map(d => <div key={d.key} style={{ background: "#121212", padding: compact ? "10px 4px" : "14px 6px" }}><div style={{ fontSize: compact ? 20 : 26, fontFamily: T.serif, color: scoreColor(res.scores[d.key]) }}>{res.scores[d.key]}</div><div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, marginTop: 2, textTransform: "uppercase" }}>{d.label}</div></div>)}
            </div>
          )}
        </div>
        {!compact && leaderboard.length >= 3 && (() => {
          const below = leaderboard.filter(s => s.overall < res.overall).length;
          const pct = Math.round((below / leaderboard.length) * 100);
          return (
            <div style={{ marginTop: 12, position: "relative" }}>
              <Pill color={scoreColor(res.overall)}>Better than {pct}% of {leaderboard.length} audited institutions</Pill>
            </div>
          );
        })()}
        {!compact && res.pagesAnalyzed?.length <= 1 && (res.bodyText || "").split(/\s+/).length < 400 && (
          <div style={{ background: "#1a1a00", border: "1px solid #3d3d00", borderRadius: 8, padding: "10px 14px", marginTop: 10, display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            <span style={{ fontSize: 14 }}>⚠</span>
            <p style={{ fontSize: 11, color: "#cca700", margin: 0, fontFamily: T.mono, lineHeight: 1.4 }}>Limited content detected — this site may use heavy JavaScript. Score based on what we could extract; full picture may differ.</p>
          </div>
        )}
        {res.ai?.tone_diagnosis && (
          <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "18px", marginTop: 12, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${T.accent}, ${T.accentLight}, ${T.accent})` }} />
            <div style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Brand Personality</div>
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
          {avail.map(t => <button key={t} role="tab" aria-selected={activeTab === t} onClick={() => { setActiveTab(t); if (t === "leaderboard" && leaderboard.length === 0) fetchLeaderboard(); }} style={{ padding: "7px 14px", borderRadius: 6, border: `1px solid ${activeTab === t ? T.accent : T.borderLight}`, background: activeTab === t ? T.accent + "15" : "transparent", color: activeTab === t ? T.accent : T.dim, fontSize: 11, fontFamily: T.mono, whiteSpace: "nowrap" }}>{labels[t]}</button>)}
        </div>
        <div style={{ marginTop: 14 }}>

          {/* OVERVIEW */}
          {activeTab === "overview" && res.ai && (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="overview-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[{ l: "Biggest Sin", v: res.ai.biggest_sin, c: "#ef4444" }, { l: "Best Moment", v: res.ai.best_moment, c: "#22c55e" }, { l: "Differentiation Killer", v: res.ai.differentiation_killer, c: "#f97316" }, { l: "Missed Opportunity", v: res.ai.missed_opportunity, c: "#eab308" }].map((it, i) => (
                  <div key={i} style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 10, fontFamily: T.mono, color: it.c, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{it.l}</div>
                    <p style={{ fontSize: 13, color: T.text, lineHeight: 1.55, margin: 0 }}>{it.v}</p>
                  </div>
                ))}
              </div>
              {res.ai.weak_sentence && res.ai.rewrite && res.ai.weak_sentence !== "NO_CONTENT" && !res.ai.weak_sentence.toLowerCase().includes("no clear example") && !res.ai.rewrite.toLowerCase().includes("cannot rewrite") && !res.ai.rewrite.includes("NO_CONTENT") && (
                <div style={{ background: T.cardAlt, borderRadius: 10, overflow: "hidden", border: "1px solid " + T.border }}>
                  <div style={{ padding: "8px 16px", borderBottom: "1px solid " + T.border, fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase" }}>What If You Actually Said Something?</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: T.border }}>
                    <div style={{ background: T.cardAlt, padding: "14px 16px" }}><div style={{ fontSize: 9, fontFamily: T.mono, color: "#ef4444", textTransform: "uppercase", marginBottom: 6 }}>Their Version</div><p style={{ fontSize: 13, color: "#666", lineHeight: 1.55, margin: 0, fontStyle: "italic" }}>"{res.ai.weak_sentence}"</p></div>
                    <div style={{ background: T.cardAlt, padding: "14px 16px" }}><div style={{ fontSize: 9, fontFamily: T.mono, color: "#22c55e", textTransform: "uppercase", marginBottom: 6 }}>With a Pulse</div><p style={{ fontSize: 13, color: T.text, lineHeight: 1.55, margin: 0 }}>"{res.ai.rewrite}"</p></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CLICHÉS — word cloud */}
          {activeTab === "language" && (
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase" }}>Cliché Inventory</span>
                <span style={{ fontSize: 11, fontFamily: T.mono, color: T.dim }}>{res.totalCliches} total / {res.cliches.length} unique</span>
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
                            {c.phrase}{c.count > 1 && <span style={{ fontSize: 10, fontFamily: T.mono, opacity: 0.6, marginLeft: 4 }}>×{c.count}</span>}
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
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase" }}>Your Copy — Clichés Highlighted</div>
                {res.scrapeSource && (
                  <span style={{ fontSize: 9, fontFamily: T.mono, color: res.scrapeSource === "cheerio" ? "#22c55e" : "#eab308", background: res.scrapeSource === "cheerio" ? "#22c55e12" : "#eab30812", border: `1px solid ${res.scrapeSource === "cheerio" ? "#22c55e30" : "#eab30830"}`, borderRadius: 4, padding: "2px 8px" }}>
                    {res.scrapeSource === "cheerio" ? "✓ Direct HTML extract" : "⚠ AI-assisted scrape"}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, marginBottom: 14 }}>
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
            <div className="strategy-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: "#22c55e", textTransform: "uppercase", marginBottom: 8 }}>Unique Claims ({res.uniqueClaims.length})</div>
                {res.uniqueClaims.length ? res.uniqueClaims.map((c, i) => <p key={i} style={{ fontSize: 13, color: T.text, lineHeight: 1.5, margin: "0 0 6px", padding: "4px 0", borderBottom: i < res.uniqueClaims.length - 1 ? "1px solid " + T.border : "none" }}>{c}</p>) : <p style={{ fontSize: 13, color: "#ef4444" }}>No ownable claims found.</p>}
              </div>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: "#ef4444", textTransform: "uppercase", marginBottom: 8 }}>Stock Phrases ({res.stockPhrases.length})</div>
                {res.stockPhrases.length ? res.stockPhrases.map((c, i) => <p key={i} style={{ fontSize: 13, color: T.muted, lineHeight: 1.5, margin: "0 0 6px", fontStyle: "italic" }}>"{c}"</p>) : <p style={{ fontSize: 13, color: "#22c55e" }}>Clean.</p>}
              </div>
            </div>
          )}

          {/* LEADERBOARD */}
          {activeTab === "leaderboard" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "20px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", letterSpacing: "0.1em" }}>Live Leaderboard</div>
                    <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>{leaderboard.length} institutions ranked</div>
                  </div>
                  <button onClick={fetchLeaderboard} disabled={lbLoading}
                    style={{ padding: "6px 14px", background: T.cardAlt, border: "1px solid " + T.borderLight, borderRadius: 6, color: T.dim, fontSize: 10, fontFamily: T.mono }}>
                    {lbLoading ? "Loading..." : "Refresh"}
                  </button>
                </div>
                {leaderboard.length === 0 && !lbLoading && (
                  <p style={{ color: T.dim, fontSize: 13, textAlign: "center", padding: "30px 20px", fontFamily: T.serif, fontStyle: "italic" }}>No schools ranked yet. Every audit automatically adds to the leaderboard — yours could be first.</p>
                )}
                {leaderboard.map((s, i) => {
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
                          {s.name}{isYou && <span style={{ fontSize: 10, marginLeft: 6, color: T.accent, fontFamily: T.mono }}>← YOU</span>}
                        </div>
                        <div style={{ fontSize: 9, fontFamily: T.mono, color: T.dim }}>{s.url}</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontFamily: T.serif, color: scoreColor(s.overall) }}>{s.overall}</div>
                        <div style={{ fontSize: 7, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Overall</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontFamily: T.serif, color: s.language != null ? scoreColor(s.language) : T.dim }}>{s.language ?? "–"}</div>
                        <div style={{ fontSize: 7, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Lang</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontFamily: T.serif, color: s.strategy != null ? scoreColor(s.strategy) : T.dim }}>{s.strategy ?? "–"}</div>
                        <div style={{ fontSize: 7, fontFamily: T.mono, color: T.dim, textTransform: "uppercase" }}>Strat</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 8, padding: "14px 20px", textAlign: "center" }}>
                <p style={{ fontSize: 12, color: T.dim, margin: 0, fontFamily: T.mono }}>Scores update automatically as institutions are audited. Challenge a rival with Head-to-Head mode.</p>
              </div>
            </div>
          )}

          {/* PRESCRIPTIONS */}
          {activeTab === "prescriptions" && res.ai && (
            <div style={{ display: "grid", gap: 10 }}>
              {[
                { l: "Language & Voice", t: res.ai.rx_language, c: T.accent },
                { l: "Content Strategy", t: res.ai.rx_strategy, c: "#22c55e" },
              ].filter(r => r.t).map((r, i) => (
                <div key={i} style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 20px", borderLeft: "3px solid " + r.c }}>
                  <div style={{ fontSize: 10, fontFamily: T.mono, color: r.c, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Rx: {r.l}</div>
                  <p style={{ fontSize: 14, color: T.text, lineHeight: 1.6, margin: 0 }}>{r.t}</p>
                </div>
              ))}
              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 8, padding: "16px 20px", textAlign: "center" }}>
                <p style={{ fontSize: 13, color: T.muted, margin: "0 0 6px", lineHeight: 1.6 }}>These are starting points. Real differentiation requires strategic partnership.</p>
                <a href="https://helloadeo.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: T.accent, fontWeight: 600 }}>Let's talk → helloadeo.com</a>
              </div>
            </div>
          )}

          {/* METHODOLOGY */}
          {activeTab === "methodology" && (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>How the Blanding Detector Scores Your Site</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 14px" }}>
                  Every audit produces two sub-scores that combine into your overall rating. Here's exactly what we measure and how.
                </p>
              </div>

              {/* LANGUAGE & VOICE */}
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid " + T.accent }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, fontWeight: 600, marginBottom: 10 }}>Language & Voice — 55% of overall</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Starts at 100 and penalizes downward. We scan every page for matches against a dictionary of 200+ higher ed clichés — phrases like "world-class," "transformative experience," and "leaders of tomorrow" that appear on virtually every college website.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    { label: "Cliché count penalty", desc: "Each unique cliché phrase found costs 3 points (capped at 50). More clichés = lower score.", weight: "up to −50" },
                    { label: "Density penalty", desc: "Clichés per 100 words. A high density of generic language signals the copy wasn't written — it was assembled from templates.", weight: "up to −30" },
                    { label: '"You know better" penalty', desc: "If your content is rich with specific details but still uses clichés, the penalty is steeper — you've proven you can do better.", weight: "up to −15" },
                    { label: "Thin content penalty", desc: "Pages with very little text get dinged. Saying nothing isn't the same as being distinctive.", weight: "variable" },
                    { label: "AI voice assessment", desc: "An AI evaluator reads the full text and scores how distinctive the voice feels — blended at 40% with the mechanical score above.", weight: "40% blend" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: T.bg, borderRadius: 6, padding: "10px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{item.label}</span>
                        <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>{item.weight}</span>
                      </div>
                      <p style={{ fontSize: 12, color: T.dim, lineHeight: 1.55, margin: 0 }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* CONTENT STRATEGY */}
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid #22c55e" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: "#22c55e", fontWeight: 600, marginBottom: 10 }}>Content Strategy — 45% of overall</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Starts at a base of 30 and builds upward from content signals, then blends with AI evaluation in a single weighted step.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    { label: "Unique claims bonus", desc: "Named programs, specific numbers, real people, concrete details that only your institution could say.", weight: "+5 each" },
                    { label: "Stock phrase penalty", desc: "Generic structural phrases ('Learn More,' 'Apply Now,' 'Explore Our Programs') that could appear on any site.", weight: "−4 each" },
                    { label: "Content richness bonus", desc: "Specific dates, proper nouns, data points, direct quotes, diverse section headings — signals of real, timely content.", weight: "up to +15" },
                    { label: "AI specificity score", desc: "How concrete and specific is the content? Named events, real research, actual numbers vs. vague platitudes.", weight: "20% of blend" },
                    { label: "AI consistency score", desc: "Does every element reinforce a coherent identity, or does the messaging scatter?", weight: "15% of blend" },
                    { label: "Specificity ratio", desc: "What percentage of the total page content is genuinely specific vs. generic filler? One good story in a sea of boilerplate won't save the score.", weight: "10% of blend" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: T.bg, borderRadius: 6, padding: "10px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{item.label}</span>
                        <span style={{ fontSize: 10, fontFamily: T.mono, color: T.dim }}>{item.weight}</span>
                      </div>
                      <p style={{ fontSize: 12, color: T.dim, lineHeight: 1.55, margin: 0 }}>{item.desc}</p>
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
                  We scrape your homepage plus up to 3 linked sub-pages (About, Admissions, Academics). We extract all visible text, headings, and meta descriptions. An AI model then reads the full content as a "brand critic" — evaluating voice, specificity, and consistency independent of the mechanical scoring.
                </p>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  The final score blends mechanical analysis (cliché matching, content signals) with AI evaluation (voice, specificity, consistency). Mechanical signals are weighted more heavily because they're deterministic and reproducible — the AI layer adds qualitative judgment about how the whole page <em>feels</em>, but can't override what the data shows.
                </p>
              </div>

              {/* HONEST LIMITATIONS */}
              <div style={{ background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, fontWeight: 600, marginBottom: 10 }}>Honest Limitations</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "0 0 8px" }}>
                  This tool measures <em>language differentiation</em> — whether your website copy sounds like you or sounds like everyone. It doesn't measure brand strategy effectiveness, enrollment outcomes, or whether your messaging resonates with your specific audience. A school can score well here and still have the wrong message; a school can score poorly and still enroll students. But if you sound like everyone else, you're making your marketing team's job harder than it needs to be.
                </p>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Scores may vary slightly between runs due to the AI evaluation component. JS-heavy sites that don't render HTML may not be fully scrapable. The cliché dictionary, while extensive, focuses on North American higher education language patterns.
                </p>
              </div>

              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 8, padding: "16px 20px", textAlign: "center" }}>
                <p style={{ fontSize: 13, color: T.muted, margin: "0 0 8px", lineHeight: 1.6 }}>Questions about the methodology? Disagree with a score? We'd love to hear from you.</p>
                <a href="https://savvycal.com/traceyhalvorsen/chat-with-tracey-halvorsen?d=15" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: T.accent, fontWeight: 600, textDecoration: "none" }}>Book a call and let's talk about it →</a>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 40 }}>
            <a href="https://helloadeo.com" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
              <AdeoLogo height={22} color="#fff" dotColor="#E6BDED" />
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: T.dim, borderLeft: "1px solid " + T.border, paddingLeft: 12 }}>brand tools</span>
            </a>
          </div>
          <span style={{ display: "inline-block", fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: T.accent, fontFamily: T.mono, marginBottom: 12 }}>Higher Ed Edition</span>
          <h1 style={{ fontSize: "clamp(38px, 6.5vw, 64px)", fontFamily: T.serif, fontWeight: 400, lineHeight: 1.0, margin: 0, letterSpacing: "-0.02em" }}>
            The Blanding<br /><span style={{ fontStyle: "italic", color: T.accent }}>Detector</span>
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "#999", maxWidth: 540, marginTop: 16, fontWeight: 300 }}>
            How generic is your institution's website copy? Paste a URL and find out. We scan your homepage and landing pages for clichés, stock phrases, and the kind of language that makes every school sound the same.
          </p>
          {auditCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e80" }} />
              <span style={{ fontSize: 11, fontFamily: T.mono, color: T.dim }}>{auditCount} institutions audited and counting</span>
            </div>
          )}
        </header>

        {/* INPUT */}
        <section style={{ marginTop: 32 }}>
          <div style={{ display: "flex", gap: 2, marginBottom: 16, background: T.card, borderRadius: 8, padding: 3, width: "fit-content" }}>
            {[{ l: "Single Audit", v: "single" }, { l: "Head-to-Head", v: "compare" }, { l: "Paste Text", v: "text" }].map(m => (
              <button key={m.v} onClick={() => { setMode(m.v); setResult(null); setResult2(null); setProgress([]); }}
                style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: mode === m.v ? T.accent : "transparent", color: mode === m.v ? "#fff" : T.dim, fontSize: 11, fontFamily: T.mono, fontWeight: 500 }}>{m.l}</button>
            ))}
          </div>

          {mode === "single" && (
            <div>
              <div className="audit-input-row" style={{ display: "flex", gap: 10 }}>
                <input value={url1} onChange={e => setUrl1(e.target.value)} placeholder="e.g. middlebury.edu" onKeyDown={e => e.key === "Enter" && url1.trim() && isEdu(url1) && runSingle()}
                  aria-label="School website URL" aria-invalid={url1.trim() && !isEdu(url1) ? "true" : undefined} aria-describedby={url1.trim() && !isEdu(url1) ? "edu-error" : undefined}
                  style={{ flex: 1, background: T.card, border: "1px solid " + (url1.trim() && !isEdu(url1) ? "#ef4444" : T.borderLight), borderRadius: 10, padding: "15px 18px", color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = url1.trim() && !isEdu(url1) ? "#ef4444" : T.accent} onBlur={e => e.target.style.borderColor = url1.trim() && !isEdu(url1) ? "#ef4444" : T.borderLight} />
                <button onClick={runSingle} disabled={analyzing || !url1.trim() || !isEdu(url1)} aria-label="Audit this site"
                  style={{ padding: "15px 26px", background: (!url1.trim() || !isEdu(url1)) ? "#1a1a1a" : `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 10, color: (!url1.trim() || !isEdu(url1)) ? "#444" : "#fff", fontSize: 14, fontWeight: 600, fontFamily: T.sans, whiteSpace: "nowrap" }}>
                  {analyzing ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner />Auditing...</span> : "Audit Site"}
                </button>
              </div>
              {url1.trim() && !isEdu(url1) && <p id="edu-error" role="alert" style={{ margin: "8px 0 0", fontSize: 12, fontFamily: T.mono, color: "#ef4444" }}>Only .edu domains — this tool is built for higher education sites.</p>}
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
              {((url1.trim() && !isEdu(url1)) || (url2.trim() && !isEdu(url2))) && <p style={{ margin: 0, fontSize: 12, fontFamily: T.mono, color: "#ef4444" }}>Only .edu domains — this tool is built for higher education sites.</p>}
              <button onClick={runCompare} disabled={analyzing || !url1.trim() || !url2.trim() || !isEdu(url1) || !isEdu(url2)}
                style={{ padding: "15px", background: (!url1.trim() || !url2.trim()) ? "#1a1a1a" : `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 10, color: (!url1.trim() || !url2.trim()) ? "#444" : "#fff", fontSize: 14, fontWeight: 600, fontFamily: T.sans }}>
                {analyzing ? "Running Head-to-Head..." : "Compare These Schools"}
              </button>
            </div>
          )}

          {mode === "text" && (
            <>
              <textarea value={inputText} onChange={e => setInputText(e.target.value)} aria-label="Paste marketing text to analyze" placeholder="Paste your homepage copy, about page, or any marketing text..."
                style={{ width: "100%", minHeight: 170, background: T.card, border: "1px solid " + T.borderLight, borderRadius: 10, padding: "16px 20px", color: T.text, fontSize: 14, lineHeight: 1.7, fontFamily: T.sans, resize: "vertical", outline: "none" }}
                onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
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
                : [{ l: "middlebury.edu" }, { l: "asu.edu" }, { l: "snhu.edu" }, { l: "skidmore.edu" }]
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
        </section>

        {/* PROGRESS */}
        {progress.length > 0 && !result && (
          <section style={{ marginTop: 28 }}>
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "18px 22px" }}>
              {progress.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", opacity: p.status === "done" ? 0.45 : 1, transition: "opacity 0.3s" }}>
                  {p.status === "loading" ? <Spinner /> : p.status === "error" ? <span style={{ color: "#ef4444", fontSize: 13 }}>✗</span> : <span style={{ color: "#22c55e", fontSize: 13 }}>✓</span>}
                  <span style={{ fontSize: 12, fontFamily: T.mono, color: p.status === "error" ? "#ef4444" : T.muted }}>{p.msg}</span>
                </div>
              ))}
            </div>
            {/* If failed, offer paste fallback */}
            {progress.some(p => p.status === "error" && p.msg.includes("Could not reach")) && !analyzing && (
              <div style={{ marginTop: 10, background: T.cardAlt, border: "1px solid " + T.border, borderRadius: 8, padding: "14px 18px", textAlign: "center" }}>
                <p style={{ fontSize: 13, color: T.muted, margin: "0 0 8px" }}>Can't reach this site? Try pasting your homepage copy instead.</p>
                <button onClick={() => { setMode("text"); setProgress([]); }}
                  style={{ padding: "8px 18px", background: T.accent + "20", border: "1px solid " + T.accent + "40", borderRadius: 6, color: T.accent, fontSize: 12, fontFamily: T.mono }}>
                  Switch to Paste Text
                </button>
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
              <a href="https://helloadeo.com" target="_blank" rel="noopener noreferrer"
                style={{ background: `linear-gradient(135deg, ${T.accent}, #b06830)`, borderRadius: 9, padding: "14px 12px", color: "#fff", fontSize: 11, fontWeight: 600, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
                Fix Your Brand →
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
                    placeholder="Enter rival school .edu URL..." onKeyDown={e => e.key === "Enter" && challengeUrl.trim() && isEdu(challengeUrl) && handleChallenge()}
                    aria-label="Rival school URL" aria-invalid={challengeUrl.trim() && !isEdu(challengeUrl) ? "true" : undefined}
                    style={{ flex: 1, background: T.bg, border: "1px solid " + (challengeUrl.trim() && !isEdu(challengeUrl) ? "#ef4444" : T.borderLight), borderRadius: 8, padding: "10px 14px", color: T.text, fontSize: 13, fontFamily: T.sans, outline: "none" }}
                    onFocus={e => e.target.style.borderColor = challengeUrl.trim() && !isEdu(challengeUrl) ? "#ef4444" : T.accent} onBlur={e => e.target.style.borderColor = challengeUrl.trim() && !isEdu(challengeUrl) ? "#ef4444" : T.borderLight} />
                  <button onClick={handleChallenge} disabled={!challengeUrl.trim() || !isEdu(challengeUrl)}
                    style={{ padding: "10px 18px", background: (challengeUrl.trim() && isEdu(challengeUrl)) ? T.accent : "#1a1a1a", border: "none", borderRadius: 8, color: (challengeUrl.trim() && isEdu(challengeUrl)) ? "#fff" : "#444", fontSize: 12, fontWeight: 600, fontFamily: T.mono, whiteSpace: "nowrap" }}>
                    Head-to-Head →
                  </button>
                </div>
                {challengeUrl.trim() && !isEdu(challengeUrl) && <p role="alert" style={{ margin: "6px 0 0", fontSize: 11, fontFamily: T.mono, color: "#ef4444" }}>Only .edu domains supported.</p>}
              </div>
            )}

            <div style={{ marginTop: 32, padding: "28px 24px", background: T.cardAlt, borderRadius: 10, border: "1px solid #161616", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.65, margin: 0, maxWidth: 540, marginLeft: "auto", marginRight: "auto" }}>
                This tool catches the surface-level sameness. The deeper problem — why institutions default to generic language and how to build a brand that actually differentiates — requires a strategic partner who understands higher ed from the inside.
              </p>
              <p style={{ fontSize: 15, fontFamily: T.serif, fontStyle: "italic", color: T.text, marginTop: 14, marginBottom: 0 }}>Want to talk to an expert about your institution's brand communications?</p>
              <a href="https://savvycal.com/traceyhalvorsen/chat-with-tracey-halvorsen?d=15" target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: 14, padding: "12px 28px", background: `linear-gradient(135deg, ${T.accent}, #b06830)`, borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: T.sans, textDecoration: "none" }}>
                Book a Free 15-Minute Call →
              </a>
            </div>

            {/* STAY IN TOUCH — lightweight lead capture */}
            <div style={{ marginTop: 16, background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "24px" }}>
              {staySent ? (
                <div style={{ textAlign: "center", padding: "12px 0" }}>
                  <div style={{ fontSize: 22, color: "#22c55e", marginBottom: 8 }}>✓</div>
                  <p style={{ fontSize: 14, color: T.text, fontFamily: T.serif, fontStyle: "italic", margin: 0 }}>You're on the list — and your full PDF report is downloading now.</p>
                </div>
              ) : (
                <>
                  <div style={{ textAlign: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Not ready to talk yet?</div>
                    <p style={{ fontSize: 14, fontFamily: T.serif, fontStyle: "italic", color: T.text, margin: 0 }}>Drop your info and we'll keep you in the loop on new brand tools and higher ed insights.</p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <input value={stayName} onChange={e => setStayName(e.target.value)} placeholder="Name" aria-label="Your name"
                      style={{ background: T.bg, border: "1px solid " + T.borderLight, borderRadius: 8, padding: "10px 14px", color: T.text, fontSize: 13, fontFamily: T.sans, outline: "none" }}
                      onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
                    <input value={stayTitle} onChange={e => setStayTitle(e.target.value)} placeholder="Title (optional)" aria-label="Your title"
                      style={{ background: T.bg, border: "1px solid " + T.borderLight, borderRadius: 8, padding: "10px 14px", color: T.text, fontSize: 13, fontFamily: T.sans, outline: "none" }}
                      onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={stayEmail} onChange={e => setStayEmail(e.target.value)} placeholder="Email" type="email" aria-label="Your email"
                      onKeyDown={e => e.key === "Enter" && handleStayInTouch()}
                      style={{ flex: 1, background: T.bg, border: "1px solid " + T.borderLight, borderRadius: 8, padding: "10px 14px", color: T.text, fontSize: 13, fontFamily: T.sans, outline: "none" }}
                      onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
                    <button onClick={handleStayInTouch} disabled={!stayEmail.includes("@")}
                      style={{ padding: "10px 20px", background: stayEmail.includes("@") ? T.accent : "#1a1a1a", border: "none", borderRadius: 8, color: stayEmail.includes("@") ? "#fff" : "#444", fontSize: 12, fontWeight: 600, fontFamily: T.mono, whiteSpace: "nowrap" }}>
                      Keep Me Posted
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        <footer style={{ paddingTop: 32, paddingBottom: 24, borderTop: "1px solid #151515", marginTop: result ? 0 : 80, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: T.faint, fontFamily: T.mono }}>© 2026 adeo</span>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <button onClick={() => { setShowMethodology(m => !m); setTimeout(() => methRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}
              style={{ background: "none", border: "none", padding: 0, fontSize: 10, color: T.faint, fontFamily: T.mono, textDecoration: "none", cursor: "pointer" }}
              onMouseEnter={e => { e.target.style.color = T.accent; }} onMouseLeave={e => { e.target.style.color = T.faint; }}>
              How We Score
            </button>
            <a href="https://helloadeo.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: T.faint, fontFamily: T.mono, textDecoration: "none" }}
              onMouseEnter={e => { e.target.style.color = T.accent; }} onMouseLeave={e => { e.target.style.color = T.faint; }}>helloadeo.com</a>
          </div>
        </footer>

        {/* STANDALONE METHODOLOGY (footer link) */}
        {showMethodology && (
          <section ref={methRef} style={{ paddingBottom: 60 }}>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 18, fontFamily: T.serif, color: T.text }}>How the Blanding Detector <span style={{ fontStyle: "italic", color: T.accent }}>Scores</span></div>
                  <button onClick={() => setShowMethodology(false)} style={{ background: "none", border: "none", color: T.dim, fontSize: 11, fontFamily: T.mono, cursor: "pointer" }}>Close ✕</button>
                </div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: "12px 0 0" }}>
                  Every audit produces two sub-scores that combine into your overall rating. The score is a blend of deterministic text analysis (cliché matching, content signals, structural patterns) and AI-powered qualitative evaluation. Mechanical signals are weighted more heavily because they're reproducible — the AI layer adds judgment about how the whole page feels, but can't override what the data shows.
                </p>
              </div>

              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid " + T.accent }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, fontWeight: 600, marginBottom: 10 }}>Language & Voice — 55% of overall</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Starts at 100, then penalizes for cliché usage. We match against a curated dictionary of 200+ higher ed clichés. Penalties scale with both the number of unique clichés found and their density per 100 words. Sites that show they <em>can</em> be specific (rich content) but still fall back on clichés get a steeper penalty. An AI voice assessment blends in at 40% to capture the qualitative feel that pure pattern-matching misses.
                </p>
              </div>

              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "22px 24px", borderLeft: "3px solid #22c55e" }}>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: "#22c55e", fontWeight: 600, marginBottom: 10 }}>Content Strategy — 45% of overall</div>
                <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, margin: 0 }}>
                  Builds upward from a base of 30, rewarding unique claims, concrete details, and rich content signals (named people, specific dates, data points, direct quotes). Stock phrases and generic CTAs pull the score down. AI evaluation — covering specificity, consistency, and the ratio of specific-to-generic content — blends in a single weighted step at 45%. One good story buried in boilerplate won't save the score; the specificity ratio ensures the proportion of real content matters.
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
                  This scores <em>language differentiation</em> — whether your website copy sounds like you or sounds like everyone else. It doesn't measure brand strategy effectiveness, enrollment outcomes, or audience resonance. Scores may vary slightly between runs due to the AI component. JS-heavy sites may not be fully scrapable.
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
            <div style={{ margin: "0 auto 20px", display: "flex", justifyContent: "center" }}><AdeoLogo height={28} color="#fff" dotColor="#E6BDED" /></div>
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

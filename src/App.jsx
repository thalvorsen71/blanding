import { useState, useRef, useEffect, useCallback } from 'react';
import { T, scoreColor, scoreLabel, scoreVerdict, countCliches, highlightCliches, calcNavScore, NAV_CLICHES } from './constants';
import { fetchPage, deepAnalysis, captureLead } from './api';
import { exportPDF } from './pdf';

/* ═══ SMALL COMPONENTS ═══ */
function AnimNum({ value, dur = 1400 }) {
  const [d, setD] = useState(0);
  const r = useRef(null);
  useEffect(() => {
    let s = null;
    const go = ts => { if (!s) s = ts; const p = Math.min((ts - s) / dur, 1); setD(Math.round((1 - Math.pow(1 - p, 3)) * value)); if (p < 1) r.current = requestAnimationFrame(go); };
    r.current = requestAnimationFrame(go);
    return () => cancelAnimationFrame(r.current);
  }, [value, dur]);
  return <span>{d}</span>;
}

function Ring({ score, size = 140, sw = 5 }) {
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
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
  return <span style={{ width: size, height: size, border: "2px solid #222", borderTopColor: T.accent, borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />;
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
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const resultRef = useRef(null);

  const addProg = useCallback((msg, status = "loading") => {
    setProgress(p => [...p.map(i => i.status === "loading" ? { ...i, status: "done" } : i), { msg, status, id: Date.now() }]);
  }, []);

  const norm = u => { let x = u.trim(); if (!x.match(/^https?:\/\//)) x = "https://" + x; return x; };

  /* ─── AUDIT ENGINE ─── */
  async function runAudit(inputUrl, prefix = "") {
    const url = norm(inputUrl);
    addProg(prefix + "Fetching: " + url);
    let hp;
    try { hp = await fetchPage(url); } catch { addProg(prefix + "Failed to fetch", "error"); return null; }
    addProg(prefix + 'Loaded: "' + (hp.title || "Untitled") + '"');

    const pages = [{ url, data: hp, type: "homepage" }];
    const linked = (hp.linked_pages || []).slice(0, 3);
    if (linked.length) {
      addProg(prefix + "Found " + linked.length + " sub-pages");
      for (const pu of linked) {
        addProg(prefix + "Scanning: " + pu);
        try { const pd = await fetchPage(pu); if (pd) pages.push({ url: pu, data: pd, type: pd.page_type || "other" }); } catch { }
      }
    }

    addProg(prefix + "Running AI brand analysis...");
    const allBody = pages.map(p => p.data.body_text || "").join(" ");
    const ai = await deepAnalysis(url, hp.body_text || JSON.stringify(hp), allBody);

    const allH1 = pages.flatMap(p => p.data.h1 || []);
    const allH2 = pages.flatMap(p => p.data.h2s || []);
    const allCTAs = pages.flatMap(p => p.data.ctas || []);
    const navItems = hp.nav_items || [];
    const uniq = pages.flatMap(p => p.data.unique_claims || []);
    const stock = pages.flatMap(p => p.data.stock_phrases || []);
    const cliches = countCliches(allBody + " " + allH1.join(" ") + " " + allH2.join(" "));
    const totalC = cliches.reduce((s, c) => s + c.count, 0);
    const ns = calcNavScore(navItems);
    const wc = allBody.split(/\s+/).length;

    // Score calculations
    let lang = 100 - Math.min(cliches.length * 3.5, 45) - Math.min((totalC / Math.max(wc / 100, 1)) * 7, 30) - (uniq.length < 2 ? 15 : 0);
    if (ai?.voice_score) lang = (lang + ai.voice_score * 10) / 2;
    lang = Math.max(0, Math.min(100, Math.round(lang)));

    let ia = ns.score; if (ai?.ia_score) ia = Math.round((ia + ai.ia_score * 10) / 2);
    ia = Math.max(0, Math.min(100, ia));

    let strat = 50 + uniq.length * 5 - stock.length * 3;
    if (ai?.specificity_score) strat = (strat + ai.specificity_score * 10) / 2;
    if (ai?.consistency_score) strat = (strat + ai.consistency_score * 10) / 2;
    strat = Math.max(0, Math.min(100, Math.round(strat)));

    let ux = 50;
    const genCTAs = allCTAs.filter(c => /^(apply|learn more|read more|visit|explore|discover|request info|get started|submit|view|see more|find out)/i.test(c.trim()));
    ux -= genCTAs.length * 5; ux += (allCTAs.length - genCTAs.length) * 3;
    if (ai?.cta_score) ux = (ux + ai.cta_score * 10) / 2;
    ux = Math.max(0, Math.min(100, Math.round(ux)));

    const overall = Math.round(lang * 0.35 + ia * 0.15 + strat * 0.3 + ux * 0.2);

    return {
      url, schoolName: hp.title || url, pagesAnalyzed: pages, overall,
      scores: { language: lang, architecture: ia, strategy: strat, experience: ux },
      cliches, totalCliches: totalC, navItems, navScore: ns, allCTAs,
      genericCTAs: genCTAs.map(c => c.trim()), uniqueClaims: uniq, stockPhrases: stock,
      allH1, allH2, metaDesc: hp.meta_description || "", bodyText: allBody, ai,
    };
  }

  const scrollToResult = () => setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);

  const runSingle = async () => { setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview"); const r = await runAudit(url1); if (r) setResult(r); setProgress(p => p.map(i => ({ ...i, status: "done" }))); setAnalyzing(false); scrollToResult(); };

  const runCompare = async () => { setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview"); addProg("Starting head-to-head audit..."); const r1 = await runAudit(url1, "A → "); const r2 = await runAudit(url2, "B → "); if (r1) setResult(r1); if (r2) setResult2(r2); setProgress(p => p.map(i => ({ ...i, status: "done" }))); setAnalyzing(false); scrollToResult(); };

  const runText = async () => {
    if (inputText.trim().length < 50) return;
    setAnalyzing(true); setProgress([]); setResult(null); setResult2(null); setActiveTab("overview");
    addProg("Analyzing copy..."); const cl = countCliches(inputText); const tc = cl.reduce((s, c) => s + c.count, 0);
    addProg("Running AI analysis..."); const ai = await deepAnalysis("(pasted text)", inputText, "");
    let lang = 100 - Math.min(cl.length * 3.5, 45) - Math.min((tc / Math.max(inputText.split(/\s+/).length / 100, 1)) * 7, 30);
    if (ai?.voice_score) lang = Math.round((lang + ai.voice_score * 10) / 2);
    lang = Math.max(0, Math.min(100, lang));
    setResult({ url: null, schoolName: "Your Copy", pagesAnalyzed: [{ type: "text" }], overall: lang, scores: { language: lang, architecture: null, strategy: null, experience: null }, cliches: cl, totalCliches: tc, navItems: [], navScore: null, allCTAs: [], genericCTAs: [], uniqueClaims: [], stockPhrases: [], allH1: [], allH2: [], metaDesc: "", bodyText: inputText, ai });
    setProgress(p => p.map(i => ({ ...i, status: "done" }))); setAnalyzing(false); scrollToResult();
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(`Our higher ed website just scored ${result.overall}/100 on the Blanding Detector 😬\n\n"${scoreLabel(result.overall)}" — ${scoreVerdict(result.overall)}\n\n${result.totalCliches} clichés across ${result.pagesAnalyzed.length} page${result.pagesAnalyzed.length > 1 ? "s" : ""}.\n\nHow generic is YOUR institution? Try it free →\n\n#HigherEd #Branding #HigherEdMarketing`);
    setCopyFB(true); setTimeout(() => setCopyFB(false), 2500);
  };

  const handleExport = () => { setEmailModal(true); };

  const handleEmailSubmit = async () => {
    if (!email.includes("@")) return;
    await captureLead(email, result?.schoolName, result?.overall);
    setEmailSent(true);
    setTimeout(() => { setEmailModal(false); setEmailSent(false); exportPDF(result); }, 1000);
  };

  /* ═══ RESULT BLOCK ═══ */
  function ResultBlock({ res, compact }) {
    if (!res) return null;
    const dims = [{ key: "language", label: "Language" }, { key: "architecture", label: "IA" }, { key: "strategy", label: "Strategy" }, { key: "experience", label: "UX" }].filter(d => res.scores[d.key] != null);
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 14, padding: compact ? "24px 16px" : "36px 28px", textAlign: "center", position: "relative", overflow: "hidden" }}>
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
    const tabs = ["overview", "language", "highlighted", "architecture", "strategy", "experience", "prescriptions"];
    const labels = { overview: "Overview", language: "Clichés", highlighted: "Highlighted Text", architecture: "IA", strategy: "Strategy", experience: "UX", prescriptions: "Rx: Fix It" };
    const avail = tabs.filter(t => {
      if (["architecture", "strategy", "experience"].includes(t)) return res.scores[t] != null;
      if (t === "highlighted") return !!res.bodyText;
      if (t === "prescriptions") return !!res.ai?.rx_language;
      return true;
    });

    return (
      <>
        <div style={{ display: "flex", gap: 4, marginTop: 20, overflowX: "auto", paddingBottom: 4 }}>
          {avail.map(t => <button key={t} onClick={() => setActiveTab(t)} style={{ padding: "7px 14px", borderRadius: 6, border: `1px solid ${activeTab === t ? T.accent : T.borderLight}`, background: activeTab === t ? T.accent + "15" : "transparent", color: activeTab === t ? T.accent : T.dim, fontSize: 11, fontFamily: T.mono, whiteSpace: "nowrap" }}>{labels[t]}</button>)}
        </div>
        <div style={{ marginTop: 14 }}>

          {/* OVERVIEW */}
          {activeTab === "overview" && res.ai && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[{ l: "Biggest Sin", v: res.ai.biggest_sin, c: "#ef4444" }, { l: "Best Moment", v: res.ai.best_moment, c: "#22c55e" }, { l: "Differentiation Killer", v: res.ai.differentiation_killer, c: "#f97316" }, { l: "Missed Opportunity", v: res.ai.missed_opportunity, c: "#eab308" }].map((it, i) => (
                  <div key={i} style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 10, fontFamily: T.mono, color: it.c, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{it.l}</div>
                    <p style={{ fontSize: 13, color: T.text, lineHeight: 1.55, margin: 0 }}>{it.v}</p>
                  </div>
                ))}
              </div>
              {res.ai.weak_sentence && res.ai.rewrite && (
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

          {/* CLICHÉS */}
          {activeTab === "language" && (
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase" }}>Cliché Inventory</span>
                <span style={{ fontSize: 11, fontFamily: T.mono, color: T.dim }}>{res.totalCliches} total / {res.cliches.length} unique</span>
              </div>
              {res.cliches.length === 0 ? <p style={{ color: "#22c55e", fontSize: 13 }}>No common clichés detected.</p> :
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{res.cliches.map((c, i) => <Pill key={i}>{c.phrase}{c.count > 1 && <span style={{ opacity: 0.6 }}> ×{c.count}</span>}</Pill>)}</div>}
            </div>
          )}

          {/* HIGHLIGHTED TEXT */}
          {activeTab === "highlighted" && res.bodyText && (
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", marginBottom: 4 }}>Your Copy — Clichés Highlighted</div>
              <p style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, marginBottom: 14 }}>Every <span style={{ background: "#ef444425", color: "#ef4444", padding: "1px 4px", borderRadius: 3 }}>highlighted phrase</span> could appear on any college website.</p>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: "#bbb", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {highlightCliches(res.bodyText.substring(0, 4000)).map((seg, i) =>
                  seg.hl ? <span key={i} style={{ background: "#ef444420", color: "#ef4444", padding: "1px 3px", borderRadius: 3, borderBottom: "2px solid #ef444460", fontWeight: 500 }}>{seg.text}</span> : <span key={i}>{seg.text}</span>
                )}
              </div>
            </div>
          )}

          {/* ARCHITECTURE */}
          {activeTab === "architecture" && res.navScore && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", marginBottom: 12 }}>Navigation Labels</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {res.navItems.map((n, i) => { const gen = NAV_CLICHES.some(c => n.toLowerCase().includes(c) || c.includes(n.toLowerCase())); return <Pill key={i} color={gen ? "#ef4444" : "#22c55e"}>{n} {gen && <span style={{ fontSize: 9, opacity: 0.7 }}>⟵ generic</span>}</Pill>; })}
                </div>
                <p style={{ fontSize: 12, color: T.dim, margin: 0, fontFamily: T.mono }}>{res.navScore.generic}/{res.navScore.total} labels identical to every other school</p>
              </div>
              {res.ai?.nav_critique && <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: "16px 20px" }}><div style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: "uppercase", marginBottom: 6 }}>Critique</div><p style={{ fontSize: 14, color: T.text, lineHeight: 1.6, margin: 0 }}>{res.ai.nav_critique}</p></div>}
            </div>
          )}

          {/* STRATEGY */}
          {activeTab === "strategy" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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

          {/* EXPERIENCE */}
          {activeTab === "experience" && (
            <div style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.accent, textTransform: "uppercase", marginBottom: 12 }}>Calls-to-Action Audit</div>
              {res.allCTAs.length > 0 ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{res.allCTAs.map((c, i) => { const gen = /^(apply|learn more|read more|visit|explore|discover|request info|get started|submit|view|see more|find out)/i.test(c.trim()); return <Pill key={i} color={gen ? "#ef4444" : "#22c55e"}>{c.trim()} {gen && <span style={{ fontSize: 9, opacity: 0.7 }}>generic</span>}</Pill>; })}</div> : <p style={{ color: T.dim, fontSize: 13 }}>No CTAs captured.</p>}
            </div>
          )}

          {/* PRESCRIPTIONS */}
          {activeTab === "prescriptions" && res.ai && (
            <div style={{ display: "grid", gap: 10 }}>
              {[
                { l: "Language & Voice", t: res.ai.rx_language, c: T.accent },
                { l: "Information Architecture", t: res.ai.rx_structure, c: "#eab308" },
                { l: "Content Strategy", t: res.ai.rx_strategy, c: "#22c55e" },
                { l: "Digital Experience", t: res.ai.rx_experience, c: "#84cc16" },
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

      <div style={{ position: "relative", zIndex: 2, maxWidth: 940, margin: "0 auto", padding: "0 24px" }}>

        {/* HEADER */}
        <header style={{ paddingTop: 40, paddingBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, background: `linear-gradient(135deg, ${T.accent}, ${T.accentLight})`, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: T.bg, fontFamily: T.mono }}>a</div>
              <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted }}>adeo / brand tools</span>
            </div>
          </div>
          <span style={{ display: "inline-block", fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: T.accent, fontFamily: T.mono, marginBottom: 12 }}>Higher Ed Edition</span>
          <h1 style={{ fontSize: "clamp(38px, 6.5vw, 64px)", fontFamily: T.serif, fontWeight: 400, lineHeight: 1.0, margin: 0, letterSpacing: "-0.02em" }}>
            The Blanding<br /><span style={{ fontStyle: "italic", color: T.accent }}>Detector</span>
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "#999", maxWidth: 540, marginTop: 16, fontWeight: 300 }}>
            Audit your website for generic language, cookie-cutter navigation, and institutional sameness. Compare yourself against a competitor. Get specific prescriptions to fix it.
          </p>
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
            <div style={{ display: "flex", gap: 10 }}>
              <input value={url1} onChange={e => setUrl1(e.target.value)} placeholder="e.g. middlebury.edu" onKeyDown={e => e.key === "Enter" && url1.trim() && runSingle()}
                style={{ flex: 1, background: T.card, border: "1px solid " + T.borderLight, borderRadius: 10, padding: "15px 18px", color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }}
                onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
              <button onClick={runSingle} disabled={analyzing || !url1.trim()}
                style={{ padding: "15px 26px", background: !url1.trim() ? "#1a1a1a" : `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 10, color: !url1.trim() ? "#444" : "#fff", fontSize: 14, fontWeight: 600, fontFamily: T.sans, whiteSpace: "nowrap" }}>
                {analyzing ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner />Auditing...</span> : "Audit Site"}
              </button>
            </div>
          )}

          {mode === "compare" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
                <input value={url1} onChange={e => setUrl1(e.target.value)} placeholder="School A — e.g. williams.edu"
                  style={{ background: T.card, border: "1px solid " + T.borderLight, borderRadius: 10, padding: "15px 18px", color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
                <span style={{ fontSize: 14, fontFamily: T.serif, fontStyle: "italic", color: T.dim }}>vs</span>
                <input value={url2} onChange={e => setUrl2(e.target.value)} placeholder="School B — e.g. amherst.edu"
                  style={{ background: T.card, border: "1px solid " + T.borderLight, borderRadius: 10, padding: "15px 18px", color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = T.accent} onBlur={e => e.target.style.borderColor = T.borderLight} />
              </div>
              <button onClick={runCompare} disabled={analyzing || !url1.trim() || !url2.trim()}
                style={{ padding: "15px", background: (!url1.trim() || !url2.trim()) ? "#1a1a1a" : `linear-gradient(135deg, ${T.accent}, #b06830)`, border: "none", borderRadius: 10, color: (!url1.trim() || !url2.trim()) ? "#444" : "#fff", fontSize: 14, fontWeight: 600, fontFamily: T.sans }}>
                {analyzing ? "Running Head-to-Head..." : "Compare These Schools"}
              </button>
            </div>
          )}

          {mode === "text" && (
            <>
              <textarea value={inputText} onChange={e => setInputText(e.target.value)} placeholder="Paste your homepage copy, about page, or any marketing text..."
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
          </section>
        )}

        {/* RESULTS */}
        {result && (
          <section ref={resultRef} style={{ marginTop: 40, paddingBottom: 80 }}>

            {/* COMPARE */}
            {mode === "compare" && result2 ? (
              <>
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <ResultBlock res={result} compact />
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", flexShrink: 0 }}>
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
                {/* Dimension bars */}
                {result.scores.architecture != null && result2.scores.architecture != null && (
                  <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
                    {[{ key: "language", label: "Language" }, { key: "architecture", label: "IA" }, { key: "strategy", label: "Strategy" }, { key: "experience", label: "UX" }].map(d => {
                      const s1 = result.scores[d.key], s2 = result2.scores[d.key];
                      return (
                        <div key={d.key} style={{ background: T.card, border: "1px solid " + T.border, borderRadius: 8, padding: "12px 16px", display: "grid", gridTemplateColumns: "70px 1fr auto 1fr 70px", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 20, fontFamily: T.serif, color: scoreColor(s1), textAlign: "right" }}>{s1}</span>
                          <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: "hidden", direction: "rtl" }}><div style={{ height: "100%", width: `${s1}%`, background: scoreColor(s1), borderRadius: 3, transition: "width 1s ease" }} /></div>
                          <span style={{ fontSize: 9, fontFamily: T.mono, color: T.dim, textTransform: "uppercase", textAlign: "center", minWidth: 55 }}>{d.label}</span>
                          <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: "hidden" }}><div style={{ height: "100%", width: `${s2}%`, background: scoreColor(s2), borderRadius: 3, transition: "width 1s ease" }} /></div>
                          <span style={{ fontSize: 20, fontFamily: T.serif, color: scoreColor(s2) }}>{s2}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <ResultBlock res={result} />
                <TabContent res={result} />
              </>
            )}

            {/* ACTIONS */}
            <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <button onClick={handleCopy}
                style={{ background: T.card, border: "1px solid " + T.borderLight, borderRadius: 9, padding: "14px 16px", color: copyFB ? "#22c55e" : T.muted, fontSize: 12, fontWeight: 500 }}
                onMouseEnter={e => { if (!copyFB) { e.target.style.borderColor = T.accent; e.target.style.color = T.accent; } }}
                onMouseLeave={e => { if (!copyFB) { e.target.style.borderColor = T.borderLight; e.target.style.color = T.muted; } }}>
                {copyFB ? "✓ Copied" : "📋 Copy for LinkedIn"}
              </button>
              <button onClick={handleExport}
                style={{ background: T.card, border: "1px solid " + T.borderLight, borderRadius: 9, padding: "14px 16px", color: T.muted, fontSize: 12, fontWeight: 500 }}
                onMouseEnter={e => { e.target.style.borderColor = T.accent; e.target.style.color = T.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = T.borderLight; e.target.style.color = T.muted; }}>
                📄 Export Report
              </button>
              <a href="https://helloadeo.com" target="_blank" rel="noopener noreferrer"
                style={{ background: `linear-gradient(135deg, ${T.accent}, #b06830)`, borderRadius: 9, padding: "14px 16px", color: "#fff", fontSize: 12, fontWeight: 600, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
                Fix Your Brand →
              </a>
            </div>

            <div style={{ marginTop: 32, padding: "22px 24px", background: T.cardAlt, borderRadius: 10, border: "1px solid #161616", textAlign: "center" }}>
              <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.65, margin: 0, maxWidth: 540, marginLeft: "auto", marginRight: "auto" }}>
                This tool catches the surface-level sameness. The deeper problem — why institutions default to generic language and how to build a brand that actually differentiates — requires a strategic partner who understands higher ed from the inside.
              </p>
              <p style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, marginTop: 10, marginBottom: 0 }}>That's what adeo does.</p>
            </div>
          </section>
        )}

        <footer style={{ paddingTop: 32, paddingBottom: 24, borderTop: "1px solid #151515", marginTop: result ? 0 : 80, display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, color: T.faint, fontFamily: T.mono }}>© 2026 adeo — strategic communications</span>
          <span style={{ fontSize: 10, color: T.faint, fontFamily: T.mono }}>helloadeo.com</span>
        </footer>
      </div>

      {/* EMAIL MODAL */}
      {emailModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setEmailModal(false)}>
          <div style={{ background: "#151515", border: "1px solid " + T.borderLight, borderRadius: 16, padding: "36px 32px", maxWidth: 420, width: "100%", textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 48, height: 48, background: `linear-gradient(135deg, ${T.accent}, ${T.accentLight})`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 20, fontWeight: 700, color: T.bg, fontFamily: T.mono }}>a</div>
            <h3 style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 400, margin: "0 0 8px" }}>Get Your <span style={{ fontStyle: "italic", color: T.accent }}>Full Report</span></h3>
            <p style={{ fontSize: 13, color: T.muted, margin: "0 0 24px", lineHeight: 1.6 }}>Enter your email and we'll generate a branded PDF audit you can share with your team.</p>
            {emailSent ? (
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                <p style={{ color: "#22c55e", fontSize: 14 }}>Generating your report...</p>
              </div>
            ) : (
              <>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@institution.edu" type="email"
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

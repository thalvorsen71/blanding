import { scoreColor, scoreLabel, scoreVerdict } from './constants';

export function exportPDF(res) {
  const dims = [
    { key: "language", label: "Language & Voice" },
    { key: "strategy", label: "Content Strategy" },
  ].filter(d => res.scores[d.key] != null);

  const dimRows = dims.map(d =>
    `<div style="display:inline-block;width:${100/dims.length}%;text-align:center;padding:16px 8px">
      <div style="font-size:36px;font-weight:300;color:${scoreColor(res.scores[d.key])}">${res.scores[d.key]}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-top:4px">${d.label}</div>
    </div>`
  ).join("");

  const pills = res.cliches.slice(0, 20).map(c =>
    `<span style="display:inline-block;background:#c8784015;border:1px solid #c8784040;border-radius:4px;padding:3px 10px;margin:3px;font-size:12px;color:#c87840;font-family:monospace">${c.phrase}${c.count > 1 ? ` ×${c.count}` : ""}</span>`
  ).join("");

  const rx = [
    res.ai?.rx_language && { l: "Language & Voice", t: res.ai.rx_language },
    res.ai?.rx_strategy && { l: "Content Strategy", t: res.ai.rx_strategy },
  ].filter(Boolean).map(r =>
    `<div style="margin-bottom:14px;padding:12px 16px;background:#f8f6f3;border-radius:6px;border-left:3px solid #c87840">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#c87840;margin-bottom:6px;font-family:monospace">${r.l}</div>
      <div style="font-size:13px;color:#333;line-height:1.6">${r.t}</div>
    </div>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Blanding Report — ${res.schoolName}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=DM+Mono&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>body{font-family:"DM Sans",sans-serif;color:#1a1a1a;max-width:720px;margin:0 auto;padding:40px 32px}@media print{body{padding:20px}@page{margin:0.6in;size:letter}}</style>
</head><body>
<div style="display:flex;align-items:center;gap:10px;margin-bottom:32px">
  <div style="width:28px;height:28px;background:linear-gradient(135deg,#c87840,#e8a060);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;font-family:monospace">a</div>
  <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888">adeo brand audit</span>
  <span style="margin-left:auto;font-size:11px;color:#bbb;font-family:monospace">${new Date().toLocaleDateString()}</span>
</div>
<h1 style="font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:36px;margin:0 0 4px">Blanding Detector<span style="color:#c87840;font-style:italic"> Report</span></h1>
<p style="color:#888;font-size:14px;margin:0 0 32px">${res.url || "Text analysis"} — ${res.pagesAnalyzed.length} page${res.pagesAnalyzed.length > 1 ? "s" : ""} audited</p>
<div style="text-align:center;padding:32px;background:#faf9f7;border-radius:12px;margin-bottom:28px">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:12px;font-family:monospace">Overall Differentiation Score</div>
  <div style="font-size:72px;font-family:'Instrument Serif',Georgia,serif;color:${scoreColor(res.overall)};line-height:1">${res.overall}<span style="font-size:24px;color:#ccc">/100</span></div>
  <div style="font-size:20px;font-family:'Instrument Serif',Georgia,serif;font-style:italic;color:${scoreColor(res.overall)};margin:8px 0">${scoreLabel(res.overall)}</div>
  <p style="font-size:14px;color:#666;max-width:480px;margin:12px auto 0;line-height:1.6">${scoreVerdict(res.overall)}</p>
</div>
<div style="text-align:center;background:#fff;border:1px solid #eee;border-radius:10px;padding:8px 0;margin-bottom:28px">${dimRows}</div>
${res.ai?.tone_diagnosis ? `<div style="padding:20px 24px;background:#faf9f7;border-radius:10px;margin-bottom:24px;border-left:3px solid #c87840"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:8px;font-family:monospace">Brand Personality</div><p style="font-size:16px;font-family:'Instrument Serif',Georgia,serif;font-style:italic;color:#333;line-height:1.6;margin:0">${res.ai.tone_diagnosis}</p></div>` : ""}
${res.ai ? `<div style="display:flex;gap:12px;margin-bottom:24px">
  <div style="flex:1;padding:16px;background:#fef2f2;border-radius:8px"><div style="font-size:10px;text-transform:uppercase;color:#ef4444;margin-bottom:6px;font-family:monospace">Biggest Sin</div><div style="font-size:13px;line-height:1.5;color:#333">${res.ai.biggest_sin}</div></div>
  <div style="flex:1;padding:16px;background:#f0fdf4;border-radius:8px"><div style="font-size:10px;text-transform:uppercase;color:#22c55e;margin-bottom:6px;font-family:monospace">Best Moment</div><div style="font-size:13px;line-height:1.5;color:#333">${res.ai.best_moment}</div></div>
</div>` : ""}
${pills ? `<div style="margin-bottom:24px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:10px;font-family:monospace">Clichés Detected (${res.totalCliches} total)</div>${pills}</div>` : ""}
${rx ? `<div style="margin-bottom:28px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#c87840;margin-bottom:14px;font-family:monospace">Prescriptions</div>${rx}</div>` : ""}
${res.ai?.weak_sentence ? `<div style="margin-bottom:28px;border:1px solid #eee;border-radius:10px;overflow:hidden">
  <div style="padding:10px 16px;background:#faf9f7;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#c87840;font-family:monospace">Before & After</div>
  <div style="display:flex"><div style="flex:1;padding:16px;border-right:1px solid #eee"><div style="font-size:9px;text-transform:uppercase;color:#ef4444;margin-bottom:6px;font-family:monospace">Generic</div><p style="font-size:13px;color:#888;font-style:italic;margin:0;line-height:1.5">"${res.ai.weak_sentence}"</p></div><div style="flex:1;padding:16px"><div style="font-size:9px;text-transform:uppercase;color:#22c55e;margin-bottom:6px;font-family:monospace">With a Pulse</div><p style="font-size:13px;color:#333;margin:0;line-height:1.5">"${res.ai.rewrite}"</p></div></div>
</div>` : ""}
<div style="text-align:center;padding:24px;background:#1a1a1a;color:#fff;border-radius:10px;margin-top:32px">
  <p style="margin:0 0 8px;font-size:14px;color:#999">This audit catches surface-level sameness. Fixing the deeper problem requires strategic partnership.</p>
  <p style="margin:0;font-size:15px;font-weight:600;color:#c87840">adeo — helloadeo.com</p>
</div></body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const w = window.open(URL.createObjectURL(blob), "_blank");
  setTimeout(() => { try { w?.print(); } catch(e) {} }, 1200);
}

/* ═══ CLICHÉ DATABASE ═══ */
export const CLICHES = [
  "world-class","cutting-edge","state-of-the-art","best and brightest","leaders of tomorrow",
  "transforming lives","global citizens","rigorous academics","vibrant community","diverse perspectives",
  "holistic approach","innovative research","excellence in","committed to excellence","rich tradition",
  "prepare students","real-world experience","hands-on learning","collaborative environment",
  "interdisciplinary","thought leaders","student-centered","lifelong learners","changing the world",
  "make a difference","boundless opportunities","nurturing environment","unlock potential",
  "empower students","foster growth","dynamic community","premier institution","renowned faculty",
  "distinguished","leading-edge","next generation","shaping the future","tradition of excellence",
  "intellectual curiosity","critical thinking","global perspective","well-rounded",
  "close-knit community","personalized attention","supportive environment","academic excellence",
  "innovative programs","transformative experience","engaged learning","meaningful connections",
  "dedicated faculty","passion for learning","bright futures","endless possibilities",
  "discover your","find your voice","find your passion","pursue your passion","dream big",
  "reach your potential","where leaders are made","where futures begin","preparing leaders",
  "committed to diversity","inclusive community","welcoming community","comprehensive university",
  "nationally recognized","top-ranked","prestigious","esteemed","state-of-the-art facilities",
  "beautiful campus","nestled in","at the forefront","pushing boundaries","breaking new ground",
  "reimagining","revolutionizing","inspiring","inspired by","rooted in","grounded in",
  "preparing the next generation","tomorrow's leaders","world of possibilities","make an impact",
  "tradition of innovation","culture of excellence","legacy of","spirit of","commitment to",
  "aspire to","strive for","journey of discovery","path to success","bridge to"
];

export const NAV_CLICHES = [
  "about us","academics","admissions","campus life","student life","why us","visit",
  "apply now","request info","schedule a visit","explore","discover","experience",
  "at a glance","fast facts","our story","mission and vision","our mission","give","alumni"
];

/* ═══ STYLE TOKENS ═══ */
export const T = {
  mono: "'DM Mono', monospace",
  sans: "'DM Sans', sans-serif",
  serif: "'Instrument Serif', Georgia, serif",
  accent: "#c87840",
  accentLight: "#e8a060",
  bg: "#0a0a0a",
  card: "#111",
  cardAlt: "#0d0d0d",
  border: "#1a1a1a",
  borderLight: "#222",
  text: "#e8e4df",
  muted: "#888",
  dim: "#555",
  faint: "#333",
};

/* ═══ SCORING ═══ */
export const scoreColor = s =>
  s >= 70 ? "#22c55e" : s >= 50 ? "#84cc16" : s >= 35 ? "#eab308" : s >= 18 ? "#f97316" : "#ef4444";

export const scoreLabel = s =>
  s >= 75 ? "Standing Out" : s >= 55 ? "Getting There" : s >= 35 ? "Blending In" : s >= 18 ? "Wallpaper" : "Invisible";

export const scoreVerdict = s => {
  if (s >= 75) return "Your brand has real texture. Prospective students can feel the difference.";
  if (s >= 55) return "Sparks of personality buried under institutional safety. The bones are good — the voice needs conviction.";
  if (s >= 35) return "You sound like a college. That's the problem. Swap your name with any peer and nobody notices.";
  if (s >= 18) return "Institutional wallpaper. Every page reads like it was approved by a committee afraid of saying anything.";
  return "The higher ed greatest hits album. Your web presence could belong to any institution in the country.";
};

/* ═══ TEXT ANALYSIS ═══ */
export function countCliches(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const phrase of CLICHES) {
    const regex = new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = lower.match(regex);
    if (matches) found.push({ phrase, count: matches.length });
  }
  return found.sort((a, b) => b.count - a.count);
}

export function highlightCliches(text) {
  if (!text) return [];
  let segments = [{ text, hl: false }];
  for (const phrase of CLICHES) {
    const regex = new RegExp("(\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    const next = [];
    for (const seg of segments) {
      if (seg.hl) { next.push(seg); continue; }
      const parts = seg.text.split(regex);
      for (const part of parts) {
        if (!part) continue;
        regex.lastIndex = 0;
        next.push({ text: part, hl: regex.test(part) });
        regex.lastIndex = 0;
      }
    }
    segments = next;
  }
  return segments;
}

export function calcNavScore(items) {
  const lower = items.map(n => n.toLowerCase().trim());
  let generic = 0;
  lower.forEach(item => {
    if (NAV_CLICHES.some(c => item.includes(c) || c.includes(item))) generic++;
  });
  return { total: items.length, generic, score: items.length ? Math.round((1 - generic / items.length) * 100) : 50 };
}

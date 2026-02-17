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
  dim: "#777",
  faint: "#555",
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

/* Benchmarks and percentile are now calculated from live leaderboard data only —
   no hardcoded estimates. See leaderboard state in App.jsx. */

/**
 * Measures how specific/distinctive the content is — rewarding what makes
 * a site interesting rather than just penalizing what makes it generic.
 *
 * Returns a score 0-30 representing content richness bonus points.
 */
export function contentRichnessBonus(bodyText, h1s = [], h2s = [], uniqueClaims = []) {
  if (!bodyText || bodyText.length < 100) return 0;
  const text = bodyText.toLowerCase();
  let bonus = 0;

  // 1. Specific numbers and data points (enrollment, rankings, funding, dates)
  //    e.g. "14,000 students", "#19 most innovative", "$2.3 billion"
  const numberMatches = text.match(/\b\d[\d,.]*([\s-]*(million|billion|percent|%|students|faculty|acres|years|programs|degrees|alumni|countries))\b/gi) || [];
  bonus += Math.min(numberMatches.length * 2, 8);

  // 2. Named entities: proper nouns that signal specific people, places, programs, events
  //    Count capitalized multi-word phrases in the original (non-lowered) text
  const properNouns = bodyText.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || [];
  // Filter out common generic phrases
  const genericProperNouns = /^(The University|Our Students|Student Life|Campus Life|Academic Programs|Learn More|Read More|Find Out|Get Started|Apply Now)/;
  const specificProperNouns = properNouns.filter(p => !genericProperNouns.test(p));
  bonus += Math.min(specificProperNouns.length * 0.5, 6);

  // 3. Temporal specificity: dates, event names, "2025", "2026", specific semesters
  const dateMatches = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|spring|fall|winter|summer)\s+\d{4}\b/gi) || [];
  const yearMatches = text.match(/\b20[2-3]\d\b/g) || [];
  bonus += Math.min((dateMatches.length + yearMatches.length * 0.3) * 1.5, 5);

  // 4. Quotation marks suggest real quotes from real people
  const quoteMatches = bodyText.match(/[""][^""]{20,}[""\u201D]/g) || [];
  bonus += Math.min(quoteMatches.length * 2, 4);

  // 5. Unique claims credit (already extracted by scraper)
  bonus += Math.min(uniqueClaims.length * 1.5, 6);

  // 6. H2 diversity — lots of different section headings suggest rich content
  const nonGenericH2s = h2s.filter(h => {
    const low = h.toLowerCase();
    return !/(about|academics|admissions|campus|student|life|why|visit|apply|explore|discover|experience|welcome|learn more|get started)/.test(low);
  });
  bonus += Math.min(nonGenericH2s.length * 1, 5);

  return Math.min(Math.round(bonus), 30);
}

export function calcNavScore(items) {
  const lower = items.map(n => n.toLowerCase().trim());
  let generic = 0;
  lower.forEach(item => {
    if (NAV_CLICHES.some(c => item.includes(c) || c.includes(item))) generic++;
  });
  return { total: items.length, generic, score: items.length ? Math.round((1 - generic / items.length) * 100) : 50 };
}

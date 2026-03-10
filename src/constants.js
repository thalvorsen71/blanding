/* ═══ CLICHÉ DATABASE ═══ */
export const CLICHES = [
  // --- Classic higher ed emptiness ---
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
  "aspire to","strive for","journey of discovery","path to success","bridge to",

  // --- Mission statement bingo ---
  "reach for your goals","achieve your goals","achieve your dreams","reach your goals",
  "supportive education","practical skills","career-ready","career-focused","market-driven",
  "job-ready","in-demand careers","high-demand fields","flexible learning","flexible programs",
  "affordable education","accessible education","quality education","higher education",
  "academic programs","degree programs","online programs","innovative solutions",
  "student success","success story","start your success","your success","success stories",

  // --- Conversion funnel filler ---
  "take the next step","get started today","start your journey","begin your journey",
  "your journey starts","learn more about","explore programs","explore our","discover more",
  "find out more","request information","calculate your cost","plan your visit",
  "apply today","apply now","start today","enroll today","enroll now",
  "the education you need","education and support","support you need",

  // --- Vague purpose statements ---
  "developing leaders","develop leaders","change makers","making a difference",
  "making an impact","positive impact","impact the world","impact on the world",
  "shape the future","build the future","building futures","building a better",
  "better world","better tomorrow","brighter future","brighter tomorrow",
  "innovation in higher education","innovation in education","years of innovation",
  "years of excellence","history of excellence","history of innovation",

  // --- Community platitudes ---
  "sense of community","sense of belonging","community of scholars","community of learners",
  "learning community","campus community","global community","international community",
  "diverse community","tight-knit","tight knit","small class","small classes",
  "faculty who care","professors who","mentoring relationships","mentor relationships",

  // --- Promise without proof ---
  "transformative","transform your","empowering","empowerment","world of opportunity",
  "opportunities for","limitless possibilities","unlimited potential","full potential",
  "fullest potential","highest potential","unique potential","realize your potential",
  "shape your future","your future starts","future-ready","future ready",
  "prepare you for","prepared to lead","equip you with","the skills you need",
  "skills and knowledge","tools and resources","knowledge and skills",

  // --- Filler adjectives ---
  "exceptional","outstanding","unparalleled","unmatched","unrivaled",
  "extraordinary","remarkable","groundbreaking","pioneering","trailblazing",
  "forward-thinking","progressive","leading","premier","preeminent",

  // --- Stock identity claims ---
  "who we are","our values","our commitment","our promise","our vision",
  "our mission","mission-driven","values-driven","purpose-driven","faith-based",
  "faith-forward","christ-centered","biblically-based",
  "the only university","only institution of its kind","unlike any other",
  "like no other","one of a kind","truly unique","uniquely positioned",

  // --- Outcome vagueness ---
  "career outcomes","career services","career development","career advancement",
  "professional development","professional growth","personal growth","personal development",
  "leadership development","leadership skills","leadership opportunities",
  "research opportunities","experiential learning","service learning",
  "study abroad","global experiences","global opportunities","cultural experiences",

  // --- Campus life generics ---
  "campus life","student life","student experience","college experience",
  "residential experience","living and learning","learning environment",
  "state-of-the-art facilities","modern facilities","world-class facilities",
  "cutting-edge technology","latest technology","advanced technology",
  "dining options","dining experience","recreational facilities",

  // --- Application pressure ---
  "don't wait","limited spots","spaces are limited","seats are limited",
  "rolling admissions","no application fee","free to apply","waived application fee",
  "generous scholarships","merit-based","need-based","financial aid available",

  // --- Diversity checkbox language ---
  "we celebrate","we value","we embrace","we welcome","we believe in",
  "all backgrounds","all walks of life","from all over the world",
  "nations represented","countries represented","states represented",
  "diverse student body","multicultural","inclusive excellence"
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
  text: "#ede9e4",
  muted: "#aaa",
  dim: "#999",
  faint: "#777",
};

/* ═══ SCORING ═══ */
export const scoreColor = s =>
  s >= 75 ? "#22c55e" : s >= 55 ? "#84cc16" : s >= 40 ? "#eab308" : s >= 22 ? "#f97316" : "#ef4444";

export const scoreLabel = s =>
  s >= 80 ? "Standing Out" : s >= 65 ? "Getting There" : s >= 45 ? "Blending In" : s >= 25 ? "Wallpaper" : "Invisible";

export const scoreVerdict = s => {
  if (s >= 80) return "Your brand has real texture. Prospective students can feel the difference.";
  if (s >= 65) return "Sparks of personality buried under institutional safety. The bones are good — the voice needs conviction.";
  if (s >= 45) return "You sound like a college. That's the problem. Swap your name with any peer and nobody notices.";
  if (s >= 25) return "Institutional wallpaper. Every page reads like it was approved by a committee afraid of saying anything.";
  return "The higher ed greatest hits album. Your web presence could belong to any institution in the country.";
};

/* ═══ CLICHÉ SEVERITY TIERS ═══ */
// Some clichés are worse than others. "World-class" and "transformative" in your
// H1 is a brand crime. "Apply now" in a CTA is just functional.
export const CLICHE_SEVERITY = {
  // Tier 1: The worst offenders — identity-killing platitudes (weight 1.5x)
  severe: new Set([
    "world-class", "transformative", "transformative experience", "cutting-edge",
    "state-of-the-art", "best and brightest", "leaders of tomorrow", "holistic approach",
    "committed to excellence", "excellence in", "tradition of excellence",
    "culture of excellence", "history of excellence", "premier institution",
    "prestigious", "esteemed", "preeminent", "unparalleled", "unmatched", "unrivaled",
    "like no other", "unlike any other", "truly unique", "uniquely positioned",
    "one of a kind", "groundbreaking", "pioneering", "trailblazing", "revolutionizing",
    "reimagining", "pushing boundaries", "breaking new ground", "at the forefront",
    "shaping the future", "changing the world", "transforming lives",
  ]),
  // Tier 2: Generic but less toxic — common filler (weight 1x, baseline)
  // Everything not in severe or mild falls here by default
  // Tier 3: Functional/expected — CTAs, nav items, mild phrases (weight 0.5x)
  mild: new Set([
    "apply now", "apply today", "enroll today", "enroll now", "learn more about",
    "explore programs", "explore our", "discover more", "find out more",
    "request information", "plan your visit", "get started today", "start today",
    "take the next step", "calculate your cost", "don't wait", "free to apply",
    "no application fee", "waived application fee", "rolling admissions",
    "about us", "campus life", "student life",
  ]),
};

/**
 * Returns severity weight for a cliché phrase.
 * severe = 1.5, normal = 1.0, mild = 0.5
 */
export function clicheSeverity(phrase) {
  const lower = phrase.toLowerCase();
  if (CLICHE_SEVERITY.severe.has(lower)) return 1.5;
  if (CLICHE_SEVERITY.mild.has(lower)) return 0.5;
  return 1.0;
}

/* ═══ STANDALONE SAFETY-NET WORDS ═══ */
// These common cliché words appear in many phrases we don't explicitly list.
// The safety net catches standalone uses that slip past phrase matching,
// without double-counting uses already captured by a longer phrase.
const SAFETY_NET_WORDS = [
  "rigorous", "excellence", "community",
  "innovative", "diverse", "leadership",
  "empower", "impact", "inclusive",
];

/* ═══ TEXT ANALYSIS ═══ */
export function countCliches(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const phrase of CLICHES) {
    const regex = new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = lower.match(regex);
    if (matches) found.push({ phrase, count: matches.length, severity: clicheSeverity(phrase) });
  }

  // Safety-net pass: count standalone word occurrences minus already-matched phrase hits
  for (const word of SAFETY_NET_WORDS) {
    const wordRegex = new RegExp("\\b" + word + "\\b", "gi");
    const totalMatches = lower.match(wordRegex);
    if (!totalMatches) continue;
    const totalCount = totalMatches.length;

    // Sum how many times this word was already captured by phrase matches
    let alreadyCaptured = 0;
    for (const f of found) {
      if (f.phrase.toLowerCase().includes(word)) {
        alreadyCaptured += f.count;
      }
    }

    const uncaptured = totalCount - alreadyCaptured;
    if (uncaptured > 0) {
      found.push({ phrase: word, count: uncaptured, severity: clicheSeverity(word) });
    }
  }

  return found.sort((a, b) => (b.count * b.severity) - (a.count * a.severity));
}

/**
 * Weighted cliché counting: clichés in H1s/H2s/meta count more than body copy.
 * Returns { weightedTotal, h1Cliches, h2Cliches, bodyCliches }
 */
export function countWeightedCliches(bodyText, h1s = [], h2s = [], metaDesc = "") {
  const h1Text = h1s.join(" ");
  const h2Text = h2s.join(" ");

  // Count clichés in each zone separately
  const h1Cliches = countCliches(h1Text);
  const h2Cliches = countCliches(h2Text);
  const metaCliches = countCliches(metaDesc);
  const bodyCliches = countCliches(bodyText);

  // Weighted total: H1=3x, H2=2x, meta=2x, body=1x
  // Each cliché also has its own severity multiplier (1.5x, 1x, or 0.5x)
  let weightedTotal = 0;
  h1Cliches.forEach(c => { weightedTotal += c.count * c.severity * 3; });
  h2Cliches.forEach(c => { weightedTotal += c.count * c.severity * 2; });
  metaCliches.forEach(c => { weightedTotal += c.count * c.severity * 2; });
  bodyCliches.forEach(c => { weightedTotal += c.count * c.severity * 1; });

  return {
    weightedTotal: Math.round(weightedTotal * 10) / 10,
    h1Cliches,
    h2Cliches,
    metaCliches,
    bodyCliches,
    h1Count: h1Cliches.reduce((s, c) => s + c.count, 0),
    h2Count: h2Cliches.reduce((s, c) => s + c.count, 0),
  };
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

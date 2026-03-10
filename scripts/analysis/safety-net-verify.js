const https = require("https");
const http = require("http");
const cheerio = require("/sessions/admiring-upbeat-sagan/mnt/blanding/node_modules/cheerio");
const fs = require("fs");

const data = JSON.parse(fs.readFileSync("/tmp/lb.json", "utf8"));
const schools = data.schools.slice(0, 30);

// Replicate the updated countCliches logic locally
const constantsSrc = fs.readFileSync("/sessions/admiring-upbeat-sagan/mnt/blanding/src/constants.js", "utf8");

// Extract CLICHES array - parse between the brackets
const clicheMatch = constantsSrc.match(/export const CLICHES = \[([\s\S]*?)\];/);
const clicheStr = clicheMatch[1];
const CLICHES = [];
const phraseRegex = /"([^"]+)"/g;
let m;
while ((m = phraseRegex.exec(clicheStr)) !== null) {
  CLICHES.push(m[1]);
}

// Extract severity sets
const severeMatch = constantsSrc.match(/severe: new Set\(\[([\s\S]*?)\]\)/);
const mildMatch = constantsSrc.match(/mild: new Set\(\[([\s\S]*?)\]\)/);
const severe = new Set();
const mild = new Set();
let sm;
const sr = /"([^"]+)"/g;
while ((sm = sr.exec(severeMatch[1])) !== null) severe.add(sm[1]);
const mr = /"([^"]+)"/g;
while ((sm = mr.exec(mildMatch[1])) !== null) mild.add(sm[1]);

function clicheSeverity(phrase) {
  const lower = phrase.toLowerCase();
  if (severe.has(lower)) return 1.5;
  if (mild.has(lower)) return 0.5;
  return 1.0;
}

const SAFETY_NET_WORDS = ["rigorous", "excellence", "community"];

function countCliches(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const phrase of CLICHES) {
    const regex = new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = lower.match(regex);
    if (matches) found.push({ phrase, count: matches.length, severity: clicheSeverity(phrase) });
  }

  for (const word of SAFETY_NET_WORDS) {
    const wordRegex = new RegExp("\\b" + word + "\\b", "gi");
    const totalMatches = lower.match(wordRegex);
    if (!totalMatches) continue;
    const totalCount = totalMatches.length;

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

function fetch(url, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 3) return resolve("");
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BlandingAudit/1.0)" }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith("/")) {
          const u = new URL(url);
          loc = u.protocol + "//" + u.host + loc;
        }
        return resolve(fetch(loc, redirects + 1));
      }
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => resolve(body));
      res.on("error", () => resolve(""));
    });
    req.on("error", () => resolve(""));
    req.on("timeout", () => { req.destroy(); resolve(""); });
  });
}

function extractText(html) {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  return $("body").text().replace(/\s+/g, " ");
}

async function run() {
  const results = [];

  for (let i = 0; i < schools.length; i++) {
    const s = schools[i];
    const url = "https://www." + s.url;
    const name = s.name.split("|")[0].trim();
    process.stderr.write((i+1) + "/" + schools.length + " " + s.url + "...\n");

    try {
      const html = await fetch(url);
      const text = extractText(html);
      const cliches = countCliches(text);

      // Extract just our three target words
      const targetHits = {};
      for (const word of SAFETY_NET_WORDS) {
        const hits = cliches.filter(c => c.phrase.toLowerCase().includes(word) || c.phrase.toLowerCase() === word);
        targetHits[word] = { phraseHits: [], safetyNet: null };
        for (const h of hits) {
          if (h.phrase === word) {
            targetHits[word].safetyNet = h.count;
          } else {
            targetHits[word].phraseHits.push({ phrase: h.phrase, count: h.count });
          }
        }
      }

      // Also count raw total for verification
      const rawCounts = {};
      const lower = text.toLowerCase();
      for (const word of SAFETY_NET_WORDS) {
        const regex = new RegExp("\\b" + word + "\\b", "gi");
        const matches = lower.match(regex);
        rawCounts[word] = matches ? matches.length : 0;
      }

      results.push({ name, url: s.url, targetHits, rawCounts, overall: s.overall });
    } catch(e) {
      results.push({ name, url: s.url, error: e.message, targetHits: {}, rawCounts: {}, overall: s.overall });
    }
  }

  // Summary
  console.log("\n=== SAFETY-NET VERIFICATION (30 schools) ===\n");

  for (const word of SAFETY_NET_WORDS) {
    let phraseSchools = 0, phraseUses = 0;
    let safetySchools = 0, safetyUses = 0;
    let rawTotal = 0, rawSchools = 0;

    for (const r of results) {
      if (!r.targetHits || !r.targetHits[word]) continue;
      const th = r.targetHits[word];
      const phraseCount = th.phraseHits.reduce((sum, h) => sum + h.count, 0);
      if (phraseCount > 0) { phraseSchools++; phraseUses += phraseCount; }
      if (th.safetyNet > 0) { safetySchools++; safetyUses += th.safetyNet; }
      if (r.rawCounts[word] > 0) { rawSchools++; rawTotal += r.rawCounts[word]; }
    }

    const totalDetected = phraseUses + safetyUses;
    console.log("=== " + word.toUpperCase() + " ===");
    console.log("  Raw occurrences:    " + rawTotal + " uses across " + rawSchools + " schools");
    console.log("  Phrase-matched:     " + phraseUses + " uses across " + phraseSchools + " schools");
    console.log("  Safety-net caught:  " + safetyUses + " uses across " + safetySchools + " schools");
    console.log("  Total detected:     " + totalDetected + " (should equal raw: " + rawTotal + ")");
    console.log("  Match: " + (totalDetected === rawTotal ? "PERFECT" : "MISMATCH (delta " + (rawTotal - totalDetected) + ")"));
    console.log("");
  }

  // Show detail for schools where safety net kicked in
  console.log("=== SAFETY-NET CATCHES (new detections) ===\n");
  for (const r of results) {
    if (!r.targetHits) continue;
    const catches = [];
    for (const word of SAFETY_NET_WORDS) {
      const th = r.targetHits[word];
      if (th && th.safetyNet > 0) {
        const phrases = th.phraseHits.map(h => h.phrase + "(" + h.count + ")").join(", ");
        catches.push(word + ": +" + th.safetyNet + " new" + (phrases ? " (already had: " + phrases + ")" : " (none matched by phrases)"));
      }
    }
    if (catches.length > 0) {
      console.log("  " + r.name.substring(0, 40));
      for (const c of catches) console.log("    " + c);
    }
  }
}

run().catch(console.error);

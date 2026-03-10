const https = require("https");
const http = require("http");
const cheerio = require("/sessions/admiring-upbeat-sagan/mnt/blanding/node_modules/cheerio");
const fs = require("fs");

const data = JSON.parse(fs.readFileSync("/tmp/lb.json", "utf8"));
const schools = data.schools;

const TARGETS = ["rigorous", "excellence", "community"];
const ALL_SAFETY = ["rigorous", "excellence", "community", "innovative", "diverse", "leadership", "empower", "impact", "inclusive"];

// Concurrency control
const CONCURRENCY = 10;
let active = 0;
let idx = 0;
const results = new Array(schools.length);
let completed = 0;

function fetch(url, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 3) return resolve("");
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      timeout: 12000,
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
  return $("body").text().replace(/\s+/g, " ").toLowerCase();
}

function processSchool(i) {
  const s = schools[i];
  const url = "https://www." + s.url;
  const name = s.name.split("|")[0].trim();

  return fetch(url).then(html => {
    const text = extractText(html);
    const counts = {};
    for (const word of ALL_SAFETY) {
      const regex = new RegExp("\\b" + word + "\\b", "gi");
      const matches = text.match(regex);
      counts[word] = matches ? matches.length : 0;
    }
    results[i] = { name, url: s.url, counts, overall: s.overall, ok: true };
  }).catch(() => {
    results[i] = { name, url: s.url, counts: {}, overall: s.overall, ok: false };
  }).finally(() => {
    completed++;
    if (completed % 25 === 0 || completed === schools.length) {
      process.stderr.write(completed + "/" + schools.length + " done\n");
    }
  });
}

async function run() {
  // Process in batches
  const queue = [];
  for (let i = 0; i < schools.length; i += CONCURRENCY) {
    const batch = [];
    for (let j = i; j < Math.min(i + CONCURRENCY, schools.length); j++) {
      batch.push(processSchool(j));
    }
    await Promise.all(batch);
  }

  const valid = results.filter(r => r && r.ok);
  const total = valid.length;

  // === ORIGINAL THREE (what Tracey's LinkedIn audience asked about) ===
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  FULL AUDIT: " + total + " schools scraped (Cheerio, $0 API cost)  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log("=== THE THREE LINKEDIN ASKED ABOUT ===\n");
  for (const word of TARGETS) {
    let uses = 0, schoolCount = 0;
    const schoolList = [];
    for (const r of valid) {
      const c = r.counts[word] || 0;
      if (c > 0) {
        schoolCount++;
        uses += c;
        schoolList.push({ name: r.name, count: c, overall: r.overall });
      }
    }
    schoolList.sort((a, b) => b.count - a.count);
    const pct = Math.round(schoolCount / total * 100);

    console.log("  " + word.toUpperCase());
    console.log("  Schools: " + schoolCount + "/" + total + " (" + pct + "%)");
    console.log("  Total uses: " + uses);
    if (schoolCount > 0) console.log("  Avg when present: " + (uses / schoolCount).toFixed(1));
    console.log("  Top 5:");
    schoolList.slice(0, 5).forEach(s => {
      console.log("    " + s.name.substring(0, 45) + " — " + s.count + "x (score " + s.overall + ")");
    });
    console.log("");
  }

  // === ALL NINE SAFETY-NET WORDS ===
  console.log("=== ALL 9 SAFETY-NET WORDS ===\n");
  const summary = [];
  for (const word of ALL_SAFETY) {
    let uses = 0, schoolCount = 0;
    for (const r of valid) {
      const c = r.counts[word] || 0;
      if (c > 0) { schoolCount++; uses += c; }
    }
    summary.push({ word, schoolCount, uses, pct: Math.round(schoolCount / total * 100) });
  }
  summary.sort((a, b) => b.schoolCount - a.schoolCount);

  console.log("  WORD".padEnd(16) + "SCHOOLS".padEnd(18) + "TOTAL USES".padEnd(14) + "AVG WHEN PRESENT");
  console.log("  " + "-".repeat(60));
  for (const s of summary) {
    const avg = s.schoolCount > 0 ? (s.uses / s.schoolCount).toFixed(1) : "0";
    console.log(
      "  " + s.word.padEnd(14) +
      (s.schoolCount + "/" + total + " (" + s.pct + "%)").padEnd(18) +
      String(s.uses).padEnd(14) +
      avg
    );
  }

  // Failed scrapes
  const failed = results.filter(r => r && !r.ok);
  if (failed.length > 0) {
    console.log("\n  Failed to scrape: " + failed.length + " schools");
    failed.forEach(f => console.log("    " + f.url));
  }
}

run().catch(console.error);

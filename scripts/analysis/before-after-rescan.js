const https = require("https");
const http = require("http");
const cheerio = require("/sessions/admiring-upbeat-sagan/mnt/blanding/node_modules/cheerio");
const fs = require("fs");

const data = JSON.parse(fs.readFileSync("/tmp/lb.json", "utf8"));
const schools = data.schools.slice(0, 30);

// Load the updated cliché list by parsing constants.js
// We'll just do raw word search for the three target words + full cliché scan
const targets = ["rigorous", "excellence", "community"];

function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
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
  return $("body").text().replace(/\s+/g, " ").toLowerCase();
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

      const counts = {};
      for (const term of targets) {
        const regex = new RegExp("\\b" + term + "\\b", "gi");
        const matches = text.match(regex);
        counts[term] = matches ? matches.length : 0;
      }

      results.push({ name, url: s.url, counts, overall: s.overall });
    } catch(e) {
      results.push({ name, url: s.url, error: e.message, counts: {}, overall: s.overall });
    }
  }

  // Before data (from leaderboard topCliches)
  console.log("\n=== BEFORE vs AFTER: Detection rates for 30 schools ===\n");
  console.log("TERM".padEnd(14) + "| BEFORE (phrase-matched)       | AFTER (standalone word)");
  console.log("-".repeat(75));

  for (const term of targets) {
    // Before: count from stored topCliches
    let beforeSchools = 0, beforeUses = 0;
    for (const s of schools) {
      if (s.topCliches) {
        let uses = 0;
        for (const tc of s.topCliches) {
          if (new RegExp(term, "i").test(tc.phrase)) uses += tc.count;
        }
        if (uses > 0) { beforeSchools++; beforeUses += uses; }
      }
    }

    // After: raw word count from fresh scrape
    let afterSchools = 0, afterUses = 0;
    for (const r of results) {
      const c = r.counts[term] || 0;
      if (c > 0) { afterSchools++; afterUses += c; }
    }

    const beforePct = Math.round(beforeSchools / schools.length * 100);
    const afterPct = Math.round(afterSchools / results.length * 100);
    const schoolDelta = afterSchools - beforeSchools;
    const useDelta = afterUses - beforeUses;

    console.log(
      term.toUpperCase().padEnd(14) + "| " +
      (beforeSchools + " schools (" + beforePct + "%), " + beforeUses + " uses").padEnd(30) + "| " +
      afterSchools + " schools (" + afterPct + "%), " + afterUses + " uses" +
      " [+" + schoolDelta + " schools, +" + useDelta + " uses]"
    );
  }

  // Detail per school for community (the big mover)
  console.log("\n=== COMMUNITY detail (schools with uses) ===\n");
  const commResults = [];
  for (const r of results) {
    const c = r.counts["community"] || 0;
    if (c > 0) commResults.push({ name: r.name, count: c, overall: r.overall });
  }
  commResults.sort((a,b) => b.count - a.count);
  for (const r of commResults) {
    console.log("  " + r.name.substring(0,45).padEnd(47) + r.count + "x  (score " + r.overall + ")");
  }

  console.log("\n=== EXCELLENCE detail (schools with uses) ===\n");
  const excResults = [];
  for (const r of results) {
    const c = r.counts["excellence"] || 0;
    if (c > 0) excResults.push({ name: r.name, count: c, overall: r.overall });
  }
  excResults.sort((a,b) => b.count - a.count);
  for (const r of excResults) {
    console.log("  " + r.name.substring(0,45).padEnd(47) + r.count + "x  (score " + r.overall + ")");
  }

  console.log("\n=== RIGOROUS detail (schools with uses) ===\n");
  const rigResults = [];
  for (const r of results) {
    const c = r.counts["rigorous"] || 0;
    if (c > 0) rigResults.push({ name: r.name, count: c, overall: r.overall });
  }
  rigResults.sort((a,b) => b.count - a.count);
  for (const r of rigResults) {
    console.log("  " + r.name.substring(0,45).padEnd(47) + r.count + "x  (score " + r.overall + ")");
  }
}

run().catch(console.error);

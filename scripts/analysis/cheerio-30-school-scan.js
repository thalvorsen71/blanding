const https = require("https");
const http = require("http");
const cheerio = require("/sessions/admiring-upbeat-sagan/mnt/blanding/node_modules/cheerio");
const fs = require("fs");

const data = JSON.parse(fs.readFileSync("/tmp/lb.json", "utf8"));
// Pick 30 schools spread across score range
const schools = data.schools.slice(0, 30);

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
      const wordCount = text.split(/\s+/).length;

      const counts = {};
      for (const term of targets) {
        // Count as standalone word (not inside another word)
        const regex = new RegExp("\\b" + term + "\\b", "gi");
        const matches = text.match(regex);
        counts[term] = matches ? matches.length : 0;
      }

      // Also find the full phrases containing each word
      const contexts = {};
      for (const term of targets) {
        const regex = new RegExp("[\\w-]* ?" + term + " ?[\\w-]*", "gi");
        const found = text.match(regex);
        if (found) {
          const unique = [...new Set(found.map(f => f.trim()))];
          contexts[term] = unique.slice(0, 8);
        }
      }

      results.push({ name, url: s.url, wordCount, counts, contexts, overall: s.overall });
    } catch(e) {
      results.push({ name, url: s.url, error: e.message, counts: {}, contexts: {} });
    }
  }

  // Summary
  console.log("\n=== RAW WORD FREQUENCY (standalone word, not phrase-matched) ===\n");

  for (const term of targets) {
    let totalUses = 0;
    let schoolsUsing = 0;
    const schoolList = [];

    for (const r of results) {
      const c = r.counts[term] || 0;
      if (c > 0) {
        schoolsUsing++;
        totalUses += c;
        schoolList.push({ name: r.name, count: c, overall: r.overall });
      }
    }

    schoolList.sort((a, b) => b.count - a.count);

    console.log("=== " + term.toUpperCase() + " ===");
    console.log("Found in: " + schoolsUsing + "/" + results.length + " schools (" + Math.round(schoolsUsing/results.length*100) + "%)");
    console.log("Total raw occurrences: " + totalUses);
    if (schoolsUsing > 0) console.log("Avg when present: " + (totalUses / schoolsUsing).toFixed(1));
    console.log("Schools:");
    for (const s of schoolList) {
      console.log("  " + s.name + " (score " + s.overall + "): " + s.count + "x");
    }
    console.log("");
  }

  // Show context phrases to find what we're missing
  console.log("\n=== PHRASES IN CONTEXT (what schools actually say) ===\n");
  for (const term of targets) {
    const allContexts = {};
    for (const r of results) {
      if (r.contexts && r.contexts[term]) {
        for (const phrase of r.contexts[term]) {
          const clean = phrase.trim().toLowerCase();
          if (!allContexts[clean]) allContexts[clean] = 0;
          allContexts[clean]++;
        }
      }
    }
    const sorted = Object.entries(allContexts).sort((a,b) => b[1] - a[1]);
    console.log(term.toUpperCase() + " appears as:");
    for (const [phrase, count] of sorted.slice(0, 15)) {
      const inList = false; // we'll check manually
      console.log("  \"" + phrase + "\" (" + count + " schools)");
    }
    console.log("");
  }

  // Compare to stored topCliches
  console.log("\n=== COMPARISON: Raw word count vs. stored topCliches phrase count ===\n");
  console.log("School | Term | Raw Count | Phrase-Matched Count");
  console.log("-".repeat(70));
  for (const r of results) {
    const s = schools.find(x => x.url === r.url);
    for (const term of targets) {
      const raw = r.counts[term] || 0;
      let phrased = 0;
      if (s && s.topCliches) {
        for (const tc of s.topCliches) {
          if (new RegExp(term, "i").test(tc.phrase)) phrased += tc.count;
        }
      }
      if (raw > 0 || phrased > 0) {
        const gap = raw - phrased;
        console.log(r.name.substring(0,30).padEnd(32) + "| " + term.padEnd(12) + "| " + String(raw).padEnd(10) + "| " + phrased + (gap > 0 ? " (MISSING " + gap + ")" : ""));
      }
    }
  }
}

run().catch(console.error);

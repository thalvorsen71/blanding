const data = JSON.parse(require("fs").readFileSync("/tmp/lb.json","utf8"));
const schools = data.schools;

const targets = {
  "rigorous": /rigorous/i,
  "excellence": /excellence/i,
  "community": /community/i
};

for (const [term, regex] of Object.entries(targets)) {
  let totalUses = 0;
  let schoolCount = 0;
  let schoolNames = [];

  for (const s of schools) {
    const tc = s.topCliches;
    if (tc == null || !Array.isArray(tc)) continue;
    let uses = 0;
    for (const c of tc) {
      if (regex.test(c.phrase)) {
        uses += c.count;
      }
    }
    if (uses > 0) {
      schoolCount++;
      totalUses += uses;
      schoolNames.push({ name: s.name.split("|")[0].trim(), uses });
    }
  }

  schoolNames.sort((a,b) => b.uses - a.uses);
  const pct = ((schoolCount / schools.length) * 100).toFixed(0);

  console.log("=== " + term.toUpperCase() + " ===");
  console.log("Schools using it: " + schoolCount + "/" + schools.length + " (" + pct + "%)");
  console.log("Total uses across all schools: " + totalUses);
  if (schoolCount > 0) console.log("Avg per school (when present): " + (totalUses / schoolCount).toFixed(1));
  console.log("Top 10:");
  schoolNames.slice(0,10).forEach((s,i) => console.log("  " + (i+1) + ". " + s.name + ": " + s.uses));
  console.log("");
}

// Also show which specific phrases matched
console.log("=== MATCHING PHRASES ===");
const phraseMap = {};
for (const s of schools) {
  const tc = s.topCliches;
  if (tc == null || !Array.isArray(tc)) continue;
  for (const c of tc) {
    for (const [term, regex] of Object.entries(targets)) {
      if (regex.test(c.phrase)) {
        const key = term + " -> " + c.phrase;
        if (!phraseMap[key]) phraseMap[key] = { count: 0, schools: 0 };
        phraseMap[key].count += c.count;
        phraseMap[key].schools++;
      }
    }
  }
}
const sorted = Object.entries(phraseMap).sort((a,b) => b[1].count - a[1].count);
for (const [phrase, stats] of sorted) {
  console.log(phrase + " | " + stats.schools + " schools | " + stats.count + " total uses");
}

import { connectLambda, getStore } from "@netlify/blobs";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// Seed data: real audit scores from Feb 2026 (liberal arts only — no estimates)
const SEED_DATA = {
  "bowdoin.edu": { name: "Bowdoin College", url: "bowdoin.edu", overall: 90, language: 93, strategy: 87, cliches: 3, pagesAudited: 4, lastAudited: "2026-02-15T00:00:00Z" },
  "williams.edu": { name: "Williams College", url: "williams.edu", overall: 88, language: 87, strategy: 89, cliches: 2, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "oberlin.edu": { name: "Oberlin College", url: "oberlin.edu", overall: 88, language: 93, strategy: 81, cliches: 2, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "trinity.edu": { name: "Trinity College", url: "trinity.edu", overall: 80, language: 86, strategy: 73, cliches: 4, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "reed.edu": { name: "Reed College", url: "reed.edu", overall: 80, language: 93, strategy: 65, cliches: 2, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "vassar.edu": { name: "Vassar College", url: "vassar.edu", overall: 79, language: 87, strategy: 70, cliches: 3, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "kenyon.edu": { name: "Kenyon College", url: "kenyon.edu", overall: 77, language: 95, strategy: 55, cliches: 1, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "muhlenberg.edu": { name: "Muhlenberg College", url: "muhlenberg.edu", overall: 76, language: 80, strategy: 71, cliches: 3, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "colby.edu": { name: "Colby College", url: "colby.edu", overall: 76, language: 80, strategy: 70, cliches: 3, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "gettysburg.edu": { name: "Gettysburg College", url: "gettysburg.edu", overall: 76, language: 96, strategy: 51, cliches: 1, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "hamilton.edu": { name: "Hamilton College", url: "hamilton.edu", overall: 76, language: 90, strategy: 59, cliches: 2, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "elon.edu": { name: "Elon University", url: "elon.edu", overall: 76, language: 97, strategy: 50, cliches: 1, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "wesleyan.edu": { name: "Wesleyan University", url: "wesleyan.edu", overall: 75, language: 86, strategy: 62, cliches: 3, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "bucknell.edu": { name: "Bucknell University", url: "bucknell.edu", overall: 74, language: 94, strategy: 50, cliches: 1, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "ithaca.edu": { name: "Ithaca College", url: "ithaca.edu", overall: 71, language: 80, strategy: 59, cliches: 4, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "goucher.edu": { name: "Goucher College", url: "goucher.edu", overall: 70, language: 73, strategy: 66, cliches: 5, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "stlawu.edu": { name: "St. Lawrence University", url: "stlawu.edu", overall: 70, language: 86, strategy: 51, cliches: 3, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "grinnell.edu": { name: "Grinnell College", url: "grinnell.edu", overall: 67, language: 84, strategy: 47, cliches: 3, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "macalester.edu": { name: "Macalester College", url: "macalester.edu", overall: 66, language: 85, strategy: 42, cliches: 3, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "skidmore.edu": { name: "Skidmore College", url: "skidmore.edu", overall: 64, language: 73, strategy: 54, cliches: 4, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "bates.edu": { name: "Bates College", url: "bates.edu", overall: 64, language: 77, strategy: 48, cliches: 4, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "lafayette.edu": { name: "Lafayette College", url: "lafayette.edu", overall: 60, language: 75, strategy: 41, cliches: 5, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "middlebury.edu": { name: "Middlebury College", url: "middlebury.edu", overall: 58, language: 77, strategy: 35, cliches: 5, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
  "dickinson.edu": { name: "Dickinson College", url: "dickinson.edu", overall: 56, language: 64, strategy: 46, cliches: 5, pagesAudited: 3, lastAudited: "2026-02-15T00:00:00Z" },
};

function initStore() {
  try {
    return getStore("leaderboard");
  } catch (e) {
    console.warn("Blobs store init failed:", e.message);
    return null;
  }
}

async function readData(store) {
  if (!store) return { data: null, err: "no store" };
  try {
    const d = await store.get("schools", { type: "json" });
    return { data: d, err: null };
  } catch (e) {
    return { data: null, err: e.message };
  }
}

async function writeData(store, data) {
  if (!store) return { ok: false, err: "no store" };
  try {
    await store.setJSON("schools", data);
    return { ok: true, err: null };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Must call connectLambda before getStore in legacy handler format
  try { connectLambda(event); } catch (e) { console.warn("connectLambda failed:", e.message); }

  const store = initStore();
  const storeAvailable = store !== null;

  // GET — return full leaderboard
  if (event.httpMethod === "GET") {
    const { data: rawData, err: readErr } = await readData(store);
    let data = rawData;
    let seeded = false;

    // If empty, use seed data (and try to persist if store is available)
    if (!data || Object.keys(data).length === 0) {
      data = SEED_DATA;
      seeded = true;
      if (store) await writeData(store, data);
    }

    const sorted = Object.values(data).sort((a, b) => b.overall - a.overall);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ schools: sorted, count: sorted.length, store: storeAvailable, readErr, seeded }),
    };
  }

  // POST — submit or update a score
  if (event.httpMethod === "POST") {
    try {
      const { name, url, overall, language, strategy, cliches, pagesAudited } = JSON.parse(event.body);

      if (!url || !name || overall == null) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
      }

      let hostname;
      try {
        hostname = new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
      } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid URL" }) };
      }

      if (!hostname.endsWith(".edu")) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "Only .edu domains" }) };
      }

      // Load current data from store or seed
      const { data: rawData, err: readErr } = await readData(store);
      let data = rawData || { ...SEED_DATA };

      // Upsert
      data[hostname] = {
        name: name.substring(0, 100),
        url: hostname,
        overall: Math.max(0, Math.min(100, Math.round(overall))),
        language: language != null ? Math.max(0, Math.min(100, Math.round(language))) : null,
        strategy: strategy != null ? Math.max(0, Math.min(100, Math.round(strategy))) : null,
        cliches: cliches != null ? Math.max(0, cliches) : null,
        pagesAudited: pagesAudited || 1,
        lastAudited: new Date().toISOString(),
      };

      // Persist
      const writeResult = await writeData(store, data);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, count: Object.keys(data).length, store: storeAvailable, readErr, writeErr: writeResult.err, wrote: writeResult.ok }),
      };
    } catch (err) {
      console.error("POST error:", err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to save score" }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
}

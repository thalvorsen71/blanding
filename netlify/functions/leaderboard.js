import { connectLambda, getStore } from "@netlify/blobs";

// Rate limit POST requests (prevent leaderboard spam)
const postLimits = {};
function checkPostRate(ip) {
  const now = Date.now();
  if (!postLimits[ip] || now > postLimits[ip].reset) {
    postLimits[ip] = { count: 1, reset: now + 300000 }; // 5 min window
    return true;
  }
  postLimits[ip].count++;
  return postLimits[ip].count <= 10; // 10 submissions per 5 min
}

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
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
    const raw = await store.get("schools");
    if (!raw) return { data: null, err: "empty" };
    const d = JSON.parse(raw);
    return { data: d, err: null };
  } catch (e) {
    return { data: null, err: e.message };
  }
}

async function writeData(store, data) {
  if (!store) return { ok: false, err: "no store" };
  try {
    await store.set("schools", JSON.stringify(data));
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

  // GET — return leaderboard
  // ?full=true returns everything including AI analysis (for reports)
  // Default returns slim data only (scores, names) to keep payload small
  if (event.httpMethod === "GET") {
    const { data } = await readData(store);
    const params = event.queryStringParameters || {};
    const wantFull = params.full === "true";
    // Optional: fetch a single school's full data
    const wantSchool = params.school || null;

    if (!data || Object.keys(data).length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ schools: [], count: 0 }),
      };
    }

    // Single school lookup — return full data for that school
    if (wantSchool) {
      const entry = data[wantSchool] || null;
      return {
        statusCode: entry ? 200 : 404,
        headers,
        body: JSON.stringify(entry ? { school: entry } : { error: "School not found" }),
      };
    }

    const sorted = Object.values(data).sort((a, b) => b.overall - a.overall);

    // Slim response: strip AI analysis to keep leaderboard payload small
    const schools = wantFull ? sorted : sorted.map(({ ai, homepageH1, metaDesc, uniqueClaims, ...slim }) => slim);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ schools, count: sorted.length }),
    };
  }

  // DELETE — clear leaderboard (admin only, requires secret)
  if (event.httpMethod === "DELETE") {
    const { secret } = JSON.parse(event.body || "{}");
    if (secret !== "blanding2026") {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Unauthorized" }) };
    }
    const { ok, err } = await writeData(store, {});
    return { statusCode: ok ? 200 : 500, headers, body: JSON.stringify({ cleared: ok, error: err }) };
  }

  // POST — submit or update a score
  if (event.httpMethod === "POST") {
    const ip = event.headers["client-ip"] || event.headers["x-forwarded-for"] || "unknown";
    if (!checkPostRate(ip)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many submissions — please wait" }) };
    }
    try {
      const { name, url, overall, language, strategy, cliches, pagesAudited,
              ai, homepageH1, allH1, allH2, metaDesc, uniqueClaims, scrapeSource, scrapeQuality, wasBlocked,
              pagesScraped, contentHash, wordCount, topCliches, clicheBreakdown } = JSON.parse(event.body);

      if (!url || !name || overall == null) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
      }

      let hostname;
      try {
        hostname = new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
      } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid URL" }) };
      }

      if (!hostname.endsWith(".edu") && !hostname.endsWith(".ca")) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "Only .edu and .ca domains" }) };
      }

      // Load current data from store (starts empty — no seed data)
      const { data: rawData } = await readData(store);
      let data = rawData || {};

      // Upsert with rolling average (stabilizes scores across runs)
      const existing = data[hostname];
      const runs = (existing?.runs || 0) + 1;
      const clampScore = (v) => v != null ? Math.max(0, Math.min(100, Math.round(v))) : null;

      // Always use the most recent score — no rolling average.
      // Previous approach blended scores across runs, but it created a confusing
      // mismatch: the audit page showed one score, the leaderboard showed another.
      data[hostname] = {
        ...(existing || {}),
        name: name.substring(0, 100),
        url: hostname,
        overall: clampScore(overall),
        language: clampScore(language),
        strategy: clampScore(strategy),
        cliches: cliches != null ? Math.max(0, cliches) : (existing?.cliches ?? null),
        pagesAudited: pagesAudited || (existing?.pagesAudited || 1),
        runs,
        lastAudited: new Date().toISOString(),
        // Full AI analysis findings — stored for reports and historical tracking
        ...(ai ? {
          ai,
          homepageH1: homepageH1 || [],
          allH1: allH1 || [],
          allH2: (allH2 || []).slice(0, 15),
          metaDesc: metaDesc || "",
          uniqueClaims: uniqueClaims || [],
          scrapeSource: scrapeSource || "unknown",
          scrapeQuality: scrapeQuality || "unknown",
          wasBlocked: wasBlocked || false,
          pagesScraped: pagesScraped || [],
          contentHash: contentHash || "",
          wordCount: wordCount || 0,
          topCliches: topCliches || [],
          clicheBreakdown: clicheBreakdown || null,
        } : {}),
      };

      // Persist
      await writeData(store, data);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, count: Object.keys(data).length }),
      };
    } catch (err) {
      console.error("POST error:", err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to save score" }) };
    }
  }

  // DELETE — clear the store (admin only, used to reset stale seed data)
  if (event.httpMethod === "DELETE") {
    if (store) {
      try { await store.delete("schools"); } catch (e) { console.warn("Delete failed:", e.message); }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ cleared: true }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
}

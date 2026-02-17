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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  // GET — return full leaderboard
  if (event.httpMethod === "GET") {
    const { data } = await readData(store);

    // Only return schools that were actually audited — no seed data
    if (!data || Object.keys(data).length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ schools: [], count: 0 }),
      };
    }

    const sorted = Object.values(data).sort((a, b) => b.overall - a.overall);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ schools: sorted, count: sorted.length }),
    };
  }

  // POST — submit or update a score
  if (event.httpMethod === "POST") {
    const ip = event.headers["client-ip"] || event.headers["x-forwarded-for"] || "unknown";
    if (!checkPostRate(ip)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many submissions — please wait" }) };
    }
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

      // Load current data from store (starts empty — no seed data)
      const { data: rawData } = await readData(store);
      let data = rawData || {};

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

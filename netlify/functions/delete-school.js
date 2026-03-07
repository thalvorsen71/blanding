// Temporary function to delete a school from the leaderboard.
// Remove this file after use.
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };
  }

  try {
    const { secret, hostname } = JSON.parse(event.body);
    if (secret !== "blanding2026") {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Unauthorized" }) };
    }
    if (!hostname) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "hostname required" }) };
    }

    const store = getStore({ name: "leaderboard", siteID: process.env.SITE_ID || "blandingaudit", token: process.env.NETLIFY_API_TOKEN || process.env.BLOB_TOKEN });
    const raw = await store.get("schools");
    const data = raw ? JSON.parse(raw) : {};

    if (!data[hostname]) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: `${hostname} not found` }) };
    }

    const oldEntry = data[hostname];
    delete data[hostname];
    await store.set("schools", JSON.stringify(data));

    // Verify deletion
    const verify = await store.get("schools");
    const verifyData = verify ? JSON.parse(verify) : {};
    const deleted = !verifyData[hostname];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: deleted,
        deleted: hostname,
        oldScore: oldEntry.overall,
        remainingSchools: Object.keys(verifyData).length,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

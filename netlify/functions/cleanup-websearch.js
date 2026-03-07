import { connectLambda, getStore } from "@netlify/blobs";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try { connectLambda(event); } catch (e) {}

  const { secret, slugs } = JSON.parse(event.body || "{}");
  if (secret !== "blanding2026") {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const store = getStore("leaderboard");
  const raw = await store.get("schools");
  if (!raw) return { statusCode: 404, headers, body: JSON.stringify({ error: "No data" }) };

  const data = JSON.parse(raw);
  const removed = [];
  for (const slug of slugs) {
    if (data[slug]) {
      removed.push(slug);
      delete data[slug];
    }
  }

  await store.set("schools", JSON.stringify(data));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ removed, remaining: Object.keys(data).length }),
  };
}

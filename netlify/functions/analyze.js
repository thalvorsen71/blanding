// Proxies requests to Claude API. Your ANTHROPIC_API_KEY stays server-side.
// Add it in Netlify Dashboard → Site Settings → Environment Variables

// Simple in-memory rate limiter (resets when function cold-starts)
const rateLimits = {};
function checkRate(ip) {
  const now = Date.now();
  if (!rateLimits[ip] || now > rateLimits[ip].reset) {
    rateLimits[ip] = { count: 1, reset: now + 60000 };
    return true;
  }
  rateLimits[ip].count++;
  return rateLimits[ip].count <= 30; // 30 requests per minute per IP
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  // Rate limiting
  const ip = event.headers["client-ip"] || event.headers["x-forwarded-for"] || "unknown";
  if (!checkRate(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "Rate limit exceeded — please wait a moment" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) };
  }

  try {
    const req = JSON.parse(event.body);
    if (!req.messages || !Array.isArray(req.messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "messages required" }) };
    }

    const body = {
      model: req.model || "claude-sonnet-4-20250514",
      max_tokens: Math.min(req.max_tokens || 2000, 4000),
      temperature: 0, // Deterministic: same content → same scores between runs
      messages: req.messages,
    };
    if (req.tools) body.tools = req.tools;

    // Timeout strategy (Netlify Pro tier — 26s function limit):
    // - web_search calls (req.tools): AbortController at 25s to return a proper
    //   JSON error before Netlify's 26s limit kills us with a raw 502.
    // - Regular calls (deep analysis): NO AbortController — Haiku completes in
    //   5-10s, well within the 26s limit. If it somehow exceeds, Netlify kills
    //   it and the client handles the raw 502.
    const fetchOpts = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    };

    let controller, timeout;
    if (req.tools) {
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 25000);
      fetchOpts.signal = controller.signal;
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", fetchOpts);
    if (timeout) clearTimeout(timeout);

    const data = await resp.json();
    return { statusCode: resp.ok ? 200 : resp.status, headers, body: JSON.stringify(data) };
  } catch (err) {
    const isTimeout = err.name === "AbortError";
    const msg = isTimeout ? "API request timed out — try again" : err.message;
    return { statusCode: isTimeout ? 504 : 500, headers, body: JSON.stringify({ error: msg }) };
  }
};

// Proxies requests to Claude API. Your ANTHROPIC_API_KEY stays server-side.
// Add it in Netlify Dashboard → Site Settings → Environment Variables
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

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
      max_tokens: Math.min(req.max_tokens || 1500, 2000),
      messages: req.messages,
    };
    if (req.tools) body.tools = req.tools;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    return { statusCode: resp.ok ? 200 : resp.status, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

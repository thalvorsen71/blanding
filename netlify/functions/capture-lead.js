// Captures email leads. Stores in Netlify environment for now.
// Replace with your email service (Mailchimp, Resend, HubSpot, etc.)
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { email, schoolName, score, name, title, source } = JSON.parse(event.body);

    if (!email || !email.includes("@")) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Valid email required" }) };
    }

    // ─── OPTION 1: Log to Netlify Functions console (visible in Netlify dashboard) ───
    console.log("LEAD CAPTURED:", JSON.stringify({ email, name: name || "", title: title || "", schoolName, score, source: source || "pdf_export", timestamp: new Date().toISOString() }));

    // ─── OPTION 2: Send to Mailchimp (uncomment and add MAILCHIMP_API_KEY + LIST_ID to env vars) ───
    // const mcResp = await fetch(`https://us1.api.mailchimp.com/3.0/lists/${process.env.MAILCHIMP_LIST_ID}/members`, {
    //   method: "POST",
    //   headers: { Authorization: `apikey ${process.env.MAILCHIMP_API_KEY}`, "Content-Type": "application/json" },
    //   body: JSON.stringify({ email_address: email, status: "subscribed", merge_fields: { SCHOOL: schoolName, SCORE: String(score) } }),
    // });

    // ─── OPTION 3: Send to HubSpot (uncomment and add HUBSPOT_API_KEY to env vars) ───
    // const hsResp = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    //   method: "POST",
    //   headers: { Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`, "Content-Type": "application/json" },
    //   body: JSON.stringify({ properties: { email, company: schoolName, blanding_score: String(score) } }),
    // });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

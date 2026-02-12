const API_ENDPOINT = "/.netlify/functions/analyze";
const LEAD_ENDPOINT = "/.netlify/functions/capture-lead";

function parseJSON(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("JSON parse failed");
  }
}

async function callAPI(messages, useSearch = false) {
  const body = { model: "claude-sonnet-4-20250514", max_tokens: 1500, messages };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const resp = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.content?.map(b => b.text || "").filter(Boolean).join("\n") || "";
}

export async function fetchPage(url) {
  const raw = await callAPI([{
    role: "user",
    content: `Search for and visit this URL: ${url}
Return ONLY a JSON object (no markdown, no backticks, no preamble) with these fields:
- "title": the page title
- "meta_description": the meta description
- "h1": array of all H1 text
- "h2s": array of first 12 H2 texts
- "nav_items": array of main navigation labels
- "body_text": main body text content (first 2500 chars, skip nav/footer)
- "ctas": array of CTA button/link text
- "page_type": "homepage"|"admissions"|"about"|"academics"|"student-life"|"other"
- "linked_pages": array of up to 6 internal section URLs
- "unique_claims": array of specific concrete claims only this school could make
- "stock_phrases": array of phrases that could appear on any college website`
  }], true);
  return parseJSON(raw);
}

export async function deepAnalysis(url, text, allText) {
  const raw = await callAPI([{
    role: "user",
    content: `You are a brutally honest higher ed brand strategist. Analyze this website copy.

URL: ${url}
Page content: ${text.substring(0, 2800)}
Cross-page context: ${allText.substring(0, 1200)}

Return ONLY a JSON object (no markdown, no backticks):
{
  "voice_score": 1-10 (1=any school, 10=unmistakable),
  "specificity_score": 1-10,
  "ia_score": 1-10,
  "cta_score": 1-10,
  "consistency_score": 1-10,
  "tone_diagnosis": "describe their brand as a person at a dinner party, 2 sentences, be funny and cutting",
  "biggest_sin": "worst branding offense, 1 cutting sentence",
  "best_moment": "one thing that stands out (if nothing, say so with humor)",
  "weak_sentence": "quote the most generic sentence exactly",
  "rewrite": "rewrite that sentence with personality and specificity",
  "nav_critique": "1-2 sentences on navigation label distinctiveness",
  "differentiation_killer": "the #1 reason this page fails to stand out",
  "missed_opportunity": "what COULD be distinctive but they buried it",
  "rx_language": "specific prescription to fix voice/copy, 2 concrete sentences",
  "rx_structure": "specific prescription to fix IA/navigation, 2 sentences",
  "rx_strategy": "specific prescription to fix content strategy, 2 sentences",
  "rx_experience": "specific prescription to fix UX/CTAs, 2 sentences"
}`
  }]);
  try { return parseJSON(raw); } catch { return null; }
}

export async function captureLead(email, schoolName, score) {
  try {
    await fetch(LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, schoolName, score }),
    });
    return true;
  } catch {
    return false;
  }
}

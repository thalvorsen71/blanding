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

CRITICAL RULES:
- Return ONLY content that appears on THIS specific URL. Do NOT include text from other pages on the same website (e.g. don't pull in mission statement pages, policy pages, or deep sub-pages).
- This is a homepage or primary landing page audit. Only capture what a visitor to THIS URL would actually see.
- For body_text: Copy the actual visible text content from THIS page verbatim. Do not pull in content from sub-pages or other URLs on the same domain.
- For unique_claims and stock_phrases: Only include phrases that literally appear on THIS page.
- If you cannot access the page or certain fields are empty, use empty strings/arrays. Do NOT fabricate placeholder content.

Return ONLY a JSON object (no markdown, no backticks, no preamble) with these fields:
- "title": the exact page title
- "meta_description": the exact meta description tag content
- "h1": array of all H1 text exactly as written
- "h2s": array of first 12 H2 texts exactly as written
- "nav_items": array of main navigation labels exactly as written
- "body_text": verbatim main body text content from THIS URL ONLY (first 2500 chars, skip nav/footer). Do NOT include text from linked pages or sub-pages.
- "ctas": array of CTA button/link text exactly as written
- "page_type": "homepage"|"admissions"|"about"|"academics"|"student-life"|"other"
- "linked_pages": array of up to 6 internal section URLs
- "unique_claims": array of specific concrete claims that literally appear on the page
- "stock_phrases": array of generic phrases that literally appear on the page`
  }], true);
  return parseJSON(raw);
}

export async function deepAnalysis(url, text, allText) {
  const raw = await callAPI([{
    role: "user",
    content: `You are a brutally honest higher ed brand copy critic. Your ONLY job is to judge the WORDS on the pages that prospective students and visitors actually see — homepages and primary landing pages. Do NOT reference mission statements, internal policies, or content buried deep in the site.

This is the visitor-facing copy scraped from ${url}:

--- BEGIN SCRAPED TEXT ---
${text.substring(0, 3000)}
--- END SCRAPED TEXT ---

Additional landing pages scraped (About, Admissions, Academics — NOT deep sub-pages): ${allText.substring(0, 800)}

CRITICAL RULES — YOU MUST FOLLOW THESE:
1. You can ONLY reference text that appears between the BEGIN/END markers above.
2. Do NOT make claims about page layout, visual design, navigation structure, or what "leads" the page. You cannot see the page — you only have the text.
3. For "weak_sentence": Copy-paste an EXACT sentence from the scraped text. If you can't find one, write "No clear example in scraped text."
4. For "biggest_sin" and "best_moment": Only reference language/phrases that actually appear in the scraped text above. Do NOT invent content.
5. Do NOT claim text is "repeated" or "duplicated" unless you can see it appear twice in the scraped text above.
6. Focus entirely on: Is this copy generic? Could any school say this? Or is it specific, distinctive, and ownable?

Return ONLY a JSON object (no markdown, no backticks):
{
  "voice_score": 1-10 (1=any school could say every word of this, 10=unmistakably this institution),
  "specificity_score": 1-10 (1=all abstract claims, 10=concrete specific details throughout),
  "consistency_score": 1-10 (1=identity shifts constantly, 10=clear consistent voice),
  "tone_diagnosis": "describe their brand voice as a person at a dinner party, 2 sentences, be funny and specific",
  "biggest_sin": "the worst LANGUAGE problem you can see IN THE ACTUAL TEXT ABOVE, 1 sentence",
  "best_moment": "the most distinctive/specific LANGUAGE in the text above (if nothing, say so with humor)",
  "weak_sentence": "EXACT VERBATIM sentence from the scraped text above that is most generic. Copy-paste it character for character.",
  "rewrite": "rewrite that exact sentence with personality and specificity for this particular school",
  "differentiation_killer": "the #1 reason this copy fails to stand out, based on the actual words",
  "missed_opportunity": "what specific detail in the text COULD be distinctive but gets buried in generic language",
  "rx_language": "specific prescription to fix the copy/voice, 2 concrete sentences",
  "rx_strategy": "specific prescription for what content to lead with instead, 2 sentences"
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

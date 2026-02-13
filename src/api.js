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
- Only include text that ACTUALLY appears on the page. Do not invent, paraphrase, or imagine content.
- For body_text: Copy the actual visible text content verbatim. Do not summarize or rephrase.
- For unique_claims and stock_phrases: Only include phrases that literally appear on the page.
- If you cannot access the page or certain fields are empty, use empty strings/arrays. Do NOT fabricate placeholder content.

Return ONLY a JSON object (no markdown, no backticks, no preamble) with these fields:
- "title": the exact page title
- "meta_description": the exact meta description tag content
- "h1": array of all H1 text exactly as written
- "h2s": array of first 12 H2 texts exactly as written
- "nav_items": array of main navigation labels exactly as written
- "body_text": verbatim main body text content (first 2500 chars, skip nav/footer). Copy the EXACT words from the page.
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
    content: `You are a brutally honest higher ed brand strategist. Analyze this website copy.

URL: ${url}
Page content: ${text.substring(0, 2800)}
Cross-page context: ${allText.substring(0, 1200)}

CRITICAL ANTI-HALLUCINATION RULES — READ THESE CAREFULLY:
1. For "weak_sentence": You MUST quote a sentence that LITERALLY appears in the Page Content above. Copy-paste it exactly. If you cannot find a sufficiently generic sentence in the provided text, write "No clear example found in scraped content."
2. For "biggest_sin" and "best_moment": Only reference things that are actually present in the provided content. Do not describe content that doesn't appear above.
3. Do NOT invent examples, repeated paragraphs, duplicate content, or fabricated quotes. If something isn't in the text, don't claim it is.
4. For "differentiation_killer" and "missed_opportunity": Base your analysis ONLY on what you can see in the provided text. Do not speculate about pages or content you haven't seen.
5. If the provided content is limited or you can't make a strong judgment, say so honestly rather than fabricating a confident-sounding observation.

Return ONLY a JSON object (no markdown, no backticks):
{
  "voice_score": 1-10 (1=any school could say this, 10=unmistakably this institution),
  "specificity_score": 1-10,
  "ia_score": 1-10,
  "cta_score": 1-10,
  "consistency_score": 1-10,
  "tone_diagnosis": "describe their brand as a person at a dinner party, 2 sentences, be funny and cutting",
  "biggest_sin": "worst branding offense THAT YOU CAN ACTUALLY SEE IN THE TEXT ABOVE, 1 cutting sentence",
  "best_moment": "one thing that actually stands out IN THE PROVIDED TEXT (if nothing does, say so with humor)",
  "weak_sentence": "EXACT VERBATIM QUOTE of the most generic sentence from the Page Content above. Must be copy-pasted, not paraphrased.",
  "rewrite": "rewrite that exact sentence with personality and specificity",
  "nav_critique": "1-2 sentences on navigation label distinctiveness",
  "differentiation_killer": "the #1 reason this page fails to stand out, based on the actual content provided",
  "missed_opportunity": "what COULD be distinctive based on what you see in the actual content",
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

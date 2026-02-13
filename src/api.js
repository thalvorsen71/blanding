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

async function callAPI(messages, useSearch = false, model = "claude-sonnet-4-20250514") {
  const body = { model, max_tokens: 1500, messages };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const controller = new AbortController();
  const timeoutMs = useSearch ? 45000 : 25000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.content?.map(b => b.text || "").filter(Boolean).join("\n") || "";
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Request timed out — try again");
    throw err;
  }
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
  const combinedText = (text + " " + allText).trim();
  const wordCount = combinedText.split(/\s+/).length;
  
  // If almost no content was scraped, diagnose the ABSENCE of copy
  const isEmptyContent = wordCount < 80;
  
  const prompt = isEmptyContent
    ? `Higher ed brand critic. This institution's homepage at ${url} has almost NO visitor-facing copy. The scraper found only: "${text.substring(0, 300)}"

This is a strategy failure — the most valuable real estate the institution owns is doing zero brand work. Diagnose this absence.

Return JSON only:
{
  "voice_score": 2,
  "specificity_score": 1,
  "consistency_score": 3,
  "tone_diagnosis": "describe this empty homepage as a person at a dinner party, 2 sentences, funny",
  "biggest_sin": "diagnose why having no copy on your homepage is a branding failure, 1 sentence",
  "best_moment": "find anything remotely distinctive in the scraped text, or roast the emptiness",
  "weak_sentence": "NO_CONTENT",
  "rewrite": "NO_CONTENT",
  "differentiation_killer": "explain how absence of copy makes differentiation impossible",
  "missed_opportunity": "what should this homepage be doing instead",
  "rx_language": "what words should actually be on this homepage, 2 sentences",
  "rx_strategy": "how to fix a homepage that does no brand work, 2 sentences"
}`
    : `Brutally honest higher ed brand copy critic. Judge ONLY the words visitors actually see on homepages and landing pages.

URL: ${url}
--- SCRAPED TEXT ---
${text.substring(0, 2000)}
--- END ---
Other pages: ${allText.substring(0, 500)}

RULES:
- Only reference text that appears in the SCRAPED TEXT above.
- No claims about layout/design.
- For weak_sentence: Find the most generic sentence in the scraped text and copy it EXACTLY, character for character. It must appear verbatim above. If you cannot find a complete sentence, write "NO_CONTENT".
- For rewrite: Rewrite that exact sentence with personality. If weak_sentence is "NO_CONTENT", write "NO_CONTENT".
- Do NOT paraphrase or combine multiple sentences. Pick ONE real sentence.

Return JSON only:
{
  "voice_score": 1-10,
  "specificity_score": 1-10,
  "consistency_score": 1-10,
  "tone_diagnosis": "brand as dinner party person, 2 sentences, funny",
  "biggest_sin": "worst language problem in text above, 1 sentence",
  "best_moment": "most distinctive language above (or say nothing stands out)",
  "weak_sentence": "EXACT verbatim sentence copied from scraped text, or NO_CONTENT",
  "rewrite": "rewrite with personality for this school, or NO_CONTENT",
  "differentiation_killer": "why this copy fails to stand out",
  "missed_opportunity": "what detail could be distinctive but is buried",
  "rx_language": "fix the voice, 2 sentences",
  "rx_strategy": "fix the content strategy, 2 sentences"
}`;

  const raw = await callAPI([{ role: "user", content: prompt }], false, "claude-haiku-4-5-20251001");
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

/**
 * Shared scoring module for the Blanding Audit Tool.
 *
 * This is the SINGLE SOURCE OF TRUTH for score calculations.
 * Used by both App.jsx (live audits) and reaudit.js (batch re-audits).
 *
 * DO NOT duplicate scoring logic elsewhere. If you need to change
 * how scores are calculated, change it here and both paths update.
 */

import { countCliches, countWeightedCliches, contentRichnessBonus } from "./constants.js";

/**
 * Calculate language, strategy, and overall scores from scraped content + AI analysis.
 *
 * @param {Object} params
 * @param {string} params.allBody - concatenated body text from all pages
 * @param {string[]} params.allH1 - all H1 headings across pages
 * @param {string[]} params.allH2 - all H2 headings across pages
 * @param {string} params.metaDesc - homepage meta description
 * @param {string[]} params.uniqueClaims - unique/specific claims (AI-verified or cheerio-extracted)
 * @param {Object|null} params.ai - AI deep analysis result (can be null)
 * @returns {{ language: number, strategy: number, overall: number, cliches: Array, totalCliches: number, weighted: Object, richness: number }}
 */
export function calculateScores({ allBody, allH1, allH2, metaDesc, uniqueClaims, ai }) {
  const cliches = countCliches(allBody + " " + allH1.join(" ") + " " + allH2.join(" "));
  const totalCliches = cliches.reduce((s, c) => s + c.count, 0);
  const wc = allBody.split(/\s+/).length;

  // Weighted cliché analysis: H1 clichés hurt 3x, H2/meta 2x, body 1x
  const weighted = countWeightedCliches(allBody, allH1, allH2, metaDesc);

  // Content richness bonus: rewards specific, distinctive content (0-30 pts)
  const richness = contentRichnessBonus(allBody, allH1, allH2, uniqueClaims);

  // H1/H2 brand quality: reward distinctive headlines, penalize generic ones
  const h1Total = allH1.filter(h => h.trim().length > 3).length;
  const h2Total = allH2.filter(h => h.trim().length > 3).length;
  const headlineQuality = (h1Total + h2Total) > 0
    ? Math.round(((h1Total + h2Total - weighted.h1Count - weighted.h2Count) / (h1Total + h2Total)) * 10)
    : 0;

  // ── LANGUAGE SCORE ──
  // Logarithmic cliché penalty: first few hurt a lot, diminishing pain after that.
  const countPenalty = Math.min(Math.log(cliches.length + 1) * 14, 50);
  // Density penalty: clichés per 100 words, weighted by severity + placement.
  const densityPenalty = Math.min((weighted.weightedTotal / Math.max(wc / 100, 1)) * 4, 35);
  // Non-additive: take the WORSE of count vs density, then add 30% of the other.
  const primaryPenalty = Math.max(countPenalty, densityPenalty);
  const secondaryPenalty = Math.min(countPenalty, densityPenalty);
  let lang = 100 - primaryPenalty - (secondaryPenalty * 0.3) - (uniqueClaims.length < 2 ? 8 : 0);
  // H1 cliché penalty: platitudes in your headline are a brand crime
  if (weighted.h1Count > 0) lang -= Math.min(weighted.h1Count * 5, 15);
  // Rich content bonus: strong specific content earns back some of what clichés took away
  if (richness > 12) lang += Math.min(Math.round(richness * 0.4), 8);
  // Thin content penalty: saying nothing isn't the same as being distinctive
  if (wc < 300) lang -= Math.round((300 - wc) / 25);
  // AI voice score: dynamic blend based on mechanical score confidence
  const mechWeight = 0.4 + (Math.min(lang, 80) / 100) * 0.25; // range: 0.4 to 0.6
  if (ai?.voice_score) lang = Math.round(lang * mechWeight + ai.voice_score * 10 * (1 - mechWeight));
  lang = Math.max(0, Math.min(100, Math.round(lang)));

  // ── STRATEGY SCORE ──
  // Unique claims with diminishing returns: first 3 = 5pts, next 3 = 2.5pts, beyond = 1pt
  const uniqBase = Math.min(uniqueClaims.length, 3) * 5;
  const uniqMid = Math.min(Math.max(uniqueClaims.length - 3, 0), 3) * 2.5;
  const uniqTail = Math.min(Math.max(uniqueClaims.length - 6, 0), 5) * 1;
  const uniqContrib = uniqBase + uniqMid + uniqTail;
  let mechStrat = 30 + uniqContrib + Math.min(richness * 0.5, 10) + Math.min(headlineQuality, 8);
  mechStrat = Math.max(0, Math.min(100, mechStrat));
  let strat;
  if (ai?.specificity_score && ai?.consistency_score) {
    // Single-step blend: 55% mechanical, 20% specificity, 15% consistency, 10% ratio
    const aiSpec = ai.specificity_score * 10;
    const aiCons = ai.consistency_score * 10;
    const aiRatio = ai.specificity_ratio != null ? Math.max(0, Math.min(100, ai.specificity_ratio)) : aiSpec;
    strat = Math.round(mechStrat * 0.55 + aiSpec * 0.20 + aiCons * 0.15 + aiRatio * 0.10);
  } else {
    strat = mechStrat;
  }
  // Ratio ceiling: a mostly-generic page can't score above its reality
  if (ai?.specificity_ratio != null) {
    const ratioCeiling = Math.max(0, Math.min(100, ai.specificity_ratio)) + 20;
    if (strat > ratioCeiling) strat = Math.round(strat * 0.6 + ratioCeiling * 0.4);
  }
  // Brand theatre penalty: strategy-only modifier (positioning problem, not language)
  if (ai?.brand_theatre_score && ai.brand_theatre_score >= 4) {
    const theatrePenalty = Math.min((ai.brand_theatre_score - 3) * 2.5, 15);
    strat -= theatrePenalty;
  }
  // AI readiness: gentle nudge on strategy only. 5 is neutral.
  if (ai?.ai_readiness_score) {
    const aiReadinessImpact = (ai.ai_readiness_score - 5) * 2;
    strat += Math.max(-8, Math.min(10, aiReadinessImpact));
  }
  strat = Math.max(0, Math.min(100, Math.round(strat)));

  // ── OVERALL ──
  const overall = Math.round(lang * 0.55 + strat * 0.45);

  return { language: lang, strategy: strat, overall, cliches, totalCliches, weighted, richness };
}

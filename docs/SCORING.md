# Blanding Scoring System

**Last updated:** 2026-03-10
**Source of truth:** `src/scoring.js`

## How Scores Work

Three scores, two inputs:

| Score | Weight in Overall | What It Measures |
|-------|-------------------|-----------------|
| Language | 55% | How original the writing is (cliché density, voice distinctiveness) |
| Strategy | 45% | Whether content actually differentiates (specificity, brand theatre, AI readiness) |
| Overall | Blend | 55% language + 45% strategy |

## Two Scoring Engines

### 1. Mechanical (constants.js + scoring.js)

Regex-based cliché detection against a database of 160+ phrases. No AI involved. Reproducible, deterministic.

**Cliché severity tiers:**
- **Severe (1.5x):** Identity-killing platitudes. "World-class," "transformative," "committed to excellence," "shaping the future," "unlike any other"
- **Normal (1.0x):** Generic filler. Everything not in severe or mild.
- **Mild (0.5x):** Functional/expected. "Apply now," "learn more," "explore programs"

**Placement weighting:**
- H1 clichés: 3x multiplier (your headline is your brand statement)
- H2 clichés: 2x multiplier
- Meta description: 2x multiplier
- Body copy: 1x multiplier

**Language score formula:**
1. Start at 100
2. Logarithmic count penalty: `min(log(uniqueCliches + 1) * 14, 50)`
3. Density penalty: weighted clichés per 100 words × 4, capped at 35
4. Non-additive: worse penalty at full weight, lesser at 30%
5. H1 cliché penalty: -5 per H1 cliché, max -15
6. Content richness bonus: up to +8 if strong specific content
7. Thin content penalty if under 300 words
8. AI voice blend (see below)

**Strategy score formula:**
1. Start at 30
2. Unique claims with diminishing returns: first 3 = 5pts each, next 3 = 2.5pts, beyond = 1pt
3. Richness bonus: up to +10
4. Headline quality bonus: up to +8
5. AI blend (see below)
6. Brand theatre penalty: up to -15 if theatre score >= 4
7. AI readiness nudge: ±8-10 based on deviation from neutral (5)

### 2. AI Analysis (api.js → Claude Sonnet)

Claude evaluates the scraped content with a detailed system prompt. Returns:

| Field | Scale | What It Measures |
|-------|-------|-----------------|
| voice_score | 1-10 | Could you identify this school with the logo removed? |
| specificity_score | 1-10 | How concrete vs. platitude-filled? |
| specificity_ratio | 0-100 | % of page that's genuinely specific content |
| consistency_score | 1-10 | Does every element reinforce who they are? |
| brand_theatre_score | 1-10 | Performance of brand vs. delivery of brand (HIGH = bad) |
| ai_readiness_score | 1-10 | Could an AI search engine recommend this school? |

Plus qualitative fields: tone_diagnosis, biggest_sin, best_moment, weak_sentence, rewrite, differentiation_killer, missed_opportunity, hero_assessment, rx_language, rx_strategy, rx_ai_readiness, verified_unique_claims.

**Grounding rules in the prompt:**
- AI can ONLY reference text that appears in the scraped content
- No outside knowledge about the institution
- Must quote actual phrases when making claims
- weak_sentence must be verbatim copy-paste from scraped text
- No claims about visual layout, design, or images

### Blend Logic

**Language score blend:**
- Dynamic weight: mechanical gets 40-60% depending on score confidence
- Formula: `mechWeight = 0.4 + (min(lang, 80) / 100) * 0.25`
- AI voice gets `1 - mechWeight`
- Higher mechanical scores = more trust in mechanical, less AI influence

**Strategy score blend:**
- 55% mechanical + 20% AI specificity + 15% AI consistency + 10% AI ratio
- Ratio ceiling prevents mostly-generic pages from scoring above reality
- Brand theatre penalty is strategy-only (it's a positioning problem, not a language one)

## Score Bands

| Range | Label | Meaning |
|-------|-------|---------|
| 80+ | Standing Out | Real texture. Students can feel the difference. |
| 65-79 | Getting There | Sparks of personality buried under institutional safety. |
| 45-64 | Blending In | Sounds like a college. That's the problem. |
| 25-44 | Wallpaper | Approved by a committee afraid of saying anything. |
| 0-24 | Invisible | The higher ed greatest hits album. |

## Calibration Notes

- Temperature 0 on AI calls for deterministic scoring
- Model: claude-sonnet-4-20250514
- The prompt explicitly tells Claude to use the FULL 1-10 range with anchors at each level
- Brand theatre is scored inversely (high = bad) because it's measuring a negative
- News/events content gets LOW weight in AI scoring (specificity cap of +1-2 points, no voice boost)
- Content type hierarchy: H1 > H2 > feature copy > news > CTAs/nav (ignored)

## The Cliché Database

160+ phrases in `src/constants.js`, organized by category:
- Classic higher ed emptiness (world-class, cutting-edge, etc.)
- Mission statement bingo (career-ready, flexible learning, etc.)
- Conversion funnel filler (take the next step, start your journey, etc.)
- Vague purpose statements (change makers, positive impact, etc.)
- Community platitudes (sense of belonging, tight-knit, etc.)
- Promise without proof (transformative, unlock potential, etc.)
- Filler adjectives (exceptional, groundbreaking, pioneering, etc.)
- Stock identity claims (our mission, values-driven, etc.)
- Outcome vagueness (career development, leadership skills, etc.)
- Campus life generics (student experience, state-of-the-art facilities, etc.)
- Application pressure (limited spots, rolling admissions, etc.)
- Diversity checkbox language (we celebrate, all backgrounds, etc.)

Navigation clichés tracked separately (NAV_CLICHES) but excluded from scoring.

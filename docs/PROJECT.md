# Blanding Audit Tool — Project Overview

**Last updated:** 2026-03-10
**Live URL:** https://blandingaudit.netlify.app
**Repo:** https://github.com/thalvorsen71/blanding.git
**Owner:** Tracey Halvorsen (halvorsen@createvelocity.com)

## What It Is

An AI-powered tool that scores how original (or cliché-ridden) a university's website language is. Users paste a .edu URL, the tool scrapes the homepage + key sub-pages, detects clichés mechanically, then runs AI analysis (Claude Sonnet) to evaluate brand voice, specificity, and strategy.

Outputs: overall score (0-100), language score, strategy score, cliché count, AI diagnosis, rewrite suggestions, and a shareable PDF report.

## Architecture

**Frontend:** React + Vite, single-page app
**Backend:** Netlify Functions (serverless)
**Storage:** Netlify Blobs (leaderboard data)
**AI:** Anthropic Claude API (claude-sonnet-4-20250514)
**Scraping:** Cheerio (server-side HTML parsing, no browser rendering)
**Hosting:** Netlify (Pro tier, 26s function timeout)

### Key Files

| File | Purpose |
|------|---------|
| `src/App.jsx` | Main app: audit flow, UI, leaderboard submission |
| `src/api.js` | Scraping logic, AI prompt, API calls |
| `src/constants.js` | Cliché database (160+ phrases), severity tiers, scoring thresholds |
| `src/scoring.js` | Single source of truth for score calculations |
| `src/pdf.js` | PDF report generation |
| `netlify/functions/analyze.js` | Proxies requests to Claude API (keeps key server-side) |
| `netlify/functions/leaderboard.js` | GET/POST/PATCH leaderboard data |
| `netlify/functions/capture-lead.js` | Email capture for PDF downloads |
| `netlify/functions/reaudit.js` | Batch re-audit endpoint (admin) |
| `netlify/functions/scrape-fallback.js` | Server-side scraping for blocked sites |

### Data Flow

1. User pastes .edu URL
2. Frontend scrapes homepage + up to 3 sub-pages via Cheerio
3. Extracts: body text, H1s, H2s, meta description
4. Runs mechanical cliché detection (constants.js) with severity weighting
5. Sends scraped content to Claude API via Netlify proxy (analyze.js)
6. Claude returns: voice_score, specificity_score, brand_theatre_score, ai_readiness_score, diagnostics
7. scoring.js blends mechanical + AI scores into language/strategy/overall
8. Results displayed, optionally submitted to leaderboard

## Key Design Decisions

**No AI scraping fallback.** Cheerio only. We removed an earlier AI-assisted scraping path because it could fabricate content. If Cheerio can't get text, we say so honestly with a "limited content" warning. This is a trust decision: better to audit less content accurately than more content unreliably.

**Temperature 0 for AI analysis.** Deterministic scoring. Same content should produce same scores between runs. This matters for leaderboard integrity.

**Dual scoring: mechanical + AI.** Cliché detection is regex-based and reproducible. AI provides qualitative analysis (voice, specificity, brand theatre). The blend prevents either from dominating. Language score: ~40-60% mechanical, rest AI voice. Strategy score: 55% mechanical, 45% AI.

**Severity tiers for clichés.** Not all clichés are equal. "World-class" in your H1 is a brand crime (1.5x weight, 3x placement multiplier). "Apply now" in a CTA is functional (0.5x weight). This prevents schools from being unfairly penalized for necessary functional language.

**No accounts, no auth for users.** Paste a URL, get a score. Friction-free. The only auth is admin endpoints (batch re-audit, school removal) using a shared secret.

## Current State (March 2026)

- 205 schools on leaderboard
- 0 schools above 80/100
- Mean score: 51.2, Median: 50
- MIT leads at 76
- 4,080 total clichés detected across all schools
- 217 unique cliché phrases in use
- "World-class" most widespread (33% of schools)
- 8 real user submissions received (not seeded by us)
- Lead capture active on PDF export

## Known Issues

- Georgetown and Scripps timed out during batch re-audit (may have stale scores)
- Schools with heavy JavaScript rendering (minimal server-side HTML) get poor scrapes via Cheerio
- Some schools block automated scrapers (403) — scrape-fallback.js handles some of these but not all
- `clicheBreakdown` field is null for most leaderboard entries (only `topCliches` is reliably populated)

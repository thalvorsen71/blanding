# Blanding Audit Tool — Project Context

## What This Is
A free website audit tool for higher education that scores how generic ("bland") a school's website is. Built as a LinkedIn-native content play for adeo (Tracey Halvorsen's agency). Schools enter their URL, get scored on language quality, strategic differentiation, and cliché density. Results feed a public leaderboard.

Live at: https://blandingaudit.netlify.app
Netlify site ID: 6830021e-84f4-4028-8c99-98cdefaf6b85
GitHub: https://github.com/thalvorsen71/blanding.git
Deploys: Auto-deploy from GitHub main branch (linked March 2026)

## Architecture
- **Frontend**: Vite + React (single-page app in `src/`)
- **Backend**: Netlify Functions in `netlify/functions/`
- **Data store**: Netlify Blobs (key-value), store name "leaderboard", key "schools"
- **AI scoring**: Claude API (claude-sonnet-4-20250514) called from `analyze.js` function
- **Scraping**: Cheerio-based, with Puppeteer fallback via `scrape-fallback.js`
- **Admin**: Secret header `x-admin-secret: blanding2026` for batch operations

## Key Files
| File | Purpose |
|------|---------|
| `src/App.jsx` | Main React app, all UI, audit flow, leaderboard display |
| `src/constants.js` | CLICHES array (160+ phrases), safety-net words, `countCliches()` scoring function |
| `src/scoring.js` | Score calculation, tier assignments, grade mapping |
| `src/api.js` | Frontend API calls to Netlify functions |
| `src/pdf.js` | PDF report generation |
| `src/scorecard.js` | Visual scorecard component |
| `netlify/functions/analyze.js` | Main audit endpoint, calls Claude API |
| `netlify/functions/leaderboard.js` | CRUD for leaderboard data in Netlify Blobs |
| `netlify/functions/reaudit.js` | Re-audit endpoint for batch operations |
| `netlify/functions/scrape-fallback.js` | Puppeteer scraping for blocked sites |
| `netlify/functions/capture-lead.js` | Email capture |

## Data
| Location | What |
|----------|------|
| `data/leaderboard-export.json` | Full 242-school dataset (exported 2026-03-10) |
| `data/leaderboard-export.csv` | Same data as CSV for quick analysis |
| `scripts/reaudit-log.json` | 185 batch re-audit results with before/after scores |
| `scripts/analysis/` | Cheerio scan scripts, safety-net verification, frequency analysis |
| Live API | `GET https://blandingaudit.netlify.app/.netlify/functions/leaderboard` |

## Scoring System
Three subscores (0-100 each) combine into an overall score:
- **Language** (AI-scored): Writing quality, specificity, voice distinctiveness
- **Strategy** (AI-scored): Clear positioning, audience targeting, differentiation
- **Clichés** (mechanical): Phrase matching (160+ phrases) + safety-net word detection (9 words)

### Safety-Net Word Detection (added 2026-03-10)
After phrase matching, a second pass counts standalone occurrences of 9 high-value cliché words: rigorous, excellence, community, innovative, diverse, leadership, empower, impact, inclusive. Subtracts already-captured phrase hits to prevent double-counting. See `docs/SCORING.md` for full details.

### Cliché Score Formula
`clicheScore = max(0, 100 - (totalHits * 3) - (uniquePhrases * 2) - severityPenalty)`

## Documentation
| File | Covers |
|------|--------|
| `docs/SCORING.md` | Complete scoring methodology, cliché tiers, safety-net system |
| `docs/DATA-INSIGHTS.md` | 229-school scan results, word frequency tables, LinkedIn stats |
| `docs/PROJECT.md` | Project overview, goals, roadmap |
| `docs/TECHNICAL.md` | Technical architecture, deployment, API reference |
| `docs/UK-EXPANSION.md` | UK edition volunteer brief |

## Leaderboard Data Shape
Each school entry in the leaderboard has:
```json
{
  "name": "School Name",
  "url": "school.edu",
  "overall": 72,
  "language": 68,
  "strategy": 75,
  "cliches": 45,
  "pagesAudited": 4,
  "runs": 3,
  "lastAudited": "2026-03-09T18:53:01.500Z",
  "wordCount": 5895,
  "topCliches": [{"phrase": "world-class", "count": 3, "severity": "high"}, ...],
  "clicheBreakdown": {"high": 5, "medium": 12, "low": 8},
  "hasAI": true,
  "allH1": ["..."],
  "allH2": ["..."],
  "scrapeSource": "cheerio",
  "scrapeQuality": "good",
  "wasBlocked": false,
  "pagesScraped": 4,
  "contentHash": "abc123"
}
```

## Environment
- API key prefix: `sk-ant-api03-oI_` (full key in Netlify env vars)
- Model: `claude-sonnet-4-20250514`
- Admin secret: `blanding2026`
- Node 18+, npm

## Known Issues / Pending
- Georgetown and Scripps timed out during batch re-audit (may have stale scores)
- AI-failed audits UX: no decision yet on showing partial scores vs. blocking results
- UK edition: waiting on volunteer input
- Leaderboard count discrepancy: Blobs has 242, docs reference 229 (229 was Cheerio scan count, live leaderboard has grown since)

## Content Strategy Context
This tool is a LinkedIn content engine for Tracey/adeo. The leaderboard data drives posts, insights, and commentary about higher ed marketing. Every data point should be evaluated through the lens of "is this shareable and does it position adeo as the expert?"

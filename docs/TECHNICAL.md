# Blanding Technical Reference

**Last updated:** 2026-03-10

## Deployment

| Item | Detail |
|------|--------|
| Hosting | Netlify (Pro tier) |
| Site URL | https://blandingaudit.netlify.app |
| Repo | https://github.com/thalvorsen71/blanding.git |
| Branch | main (auto-deploys on push) |
| Function timeout | 26 seconds (Netlify Pro) |
| Build command | `npm run build` (Vite) |

## Environment Variables (Netlify Dashboard)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API key (sk-ant-api03-oI_...) |

Set in: Netlify Dashboard → Site Settings → Environment Variables

## API Endpoints

All under `/.netlify/functions/`

### analyze (POST)
Proxies to Claude API. Accepts messages array, returns AI analysis.
- Rate limited: 30 requests/minute/IP
- Origin restricted: only blandingaudit.netlify.app and localhost
- Max input: 50,000 characters
- Allowed models: claude-sonnet-4-20250514, claude-haiku-4-5-20251001
- Max tokens: 4,000

### leaderboard (GET/POST/PATCH)
- **GET**: Returns full leaderboard as JSON object keyed by hostname
- **POST**: Submits or updates a school's audit data. Requires `secret: "blanding2026"` for admin operations
- **PATCH**: Removes a single school by hostname. Admin only (`secret: "blanding2026"`)

Example PATCH (remove a school):
```bash
curl -X PATCH https://blandingaudit.netlify.app/.netlify/functions/leaderboard \
  -H "Content-Type: application/json" \
  -d '{"secret":"blanding2026","removeUrl":"cca.edu"}'
```

### reaudit (POST)
Batch re-audit endpoint. Admin only.
- Accepts: `{ secret, schools: [array of hostnames], batchSize }`
- Re-scrapes and re-scores each school
- Used for: score recalibration after algorithm changes

### capture-lead (POST)
Stores email + metadata when users download PDF reports.
- Fields: email, schoolName, score, name, title, source

### scrape-fallback (POST)
Server-side scraping for sites that block client-side requests (CORS, 403s).

## Admin Operations

### Remove a school from leaderboard
```bash
curl -X PATCH https://blandingaudit.netlify.app/.netlify/functions/leaderboard \
  -H "Content-Type: application/json" \
  -d '{"secret":"blanding2026","removeUrl":"hostname.edu"}'
```

### Batch re-audit all schools
```bash
curl -X POST https://blandingaudit.netlify.app/.netlify/functions/reaudit \
  -H "Content-Type: application/json" \
  -d '{"secret":"blanding2026","schools":["mit.edu","stanford.edu"]}'
```

### Export full leaderboard
```bash
curl https://blandingaudit.netlify.app/.netlify/functions/leaderboard -o leaderboard.json
```

## Scraping Details

**Engine:** Cheerio (server-side HTML parsing)
**No browser rendering.** Sites that rely heavily on client-side JS will yield minimal content.

**What gets scraped:**
1. Homepage (always)
2. Up to 3 sub-pages (auto-detected: about, academics, admissions)
3. Extracted: body text, H1 tags, H2 tags, meta description

**Thresholds:**
- `MIN_BODY_CHARS = 200` — below this, page marked as empty/partial
- Word count < 400 with <= 1 page: triggers "limited content detected" warning
- Word count < 30: triggers empty content fallback prompt

**Scrape quality tags:** "full", "partial", "empty"
**No AI scraping fallback.** Removed to prevent content fabrication.

## Rate Limiting

- Analyze endpoint: 30 requests/minute/IP (in-memory, resets on cold start)
- Anthropic API: subject to account spending limits
- Current Anthropic monthly limit: $100

## Known Technical Issues

1. **Netlify Blobs pagination:** Large leaderboard responses can be slow. No pagination implemented yet.
2. **Cold start delays:** First request after idle period takes longer (Netlify function spin-up + API latency).
3. **JavaScript-heavy sites:** Cheerio can't render JS. Schools using React/Angular/Vue for content rendering get poor scrapes.
4. **clicheBreakdown field:** Mostly null in stored data. Use `topCliches` array for reliable cliché data.
5. **Georgetown/Scripps:** Timed out during batch re-audit. May have stale scores.

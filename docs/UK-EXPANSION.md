# Blanding UK Edition — Expansion Plan

**Last updated:** 2026-03-10
**Status:** Planning (volunteer brief sent)

## Decision

Build a separate instance of Blanding for UK higher education (.ac.uk domains). Not a feature flag on the US version. The markets are different enough that a fork is cleaner.

## Why Separate

1. UK cliché patterns are different ("Russell Group," "employability," "globally recognised" vs. US "world-class," "transformative," "commitment to")
2. Institutional terminology differs (TEF, REF, UCAS, clearing vs. US accreditation language)
3. Page structures may differ (UK prospectus pages vs. US admissions funnels)
4. Scoring calibration needs its own test cases
5. Leaderboard should be region-specific for meaningful comparison

## What Needs to Change (Code)

| Component | US Version | UK Version Needs |
|-----------|-----------|-----------------|
| `constants.js` CLICHES array | 160+ US phrases | New UK-specific phrase list |
| `constants.js` CLICHE_SEVERITY | US severity tiers | UK severity tiers |
| `api.js` AI prompt | US-focused rubric | UK-adapted rubric (REF/TEF context, Russell Group awareness) |
| `api.js` URL validation | .edu only | .ac.uk only |
| `scoring.js` | Same algorithm works | May need recalibration after initial UK data |
| Leaderboard | Shared Netlify Blob store | Separate store or namespace |
| UI copy | US-oriented examples | UK examples, terminology |

## What Stays the Same

- Architecture (React + Vite + Netlify Functions)
- Scraping approach (Cheerio, same logic)
- Scoring algorithm structure (mechanical + AI blend)
- PDF report generation
- Lead capture
- Admin tools

## Volunteer Contributions Needed

See `uk-volunteer-brief.md` in the repo root for the full brief sent to UK volunteers.

Summary of what we're asking for:
1. **UK cliché list** — the most critical piece. Phrases they've seen so many times they've lost meaning.
2. **Institutional vs. marketing language** — help draw the line between real designations (TEF Gold) and marketing filler ("research-intensive environment")
3. **Page structure** — what pages do UK prospective undergrads actually read?
4. **Calibration schools** — 5 "actually distinctive" and 5 "generic paste job" UK universities
5. **Examples of good copy** — what does authentic UK university language look like?

**Timeline:** 2 weeks for volunteer input, then build.

## Open Questions

- Separate domain (blandinaudit.co.uk? ukblanding.netlify.app?) or subdirectory?
- Shared admin dashboard or fully separate?
- Should scores be comparable across US/UK or region-relative only?
- How to handle UK universities with .com domains (some exist)?
- Will the AI prompt need Russell Group / post-92 / specialist institution awareness for fair scoring?

## Next Steps

1. Collect volunteer input (2-week window)
2. Build UK cliché database from volunteer data
3. Fork codebase or create region config
4. Adapt AI prompt for UK context
5. Seed with 20-30 UK schools for calibration
6. Validate scoring against volunteer calibration schools
7. Launch beta to volunteers for testing

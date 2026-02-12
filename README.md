# The Blanding Detector — Higher Ed Edition
### A brand audit tool by adeo

AI-powered tool that audits higher ed websites for generic language, cookie-cutter navigation, and institutional sameness.

## Features
- **URL Audit**: Enter any .edu URL, scans homepage + discovers sub-pages
- **Head-to-Head**: Compare two institutions side by side
- **Paste Text**: Analyze copy directly
- **Highlighted Text**: See every cliché marked in red in your actual copy
- **Prescriptions**: Specific fixes for language, IA, strategy, and UX
- **PDF Export**: Branded adeo report with email capture gate
- **LinkedIn Share**: Pre-written post with score, ready to copy

## Deploy to Netlify (15 minutes)

### Option A: GitHub + Netlify (recommended)

1. **Push to GitHub**
   ```bash
   cd blanding-detector
   git init
   git add .
   git commit -m "Blanding Detector v3"
   # Create repo on GitHub, then:
   git remote add origin https://github.com/YOUR-ORG/blanding-detector.git
   git push -u origin main
   ```

2. **Connect to Netlify**
   - Go to [app.netlify.com](https://app.netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Select your GitHub repo
   - Build settings should auto-detect:
     - Build command: `npm run build`
     - Publish directory: `dist`
   - Click "Deploy"

3. **Add your API key**
   - In Netlify: Site Settings → Environment Variables
   - Add: `ANTHROPIC_API_KEY` = your key from console.anthropic.com
   - Trigger a redeploy

4. **Custom domain** (optional)
   - Site Settings → Domain Management → Add custom domain
   - Suggested: `blanding.helloadeo.com` or `tools.helloadeo.com`

### Option B: Direct upload (no GitHub)

1. **Build locally**
   ```bash
   cd blanding-detector
   npm install
   npm run build
   ```

2. **Upload to Netlify**
   - Go to [app.netlify.com/drop](https://app.netlify.com/drop)
   - Drag the entire `blanding-detector` folder (NOT just dist — Netlify needs the functions too)
   - ⚠️ For functions to work with direct upload, you may need to use the Netlify CLI instead:
     ```bash
     npm install -g netlify-cli
     netlify deploy --prod
     ```

3. **Add API key** (same as Option A, step 3)

## Email Capture / Lead Gen

The PDF export shows an email gate modal. Leads are currently logged to the Netlify Functions console (visible in your Netlify dashboard → Functions → capture-lead → logs).

To connect to your email service, edit `netlify/functions/capture-lead.js` — there are pre-built integrations for:
- **Mailchimp** (uncomment and add `MAILCHIMP_API_KEY` + `MAILCHIMP_LIST_ID`)
- **HubSpot** (uncomment and add `HUBSPOT_API_KEY`)

Or add any other service — it's just a POST request.

## Local Development

```bash
npm install
npm run dev
```

Note: In local dev, API calls go to `/.netlify/functions/analyze` which won't work without `netlify dev`. To test locally with Netlify functions:

```bash
npm install -g netlify-cli
netlify dev
```

This runs both the Vite dev server and the serverless functions.

## Cost Estimate

Each full URL audit makes ~5-8 Claude API calls (homepage fetch, sub-page fetches, deep analysis). At Sonnet pricing, that's roughly $0.05-0.10 per audit. Budget ~$50/month for 500-1000 audits.

## File Structure

```
blanding-detector/
├── index.html              ← Entry point
├── netlify.toml            ← Netlify config
├── package.json
├── vite.config.js
├── netlify/
│   └── functions/
│       ├── analyze.js      ← Claude API proxy (keeps key secure)
│       └── capture-lead.js ← Email capture endpoint
└── src/
    ├── main.jsx            ← React entry
    ├── App.jsx             ← Main app component
    ├── api.js              ← API layer
    ├── constants.js        ← Cliché database, scoring, tokens
    └── pdf.js              ← PDF report generator
```

## Built by adeo
Strategic communications for higher ed, cannabis, cultural institutions, and political campaigns.
→ helloadeo.com

# ConnectGo Governance Dashboard

Live compliance dashboard — pulls real-time data from Notion via the Anthropic API.

---

## Instructions for Sam

### Step 1 — Get an Anthropic API key

1. Go to https://console.anthropic.com
2. Sign in (or create an account under Kate's email)
3. Go to **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-…`) — you only see it once
5. Set a **spend limit** under Billing → Usage limits (£10/month is plenty)

---

### Step 2 — Deploy to Netlify

**Option A — Drag and drop (simplest)**

1. Run `npm install` then `npm run build` in this folder
2. Go to https://netlify.com → **Add new site** → **Deploy manually**
3. Drag the `dist/` folder into the Netlify deploy box
4. Go to **Site Settings → Environment Variables → Add variable**:
   - Key: `VITE_ANTHROPIC_API_KEY`
   - Value: the key from Step 1
5. Go to **Deploys → Trigger deploy** to rebuild with the key active

**Option B — GitHub (recommended for future updates)**

1. Push this folder to a **private** GitHub repo
2. Go to https://netlify.com → **Add new site** → **Import from Git**
3. Select the repo
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Under **Environment Variables**, add `VITE_ANTHROPIC_API_KEY`
7. Deploy

---

### Step 3 — Embed in Notion

1. Copy the Netlify URL (e.g. `https://connectgo-dashboard.netlify.app`)
2. In the Compliance Hub Notion page, type `/embed`
3. Paste the URL
4. Resize the embed block to fill the page width

---

### How it works

Each time the dashboard loads, it fires three queries to Notion (Risk Register, Controls Register, Governance Tracker) via the Anthropic API. The ↻ Sync button re-fetches manually. Data is never cached — always live from Notion.

---

### Security notes

- The API key is exposed client-side. This is acceptable for an internal tool.
- Keep the Netlify site on a private URL (don't publicise it).
- The spend limit on the Anthropic key caps any exposure.
- For extra protection, Netlify Pro allows password-protecting the site.

---

### Local development

```bash
npm install
cp .env.example .env.local
# Add your API key to .env.local
npm run dev
```

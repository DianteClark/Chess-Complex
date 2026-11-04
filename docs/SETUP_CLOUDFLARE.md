# Putting Chess Complex on Cloudflare (17.0)

One Cloudflare Worker serves the game (static files from the repo root) and the cloud server (online rooms,
cloud saves, leaderboards, replays, stats). Cloudflare redeploys automatically on every push to `main`.

## 1. Connect GitHub (required, ~3 minutes)
1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository**.
2. Connect GitHub; allow access to **DianteClark/Chess-Complex**.
3. Settings:
   - Project name: **chess-complex** (must match `server/wrangler.jsonc`)
   - Production branch: **main**
   - Root directory: **server**
   - Build command: *(leave empty)*
   - Deploy command: **npx wrangler deploy**
4. **Deploy.** You get `https://chess-complex.<your-subdomain>.workers.dev`. That is the game's new home.
5. Tell the lead (A0) the address: it goes into `CLOUD_DEFAULT` (js/cloud.js) and `CLOUD_HOME` (js/cloudsave.js) so
   the GitHub Pages copy can use the server and offer players the one-tap move with their progress.

Created automatically on first deploy, nothing to click: Durable Objects (rooms, players, leaderboards, replays,
stats), Analytics Engine dataset, Workers AI, rate limits, the daily + weekly schedules.

## 2. Admin stats page (optional, 1 minute)
Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `ADMIN_KEY`, value: a long password.
Open `https://chess-complex.<sub>.workers.dev/admin?key=<password>` once on your phone; it stays signed in.
(Without `ADMIN_KEY`, /admin doesn't exist.)

## 3. Voice relay (optional, 2 minutes)
Dashboard → **Realtime** → **TURN Server** → **Create TURN key**. Copy the Key ID and API token, then add two Worker
secrets: `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. (Without them voice uses the free public relay.)

## 4. Bot check for new players (optional, 2 minutes)
Dashboard → **Turnstile** → **Add widget** → hostnames `chess-complex.<sub>.workers.dev` and `dianteclark.github.io`,
mode **Managed**. Add the **Site Key** as a plain-text variable `TURNSTILE_SITE_KEY` and the **Secret Key** as a
secret `TURNSTILE_SECRET`. (Dashboard variables survive deploys: `keep_vars` is on.)

## 5. Optional extras
- **Cloudflare Access** in front of `/admin` (Zero Trust → Access → Applications → self-hosted, path `/admin*`,
  allow your email) for a second lock.
- **Custom domain** later: Worker → Settings → Domains & Routes.

## Free plan budget (daily, resets 00:00 UTC)
100,000 Worker/Durable Object requests and 13,000 GB-s of Durable Object time: roughly 150-250 full online
matches a day. Solo play never touches the server. If a limit is hit, that feature errors until reset (no bill).
Workers Paid ($5/month) removes the daily caps.

## Local development
`cd server && npm install && npm run dev` serves the game and API at http://localhost:8787/ (`--local`: the AI
binding is remote-only, so moderation falls back to the word filter locally).

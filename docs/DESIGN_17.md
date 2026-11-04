# Chess Complex 17.0 "Cloud" — platform features (lead spec, A0)

Builds on docs/DESIGN_SERVER.md (rooms, lockstep, cloud saves, transfer codes). 17.0 also moves hosting onto the
same Worker and adds the free Cloudflare features below. Everything must work with zero dashboard setup; features
that need a secret (TURN, Turnstile, admin key) degrade gracefully when the secret is missing.

## Wiring (done by A0, don't restructure)
- `server/wrangler.jsonc`: assets = repo root (`.assetsignore` keeps server/tests/tools/docs out), DO classes Room,
  Player, Board, Replay, Stats (SQLite), `AE` Analytics Engine dataset `cc_matches`, `AI` Workers AI, rate limits
  `RL_NEW` (20/60 s) and `RL_API` (240/60 s), crons `5 0 * * *` (daily) and `10 0 * * 1` (weekly), var
  `TURNSTILE_SITE_KEY`. Secrets (optional): `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`, `TURNSTILE_SECRET`, `ADMIN_KEY`.
- `server/src/worker.js`: `/health`, `/room`, `/ws/room/:code`, `/player/*` (S1/P), then each module's
  `routes(req, env, url, ctx)` in order platform, board, replay, stats; `scheduled` -> `board.scheduled`.
- Static files: any request matching a file is served without invoking the Worker (free, unlimited). API paths must
  not collide with files: use `/turn`, `/cfg`, `/lb/*`, `/replay/*`, `/admin*`, `/stats/*`.
- Local: `cd server && npx wrangler dev --port <yours>` serves the game AND the API on one origin
  (open http://localhost:<port>/ ; the client should treat same-origin as the cloud endpoint automatically).
  Ports: N2 8787, S2 8788, L2 8789, RP 8790, A 8791, P 8797. Static-only dev servers: 8123, 8141.
- AI and Analytics Engine don't run fully in local dev: guard every call (try/catch, feature-detect) and fall back.

## Match-end hook (S2 adds to the Room, others consume)
Room records each match: `start` args (the exact createMatch inputs), the accepted action list `[ [pid, a], ... ]`
(bots/timeouts included, in order), human seats `{seat pid -> {name, cid}}`, mode, location, result (places, winner,
rounds). At match end Room calls `server/src/hooks.js` `matchEnded(env, ctx, rec)` (S2 writes hooks.js), which
fans out with `ctx.waitUntil` and never throws: `stats.record(env, rec)` (A), `board.rate(env, rec)` (L2),
`replay.save(env, rec)` -> replay id returned to clients in the over/lobby message (RP), `platform.track(env, rec)`
(S2, Analytics Engine: one data point per human). Size cap for rec: 200 KB.

## Identity on the server (N2 + P + L2)
`hello` gains `cid` (cloud player id) and `cproof` = the player's cloud secret (TLS; never logged). Room verifies once
per connection via the Player DO (P adds an internal `verify(id, secret)` RPC/route) and marks the seat `verified`.
Only verified human seats count for ratings/leaderboards. Public profile fields for boards: name, avatar, title.

## Features and owners
- **S2 platform** (`platform.js`, Room/core changes, `hooks.js`, `js/voice.js` ICE wiring):
  `/turn` mints Cloudflare TURN ICE servers (TTL 6 h) when secrets exist, else returns today's public STUN/TURN list;
  `/cfg` returns `{turnstileSiteKey, features}`; Workers AI moderation for custom chat phrases (Llama Guard via
  `env.AI`, verdict cached per phrase hash in the Room/DO storage, word filter fallback, daily budget guard ~1,500
  checks); rate limits on `/player/new` (RL_NEW per IP) and API routes (RL_API per IP/cid); Turnstile verification
  helper for `/player/new` (only when `TURNSTILE_SECRET` is set); Analytics Engine `track()`; Room location hints
  from `request.cf.continent` when a room is created; record + hook as above.
- **L2 leaderboards** (`board.js` Board DO + client UI): online **Crown Rating** (multiplayer Elo-style from
  placements, verified humans only, provisional for first 10 games), weekly season boards (reset Monday cron, keep
  last season's top 100), **Daily Challenge** (seed/build/location per UTC day set by cron or derived from date;
  client submits its local run `{day, actions}`; Board verifies by replaying the deterministic engine in chunks across
  alarms — never more than ~5 ms CPU per invocation — then posts the score), `/lb/*` routes, a Leaderboards screen
  (Season, Crown Rating, Daily) and your rank on the profile/results screens.
- **RP replays** (`replay.js` Replay DO + client): store online match records (30-day expiry via alarm, cap 200 KB),
  `/replay/:id`, share button on results (Web Share API / copy link `?replay=ID`), a replay viewer that plays the match
  through the normal renderer (play/pause, 1x/2x/4x, jump to round, restart; seeking = re-simulate from start), and
  Play of the Match for online matches computed from the record. Solo matches may also be uploaded on share.
- **A stats + admin** (`stats.js` Stats DO + `/admin`): aggregate per day/week (by mode, location, bot road / final
  piece win rates, King win rate, preset/passive win rates, ability pick + win rates, average rounds, match counts,
  disconnects), `/admin` HTML dashboard (served by the Worker, gated by `ADMIN_KEY` via `Authorization` or a
  cookie set from `/admin?key=`; refuse everything when the secret is unset), CSV export. Optional Cloudflare Access
  in front (setup doc).
- **P migration + Turnstile client** (resume): Turnstile widget on first cloud player creation when `/cfg` has a site
  key (load the script only then; offline-safe), and the move from GitHub Pages: on `dianteclark.github.io`, once the
  cloud save is current, show a one-time "Chess Complex has a new home" card that opens the Cloudflare URL with the
  transfer code in the URL fragment (`#transfer=`), which the new site applies automatically (no confirm needed when
  the new site has no progress yet; confirm otherwise). CLOUD_HOME constant (lead fills the URL).
- **N2 client cloud mode** (in progress): same-origin detection (when served by the Worker, the cloud endpoint is
  `location.origin`), plus `cid/cproof` in hello.

## Hard rules
docs/V10_BRIEF.md: Edit tool only on shared files, never git checkout/reset/stash/commit/push, notes in
docs/V10_NOTES.md prefixed with your code. Keep every test suite green. 390x844 and 844x390, 11 px text, 40 px targets.

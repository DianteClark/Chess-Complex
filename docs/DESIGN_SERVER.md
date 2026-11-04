# Chess Complex cloud server (lead spec, A0) — "17.0 Cloud"

Goal: online matches and parties run on Cloudflare (Workers + Durable Objects, free plan), not on a player's phone;
player data saves to the cloud automatically with no sign-up; transfer codes move a player to a new phone. Phone-hosted
PeerJS play stays as an automatic fallback. Everything must be lean enough to live comfortably inside the free plan.

## Free plan budget (design to these)
- Workers: 100k requests/day, 10 ms CPU per request. Durable Objects (SQLite backend only on free): 13,000 GB-s/day
  duration (about 28 h of awake 128 MB objects), 5 GB storage per account. WebSocket messages to a DO are billed as
  requests at 20:1. Use the **WebSocket Hibernation API** (`state.acceptWebSocket`, `webSocketMessage`, alarms) so idle
  rooms cost nothing, and **alarms** (not setTimeout) for turn clocks and bot pacing so a hibernated room still wakes.
- Measure CPU per message (engine applyAction + planBot) in `wrangler dev`; if any single step can exceed ~8 ms on
  an 8-bot Royale, split work across alarms. Report the numbers.

## Layout (repo)
```
server/
  wrangler.jsonc          name "chess-complex", main src/worker.js, durable_objects: Room, Player (SQLite classes,
                          migrations new_sqlite_classes), compatibility_date current, no secrets required
  src/worker.js           router: GET /health, GET /ws/room/:code (upgrade -> Room DO idFromName(code)),
                          POST /room (create, returns a free 5-char code), /player/* (-> Player DO), CORS for
                          https://dianteclark.github.io and http://localhost:*
  src/room.js             Room DO: lobby + party + match, authoritative engine (imports ../../js/engine.js, data.js)
  src/player.js           Player DO: one per player id, SQLite row with the profile blob + secret + updatedAt
  package.json            wrangler devDependency, scripts dev/deploy/test
  test/                   node tests against `wrangler dev` (protocol, reconnect, CPU timing, profile/transfer)
```
Workers Builds will deploy from the repo with root directory `server`, so imports of `../js/*.js` must bundle (esbuild
follows relative imports outside the root; verify with `wrangler deploy --dry-run --outdir /tmp/x`).

## Match protocol (JSON over one WebSocket per client)
Lockstep with server authority: the server runs the engine; clients run the same deterministic engine and replay the
server's accepted actions, so a turn costs ~100 bytes instead of a 5-20 KB state.
- client -> server: `{t:'hello', pid, name, profile:{avatar,title,skin,...}, ver, resume?:{mid}}`,
  `{t:'act', a, n}` (n = client's s.v it acted on), `{t:'chat', ...}` (same shape as today), `{t:'vc', ...}` (voice
  signaling relay, same shape as today), lobby/party commands mirroring today's host UI: `{t:'ready', on}`,
  `{t:'lead', op:'add-bot'|'kick'|'mode'|'location'|'custom'|'start'|'fill-bots', ...}`, `{t:'back'}`, `{t:'leave'}`,
  `{t:'bl', ms}` (playback backlog, sent at most 2/s while > 0; bots wait for the slowest human, cap 3 s, same rule as
  15.2's NET.backlog), `{t:'hb'}` every 5 s.
- server -> client: `{t:'welcome', pid, room, leader}`, `{t:'lobby', ...}` (same shape main.js renders today),
  `{t:'start', mid, seed, players, opts, introMs}` (client calls createMatch with the same args -> identical state),
  `{t:'a', v, pid, a, dl}` (one accepted action incl. bots/timeouts; client applies it with applyAction and feeds the
  resulting state+events into the existing 'state' handler; dl = turn deadline ms), `{t:'h', v, x}` every 8 actions
  (x = 32-bit hash of the state; mismatch -> client sends `{t:'sync'}` and gets `{t:'snap', v, state}`),
  `{t:'snap', ...}` also on join/resume, `{t:'over', ...}`, chat/vc relays, `{t:'part', ...}`, `{t:'bye', why}`.
- Determinism contract: same engine version on both ends (`ver` = build hash/version string; mismatch -> server
  answers `{t:'bye', why:'update'}` and the client reloads to update). Server and clients must never mutate state
  outside applyAction/nextTurn; timeouts are an `{type:'end'}` action applied by the server and broadcast.
- Rooms: code = 5 chars (same alphabet as today). Leader = first human; leadership passes on leave. Room DO keeps the
  party between matches. A dropped client has 60 s to resume (`hello` with resume) while a bot holds the seat (today's
  rule). Empty rooms: alarm deletes storage after 10 min.

## Player data + transfer codes (no sign-up)
- First launch: client calls `POST /player/new` -> `{id, secret}` (id 10 chars, secret 16 chars, crypto random);
  stored in localStorage. Every save (debounced 5 s, and on match end / app hide) `PUT /player/:id` with
  `Authorization: Bearer <secret>` and the profile JSON (gzip via CompressionStream when available; cap 64 KB).
  Merge rule: server keeps the blob with the higher `rev`; on conflict, the client merges currencies/unlocks as
  max/union and re-saves.
- Transfer code = `id + secret` encoded as `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (Crockford base32, 26 chars + dashes),
  shown in Settings with a QR code (generate locally, no network). Entering it on another phone loads that player
  (the old phone keeps working too). "Reset code" rotates the secret.
- Rate limit per IP in the Worker for /player/new (e.g. 20/h) and per id for PUT (1 per 2 s).

## Client
- `js/cloud.js`: endpoint config (`CLOUD_URL`, default the workers.dev URL once known; `?cloud=http://localhost:8787`
  overrides; `?cloud=off` forces PeerJS), health check with 1.5 s timeout, then the WebSocket transport with
  reconnect/backoff and the same heartbeat/backlog behaviour as net.js.
- `js/cloudsave.js`: player id/secret, save/load/merge, transfer code encode/decode, QR.
- main.js: Host/Join use the cloud room when healthy, else today's PeerJS path unchanged. In cloud mode every device
  is a client; leader-only buttons send `{t:'lead'}`. Solo play stays fully local (no server).
- Settings: "Cloud save" row (status: Saved / Offline), "Transfer code" (show / copy / QR / enter code / reset).

## Tests
- server/test: protocol + determinism (server state hash == client state hash after 300 actions of an 8-bot Royale,
  Siege, Squads), reconnect/resume, leader handoff, CPU timing per message, hibernation-safe alarms, profile/transfer.
- tests/online/: run the existing scenarios against `wrangler dev` (`?cloud=http://localhost:8787`) as well as
  `?net=local`; both must pass.

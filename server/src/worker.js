// 17.0 (S1): Chess Complex cloud Worker. Routes:
//   GET  /health              -> {ok, ver}   (ver = protocol + engine fingerprint the client must match)
//   POST /room                -> {code}      (a free 5-char room code; the Room DO is reserved for 10 min)
//   GET  /ws/room/:code       -> WebSocket upgrade, forwarded to the Room DO idFromName(code)
//   *    /player/...          -> P's handlePlayer (server/src/player.js)
// CORS: https://dianteclark.github.io and http://localhost:* / http://127.0.0.1:*.
import { Room } from './room.js';
import { Player, handlePlayer } from './player.js';
import { protoVer } from '../../js/statehash.js';
// 17.0 (A0): one module per owner; each routes() returns a Response for its paths or null
import * as platform from './platform.js'; // S2: /turn, /cfg, moderation + Turnstile + analytics helpers
import * as board from './board.js';       // L2: /lb/* leaderboards, daily challenge, seasons (Board DO, crons)
import * as replay from './replay.js';     // RP: /replay/* shared replays (Replay DO)
import * as stats from './stats.js';       // A: /admin, /stats/* aggregate match stats (Stats DO)
import { Board } from './board.js';
import { Replay } from './replay.js';
import { Stats } from './stats.js';

export { Room, Player, Board, Replay, Stats };

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const makeCode = () => { const b = crypto.getRandomValues(new Uint8Array(5)); return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join(''); };

function allowOrigin(o) {
  if (!o) return null;
  if (o === 'https://dianteclark.github.io') return o;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
  return null;
}
function cors(req, res) {
  const o = allowOrigin(req.headers.get('Origin'));
  if (!o) return res;
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', o);
  h.set('Vary', 'Origin');
  h.set('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Content-Encoding');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default {
  async scheduled(event, env, ctx) { await board.scheduled(event, env, ctx); }, // 17.0: daily challenge + weekly season rollover
  async fetch(req, env, ctx) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === 'OPTIONS') return cors(req, new Response(null, { status: 204 }));
    try {
      if (path === '/health') return cors(req, json({ ok: true, ver: protoVer() }));
      { const lim = await platform.limit(req, env, url); if (lim) return cors(req, lim); } // 17.0 (S2): RL_API per IP / cid
      if (path === '/room' && req.method === 'POST') {
        for (let i = 0; i < 6; i++) {
          const code = makeCode();
          const stub = platform.roomStub(env, env.ROOM.idFromName(code), req); // 17.0 (S2): locationHint from request.cf
          const r = await stub.fetch(new Request('https://room/init?code=' + code, { method: 'POST' }));
          if (r.status === 200) return cors(req, json({ code }));
        }
        return cors(req, json({ error: 'busy' }, 503));
      }
      const m = path.match(/^\/ws\/room\/([A-Za-z0-9]{5})$/);
      if (m) {
        const code = m[1].toUpperCase();
        if (!CODE_RE.test(code)) return cors(req, json({ error: 'bad code' }, 404));
        if (req.headers.get('Upgrade') !== 'websocket') return cors(req, json({ error: 'expected websocket' }, 426));
        // Browsers send Origin on WebSocket upgrades: refuse other sites (non-browser clients send none)
        const o = req.headers.get('Origin');
        if (o && !allowOrigin(o) && o !== url.origin) return json({ error: 'origin' }, 403); // 17.0 (S2): same origin = the Worker-served game
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const u = new URL(req.url); u.searchParams.set('code', code);
        return stub.fetch(new Request(u.toString(), req));
      }
      if (path === '/player' || path.startsWith('/player/')) {
        const ip = req.headers.get('CF-Connecting-IP') || 'local';
        return cors(req, await handlePlayer(req, env, ip));
      }
      for (const mod of [platform, board, replay, stats]) { const r = await mod.routes(req, env, url, ctx); if (r) return cors(req, r); }
      return cors(req, json({ error: 'not found' }, 404));
    } catch (e) {
      return cors(req, json({ error: 'server', msg: String(e && e.message || e).slice(0, 200) }, 500));
    }
  },
};

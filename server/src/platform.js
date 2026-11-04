// 17.0 (S2): platform helpers for the cloud Worker. Owned by S2. See docs/DESIGN_17.md "S2 platform".
//   GET /turn    -> {iceServers, ttl, src}  Cloudflare TURN credentials (TTL 6 h) when TURN_KEY_ID + TURN_KEY_API_TOKEN
//                                           are set, else today's public STUN/TURN list (js/net.js PEER_OPTS)
//   GET /cfg     -> {turnstileSiteKey, features, ver}
// Helpers used by other modules: limit() (RL_API per IP / cid), verifyTurnstile() (P's /player/new), moderate()
// (Workers AI Llama Guard for custom chat phrases, called by the Room through the '_mod' instance), track()
// (Analytics Engine, one data point per human seat), locationHint() (Room placement from request.cf).
// Everything is guarded: local `wrangler dev` has no AI, no Analytics Engine writes and no secrets, and every helper
// then falls back without throwing. This module must stay importable without cloudflare:workers (Node tests).
import { PEER_OPTS } from '../../js/net.js';
import { protoVer } from '../../js/statehash.js';
import { clean } from '../../js/chat.js';

const json = (o, status = 200, extra) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extra || {}) } });
const ip = (req) => req.headers.get('CF-Connecting-IP') || 'local';
const yes = (v) => !!v && v !== '0' && v !== 'false';

export async function routes(req, env, url, ctx) {
  const p = url.pathname;
  if (p === '/turn') return req.method === 'GET' || req.method === 'POST' ? json(await iceServers(env, ctx)) : json({ error: 'method' }, 405);
  if (p === '/cfg') return json(cfg(env), 200, { 'Cache-Control': 'public, max-age=300' });
  return null;
}

// ---------------------------------------------------------------- /cfg
export function features(env) {
  return {
    cloud: true,
    turn: !!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN),
    turnstile: !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET),
    moderation: !!(env.AI && typeof env.AI.run === 'function') || yes(env.MOD_FAKE),
    analytics: !!(env.AE && typeof env.AE.writeDataPoint === 'function'),
    boards: !!env.BOARD, replays: !!env.REPLAY, stats: !!env.STATS,
  };
}
export function cfg(env) {
  // the site key only matters when the secret is there too (else /player/new never asks for a token)
  const key = env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET ? String(env.TURNSTILE_SITE_KEY) : '';
  return { turnstileSiteKey: key, features: features(env), ver: protoVer() };
}

// ---------------------------------------------------------------- /turn
export const PUBLIC_ICE = PEER_OPTS.config.iceServers;
export const TURN_TTL = 21600; // 6 h
const TURN_REUSE = 3600 * 1000; // hand out the same credentials for 1 h (they still have >= 5 h left)
const iceMem = { at: 0, v: null };
export async function iceServers(env, ctx) {
  const pub = { iceServers: PUBLIC_ICE, ttl: 86400, src: 'public' };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return pub;
  const now = Date.now();
  if (iceMem.v && now - iceMem.at < TURN_REUSE) return iceMem.v;
  const cacheKey = 'https://cc-internal/turn/' + encodeURIComponent(String(env.TURN_KEY_ID));
  let cache = null; try { cache = typeof caches !== 'undefined' ? caches.default : null; } catch {}
  if (cache) {
    try { const hit = await cache.match(cacheKey); if (hit) { const v = await hit.json(); if (v && now - v.at < TURN_REUSE) { iceMem.at = v.at; iceMem.v = v.out; return v.out; } } } catch {}
  }
  try {
    const base = (env.TURN_API || 'https://rtc.live.cloudflare.com').replace(/\/+$/, '');
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 3000);
    const r = await fetch(`${base}/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST', signal: ac.signal,
      headers: { Authorization: 'Bearer ' + env.TURN_KEY_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL }),
    }).finally(() => clearTimeout(to));
    if (!r.ok) return { ...pub, err: 'turn ' + r.status };
    const j = await r.json();
    // generate-ice-servers answers {iceServers: [...]}; the older /generate answered {iceServers: {urls, username, credential}}
    let list = j && j.iceServers; if (list && !Array.isArray(list)) list = [list];
    list = (list || []).filter((s) => s && (typeof s.urls === 'string' || Array.isArray(s.urls)));
    if (!list.length) return { ...pub, err: 'turn empty' };
    // keep a public STUN as well: it costs nothing and helps when the relay is slow to answer
    const out = { iceServers: [...list, PUBLIC_ICE[0]], ttl: TURN_TTL - TURN_REUSE / 1000, src: 'cf' };
    iceMem.at = now; iceMem.v = out;
    if (cache) {
      const put = cache.put(cacheKey, new Response(JSON.stringify({ at: now, out }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' } })).catch(() => {});
      if (ctx && ctx.waitUntil) ctx.waitUntil(put);
    }
    return out;
  } catch (e) { return { ...pub, err: 'turn ' + (e && e.name === 'AbortError' ? 'timeout' : 'error') }; }
}
export function _resetIce() { iceMem.at = 0; iceMem.v = null; } // tests

// ---------------------------------------------------------------- rate limits
// RL_API (240 / 60 s) per IP, or per cloud player id on /player/:id. /health and WebSocket upgrades are free (room
// traffic is limited inside the Room); /player/new has its own RL_NEW + hourly limiter in player.js (P).
const FREE = /^\/(health|ws\/)/;
export async function limit(req, env, url) {
  const rl = env.RL_API; if (!rl || typeof rl.limit !== 'function' || req.method === 'OPTIONS') return null;
  const p = url.pathname; if (FREE.test(p) || p === '/player/new') return null;
  const m = /^\/player\/([0-9A-Za-z]{10})(\/|$)/.exec(p);
  const key = m ? 'id:' + m[1].toUpperCase() : 'ip:' + ip(req);
  try { const { success } = await rl.limit({ key }); if (success) return null; } catch { return null; }
  return json({ error: 'slow down', retry: 60 }, 429, { 'Retry-After': '60' });
}

// ---------------------------------------------------------------- Turnstile (P's /player/new)
export async function verifyTurnstile(env, token, remoteip) {
  if (!env.TURNSTILE_SECRET) return true; // not configured: nothing to check
  if (typeof token !== 'string' || !token || token.length > 4096) return false;
  try {
    const body = new FormData(); body.append('secret', env.TURNSTILE_SECRET); body.append('response', token);
    if (remoteip && remoteip !== 'local') body.append('remoteip', remoteip);
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: ac.signal }).finally(() => clearTimeout(to));
    const j = await r.json();
    return !!(j && j.success === true);
  } catch { return false; } // fail closed when the secret is set
}

// ---------------------------------------------------------------- moderation (custom chat phrases)
// Text arrives already cleaned and word-filtered by chat.js (hostCheck -> clean/mask): that filter is the fallback.
// Llama Guard runs on top when env.AI exists; verdicts are cached per phrase hash; a daily budget caps model calls.
export const MOD = { model: '@cf/meta/llama-guard-3-8b', budget: 1500, timeout: 2500, cacheDays: 30 };
export const modKey = (text) => String(text || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
export async function phraseHash(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cc-mod:' + modKey(text))));
  return [...d.slice(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
// Llama Guard's answer comes in a few shapes depending on the model version / binding
export function parseGuard(r) {
  if (!r) return null;
  const v = r.response !== undefined ? r.response : r.result !== undefined ? r.result : r;
  if (v && typeof v === 'object') {
    if (typeof v.safe === 'boolean') return v.safe;
    if (typeof v.response === 'string') return parseGuard(v.response);
  }
  if (typeof v === 'string') { const t = v.trim().toLowerCase(); if (t.startsWith('unsafe')) return false; if (t.startsWith('safe')) return true; }
  return null;
}
async function runModel(env, text) {
  if (yes(env.MOD_FAKE)) { // tests: a deterministic stand-in for the model (no network)
    await new Promise((r) => setTimeout(r, 30));
    if (/fakefail/i.test(text)) throw new Error('fake model down');
    return { response: { safe: !/unsafe|nasty/i.test(text), categories: [] } };
  }
  if (!env.AI || typeof env.AI.run !== 'function') throw new Error('no ai');
  return env.AI.run(MOD.model, { messages: [{ role: 'user', content: text }] });
}
// One verdict. store = {get(k), put(k, v)} (the '_mod' Room instance's storage): cache + daily budget live there, so
// they are shared by every room. Returns {ok, src: 'cache'|'ai'|'filter', why?}; never throws.
export async function moderate(env, text, store, now = Date.now()) {
  if (typeof text !== 'string' || !text.trim()) return { ok: true, src: 'filter' };
  const avail = yes(env.MOD_FAKE) || !!(env.AI && typeof env.AI.run === 'function');
  if (!avail || yes(env.MOD_OFF)) return { ok: true, src: 'filter', why: 'no-ai' };
  let h; try { h = await phraseHash(text); } catch { return { ok: true, src: 'filter', why: 'hash' }; }
  try { const c = store && await store.get('v:' + h); if (c && now - c.at < MOD.cacheDays * 864e5) return { ok: c.ok, src: 'cache' }; } catch {}
  const budget = Math.max(0, +env.MOD_BUDGET || MOD.budget), d = day(now);
  let B = { d, n: 0 }; try { B = (store && await store.get('budget')) || B; } catch {}
  if (B.d !== d) B = { d, n: 0 };
  if (B.n >= budget) return { ok: true, src: 'filter', why: 'budget' };
  B.n++; try { if (store) await store.put('budget', B); } catch {}
  let ok = null;
  try {
    let to; const r = await Promise.race([runModel(env, text), new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout')), MOD.timeout); })]).finally(() => clearTimeout(to));
    ok = parseGuard(r);
  } catch (e) { return { ok: true, src: 'filter', why: String(e && e.message || 'error').slice(0, 40) }; }
  if (ok === null) return { ok: true, src: 'filter', why: 'unparsed' };
  try { if (store) await store.put('v:' + h, { ok, at: now }); } catch {}
  return { ok, src: 'ai' };
}
export const cleanPhrase = clean;

// ---------------------------------------------------------------- Analytics Engine
// One data point per human seat. blobs: [mode, location, cid or '', verified, outcome, room, ver]
// doubles: [place, rounds, actions, duration s, players, bots, drops, won]  index: mode
export function track(env, rec) {
  const ae = env && env.AE; if (!ae || typeof ae.writeDataPoint !== 'function' || !rec) return 0;
  let n = 0;
  try {
    const res = rec.result || {}, places = res.places || [];
    const bots = places.filter((p) => p.bot).length;
    const dur = Math.max(0, Math.round(((rec.t1 || 0) - (rec.t0 || 0)) / 1000));
    for (const [pid, h] of Object.entries(rec.humans || {})) {
      const pl = places.find((p) => p.pid === pid) || {};
      const won = res.winner != null && pl.id === res.winner ? 1 : 0;
      try {
        ae.writeDataPoint({
          indexes: [String(rec.mode || '').slice(0, 32)],
          blobs: [rec.mode || '', rec.location || '', h.verified && h.cid ? h.cid : '', h.verified ? '1' : '0', won ? 'win' : res.siegeWon ? 'cleared' : 'loss', rec.room || '', rec.ver || ''],
          doubles: [+pl.place || 0, +res.rounds || 0, (rec.actions || []).length, dur, places.length, bots, +h.drops || 0, won],
        });
        n++;
      } catch {}
    }
  } catch {}
  return n;
}

// ---------------------------------------------------------------- Room location hints
// request.cf.continent (+ longitude / country) -> a Durable Object locationHint for the room's first get()
const ME = new Set(['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IL', 'JO', 'LB', 'IQ', 'IR', 'YE', 'SY', 'TR']);
export function locationHint(cf) {
  if (!cf || typeof cf !== 'object') return null;
  const c = cf.continent, lon = +cf.longitude, cc = cf.country;
  if (c === 'NA') return Number.isFinite(lon) && lon < -100 ? 'wnam' : 'enam';
  if (c === 'SA') return 'sam';
  if (c === 'EU') return Number.isFinite(lon) && lon > 20 ? 'eeur' : 'weur';
  if (c === 'AS') return ME.has(cc) ? 'me' : 'apac';
  if (c === 'OC') return 'oc';
  if (c === 'AF') return 'afr';
  return null;
}
export function roomStub(env, id, req) {
  const hint = locationHint(req && req.cf);
  try { if (hint) return env.ROOM.get(id, { locationHint: hint }); } catch {}
  return env.ROOM.get(id);
}

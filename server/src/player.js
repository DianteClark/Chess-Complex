// Chess Complex 17.0 Cloud (P): player data + transfer codes. No sign-up.
// One Player Durable Object (SQLite backend) per player id holds one row: the profile blob, the SHA-256 of the secret
// (never the secret itself), rev and updatedAt. A single extra instance, idFromName('_limits'), keeps the per-IP
// limiter for POST /player/new.
//
// worker.js (S1) calls handlePlayer(request, env, ip) for every path starting with /player and adds CORS itself.
//   POST /player/new            -> 201 {id, secret}                       (per IP: NEW_PER_HOUR, default 20)
//   GET  /player/:id            -> 200 {rev, updatedAt, blob}             (Authorization: Bearer <secret>)
//   PUT  /player/:id  {rev, blob} (raw or gzip, <= 64 KB on the wire, <= 512 KB inflated)
//                               -> 200 {rev, updatedAt} | 409 {rev, updatedAt, blob} when rev is not above the stored rev
//                                  (one accepted PUT per id per 2 s, else 429 {retry})
//   POST /player/:id/rotate     -> 200 {secret}                           (old secret stops working; 1 per 10 s)
// POST /player/new takes an optional JSON body {turnstile: token}: required when env.TURNSTILE_SECRET is set (403 without
// a valid one). env.RL_NEW (Workers rate limit binding) is applied per IP when present, on top of the hourly limiter.
// Internal (no route): verifyPlayer(env, id, secret) for the Room's identity check (17.0 Identity).
// Errors: 400 bad request, 401 bad or missing secret, 404 unknown id, 413 too large, 429 {retry: seconds}.
import { DurableObject } from 'cloudflare:workers';
import * as platform from './platform.js'; // S2: verifyTurnstile(env, token, ip) when it exists
import * as social from './social.js'; // 18.0 (SO): friends / tags / presence / invites, mixed into Player below

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I L O U)
export const ID_LEN = 10, SECRET_LEN = 16;
const MAX_WIRE = 64 * 1024, MAX_JSON = 512 * 1024;
const PUT_GAP = 2000, ROTATE_GAP = 10000;
const ID_RE = new RegExp(`^[${ALPHABET}]{${ID_LEN}}$`), SECRET_RE = new RegExp(`^[${ALPHABET}]{${SECRET_LEN}}$`);

export function randomCode(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = ''; for (let i = 0; i < n; i++) s += ALPHABET[b[i] & 31]; // 256 is a multiple of 32: no bias
  return s;
}
export async function sha256(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const same = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const json = (body, status = 200, extra) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extra || {}) } });
const fail = (status, error, more) => json({ error, ...(more || {}) }, status, more && more.retry ? { 'Retry-After': String(more.retry) } : undefined);

// Read the request body with a hard cap; inflate gzip (sniffed by magic bytes, so it works whether or not the platform
// already decoded Content-Encoding) with a second cap against zip bombs.
async function readBody(request) {
  const len = +request.headers.get('Content-Length');
  if (len > MAX_WIRE) return { err: 413 };
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > MAX_WIRE) return { err: 413 };
  let bytes = raw;
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      const rd = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      const parts = []; let n = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > MAX_JSON) { rd.cancel(); return { err: 413 }; } parts.push(value); }
      bytes = new Uint8Array(n); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    } catch { return { err: 400 }; }
  }
  if (bytes.length > MAX_JSON) return { err: 413 };
  try { return { body: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { return { err: 400 }; }
}
const bearer = (request) => { const m = /^Bearer\s+([0-9A-Za-z]+)\s*$/.exec(request.headers.get('Authorization') || ''); return m ? m[1].toUpperCase() : null; };

export async function handlePlayer(request, env, ip = 'local') {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['player', ...]
  if (parts[0] !== 'player' || !env.PLAYER) return fail(404, 'not found');
  const m = request.method;
  if (parts.length === 2 && parts[1] === 'new') {
    if (m !== 'POST') return fail(405, 'method');
    if (env.RL_NEW && typeof env.RL_NEW.limit === 'function') { try { const { success } = await env.RL_NEW.limit({ key: 'new:' + ip }); if (!success) return fail(429, 'slow down', { retry: 60 }); } catch {} }
    if (env.TURNSTILE_SECRET) {
      let token = ''; try { const b = await request.json(); token = b && typeof b.turnstile === 'string' ? b.turnstile : ''; } catch {}
      if (!token || token.length > 4096 || !(await turnstileOk(env, token, ip))) return fail(403, 'human check failed');
    }
    const per = Math.max(1, +env.NEW_PER_HOUR || 20);
    const lim = await env.PLAYER.get(env.PLAYER.idFromName('_limits')).hit('new:' + (await sha256('ip:' + ip)).slice(0, 20), per, 3600_000);
    if (lim > 0) return fail(429, 'slow down', { retry: lim });
    for (let i = 0; i < 4; i++) {
      const id = randomCode(ID_LEN), secret = randomCode(SECRET_LEN);
      if (await env.PLAYER.get(env.PLAYER.idFromName(id)).create(await sha256(secret))) return json({ id, secret }, 201);
    }
    return fail(500, 'try again');
  }
  if (parts[1] === '_verify' && env.PLAYER_TEST && m === 'POST') { // dev-only (wrangler dev --var PLAYER_TEST:1): exercise verifyPlayer from tests
    let b = null; try { b = await request.json(); } catch {}
    return json(await verifyPlayer(env, b && b.id, b && b.secret));
  }
  const id = (parts[1] || '').toUpperCase();
  if (!ID_RE.test(id)) return fail(404, 'unknown player');
  const secret = bearer(request);
  if (!secret || !SECRET_RE.test(secret)) return fail(401, 'bad secret');
  const hash = await sha256(secret);
  const stub = env.PLAYER.get(env.PLAYER.idFromName(id));
  if (parts.length === 2 && m === 'GET') return answer(await stub.read(hash));
  if (parts.length === 2 && m === 'PUT') {
    const { body, err } = await readBody(request);
    if (err) return fail(err, err === 413 ? 'too large' : 'bad body');
    const rev = Math.floor(+(body && body.rev));
    if (!body || typeof body !== 'object' || !Number.isFinite(rev) || rev < 1 || rev > 2 ** 31 || !body.blob || typeof body.blob !== 'object') return fail(400, 'need {rev, blob}');
    const ack = Array.isArray(body.ack) ? body.ack.filter((x) => typeof x === 'string' && x.length <= 40).slice(0, 20) : null; // 18.0 (NE): inbox items the blob now holds
    return answer(await stub.write(hash, rev, JSON.stringify(body.blob), ack));
  }
  if (parts.length === 3 && parts[2] === 'rotate' && m === 'POST') {
    const next = randomCode(SECRET_LEN);
    const r = await stub.rotate(hash, await sha256(next));
    return r.ok ? json({ secret: next }) : answer(r);
  }
  return fail(405, 'method');
}
async function turnstileOk(env, token, ip) {
  try {
    if (typeof platform.verifyTurnstile === 'function') return !!(await platform.verifyTurnstile(env, token, ip));
    const body = new FormData(); body.append('secret', env.TURNSTILE_SECRET); body.append('response', token); if (ip && ip !== 'local') body.append('remoteip', ip);
    const r = await fetch(env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const j = await r.json();
    return !!(j && j.success === true);
  } catch { return false; } // fail closed: no player without a passed check when the secret is set
}

// 17.0 Identity: the Room checks a hello's cid + cproof once per connection. Never throws; never stores or logs the secret.
export async function verifyPlayer(env, id, secret) {
  try {
    id = String(id || '').toUpperCase(); secret = String(secret || '').toUpperCase();
    if (!ID_RE.test(id) || !SECRET_RE.test(secret) || !env.PLAYER) return { ok: false, why: 'shape' };
    const r = await env.PLAYER.get(env.PLAYER.idFromName(id)).verify(await sha256(secret));
    return r && r.ok ? { ok: true, id, name: r.name, avatar: r.avatar, title: r.title } : { ok: false, why: (r && r.why) || 'bad' };
  } catch { return { ok: false, why: 'error' }; }
}
const str = (v, n) => (typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, n) : null);

function answer(r) {
  if (r.status === 200) return json(r.data);
  if (r.status === 409) return json(r.data, 409);
  if (r.status === 429) return fail(429, 'slow down', { retry: r.retry });
  return fail(r.status, r.status === 401 ? 'bad secret' : r.status === 404 ? 'unknown player' : 'error');
}

export class Player extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }
  // Tables are created on first write only, so probing an unknown id leaves no storage behind.
  has(t) { return this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t).toArray().length > 0; }
  row() { return this.has('p') ? this.sql.exec('SELECT hash, blob, rev, updatedAt, lastPut, lastRot FROM p WHERE k = 1').toArray()[0] || null : null; }
  auth(hash) { const r = this.row(); if (!r) return { status: 404 }; if (!same(r.hash, hash)) return { status: 401 }; return { r }; }
  async create(hash) {
    if (this.row()) return false; // id collision: the caller draws another id
    this.sql.exec(`CREATE TABLE IF NOT EXISTS p (k INTEGER PRIMARY KEY CHECK (k = 1), hash TEXT NOT NULL, blob TEXT, rev INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER NOT NULL DEFAULT 0, lastPut INTEGER NOT NULL DEFAULT 0, lastRot INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec('INSERT INTO p (k, hash, rev, updatedAt) VALUES (1, ?, 0, ?)', hash, Date.now());
    return true;
  }
  async read(hash) {
    const { r, status } = this.auth(hash); if (!r) return { status };
    return { status: 200, data: this.withInbox({ rev: r.rev, updatedAt: r.updatedAt, blob: r.blob ? JSON.parse(r.blob) : null }) };
  }
  async write(hash, rev, text, ack = null) {
    const { r, status } = this.auth(hash); if (!r) return { status };
    const now = Date.now();
    if (now - r.lastPut < PUT_GAP) return { status: 429, retry: Math.max(1, Math.ceil((PUT_GAP - (now - r.lastPut)) / 1000)) };
    if (rev <= r.rev) return { status: 409, data: this.withInbox({ rev: r.rev, updatedAt: r.updatedAt, blob: r.blob ? JSON.parse(r.blob) : null }) };
    this.sql.exec('UPDATE p SET blob = ?, rev = ?, updatedAt = ?, lastPut = ? WHERE k = 1', text, rev, now, now);
    if (ack && ack.length && this.has('inbox')) for (const id of ack) this.sql.exec('DELETE FROM inbox WHERE id = ?', id); // 18.0 (NE)
    return { status: 200, data: this.withInbox({ rev, updatedAt: now }) };
  }
  // 18.0 (NE) inbox: items the server hands to this player's cloud save on the next sync (weekly season rewards).
  // deliver() is an internal RPC (board.js rollover); false when the id has no player (nothing is stored then).
  // GET / PUT / 409 answers carry inbox: [{id, k, ...}] until a PUT acks the ids (the blob then holds what they gave).
  async deliver(item) {
    if (!this.row() || !item || typeof item.id !== 'string' || item.id.length > 40) return false;
    this.sql.exec('CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, k TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)');
    const body = JSON.stringify(item); if (body.length > 2000) return false;
    this.sql.exec('INSERT OR IGNORE INTO inbox (id, k, body, at) VALUES (?, ?, ?, ?)', item.id, String(item.k || 'msg').slice(0, 20), body, Date.now());
    this.sql.exec('DELETE FROM inbox WHERE id NOT IN (SELECT id FROM inbox ORDER BY at DESC LIMIT 20)');
    return true;
  }
  inboxList() {
    if (!this.has('inbox')) return [];
    return this.sql.exec('SELECT body FROM inbox ORDER BY at ASC').toArray().map((x) => { try { return JSON.parse(x.body); } catch { return null; } }).filter(Boolean);
  }
  withInbox(d) { const ib = this.inboxList(); if (ib.length) d.inbox = ib; return d; }
  async verify(hash) {
    const { r, status } = this.auth(hash); if (!r) return { ok: false, why: status === 404 ? 'unknown' : 'bad' };
    let p = null; try { p = r.blob ? JSON.parse(r.blob).p : null; } catch {}
    const av = p && p.avatar && typeof p.avatar === 'object' ? { piece: str(p.avatar.piece, 20), skin: str(p.avatar.skin, 30) } : null;
    return { ok: true, name: p ? str(p.name, 14) : null, avatar: av, title: p ? str(p.title, 40) : null };
  }
  async rotate(hash, next) {
    const { r, status } = this.auth(hash); if (!r) return { status };
    const now = Date.now();
    if (now - r.lastRot < ROTATE_GAP) return { status: 429, retry: Math.ceil((ROTATE_GAP - (now - r.lastRot)) / 1000) };
    this.sql.exec('UPDATE p SET hash = ?, lastRot = ? WHERE k = 1', next, now);
    try { if (this.soKick) this.soKick(); } catch {} // 18.0 (SO): the old secret's friends links close
    return { ok: true };
  }
  // Fixed-window limiter (only used on the '_limits' instance). Returns 0 when allowed, else seconds to wait.
  async hit(key, max, windowMs) {
    const now = Date.now();
    this.sql.exec('CREATE TABLE IF NOT EXISTS lim (key TEXT PRIMARY KEY, n INTEGER NOT NULL, t0 INTEGER NOT NULL)');
    const r = this.sql.exec('SELECT n, t0 FROM lim WHERE key = ?', key).toArray()[0];
    if (!r || now - r.t0 >= windowMs) { this.sql.exec('INSERT OR REPLACE INTO lim (key, n, t0) VALUES (?, 1, ?)', key, now); this.sweep(now, windowMs); return 0; }
    if (r.n >= max) return Math.max(1, Math.ceil((windowMs - (now - r.t0)) / 1000));
    this.sql.exec('UPDATE lim SET n = n + 1 WHERE key = ?', key);
    return 0;
  }
  sweep(now, windowMs) { this.sql.exec('DELETE FROM lim WHERE t0 < ?', now - windowMs); }
  // 18.0 (LV): daily upkeep (lv.maint, '_limits' only): limiter rows whose hour is over. A test server may pass a later now.
  async pruneLim(now) {
    if (!this.has('lim')) return { deleted: 0, left: 0 };
    const t = this.env && this.env.ROOM_TEST && +now > 0 ? +now : Date.now();
    const deleted = this.sql.exec('DELETE FROM lim WHERE t0 < ?', t - 3600_000).rowsWritten;
    return { deleted, left: this.sql.exec('SELECT COUNT(*) AS n FROM lim').toArray()[0].n };
  }
}
social.install(Player); // 18.0 (SO): adds the so* RPCs + fetch/webSocket* handlers (server/src/social.js); never overrides a method defined above

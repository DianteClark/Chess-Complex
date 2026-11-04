// 17.0 (RP): shared match replays. See docs/DESIGN_17.md ("RP replays").
//   save(env, rec, o?)   -> replay id (8 chars) or null; never throws. The Room's match-end hook (hooks.js) calls it
//                           with the match record: verified (the server ran the match).
//   GET  /replay/:id     -> {id, verified, at, exp, rec}  (404 when unknown or expired)
//   POST /replay         -> {id}  a client upload of its own (solo / phone-hosted) match: rate limited per IP,
//                           stored unverified. Body: the record JSON (<= 200 KB).
// One Replay DO per id (idFromName(id)): the record is stored gzipped (CompressionStream) as one value, and an alarm
// deletes it after 30 days. A '_limits' instance keeps the per-IP upload counters (purged hourly by its alarm).
// Record (both paths): {start:{players, seed, opts}, actions:[[pid, a], ...], mode, location, result, hash, ver, mid,
// seats}. Older/flat shapes ({players, seed, opts, actions:[{pid, a}]}) are normalised.
// The client replays it with createMatch(start.players, start.seed, start.opts) + applyAction for each action.

export const ID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
export const TTL_MS = 30 * 24 * 3600 * 1000;
export const MAX_BYTES = 200 * 1024; // the record as JSON
const MAX_ACTIONS = 8000, MAX_PLAYERS = 16;
const HOUR = 3600 * 1000;

const json = (o, status = 200, extra) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store', ...(extra || {}) } });
const newId = () => { const b = crypto.getRandomValues(new Uint8Array(8)); return Array.from(b, (x) => ID_CHARS[x & 31]).join(''); };
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

async function gzip(str) {
  if (typeof CompressionStream !== 'function') return { gz: false, buf: new TextEncoder().encode(str) };
  const buf = await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return { gz: true, buf: new Uint8Array(buf) };
}
async function gunzip(buf, gz) {
  if (!gz) return new TextDecoder().decode(buf);
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

// Normalise and validate a record. Returns the clean record or a string (why it was refused).
export function clean(rec) {
  if (!isObj(rec)) return 'record';
  const st = isObj(rec.start) ? rec.start : rec;
  const players = st.players, seed = st.seed, opts = isObj(st.opts) ? st.opts : {};
  if (!Array.isArray(players) || !players.length || players.length > MAX_PLAYERS || !players.every(isObj)) return 'players';
  if (!Number.isInteger(seed)) return 'seed';
  const raw = rec.actions;
  if (!Array.isArray(raw) || raw.length > MAX_ACTIONS) return 'actions';
  const actions = [];
  for (const x of raw) {
    const pid = Array.isArray(x) ? x[0] : x && x.pid, a = Array.isArray(x) ? x[1] : x && x.a;
    // Hollows have no pid (undefined in the engine, null after JSON): replayers map null back to undefined
    if ((pid != null && (typeof pid !== 'string' || pid.length > 64)) || !isObj(a) || typeof a.type !== 'string') return 'action';
    actions.push(Array.isArray(x) && x[2] === 1 ? [pid == null ? null : pid, a, 1] : [pid == null ? null : pid, a]); // 3rd = turn timeout (S2)
  }
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const out = { start: { players, seed, opts }, actions };
  const mode = str(rec.mode, 24) || str(opts.mode, 24); if (mode) out.mode = mode;
  const loc = str(rec.location, 40); if (loc) out.location = loc;
  if (isObj(rec.result)) out.result = rec.result;
  const hash = Number.isInteger(rec.hash) ? rec.hash : isObj(rec.result) && Number.isInteger(rec.result.hash) ? rec.result.hash : null;
  if (hash != null) out.hash = hash >>> 0;
  const ver = str(rec.ver, 40); if (ver) out.ver = ver;
  const mid = str(rec.mid, 40); if (mid) out.mid = mid;
  // human seats (S2's rec.humans): public bits only - a replay link is public, cloud ids / profiles stay out
  const hs = isObj(rec.humans) ? rec.humans : isObj(rec.seats) ? rec.seats : null;
  if (hs) { out.humans = {}; for (const [k, h] of Object.entries(hs).slice(0, MAX_PLAYERS)) if (isObj(h)) out.humans[String(k).slice(0, 64)] = { name: str(h.name, 40) || 'Player', verified: !!h.verified }; }
  if (rec.tampered) out.tampered = true;
  if (Number.isInteger(rec.t1)) out.t1 = rec.t1;
  const src = str(rec.src, 12); if (src) out.src = src;
  return out;
}

// Store a record. o: {verified (default true: the hook path), ttl (ms), at}. Returns the id, or null.
export async function save(env, rec, o = {}) {
  try {
    if (!env || !env.REPLAY) return null;
    const r = clean(rec); if (typeof r === 'string') return null;
    const body = JSON.stringify(r);
    if (body.length > MAX_BYTES) return null;
    const { gz, buf } = await gzip(body);
    const at = o.at || Date.now(), exp = at + Math.max(1000, Math.min(TTL_MS, o.ttl || TTL_MS));
    const meta = { verified: o.verified !== false, at, exp, gz, size: body.length };
    for (let i = 0; i < 5; i++) {
      const id = newId();
      const stub = env.REPLAY.get(env.REPLAY.idFromName(id));
      const res = await stub.fetch(new Request('https://replay/put?id=' + id, { method: 'POST', body: buf, headers: { 'x-meta': JSON.stringify(meta) } }));
      if (res.status === 200) return id;
      if (res.status !== 409) return null;
    }
  } catch (e) { try { console.error('replay.save', e && e.message); } catch {} }
  return null;
}

export async function load(env, id) {
  if (!ID_RE.test(id)) return null;
  const stub = env.REPLAY.get(env.REPLAY.idFromName(id));
  const res = await stub.fetch(new Request('https://replay/get?id=' + id));
  if (res.status !== 200) return null;
  const meta = JSON.parse(res.headers.get('x-meta') || '{}');
  const txt = await gunzip(new Uint8Array(await res.arrayBuffer()), meta.gz);
  return { id, verified: !!meta.verified, at: meta.at, exp: meta.exp, rec: JSON.parse(txt) };
}

async function limited(env, ip) {
  try {
    if (env.RL_API && typeof env.RL_API.limit === 'function') { const r = await env.RL_API.limit({ key: 'rp:' + ip }); if (r && r.success === false) return true; }
  } catch {}
  const per = Math.max(1, +env.REPLAY_PER_HOUR || 12);
  const stub = env.REPLAY.get(env.REPLAY.idFromName('_limits'));
  const res = await stub.fetch(new Request('https://replay/limit?ip=' + encodeURIComponent(ip) + '&per=' + per, { method: 'POST' }));
  return res.status === 429;
}

async function readBody(req) {
  const len = +req.headers.get('Content-Length') || 0;
  if (len > MAX_BYTES + 1024) return null;
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_BYTES + 1024) return null;
  // gzip uploads are welcome (magic bytes), capped again once inflated
  if (buf[0] === 0x1f && buf[1] === 0x8b) { const t = await gunzip(buf, true); return t.length > MAX_BYTES ? null : t; }
  return new TextDecoder().decode(buf);
}

export async function routes(req, env, url, ctx) {
  const path = url.pathname;
  if (path !== '/replay' && !path.startsWith('/replay/')) return null;
  if (!env.REPLAY) return json({ error: 'off' }, 503);
  const test = !!env.ROOM_TEST;
  const m = path.match(/^\/replay\/([0-9A-Za-z]{8})$/);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    const r = await load(env, m[1].toUpperCase());
    return r ? json(r) : json({ error: 'not found' }, 404);
  }
  if (path === '/replay' && req.method === 'POST') {
    const ip = (test && req.headers.get('x-cc-test-ip')) || req.headers.get('CF-Connecting-IP') || 'local';
    if (await limited(env, ip)) return json({ error: 'slow down', retry: 3600 }, 429);
    const txt = await readBody(req);
    if (txt == null) return json({ error: 'too big', max: MAX_BYTES }, 413);
    let rec; try { rec = JSON.parse(txt); } catch { return json({ error: 'bad json' }, 400); }
    const c = clean(rec); if (typeof c === 'string') return json({ error: 'bad ' + c }, 400);
    if (JSON.stringify(c).length > MAX_BYTES) return json({ error: 'too big', max: MAX_BYTES }, 413);
    const o = { verified: test && req.headers.get('x-cc-test-verified') === '1' }; // test hook: the hook path (save) over HTTP
    if (test && req.headers.get('x-cc-test-ttl')) o.ttl = +req.headers.get('x-cc-test-ttl');
    const id = await save(env, c, o);
    return id ? json({ id, verified: o.verified }, 201) : json({ error: 'server' }, 500);
  }
  return json({ error: 'not found' }, 404);
}

export class Replay {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(req) {
    const url = new URL(req.url), S = this.ctx.storage;
    if (url.pathname === '/put') {
      if (await S.get('meta')) return new Response('taken', { status: 409 });
      const meta = JSON.parse(req.headers.get('x-meta') || '{}');
      const buf = new Uint8Array(await req.arrayBuffer());
      await S.put({ meta, rec: buf });
      await S.setAlarm(meta.exp || Date.now() + TTL_MS);
      return new Response('ok');
    }
    if (url.pathname === '/get') {
      const meta = await S.get('meta');
      if (!meta) return new Response('none', { status: 404 });
      if (meta.exp && Date.now() >= meta.exp) { await S.deleteAll(); return new Response('expired', { status: 404 }); }
      const buf = await S.get('rec');
      return new Response(buf, { headers: { 'x-meta': JSON.stringify(meta) } });
    }
    if (url.pathname === '/limit') {
      const ip = url.searchParams.get('ip') || 'local', per = +url.searchParams.get('per') || 12, now = Date.now();
      const k = 'ip:' + ip.slice(0, 64);
      let e = await S.get(k); if (!e || now - e.t0 > HOUR) e = { n: 0, t0: now };
      if (e.n >= per) return new Response('slow', { status: 429 });
      e.n++; await S.put(k, e);
      if (!(await S.getAlarm())) await S.setAlarm(now + HOUR);
      return new Response('ok');
    }
    return new Response('?', { status: 404 });
  }
  async alarm() {
    const S = this.ctx.storage;
    const meta = await S.get('meta');
    if (meta && meta.exp && Date.now() < meta.exp - 1000) { await S.setAlarm(meta.exp); return; } // early wake: keep it
    await S.deleteAll();
  }
}

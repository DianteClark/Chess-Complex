// 17.0 (A): owned by A. See docs/DESIGN_17.md ("A stats + admin").
// Match stats for real online matches + the /admin dashboard.
//   record(env, rec)  called by S2's hooks.matchEnded (ctx.waitUntil). Cheap, never throws, returns Promise<boolean>.
//                     With rec.state (the Room's final state object, in memory) the facts are read straight off it;
//                     without it the Stats DO replays rec.start + rec.actions through the engine in small chunks
//                     across alarms (REPLAY_CHUNK actions per invocation, so no invocation does more than a few ms).
//   Stats DO          one instance ('global'). SQLite: agg (one small row per period x mode x dim x key; periods are UTC
//                     days 'd2026-11-03' and ISO weeks 'w2026-W45'), matches (one row per match, dedupe + recent list),
//                     pending (fact batches, merged into agg by the alarm so busy minutes coalesce row writes),
//                     queue (replay jobs). Rolling 90 days.
//   /admin            dashboard (statspage.js), /admin/data JSON, /admin/csv, POST /admin/record (backfill/tests),
//                     /admin/logout. Gated by the ADMIN_KEY secret: Authorization: Bearer <key> or the HttpOnly cookie
//                     set by /admin?key=<key>. ADMIN_KEY unset -> every /admin* path is 404.
import { createMatch, applyAction, ascended } from '../../js/engine.js';
import { PRESETS } from '../../js/data.js';
import { adminPage, loginPage } from './statspage.js';

const DAY = 864e5, KEEP_DAYS = 90, REPLAY_CHUNK = 20, FLUSH_MS = 30e3;
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h } });
const str = (v, n = 24) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/[^A-Za-z0-9_\-:.]/g, '').slice(0, n);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

// ---------------------------------------------------------------- periods
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function weekKey(ms) {
  const d = new Date(ms), t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const th = t + (3 - ((new Date(t).getUTCDay() + 6) % 7)) * DAY; // Thursday of this ISO week
  const y = new Date(th).getUTCFullYear(), wk = 1 + Math.floor((th - Date.UTC(y, 0, 1)) / DAY / 7);
  return y + '-W' + String(wk).padStart(2, '0');
}

// ---------------------------------------------------------------- facts (cheap, from a final state)
const PRESET_SIG = Object.entries(PRESETS).map(([k, p]) => [k, JSON.stringify([p.pts.hp, p.pts.atk, p.pts.def, p.pts.spd])]);
function presetOf(u) {
  const pt = u.pts || {}, sig = JSON.stringify([pt.hp, pt.atk, pt.def, pt.spd]);
  const hit = PRESET_SIG.find(([, s]) => s === sig);
  return hit ? hit[0] : 'custom';
}
// Bots: u.plan (BOT_PLANS road). Humans: the road their final piece shows (sim15 terms).
function roadOf(u) {
  if (u.plan) return str(u.plan);
  const base = u.piece === 'king' ? u.kingFrom || 'pawn' : u.piece;
  if (base === 'veteran' || base === 'champion') return 'pawn';
  if (ascended({ ...u, piece: base })) return 'ascend';
  if (base === 'queen' || base === 'rook') return base;
  return 'early';
}
const finalPiece = (u) => (u.piece === 'king' ? 'king' : ascended(u) ? 'asc-' + u.piece : str(u.piece));
function countOf(rec, kind) { // drops / leaves: rec.drops (n | array), or per-seat counters, or a seat log
  const top = rec[kind + 's'];
  if (typeof top === 'number') return top;
  if (Array.isArray(top)) return top.length;
  let n = 0;
  for (const v of Object.values(rec.seats || {})) if (v && typeof v === 'object') n += num(v[kind + 's']) || (v[kind === 'drop' ? 'dropped' : 'left'] ? 1 : 0);
  if (!n && Array.isArray(rec.seatLog)) n = rec.seatLog.filter((e) => e && (e.why === kind || e[1] === kind)).length;
  return n;
}
function startOf(rec) {
  const st = rec.start;
  if (Array.isArray(st)) return { players: st[0], seed: st[1], opts: st[2] || {} };
  return st && typeof st === 'object' ? { players: st.players, seed: st.seed, opts: st.opts || {} } : null;
}
function humanSet(rec) {
  const seats = rec.seats || rec.humans;
  if (Array.isArray(seats)) return new Set(seats.map(String));
  if (seats && typeof seats === 'object') return new Set(Object.keys(seats));
  const st = startOf(rec);
  return new Set(((st && st.players) || []).filter((p) => p && !p.isBot).map((p) => String(p.pid)));
}
export function facts(rec, s) {
  const H = humanSet(rec), at = clampAt(rec.at || rec.end || rec.t);
  const units = s.units.filter((u) => u.kind === 'player');
  const w = s.units.find((u) => u.id === s.winner) || null;
  const coop = !!s.siege;
  const P = [];
  let humanWin = 0, crowned = 0;
  for (const u of units) {
    const won = coop ? (s.siegeWon ? 1 : 0) : w && (u.id === w.id || (s.teams && u.team != null && u.team === w.team)) ? 1 : 0;
    const h = H.has(String(u.pid)) ? 'h' : 'b';
    if (h === 'h' && won) humanWin = 1;
    const king = u.piece === 'king' || u.kingFrom ? 1 : 0; crowned |= king;
    const ab = [...new Set(Object.values(u.equips || {}).filter((x) => typeof x === 'string').map((x) => str(x)))];
    P.push([h, finalPiece(u), roadOf(u), presetOf(u), str(u.passive || 'none'), ab, Math.max(1, Math.min(16, num(u.place) || (u.alive ? 1 : units.length))), won, num(u.kills), king, Math.round(num(u.dmgDealt))]);
  }
  const acts = Array.isArray(rec.actions) ? rec.actions : [];
  const timeouts = num(rec.timeouts) || acts.filter((x) => Array.isArray(x) && (x[2] || (x[1] && x[1].to))).length;
  const res = rec.result || {};
  return {
    mid: str(rec.mid || rec.id || 'x' + at.toString(36) + Math.random().toString(36).slice(2, 6), 40), at,
    mode: str(rec.mode || s.mode || 'royale'), loc: str(rec.location || rec.loc || s.location || 'none'),
    M: { matches: 1, rounds: num(res.rounds) || num(s.round), turns: num(s.turnNo), actions: acts.length, humans: P.filter((p) => p[0] === 'h').length, bots: P.filter((p) => p[0] === 'b').length,
      kingWin: !coop && w && w.piece === 'king' ? 1 : 0, crowned: coop ? 0 : crowned, humanWin, coopWin: coop && s.siegeWon ? 1 : 0, coop: coop ? 1 : 0,
      drops: countOf(rec, 'drop'), leaves: countOf(rec, 'leave'), timeouts },
    wp: coop ? (s.siegeWon ? 'coop-win' : 'coop-loss') : w ? finalPiece(w) : '-',
    P,
  };
}
function clampAt(t) { const now = Date.now(); t = num(t) || now; return Math.max(now - (KEEP_DAYS - 1) * DAY, Math.min(now + 6e4, t)); }

// Replay rec.start + rec.actions (actions from index i). Returns {s, i, done}. s may be a JSON-revived state.
function replayChunk(rec, st, i, n) {
  let s = st;
  if (!s) { const a = startOf(rec); s = createMatch(JSON.parse(JSON.stringify(a.players)), a.seed, JSON.parse(JSON.stringify(a.opts || {}))); }
  const acts = rec.actions || [];
  const end = Math.min(acts.length, i + n);
  for (; i < end && !s.over; i++) { const x = acts[i]; if (Array.isArray(x)) applyAction(s, x[0] == null ? undefined : x[0], x[1]); } // Hollows have no pid: JSON turns undefined into null, applyAction wants undefined
  return { s, i, done: s.over || i >= acts.length };
}
export function replayAll(rec) { let r = { s: null, i: 0, done: false }; while (!r.done) r = replayChunk(rec, r.s, r.i, 1e9); return r.s; }

// ---------------------------------------------------------------- record() for S2's hook
export function record(env, rec) {
  try {
    if (!env || !env.STATS || !rec || typeof rec !== 'object') return Promise.resolve(false);
    const s = rec.state || rec.final;
    let body;
    if (s && Array.isArray(s.units)) body = { facts: facts(rec, s) };
    else {
      const st = startOf(rec);
      if (!st || !Array.isArray(st.players) || !Array.isArray(rec.actions)) return Promise.resolve(false);
      const { state, final, ...slim } = rec; // never ship a state twice
      body = { rec: slim };
    }
    const txt = JSON.stringify(body);
    if (txt.length > 400e3) return Promise.resolve(false);
    const stub = env.STATS.get(env.STATS.idFromName('global'));
    return stub.fetch('https://stats/rec', { method: 'POST', body: txt }).then((r) => r.ok, () => false);
  } catch { return Promise.resolve(false); }
}

// ---------------------------------------------------------------- aggregation
// agg value columns: n, win, place (sum), top3, x (sum: kills for players, rounds for loc), y (sum: damage / humans)
export function addFacts(map, f) {
  const ps = ['d' + dayKey(f.at), 'w' + weekKey(f.at)], m = f.mode;
  const bump = (dim, k, n, win, place, top3, x, y) => { for (const p of ps) { const key = p + '|' + m + '|' + dim + '|' + k; const v = map.get(key) || [0, 0, 0, 0, 0, 0]; v[0] += n; v[1] += win; v[2] += place; v[3] += top3; v[4] += x; v[5] += y; map.set(key, v); } };
  for (const [k, v] of Object.entries(f.M)) if (v) bump('meta', k, v, 0, 0, 0, 0, 0);
  bump('loc', f.loc, 1, f.M.humanWin, 0, 0, f.M.rounds, f.M.humans);
  bump('wpiece', f.wp, 1, 0, 0, 0, f.M.rounds, 0);
  for (const [h, piece, road, preset, passive, ab, place, won, kills, king, dmg] of f.P) {
    const one = (dim, k) => bump(dim + '.' + h, k, 1, won, place, place <= 3 ? 1 : 0, kills, dmg);
    one('piece', piece); one('road', road); one('preset', preset); one('passive', passive);
    for (const a of ab) one('ability', a);
    if (king) one('king', 'crowned');
  }
  return map;
}

// ---------------------------------------------------------------- Stats DO
export class Stats {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS agg (p TEXT, m TEXT, dim TEXT, k TEXT, n INTEGER, win INTEGER, place INTEGER, top3 INTEGER, x INTEGER, y INTEGER, PRIMARY KEY (p, m, dim, k)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS matches (mid TEXT PRIMARY KEY, at INTEGER, mode TEXT, loc TEXT, rounds INTEGER, humans INTEGER, bots INTEGER, wp TEXT, hwin INTEGER, drops INTEGER);
      CREATE INDEX IF NOT EXISTS matches_at ON matches (at);
      CREATE TABLE IF NOT EXISTS pending (id INTEGER PRIMARY KEY AUTOINCREMENT, f TEXT);
      CREATE TABLE IF NOT EXISTS queue (mid TEXT PRIMARY KEY, rec TEXT, st TEXT, i INTEGER, tries INTEGER);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);`);
  }
  async wake(ms) { const a = await this.ctx.storage.getAlarm(); const t = Date.now() + ms; if (a == null || a > t) await this.ctx.storage.setAlarm(t); }
  async fetch(req) {
    const url = new URL(req.url), path = url.pathname;
    try {
      if (path === '/rec' && req.method === 'POST') {
        const b = await req.json();
        if (b.facts) { this.addPending(b.facts); await this.wake(FLUSH_MS); return json({ ok: true }); }
        if (b.rec) {
          const mid = str(b.rec.mid || b.rec.id || 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), 40);
          if (this.seen(mid)) return json({ ok: true, dup: true });
          b.rec.mid = mid; b.rec.at = clampAt(b.rec.at || b.rec.end || b.rec.t);
          this.sql.exec('INSERT OR IGNORE INTO queue (mid, rec, st, i, tries) VALUES (?, ?, NULL, 0, 0)', mid, JSON.stringify(b.rec));
          await this.wake(10);
          return json({ ok: true, queued: mid });
        }
        return json({ ok: false }, 400);
      }
      if (path === '/data') { this.flush(); return json(this.data(url)); }
      if (path === '/csv') { this.flush(); return this.csv(url); }
      if (path === '/status') return json({ queue: this.one('SELECT COUNT(*) AS c FROM queue').c, pending: this.one('SELECT COUNT(*) AS c FROM pending').c, matches: this.one('SELECT COUNT(*) AS c FROM matches').c, rows: this.one('SELECT COUNT(*) AS c FROM agg').c });
      return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: 'stats', msg: String(e && e.message || e).slice(0, 200) }, 500); }
  }
  one(q, ...a) { return this.sql.exec(q, ...a).toArray()[0] || {}; }
  seen(mid) { return this.sql.exec('SELECT 1 FROM matches WHERE mid = ?', mid).toArray().length > 0; }
  addPending(f) {
    if (!f || !f.mid || !Array.isArray(f.P) || !f.M) return;
    if (this.seen(f.mid)) return;
    this.sql.exec('INSERT INTO matches (mid, at, mode, loc, rounds, humans, bots, wp, hwin, drops) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', f.mid, f.at, f.mode, f.loc, f.M.rounds, f.M.humans, f.M.bots, f.wp, f.M.humanWin, f.M.drops);
    this.sql.exec('INSERT INTO pending (f) VALUES (?)', JSON.stringify(f));
  }
  flush() { // merge every pending fact batch into agg (one upsert per distinct key)
    const rows = this.sql.exec('SELECT id, f FROM pending ORDER BY id').toArray();
    if (!rows.length) return 0;
    const map = new Map();
    for (const r of rows) { try { addFacts(map, JSON.parse(r.f)); } catch {} }
    this.ctx.storage.transactionSync(() => {
      for (const [key, v] of map) {
        const [p, m, dim, k] = key.split('|');
        this.sql.exec(`INSERT INTO agg (p, m, dim, k, n, win, place, top3, x, y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (p, m, dim, k) DO UPDATE SET n = n + excluded.n, win = win + excluded.win, place = place + excluded.place, top3 = top3 + excluded.top3, x = x + excluded.x, y = y + excluded.y`, p, m, dim, k, ...v);
      }
      this.sql.exec('DELETE FROM pending WHERE id <= ?', rows[rows.length - 1].id);
    });
    return rows.length;
  }
  replayStep() { // one chunk of the oldest replay job
    const j = this.sql.exec('SELECT mid, rec, st, i, tries FROM queue LIMIT 1').toArray()[0];
    if (!j) return false;
    try {
      const rec = JSON.parse(j.rec);
      const r = replayChunk(rec, j.st ? JSON.parse(j.st) : null, j.i, REPLAY_CHUNK);
      if (r.done) { this.addPending(facts(rec, r.s)); this.sql.exec('DELETE FROM queue WHERE mid = ?', j.mid); }
      else this.sql.exec('UPDATE queue SET st = ?, i = ? WHERE mid = ?', JSON.stringify(r.s), r.i, j.mid);
    } catch (e) {
      if (j.tries >= 2) { this.sql.exec('DELETE FROM queue WHERE mid = ?', j.mid); this.bumpErr(); }
      else this.sql.exec('UPDATE queue SET tries = tries + 1 WHERE mid = ?', j.mid);
    }
    return true;
  }
  bumpErr() { this.sql.exec("INSERT INTO kv (k, v) VALUES ('replayErr', '1') ON CONFLICT (k) DO UPDATE SET v = CAST(v AS INTEGER) + 1"); }
  clean() {
    const today = dayKey(Date.now()), last = this.one("SELECT v FROM kv WHERE k = 'clean'").v;
    if (last === today) return;
    const cut = Date.now() - KEEP_DAYS * DAY;
    this.sql.exec("DELETE FROM agg WHERE p LIKE 'd%' AND p < ?", 'd' + dayKey(cut));
    this.sql.exec("DELETE FROM agg WHERE p LIKE 'w%' AND p < ?", 'w' + weekKey(cut - 7 * DAY));
    this.sql.exec('DELETE FROM matches WHERE at < ?', cut);
    this.sql.exec("INSERT INTO kv (k, v) VALUES ('clean', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", today);
  }
  async alarm() {
    const busy = this.replayStep();
    if (busy) { await this.ctx.storage.setAlarm(Date.now() + 5); return; } // queue first, small invocations
    this.flush(); this.clean();
  }
  range(url) {
    const r = url.searchParams.get('r') || 'week', now = Date.now();
    let d = url.searchParams.get('d'); if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) d = dayKey(now);
    const t = Date.parse(d + 'T12:00:00Z');
    if (r === 'day') return { r, label: d, where: 'p = ?', args: ['d' + d], from: d, to: d };
    if (r === 'week') { const w = weekKey(t), mon = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY; return { r, label: w, where: 'p = ?', args: ['w' + w], from: dayKey(mon), to: dayKey(mon + 6 * DAY) }; }
    const n = r === '7d' ? 7 : r === '30d' ? 30 : KEEP_DAYS, to = r === 'all' ? dayKey(now) : d, from = dayKey(Date.parse(to + 'T12:00:00Z') - (n - 1) * DAY);
    return { r, label: from + ' .. ' + to, where: "p >= ? AND p <= ? AND p LIKE 'd%'", args: ['d' + from, 'd' + to], from, to };
  }
  rows(R, m) {
    const mq = m ? ' AND m = ?' : '', a = m ? [...R.args, m] : R.args;
    return this.sql.exec(`SELECT m, dim, k, SUM(n) AS n, SUM(win) AS win, SUM(place) AS place, SUM(top3) AS top3, SUM(x) AS x, SUM(y) AS y FROM agg WHERE ${R.where}${mq} GROUP BY m, dim, k`, ...a).toArray();
  }
  data(url) {
    const R = this.range(url), m = str(url.searchParams.get('m') || '');
    const from = Date.parse(R.from + 'T00:00:00Z'), to = Date.parse(R.to + 'T00:00:00Z') + DAY;
    const mq = m ? ' AND m = ?' : '';
    const days = this.sql.exec(`SELECT substr(p, 2) AS day, SUM(n) AS n FROM agg WHERE p >= ? AND p <= ? AND p LIKE 'd%' AND dim = 'meta' AND k = 'matches'${mq} GROUP BY p ORDER BY p`, 'd' + R.from, 'd' + R.to, ...(m ? [m] : [])).toArray();
    const recent = this.sql.exec(`SELECT mid, at, mode, loc, rounds, humans, bots, wp, hwin, drops FROM matches WHERE at >= ? AND at < ?${m ? ' AND mode = ?' : ''} ORDER BY at DESC LIMIT 25`, from, to, ...(m ? [m] : [])).toArray();
    const st = this.one('SELECT COUNT(*) AS q FROM queue'), err = this.one("SELECT v FROM kv WHERE k = 'replayErr'").v;
    return { range: R.r, label: R.label, from: R.from, to: R.to, mode: m || null, rows: this.rows(R, m), days, recent, queue: st.q || 0, replayErr: +err || 0, now: Date.now() };
  }
  csv(url) {
    const R = this.range(url), m = str(url.searchParams.get('m') || '');
    const q = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const out = ['range,mode,dim,who,key,n,wins,win_rate,avg_place,top3_rate,sum_x,sum_y'];
    const rows = this.rows(R, m).sort((a, b) => (a.dim + a.m + a.k).localeCompare(b.dim + b.m + b.k));
    for (const r of rows) {
      const [dim, who] = r.dim.split('.'), pl = !!who;
      out.push([R.label, r.m, dim, who === 'h' ? 'human' : who === 'b' ? 'bot' : '', r.k, r.n, r.win, pl ? (r.win / r.n).toFixed(4) : '', pl ? (r.place / r.n).toFixed(3) : '', pl ? (r.top3 / r.n).toFixed(4) : '', r.x, r.y].map(q).join(','));
    }
    return new Response(out.join('\n') + '\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cc-stats-${R.r}-${R.from}${m ? '-' + m : ''}.csv"`, 'Cache-Control': 'no-store' } });
  }
}

// ---------------------------------------------------------------- /admin routes + auth
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const tokenOf = (key) => sha('cc-admin-v1:' + key);
function cookie(req, name) { const c = req.headers.get('Cookie') || ''; const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)')); return m ? m[1] : ''; }
const SEC = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const html = (body, status = 200, h = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", ...SEC, ...h } });

export async function routes(req, env, url, ctx) {
  const path = url.pathname;
  if (path !== '/admin' && !path.startsWith('/admin/')) return null;
  if (!env.ADMIN_KEY || !env.STATS) return json({ error: 'not found' }, 404); // refuse everything when the secret is unset
  const want = await tokenOf(env.ADMIN_KEY);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const limited = async () => { try { if (env.RL_API) { const r = await env.RL_API.limit({ key: 'admin:' + ip }); return !r.success; } } catch {} return false; };
  // /admin?key=K -> cookie + redirect (keeps the key out of history and logs past this one request)
  const qk = url.searchParams.get('key');
  if (path === '/admin' && qk != null) {
    if (await limited()) return html(loginPage('Too many tries. Wait a minute.'), 429);
    if (!same(await tokenOf(qk), want)) return html(loginPage('Wrong key.'), 401);
    return new Response(null, { status: 302, headers: { Location: '/admin', 'Set-Cookie': `cc_admin=${want}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}`, ...SEC } });
  }
  if (path === '/admin/logout') return new Response(null, { status: 302, headers: { Location: '/admin', 'Set-Cookie': `cc_admin=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure}`, ...SEC } });
  const auth = req.headers.get('Authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  const ok = (bearer && same(await tokenOf(bearer[1].trim()), want)) || same(cookie(req, 'cc_admin'), want);
  if (!ok) {
    if (bearer && await limited()) return json({ error: 'slow down' }, 429, SEC);
    return path === '/admin' ? html(loginPage(''), 401) : json({ error: 'unauthorized' }, 401, SEC);
  }
  const stub = env.STATS.get(env.STATS.idFromName('global'));
  const fwd = (p) => stub.fetch('https://stats' + p + url.search);
  if (path === '/admin') return html(adminPage());
  if (path === '/admin/data') { const r = await fwd('/data'); return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', ...SEC } }); }
  if (path === '/admin/csv') { const r = await fwd('/csv'); const h = new Headers(r.headers); for (const [k, v] of Object.entries(SEC)) h.set(k, v); return new Response(r.body, { status: r.status, headers: h }); }
  if (path === '/admin/status') return fwd('/status');
  if (path === '/admin/record' && req.method === 'POST') { // backfill / tests: same path as the Room hook
    let rec; try { rec = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    return json({ ok: await record(env, rec) });
  }
  return json({ error: 'not found' }, 404, SEC);
}

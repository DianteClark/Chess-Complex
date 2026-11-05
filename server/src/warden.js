// 18.1 (L3): Warden Rating (co-op performance rating) on the Board Durable Object. Installed into Board as a mixin
// (install(Board) in board.js, like social.install(Player)), so it shares the 'main' instance's SQLite, the 'verify'
// replay queue (one chunk per alarm, no new alarm loops) and the Monday rollover + Player DO inbox.
// Math, tiers and rewards: js/warden.js (shared with the client).
//
// Which runs count:
//   - cloud co-op rooms: every VERIFIED seat (cid/cproof, as board.rate) that did not leave, any party size, from the
//     Room's final state (rec.state); custom rules never count. Runs automatically from S2's match-end hook.
//   - solo Siege / Gauntlet on the phone: only runs the server re-simulates. The client takes a ticket (server seed),
//     registers the start, then submits the createMatch inputs + GameHost.rec.actions; the Daily's chunked verifier
//     replays it (every bot / Hollow re-planned on the server). Offline / unregistered / unverified runs never count.
//     A registered run that is never submitted (quit) counts as a 0 when the next one starts or after WL.dnfAfter.
//
// Routes (JSON; Authorization: Bearer <cloud secret> on POSTs):
//   POST /lb/coop/ticket {cid}                                   -> {rid, seed} (the open ticket, or a new one)
//   POST /lb/coop/start  {cid, rid, mode, name, title, avatar}   -> {ranked: true} | 409
//   POST /lb/coop/run    {cid, rid, ver, players, opts, actions} -> 202 {st:'queued'} | 409 {st, why} | 4xx
//   GET  /lb/coop/status?cid=&rid=                               -> {st: issued|started|queued|ok|rejected|dnf, score, r, delta, why}
//   GET  /lb/coop/me?cid=                                        -> {warden: card, wseason: {sid, ends, pts, rank, of, games}}
//   Boards: GET /lb/view|top|around?board=warden|wseason[&sid=last] (board.js spec()).
//   Test hooks (LB_TEST): POST /lb/test/wage {rid, ms}, POST /lb/test/wrows {sid, rows}, GET /lb/test/wrewards.
import { WARDEN, runFacts, runScore, aggregate, seasonAdd, wkPub, isCoop, wrewardFor, WSEASON_REWARDS, cleanStart } from '../../js/warden.js';
export { cleanStart };
import { seasonId, seasonEnds, cleanName, cleanTitle, cleanTok, checkActions } from './lbcore.js';
import { verifyPlayer } from './player.js';
import { protoVer } from '../../js/statehash.js';

export const WL = { dnfAfter: 3 * 3600e3, ticketTtl: 24 * 3600e3, keepTickets: 3 * 864e5, keepArch: 100, maxBody: 256 * 1024 };
const CID_RE = /^[0-9A-Z]{10}$/, RID_RE = /^[0-9A-Z]{12}$/;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const avatarOf = (a) => { const [pc, sk] = a && typeof a === 'object' ? [a.piece, a.skin] : String(a || '').split(':'); return cleanTok(pc) ? cleanTok(pc) + (cleanTok(sk) ? ':' + cleanTok(sk) : '') : ''; };
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const rid = () => { const b = crypto.getRandomValues(new Uint8Array(12)); let s = ''; for (const x of b) s += B32[x & 31]; return s; };

// ---------- cloud rooms: S2's match-end hook (board.rate calls this for co-op modes) ----------
export async function rateCoop(env, rec, stub) {
  if (!rec || rec.tampered || !stub) return null;
  if (!isCoop(rec.mode)) return null;
  if ((rec.start && rec.start.opts && rec.start.opts.custom) || (rec.opts && rec.opts.custom)) return null;
  const s = rec.state; if (!s || !s.siege) return null;
  const runs = [], seen = new Set();
  for (const [pid, h] of Object.entries(rec.humans || {})) {
    if (!h || !h.verified || h.left || typeof h.cid !== 'string' || !CID_RE.test(h.cid) || seen.has(h.cid)) continue;
    const f = runFacts(s, pid); if (!f) continue;
    seen.add(h.cid);
    const pub = h.pub || {};
    runs.push({ cid: h.cid, name: cleanName(pub.name || h.name), title: cleanTitle(pub.title ?? h.title), avatar: avatarOf(pub.avatar || h.avatar), src: 'cloud', ...summary(f) });
  }
  if (!runs.length) return null;
  return stub.wAdd({ rid: 'm:' + String(rec.mid || rec.id || ''), at: +rec.t1 || Date.now(), runs });
}
const summary = (f) => { const sc = runScore(f); return { score: sc.score, won: f.won ? 1 : 0, cleared: f.cleared, mode: f.mode, n: f.n, humans: f.team.filter((t) => t.human).length, parts: sc }; };

// ---------- routes ----------
async function body(req) { const t = await req.text(); if (t.length > WL.maxBody) return { big: true }; try { const b = JSON.parse(t); return b && typeof b === 'object' ? b : null; } catch { return null; } }
async function who(req, env, b) {
  const cid = String((b && b.cid) || '').toUpperCase();
  const secret = (/^Bearer\s+([0-9A-Za-z]+)\s*$/.exec(req.headers.get('Authorization') || '') || [])[1];
  if (!CID_RE.test(cid) || !secret) return null;
  const v = await verifyPlayer(env, cid, secret);
  return v && v.ok ? { cid, v } : null;
}
export async function routes(req, env, url, main, vq, testOn) {
  const p = url.pathname, m = req.method, q = url.searchParams;
  if (!p.startsWith('/lb/coop/') && !['/lb/test/wage', '/lb/test/wrewards', '/lb/test/wrows'].includes(p)) return null;
  const cid = (q.get('cid') || '').toUpperCase();
  if (m === 'GET' && p === '/lb/coop/status') { const r = (q.get('rid') || '').toUpperCase(); if (!CID_RE.test(cid) || !RID_RE.test(r)) return json({ error: 'cid/rid' }, 400); return json(await main.wStatus(cid, r)); }
  if (m === 'GET' && p === '/lb/coop/me') { if (!CID_RE.test(cid)) return json({ error: 'cid' }, 400); return json(await main.wMe(cid)); }
  if (p.startsWith('/lb/test/')) {
    if (!testOn) return json({ error: 'not found' }, 404);
    const b = m === 'POST' ? (await body(req)) || {} : {};
    if (p === '/lb/test/wage') return json(await main.wTestAge(String(b.rid || ''), +b.ms || 0));
    if (p === '/lb/test/wrows') return json(await main.wTestRows(b)); // seed co-op season rows for a week (rollover tests)
    return json(await main.wRewardQ());
  }
  if (m !== 'POST') return json({ error: 'not found' }, 404);
  const len = +req.headers.get('Content-Length'); if (len > WL.maxBody) return json({ error: 'too large' }, 413);
  const b = await body(req); if (!b) return json({ error: 'bad body' }, 400); if (b.big) return json({ error: 'too large' }, 413);
  const a = await who(req, env, b); if (!a) return json({ error: 'sign in' }, 401);
  if (p === '/lb/coop/ticket') return json(await main.wTicket(a.cid));
  const r = String(b.rid || '').toUpperCase(); if (!RID_RE.test(r)) return json({ error: 'rid' }, 400);
  if (p === '/lb/coop/start') {
    if (!isCoop(b.mode)) return json({ error: 'mode' }, 400);
    const pub = { name: cleanName(b.name || a.v.name), title: cleanTitle(b.title ?? a.v.title), avatar: avatarOf(b.avatar || a.v.avatar) };
    const o = await main.wStart(a.cid, r, b.mode, pub);
    return json(o, o.ranked ? 200 : 409);
  }
  if (p === '/lb/coop/run') {
    if (String(b.ver || '') !== protoVer()) return json({ error: 'update', why: 'Update the game to count this run.' }, 409);
    if (!checkActions(b.actions)) return json({ error: 'bad run' }, 400);
    const t = await main.wPeek(a.cid, r);
    if (!t) return json({ st: 'none', why: 'This run was not registered when it started, so it does not count.' }, 409);
    if (t.st !== 'started') return json({ st: t.st, why: t.st === 'dnf' ? 'This run was abandoned.' : 'Already submitted.' }, 409);
    const start = cleanStart(b.players, b.opts, t.mode, t.seed);
    if (!start) return json({ error: 'bad run', why: 'Custom rules, extra options or an unknown build do not count.' }, 400);
    const pub = { name: start.players[0].name, title: start.players[0].title, avatar: avatarOf(b.avatar || a.v.avatar) };
    const c = await main.wClaim(a.cid, r, pub); if (!c.ok) return json({ st: c.st }, 409);
    await vq.enqueue({ kind: 'coop', cid: a.cid, rid: r, day: '', start, actions: b.actions });
    return json({ st: 'queued' }, 202);
  }
  return json({ error: 'not found' }, 404);
}

// ---------- the Board mixin ----------
const M = {
  wSchema() {
    const x = (q) => this.sql.exec(q);
    x('CREATE TABLE IF NOT EXISTS warden (cid TEXT PRIMARY KEY, name TEXT, avatar TEXT, title TEXT, wr REAL NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, peak REAL NOT NULL, last REAL NOT NULL DEFAULT 0, at INTEGER NOT NULL)');
    x('CREATE INDEX IF NOT EXISTS warden_wr ON warden (wr DESC)');
    x('CREATE TABLE IF NOT EXISTS wrun (rid TEXT NOT NULL, cid TEXT NOT NULL, at INTEGER NOT NULL, score INTEGER NOT NULL, mode TEXT, n INTEGER, won INTEGER, cleared INTEGER, src TEXT, PRIMARY KEY (rid, cid))');
    x('CREATE INDEX IF NOT EXISTS wrun_cid ON wrun (cid, at DESC)');
    x('CREATE TABLE IF NOT EXISTS wseason (sid TEXT NOT NULL, cid TEXT NOT NULL, name TEXT, avatar TEXT, title TEXT, wpts INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, best TEXT, at INTEGER NOT NULL, PRIMARY KEY (sid, cid))');
    x('CREATE INDEX IF NOT EXISTS wseason_pts ON wseason (sid, wpts DESC)');
    x('CREATE TABLE IF NOT EXISTS warch (sid TEXT NOT NULL, rank INTEGER NOT NULL, cid TEXT, name TEXT, avatar TEXT, title TEXT, wpts INTEGER, games INTEGER, wins INTEGER, PRIMARY KEY (sid, rank))');
    x('CREATE TABLE IF NOT EXISTS wtick (rid TEXT PRIMARY KEY, cid TEXT NOT NULL, seed INTEGER NOT NULL, mode TEXT, st TEXT NOT NULL, at INTEGER NOT NULL, res TEXT)');
    x('CREATE INDEX IF NOT EXISTS wtick_cid ON wtick (cid, st)');
  },
  wPub(cid) { const r = this.one('SELECT wr, games FROM warden WHERE cid = ?', cid); return r ? wkPub(r.wr, r.games) : {}; },
  // runs: [{cid, name, title, avatar, score, won, cleared, mode, n, src}] of one match / solo run. Idempotent per (rid, cid).
  async wAdd(o) {
    if (!o || !o.rid || !Array.isArray(o.runs)) return { runs: [] };
    await this.rollover(); // now, not o.at: an old timestamp must not rewind the season meta
    const cur = seasonId(), sid = seasonId(o.at) < cur ? cur : seasonId(o.at), out = []; // a run that lands after the Monday reset counts this week (never reopens an archived week)
    for (const u of o.runs) {
      if (!CID_RE.test(String(u.cid || '')) || this.one('SELECT 1 AS x FROM wrun WHERE rid = ? AND cid = ?', o.rid, u.cid)) { out.push({ cid: u.cid, dup: true }); continue; }
      const score = Math.max(0, Math.round(+u.score || 0));
      this.sql.exec('INSERT INTO wrun (rid, cid, at, score, mode, n, won, cleared, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', o.rid, u.cid, o.at, score, u.mode || '', u.n | 0, u.won ? 1 : 0, u.cleared | 0, u.src || '');
      const rows = this.all('SELECT score FROM wrun WHERE cid = ? ORDER BY at DESC, rowid DESC', u.cid);
      if (rows.length > WARDEN.window) this.sql.exec('DELETE FROM wrun WHERE cid = ? AND rowid NOT IN (SELECT rowid FROM wrun WHERE cid = ? ORDER BY at DESC, rowid DESC LIMIT ?)', u.cid, u.cid, WARDEN.window);
      const ag = aggregate(rows.map((r) => r.score));
      const prev = this.one('SELECT * FROM warden WHERE cid = ?', u.cid);
      const games = (prev ? prev.games : 0) + 1, wins = (prev ? prev.wins : 0) + (u.won ? 1 : 0);
      const delta = Math.round((ag.r - (prev ? prev.wr : 0)) * 10) / 10, peak = Math.max(prev ? prev.peak : 0, games >= WARDEN.prov ? ag.r : 0);
      const pub = { name: u.name || (prev && prev.name) || 'Player', avatar: u.avatar ?? (prev && prev.avatar) ?? '', title: u.title ?? (prev && prev.title) ?? '' };
      this.sql.exec('INSERT OR REPLACE INTO warden (cid, name, avatar, title, wr, games, wins, peak, last, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', u.cid, pub.name, pub.avatar, pub.title, ag.r, games, wins, peak, delta, o.at);
      if (u.src !== 'quit') {
        const cur = this.one('SELECT best, games, wins FROM wseason WHERE sid = ? AND cid = ?', sid, u.cid);
        const sa = seasonAdd(cur ? JSON.parse(cur.best || '[]') : [], score);
        this.sql.exec('INSERT OR REPLACE INTO wseason (sid, cid, name, avatar, title, wpts, games, wins, best, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', sid, u.cid, pub.name, pub.avatar, pub.title, sa.pts, (cur ? cur.games : 0) + 1, (cur ? cur.wins : 0) + (u.won ? 1 : 0), JSON.stringify(sa.best), o.at);
      }
      out.push({ cid: u.cid, score, r: ag.r, delta, games, prov: games < WARDEN.prov });
    }
    return { rid: o.rid, runs: out };
  },
  // ----- solo tickets -----
  async wSweep(cid, now = Date.now()) {
    // registered runs that were never submitted: a 0 in the window once they are stale
    for (const t of this.all("SELECT * FROM wtick WHERE cid = ? AND st = 'started' AND at < ?", cid, now - WL.dnfAfter)) await this.wQuit(t, now);
    this.sql.exec("DELETE FROM wtick WHERE cid = ? AND st NOT IN ('issued', 'started', 'queued') AND at < ?", cid, now - WL.keepTickets);
    this.sql.exec("DELETE FROM wtick WHERE cid = ? AND st = 'issued' AND at < ?", cid, now - WL.ticketTtl);
  },
  wQuit(t, now = Date.now()) {
    this.sql.exec("UPDATE wtick SET st = 'dnf', at = ? WHERE rid = ?", now, t.rid);
    return this.wAdd({ rid: 's:' + t.rid, at: now, runs: [{ cid: t.cid, score: WARDEN.quit, won: 0, cleared: 0, mode: t.mode, n: 1, src: 'quit' }] });
  },
  async wTicket(cid) {
    await this.wSweep(cid);
    const t = this.one("SELECT rid, seed FROM wtick WHERE cid = ? AND st = 'issued' ORDER BY at DESC LIMIT 1", cid);
    if (t) return { rid: t.rid, seed: t.seed };
    const r = { rid: rid(), seed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff };
    this.sql.exec("INSERT INTO wtick (rid, cid, seed, mode, st, at) VALUES (?, ?, ?, '', 'issued', ?)", r.rid, cid, r.seed, Date.now());
    return r;
  },
  async wStart(cid, r, mode, pub) {
    const t = this.one('SELECT * FROM wtick WHERE rid = ?', r);
    if (!t || t.cid !== cid) return { ranked: false, st: 'none', why: 'Unknown ticket.' };
    if (t.st !== 'issued') return { ranked: false, st: t.st, why: 'This ticket was already used.' };
    for (const o of this.all("SELECT * FROM wtick WHERE cid = ? AND st = 'started'", cid)) await this.wQuit(o); // starting again = the open run was abandoned
    this.sql.exec("UPDATE wtick SET st = 'started', mode = ?, at = ?, res = ? WHERE rid = ?", mode, Date.now(), JSON.stringify({ pub }), r);
    return { ranked: true, st: 'started' };
  },
  async wPeek(cid, r) { const t = this.one('SELECT * FROM wtick WHERE rid = ? AND cid = ?', r, cid); if (t && t.st === 'started' && t.at < Date.now() - WL.dnfAfter) { await this.wQuit(t); return { ...t, st: 'dnf' }; } return t; },
  async wClaim(cid, r, pub) {
    const t = this.one('SELECT * FROM wtick WHERE rid = ? AND cid = ?', r, cid);
    if (!t || t.st !== 'started') return { ok: false, st: t ? t.st : 'none' };
    this.sql.exec("UPDATE wtick SET st = 'queued', at = ?, res = ? WHERE rid = ?", Date.now(), JSON.stringify({ pub }), r);
    return { ok: true };
  },
  // the verify queue's verdict (lbcore verifyStep with job.kind 'coop': v.result = runFacts of the final state)
  async wDone(job, v) {
    const t = this.one('SELECT * FROM wtick WHERE rid = ? AND cid = ?', job.rid, job.cid);
    if (!t || t.st !== 'queued') return { st: t ? t.st : 'none' };
    if (!v.ok || !v.result) { this.sql.exec("UPDATE wtick SET st = 'rejected', at = ?, res = ? WHERE rid = ?", Date.now(), JSON.stringify({ why: String(v.why || 'rejected').slice(0, 80) }), t.rid); return this.wStatus(job.cid, t.rid); }
    let pub = {}; try { pub = JSON.parse(t.res || '{}').pub || {}; } catch {}
    const sm = summary(v.result);
    const a = await this.wAdd({ rid: 's:' + t.rid, at: Date.now(), runs: [{ cid: t.cid, ...pub, src: 'solo', ...sm }] });
    const u = a.runs[0] || {};
    this.sql.exec("UPDATE wtick SET st = 'ok', at = ?, res = ? WHERE rid = ?", Date.now(), JSON.stringify({ score: sm.score, won: sm.won, cleared: sm.cleared, r: u.r, delta: u.delta, parts: sm.parts }), t.rid);
    return this.wStatus(job.cid, t.rid);
  },
  async wStatus(cid, r) {
    const t = this.one('SELECT * FROM wtick WHERE rid = ? AND cid = ?', r, cid);
    if (!t) return { st: 'none' };
    let res = {}; try { res = JSON.parse(t.res || '{}'); } catch {}
    const st = t.st === 'started' && t.at < Date.now() - WL.dnfAfter ? 'dnf' : t.st;
    return { st, mode: t.mode, ...(st === 'ok' ? { score: res.score, won: res.won, cleared: res.cleared, r: res.r, delta: res.delta, parts: res.parts } : {}), ...(st === 'rejected' ? { why: res.why } : {}), card: st === 'ok' ? this.wCard(cid) : undefined };
  },
  wCard(cid) {
    const r = this.one('SELECT * FROM warden WHERE cid = ?', cid);
    if (!r) return { r: 0, games: 0, prov: true, left: WARDEN.prov };
    const prov = r.games < WARDEN.prov;
    const rank = prov ? null : this.one('SELECT COUNT(*) AS n FROM warden WHERE games >= ? AND wr > ?', WARDEN.prov, r.wr).n + 1;
    const recent = this.all('SELECT score, mode, won, src FROM wrun WHERE cid = ? ORDER BY at DESC, rowid DESC LIMIT 10', cid);
    return { r: Math.round(r.wr), games: r.games, wins: r.wins, peak: Math.round(r.peak), last: r.last, prov, left: Math.max(0, WARDEN.prov - r.games), rank, of: this.one('SELECT COUNT(*) AS n FROM warden WHERE games >= ?', WARDEN.prov).n, recent };
  },
  async wMe(cid) {
    await this.rollover();
    const sid = seasonId(), s = this.mine({ board: 'wseason', cid });
    return { cid, warden: this.wCard(cid), wseason: { sid, ends: seasonEnds(sid), pts: s ? s.v : 0, rank: s ? s.rank : null, of: this.count({ board: 'wseason' }), games: s ? s.games : 0 } };
  },
  // ----- Monday rollover (called from Board.rollover, so the crons, rate() and views all trigger it) -----
  wRollover(t = Date.now()) {
    const cur = seasonId(t);
    const old = this.all('SELECT DISTINCT sid FROM wseason WHERE sid < ? ORDER BY sid DESC', cur).map((r) => r.sid);
    if (!old.length) return null;
    const last = old[0];
    this.sql.exec('DELETE FROM warch');
    const top = this.all('SELECT * FROM wseason WHERE sid = ? ORDER BY wpts DESC, wins DESC, at ASC LIMIT ?', last, WL.keepArch);
    top.forEach((r, i) => this.sql.exec('INSERT INTO warch (sid, rank, cid, name, avatar, title, wpts, games, wins) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', last, i + 1, r.cid, r.name, r.avatar, r.title, r.wpts, r.games, r.wins));
    this.sql.exec('DELETE FROM wseason WHERE sid < ?', cur);
    this.setMeta('wlast', last);
    const cap = WSEASON_REWARDS[WSEASON_REWARDS.length - 1].max;
    this.setMeta('wrwq', { sid: last, list: top.slice(0, cap).map((r, i) => ({ cid: r.cid, rank: i + 1, tries: 0 })).filter((x) => CID_RE.test(String(x.cid || '')) && wrewardFor(x.rank)) });
    this.wDeliver().catch(() => {});
    return { sid: last, kept: top.length };
  },
  async wRewardQ() { return this.getMeta('wrwq', null); },
  async wDeliver() {
    const q = this.getMeta('wrwq', null);
    if (!q || !q.list || !q.list.length) return { sent: 0, dropped: 0, left: 0 };
    if (this.wdelivering || !this.env || !this.env.PLAYER) return { sent: 0, dropped: 0, left: q.list.length, busy: !!this.wdelivering };
    this.wdelivering = true;
    let sent = 0, dropped = 0; const left = [];
    try {
      for (const x of q.list) {
        const rw = wrewardFor(x.rank);
        const item = { id: 'wseason:' + q.sid, k: 'wseason', sid: q.sid, rank: x.rank, reward: rw.id, title: rw.title, banner: rw.banner };
        let ok = null, to;
        try { ok = await Promise.race([this.env.PLAYER.get(this.env.PLAYER.idFromName(x.cid)).deliver(item), new Promise((r) => { to = setTimeout(() => r(null), 3000); })]); } catch { ok = null; } finally { clearTimeout(to); }
        if (ok === true) sent++; else if (ok === false || x.tries >= 4) dropped++; else left.push({ ...x, tries: x.tries + 1 });
      }
      const cur = this.getMeta('wrwq', null);
      if (cur && cur.sid === q.sid) this.setMeta('wrwq', { sid: q.sid, list: left });
    } finally { this.wdelivering = false; }
    return { sid: q.sid, sent, dropped, left: left.length };
  },
  async wTestRows(b) {
    let i = 0; const t = Date.now();
    for (const r of (b && b.rows) || []) this.sql.exec('INSERT OR REPLACE INTO wseason (sid, cid, name, avatar, title, wpts, games, wins, best, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', String(b.sid), String(r.cid), r.name || 'Player', r.avatar || '', r.title || '', r.v | 0, r.games ?? 1, r.wins ?? 0, '[]', t - 1000 + i++);
    return { n: i };
  },
  wReset() { for (const t of ['warden', 'wrun', 'wseason', 'warch', 'wtick']) this.sql.exec(`DELETE FROM ${t}`); },
  async wTestAge(r, ms) { this.sql.exec('UPDATE wtick SET at = at - ? WHERE rid = ?', ms, r.toUpperCase()); const t = this.one('SELECT cid FROM wtick WHERE rid = ?', r.toUpperCase()); return t ? this.wStatus(t.cid, r.toUpperCase()) : { st: 'none' }; },
};
export function install(Board) {
  for (const [k, fn] of Object.entries(M)) if (!Object.prototype.hasOwnProperty.call(Board.prototype, k)) Board.prototype[k] = fn;
  return Board;
}

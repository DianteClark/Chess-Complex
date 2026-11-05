// 17.0 (L2): leaderboards. Crown Rating, weekly Season boards and the Daily Challenge board, all in the Board Durable
// Object (SQLite). Two named instances: 'main' holds every board; 'verify' is the Daily replay queue, which re-simulates
// submitted runs in small chunks across alarms (one chunk per alarm, so no invocation does more than about one bot
// plan of engine work) and posts verified scores to 'main'.
//
// Routes (all JSON, CORS added by worker.js):
//   GET  /lb/top?board=rating|season|daily[&day=][&sid=last][&n=50]      top N (rating: provisional players hidden)
//   GET  /lb/around?board=..&cid=..[&n=5][&day=]                          rows above and below the player
//   GET  /lb/me?cid=..[&day=]                                             {rating, season, daily} rank cards
//   GET  /lb/view?board=..&cid=..[&day=][&n=50]                           {top, me, around} in one request (the screen)
//   GET  /lb/daily?day=..                                                 {day, ok:accepting, rule}
//   POST /lb/daily/start {cid, day, name, avatar, title}                  Authorization: Bearer <cloud secret>
//                                                                         -> {ranked: true} for the first start of the day
//                                                                            (abandoned = DNF), else {ranked: false, st}
//   POST /lb/daily  {cid, day, ver, name, avatar, title, skin, actions}   Authorization: Bearer <cloud secret>
//                                                                         -> 202 {st:'queued'} | 409 {st, why} | 4xx
//   GET  /lb/daily/status?cid=..&day=..                                   {st: queued|ok|rejected|none, score, rank, of, why}
// Test hooks (only with --var LB_TEST:1): POST /lb/test/rate {rec}, /lb/test/rollover {now}, /lb/test/reset,
//   GET /lb/test/cpu, POST /lb/test/verify {day, human, actions} (no identity, returns the verdict).
// Exports for others: rate(env, rec) (S2's match-end hook), scheduled(event, env, ctx) (crons), routes, Board.
import { DurableObject } from 'cloudflare:workers';
import { protoVer } from '../../js/statehash.js';
import { verifyPlayer } from './player.js';
import { dayNum, utcDayKey, DAY_RE } from '../../js/daily.js';
import { RATING, rateMatch, ratedMode, seasonId, seasonEnds, seasonPoints, verifiedSeats, cleanName, cleanTitle, cleanTok, verifyStart, verifyStep, checkActions, VERIFY } from './lbcore.js';

const json = (o, status = 200, extra) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extra || {}) } });
const CID_RE = /^[0-9A-Z]{10}$/;
const MAIN = 'main', VQ = 'verify';
const main = (env) => env.BOARD.get(env.BOARD.idFromName(MAIN));
const vq = (env) => env.BOARD.get(env.BOARD.idFromName(VQ));
const testOn = (env) => !!(env && env.LB_TEST && env.LB_TEST !== '0');
export const LB = { top: 50, topMax: 100, around: 5, keepArch: 100, dailyKeepDays: 8, maxBody: 256 * 1024, rule: 'Your first run of the day counts. Quit it and it is a DNF; runs after it are practice.', dnfAfter: 90 * 60e3 };
const BOARDS = ['rating', 'season', 'daily'];
const avatarOf = (a) => { const [pc, sk] = a && typeof a === 'object' ? [a.piece, a.skin] : String(a || '').split(':'); return cleanTok(pc) ? cleanTok(pc) + (cleanTok(sk) ? ':' + cleanTok(sk) : '') : ''; }; // 'piece:skin'
const dayOk = (day, t = Date.now()) => DAY_RE.test(String(day || '')) && Math.abs(dayNum(day) - dayNum(utcDayKey(t))) <= 1;

// ---------- the match-end hook (S2) ----------
export async function rate(env, rec) {
  if (!env || !env.BOARD || !rec || rec.tampered) return null;
  const seats = verifiedSeats(adaptRec(rec));
  if (seats.length < 2) return null; // only matches with 2+ verified humans count (no bot farming)
  return main(env).rate(slimRec(rec, seats));
}
// rec.result.places is [{pid, place, team, bot}] (S2); older/dev shapes {pid: place} are accepted too
function adaptRec(rec) {
  const P = rec.result && rec.result.places; let places = {};
  if (Array.isArray(P)) for (const p of P) { if (p && p.pid != null) places[p.pid] = p.place || (rec.result.winnerPid === p.pid ? 1 : 0); }
  else if (P && typeof P === 'object') places = P;
  const humans = {};
  for (const [pid, h] of Object.entries(rec.humans || {})) humans[pid] = h && h.pub ? { ...h, name: h.pub.name || h.name, title: h.pub.title ?? h.title, avatar: h.pub.avatar || h.avatar } : h;
  return { ...rec, humans, result: { ...(rec.result || {}), places } };
}
function slimRec(rec, seats) {
  const P = Array.isArray(rec.result && rec.result.places) ? rec.result.places : [];
  const teams = new Set(P.filter((p) => p && p.team != null).map((p) => p.team));
  const total = teams.size > 1 ? teams.size : P.length || seats.length;
  const custom = !!(rec.start && rec.start.opts && rec.start.opts.custom) || !!(rec.opts && rec.opts.custom);
  return { mid: String(rec.mid || rec.id || ''), mode: rec.mode, custom, total, siegeWon: !!(rec.result && rec.result.siegeWon), at: +rec.t1 || Date.now(), seats: seats.map((s) => ({ cid: s.cid, place: s.place, name: s.name, title: s.title, avatar: avatarOf(rec.humans[s.pid] && ((rec.humans[s.pid].pub && rec.humans[s.pid].pub.avatar) || rec.humans[s.pid].avatar)) })) };
}

// ---------- crons ----------
// '10 0 * * 1' (Monday): season rollover. '5 0 * * *' (daily): prune old daily boards and stuck verify jobs.
export async function scheduled(event, env, ctx) {
  if (!env || !env.BOARD) return;
  const t = (event && event.scheduledTime) || Date.now();
  try { await main(env).rollover(t); } catch (e) { console.log('[board] rollover failed', String(e && e.message || e)); }
  if (!event || event.cron !== '10 0 * * 1') { try { await main(env).prune(t); await vq(env).kick(); } catch {} }
}

// ---------- routes ----------
export async function routes(req, env, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith('/lb/') && p !== '/lb') return null;
  if (!env.BOARD) return json({ error: 'boards offline' }, 503);
  const q = url.searchParams, m = req.method;
  const cid = (q.get('cid') || '').toUpperCase();
  const board = q.get('board') || 'season';
  const day = q.get('day') || utcDayKey();
  const n = Math.max(1, Math.min(LB.topMax, Math.floor(+q.get('n') || LB.top)));
  if (m === 'GET' && (p === '/lb/top' || p === '/lb/view' || p === '/lb/around')) {
    if (!BOARDS.includes(board)) return json({ error: 'board' }, 400);
    if (board === 'daily' && !DAY_RE.test(day)) return json({ error: 'day' }, 400);
    if (p !== '/lb/top' && !CID_RE.test(cid)) return json({ error: 'cid' }, 400);
    const o = { board, day, sid: q.get('sid') === 'last' ? 'last' : null, n, cid: CID_RE.test(cid) ? cid : null, k: Math.max(1, Math.min(10, Math.floor(+q.get('k') || LB.around))) };
    const r = await main(env).view(o, p === '/lb/top' ? 'top' : p === '/lb/around' ? 'around' : 'view');
    return json(r, 200, p === '/lb/top' ? { 'Cache-Control': 'public, max-age=20' } : undefined);
  }
  if (m === 'GET' && p === '/lb/me') {
    if (!CID_RE.test(cid)) return json({ error: 'cid' }, 400);
    return json(await main(env).me(cid, day));
  }
  if (m === 'GET' && p === '/lb/daily') return json({ day, accepting: dayOk(day), utcDay: utcDayKey(), rule: LB.rule });
  if (m === 'GET' && p === '/lb/daily/status') {
    if (!CID_RE.test(cid) || !DAY_RE.test(day)) return json({ error: 'cid/day' }, 400);
    return json(await main(env).dailyStatus(cid, day));
  }
  if (m === 'POST' && p === '/lb/daily') return submitDaily(req, env);
  if (m === 'POST' && p === '/lb/daily/start') return startDaily(req, env);
  if (p.startsWith('/lb/test/')) {
    if (!testOn(env)) return json({ error: 'not found' }, 404);
    const b = m === 'POST' ? await req.json().catch(() => ({})) : {};
    if (p === '/lb/test/rate') return json({ r: await rate(env, b.rec) });
    if (p === '/lb/test/rollover') return json(await main(env).rollover(+b.now || Date.now()));
    if (p === '/lb/test/reset') { await main(env).reset(); await vq(env).reset(); return json({ ok: true }); }
    if (p === '/lb/test/cpu') return json(await vq(env).cpu(q.get('reset') === '1'));
    if (p === '/lb/test/verify') return json(await vq(env).verifyNow(b, b.budget || null));
    if (p === '/lb/test/age') return json(await main(env).testAge(String(b.cid || ''), String(b.day || ''), +b.ms || 0)); // backdate a start (DNF)
    if (p === '/lb/test/rowset') return json(await main(env).testRows(b)); // seed many rows for paging tests
  }
  return json({ error: 'not found' }, 404);
}

// The ranked attempt is registered when the run STARTS: the first registered start of the day is the ranked run.
// Quitting or never submitting leaves it 'started' = DNF on the board; later runs that day are practice. A run whose
// start could not be registered (offline) is never ranked.
async function auth(req, b) {
  const cid = String((b && b.cid) || '').toUpperCase();
  const secret = (/^Bearer\s+([0-9A-Za-z]+)\s*$/.exec(req.headers.get('Authorization') || '') || [])[1];
  return CID_RE.test(cid) && secret ? { cid, secret } : null;
}
async function startDaily(req, env) {
  let b; try { b = await req.json(); } catch { return json({ error: 'bad body' }, 400); }
  const a = await auth(req, b); if (!a) return json({ error: 'sign in' }, 401);
  if (!dayOk(b.day)) return json({ error: 'day', why: 'That Daily is closed.' }, 409);
  const who = await verifyPlayer(env, a.cid, a.secret);
  if (!who || !who.ok) return json({ error: 'sign in', why: who && who.why }, 401);
  const pub = { name: cleanName(b.name || who.name), title: cleanTitle(b.title ?? who.title), avatar: avatarOf(b.avatar || who.avatar) };
  return json(await main(env).startDaily(a.cid, b.day, pub));
}
async function submitDaily(req, env) {
  const len = +req.headers.get('Content-Length');
  if (len > LB.maxBody) return json({ error: 'too large' }, 413);
  const text = await req.text(); if (text.length > LB.maxBody) return json({ error: 'too large' }, 413);
  let b; try { b = JSON.parse(text); } catch { return json({ error: 'bad body' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'bad body' }, 400);
  const cid = String(b.cid || '').toUpperCase();
  const secret = (/^Bearer\s+([0-9A-Za-z]+)\s*$/.exec(req.headers.get('Authorization') || '') || [])[1];
  if (!CID_RE.test(cid) || !secret) return json({ error: 'sign in' }, 401);
  if (!dayOk(b.day)) return json({ error: 'day', why: 'That Daily is closed.' }, 409);
  if (String(b.ver || '') !== protoVer()) return json({ error: 'update', why: 'Update the game to rank this run.' }, 409);
  if (!checkActions(b.actions)) return json({ error: 'bad run' }, 400);
  const who = await verifyPlayer(env, cid, secret);
  if (!who || !who.ok) return json({ error: 'sign in', why: who && who.why }, 401);
  const human = { pid: 'me', name: cleanName(b.name || who.name), title: cleanTitle(b.title ?? who.title), skin: cleanTok(b.skin) || 'ivory' };
  const pub = { name: human.name, title: human.title, avatar: avatarOf(b.avatar || who.avatar) };
  const claim = await main(env).claimDaily(cid, b.day, pub);
  if (!claim.ok) return json({ st: claim.st, why: claim.st === 'none' ? 'This run was not registered when it started, so it is practice.' : LB.rule, score: claim.score, rank: claim.rank }, 409);
  await vq(env).enqueue({ cid, day: b.day, human, actions: b.actions });
  return json({ st: 'queued' }, 202);
}

// ---------- the Durable Object ----------
export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql; this.env = env;
    this.mem = null; // verify: the job in progress {id, V, acts, chunks}
    ctx.blockConcurrencyWhile(async () => this.schema());
  }
  schema() {
    const x = (q) => this.sql.exec(q);
    x('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
    x('CREATE TABLE IF NOT EXISTS rating (cid TEXT PRIMARY KEY, name TEXT, avatar TEXT, title TEXT, r REAL NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, peak REAL NOT NULL, last REAL NOT NULL DEFAULT 0, at INTEGER NOT NULL)');
    x('CREATE INDEX IF NOT EXISTS rating_r ON rating (r DESC)');
    x('CREATE TABLE IF NOT EXISTS season (sid TEXT NOT NULL, cid TEXT NOT NULL, name TEXT, avatar TEXT, title TEXT, pts INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (sid, cid))');
    x('CREATE INDEX IF NOT EXISTS season_pts ON season (sid, pts DESC)');
    x('CREATE TABLE IF NOT EXISTS arch (sid TEXT NOT NULL, rank INTEGER NOT NULL, cid TEXT, name TEXT, avatar TEXT, title TEXT, pts INTEGER, games INTEGER, wins INTEGER, PRIMARY KEY (sid, rank))');
    x('CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, cid TEXT NOT NULL, name TEXT, avatar TEXT, title TEXT, st TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, place INTEGER, kills INTEGER, dmg INTEGER, why TEXT, at INTEGER NOT NULL, PRIMARY KEY (day, cid))');
    x('CREATE INDEX IF NOT EXISTS daily_score ON daily (day, st, score DESC)');
    x('CREATE TABLE IF NOT EXISTS rated (mid TEXT PRIMARY KEY, at INTEGER NOT NULL)');
    x('CREATE TABLE IF NOT EXISTS vq (id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT, day TEXT, job TEXT NOT NULL, at INTEGER NOT NULL)');
    x('CREATE TABLE IF NOT EXISTS vck (id INTEGER PRIMARY KEY, chunks INTEGER, state TEXT)');
  }
  one(q, ...a) { return this.sql.exec(q, ...a).toArray()[0] || null; }
  all(q, ...a) { return this.sql.exec(q, ...a).toArray(); }
  getMeta(k, d = null) { const r = this.one('SELECT v FROM meta WHERE k = ?', k); return r ? JSON.parse(r.v) : d; }
  setMeta(k, v) { this.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, JSON.stringify(v)); }

  // ----- main: ratings + season points -----
  async rate(m) {
    if (!m || !m.mid || this.one('SELECT 1 AS x FROM rated WHERE mid = ?', m.mid)) return { dup: true };
    await this.rollover(m.at);
    this.sql.exec('INSERT INTO rated (mid, at) VALUES (?, ?)', m.mid, m.at);
    const out = { mid: m.mid, rated: false, seats: [] };
    const sid = seasonId(m.at);
    const rows = m.seats.map((s) => ({ s, row: this.one('SELECT * FROM rating WHERE cid = ?', s.cid) }));
    let deltas = null;
    if (ratedMode(m.mode, m.custom)) {
      deltas = rateMatch(rows.map(({ s, row }) => ({ key: s.cid, r: row ? row.r : RATING.start, games: row ? row.games : 0, place: s.place })));
      out.rated = true;
    }
    rows.forEach(({ s, row }, i) => {
      const win = m.mode && /siege|gauntlet/.test(m.mode) ? m.siegeWon : s.place === 1;
      if (deltas) {
        const d = deltas[i], r = d.r, games = (row ? row.games : 0) + 1, wins = (row ? row.wins : 0) + (s.place === 1 ? 1 : 0), peak = Math.max(row ? row.peak : 0, games >= RATING.provisional ? r : 0);
        this.sql.exec('INSERT OR REPLACE INTO rating (cid, name, avatar, title, r, games, wins, peak, last, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', s.cid, s.name, s.avatar, s.title, r, games, wins, peak, d.delta, m.at);
        out.seats.push({ cid: s.cid, delta: d.delta, r, games });
      }
      const pts = seasonPoints(m.mode, s.place, m.total, win);
      this.sql.exec(`INSERT INTO season (sid, cid, name, avatar, title, pts, games, wins, at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT (sid, cid) DO UPDATE SET pts = pts + excluded.pts, games = games + 1, wins = wins + excluded.wins, name = excluded.name, avatar = excluded.avatar, title = excluded.title, at = excluded.at`, sid, s.cid, s.name, s.avatar, s.title, pts, win ? 1 : 0, m.at);
      if (!deltas) out.seats.push({ cid: s.cid, pts });
    });
    return out;
  }
  // Archive every season older than the current one: keep the top LB.keepArch of the most recent ended season only.
  async rollover(t = Date.now()) {
    const cur = seasonId(t);
    const known = this.getMeta('season', null);
    const old = this.all('SELECT DISTINCT sid FROM season WHERE sid < ? ORDER BY sid DESC', cur).map((r) => r.sid);
    if (known === cur && !old.length) return { sid: cur, rolled: false };
    let archived = null;
    if (old.length) {
      const last = old[0];
      this.sql.exec('DELETE FROM arch');
      const top = this.all('SELECT * FROM season WHERE sid = ? ORDER BY pts DESC, wins DESC, at ASC LIMIT ?', last, LB.keepArch);
      top.forEach((r, i) => this.sql.exec('INSERT INTO arch (sid, rank, cid, name, avatar, title, pts, games, wins) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', last, i + 1, r.cid, r.name, r.avatar, r.title, r.pts, r.games, r.wins));
      this.sql.exec('DELETE FROM season WHERE sid < ?', cur);
      archived = { sid: last, kept: top.length };
      this.setMeta('last', last);
    } else if (known && known < cur && !this.getMeta('last', null)) this.setMeta('last', known);
    this.setMeta('season', cur);
    return { sid: cur, rolled: true, archived };
  }
  async prune(t = Date.now()) {
    const cut = dayNum(utcDayKey(t)) - LB.dailyKeepDays;
    const days = this.all('SELECT DISTINCT day FROM daily').map((r) => r.day).filter((d) => !(dayNum(d) >= cut));
    for (const d of days) this.sql.exec('DELETE FROM daily WHERE day = ?', d);
    this.sql.exec('DELETE FROM rated WHERE at < ?', t - 30 * 864e5);
    // a run stuck in 'queued' for an hour (lost verify job) is closed as rejected
    this.sql.exec("UPDATE daily SET st = 'rejected', why = 'lost' WHERE st = 'queued' AND at < ?", t - 3600e3);
    return { pruned: days };
  }

  // ----- main: reading -----
  sidFor(o) { return o.sid === 'last' ? this.getMeta('last', null) : seasonId(); }
  // value, filter and ordering for each board
  spec(o) {
    if (o.board === 'rating') return { from: 'rating', where: 'games >= ?', args: [RATING.provisional], val: 'r', order: 'r DESC, games DESC, at ASC' };
    if (o.board === 'daily') return { from: 'daily', where: "day = ? AND st = 'ok'", args: [o.day], val: 'score', order: 'score DESC, at ASC' };
    if (o.sid === 'last') return { from: 'arch', where: 'sid = ?', args: [this.sidFor(o)], val: 'pts', order: 'rank ASC', arch: true };
    return { from: 'season', where: 'sid = ?', args: [this.sidFor(o)], val: 'pts', order: 'pts DESC, wins DESC, at ASC' };
  }
  pubRow(r, rank, cid) {
    const o = { rank, name: r.name || 'Player', avatar: r.avatar || '', title: r.title || '', v: Math.round(r.v), games: r.games ?? undefined, wins: r.wins ?? undefined };
    if (r.place != null) { o.place = r.place; o.kills = r.kills; }
    if (cid && r.cid === cid) o.me = true;
    return o;
  }
  // abandoned ranked runs: started more than LB.dnfAfter ago (or on an earlier day) and never submitted
  dnfRows(o, limit) {
    const cut = o.day === utcDayKey() || dayNum(o.day) >= dayNum(utcDayKey()) ? Date.now() - LB.dnfAfter : Date.now() + 1;
    return this.all("SELECT * FROM daily WHERE day = ? AND (st = 'dnf' OR (st = 'started' AND at < ?)) ORDER BY at ASC LIMIT ?", o.day, cut, limit);
  }
  dnfCount(o) { return this.dnfRows(o, 100000).length; }
  top(o) {
    const S = this.spec(o);
    if (o.board === 'daily') { const ok = this.topRows(o, S); const d = ok.length < o.n ? this.dnfRows(o, o.n - ok.length).map((r) => ({ ...this.pubRow({ ...r, v: 0 }, 'DNF', o.cid), dnf: true })) : []; return [...ok, ...d]; }
    return this.topRows(o, S);
  }
  topRows(o, S) {
    const rows = this.all(`SELECT *, ${S.val} AS v FROM ${S.from} WHERE ${S.where} ORDER BY ${S.order} LIMIT ?`, ...S.args, o.n);
    let rank = 0, prev = null;
    return rows.map((r, i) => { if (S.arch) rank = r.rank; else if (r.v !== prev) { rank = i + 1; prev = r.v; } return this.pubRow(r, rank, o.cid); });
  }
  count(o) { const S = this.spec(o); return this.one(`SELECT COUNT(*) AS n FROM ${S.from} WHERE ${S.where}`, ...S.args).n; }
  mine(o) {
    const S = this.spec(o);
    const r = this.one(`SELECT *, ${S.val} AS v FROM ${S.from} WHERE ${S.where} AND cid = ?`, ...S.args, o.cid);
    if (!r) return null;
    const rank = S.arch ? r.rank : this.one(`SELECT COUNT(*) AS n FROM ${S.from} WHERE ${S.where} AND ${S.val} > ?`, ...S.args, r.v).n + 1;
    return this.pubRow(r, rank, o.cid);
  }
  around(o, me) {
    if (!me) return [];
    const S = this.spec(o);
    if (S.arch) return this.all(`SELECT *, pts AS v FROM arch WHERE sid = ? AND rank BETWEEN ? AND ? ORDER BY rank`, S.args[0], me.rank - o.k, me.rank + o.k).map((r) => this.pubRow(r, r.rank, o.cid));
    const r = this.one(`SELECT *, ${S.val} AS v FROM ${S.from} WHERE ${S.where} AND cid = ?`, ...S.args, o.cid);
    const above = this.all(`SELECT *, ${S.val} AS v FROM ${S.from} WHERE ${S.where} AND cid != ? AND (${S.val} > ? OR (${S.val} = ? AND at < ?)) ORDER BY ${S.val} ASC, at DESC LIMIT ?`, ...S.args, o.cid, r.v, r.v, r.at, o.k).reverse();
    const below = this.all(`SELECT *, ${S.val} AS v FROM ${S.from} WHERE ${S.where} AND cid != ? AND (${S.val} < ? OR (${S.val} = ? AND at >= ?)) ORDER BY ${S.order} LIMIT ?`, ...S.args, o.cid, r.v, r.v, r.at, o.k);
    const rankOf = (x) => this.one(`SELECT COUNT(*) AS n FROM ${S.from} WHERE ${S.where} AND ${S.val} > ?`, ...S.args, x.v).n + 1;
    return [...above.map((x) => this.pubRow(x, rankOf(x), o.cid)), me, ...below.map((x) => this.pubRow(x, rankOf(x), o.cid))];
  }
  async view(o, what) {
    if (o.board === 'season' && o.sid !== 'last') await this.rollover();
    const head = { board: o.board, day: o.board === 'daily' ? o.day : undefined, sid: o.board === 'season' ? this.sidFor(o) : undefined, ends: o.board === 'season' && o.sid !== 'last' ? seasonEnds(seasonId()) : undefined, last: o.board === 'season' ? this.getMeta('last', null) : undefined, of: this.count(o), dnf: o.board === 'daily' ? this.dnfCount(o) : undefined, at: Date.now() };
    if (what === 'top') return { ...head, top: this.top(o) };
    const me = o.cid ? this.mine(o) : null;
    if (what === 'around') return { ...head, me, around: this.around(o, me) };
    const extra = o.board === 'rating' && o.cid ? this.ratingCard(o.cid) : o.board === 'daily' && o.cid ? this.dailyCard(o.cid, o.day) : null;
    return { ...head, top: this.top(o), me, around: me && me.rank > o.n ? this.around(o, me) : [], card: extra };
  }
  ratingCard(cid) {
    const r = this.one('SELECT * FROM rating WHERE cid = ?', cid);
    if (!r) return { r: RATING.start, games: 0, prov: true, left: RATING.provisional };
    const prov = r.games < RATING.provisional;
    const rank = prov ? null : this.one('SELECT COUNT(*) AS n FROM rating WHERE games >= ? AND r > ?', RATING.provisional, r.r).n + 1;
    return { r: Math.round(r.r), games: r.games, wins: r.wins, peak: Math.round(r.peak), last: r.last, prov, left: Math.max(0, RATING.provisional - r.games), rank, of: this.count({ board: 'rating' }) };
  }
  dailyCard(cid, day) {
    const r = this.one('SELECT * FROM daily WHERE day = ? AND cid = ?', day, cid);
    if (!r) return { st: 'none', day };
    if (r.st === 'dnf') return { st: 'dnf', day };
    if (r.st === 'started') return { st: Date.now() - r.at > LB.dnfAfter || dayNum(day) < dayNum(utcDayKey()) ? 'dnf' : 'started', day };
    const o = { st: r.st, day, score: r.score, place: r.place, kills: r.kills, why: r.why || undefined };
    if (r.st === 'ok') { o.rank = this.one("SELECT COUNT(*) AS n FROM daily WHERE day = ? AND st = 'ok' AND score > ?", day, r.score).n + 1; o.of = this.count({ board: 'daily', day }); }
    return o;
  }
  async me(cid, day) {
    await this.rollover();
    const sid = seasonId(), s = this.mine({ board: 'season', cid });
    return { cid, rating: this.ratingCard(cid), season: { sid, ends: seasonEnds(sid), pts: s ? s.v : 0, rank: s ? s.rank : null, of: this.count({ board: 'season' }), games: s ? s.games : 0 }, daily: this.dailyCard(cid, day) };
  }
  async dailyStatus(cid, day) { return this.dailyCard(cid, day); }

  // ----- main: daily -----
  async startDaily(cid, day, pub) {
    const r = this.one('SELECT st FROM daily WHERE day = ? AND cid = ?', day, cid);
    // another start while the ranked run is still open means that run was abandoned: it is a DNF now
    if (r && r.st === 'started') { this.sql.exec("UPDATE daily SET st = 'dnf' WHERE day = ? AND cid = ?", day, cid); return { ranked: false, st: 'dnf', why: LB.rule }; }
    if (r) return { ranked: false, st: r.st, why: LB.rule };
    this.sql.exec("INSERT INTO daily (day, cid, name, avatar, title, st, at) VALUES (?, ?, ?, ?, ?, 'started', ?)", day, cid, pub.name, pub.avatar, pub.title, Date.now());
    return { ranked: true, st: 'started' };
  }
  async claimDaily(cid, day, pub) {
    const r = this.one('SELECT st, score FROM daily WHERE day = ? AND cid = ?', day, cid);
    if (!r) return { ok: false, st: 'none' };
    if (r.st !== 'started') { if (r.st === 'dnf') return { ok: false, st: 'dnf' }; const c = this.dailyCard(cid, day); return { ok: false, st: r.st, score: c.score, rank: c.rank }; }
    this.sql.exec("UPDATE daily SET st = 'queued', name = ?, avatar = ?, title = ?, at = ? WHERE day = ? AND cid = ?", pub.name, pub.avatar, pub.title, Date.now(), day, cid);
    return { ok: true };
  }
  async dailyDone(cid, day, v) {
    if (v.ok) this.sql.exec("UPDATE daily SET st = 'ok', score = ?, place = ?, kills = ?, dmg = ?, why = NULL, at = ? WHERE day = ? AND cid = ?", v.result.score, v.result.place, v.result.kills, v.result.dmg, Date.now(), day, cid);
    else this.sql.exec("UPDATE daily SET st = 'rejected', why = ?, at = ? WHERE day = ? AND cid = ?", String(v.why || 'rejected').slice(0, 80), Date.now(), day, cid);
    return this.dailyCard(cid, day);
  }

  // ----- verify: the replay queue -----
  async enqueue(job) {
    this.sql.exec('INSERT INTO vq (cid, day, job, at) VALUES (?, ?, ?, ?)', job.cid, job.day, JSON.stringify(job), Date.now());
    const a = await this.ctx.storage.getAlarm(); if (!a) await this.ctx.storage.setAlarm(Date.now());
    return { ok: true, queued: this.one('SELECT COUNT(*) AS n FROM vq').n };
  }
  async kick() { if (this.one('SELECT id FROM vq LIMIT 1') && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now()); }
  // One chunk of engine work per alarm. The job lives in memory between alarms; a checkpoint every 16 chunks lets a
  // restarted object resume instead of starting over.
  async alarm() {
    const head = this.one('SELECT * FROM vq ORDER BY id LIMIT 1');
    if (!head) return;
    if (!this.mem || this.mem.id !== head.id) {
      const job = JSON.parse(head.job), ck = this.one('SELECT * FROM vck WHERE id = ?', head.id);
      let V = null;
      try { V = ck ? JSON.parse(ck.state) : verifyStart(job); } catch (e) { V = { done: true, ok: false, why: 'setup' }; }
      this.mem = { id: head.id, job, V, chunks: ck ? ck.chunks : 0 };
      if (head.at < Date.now() - 600e3) { V.done = true; V.ok = false; V.why = 'timeout'; }
    }
    const M = this.mem;
    const t0 = performance.now();
    try { verifyStep(M.V, M.job.actions); } catch (e) { M.V.done = true; M.V.ok = false; M.V.why = 'engine'; }
    this.cpuNote(performance.now() - t0);
    M.chunks++;
    if (M.V.done) {
      const v = { ok: M.V.ok, why: M.V.why, result: M.V.result };
      // retry the post; 17.3 (QS): at most 30 tries (~1 min), then drop the job (prune() marks the run 'rejected: lost'),
      // so a failing 'main' can no longer keep this object waking every 2 s forever
      try { await main(this.env).dailyDone(M.job.cid, M.job.day, v); } catch (e) { M.posts = (M.posts || 0) + 1; if (M.posts < 30) { await this.ctx.storage.setAlarm(Date.now() + 2000); return; } }
      this.sql.exec('DELETE FROM vq WHERE id = ?', M.id); this.sql.exec('DELETE FROM vck WHERE id = ?', M.id);
      this.noteJob(M);
      this.mem = null;
    } else if (M.chunks % 16 === 0) this.sql.exec('INSERT OR REPLACE INTO vck (id, chunks, state) VALUES (?, ?, ?)', M.id, M.chunks, JSON.stringify(M.V));
    if (this.one('SELECT id FROM vq LIMIT 1')) await this.ctx.storage.setAlarm(Date.now());
  }
  cpuNote(ms) {
    const c = this.cpuMem || (this.cpuMem = this.getMeta('cpu', { n: 0, sum: 0, max: 0, over5: 0, hist: [0, 0, 0, 0, 0, 0] }));
    c.n++; c.sum += ms; c.max = Math.max(c.max, ms); if (ms > 5) c.over5++;
    c.hist[ms < 1 ? 0 : ms < 2 ? 1 : ms < 3 ? 2 : ms < 5 ? 3 : ms < 8 ? 4 : 5]++;
  }
  noteJob(M) { const c = this.cpuMem; if (!c) return; c.jobs = (c.jobs || 0) + 1; c.chunksPerJob = M.chunks; this.setMeta('cpu', c); }
  async cpu(reset) { const c = this.cpuMem || this.getMeta('cpu', null); if (reset) { this.cpuMem = null; this.setMeta('cpu', { n: 0, sum: 0, max: 0, over5: 0, hist: [0, 0, 0, 0, 0, 0] }); } return { ...(c || {}), units: VERIFY.units, queued: this.one('SELECT COUNT(*) AS n FROM vq').n }; }
  // test hook: verify synchronously (still chunked), returning the verdict and per-chunk wall times
  async verifyNow(job, budget) {
    const V = verifyStart(job), times = []; let guard = 0;
    while (!V.done && guard++ < 100000) { const t0 = performance.now(); verifyStep(V, job.actions, budget ? { ...VERIFY, ...budget } : VERIFY); times.push(performance.now() - t0); }
    return { ok: V.ok, why: V.why, result: V.result, chunks: times.length, max: Math.max(...times), plans: V.plans };
  }
  async reset() { for (const t of ['meta', 'rating', 'season', 'arch', 'daily', 'rated', 'vq', 'vck']) this.sql.exec(`DELETE FROM ${t}`); this.mem = null; this.cpuMem = null; return true; }
  async testAge(cid, day, ms) { this.sql.exec('UPDATE daily SET at = at - ? WHERE day = ? AND cid = ?', ms, day, cid); return this.dailyCard(cid, day); }
  async testRows(b) {
    const t = Date.now(); let i = 0;
    for (const r of (b && b.rows) || []) {
      const cid = String(r.cid), at = t - 1000 + (i++);
      if (b.board === 'rating') this.sql.exec('INSERT OR REPLACE INTO rating (cid, name, avatar, title, r, games, wins, peak, last, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)', cid, r.name, r.avatar || '', r.title || '', r.v, r.games ?? 20, r.wins ?? 0, r.v, at);
      else if (b.board === 'daily') this.sql.exec("INSERT OR REPLACE INTO daily (day, cid, name, avatar, title, st, score, place, kills, dmg, at) VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, ?, 0, ?)", b.day, cid, r.name, r.avatar || '', r.title || '', r.v, r.place ?? 1, r.kills ?? 0, at);
      else this.sql.exec('INSERT OR REPLACE INTO season (sid, cid, name, avatar, title, pts, games, wins, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', b.sid || seasonId(), cid, r.name, r.avatar || '', r.title || '', r.v, r.games ?? 1, r.wins ?? 0, at);
    }
    return { n: i };
  }
}

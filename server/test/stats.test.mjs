// 17.0 (A): Stats DO + /admin tests against a running wrangler dev with an admin key:
//   cd server && npx wrangler dev --local --port 8791 --var ADMIN_KEY:test      (--local: the AI binding needs it offline)
//   node test/stats.test.mjs [url=http://127.0.0.1:8791] [--nokey]   (--nokey also spawns a keyless dev on 8792: /admin must 404)
// Records land on a random past UTC day (20..80 days ago) and every check is a before/after delta, so reruns on the same
// persisted state are fine.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMatch, applyAction, planBot, planHollow, unitById } from '../../js/engine.js';
import { facts, addFacts, dayKey, weekKey, record, replayAll } from '../src/stats.js';
import { roster } from '../../tools/run.mjs';

const BASE = (process.argv.slice(2).find((a) => a.startsWith('http')) || process.env.STATS_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
const KEY = process.env.ADMIN_KEY || 'test', AUTH = { Authorization: 'Bearer ' + KEY };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const assert = (c, m) => { if (!c) throw new Error(m); };
async function check(name, f) { try { const r = await f(); pass++; console.log('ok   ' + name + (r ? '  ' + r : '')); } catch (e) { fail++; console.log('FAIL ' + name + '  ' + (e && e.stack || e)); } }
const get = (p, h = AUTH) => fetch(BASE + p, { headers: h, redirect: 'manual' });
const post = (p, body, h = AUTH) => fetch(BASE + p, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const DAYMS = 864e5;
const at = Date.now() - (20 + Math.floor(Math.random() * 60)) * DAYMS, D = dayKey(at);

// rows of a period as a map m|dim|k -> [n, win, place, top3, x, y]
async function snap(r) {
  const j = await (await get(`/admin/data?r=${r}&d=${D}`)).json();
  const o = new Map(); for (const x of j.rows) o.set(x.m + '|' + x.dim + '|' + x.k, [x.n, x.win, x.place, x.top3, x.x, x.y]); return o;
}
function compare(before, after, want, period) { // want: addFacts map; check every key of `period`
  let n = 0;
  for (const [key, v] of want) {
    const [p, ...rest] = key.split('|'); if (p !== period) continue;
    const k = rest.join('|'), a = after.get(k) || [0, 0, 0, 0, 0, 0], b = before.get(k) || [0, 0, 0, 0, 0, 0];
    const d = a.map((x, i) => x - b[i]);
    assert(JSON.stringify(d) === JSON.stringify(v), `${period} ${k}: got ${JSON.stringify(d)} want ${JSON.stringify(v)}`); n++;
  }
  return n;
}
async function settle() { for (let i = 0; i < 200; i++) { const s = await (await get('/admin/status')).json(); if (!s.queue) return s; await sleep(150); } throw new Error('replay queue did not drain'); }

// ---------------------------------------------------------------- synthetic records (final state given)
const P = (o) => ({ kind: 'player', alive: false, hp: 0, kills: 0, dmgDealt: 0, hone: {}, status: [], pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: 'regen', equips: { pawn: 'tripwire', knight: 'lance' }, ...o });
const tag = Math.random().toString(36).slice(2, 8);
function synth(i) {
  const units = [
    P({ id: 1, pid: 'h1', piece: 'king', kingFrom: 'queen', alive: true, place: 1, kills: 4, dmgDealt: 900, pts: { hp: 4, atk: 3, def: 1, spd: 2 }, passive: 'thorns' }), // Bruiser preset, human, won as King
    P({ id: 2, pid: 'h2', piece: 'queen', hone: { queen: 3 }, place: 2, kills: 2, equips: { pawn: 'tripwire', queen: 'gambit' } }), // human, Ascended queen, custom pts
    P({ id: 3, pid: 'b1', bot: true, plan: 'pawn', piece: 'champion', place: 3, kills: 1, pts: { hp: 3, atk: 3, def: 1, spd: 3 }, passive: 'scavenger' }), // Scout bot
    P({ id: 4, pid: 'b2', bot: true, plan: 'rook', piece: 'rook', place: 4 }),
    { id: 9, kind: 'hollow', piece: 'pawn', alive: false },
  ];
  return { mid: `syn-${tag}-${i}`, at: at + i * 1000, mode: i % 2 ? 'royale' : 'chaos', location: 'forge', seats: { h1: { name: 'Ann', cid: 'c1' }, h2: { name: 'Bo', cid: 'c2', drops: 1 } }, leaves: 1,
    actions: [['h1', { type: 'end' }], ['h2', { type: 'end' }, 1]], result: { rounds: 12 }, state: { units, winner: 1, round: 12, turnNo: 40, mode: 'royale', location: 'forge', teams: 0 } };
}
// ---------------------------------------------------------------- one real match through the engine (no final state: the DO replays it)
function realMatch() {
  const players = roster(6, 11).map((p, i) => (i < 2 ? { pid: 'hum' + i, name: 'Human' + i, build: p.build } : p));
  const seed = 9001, opts = { mode: 'royale' };
  const s = createMatch(structuredClone(players), seed, structuredClone(opts));
  const actions = [];
  while (!s.over && actions.length < 20000) {
    const u = unitById(s, s.active), turn = s.turnNo;
    const plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    for (const a of plan) { if (applyAction(s, u.pid, a).ok) actions.push([u.pid, a]); if (s.turnNo !== turn || s.over) break; }
    if (s.turnNo === turn && !s.over && applyAction(s, u.pid, { type: 'end' }).ok) actions.push([u.pid, { type: 'end' }]);
  }
  const rec = { mid: `real-${tag}`, at: at + 5000, start: { players, seed, opts }, actions, seats: { hum0: { name: 'Human0', cid: 'x0' }, hum1: { name: 'Human1', cid: 'x1' } }, mode: 'royale', location: s.location, result: { winner: s.winner, rounds: s.round, places: s.units.filter((u) => u.kind === 'player').map((u) => [u.pid, u.place]) } };
  return { rec, s };
}

// ---------------------------------------------------------------- auth
await check('unauthenticated: /admin -> 401 login page, /admin/data + /admin/csv -> 401 json, no data leaks', async () => {
  const a = await get('/admin', {}); const t = await a.text();
  assert(a.status === 401 && /type="password"/.test(t) && !/Match Stats/.test(t), 'login page ' + a.status);
  assert((a.headers.get('cache-control') || '').includes('no-store') && /frame-ancestors 'none'/.test(a.headers.get('content-security-policy') || ''), 'headers');
  for (const p of ['/admin/data?r=all', '/admin/csv?r=all', '/admin/status']) { const r = await get(p, {}); assert(r.status === 401, p + ' ' + r.status); assert(!/rows|range,mode/.test(await r.text()), p + ' leaked'); }
  const w = await get('/admin/data', { Authorization: 'Bearer nope' }); assert(w.status === 401, 'wrong bearer ' + w.status);
  const c = await get('/admin/data', { Cookie: 'cc_admin=test' }); assert(c.status === 401, 'raw key as cookie ' + c.status);
  const r = await post('/admin/record', synth(99), {}); assert(r.status === 401, 'record unauth ' + r.status);
});
let cookie = '';
await check('/admin?key= sets an HttpOnly SameSite cookie (hash, not the key) and redirects; cookie opens the dashboard; logout clears it', async () => {
  const bad = await get('/admin?key=wrong', {}); assert(bad.status === 401 && /Wrong key/.test(await bad.text()), 'wrong key ' + bad.status);
  const r = await get('/admin?key=' + KEY, {}); const sc = r.headers.get('set-cookie') || '';
  assert(r.status === 302 && r.headers.get('location') === '/admin', 'redirect ' + r.status);
  assert(/HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && /Path=\/admin/.test(sc) && !sc.includes('=' + KEY + ';'), 'cookie ' + sc);
  cookie = sc.split(';')[0];
  const p = await get('/admin', { Cookie: cookie }); const t = await p.text();
  assert(p.status === 200 && /Match Stats/.test(t) && /<svg/.test(t) && !/https?:\/\/(?!www\.w3)/.test(t.replace(/xmlns="[^"]*"/g, '')), 'page');
  assert((await get('/admin/data?r=all', { Cookie: cookie })).status === 200, 'data via cookie');
  const lo = await get('/admin/logout', { Cookie: cookie }); assert(lo.status === 302 && /Max-Age=0/.test(lo.headers.get('set-cookie') || ''), 'logout');
});
await check('Bearer works for every admin route; non-admin paths untouched', async () => {
  for (const p of ['/admin', '/admin/data?r=day', '/admin/csv?r=week', '/admin/status']) { const r = await get(p); assert(r.status === 200, p + ' ' + r.status); }
  assert((await get('/admin/nope')).status === 404, 'unknown admin path');
  assert((await get('/health', {})).status === 200, 'health');
});

// ---------------------------------------------------------------- aggregation
const want = new Map();
await check('synthetic records aggregate per UTC day and ISO week (deltas exact, dedupe by mid)', async () => {
  const bD = await snap('day'), bW = await snap('week');
  const recs = [0, 1, 2, 3].map(synth);
  for (const r of recs) { const res = await (await post('/admin/record', r)).json(); assert(res.ok === true, 'record ' + JSON.stringify(res)); addFacts(want, facts(r, r.state)); }
  assert((await (await post('/admin/record', recs[0])).json()).ok, 'dup post'); // must not count twice
  const aD = await snap('day'), aW = await snap('week');
  const n1 = compare(bD, aD, want, 'd' + D), n2 = compare(bW, aW, want, 'w' + weekKey(at));
  // a few hand checks on top of the shared addFacts
  const dv = (k) => { const a = aD.get(k) || [0, 0, 0, 0, 0, 0], b = bD.get(k) || [0, 0, 0, 0, 0, 0]; return a.map((x, i) => x - b[i]); };
  assert(dv('royale|meta|matches')[0] === 2 && dv('chaos|meta|matches')[0] === 2, 'matches by mode');
  assert(dv('royale|piece.h|king').slice(0, 3).join() === '2,2,2', 'king human win ' + dv('royale|piece.h|king'));
  assert(dv('royale|piece.h|asc-queen')[0] === 2 && dv('royale|piece.h|asc-queen')[1] === 0, 'ascended queen');
  assert(dv('chaos|road.b|pawn')[0] === 2 && dv('chaos|road.h|ascend')[0] === 2 && dv('chaos|road.h|queen')[0] === 2, 'roads (bot plan, human inferred)');
  assert(dv('royale|preset.h|bruiser')[1] === 2 && dv('royale|preset.h|custom')[0] === 2 && dv('royale|preset.b|scout')[0] === 2, 'presets');
  assert(dv('royale|ability.h|gambit')[0] === 2 && dv('royale|ability.h|tripwire')[0] === 4, 'ability picks');
  assert(dv('royale|meta|drops')[0] === 2 && dv('royale|meta|leaves')[0] === 2 && dv('royale|meta|timeouts')[0] === 2 && dv('royale|meta|kingWin')[0] === 2 && dv('royale|meta|humanWin')[0] === 2, 'meta ' + dv('royale|meta|drops'));
  assert(dv('royale|loc|forge')[0] === 2 && dv('royale|loc|forge')[4] === 24, 'loc + rounds');
  return `${n1} day keys, ${n2} week keys`;
});
let real;
await check('a real bot match (start + actions only) is replayed by the DO in chunks and matches the local final state', async () => {
  const { rec, s } = realMatch(); real = rec;
  const local = replayAll(JSON.parse(JSON.stringify(rec)));
  assert(JSON.stringify(local.units) === JSON.stringify(s.units), 'local replay determinism');
  const one = new Map(); addFacts(one, facts(rec, s));
  const bD = await snap('day');
  const r = await (await post('/admin/record', rec)).json(); assert(r.ok, 'record');
  await settle();
  const aD = await snap('day');
  const n = compare(bD, aD, one, 'd' + D);
  for (const [k, v] of one) { const o = want.get(k) || [0, 0, 0, 0, 0, 0]; want.set(k, o.map((x, i) => x + v[i])); }
  const f = facts(rec, s);
  return `${rec.actions.length} actions, ${n} keys; humans ${f.M.humans} bots ${f.M.bots}, winner ${f.wp}, rounds ${f.M.rounds}`;
});
await check('dashboard data: recent matches, per-day series, ranges (day/week/7d/30d/all, mode filter)', async () => {
  const j = await (await get(`/admin/data?r=30d&d=${D}`)).json();
  assert(j.days.some((x) => x.day === D && x.n >= 5), 'days series');
  const j2 = await (await get(`/admin/data?r=day&d=${D}`)).json();
  assert(j2.recent.some((x) => x.mid === real.mid && x.humans === 2) && j2.recent.some((x) => x.mid === `syn-${tag}-0` && x.wp === 'king' && x.hwin === 1), 'recent');
  const jm = await (await get(`/admin/data?r=day&d=${D}&m=chaos`)).json();
  assert(jm.rows.length && jm.rows.every((x) => x.m === 'chaos'), 'mode filter');
  const ja = await (await get('/admin/data?r=all')).json(); assert(ja.range === 'all' && ja.rows.length, 'all');
  const j7 = await (await get(`/admin/data?r=7d&d=${D}`)).json(); assert(j7.from === dayKey(Date.parse(D) - 6 * DAYMS) && j7.to === D, '7d bounds');
});
await check('CSV export: header, one line per row, attachment, quoted values', async () => {
  const r = await get(`/admin/csv?r=day&d=${D}`); const t = await r.text(); const L = t.trim().split('\n');
  assert(r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && /attachment; filename="cc-stats-day-/.test(r.headers.get('content-disposition')), 'headers');
  assert(L[0] === 'range,mode,dim,who,key,n,wins,win_rate,avg_place,top3_rate,sum_x,sum_y', 'header ' + L[0]);
  const king = L.find((l) => l.startsWith(`${D},royale,piece,human,king,`)); assert(king, 'king row');
  const c = king.split(','); assert(+c[5] >= 2 && +c[7] > 0 && +c[8] >= 1, 'king row values ' + king);
  const j = await (await get(`/admin/data?r=day&d=${D}`)).json(); assert(L.length - 1 === j.rows.length, `rows ${L.length - 1} vs ${j.rows.length}`);
  const wk = await get(`/admin/csv?r=week&d=${D}&m=royale`); const wt = await wk.text(); assert(wt.split('\n').slice(1).filter(Boolean).every((l) => l.split(',')[1] === 'royale'), 'week + mode csv');
  return `${L.length - 1} rows`;
});
await check('record() never throws and resolves false on junk', async () => {
  const bad = [[null, null], [{}, {}], [{ STATS: { idFromName() { throw new Error('x'); } } }, synth(1)], [{ STATS: { idFromName: () => 1, get: () => ({ fetch: () => Promise.reject(new Error('down')) }) } }, synth(1)], [{ STATS: {} }, { start: 5, actions: 'x' }]];
  for (const [env, rec] of bad) { const r = await record(env, rec); assert(r === false, 'resolved ' + r); }
  let body = null; const fake = { STATS: { idFromName: (n) => n, get: () => ({ fetch: async (u, o) => { body = JSON.parse(o.body); return new Response('{}'); } }) } };
  assert(await record(fake, synth(5)) === true && body.facts && body.facts.P.length === 4 && !body.rec, 'state path sends facts only');
  assert(await record(fake, realMatch().rec) === true && body.rec && !body.facts && body.rec.actions.length > 50, 'replay path sends the record');
});
if (process.argv.includes('--nokey')) {
  await check('ADMIN_KEY unset: every /admin path is 404 (even with a Bearer)', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..'), PORT = 8792;
    const proc = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', mkdtempSync(join(tmpdir(), 'a17n-'))], { cwd: root, stdio: 'ignore', detached: true });
    try {
      let up = false; for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch {} }
      assert(up, 'keyless dev did not start');
      for (const p of ['/admin', '/admin?key=test', '/admin/data', '/admin/csv', '/admin/record']) { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { Authorization: 'Bearer test' }, redirect: 'manual' }); assert(r.status === 404 && !r.headers.get('set-cookie'), p + ' ' + r.status); }
    } finally { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} }
  });
}
console.log(`\nstats: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);

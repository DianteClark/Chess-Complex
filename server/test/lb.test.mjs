// 17.0 (L2): leaderboard tests. Unit tests for the rating math + Node CPU of the Daily verifier, then integration
// tests against a running `wrangler dev` with the board test hooks:
//   cd server && npx wrangler dev --local --port 8789 --var LB_TEST:1 --persist-to /tmp/l2persist
//   node test/lb.test.mjs [http://127.0.0.1:8789]
import { kFactor, rateMatch, expected, seasonId, seasonPoints, verifyStart, verifyStep, VERIFY, RATING } from '../src/lbcore.js';
import { utcDayKey } from '../../js/daily.js';
import { protoVer } from '../../js/statehash.js';
import { simDaily } from './lbsim.mjs';

const BASE = (process.argv[2] || process.env.LB || 'http://127.0.0.1:8789').replace(/\/$/, '');
const VER = protoVer();
let pass = 0, failN = 0;
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
async function check(name, f) {
  try { const r = await f(); pass++; console.log('ok  ', name, r != null ? '- ' + r : ''); } catch (e) { failN++; console.log('FAIL', name, '-', e.message); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, body: await r.json() }; };
const post = async (p, b, h = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const cidN = (i) => ('T' + String(i).padStart(9, '0')).replace(/[ILOU]/g, 'X');
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

// ---------------------------------------------------------------- rating math (no server)
await check('K-factor: provisional 48, then 32 decaying to 16', () => {
  assert(kFactor(0) === 48 && kFactor(9) === 48, 'prov');
  assert(kFactor(10) === 32 && kFactor(50) === 24 && kFactor(90) === 16 && kFactor(500) === 16, `decay ${kFactor(10)} ${kFactor(50)} ${kFactor(90)}`);
  for (let g = 10; g < 200; g++) assert(kFactor(g + 1) <= kFactor(g), 'monotone');
  return '';
});
await check('equal ratings: winner gains, last loses, zero-sum', () => {
  const e = [1, 2, 3, 4].map((p) => ({ key: 'p' + p, r: 1200, games: 20, place: p }));
  const d = rateMatch(e).map((x) => x.delta);
  assert(d[0] > d[1] && d[1] > d[2] && d[2] > d[3] && d[0] > 0 && d[3] < 0, d.join());
  assert(Math.abs(d.reduce((a, b) => a + b, 0)) < 0.5, 'sum ' + d.reduce((a, b) => a + b, 0));
  return d.join(' ');
});
await check('upset: a low-rated winner gains more than a favourite', () => {
  const up = rateMatch([{ key: 'a', r: 1000, games: 30, place: 1 }, { key: 'b', r: 1400, games: 30, place: 2 }])[0].delta;
  const fav = rateMatch([{ key: 'a', r: 1400, games: 30, place: 1 }, { key: 'b', r: 1000, games: 30, place: 2 }])[0].delta;
  assert(up > fav && fav > 0, `${up} ${fav}`); assert(Math.abs(expected(1400, 1000) - 0.909) < 0.01, 'E');
  return `upset +${up}, favourite +${fav}`;
});
await check('ties draw, provisional players move faster, lobby size does not inflate swings', () => {
  const t = rateMatch([{ key: 'a', r: 1200, games: 20, place: 2 }, { key: 'b', r: 1200, games: 20, place: 2 }]);
  assert(t[0].delta === 0 && t[1].delta === 0, 'tie');
  const p = rateMatch([{ key: 'a', r: 1200, games: 0, place: 1 }, { key: 'b', r: 1200, games: 40, place: 2 }]);
  assert(p[0].delta > -p[1].delta, 'prov K');
  const two = rateMatch([{ key: 'a', r: 1200, games: 20, place: 1 }, { key: 'b', r: 1200, games: 20, place: 2 }])[0].delta;
  const eight = rateMatch([1, 2, 3, 4, 5, 6, 7, 8].map((pl) => ({ key: 'p' + pl, r: 1200, games: 20, place: pl })))[0].delta;
  assert(Math.abs(two - eight) < 0.01, `${two} vs ${eight}`);
  return `1v1 win ${two}, 8p win ${eight}`;
});
await check('season ids are Monday-based UTC weeks; points ordered by place', () => {
  assert(seasonId(Date.parse('2026-11-04T12:00:00Z')) === '2026-11-02', seasonId(Date.parse('2026-11-04T12:00:00Z')));
  assert(seasonId(Date.parse('2026-11-08T23:59:59Z')) === '2026-11-02' && seasonId(Date.parse('2026-11-09T00:00:00Z')) === '2026-11-09', 'edges');
  const p = [1, 2, 4, 8].map((pl) => seasonPoints('royale', pl, 8, pl === 1));
  assert(p[0] > p[1] && p[1] > p[2] && p[2] > p[3] && p[3] === 10, p.join());
  return p.join(' ');
});

// ---------------------------------------------------------------- daily verifier in Node (CPU per chunk)
const DAY = utcDayKey();
const H = { name: 'Honest', skin: 'ivory', title: 'Recruit' };
let honest;
await check('Node: honest Daily runs verify; chunk CPU', () => {
  const times = []; let n = 0, acts = 0, plans = 0;
  for (let d = 1; d <= 8; d++) {
    const day = '2026-10-' + d, r = simDaily(day, H); acts += r.log.length;
    const V = verifyStart({ day, human: H });
    while (!V.done) { const c0 = process.cpuUsage(); verifyStep(V, r.log, { ...VERIFY, maxMs: 1e9 }); const c = process.cpuUsage(c0); if (d > 1) times.push((c.user + c.system) / 1000); }
    assert(V.ok, day + ' ' + V.why); assert(V.result.score === r.result.score, 'score'); n++; plans += V.plans;
  }
  assert(q(times, 0.95) < 5, 'p95 chunk CPU ' + q(times, 0.95).toFixed(2) + ' ms');
  honest = simDaily(DAY, H);
  return `${n} runs, ${Math.round(acts / n)} actions + ${Math.round(plans / n)} bot plans per run, ${times.length} chunks: p50 ${q(times, 0.5).toFixed(2)} / p95 ${q(times, 0.95).toFixed(2)} / p99 ${q(times, 0.99).toFixed(2)} / max ${Math.max(...times).toFixed(2)} ms (budget ${VERIFY.units} units = 1 bot plan)`;
});

// ---------------------------------------------------------------- server
const up = await fetch(BASE + '/health').then((r) => r.ok, () => false);
if (!up) { console.log(`\nserver ${BASE} not reachable: skipped integration tests`); console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN ? 1 : 0); }
await post('/lb/test/reset', {});

const now = Date.now();
const rec = (mid, seats, o = {}) => ({
  v: 1, mid, mode: o.mode || 'royale', t1: o.t1 || now, start: { players: [], seed: 1, opts: o.custom ? { mode: 'royale', custom: { turnMs: 20000 } } : { mode: o.mode || 'royale' } },
  humans: Object.fromEntries(seats.map((s) => [s.pid, { name: s.name || s.pid, cid: s.cid || null, verified: s.verified !== false && !!s.cid, title: '', avatar: { piece: 'knight', skin: null } }])),
  result: { places: [...seats.map((s) => ({ pid: s.pid, place: s.place, bot: false, team: null })), ...Array.from({ length: o.bots || 0 }, (_, i) => ({ pid: 'bot' + i, place: seats.length + i + 1, bot: true, team: null }))], winnerPid: seats.find((s) => s.place === 1)?.pid, siegeWon: !!o.siegeWon },
});
const A = cidN(1), B = cidN(2), C = cidN(3);

await check('rate(): 2 verified humans move ratings; unverified + bots ignored; replays of the same mid ignored', async () => {
  const r = await post('/lb/test/rate', { rec: rec('m1', [{ pid: 'a', cid: A, place: 1 }, { pid: 'b', cid: B, place: 3 }, { pid: 'c', cid: C, place: 2, verified: false }], { bots: 5 }) });
  assert(r.body.r && r.body.r.rated && r.body.r.seats.length === 2, JSON.stringify(r.body));
  const [a, b] = r.body.r.seats; assert(a.delta > 0 && b.delta < 0 && Math.abs(a.delta + b.delta) < 0.2, JSON.stringify(r.body.r.seats));
  const again = await post('/lb/test/rate', { rec: rec('m1', [{ pid: 'a', cid: A, place: 1 }, { pid: 'b', cid: B, place: 3 }]) });
  assert(again.body.r.dup, 'dup');
  const me = (await get('/lb/me?cid=' + C)).body; assert(me.rating.games === 0 && me.season.pts === 0, 'unverified untouched');
  return `A ${a.delta > 0 ? '+' : ''}${a.delta} B ${b.delta}`;
});
await check('rate(): one verified human vs bots earns nothing; custom rules and co-op: season points, no rating', async () => {
  const solo = await post('/lb/test/rate', { rec: rec('m2', [{ pid: 'a', cid: A, place: 1 }], { bots: 7 }) });
  assert(solo.body.r === null, 'solo ' + JSON.stringify(solo.body));
  const cu = await post('/lb/test/rate', { rec: rec('m3', [{ pid: 'a', cid: A, place: 2 }, { pid: 'b', cid: B, place: 1 }], { custom: true }) });
  assert(cu.body.r && !cu.body.r.rated && cu.body.r.seats.every((s) => s.pts > 0), 'custom ' + JSON.stringify(cu.body));
  const co = await post('/lb/test/rate', { rec: rec('m4', [{ pid: 'a', cid: A, place: 1 }, { pid: 'b', cid: B, place: 1 }], { mode: 'siege', siegeWon: true }) });
  assert(co.body.r && !co.body.r.rated && co.body.r.seats.every((s) => s.pts === 40), 'coop ' + JSON.stringify(co.body));
  const me = (await get('/lb/me?cid=' + A)).body; assert(me.rating.games === 1 && me.season.games === 3, JSON.stringify(me));
  return `A season ${me.season.pts} pts, rank ${me.season.rank}/${me.season.of}`;
});
await check('provisional: hidden from the Crown Rating board until 10 games, then ranked', async () => {
  let top = (await get('/lb/top?board=rating')).body; assert(top.top.length === 0, 'prov hidden');
  for (let i = 0; i < 10; i++) await post('/lb/test/rate', { rec: rec('p' + i, [{ pid: 'a', cid: A, place: 1 + (i % 3 === 2 ? 1 : 0) }, { pid: 'b', cid: B, place: 2 - (i % 3 === 2 ? 1 : 0) }]) });
  const me = (await get('/lb/me?cid=' + A)).body.rating;
  assert(!me.prov && me.games === 11 && me.rank === 1, JSON.stringify(me));
  top = (await get('/lb/top?board=rating&n=10')).body; assert(top.top.length === 2 && top.top[0].v === me.r, JSON.stringify(top));
  const v = (await get(`/lb/view?board=rating&cid=${B}`)).body; assert(v.top.some((r) => r.me) && v.card && v.card.rank === 2, JSON.stringify(v.card));
  return `A ${me.r} (peak ${me.peak}, K now ${kFactor(me.games)}), B ${top.top[1].v}`;
});

await check('season rollover (test hook): last week archived (top 100 kept), new week starts empty', async () => {
  const lastSid = seasonId(now - 7 * 864e5);
  const rows = Array.from({ length: 120 }, (_, i) => ({ cid: cidN(100 + i), name: 'S' + i, v: 1000 - i * 3, wins: i % 4 }));
  await post('/lb/test/rowset', { board: 'season', sid: lastSid, rows });
  const r = (await post('/lb/test/rollover', { now })).body;
  assert(r.rolled && r.archived && r.archived.sid === lastSid && r.archived.kept === 100, JSON.stringify(r));
  const last = (await get('/lb/top?board=season&sid=last&n=100')).body;
  assert(last.sid === lastSid && last.top.length === 100 && last.top[0].name === 'S0' && last.top[99].name === 'S99', `${last.sid} ${last.top.length}`);
  const cur = (await get('/lb/top?board=season')).body; assert(cur.sid === seasonId(now) && cur.top.every((x) => !x.name.startsWith('S')), 'current clean');
  const again = (await post('/lb/test/rollover', { now })).body; assert(!again.rolled, 'idempotent');
  // a match finishing next Monday rolls the week over by itself (missed cron)
  const next = now + 7 * 864e5;
  await post('/lb/test/rate', { rec: rec('w2', [{ pid: 'a', cid: A, place: 1 }, { pid: 'b', cid: B, place: 2 }], { t1: next }) });
  const r3 = (await post('/lb/test/rollover', { now: next })).body; assert(!r3.rolled && r3.sid === seasonId(next), JSON.stringify(r3));
  const last2 = (await get('/lb/top?board=season&sid=last')).body; assert(last2.sid === seasonId(now) && last2.top[0].me === undefined && last2.top.length === 2, JSON.stringify(last2).slice(0, 200));
  return `archived ${lastSid} (100 of 120), then ${seasonId(now)} on the next rollover`;
});

await check('around-me + pinned row when outside the top N', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ cid: cidN(300 + i), name: 'D' + i, v: 5000 - i * 10, place: 1 + (i % 8), kills: i % 5 }));
  await post('/lb/test/rowset', { board: 'daily', day: '2026-1-1', rows });
  const v = (await get(`/lb/view?board=daily&day=2026-1-1&cid=${cidN(340)}&n=10&k=3`)).body;
  assert(v.top.length === 10 && v.of === 60 && v.me && v.me.rank === 41 && v.me.me, JSON.stringify(v.me));
  assert(v.around.length === 7 && v.around.map((r) => r.rank).join() === '38,39,40,41,42,43,44', v.around.map((r) => r.rank).join());
  const ar = (await get(`/lb/around?board=daily&day=2026-1-1&cid=${cidN(300)}&k=2`)).body; assert(ar.around.map((r) => r.rank).join() === '1,2,3', 'top edge');
  const bad = await get('/lb/view?board=nope&cid=' + A); assert(bad.status === 400, 'bad board');
  return `rank 41/60, around ${v.around.map((r) => r.rank).join(',')}`;
});

// ---------------------------------------------------------------- daily: real cloud players + verification
async function newPlayer() { const r = await fetch(BASE + '/player/new', { method: 'POST' }); assert(r.status === 201, 'player/new ' + r.status); return r.json(); }
const submit = (P, body, secret = P.secret) => post('/lb/daily', { cid: P.id, day: DAY, ver: VER, name: H.name, title: H.title, skin: H.skin, avatar: { piece: 'queen', skin: 'ivory' }, ...body }, { Authorization: 'Bearer ' + secret });
const startRun = (P, secret = P.secret, day = DAY) => post('/lb/daily/start', { cid: P.id, day, name: H.name, title: H.title, avatar: { piece: 'queen', skin: 'ivory' } }, { Authorization: 'Bearer ' + secret });
// the honest client flow: register the start, play, submit
const ranked = async (P, body) => { const s = await startRun(P); assert(s.status === 200 && s.body.ranked, 'start ' + JSON.stringify(s.body)); return submit(P, body); };
async function waitDone(P) { for (let i = 0; i < 200; i++) { const s = (await get(`/lb/daily/status?cid=${P.id}&day=${DAY}`)).body; if (s.st !== 'queued') return s; await sleep(100); } throw new Error('verify timeout'); }

let P1;
await check('Daily: an honest run is verified on the server (chunked across alarms) and ranked', async () => {
  await get('/lb/test/cpu?reset=1');
  P1 = await newPlayer();
  const t0 = Date.now();
  const r = await ranked(P1, { actions: honest.log });
  assert(r.status === 202 && r.body.st === 'queued', JSON.stringify(r));
  const s = await waitDone(P1);
  assert(s.st === 'ok' && s.score === honest.result.score && s.rank === 1, JSON.stringify(s));
  const cpu = (await get('/lb/test/cpu')).body;
  assert(cpu.chunksPerJob > 10, 'chunked ' + cpu.chunksPerJob);
  return `score ${s.score} (place ${s.place}), ${honest.log.length} actions in ${cpu.chunksPerJob} alarms, ${Date.now() - t0} ms end to end`;
});
await check('Daily: one ranked run per player per day (second submission refused)', async () => {
  const r = await submit(P1, { actions: honest.log });
  assert(r.status === 409 && r.body.st === 'ok' && r.body.score === honest.result.score, JSON.stringify(r));
  return r.body.why;
});
await check('Daily: auth + shape + version + day window checks (nothing claimed)', async () => {
  const P = await newPlayer();
  assert((await submit(P, { actions: honest.log }, '0000000000000000')).status === 401, 'bad secret');
  assert((await submit(P, { actions: honest.log, ver: 'old' })).status === 409, 'ver');
  assert((await submit(P, { actions: honest.log, day: '2020-1-1' })).status === 409, 'day');
  assert((await submit(P, { actions: 'x' })).status === 400, 'shape');
  assert((await startRun(P, '0000000000000000')).status === 401, 'start bad secret');
  assert((await startRun(P, P.secret, '2020-1-1')).status === 409, 'start closed day');
  const s = (await get(`/lb/daily/status?cid=${P.id}&day=${DAY}`)).body; assert(s.st === 'none', 'unclaimed ' + s.st);
  const ok = await ranked(P, { actions: honest.log }); assert(ok.status === 202, 'still allowed'); const d = await waitDone(P); assert(d.st === 'ok', d.st);
  return '401 / 409 update / 409 day / 400, then accepted';
});
const tamperCases = [
  ['a bot action changed', (L) => { const i = L.findIndex((e, j) => j > 30 && e[0] && e[0].startsWith('bot') && e[1].type === 'move'); const c = structuredClone(L); c[i][1].x = (c[i][1].x + 1) % 16; return c; }],
  ['a bot action dropped', (L) => { const i = L.findIndex((e, j) => j > 30 && e[0] && e[0].startsWith('bot') && e[1].type !== 'end'); return L.filter((_, j) => j !== i); }],
  ['an illegal player move', (L) => { const i = L.findIndex((e) => e[0] === 'me' && e[1].type === 'move'); const c = structuredClone(L); c[i][1].x = 0; c[i][1].y = 0; return c; }],
  ['a player action as a bot', (L) => { const i = L.findIndex((e, j) => j > 10 && e[0] && e[0].startsWith('bot')); const c = structuredClone(L); c[i][0] = 'me'; return c; }],
  ['the run cut short', (L) => L.slice(0, Math.floor(L.length / 3))],
  ['extra actions after the end', (L) => [...L, ['me', { type: 'end' }]]],
];
for (const [name, f] of tamperCases) {
  await check('Daily: rejects ' + name, async () => {
    const P = await newPlayer();
    const r = await ranked(P, { actions: f(honest.log) }); assert(r.status === 202, 'queued ' + r.status);
    const s = await waitDone(P); assert(s.st === 'rejected', JSON.stringify(s));
    const again = await submit(P, { actions: honest.log }); assert(again.status === 409 && again.body.st === 'rejected', 'slot used');
    return s.why;
  });
}
await check('Daily: start -> quit -> the second run is practice; the quit run is a DNF', async () => {
  const P = await newPlayer();
  const s1 = await startRun(P); assert(s1.body.ranked === true, 'first start ranked');
  // the player quits (nothing submitted) and starts again: the second start is not ranked and the first is a DNF now
  const s2 = await startRun(P); assert(s2.body.ranked === false && s2.body.st === 'dnf', 'second start ' + JSON.stringify(s2.body));
  const r = await submit(P, { actions: honest.log }); assert(r.status === 409 && r.body.st === 'dnf', 'practice submit ' + JSON.stringify(r));
  const st = (await get(`/lb/daily/status?cid=${P.id}&day=${DAY}`)).body; assert(st.st === 'dnf', st.st);
  const s3 = await startRun(P); assert(s3.body.ranked === false, 'still practice');
  return `start 2: ranked=${s2.body.ranked}, submit: 409 ${r.body.st}`;
});
await check('Daily: a run abandoned without another start becomes a DNF after 90 min, listed below every finisher', async () => {
  const P = await newPlayer();
  await startRun(P);
  let c = (await get(`/lb/daily/status?cid=${P.id}&day=${DAY}`)).body; assert(c.st === 'started', 'in progress ' + c.st);
  c = (await post('/lb/test/age', { cid: P.id, day: DAY, ms: 91 * 60e3 })).body; assert(c.st === 'dnf', 'aged ' + c.st);
  const v = (await get(`/lb/view?board=daily&day=${DAY}&cid=${P.id}`)).body;
  const i = v.top.findIndex((r) => r.me);
  assert(i >= 0 && v.top[i].rank === 'DNF' && v.top.slice(0, i).every((r) => typeof r.rank === 'number') && v.dnf >= 2, JSON.stringify(v.top.map((r) => r.rank)));
  const late = await submit(P, { actions: honest.log }); assert(late.status === 202, 'a late submit of the started run still ranks: ' + late.status); // the run did start ranked; DNF is only shown while it is missing
  const d = await waitDone(P); assert(d.st === 'ok', d.st);
  return `board ranks: ${v.top.map((r) => r.rank).join(',')}`;
});
await check('Daily: a run whose start was never registered (offline) cannot be ranked', async () => {
  const P = await newPlayer();
  const r = await submit(P, { actions: honest.log }); assert(r.status === 409 && r.body.st === 'none', JSON.stringify(r));
  const s = (await get(`/lb/daily/status?cid=${P.id}&day=${DAY}`)).body; assert(s.st === 'none', s.st);
  return r.body.why;
});
await check('Daily: a different human build (not the build of the day) cannot pass', async () => {
  // the server always builds the match from the day's setup, so a run played with another build desyncs at once
  const V = (await post('/lb/test/verify', { day: '2026-10-1', human: H, actions: honest.log })).body;
  assert(!V.ok, JSON.stringify(V)); return V.why;
});
await check('Daily board lists the verified runs, best first, with the player row', async () => {
  const v = (await get(`/lb/view?board=daily&day=${DAY}&cid=${P1.id}`)).body;
  assert(v.of === 3 && v.top.filter((r) => typeof r.rank === 'number').length === 3 && v.top.some((r) => r.me) && v.card.st === 'ok', JSON.stringify(v).slice(0, 300));
  assert(v.top[0].avatar === 'queen:ivory' && v.top[0].name === 'Honest', JSON.stringify(v.top[0]));
  return `${v.of} ranked`;
});
await check('CPU per Board invocation (workerd wall clock, 1 verify chunk per alarm)', async () => {
  // more honest runs to get a distribution
  for (let d = 0; d < 3; d++) { const P = await newPlayer(); const run = simDaily(DAY, { ...H, name: 'Run' + d }); await startRun(P); await submit(P, { actions: run.log, name: 'Run' + d }); await waitDone(P); }
  const c = (await get('/lb/test/cpu')).body;
  const frac = c.over5 / c.n;
  assert(frac < 0.15, `${c.over5}/${c.n} chunks over 5 ms`); // wall clock on a shared box: informational; the CPU bound is asserted in the Node test
  return `${c.n} chunks, avg ${(c.sum / c.n).toFixed(2)} ms, max ${c.max.toFixed(1)} ms, over 5 ms: ${c.over5} (${(frac * 100).toFixed(1)}%), hist <1/<2/<3/<5/<8/8+ = ${c.hist.join('/')}`;
});

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);

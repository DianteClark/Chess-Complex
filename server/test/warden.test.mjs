// 18.1 (L3): Warden Rating tests. Score math + aggregation + the co-op verifier in Node, then the Board routes against
// a running dev server:
//   cd server && npx wrangler dev --local --port 8815 --ip 127.0.0.1 --var ROOM_TEST:1 --var LB_TEST:1 --var PLAYER_TEST:1 --var NEW_PER_HOUR:1000 --persist-to /tmp/l3
//   node test/warden.test.mjs [http://127.0.0.1:8815]
import { createMatch, applyAction, planBot, planHollow, unitById } from '../../js/engine.js';
import { PRESETS, PIECES } from '../../js/data.js';
import { WARDEN, runFacts, runScore, aggregate, seasonAdd, shareMul, partyMul, wtierOf, WTIERS, cleanWk, wkPub, applyReward } from '../../js/warden.js';
import { cleanRk } from '../../js/rivals.js';
import { coopVerifyStart, verifyStep, seasonId } from '../src/lbcore.js';
import { cleanStart } from '../../js/warden.js';
import { protoVer } from '../../js/statehash.js';

const BASE = (process.argv[2] || process.env.LB || 'http://127.0.0.1:8815').replace(/\/$/, '');
let pass = 0, failN = 0;
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
async function check(name, f) { try { const r = await f(); pass++; console.log('ok  ', name, r != null && r !== '' ? '- ' + r : ''); } catch (e) { failN++; console.log('FAIL', name, '-', e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (p, b, h = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const auth = (P) => ({ Authorization: 'Bearer ' + P.secret });

// a team of n players; `team` entries {human, lvl, hk, dmg, rev}
const F = (o) => ({ mode: 'siege', waves: 8, cleared: 8, won: true, me: 0, team: [{ human: true, lvl: 'normal', hk: 10, dmg: 1000, rev: 0 }], ...o });
const T = (n, extra = {}) => Array.from({ length: n }, () => ({ human: true, lvl: 'normal', hk: 10, dmg: 1000, rev: 0, ...extra }));

// ---------------------------------------------------------------- score math
await check('score: solo Siege win = 1000, Gauntlet win weighs more, losses scale with waves', () => {
  const s = runScore(F()).score, g = runScore(F({ mode: 'gauntlet', waves: 4, cleared: 4 })).score;
  assert(s === 1000, 'siege ' + s); assert(g === Math.round(1000 * WARDEN.mode.gauntlet) && g > s, 'gauntlet ' + g);
  const L = [0, 2, 4, 6, 7].map((c) => runScore(F({ won: false, cleared: c })).score);
  for (let i = 1; i < L.length; i++) assert(L[i] > L[i - 1], 'monotone ' + L);
  assert(L[0] === 0 && L[4] < s - WARDEN.win, 'win bonus ' + L);
  return `siege ${s}, gauntlet ${g}, losses ${L.join('/')}`;
});
await check('score: party size - solo hardest; 2 and 4 humans earn less for the same result', () => {
  const sc = [1, 2, 3, 4].map((n) => runScore(F({ team: T(n) })).score);
  for (let i = 1; i < 4; i++) assert(sc[i] < sc[i - 1], sc.join());
  assert(sc[3] >= 700, 'a 4-player win is still worth a lot: ' + sc[3]);
  return sc.join(' > ');
});
await check('score: bot allies count, harder bots = easier run; hard bot ally weighs more than a human', () => {
  const lv = (l) => runScore(F({ team: [{ human: true, lvl: 'normal', hk: 10, dmg: 1000 }, { human: false, lvl: l, hk: 10, dmg: 1000 }] })).score;
  const e = lv('easy'), n = lv('normal'), h = lv('hard'), hu = runScore(F({ team: T(2) })).score;
  assert(e > n && n > h && h < hu, `${e} ${n} ${h} human ${hu}`);
  return `easy ${e}, normal ${n}, hard ${h}, human ally ${hu}`;
});
await check('contribution: capped +-15 %, carries never zero a teammate', () => {
  const team = [{ human: true, hk: 40, dmg: 4000, rev: 3 }, { human: true, hk: 0, dmg: 0, rev: 0 }];
  const hi = shareMul(team, 0), lo = shareMul(team, 1);
  assert(Math.abs(hi - (1 + WARDEN.carry)) < 1e-9 && Math.abs(lo - (1 - WARDEN.carry)) < 1e-9, `${hi} ${lo}`);
  const even = shareMul(T(4), 2); assert(Math.abs(even - 1) < 1e-9, 'even ' + even);
  assert(shareMul(T(1), 0) === 1, 'solo');
  const carry = runScore(F({ team })).score, leech = runScore(F({ team, me: 1 })).score;
  assert(leech / carry >= (1 - WARDEN.carry) / (1 + WARDEN.carry) - 0.01 && leech > 0, `${carry} ${leech}`);
  return `carry ${carry}, idle teammate ${leech}`;
});
await check('aggregate: top third of the last 30 (best 10), provisional under 5 runs', () => {
  assert(aggregate([]).r === 0 && aggregate([]).prov, 'empty');
  const a4 = aggregate([500, 600, 700, 800]); assert(a4.prov && a4.used === 2 && a4.r === 750, JSON.stringify(a4));
  const a5 = aggregate([500, 600, 700, 800, 900]); assert(!a5.prov && a5.used === 2 && a5.r === 850, JSON.stringify(a5));
  const many = Array.from({ length: 40 }, (_, i) => (i < 30 ? 600 : 1200)); // the 10 old 1200s are outside the window
  const am = aggregate(many); assert(am.k === 30 && am.used === 10 && am.r === 600, JSON.stringify(am));
  const mixed = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 900 : 400)); assert(aggregate(mixed).r === 900, 'top third');
  // volume does not inflate: the same skill (scores drawn uniformly 300..900) at 9 runs vs 30 runs
  let st = 3; const rnd = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
  const draw = (k) => Array.from({ length: k }, () => 300 + 600 * rnd());
  let d9 = 0, d30 = 0; for (let i = 0; i < 400; i++) { d9 += aggregate(draw(9)).r; d30 += aggregate(draw(30)).r; }
  assert(Math.abs(d9 - d30) / 400 < 40, `9 runs ${Math.round(d9 / 400)} vs 30 runs ${Math.round(d30 / 400)}`);
  return `9 runs ${Math.round(d9 / 400)}, 30 runs ${Math.round(d30 / 400)}`;
});
await check('season points = best 10 runs of the week; tiers + wire shapes', () => {
  let b = []; for (let i = 0; i < 14; i++) b = seasonAdd(b.best || b, 100 + i * 10).best;
  const sa = seasonAdd(b, 0); assert(sa.best.length === 10 && sa.pts === [230, 220, 210, 200, 190, 180, 170, 160, 150, 140].reduce((x, y) => x + y), JSON.stringify(sa));
  assert(wtierOf(0).id === 'squire' && wtierOf(WTIERS[5].min).id === 'warden' && wtierOf(WTIERS[2].min - 1).id === 'sentinel', 'tiers');
  assert(JSON.stringify(wkPub(812.4, 3)) === '{"w":812,"wp":1}' && JSON.stringify(wkPub(812, 7)) === '{"w":812}' && JSON.stringify(wkPub(0, 0)) === '{}', 'wkPub');
  const rk = cleanRk({ r: 1300, w: 900, wp: 1 }); assert(rk.r === 1300 && rk.w === 900 && rk.wp === 1, 'cleanRk keeps w ' + JSON.stringify(rk));
  assert(JSON.stringify(cleanRk({ r: 1300 })) === '{"r":1300}' && cleanWk({ w: -1 }) === null && cleanWk({ r: 1 }) === null, 'clean');
  const p = {}; assert(applyReward(p, { rank: 2, sid: '2026-11-02' }).rw.title === 'Keepwarden' && p.ownedBanners.includes('warden_podium') && p.titles.length === 1, 'reward');
  applyReward(p, { rank: 2, sid: '2026-11-02' }); assert(p.titles.length === 1 && p.wardenRewards.length === 1, 'idempotent');
  return WTIERS.map((t) => `${t.name} ${t.min}`).join(', ');
});

// ---------------------------------------------------------------- the co-op verifier (Node)
const build = (k) => { const pr = Object.values(PRESETS)[k % Object.keys(PRESETS).length]; const eq = {}; for (const pc of Object.keys(PIECES)) if (PIECES[pc].equips.length) eq[pc] = PIECES[pc].equips[k % PIECES[pc].equips.length]; return { pts: { ...pr.pts }, passive: pr.passive, equips: eq }; };
function soloPlayers(bots, lvl = 'normal') {
  const P = [{ pid: 'me', name: 'Tester', title: '', skin: 'ivory', finisher: 'shatter', trail: 'none', build: build(0) }];
  for (let i = 0; i < bots; i++) P.push({ pid: 'bot' + i + 'ab' + i, name: 'Ally' + i, isBot: true, botLevel: lvl, skin: 'ivory', finisher: 'shatter', trail: 'none', title: '', build: build(i + 1) });
  return P;
}
// plays like the phone: the human's moves come from planBot on a clone (a stand-in player), bots/Hollows on the state
function simCoop(players, seed, opts, { quitAt = 0 } = {}) {
  const s = createMatch(players, seed, opts), log = [];
  const act = (pid, a) => { const r = applyAction(s, pid, a); if (r.ok) log.push([pid ?? null, JSON.parse(JSON.stringify(a))]); return r.ok; };
  let guard = 0;
  while (!s.over && guard++ < 40000) {
    if (quitAt && log.length >= quitAt) break;
    const u = unitById(s, s.active), turn = s.turnNo, human = u.kind !== 'hollow' && !u.bot;
    const plan = human ? planBot(structuredClone(s), structuredClone(u)) : u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    let k = 0; for (; k < plan.length; k++) { act(u.pid, plan[k]); if (s.over || s.active !== u.id || s.turnNo !== turn) break; }
    if (k >= plan.length && !s.over && s.active === u.id && s.turnNo === turn) act(u.pid, { type: 'end' });
  }
  return { s, log, facts: runFacts(s, 'me') };
}
const verifyLocal = (start, actions) => { const V = coopVerifyStart({ start }); let n = 0; while (!V.done && n++ < 200000) verifyStep(V, actions); return { V, chunks: n }; };
let LOCAL = null;
await check('verifier: an honest solo Gauntlet (1 bot ally) replays to the same facts, chunked', () => {
  const players = soloPlayers(1), start = cleanStart(players, { mode: 'gauntlet' }, 'gauntlet', 4242);
  assert(start, 'cleanStart');
  const run = simCoop(start.players, 4242, start.opts);
  const { V, chunks } = verifyLocal(start, run.log);
  assert(V.ok, 'verdict ' + V.why); assert(JSON.stringify(V.result) === JSON.stringify(run.facts), 'facts differ');
  LOCAL = { players, run };
  return `${run.log.length} actions, ${chunks} chunks, cleared ${run.facts.cleared}/${run.facts.waves}${run.facts.won ? ' won' : ''}, score ${runScore(run.facts).score}`;
});
await check('verifier: tampered human action / bot action / truncated run / wrong seed are rejected', () => {
  const { players, run } = LOCAL; const start = cleanStart(players, { mode: 'gauntlet' }, 'gauntlet', 4242);
  const L = run.log;
  const iBot = L.findIndex((x) => x[0] && x[0].startsWith('bot') && x[1].type !== 'end');
  const bad1 = L.map((x, i) => (i === iBot ? [x[0], { type: 'end' }] : x));
  assert(!verifyLocal(start, bad1).V.ok, 'bot tamper');
  const iMe = L.findIndex((x) => x[0] === 'me' && x[1].type === 'move');
  const bad2 = L.map((x, i) => (i === iMe ? [x[0], { ...x[1], x: 0, y: 0 }] : x));
  assert(!verifyLocal(start, bad2).V.ok, 'human tamper');
  assert(!verifyLocal(start, L.slice(0, Math.floor(L.length / 2))).V.ok, 'truncated alive');
  assert(!verifyLocal({ ...start, seed: 4243 }, L).V.ok, 'seed');
  return '';
});
await check('cleanStart: builds, bots, options validated', () => {
  const P = soloPlayers(2);
  assert(cleanStart(P, { mode: 'siege' }, 'siege', 1), 'ok');
  assert(!cleanStart(P, { mode: 'siege' }, 'gauntlet', 1), 'mode mismatch');
  assert(!cleanStart(P, { mode: 'siege', custom: { hp: 2 } }, 'siege', 1), 'custom');
  assert(!cleanStart(P, { mode: 'siege', nemesis: { me: { pid: 'x', n: 1 } } }, 'siege', 1), 'nemesis');
  assert(!cleanStart([{ ...P[0], build: { ...P[0].build, pts: { hp: 5, atk: 5, def: 1, spd: 0 } } }], { mode: 'siege' }, 'siege', 1), '11 points');
  assert(!cleanStart([P[0], { ...P[1], botLevel: 'godlike' }], { mode: 'siege' }, 'siege', 1), 'level');
  assert(!cleanStart([...P, P[1], P[2]], { mode: 'siege' }, 'siege', 1), '5 players');
  assert(!cleanStart([{ ...P[1] }], { mode: 'siege' }, 'siege', 1), 'bot as the human');
  const c = cleanStart([{ ...P[0], extra: 1, hp: 999 }], { mode: 'siege', location: 'bog' }, 'siege', 7);
  assert(c && !('extra' in c.players[0]) && !('hp' in c.players[0]) && c.opts.location === 'bog' && c.seed === 7, 'clean fields only');
  return '';
});

// ---------------------------------------------------------------- server
const up = await fetch(BASE + '/health').then((r) => r.ok, () => false);
if (!up) { console.log(`\nno server at ${BASE}: ${pass} passed, ${failN} failed (server tests skipped)`); process.exit(failN ? 1 : 0); }
const newPlayer = async () => { const r = await fetch(BASE + '/player/new', { method: 'POST' }); assert(r.status === 201, 'player/new ' + r.status); return r.json(); };
await post('/lb/test/reset', {});
const A = await newPlayer(), B = await newPlayer(), C = await newPlayer();
// a finished 3-seat cloud Siege (two humans + a bot ally), as the Room hands it to board.rate (rec.state = final state)
function cloudRec(mid, humans, { mode = 'siege', t1 = Date.now(), custom = false, seed = 99 } = {}) {
  const pl = [{ pid: 'h1', name: 'Ann', build: build(0) }, { pid: 'h2', name: 'Bo', build: build(1) }, { pid: 'b1', name: 'Botty', isBot: true, botLevel: 'normal', build: build(2) }];
  const { s } = simCoop(pl, seed, { mode });
  return { v: 1, mid, mode, t1, start: { players: pl, seed, opts: custom ? { mode, custom: { hp: 2 } } : { mode } }, humans, result: { places: [], siegeWon: s.siegeWon }, state: s, facts: runFacts(s, 'h1') };
}
let REC = null;
await check('cloud co-op: verified seats rated (any party size), unverified and left seats not, idempotent per match', async () => {
  REC = cloudRec('wd-m1', { h1: { name: 'Ann', verified: true, cid: A.id, pub: { name: 'Ann', title: 'Hero', avatar: 'rook:ivory' } }, h2: { name: 'Bo', verified: false } });
  const r = (await post('/lb/test/rate', { rec: REC })).body.r;
  assert(r && r.runs && r.runs.length === 1 && r.runs[0].cid === A.id, JSON.stringify(r));
  const want = runScore({ ...REC.facts, team: REC.facts.team.map((t) => ({ ...t, human: t.pid !== 'b1' })) }).score;
  assert(r.runs[0].score === want, `score ${r.runs[0].score} vs ${want}`);
  const again = (await post('/lb/test/rate', { rec: REC })).body.r; assert(again.runs[0].dup, 'dup');
  const left = cloudRec('wd-m2', { h1: { name: 'Ann', verified: true, cid: B.id, left: true }, h2: { name: 'Bo', verified: true, cid: C.id } });
  const r2 = (await post('/lb/test/rate', { rec: left })).body.r; assert(r2.runs.length === 1 && r2.runs[0].cid === C.id, 'left seat skipped ' + JSON.stringify(r2));
  const cu = (await post('/lb/test/rate', { rec: cloudRec('wd-m3', { h1: { verified: true, cid: B.id } }, { custom: true }) })).body.r; assert(!cu, 'custom ignored');
  const me = (await get(`/lb/coop/me?cid=${A.id}`)).body; assert(me.warden.games === 1 && me.warden.prov && me.wseason.pts === want, JSON.stringify(me));
  return `run score ${want} (${REC.facts.cleared}/${REC.facts.waves}${REC.facts.won ? ' won' : ''})`;
});
await check('solo: ticket -> start -> submit -> verified on the server -> rating + season', async () => {
  const t = (await post('/lb/coop/ticket', { cid: B.id }, auth(B))).body; assert(t && /^[0-9A-Z]{12}$/.test(t.rid) && Number.isInteger(t.seed), JSON.stringify(t));
  const t2 = (await post('/lb/coop/ticket', { cid: B.id }, auth(B))).body; assert(t2.rid === t.rid && t2.seed === t.seed, 'same open ticket');
  const st = await post('/lb/coop/start', { cid: B.id, rid: t.rid, mode: 'gauntlet', name: 'Bea' }, auth(B)); assert(st.status === 200 && st.body.ranked, JSON.stringify(st));
  const players = soloPlayers(1), run = simCoop(cleanStart(players, { mode: 'gauntlet' }, 'gauntlet', t.seed).players, t.seed, { mode: 'gauntlet' });
  const sub = await post('/lb/coop/run', { cid: B.id, rid: t.rid, ver: protoVer(), players, opts: { mode: 'gauntlet' }, actions: run.log }, auth(B));
  assert(sub.status === 202, 'submit ' + sub.status + JSON.stringify(sub.body));
  assert((await post('/lb/coop/run', { cid: B.id, rid: t.rid, ver: protoVer(), players, opts: { mode: 'gauntlet' }, actions: run.log }, auth(B))).status === 409, 'double submit');
  let s = null; const t0 = Date.now();
  for (let i = 0; i < 240; i++) { s = (await get(`/lb/coop/status?cid=${B.id}&rid=${t.rid}`)).body; if (s.st !== 'queued') break; await sleep(500); }
  assert(s.st === 'ok', JSON.stringify(s));
  const want = runScore(run.facts).score; assert(s.score === want && s.card.games === 1, `${s.score} vs ${want}`);
  const t3 = (await post('/lb/coop/ticket', { cid: B.id }, auth(B))).body; assert(t3.rid !== t.rid, 'new ticket after a finished run');
  return `verified in ${((Date.now() - t0) / 1000).toFixed(1)} s, score ${s.score}, rating ${s.r} (${s.delta >= 0 ? '+' : ''}${s.delta})`;
});
await check('unverified runs never count: no ticket, no start, wrong seed, bad build, bad secret, old version', async () => {
  const players = soloPlayers(0);
  const t = (await post('/lb/coop/ticket', { cid: C.id }, auth(C))).body;
  const noStart = await post('/lb/coop/run', { cid: C.id, rid: t.rid, ver: protoVer(), players, opts: { mode: 'siege' }, actions: [['me', { type: 'end' }]] }, auth(C));
  assert(noStart.status === 409 && noStart.body.st === 'issued', 'not started ' + JSON.stringify(noStart.body));
  assert((await post('/lb/coop/run', { cid: C.id, rid: 'ZZZZZZZZZZZZ', ver: protoVer(), players, opts: { mode: 'siege' }, actions: [['me', { type: 'end' }]] }, auth(C))).body.st === 'none', 'unknown rid');
  assert((await post('/lb/coop/ticket', { cid: C.id }, { Authorization: 'Bearer 0000000000000000' })).status === 401, 'bad secret');
  await post('/lb/coop/start', { cid: C.id, rid: t.rid, mode: 'siege' }, auth(C));
  assert((await post('/lb/coop/run', { cid: C.id, rid: t.rid, ver: 'p0-old', players, opts: { mode: 'siege' }, actions: [['me', { type: 'end' }]] }, auth(C))).status === 409, 'version');
  const bad = await post('/lb/coop/run', { cid: C.id, rid: t.rid, ver: protoVer(), players: [{ ...players[0], build: { ...players[0].build, pts: { hp: 10, atk: 10, def: 0, spd: 0 } } }], opts: { mode: 'siege' }, actions: [['me', { type: 'end' }]] }, auth(C));
  assert(bad.status === 400, 'build ' + bad.status);
  // a real run played on a seed of the player's choosing (not the ticket's) is replayed on the ticket seed and fails
  const run = simCoop(players, t.seed + 1, { mode: 'siege' }, { quitAt: 0 });
  const sub = await post('/lb/coop/run', { cid: C.id, rid: t.rid, ver: protoVer(), players, opts: { mode: 'siege' }, actions: run.log }, auth(C));
  assert(sub.status === 202, 'queued ' + sub.status);
  let s = null; for (let i = 0; i < 240; i++) { s = (await get(`/lb/coop/status?cid=${C.id}&rid=${t.rid}`)).body; if (s.st !== 'queued') break; await sleep(500); }
  assert(s.st === 'rejected', JSON.stringify(s));
  const me = (await get(`/lb/coop/me?cid=${C.id}`)).body; assert(me.warden.games === 1, 'only the cloud run counted ' + JSON.stringify(me.warden));
  return `seed swap: ${s.why}`;
});
await check('quitting a registered run counts as a 0 when the next run starts', async () => {
  const t = (await post('/lb/coop/ticket', { cid: A.id }, auth(A))).body;
  await post('/lb/coop/start', { cid: A.id, rid: t.rid, mode: 'siege' }, auth(A));
  const t2 = (await post('/lb/coop/ticket', { cid: A.id }, auth(A))).body; assert(t2.rid !== t.rid, 'a started ticket is not reissued');
  const st = await post('/lb/coop/start', { cid: A.id, rid: t2.rid, mode: 'siege' }, auth(A)); assert(st.body.ranked, 'second start');
  assert((await get(`/lb/coop/status?cid=${A.id}&rid=${t.rid}`)).body.st === 'dnf', 'dnf');
  const me = (await get(`/lb/coop/me?cid=${A.id}`)).body; assert(me.warden.games === 2 && me.warden.recent[0].score === 0 && me.warden.recent[0].src === 'quit', JSON.stringify(me.warden));
  assert(me.wseason.games === 1, 'a quit adds no season points');
  // stale: a started run older than 3 h becomes a DNF on the next ticket
  await post('/lb/test/wage', { rid: t2.rid, ms: 4 * 3600e3 });
  await post('/lb/coop/ticket', { cid: A.id }, auth(A));
  assert((await get(`/lb/coop/status?cid=${A.id}&rid=${t2.rid}`)).body.st === 'dnf', 'stale dnf');
  return `rating ${me.warden.r} after a quit (top third of ${me.warden.games} runs)`;
});
await check('boards: Warden board hides provisional players, rows carry the Warden tier; season board', async () => {
  for (let i = 0; i < 5; i++) await post('/lb/test/rate', { rec: { ...REC, mid: 'wd-c' + i, humans: { h1: { name: 'Cy', verified: true, cid: C.id }, h2: { name: 'Bo', verified: true, cid: B.id } } } });
  const v = (await get(`/lb/view?board=warden&cid=${C.id}`)).body;
  const mine = v.top.find((r) => r.me);
  assert(v.top.length === 2 && mine && mine.wk && mine.wk.w === v.card.r && !mine.wk.wp && !v.top.some((r) => r.name === 'Ann'), 'A (provisional) hidden ' + JSON.stringify(v.top));
  assert(v.card.games === 6 && !v.card.prov && v.card.rank === mine.rank, JSON.stringify(v.card));
  const vb = (await get(`/lb/view?board=warden&cid=${B.id}`)).body; assert(vb.card.games === 6 && v.of === 2, 'B listed ' + v.of);
  const vs = (await get(`/lb/view?board=wseason&cid=${A.id}`)).body;
  assert(vs.top.length === 3 && vs.sid === seasonId() && vs.ends > Date.now() && vs.top.every((r) => r.wk), JSON.stringify(vs.top));
  assert(vs.me && vs.me.v > 0, 'A in season');
  return `warden top ${v.top.map((r) => r.v).join(',')}, season ${vs.top.map((r) => r.name + ' ' + r.v).join(', ')}`;
});
await check('Monday rollover: last week archived, top 50 co-op rewards -> Player inbox (k wseason)', async () => {
  const week = 7 * 864e5;
  const old = seasonId(Date.now() - week);
  // a late record stamped last week counts THIS week (an archived week is never reopened)
  const late = (await post('/lb/test/rate', { rec: { ...REC, mid: 'wd-late', t1: Date.now() - week, humans: { h1: { name: 'Cy', verified: true, cid: C.id } } } })).body.r;
  assert(late && late.runs[0].score > 0, 'late run');
  await post('/lb/test/wrows', { sid: old, rows: [{ cid: A.id, name: 'Ann', v: 900, games: 3, wins: 2 }, { cid: B.id, name: 'Bo', v: 500 }] });
  const r = (await post('/lb/test/rollover', { now: Date.now(), deliver: true })).body;
  assert(r.wrewards, JSON.stringify(r)); // delivered by the rollover itself (best effort) or by this deliver pass
  const q = (await get('/lb/test/wrewards')).body; assert(q && q.sid === old && q.list.length === 0, 'queue drained ' + JSON.stringify(q));
  const last = (await get(`/lb/view?board=wseason&sid=last&cid=${A.id}`)).body;
  assert(last.sid === old && last.top.length === 2 && last.top[0].me && last.me.rank === 1, JSON.stringify(last));
  const gb = await fetch(`${BASE}/player/${B.id}`, { headers: auth(B) }).then((x) => x.json());
  assert((gb.inbox || []).some((x) => x.k === 'wseason' && x.rank === 2 && x.title === 'Keepwarden'), 'B #2 ' + JSON.stringify(gb.inbox));
  const cur = (await get(`/lb/view?board=wseason&cid=${A.id}`)).body; assert(cur.top.length === 3, 'this week untouched');
  const g = await fetch(`${BASE}/player/${A.id}`, { headers: auth(A) }).then((x) => x.json());
  const it = (g.inbox || []).find((x) => x.k === 'wseason'); assert(it && it.rank === 1 && it.title === 'Lord of the Keep' && it.banner === 'warden_champion', JSON.stringify(g.inbox));
  const again = (await post('/lb/test/rollover', { now: Date.now(), deliver: true })).body; assert(!again.wrewards || again.wrewards.sent === 0, 'idempotent');
  return `${it.id} -> ${it.title}`;
});
await check('live cloud room: a Gauntlet with 2 verified humans (+ bot) rates both through the match-end hook; lobby rk carries w', async () => {
  process.env.CLOUD = BASE;
  const { Client, newRoom } = await import('./lib.mjs');
  const code = await newRoom();
  const a = new Client(code, { name: 'Ann', autoPlay: true }), b = new Client(code, { name: 'Cy', autoPlay: true });
  await a.open({ cid: A.id, cproof: A.secret }); await a.waitMsg('welcome', 5000);
  await b.open({ cid: C.id, cproof: C.secret }); await b.waitMsg('welcome', 5000);
  a.test('set', { T: { fast: true, introMs: 0 } }); await sleep(50);
  a.lead('group', { group: 'coop' }); a.lead('mode', { mode: 'gauntlet' }); await a.wait((c) => c.lobby && c.lobby.mode === 'gauntlet', 3000, 'mode');
  a.lead('bots', { n: 1 }); a.lead('fill-bots');
  await a.wait((c) => c.lobby.players.filter((p) => !p.isBot).every((p) => p.rk && p.rk.w != null), 8000, 'lobby rk.w');
  const pc = a.lobby.players.find((p) => p.pid === b.myPid); assert(pc.rk.w === (await get(`/lb/coop/me?cid=${C.id}`)).body.warden.r, 'lobby w ' + JSON.stringify(pc.rk));
  const g0 = { A: (await get(`/lb/coop/me?cid=${A.id}`)).body.warden.games, C: (await get(`/lb/coop/me?cid=${C.id}`)).body.warden.games };
  b.send({ t: 'ready', on: true }); await sleep(200); a.lead('start'); await a.waitMsg('start', 8000);
  await a.wait((c) => c.s && c.s.over, 300000, 'over');
  let ga = null, gc = null;
  for (let i = 0; i < 40; i++) { await sleep(500); ga = (await get(`/lb/coop/me?cid=${A.id}`)).body.warden; gc = (await get(`/lb/coop/me?cid=${C.id}`)).body.warden; if (ga.games > g0.A && gc.games > g0.C) break; }
  assert(ga.games === g0.A + 1 && gc.games === g0.C + 1, `rated ${JSON.stringify([g0, ga.games, gc.games])}`);
  const f = runFacts(a.s, a.myPid), want = runScore(f).score;
  assert(ga.recent[0].score === want && ga.recent[0].src === 'cloud', `A score ${ga.recent[0].score} vs ${want}`);
  a.close(); b.close();
  return `${a.lobby.players.length} seats, ${f.cleared}/${f.waves}${f.won ? ' won' : ''}, A run ${ga.recent[0].score}, C run ${gc.recent[0].score}`;
});
await check('Crown boards and ranks unaffected by co-op runs', async () => {
  const v = (await get(`/lb/view?board=rating&cid=${A.id}`)).body; assert(v.card && v.card.games === 0, JSON.stringify(v.card));
  return '';
});
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);

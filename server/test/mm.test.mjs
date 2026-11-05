// 17.1 (MM): public matchmaking (Quick Play, Browse, Public/Private parties, limits, cleanup) against a running
// `wrangler dev` with test hooks:
//   cd server && npx wrangler dev --local --port 8799 --var ROOM_TEST:1 --var NEW_PER_HOUR:1000
//   CLOUD=http://127.0.0.1:8799 node test/mm.test.mjs
// Every client here shares one IP, so the per-IP limits are loosened with /mm/test {op:'set'} and tightened per check.
import { Client, newRoom, sleep, check, assert, results, BASE } from './lib.mjs';

const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const mmt = async (b) => (await post('/mm/test', b)).json();
const quick = async (mode, exclude) => { const r = await post('/mm/quick', { mode, exclude }); return { status: r.status, ...(await r.json()) }; };
const list = async (mode) => (await (await fetch(BASE + '/mm/list' + (mode ? '?mode=' + mode : ''))).json()).rooms;
const LOOSE = { quickPerMin: 500, createsPer10: 500, roomsPerIp: 500 };
async function reset(L = {}) { await mmt({ op: 'reset' }); await mmt({ op: 'set', L: { ...LOOSE, ...L } }); }
async function join(code, name, o = {}) { const c = new Client(code, { name, autoPlay: o.autoPlay }); await c.open(); await c.waitMsg('welcome', 8000); return c; }
// wait for a message that arrived at or after mark k (taken BEFORE the action, so a fast answer is not missed)
const since = (c, k, t, ms, f = () => true) => c.wait(() => c.msgs.slice(k).some((m) => m.t === t && f(m)), ms, 'msg ' + t).then(() => c.msgs.slice(k).find((m) => m.t === t && f(m)));
const closeAll = (cs) => { for (const c of cs) { try { c.send({ t: 'part' }); } catch {} c.close(); } };

await check('routes: bad mode 400, list shape, test ops gated by ROOM_TEST', async () => {
  await reset();
  const r = await quick('daily'); assert(r.status === 400 && r.error === 'mode', JSON.stringify(r));
  const r2 = await quick('nope'); assert(r2.status === 400, 'unknown mode ' + r2.status);
  const l = await list(); assert(Array.isArray(l) && l.length === 0, 'empty list after reset: ' + JSON.stringify(l));
  const bad = await fetch(BASE + '/mm/list?mode=<x>'); assert(bad.status === 400, 'bad list mode ' + bad.status);
});

await check('Quick Play: two clients find each other, countdown, bots fill, match starts, room unlisted', async () => {
  await reset();
  const q1 = await quick('royale'); assert(q1.status === 200 && q1.created && /^[A-Z0-9]{5}$/.test(q1.code), JSON.stringify(q1));
  const A = await join(q1.code, 'Alice', { autoPlay: true });
  A.test('set', { T: { qpWait: 2500, fast: true, introMs: 0 } }); await sleep(100);
  const q2 = await quick('royale'); assert(q2.code === q1.code && !q2.created, 'second Quick Play joined another room: ' + JSON.stringify(q2));
  let l = await list('royale'); assert(l.length === 1 && l[0].code === q1.code && l[0].qp && l[0].cap === 8, 'listed: ' + JSON.stringify(l));
  const kA = A.msgs.length; const B = await join(q2.code, 'Bob', { autoPlay: true });
  const lob = await since(A, kA, 'lobby', 5000, (m) => m.players.length === 2);
  assert(lob.qp && lob.pub && lob.cd > 0 && lob.cd <= 2500, 'countdown in lobby: ' + JSON.stringify({ qp: lob.qp, pub: lob.pub, cd: lob.cd }));
  assert(lob.players.every((p) => p.st === 'leader' || p.st === 'ready'), 'no ready step: ' + lob.players.map((p) => p.st));
  await sleep(300); l = await list('royale'); assert(l[0] && l[0].st === 'starting' && l[0].h === 2, 'starting: ' + JSON.stringify(l));
  await A.wait((c) => c.start, 8000, 'start A'); await B.wait((c) => c.start, 8000, 'start B');
  const st = A.start; assert(st.players.length === 8 && st.players.filter((p) => p.isBot).length === 6, 'bots filled: ' + st.players.length);
  assert(st.opts.mode === 'royale' && !st.opts.custom, 'opts ' + JSON.stringify(st.opts));
  await A.wait((c) => c.applied >= 40 && c.hashOk >= 3, 30000, '40 actions');
  assert(A.hashBad === 0 && B.hashBad === 0, 'hash mismatches');
  l = await list(); assert(!l.some((x) => x.code === q1.code && x.st !== 'live'), 'live room still listed as joinable'); // 18.0 (LV): listed as st 'live' (Watch) only
  const q3 = await quick('royale'); assert(q3.code !== q1.code && q3.created, 'Quick Play during the match should make a new room: ' + JSON.stringify(q3));
  closeAll([A, B]);
  return `room ${q1.code}, ${A.applied} actions, ${A.hashOk} hashes`;
});

await check('Duel fills to capacity and starts at once (qpFull); a third player gets a new room', async () => {
  await reset();
  const q1 = await quick('duel'); const A = await join(q1.code, 'Ann'); const k0 = A.msgs.length;
  const q2 = await quick('duel'); assert(q2.code === q1.code, 'same duel room');
  const t0 = Date.now(); const B = await join(q2.code, 'Ben');
  const lob = await since(A, k0, 'lobby', 5000, (m) => m.players.length === 2); assert(lob.cd > 0 && lob.cd <= 3000, 'full countdown ' + lob.cd);
  await since(A, k0, 'start', 8000); const ms = Date.now() - t0;
  assert(A.start.players.length === 2 && !A.start.players.some((p) => p.isBot), 'two humans, no bots');
  const q3 = await quick('duel'); assert(q3.code !== q1.code, 'full room handed out again');
  closeAll([A, B]);
  return `started ${ms} ms after the 2nd join`;
});

await check('four clients Quick Play Squads into one room; pending seats keep a burst together', async () => {
  await reset();
  const qs = []; for (let i = 0; i < 4; i++) qs.push(await quick('squads'));
  assert(qs.every((q) => q.code === qs[0].code) && qs.filter((q) => q.created).length === 1, 'burst split: ' + qs.map((q) => q.code));
  const cs = []; for (const [i, q] of qs.entries()) { cs.push(await join(q.code, 'S' + i)); if (i === 0) { cs[0].test('set', { T: { qpWait: 2000, introMs: 0 } }); await sleep(100); } }
  for (const c of cs) await c.wait((x) => x.start, 10000, 'start');
  const pl = cs[0].start.players; assert(pl.length === 8 && pl.filter((p) => !p.isBot).length === 4, 'squads 4 humans + 4 bots');
  closeAll(cs);
  // concurrent burst (Promise.all): the Matchmaker serialises, so still one room
  await reset();
  const burst = await Promise.all([0, 1, 2].map(() => quick('blitz')));
  assert(new Set(burst.map((q) => q.code)).size === 1, 'concurrent burst split: ' + burst.map((q) => q.code));
  const c0 = await join(burst[0].code, 'X'); closeAll([c0]);
});

await check('lone Quick Play leader: options refused, Start Now fills bots', async () => {
  await reset();
  const q = await quick('siege'); const A = await join(q.code, 'Solo');
  A.test('set', { T: { introMs: 0 } }); await sleep(100);
  await A.wait((c) => c.lobby, 5000, 'lobby'); const lob = A.lobby; assert(lob.qp && lob.cd === 0 && lob.mode === 'siege', 'alone: no countdown ' + lob.cd);
  let k = A.msgs.length; A.lead('mode', { mode: 'royale' }); const e1 = await since(A, k, 'err', 3000); assert(/start by themselves/.test(e1.why), e1.why);
  k = A.msgs.length; A.lead('public', { on: false }); await since(A, k, 'err', 3000);
  k = A.msgs.length; A.lead('start'); await since(A, k, 'start', 5000);
  assert(A.start.players.length === 4 && A.start.opts.mode === 'siege', 'siege filled to 4: ' + A.start.players.length);
  closeAll([A]);
});

await check('Browse: private rooms hidden; Public toggle lists a party; Private unlists it', async () => {
  await reset();
  const code = await newRoom(); const A = await join(code, 'Host'); const B = await join(code, 'Mate');
  await sleep(300);
  let l = await list(); assert(!l.some((x) => x.code === code), 'private code leaked into Browse');
  const dump0 = await mmt({ op: 'dump' }); assert(!dump0.rooms.some((x) => x.code === code), 'private room reached the Matchmaker');
  let k = B.msgs.length; B.lead('public', { on: true }); const e = await since(B, k, 'err', 3000); assert(/leader/.test(e.why), 'non-leader toggled public');
  k = A.msgs.length; A.lead('public', { on: true });
  const lob = await since(A, k, 'lobby', 3000, (m) => m.pub); assert(lob.pub && !lob.qp && lob.cd === 0, 'pub lobby');
  await sleep(300); l = await list(); const x = l.find((r) => r.code === code);
  assert(x && !x.qp && x.n === 2 && x.h === 2 && x.cap === 8 && x.mode === 'royale', 'listed: ' + JSON.stringify(l));
  assert(!('ip' in x) && !('created' in x), 'list leaks internals: ' + Object.keys(x));
  A.lead('mode', { mode: 'blitz' }); await sleep(400); l = await list('blitz'); assert(l.some((r) => r.code === code), 'mode change re-reported');
  assert(!(await list('royale')).some((r) => r.code === code), 'still under the old mode');
  const q = await quick('blitz'); assert(q.code !== code, 'Quick Play must not drop strangers into a hosted party');
  k = A.msgs.length; A.lead('public', { on: false }); await since(A, k, 'lobby', 3000, (m) => !m.pub); await sleep(300);
  l = await list(); assert(!l.some((r) => r.code === code), 'still listed after Private');
  const dump = await mmt({ op: 'dump' }); assert(!dump.rooms.some((r) => r.code === code), 'still in the Matchmaker after Private');
  closeAll([A, B]);
});

await check('limits: listed rooms per IP (Public refused -> Private + err; Quick Play 409), Quick Play rate 429', async () => {
  await reset({ roomsPerIp: 1 });
  const q = await quick('royale'); const A = await join(q.code, 'Cap');
  const code = await newRoom(); const H = await join(code, 'Host2');
  const kH = H.msgs.length; H.lead('public', { on: true });
  const e = await since(H, kH, 'err', 5000, (m) => m.op === 'public'); assert(/public matches/.test(e.why), e.why);
  const lob = await since(H, kH, 'lobby', 3000, (m) => !m.pub && m.players.length === 1 && H.msgs.indexOf(m) > H.msgs.indexOf(e)); assert(!lob.pub, 'room stayed public');
  assert(!(await list()).some((r) => r.code === code), 'refused room listed');
  const q2 = await quick('blitz'); assert(q2.status === 409 && q2.error === 'cap', 'create over cap: ' + JSON.stringify(q2));
  const q3 = await quick('royale'); assert(q3.status === 200 && q3.code === q.code, 'joining is still fine at the cap');
  closeAll([A, H]);
  await reset({ quickPerMin: 3 });
  const codes = []; for (let i = 0; i < 3; i++) codes.push((await quick('royale')).status);
  const r4 = await quick('royale'); assert(codes.every((s) => s === 200) && r4.status === 429 && r4.retry > 0, `rate: ${codes} then ${r4.status}`);
  await reset({ createsPer10: 2 });
  const c1 = await quick('royale'), c2 = await quick('royale', [c1.code]), c3 = await quick('royale', [c1.code, c2.code]);
  assert(c1.created && c2.created && c3.status === 429, 'creates per 10 min: ' + [c1.status, c2.status, c3.status]);
});

await check('cleanup: empty room drops out, stale entries pruned, exclude skips a dead code', async () => {
  await reset({ freshMs: 400 });
  const q = await quick('chaos'); const A = await join(q.code, 'Gone');
  await sleep(300); assert((await list('chaos')).some((r) => r.code === q.code), 'listed while someone waits');
  A.send({ t: 'part' }); A.close(); await sleep(1200);
  assert(!(await list('chaos')).some((r) => r.code === q.code), 'empty room still listed');
  const q2 = await quick('chaos'); assert(q2.code !== q.code, 'Quick Play into an empty room');
  // stale: a listed room that stops reporting (crashed) goes after ttl
  await reset({ ttl: 800 });
  const s1 = await quick('hill'); const B = await join(s1.code, 'Stale');
  await sleep(1300); assert(!(await list('hill')).some((r) => r.code === s1.code), 'stale room not pruned');
  B.close();
  // exclude: the client could not join that code (full / started / gone): ask again without it
  await reset();
  const e1 = await quick('gauntlet'); const C = await join(e1.code, 'Ex');
  const e2 = await quick('gauntlet', [e1.code]); assert(e2.code !== e1.code && e2.created, 'exclude ignored');
  closeAll([C]);
});

await check('after a Quick Play match: party of the same players, Private, unlisted; seats verified flow untouched', async () => {
  await reset();
  const q = await quick('royale'); const A = await join(q.code, 'P1', { autoPlay: true });
  A.test('set', { T: { qpWait: 1500, fast: true, introMs: 0 } }); await sleep(100);
  const B = await join(q.code, 'P2', { autoPlay: true });
  await A.wait((c) => c.start, 8000, 'start');
  for (const p of A.start.players.filter((x) => x.isBot)) A.test('kill', { pid: p.pid });
  A.test('kill', { pid: B.myPid });
  const ko = A.msgs.length; await A.wait((c) => c.msgs.some((m) => m.t === 'over'), 15000, 'over');
  const lob = await since(A, ko, 'lobby', 5000, (m) => !m.party.live);
  assert(!lob.qp && !lob.pub && lob.players.filter((p) => !p.isBot).length === 2, 'after: ' + JSON.stringify({ qp: lob.qp, pub: lob.pub }));
  await sleep(300); assert(!(await list()).some((r) => r.code === q.code), 'finished Quick Play room listed');
  const rec = await A.testGet('rec'); assert(rec.rec && rec.rec.mode === 'royale' && !(rec.rec.start.opts || {}).custom, 'record for boards (non-custom, rated mode)');
  closeAll([A, B]);
});

await check('17.1.1 leader grace: a brief drop keeps the leader (no screen swap); a long one passes it on', async () => {
  await reset();
  const code = await newRoom(); const A = await join(code, 'Lead'), B = await join(code, 'Mem');
  const aTok = A.tok, aPid = A.myPid;
  A.close(); await B.wait((c) => c.lobby && (c.lobby.players.find((p) => p.pid === aPid) || {}).st === 'away', 5000, 'A away');
  assert(B.lobby.leader === aPid, 'leadership flipped on a brief drop');
  const A2 = new Client(code, { tok: aTok, name: 'Lead' }); await A2.open(); await A2.waitMsg('welcome', 5000);
  await A2.wait((c) => c.lobby, 5000, 'A2 lobby'); await sleep(300); assert(B.lobby.leader === aPid && A2.lobby.leader === aPid, 'leader after return: ' + B.lobby.leader);
  A2.test('set', { T: { leadGrace: 1500 } }); await sleep(200);
  A2.close(); await B.wait((c) => c.lobby && c.lobby.leader === B.myPid, 6000, 'handoff after the grace');
  closeAll([A2, B]);
});

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);

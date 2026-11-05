// 18.0 (LV): live spectating + the 17.3 leftovers, against a running `wrangler dev` with test hooks:
//   cd server && npx wrangler dev --local --port 8813 --ip 127.0.0.1 --var ROOM_TEST:1 --var NEW_PER_HOUR:1000 --persist-to /tmp/lv
//   CLOUD=http://127.0.0.1:8813 node test/lv.test.mjs
// Checks: a spectator's lockstep replica hashes identically to the players' (joined mid-match and in the intro), it can't
// act / chat / take a seat / report a backlog, the cap (per room and per IP) and no-live refusals, Browse lists live
// public matches with the watcher count, listed rooms re-report on activity (no alarm loop), /turn needs the Room's
// seat token, and the daily upkeep prunes old moderation verdicts, player-rate rows and replay upload counters.
import { stateHash } from '../../js/statehash.js';
import { Client, newRoom, sleep, check, assert, results, BASE, WS, VER } from './lib.mjs';

const post = (p, b, h) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(h || {}) }, body: JSON.stringify(b || {}) });
const mmt = async (b) => (await post('/mm/test', b)).json();
const lvt = async (b) => (await post('/lv/test', b)).json();
const list = async (mode) => (await (await fetch(BASE + '/mm/list' + (mode ? '?mode=' + mode : ''))).json()).rooms;
const LOOSE = { quickPerMin: 500, createsPer10: 500, roomsPerIp: 500 };
async function join(code, name, o = {}) { const c = new Client(code, { name, autoPlay: o.autoPlay }); await c.open(); await c.waitMsg('welcome', 8000); return c; }
const closeAll = (cs) => { for (const c of cs) { try { c.send({ t: 'part' }); } catch {} c.close(); } };

// a spectator: the same lockstep replica as a player (lib Client), opened with ?watch=1 + {t:'watch'} instead of hello
class Spec extends Client {
  open(o = {}) {
    return new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(`${WS}/ws/room/${this.code}?watch=1`);
      ws.onopen = () => { if (!o.silent) this.send({ t: 'watch', ver: o.ver || VER }); res(this); };
      ws.onerror = () => rej(new Error('ws error'));
      ws.onclose = (e) => { this.closed = true; this.closeCode = e.code; this.kick(); };
      ws.onmessage = (e) => this.onMsg(e.data);
    });
  }
}
async function spec(code, o) { const s = new Spec(code, { name: 'Watcher' }); await s.open(o); return s; }
// first message of a type since the socket opened (a fresh spectator's answer can beat a waitMsg call)
const seen = (c, t, ms = 5000) => c.wait(() => c.msgs.some((m) => m.t === t), ms, 'msg ' + t).then(() => c.msgs.find((m) => m.t === t));
// a Royale with one human (autoPlay) + 7 bots, started; T tweaks before the start
async function liveRoom(T = {}) {
  const code = await newRoom(); const A = await join(code, 'Alice', { autoPlay: true });
  A.test('set', { T: { introMs: 0, ...T } }); await sleep(80);
  A.lead('fill-bots'); await A.wait((c) => c.lobby && c.lobby.players.length === 8, 4000, 'fill');
  A.lead('start'); await A.wait((c) => c.start, 5000, 'start');
  return { code, A };
}

await check('spectator mid-match: snapshot + stream, identical hashes to the end, same final state', async () => {
  const { code, A } = await liveRoom({ fast: false });
  await A.wait((c) => c.applied >= 12, 30000, '12 actions');
  const S = await spec(code);
  const w = await seen(S, 'welcome', 5000); assert(w.spec && w.pid == null && w.w >= 1, 'spec welcome ' + JSON.stringify(w));
  await S.wait((c) => c.s && c.snaps === 1, 5000, 'snapshot'); assert(S.start && S.start.resume && S.start.pid == null, 'resume start for the spectator');
  A.test('set', { T: { fast: true } });
  await A.wait((c) => c.s && c.s.over, 60000, 'over'); await seen(S, 'over', 10000);
  assert(S.hashBad === 0 && S.gaps === 0, `spectator hash mismatches ${S.hashBad}, gaps ${S.gaps}`);
  assert(S.hashOk >= 3, 'spectator checked hashes ' + S.hashOk);
  assert(stateHash(S.s) === stateHash(A.s), 'final state differs');
  assert(S.msgs.some((m) => m.t === 'over'), 'over reached the spectator');
  const st = await A.testGet('state'); assert(!st.socks.includes(null) && st.socks.length === 1, 'spectator counted as a socket: ' + st.socks);
  closeAll([A]); S.close();
  return `${S.applied} actions replayed, ${S.hashOk} hashes ok`;
});

await check('spectator in the intro gets the start (intro left) and replays from v0', async () => {
  const { code, A } = await liveRoom({ introMs: 3000, fast: true });
  const S = await spec(code); await seen(S, 'start', 4000);
  assert(!S.start.resume && S.start.introMs > 0 && S.start.introMs <= 3000, 'intro start ' + JSON.stringify({ r: S.start.resume, ms: S.start.introMs }));
  await A.wait((c) => c.s && c.s.over, 60000, 'over'); await S.wait((c) => c.s && c.s.over, 10000, 'spec over');
  assert(S.hashBad === 0 && stateHash(S.s) === stateHash(A.s), 'hash');
  closeAll([A]); S.close();
  return `${S.applied} actions`;
});

await check('read-only: act / hello / chat / lead / vc / bl from a spectator change nothing', async () => {
  const { code, A } = await liveRoom({ fast: false });
  await A.wait((c) => c.applied >= 4, 20000, 'actions');
  const S = await spec(code); await S.wait((c) => c.s, 5000, 'state');
  const n0 = A.msgs.length, lob0 = JSON.stringify(A.lobby.players.map((p) => p.pid));
  S.send({ t: 'hello', pid: 'tokspectator0001', name: 'Sneaky', ver: VER });
  S.send({ t: 'act', a: { type: 'end' }, n: S.s.v }); S.send({ t: 'chat', k: 'gg' }); S.send({ t: 'emote', k: 'gg' });
  S.send({ t: 'lead', op: 'start' }); S.send({ t: 'vc', a: 'join', vid: 'abcdefgh' }); S.send({ t: 'bl', ms: 9000 }); S.send({ t: 'ready', on: true });
  await sleep(1200);
  const st = await A.testGet('state');
  assert(!Object.keys(st.R.bl || {}).some((k) => !st.R.players.some((p) => p.pid === k)), 'spectator backlog stored: ' + JSON.stringify(st.R.bl));
  assert(JSON.stringify(st.R.players.map((p) => p.pid)) === lob0, 'players changed');
  assert(!Object.keys(st.R.vc || {}).length, 'spectator joined voice');
  assert(!A.msgs.slice(n0).some((m) => m.t === 'chat' || m.t === 'vc' || (m.t === 'lobby' && m.players.some((p) => p.name === 'Sneaky'))), 'spectator message reached players');
  assert(!S.msgs.some((m) => m.t === 'nack' || m.t === 'err' || (m.t === 'welcome' && m.pid)), 'spectator got a seat answer');
  // a player's chat reaches the spectator (public lines only)
  const k = S.msgs.length; A.send({ t: 'chat', k: 'gg' }); await S.waitMsg('chat', 4000).catch(() => null);
  const sawChat = S.msgs.slice(k).some((m) => m.t === 'chat');
  closeAll([A]); S.close();
  return `public chat to spectators: ${sawChat}`;
});

await check('cap: 8 per room by default, per-IP cap, no live match = nolive, version check', async () => {
  // no match yet: refused
  const code0 = await newRoom(); const L = await join(code0, 'Lobby');
  const S0 = await spec(code0); const b0 = await seen(S0, 'bye', 4000); assert(b0.why === 'nolive', 'lobby watch ' + b0.why);
  closeAll([L]);
  const { code, A } = await liveRoom({ fast: false, specPerIp: 99 });
  const ss = []; for (let i = 0; i < 8; i++) { const s = await spec(code); await seen(s, 'welcome', 5000); ss.push(s); }
  const S9 = await spec(code); const b = await seen(S9, 'bye', 4000); assert(b.why === 'watchfull', '9th ' + b.why);
  await ss[7].wait((c) => c.last('spec') && c.last('spec').n === 8, 3000, 'count 8');
  ss.pop().close(); await ss[0].wait((c) => c.last('spec') && c.last('spec').n === 7, 4000, 'count back to 7');
  const S8 = await spec(code); await seen(S8, 'welcome', 4000); ss.push(S8);
  for (const s of ss) s.close(); await sleep(600);
  A.test('set', { T: { specPerIp: 2 } }); await sleep(150);
  const p1 = await spec(code), p2 = await spec(code); await seen(p1, 'welcome', 4000); await seen(p2, 'welcome', 4000);
  const p3 = await spec(code); const b3 = await seen(p3, 'bye', 4000); assert(b3.why === 'watchfull', 'per-IP ' + b3.why);
  p1.close(); p2.close(); await sleep(500);
  const old = await spec(code, { ver: 'p0-old' }); const bo = await seen(old, 'bye', 4000); assert(bo.why === 'update', 'old version ' + bo.why);
  closeAll([A]);
  return '8 admitted, 9th refused, freed slot reused, per-IP 2';
});

await check('Browse lists a live public match with its watcher count; Quick Play never hands it out', async () => {
  await mmt({ op: 'reset' }); await mmt({ op: 'set', L: LOOSE });
  const q = await (await post('/mm/quick', { mode: 'royale' })).json();
  const A = await join(q.code, 'Qa', { autoPlay: true }); A.test('set', { T: { qpWait: 800, introMs: 0 } }); await sleep(100);
  const B = await join(q.code, 'Qb', { autoPlay: true });
  await A.wait((c) => c.start, 8000, 'start'); await sleep(400);
  let l = await list('royale'); const e = l.find((r) => r.code === q.code);
  assert(e && e.st === 'live' && e.w === 0 && e.wcap === 8 && e.h === 2, 'live listing ' + JSON.stringify(l));
  const q2 = await (await post('/mm/quick', { mode: 'royale' })).json(); assert(q2.code !== q.code, 'Quick Play into a live match');
  const S = await spec(q.code); await seen(S, 'welcome', 4000); await sleep(500);
  l = await list(); assert((l.find((r) => r.code === q.code) || {}).w === 1, 'watcher count ' + JSON.stringify(l.find((r) => r.code === q.code)));
  assert(l[l.length - 1].st === 'live' || l.every((r) => r.st === 'live'), 'live rows sort after joinable lobbies');
  S.close(); closeAll([A, B]);
  return JSON.stringify(e);
});

await check('listing freshness: a quiet public lobby falls off; any activity re-reports it; a long match stays listed', async () => {
  await mmt({ op: 'reset' }); await mmt({ op: 'set', L: { ...LOOSE, ttl: 3000 } });
  const code = await newRoom(); const A = await join(code, 'Host'); const B = await join(code, 'Guest');
  A.test('set', { T: { mmRefresh: 1500 } }); await sleep(100);
  A.lead('public', { on: true }); await sleep(400);
  assert((await list()).some((r) => r.code === code), 'listed after Public');
  await sleep(4200); assert(!(await list()).some((r) => r.code === code), 'quiet lobby still listed past the ttl (prune check)');
  B.send({ t: 'bl', ms: 0 }); await sleep(500); // any message the room handles anyway
  assert((await list()).some((r) => r.code === code), 'activity did not re-report the lobby');
  // live: the match's own actions keep it fresh well past the ttl
  A.test('set', { T: { introMs: 0, mmRefresh: 1500 } }); B.send({ t: 'ready', on: true }); await sleep(150);
  A.lead('fill-bots'); await sleep(150); A.lead('start'); await A.wait((c) => c.start, 5000, 'start');
  A.autoPlay = B.autoPlay = true; A.play(); B.play();
  for (let i = 0; i < 4; i++) { await sleep(2000); const e = (await list()).find((r) => r.code === code); assert(e && e.st === 'live', `live listing gone after ${(i + 1) * 2} s`); }
  closeAll([A, B]); await mmt({ op: 'set', L: { ttl: 600000 } });
  return 'pruned after 3 s idle, back on activity, live kept 8 s with ttl 3 s';
});

await check('/turn: relay credentials need the seat token from welcome / match start', async () => {
  const j0 = await (await fetch(BASE + '/turn')).json(); assert(j0.src === 'public' && j0.err === 'token' && j0.iceServers.length, 'no token ' + JSON.stringify(j0));
  const code = await newRoom(); const A = await join(code, 'Voice');
  const tok = A.last('welcome').turn; assert(typeof tok === 'string' && tok.split('.').length === 4 && tok.includes(code) && tok.includes(A.myPid), 'welcome.turn ' + tok);
  const j1 = await (await fetch(BASE + '/turn?t=' + encodeURIComponent(tok))).json(); assert(!j1.err && j1.iceServers.length, 'valid token ' + JSON.stringify(j1));
  const bad = tok.slice(0, -2) + (tok.endsWith('AA') ? 'BB' : 'AA');
  const j2 = await (await fetch(BASE + '/turn?t=' + encodeURIComponent(bad))).json(); assert(j2.err === 'token', 'tampered token accepted');
  const forged = tok.replace(code, 'ZZZZZ'); const j3 = await (await fetch(BASE + '/turn?t=' + encodeURIComponent(forged))).json(); assert(j3.err === 'token', 'forged room accepted');
  const parts = tok.split('.'); parts[0] = (Date.now() - 1000).toString(36); const j4 = await (await fetch(BASE + '/turn?t=' + encodeURIComponent(parts.join('.')))).json(); assert(j4.err === 'token', 'expired/edited accepted');
  A.test('set', { T: { introMs: 0, fast: true } }); A.lead('fill-bots'); await sleep(150); A.lead('start');
  const t2 = await A.waitMsg('turn', 5000); assert(typeof t2.tok === 'string' && !(await (await fetch(BASE + '/turn?t=' + encodeURIComponent(t2.tok))).json()).err, 'start token');
  closeAll([A]);
  return 'no token / tampered / forged / expired -> public; welcome + start tokens -> ok';
});

await check('daily upkeep prunes old moderation verdicts, player-rate rows, replay upload counters', async () => {
  const s1 = await lvt({ op: 'seedmod', n: 60, ageDays: 40, tag: 'old' }), s2 = await lvt({ op: 'seedmod', n: 15, ageDays: 2, tag: 'new' });
  assert(s1.ok && s2.total >= 75, 'seed ' + JSON.stringify([s1, s2]));
  const np = await post('/player/new', {}); assert(np.status === 201, 'player/new ' + np.status);
  await post('/replay', { bad: 1 }, { 'x-cc-test-ip': 'lvtest-' + Date.now() });
  const now = await lvt({ op: 'maint' });
  assert(now.mod && now.mod.deleted >= 60 && now.mod.scanned >= 75, 'mod prune ' + JSON.stringify(now.mod));
  assert(now.lim && now.lim.left >= 1 && now.rp && now.rp.scanned >= 1, 'fresh rows kept ' + JSON.stringify(now));
  const later = await lvt({ op: 'maint', now: Date.now() + 2 * 3600e3 });
  assert(later.lim.deleted >= 1 && later.lim.left === 0, 'player-rate rows ' + JSON.stringify(later.lim));
  assert(later.rp.deleted >= 1, 'replay counters ' + JSON.stringify(later.rp));
  assert(later.mod.deleted === 0, 'fresh verdicts deleted ' + JSON.stringify(later.mod));
  const far = await lvt({ op: 'maint', now: Date.now() + 31 * 864e5 });
  assert(far.mod.deleted >= 15, '30-day-old fresh verdicts later ' + JSON.stringify(far.mod));
  return JSON.stringify({ now: now.mod, later: later.lim, rp: later.rp });
});

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);

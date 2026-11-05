// 17.0 (S1): Room DO tests against a running `wrangler dev` with test hooks on:
//   cd server && npm run dev:test        (= wrangler dev --port 8787 --var ROOM_TEST:1)
//   node test/run.mjs                    (CLOUD=http://127.0.0.1:<port> to use another port) [suite ...]     suites: protocol determinism resume alarms cleanup cpu
import * as E from '../../js/engine.js';
import { stateHash } from '../../js/statehash.js';
import { Client, newRoom, sleep, check, assert, results, stats, BASE, WS, VER, newTok } from './lib.mjs';

const want = new Set(process.argv.slice(2));
const on = (s) => !want.size || want.has(s);
const cpuAll = { act: [], plan: [], alarm: [], msg: [] };
const strip = (s) => { const o = structuredClone(s); delete o.aiSeed; for (const u of o.units) delete u.bot; return JSON.stringify(o); };

async function room(n = 1, o = {}) {
  const code = await newRoom();
  const cs = [];
  for (let i = 0; i < n; i++) { const c = new Client(code, { name: (o.names || ['Alice', 'Bob', 'Cara', 'Dan'])[i], autoPlay: o.autoPlay }); await c.open(); await c.waitMsg('welcome', 5000); cs.push(c); }
  if (o.T) { cs[0].test('set', { T: o.T }); await sleep(50); }
  await cs[cs.length - 1].wait((c) => c.lobby && c.lobby.players.length === n, 5000, 'lobby n');
  return { code, cs, A: cs[0], B: cs[1], C: cs[2] };
}
async function readyAll(cs) { for (const c of cs.slice(1)) c.send({ t: 'ready', on: true }); await cs[0].wait((c) => c.lobby && c.lobby.players.filter((p) => !p.isBot && p.pid !== c.lobby.leader).every((p) => p.st === 'ready'), 5000, 'all ready'); }
async function startMatch(cs, ms = 5000) { await readyAll(cs); const n0 = cs.map((c) => c.count('start')); cs[0].lead('start'); for (const [i, c] of cs.entries()) await c.wait(() => c.count('start') > n0[i], ms, 'start'); }
async function cpuOf(c) { const r = await c.testGet('cpu'); for (const k of Object.keys(cpuAll)) cpuAll[k].push(...(r.cpu[k] || [])); c.test('cpuReset'); return r.cpu; }

// ---------------------------------------------------------------- protocol
if (on('protocol')) {
  await check('health + ver', async () => { const r = await (await fetch(BASE + '/health')).json(); assert(r.ok && r.ver === VER, JSON.stringify(r)); return r.ver; });
  await check('CORS allowlist', async () => {
    const ok = await fetch(BASE + '/health', { method: 'OPTIONS', headers: { Origin: 'https://dianteclark.github.io', 'Access-Control-Request-Method': 'PUT' } });
    assert(ok.status === 204 && ok.headers.get('access-control-allow-origin') === 'https://dianteclark.github.io', 'pages origin');
    const lh = await fetch(BASE + '/health', { headers: { Origin: 'http://localhost:8123' } });
    assert(lh.headers.get('access-control-allow-origin') === 'http://localhost:8123', 'localhost origin');
    const bad = await fetch(BASE + '/health', { headers: { Origin: 'https://evil.example' } });
    assert(!bad.headers.get('access-control-allow-origin'), 'evil origin got CORS');
    assert(/Authorization/.test(ok.headers.get('access-control-allow-headers')), 'allow headers');
  });
  await check('unknown room -> bye noroom, bad code -> 404', async () => {
    const r2 = await fetch(BASE + '/ws/room/ab1', {}); assert(r2.status === 404, 'bad code ' + r2.status);
    const c = new Client('ZZZZ8'); await c.open(); const m = await c.waitMsg('bye', 4000); assert(m.why === 'noroom', m.why);
    await c.wait(() => c.closed, 3000, 'closed'); assert(!c.myPid, 'welcomed into a room that does not exist');
  });
  await check('version mismatch -> bye update', async () => {
    const code = await newRoom(); const c = new Client(code, { ver: 'p0-old' }); await c.open();
    const m = await c.waitMsg('bye', 4000); assert(m.why === 'update' && m.reason === 'update' && m.ver === VER, JSON.stringify(m));
    await c.wait(() => c.closed, 3000, 'closed'); assert(c.closeCode === 4001, 'close code ' + c.closeCode);
  });
  await check('bad token -> bye bad', async () => { const code = await newRoom(); const c = new Client(code, { tok: 'x' }); await c.open(); const m = await c.waitMsg('bye', 4000); assert(m.why === 'bad', m.why); });
  await check('welcome, lobby shape, heartbeat auto-response', async () => {
    const { A, B, cs } = await room(2);
    const w = A.last('welcome'); assert(/^p[a-z0-9]{9}$/.test(w.pid) && w.leader === w.pid && w.room === A.code && w.ver === VER, JSON.stringify(w));
    const L = B.lobby; assert(L.code === A.code && L.mode && L.maxP === 8 && L.leader === A.myPid && L.party && L.party.group === 'competitive' && L.party.live === false && L.party.leader === 'Alice', JSON.stringify(L));
    const pa = L.players.find((p) => p.pid === A.myPid), pb = L.players.find((p) => p.pid === B.myPid);
    assert(pa.st === 'leader' && pb.st === 'wait' && pa.name === 'Alice' && pa.skin === 'ivory' && pa.title === 'Tester' && pa.isBot === false, JSON.stringify(L.players));
    assert(!JSON.stringify(L).includes(A.tok), 'token leaked in lobby');
    A.send('{"t":"hb"}'); await A.wait(() => A.hbAnswered > 0, 3000, 'hb'); cs.forEach((c) => c.close());
  });
  await check('leader-only commands + party options', async () => {
    const { A, B, cs } = await room(2);
    B.lead('add-bot'); const e = await B.waitMsg('err', 3000); assert(/leader/i.test(e.why), e.why);
    A.lead('add-bot'); await B.wait(() => B.lobby.players.length === 3, 3000, 'bot added');
    const bot = B.lobby.players.find((p) => p.isBot); assert(bot.st === 'bot' && bot.name, JSON.stringify(bot));
    A.lead('fill-bots'); await B.wait(() => B.lobby.players.length === 8, 3000, 'fill');
    A.lead('add-bot'); assert(/full/i.test((await A.waitMsg('err', 3000)).why), 'full err');
    A.lead('group', { group: 'coop' }); await B.wait(() => B.lobby.party.group === 'coop', 3000, 'group coop');
    assert(['siege', 'gauntlet'].includes(B.lobby.mode) && B.lobby.players.length <= B.lobby.maxP, 'coop mode/maxP ' + B.lobby.mode + ' ' + B.lobby.players.length + '/' + B.lobby.maxP);
    A.lead('group', { group: 'competitive' }); A.lead('mode', { mode: 'duel' }); await B.wait(() => B.lobby.mode === 'duel', 3000, 'duel');
    assert(B.lobby.players.length === 2 && B.lobby.maxP === 2, 'duel trims bots ' + B.lobby.players.length);
    A.lead('mode', { mode: 'squads' }); await B.wait(() => B.lobby.mode === 'squads', 3000, 'squads');
    A.lead('location', { loc: 'forge' }); A.lead('add-bot'); await B.wait(() => B.lobby.players.length === 3, 3000, 'loc ignored'); assert(B.lobby.party.loc === 'random', 'location outside custom must stay random'); // 17.0 (D2): location only in Custom
    A.lead('clear-bots'); A.lead('group', { group: 'custom' }); await B.wait(() => B.lobby.party.group === 'custom' && B.lobby.party.custom, 3000, 'custom');
    A.lead('location', { loc: 'forge' }); await B.wait(() => B.lobby.party.loc === 'forge' && B.lobby.party.locName !== 'Random', 3000, 'loc');
    A.lead('location', { loc: '__proto__' }); await B.wait(() => B.lobby.party.loc === 'random', 3000, 'bad loc -> random');
    A.lead('custom', { k: 'storm', v: 'fast' }); await B.wait(() => B.lobby.party.custom.storm === 'fast', 3000, 'rule');
    A.lead('custom', { k: 'storm', v: 'warp' }); assert(/value/i.test((await A.waitMsg('err', 3000)).why), 'bad rule');
    A.lead('add-bot'); await B.wait(() => B.lobby.players.some((p) => p.isBot), 3000, 'bot');
    const bp = B.lobby.players.find((p) => p.isBot).pid; A.lead('kick', { pid: bp }); await B.wait(() => !B.lobby.players.some((p) => p.pid === bp), 3000, 'kick bot');
    A.lead('kick', { pid: B.myPid }); const by = await B.waitMsg('bye', 3000); assert(by.why === 'kicked', by.why);
    await A.wait(() => A.lobby.players.length === 1, 3000, 'kicked gone'); cs.forEach((c) => c.close());
  });
  await check('start: ready gate, identical match on every client, real intro hold', async () => {
    const { A, B, cs } = await room(2);
    A.lead('fill-bots'); await B.wait(() => B.lobby.players.length === 8, 3000, 'fill');
    A.lead('start'); assert(/ready up/i.test((await A.waitMsg('err', 3000)).why), 'ready gate');
    await startMatch(cs);
    const sa = A.last('start'), sb = B.last('start');
    assert(sa.mid === sb.mid && sa.seed === sb.seed && JSON.stringify(sa.players) === JSON.stringify(sb.players) && sa.pid === A.myPid && sb.pid === B.myPid, 'start differs');
    assert(sa.introMs >= 4000 && sa.introMs < 30000, 'introMs ' + sa.introMs);
    assert(stateHash(A.s) === stateHash(B.s), 'initial states differ');
    await sleep(600); assert(!A.msgs.some((m) => m.t === 'a'), 'acted during the intro');
    assert(B.lobby.party.live === true && B.lobby.players.find((p) => p.pid === B.myPid).st === 'play', 'lobby live/play');
    const C = new Client(A.code); await C.open(); assert((await C.waitMsg('bye', 3000)).why === 'started', 'late join');
    cs.forEach((c) => c.close());
    return `introMs ${sa.introMs}`;
  });
  await check('acts: wrong player / stale n -> nack; chat relay, filter, rate limit; voice relay', async () => {
    const { A, B, cs } = await room(2, { T: { introMs: 0, turnMs: 60000 } });
    await startMatch(cs);
    await A.wait(() => A.s && A.s.active != null && A.last('dl'), 4000, 'first clock');
    const act = E.unitById(A.s, A.s.active), other = act.pid === A.myPid ? B : A, me = act.pid === A.myPid ? A : B;
    other.send({ t: 'act', a: { type: 'end' }, n: other.s.v }); await sleep(300); assert(!A.msgs.some((m) => m.t === 'a'), 'wrong player acted');
    me.send({ t: 'act', a: { type: 'end' }, n: me.s.v + 5 }); const nk = await me.waitMsg('nack', 2000); assert(nk.v === 0, 'nack v');
    me.send({ t: 'act', a: { type: 'end' }, n: me.s.v }); await A.waitMsg('a', 3000);
    assert(A.s.v === 1 && B.s.v === 1 && stateHash(A.s) === stateHash(B.s), 'after one act');
    A.send({ t: 'chat', k: 'g.glhf' }); const c1 = await B.waitMsg('chat', 2000, (m) => m.k === 'g.glhf'); assert(c1.pid === A.myPid && c1.id === E.unitById(A.s, c1.id).id, 'chat ids');
    await sleep(1600); A.send({ t: 'chat', x: 'you are a shit player' }); const c2 = await B.waitMsg('chat', 2000, (m) => m.x); assert(c2.x.includes('****') && !/shit/i.test(c2.x), 'mask ' + c2.x);
    A.send({ t: 'chat', x: '<b>hi</b>' }); // custom text gap 3 s -> throttled
    for (let i = 0; i < 6; i++) A.send({ t: 'chat', k: 'r.nice' });
    await A.waitMsg('chat', 2000, (m) => m.a === 'slow');
    A.send({ t: 'chat', k: 'not.a.phrase' });
    A.send({ t: 'vc', a: 'join', vid: 'peer-' + A.myPid }); const ro = await B.waitMsg('vc', 2000, (m) => m.a === 'roster'); assert(ro.list.length === 1 && ro.list[0].pid === A.myPid, 'roster');
    A.send({ t: 'vc', a: 'talk', on: true }); const tk = await B.waitMsg('vc', 2000, (m) => m.a === 'talk'); assert(tk.pid === A.myPid && tk.on === 1, 'talk');
    B.send({ t: 'vc', a: 'join', vid: 'peer-' + A.myPid }); await sleep(300); assert(B.last('vc').list === undefined || B.last('vc').list.length === 1, 'duplicate vid accepted');
    cs.forEach((c) => c.close());
  });
  await check('test ops kill / protect / bot (online suite helpers)', async () => {
    const { A, B, cs } = await room(2, { T: { introMs: 0, turnMs: 60000 } });
    A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === 8, 3000, 'fill');
    await startMatch(cs);
    A.test('protect', { pids: [A.myPid, B.myPid] });
    const bot = A.s.units.find((u) => u.bot && u.kind === 'player');
    A.test('kill', { pid: bot.pid }); const sn = await B.waitMsg('snap', 3000, (m) => m.ev);
    assert(sn.ev[0].e === 'death' && sn.ev[0].id === bot.id && !E.unitById(B.s, bot.id).alive, 'kill snap');
    A.test('bot', { pid: B.myPid, on: true }); const se = await A.waitMsg('seat', 3000, (m) => m.pid === B.myPid); assert(se.bot && se.why === 'test', 'bot op');
    cs.forEach((c) => c.close());
  });
  await check('squads team chat goes to the team only', async () => {
    const { A, B, C, cs } = await room(3, { T: { introMs: 0, turnMs: 60000 } });
    A.lead('mode', { mode: 'squads' }); await A.wait(() => A.lobby.mode === 'squads', 3000, 'squads');
    A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === A.lobby.maxP, 3000, 'fill');
    await startMatch(cs);
    const team = (c) => E.unitById(A.s, A.s.units.find((u) => u.pid === c.myPid).id).team;
    assert(team(A) === team(B) && team(A) !== team(C), 'seat order teams ' + [team(A), team(B), team(C)]);
    A.send({ t: 'chat', k: 't.help', tm: 1 });
    const m = await B.waitMsg('chat', 2000, (x) => x.k === 't.help'); assert(m.tm === 1 && m.team === undefined, 'tm flag');
    await sleep(400); assert(!C.msgs.some((x) => x.t === 'chat' && x.k === 't.help'), 'enemy saw team chat');
    cs.forEach((c) => c.close());
  });
  // 17.3 (QS): lobby-changing messages are flood-limited per seat (each one = broadcast + storage write + MM report)
  await check('flood guard: 200 ready toggles -> about 20 lobby broadcasts, then leader gets one "Too fast"', async () => {
    const { cs, A, B } = await room(2);
    await sleep(200); const n0 = A.count('lobby');
    for (let i = 0; i < 200; i++) B.send({ t: 'ready', on: i % 2 === 0 });
    for (let i = 0; i < 40; i++) A.lead('location', { loc: 'random' });
    await sleep(800);
    const got = A.count('lobby') - n0, errs = A.msgs.filter((m) => m.t === 'err' && /Too fast/.test(m.why)).length;
    assert(got <= 50, 'lobby broadcasts ' + got);
    assert(errs === 1, 'too-fast errs ' + errs);
    await sleep(1600); B.send({ t: 'ready', on: true }); // refilled: a normal message goes through again
    await A.wait(() => A.lobby.players.some((p) => p.pid === B.myPid && p.st === 'ready'), 3000, 'ready after refill');
    cs.forEach((c) => c.close());
    return `${got} lobby broadcasts for 240 messages`;
  });
}

// ---------------------------------------------------------------- determinism
// Humans play through their OWN replicated state (local planBot) and send acts; bots run on the server. Every client
// checks every {t:'h'} hash; at the end the client states must equal each other and the server's hash.
async function lockstep(mode, humans, label, o = {}) {
  const { A, cs } = await room(humans, { autoPlay: true, T: { fast: true, introMs: 0 } });
  if (mode !== 'royale') { A.lead('group', { group: mode === 'siege' ? 'coop' : 'competitive' }); A.lead('mode', { mode }); await A.wait(() => A.lobby.mode === mode, 3000, 'mode ' + mode); }
  A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === A.lobby.maxP, 3000, 'fill');
  if (o.forfeit) for (const c of cs) c.autoPlay = false;
  let total = 0, matches = 0; const extra = [];
  while (total < (o.min || 300)) {
    if (matches) { for (const c of cs) c.send({ t: 'back' }); await sleep(100); }
    await startMatch(cs);
    if (o.forfeit) for (const c of cs) c.send({ t: 'leave' }); // every seat a bot: an all-bot match, clients spectate
    await A.wait(() => A.s && A.s.over, 240000, 'over');
    for (const c of cs) await c.wait(() => c.s && c.s.over && c.last('over') && c.last('over').v === c.s.v, 10000, 'client over');
    const srv = await A.testGet('state');
    for (const c of cs) { assert(c.hashBad === 0, `${c.name} hash mismatches ${c.hashBad}`); assert(c.gaps === 0, `${c.name} gaps ${c.gaps}`); assert(stateHash(c.s) === srv.R.m.hash, `${c.name} final hash != server`); }
    for (const c of cs.slice(1)) assert(strip(c.s) === strip(A.s), 'client states differ');
    total += A.s.v; matches++; extra.push(`${A.s.v}${A.s.winner != null ? '' : ''}`);
    await cpuOf(A);
  }
  const hashes = cs.reduce((a, c) => a + c.hashOk, 0);
  cs.forEach((c) => c.close());
  return `${label}: ${total} actions over ${matches} match(es) [${extra.join(', ')}], ${hashes} hash checks equal, 0 mismatches`;
}
if (on('determinism')) {
  await check('lockstep 8-bot Royale (all seats bots, 2 spectating clients)', () => lockstep('royale', 2, 'royale', { forfeit: true }));
  await check('lockstep Royale 2 humans + 6 bots', () => lockstep('royale', 2, 'royale'));
  await check('lockstep Siege 4p (2 humans + 2 bots)', () => lockstep('siege', 2, 'siege'));
  await check('lockstep Squads (3 humans + 5 bots)', () => lockstep('squads', 3, 'squads'));
}

// ---------------------------------------------------------------- resume + leader handoff
if (on('resume')) {
  await check('lobby: leader drops -> leadership passes; comes back with the same token, seat kept', async () => {
    const { A, B, C, cs } = await room(3);
    const aPid = A.myPid; A.close();
    await B.wait(() => B.lobby.leader === B.myPid && B.lobby.players.find((p) => p.pid === aPid).st === 'away', 14000, 'handoff'); // 17.1.1 (MM): after the 8 s leader grace (T.leadGrace)
    B.lead('add-bot'); await C.wait(() => C.lobby.players.some((p) => p.isBot), 3000, 'new leader can lead');
    const A2 = new Client(A.code, { tok: A.tok, name: 'Alice' }); await A2.open(); await A2.waitMsg('welcome', 3000);
    assert(A2.myPid === aPid, 'same seat'); await C.wait(() => C.lobby.players.find((p) => p.pid === aPid).st === 'wait', 3000, 'back from away');
    assert(C.lobby.leader === B.myPid, 'leadership stays with B');
    B.send({ t: 'part' }); await C.wait(() => C.lobby.leader !== B.myPid && !C.lobby.players.some((p) => p.pid === B.myPid), 3000, 'part -> handoff');
    assert(C.lobby.leader === aPid, 'next human leads: ' + C.lobby.leader);
    [A2, C].forEach((c) => c.close());
  });
  await check('lobby: away member removed after the away window', async () => {
    const { A, B, cs } = await room(2, { T: { awayLobby: 800 } });
    const bp = B.myPid; B.close();
    await A.wait(() => A.lobby.players.some((p) => p.pid === bp && p.st === 'away'), 3000, 'away');
    await A.wait(() => !A.lobby.players.some((p) => p.pid === bp), 4000, 'removed');
    A.close();
  });
  await check('match: drop -> bot holds the seat -> resume within 60 s with start{resume} + snap, hashes stay equal', async () => {
    const { A, B, cs } = await room(2, { autoPlay: true, T: { fast: true, introMs: 0 } });
    A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === 8, 3000, 'fill');
    await startMatch(cs);
    await A.wait(() => A.s.v >= 30 || A.s.over, 60000, 'v30');
    A.test('set', { T: { fast: false } }); await sleep(100);
    assert(!A.s.over, 'match ended too soon');
    const bp = B.myPid, bu = A.s.units.find((u) => u.pid === bp); B.close();
    const nS = A.msgs.length; const seat = await A.waitMsg('seat', 4000, (m) => m.pid === bp).catch((e) => { console.log('DBG', bp, A.msgs.slice(nS).map((m) => m.t + (m.pid ? ':' + m.pid : '')).join(' ')); throw e; }); assert(seat.bot === true && seat.why === 'drop' && seat.id === bu.id, JSON.stringify(seat));
    assert(A.lobby.leader === A.myPid, 'leader unchanged');
    if (bu.alive) await A.wait(() => A.msgs.some((m) => m.t === 'a' && m.pid === bp) || !E.unitById(A.s, bu.id).alive || A.s.over, 30000, 'bot played the dropped seat');
    const v0 = A.s.v;
    await A.wait(() => A.s.v >= v0 + 6 || A.s.over, 30000, 'match goes on');
    A.test('set', { T: { fast: true } });
    const B2 = new Client(A.code, { tok: B.tok, name: 'Bob', autoPlay: true }); await B2.open({ resume: { mid: A.last('start').mid } });
    const st = await B2.waitMsg('start', 4000); assert(st.resume === true && st.mid === A.last('start').mid && st.pid === bp, 'resume start');
    await B2.waitMsg('snap', 4000); assert(B2.s && B2.s.v >= v0, 'snap');
    const back = A.msgs.find((m) => m.t === 'seat' && m.pid === bp && m.bot === false) || (B2.s.over ? null : await A.waitMsg('seat', 4000, (m) => m.pid === bp && m.bot === false).catch((e) => { console.log('DBG', B2.s.v, A.s.v, A.s.over, A.msgs.slice(-12).map((m) => m.t + (m.pid ? ':' + m.pid : '')).join(' ')); throw e; }));
    if (back) assert(back.why === 'back', 'seat back');
    await A.wait(() => A.s.over, 240000, 'over');
    await B2.wait(() => B2.s.over && B2.last('over'), 10000, 'B2 over');
    assert(B2.hashBad === 0 && B2.gaps === 0 && stateHash(B2.s) === stateHash(A.s), `after resume: bad ${B2.hashBad} gaps ${B2.gaps}`);
    assert(B2.hashOk > 0 || A.s.v - v0 < 8, 'no hash checks after resume');
    const s1 = strip(B2.s), s2 = strip(A.s); assert(s1 === s2, 'states differ after snap resume');
    [A, B2].forEach((c) => c.close());
    return `resumed at v${B2.snaps ? B2.s.v : '?'}; ${B2.hashOk} hash checks after the snap`;
  });
  await check('match: resume window expires -> removed from the party, cannot rejoin the live match', async () => {
    const { A, B, cs } = await room(2, { T: { introMs: 0, resume: 1000, turnMs: 60000 } });
    A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === 8, 3000, 'fill');
    await startMatch(cs);
    const bp = B.myPid; B.close();
    await A.wait(() => A.lobby.players.some((p) => p.pid === bp && p.st === 'away'), 3000, 'away');
    await A.wait(() => !A.lobby.players.some((p) => p.pid === bp), 5000, 'removed after 1 s');
    const B2 = new Client(A.code, { tok: B.tok }); await B2.open(); assert((await B2.waitMsg('bye', 3000)).why === 'started', 'bye started');
    A.close();
  });
  await check('match: leader drops -> leadership passes; forfeit keeps the player in the party; back to party + rematch', async () => {
    const { A, B, C, cs } = await room(3, { T: { fast: true, introMs: 0 } });
    A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === 8, 3000, 'fill');
    await startMatch(cs);
    for (const c of cs) c.send({ t: 'leave' }); // all forfeit: 8 bots
    await B.wait(() => B.msgs.filter((m) => m.t === 'seat' && m.why === 'leave').length >= 3, 4000, 'forfeit seats');
    A.close();
    await B.wait(() => B.lobby.leader === B.myPid, 14000, 'leader handoff mid-match'); // 17.1.1 (MM): after T.leadGrace
    await B.wait(() => B.s.over && B.lobby.party.live === false, 240000, 'over');
    assert(B.lobby.players.some((p) => p.pid === C.myPid), 'forfeiter still in party');
    const rs = B.lobby.players.find((p) => p.pid === C.myPid).st; assert(rs === 'results', 'results state ' + rs);
    B.send({ t: 'back' }); C.send({ t: 'back' }); C.send({ t: 'ready', on: true });
    await B.wait(() => B.lobby.players.find((p) => p.pid === C.myPid).st === 'ready', 3000, 'C ready');
    const n0 = C.count('start'); B.lead('start'); await C.wait(() => C.count('start') > n0, 4000, 'rematch start');
    assert(C.last('start').mid !== C.msgs.filter((m) => m.t === 'start')[0].mid, 'new mid');
    [B, C].forEach((c) => c.close());
  });
}

// ---------------------------------------------------------------- alarms
if (on('alarms')) {
  await check('turn clock: an idle human times out by alarm ({t:a, to:1})', async () => {
    const { A, cs } = await room(1, { T: { introMs: 0, turnMs: 1200, turnGrace: 0 } });
    A.lead('add-bot'); await A.wait(() => A.lobby.players.length === 2, 3000, 'bot');
    await startMatch(cs);
    const t0 = Date.now();
    const m = await A.waitMsg('a', 15000, (x) => x.to === 1 && x.pid === A.myPid);
    const dt = Date.now() - t0;
    assert(m.a.type === 'end', 'timeout end');
    const firstDl = A.msgs.find((x) => (x.t === 'dl' || x.t === 'a') && x.dl > 0); assert(firstDl && firstDl.dl <= 1200, 'dl ' + (firstDl && firstDl.dl));
    A.close();
    return `timed out ${dt} ms after start (bot turns first included)`;
  });
  await check('intro hold: no action before introMs, then the first clock', async () => {
    const { A, cs } = await room(1, { T: { introMs: 1500 } });
    A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === 8, 3000, 'fill');
    const t0 = Date.now(); await startMatch(cs);
    assert(A.last('start').introMs === 1500, 'introMs');
    await A.waitMsg('a', 8000);
    const dt = Date.now() - t0; assert(dt >= 1450, 'acted after ' + dt);
    A.close(); return `first action ${dt} ms after start`;
  });
  await check('bot pacing 520/480 ms and the backlog rule (slowest human, cap 3 s)', async () => {
    const { A, cs } = await room(1, { T: { introMs: 0, turnMs: 60000 } });
    A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === 8, 3000, 'fill');
    await startMatch(cs);
    A.send({ t: 'leave' }); // every seat is a bot now
    // gaps between actions: same turn = step (480), new turn = think (520 + backlog lag)
    const gaps = (from, to) => { const as = A.msgs.slice(from, to).filter((m) => m.t === 'a'); const g = { step: [], think: [] }; for (let i = 1; i < as.length; i++) (as[i]._turn === as[i - 1]._turn ? g.step : g.think).push(as[i]._at - as[i - 1]._at); return g; };
    const n0 = A.msgs.length; await sleep(6000); const g0 = gaps(n0);
    const timer = setInterval(() => A.send({ t: 'bl', ms: 3000 }), 400); A.send({ t: 'bl', ms: 3000 });
    await sleep(500); const n1 = A.msgs.length; await sleep(9000); clearInterval(timer); const g1 = gaps(n1);
    A.send({ t: 'bl', ms: 0 }); A.close();
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
    assert(med(g0.step) >= 430 && med(g0.step) < 700, 'step gap ' + med(g0.step));
    assert(med(g0.think) >= 470 && med(g0.think) < 800, 'think gap ' + med(g0.think));
    assert(med(g1.think) >= 2450 && med(g1.think) < 3000, 'think with backlog ' + med(g1.think));
    const lagged = med(g1.think);
    return `median step ${med(g0.step)} ms, think ${med(g0.think)} ms, think with a 3 s backlog ${lagged} ms`;
  });
}

// ---------------------------------------------------------------- cleanup
if (on('cleanup')) {
  await check('empty room: storage wiped by alarm, code no longer joinable', async () => {
    const { A, B, code } = await room(2, { T: { clean: 1000 } });
    A.close(); B.close();
    await sleep(2200);
    let failed = false; try { const c = new Client(code); await c.open(); await sleep(400); failed = c.closed && !c.myPid; } catch { failed = true; }
    assert(failed, 'room still open after cleanup');
  });
  await check('reserved code nobody joined is not handed out twice', async () => {
    const codes = new Set(); for (let i = 0; i < 20; i++) codes.add(await newRoom()); assert(codes.size === 20, 'duplicate code');
  });
}

// ---------------------------------------------------------------- CPU
if (on('cpu')) {
  await check('CPU per message in workerd (8-bot Royale, all bots, real pacing off)', async () => {
    for (let i = 0; i < 2; i++) {
      const { A, cs } = await room(1, { T: { fast: true, introMs: 0 } });
      A.lead('fill-bots'); await A.wait(() => A.lobby.players.length === 8, 3000, 'fill');
      await startMatch(cs); A.send({ t: 'leave' });
      await A.wait(() => A.s.over, 240000, 'over'); await cpuOf(A); A.close();
    }
    return '';
  });
}

if (cpuAll.act.length) {
  console.log('\nCPU (workerd local, performance.now granularity ~1 ms):');
  console.log('  applyAction       ' + stats(cpuAll.act));
  console.log('  planBot/Hollow    ' + stats(cpuAll.plan));
  console.log('  alarm handler     ' + stats(cpuAll.alarm) + '   (one bot step or plan per alarm; includes hash + broadcast)');
  console.log('  ws message        ' + stats(cpuAll.msg));
  const top = (a) => a.slice().sort((x, y) => y - x).slice(0, 10).join(' ');
  console.log('  slowest plans: ' + top(cpuAll.plan) + ' | acts: ' + top(cpuAll.act) + ' | over 8 ms: plans ' + cpuAll.plan.filter((x) => x > 8).length + ', acts ' + cpuAll.act.filter((x) => x > 8).length);
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);

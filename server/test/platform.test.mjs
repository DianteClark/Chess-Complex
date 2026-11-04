// 17.0 (S2): platform unit tests, no server needed: node test/platform.test.mjs
//   hooks.js fan-out with stub modules (missing exports, throwing, hanging, replay id), size cap
//   match record correctness: RoomCore in Node (fake io + simulated clock) plays Royale / Siege / Squads with humans
//   (some acting, some timing out, one dropping) and bots; replaying rec.actions through a fresh createMatch(rec.start)
//   must reproduce the server's final state hash
//   moderation (fake model, cache, budget, failure fallback, no AI), Llama Guard answer shapes, track(), location hints,
//   /turn (no secrets, fake TURN API, API down), /cfg, Turnstile helper (fake siteverify), rate limit helper
import http from 'node:http';
import * as E from '../../js/engine.js';
import { stateHash, protoVer } from '../../js/statehash.js';
import { RoomCore } from '../src/core.js';
import * as hooks from '../src/hooks.js';
import * as P from '../src/platform.js';
import { check, assert, results } from './lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseRec = () => ({ v: 1, mid: 'm1', mode: 'royale', start: { players: [], seed: 1, opts: {} }, actions: [['p1', { type: 'end' }]], humans: { p1: { name: 'A', cid: null, verified: false } }, result: { winner: 1, places: [] } });

// ---------------------------------------------------------------- hooks
await check('hooks: fan-out to every consumer, replay id returned, background work via ctx.waitUntil', async () => {
  const got = [], bg = [];
  const mods = {
    stats: { record: async (env, rec) => { got.push(['stats', rec.mid, env.X]); } },
    board: { rate: (env, rec) => { got.push(['board', rec.mid]); } },
    platform: { track: (env, rec) => { got.push(['track', rec.mid]); return 1; } },
    replay: { save: async (env, rec) => { got.push(['replay', rec.mid]); return 'rABC123'; } },
  };
  const id = await hooks.matchEnded({ X: 7 }, { waitUntil: (p) => bg.push(p) }, baseRec(), mods);
  await Promise.all(bg);
  assert(id === 'rABC123', 'id ' + id);
  assert(['stats', 'board', 'track', 'replay'].every((k) => got.some((g) => g[0] === k)), JSON.stringify(got));
  assert(got.find((g) => g[0] === 'stats')[2] === 7, 'env passed');
  assert(bg.length === 3, 'waitUntil count ' + bg.length);
});
await check('hooks: missing modules / exports, throwing and hanging consumers never break it', async () => {
  hooks.H.timeout = 300;
  const bg = [];
  const mods = { stats: {}, board: { rate: () => { throw new Error('boom'); } }, platform: { track: () => new Promise(() => {}) }, replay: { save: async () => { throw new Error('db down'); } } };
  const t0 = Date.now();
  const id = await hooks.matchEnded({}, { waitUntil: (p) => bg.push(p) }, baseRec(), mods);
  assert(id === null, 'id ' + id);
  await Promise.all(bg); // the hanging one is timed out, not left pending
  assert(Date.now() - t0 < 2000, 'took ' + (Date.now() - t0));
  assert(await hooks.matchEnded({}, null, baseRec(), {}) === null, 'no modules');
  assert(await hooks.matchEnded({}, null, baseRec(), { replay: { save: () => ({ id: 'rOBJ1' }) } }) === 'rOBJ1', '{id} answer');
  assert(await hooks.matchEnded({}, null, baseRec(), { replay: { save: () => '<script>' } }) === null, 'bad id refused');
  assert(await hooks.matchEnded({}, null, baseRec(), { replay: { save: () => new Promise(() => {}) } }) === null, 'hanging save');
  hooks.H.timeout = 8000;
});
await check('hooks: 200 KB cap drops the action list (flagged big)', async () => {
  const rec = baseRec(); rec.actions = Array.from({ length: 12000 }, (_, i) => ['p1234567890', { type: 'move', x: i % 20, y: i % 17 }]);
  let seen = null;
  await hooks.matchEnded({}, null, rec, { replay: { save: (env, r) => { seen = r; return 'rBIG01'; } } });
  assert(seen.big === true && seen.actions.length === 0 && JSON.stringify(seen).length <= hooks.REC_MAX, 'cap');
  let small = null; await hooks.matchEnded({}, null, baseRec(), { stats: { record: (e, r) => { small = r; } } });
  assert(small && !small.big && small.actions.length === 1, 'small rec untouched');
});

// ---------------------------------------------------------------- match record (RoomCore in Node)
function harness() {
  let clock = 1_800_000_000_000, armed = 0;
  const socks = [], recs = [], bgs = [];
  const io = {
    now: () => clock, sockets: () => socks.filter((x) => x.pid && !x.gone).map((x) => ({ ws: x, pid: x.pid })),
    send(ws, s) { ws.inbox.push(JSON.parse(s)); }, close(ws) { ws.gone = true; }, bind(ws, pid) { ws.pid = pid; },
    async save() {}, async wipe() {}, async arm(at) { armed = at; },
    bg: (p) => bgs.push(p), ended: async (rec) => { recs.hasState = !!(rec.state && rec.state.over && !Object.keys(rec).includes('state')); recs.push(JSON.parse(JSON.stringify(rec))); /* the wire/storage form */ return 'rTEST' + recs.length; },
    verify: async (cid, proof) => (proof === 'GOODSECRET000000' ? { ok: true, name: 'Cloud ' + cid.slice(0, 3), title: 'T', avatar: null } : { ok: false }),
  };
  const core = new RoomCore(null, io, { test: true });
  return { core, io, socks, recs, bgs, get clock() { return clock; }, set clock(v) { clock = v; }, get armed() { return armed; } };
}
async function hello(h, name, o = {}) {
  const ws = { inbox: [], name }; h.socks.push(ws);
  await h.core.onMessage(ws, null, { t: 'hello', pid: 'tok-' + name + '-0000001', name, ver: protoVer(), profile: { build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 } } }, ...o });
  return ws;
}
// humans: 'act' plans and sends real actions on its turn, 'idle' never acts (turn timeouts), 'drop' drops mid-match
async function playMatch(mode, roles) {
  const h = harness(), core = h.core;
  await core.init('NODE1');
  const ws = [];
  for (const [i, r] of roles.entries()) ws.push(await hello(h, 'H' + i + r, r === 'verified' ? { cid: '0123456789', cproof: 'GOODSECRET000000' } : r === 'liar' ? { cid: 'ABCDEFGHJK', cproof: 'WRONGSECRET00000' } : {}));
  await Promise.all(h.bgs.splice(0));
  const L = ws[0];
  core.T.fast = true; core.T.introMs = 0; core.T.turnMs = 3000; core.T.turnGrace = 0;
  if (mode === 'siege') { core.lead(L, L.pid, { op: 'group', group: 'coop' }); core.lead(L, L.pid, { op: 'mode', mode: 'siege' }); }
  else if (mode !== 'royale') core.lead(L, L.pid, { op: 'mode', mode });
  core.lead(L, L.pid, { op: 'fill-bots' });
  for (const w of ws.slice(1)) core.handle(w, w.pid, { t: 'ready', on: true });
  const e = core.start(); assert(!e, 'start: ' + e);
  await core.flush();
  let guard = 0, dropped = false;
  while (core.R.m && !core.R.m.s.over && guard++ < 40000) {
    const s = core.R.m.s, u = E.unitById(s, s.active);
    const i = ws.findIndex((w) => u && w.pid === u.pid && !u.bot);
    if (i >= 0 && roles[i] !== 'idle' && !(roles[i] === 'drop' && dropped)) {
      if (roles[i] === 'drop' && s.round >= 3 && !dropped) { dropped = true; ws[i].gone = true; await core.onClose(ws[i].pid); continue; }
      const c = structuredClone(s), plan = E.planBot(c, E.unitById(c, c.active));
      const a = plan.find((x) => E.applyAction(structuredClone(s), ws[i].pid, x).ok) || { type: 'end' };
      await core.onMessage(ws[i], ws[i].pid, { t: 'act', a, n: s.v });
      continue;
    }
    if (!h.armed) break;
    h.clock = Math.max(h.clock, h.armed);
    await core.onAlarm();
  }
  await Promise.all(h.bgs.splice(0));
  return { h, core, ws };
}
function replayRec(rec) {
  const s = E.createMatch(rec.start.players, rec.start.seed, rec.start.opts);
  for (const [i, [pid, a]] of rec.actions.entries()) { const r = E.applyAction(s, pid ?? undefined, a); /* null pid = a Hollow */ if (!r.ok) throw new Error(`action ${i} refused: ${pid} ${JSON.stringify(a)}`); }
  return s;
}
for (const [mode, roles] of [['royale', ['act', 'idle']], ['siege', ['act', 'verified', 'idle']], ['squads', ['verified', 'liar', 'drop', 'act']], ['duel', ['idle']]]) {
  await check(`record: ${mode} (${roles.join(', ')}) replays to the server's final hash`, async () => {
    const { h, core, ws } = await playMatch(mode, roles);
    const s = core.R.m.s; assert(s.over, 'match did not end (v' + s.v + ')');
    assert(h.recs.length === 1, 'recs ' + h.recs.length);
    assert(h.recs.hasState, 'rec.state (final state, non-enumerable) not passed to the hook');
    const rec = h.recs[0];
    assert(rec.seats && rec.seats[ws[0].pid] && !('state' in rec), 'seats alias / state stays out of JSON');
    assert(rec.v === 1 && rec.mid === core.R.m.mid && rec.mode === s.mode && rec.room === 'NODE1' && rec.ver === protoVer() && rec.t1 >= rec.t0, 'header');
    assert(rec.actions.length === s.v, `actions ${rec.actions.length} vs s.v ${s.v}`);
    const r = replayRec(rec);
    assert(stateHash(r) === stateHash(s) && rec.result.hash === stateHash(s), 'hash mismatch');
    assert(r.winner === s.winner && rec.result.winner === s.winner && rec.result.rounds === s.round, 'winner/rounds');
    // humans: every seat, verified only with a good proof, cid only when verified
    const hum = rec.humans, seats = ws.map((w) => w.pid);
    assert(Object.keys(hum).length === seats.length && seats.every((p) => hum[p]), 'humans ' + JSON.stringify(hum));
    for (const [i, r0] of roles.entries()) {
      const x = hum[ws[i].pid];
      if (r0 === 'verified') assert(x.verified && x.cid === '0123456789' && x.pub && x.pub.name, 'verified seat ' + JSON.stringify(x));
      else assert(!x.verified && x.cid === null, 'unverified seat ' + JSON.stringify(x));
      if (r0 === 'drop') assert(x.drops === 1, 'drops ' + x.drops);
    }
    assert(!JSON.stringify(rec).includes('SECRET'), 'proof leaked into the record');
    const tos = rec.actions.filter((x) => x[2] === 1).length, botActs = rec.actions.filter((x) => !seats.includes(x[0])).length;
    if (roles.includes('idle')) assert(tos > 0, 'no timeouts recorded');
    assert(botActs > 0 || mode === 'duel', 'no bot actions');
    const places = rec.result.places; assert(places.length === s.units.filter((u) => u.kind === 'player').length && places.every((p) => typeof p.bot === 'boolean'), 'places');
    // replay id handed to clients and kept in the lobby
    const msg = ws[0].inbox.find((m) => m.t === 'replay');
    assert(msg && msg.id === 'rTEST1' && msg.mid === rec.mid, 'replay msg ' + JSON.stringify(msg));
    const lob = ws[0].inbox.filter((m) => m.t === 'lobby').pop(); assert(lob.party.replay && lob.party.replay.id === 'rTEST1', 'lobby replay');
    assert(!JSON.stringify(ws[0].inbox.filter((m) => m.t === 'ident')).includes('SECRET'), 'proof echoed');
    return `${rec.actions.length} actions (${tos} timeouts, ${botActs} bot), ${JSON.stringify(rec).length} B`;
  });
}
await check('record: a second match gets its own record; hand edits (test kill) flag tampered', async () => {
  const { h, core, ws } = await playMatch('royale', ['idle']);
  core.handle(ws[0], ws[0].pid, { t: 'back' });
  const e = core.start(); assert(!e, e);
  await core.testOp(ws[0], { op: 'kill', pid: core.R.m.s.units.find((u) => u.kind === 'player' && u.pid !== ws[0].pid).pid });
  await Promise.all(h.bgs.splice(0));
  for (let i = 0; i < 40000 && !core.R.m.s.over && h.armed; i++) { h.clock = Math.max(h.clock, h.armed); await core.onAlarm(); }
  await Promise.all(h.bgs.splice(0));
  assert(h.recs.length === 2 && h.recs[1].mid !== h.recs[0].mid && h.recs[1].tampered === true && !h.recs[0].tampered, 'recs');
});

// ---------------------------------------------------------------- moderation
const store = () => { const m = new Map(); return { m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); } }; };
await check('moderation: fake model verdicts, cache per phrase hash, case/space-insensitive', async () => {
  const st = store(), env = { MOD_FAKE: '1' };
  const a = await P.moderate(env, 'good game all', st);
  const b = await P.moderate(env, 'you are unsafe trash', st);
  const c = await P.moderate(env, '  Good   GAME all ', st);
  const d = await P.moderate(env, 'YOU ARE UNSAFE TRASH', st);
  assert(a.ok && a.src === 'ai' && !b.ok && b.src === 'ai', JSON.stringify([a, b]));
  assert(c.ok && c.src === 'cache' && !d.ok && d.src === 'cache', JSON.stringify([c, d]));
  assert(st.m.get('budget').n === 2, 'budget counts model calls only: ' + JSON.stringify(st.m.get('budget')));
});
await check('moderation: daily budget guard, then word-filter fallback; resets next UTC day', async () => {
  const st = store(), env = { MOD_FAKE: '1', MOD_BUDGET: '2' }, t = Date.parse('2026-11-03T10:00:00Z');
  const r = []; for (const x of ['one nasty', 'two', 'three nasty', 'four']) r.push(await P.moderate(env, x, st, t));
  assert(r[0].src === 'ai' && !r[0].ok && r[1].src === 'ai' && r[2].src === 'filter' && r[2].ok && r[2].why === 'budget', JSON.stringify(r));
  const n = await P.moderate(env, 'three nasty', st, t + 864e5);
  assert(n.src === 'ai' && !n.ok, 'next day ' + JSON.stringify(n));
  assert(P.MOD.budget === 1500, 'default budget');
});
await check('moderation: model failure / no AI / timeout -> ok via filter, never throws, failures not cached', async () => {
  const st = store();
  const f = await P.moderate({ MOD_FAKE: '1' }, 'fakefail please', st);
  assert(f.ok && f.src === 'filter' && !Array.from(st.m.keys()).some((k) => k.startsWith('v:')), JSON.stringify(f));
  const n = await P.moderate({}, 'hello there', st); assert(n.ok && n.src === 'filter' && n.why === 'no-ai', JSON.stringify(n));
  const throws = await P.moderate({ AI: { run: async () => { throw new Error('remote only'); } } }, 'hi', store()); assert(throws.ok && throws.src === 'filter', JSON.stringify(throws));
  P.MOD.timeout = 100;
  const slow = await P.moderate({ AI: { run: () => new Promise(() => {}) } }, 'slow one', store()); assert(slow.ok && slow.why === 'timeout', JSON.stringify(slow));
  P.MOD.timeout = 2500;
  const nostore = await P.moderate({ MOD_FAKE: '1' }, 'nasty', null); assert(!nostore.ok && nostore.src === 'ai', 'works without a store');
  const real = await P.moderate({ AI: { run: async (model, inp) => { assert(model === P.MOD.model && inp.messages[0].content === 'gg wp', 'model input'); return { response: 'safe' }; } } }, 'gg wp', store());
  assert(real.ok && real.src === 'ai', JSON.stringify(real));
});
await check('moderation: Llama Guard answer shapes', async () => {
  const cases = [[{ response: { safe: true } }, true], [{ response: { safe: false, categories: ['S10'] } }, false], [{ response: 'safe' }, true], [{ response: '\n\nunsafe\nS1' }, false], [{ result: { response: 'unsafe' } }, false], ['safe', true], [{ response: 'maybe' }, null], [null, null]];
  for (const [inp, want] of cases) assert(P.parseGuard(inp) === want, JSON.stringify(inp) + ' -> ' + P.parseGuard(inp));
});
await check('moderation in the Room: unsafe custom phrase shadowed (sender only), safe one delivered, presets skip the model', async () => {
  const h = harness(); let calls = 0;
  h.io.moderate = async (x) => { calls++; return /nasty/.test(x) ? { ok: false, src: 'ai' } : { ok: true, src: 'ai' }; };
  await h.core.init('NODE2');
  const A = await hello(h, 'Ann'), B = await hello(h, 'Ben');
  h.core.T.introMs = 0; h.core.handle(B, B.pid, { t: 'ready', on: true }); h.core.start();
  await h.core.onMessage(A, A.pid, { t: 'chat', x: 'so nasty' });
  h.clock += 4000; await h.core.onMessage(A, A.pid, { t: 'chat', x: 'nice move' });
  h.clock += 4000; await h.core.onMessage(A, A.pid, { t: 'chat', k: 'k.gg' });
  const bx = B.inbox.filter((m) => m.t === 'chat'), ax = A.inbox.filter((m) => m.t === 'chat');
  assert(!bx.some((m) => m.x === 'so nasty') && ax.some((m) => m.x === 'so nasty'), 'shadow');
  assert(bx.some((m) => m.x === 'nice move') && bx.some((m) => m.k === 'k.gg'), 'delivered ' + JSON.stringify(bx));
  assert(calls === 2 && h.core.modStats.blocked === 1, 'calls ' + calls);
});

// ---------------------------------------------------------------- analytics, hints, cfg, turnstile, turn, limits
await check('track(): one Analytics Engine data point per human, guarded without a binding', async () => {
  const pts = []; const env = { AE: { writeDataPoint: (p) => pts.push(p) } };
  const rec = { mode: 'royale', location: 'forge', room: 'ABCDE', ver: 'x', t0: 0, t1: 61000, actions: [1, 2, 3], humans: { pA: { verified: true, cid: '0123456789', drops: 1 }, pB: { verified: false, cid: null } }, result: { winner: 3, rounds: 9, places: [{ pid: 'pA', id: 3, place: 1, bot: false }, { pid: 'pB', id: 4, place: 2, bot: false }, { pid: 'b1', id: 5, place: 3, bot: true }] } };
  assert(P.track(env, rec) === 2 && pts.length === 2, 'points ' + pts.length);
  assert(pts[0].indexes[0] === 'royale' && pts[0].blobs[2] === '0123456789' && pts[0].blobs[4] === 'win' && pts[0].doubles[0] === 1 && pts[0].doubles[3] === 61 && pts[0].doubles[5] === 1 && pts[0].doubles[6] === 1, JSON.stringify(pts[0]));
  assert(pts[1].blobs[2] === '' && pts[1].blobs[4] === 'loss', 'unverified has no cid');
  assert(P.track({}, rec) === 0 && P.track({ AE: { writeDataPoint: () => { throw new Error('x'); } } }, rec) === 0, 'guards');
});
await check('location hints from request.cf', async () => {
  const c = [[{ continent: 'NA', longitude: '-122.4' }, 'wnam'], [{ continent: 'NA', longitude: '-74' }, 'enam'], [{ continent: 'EU', longitude: '2.3' }, 'weur'], [{ continent: 'EU', longitude: '37.6' }, 'eeur'], [{ continent: 'AS', country: 'JP' }, 'apac'], [{ continent: 'AS', country: 'AE' }, 'me'], [{ continent: 'OC' }, 'oc'], [{ continent: 'SA' }, 'sam'], [{ continent: 'AF' }, 'afr'], [{ continent: 'AN' }, null], [undefined, null]];
  for (const [cf, want] of c) assert(P.locationHint(cf) === want, JSON.stringify(cf) + ' -> ' + P.locationHint(cf));
  const seen = []; const env = { ROOM: { get: (id, o) => { seen.push(o || null); return {}; } } };
  P.roomStub(env, 'id', { cf: { continent: 'EU', longitude: '1' } }); P.roomStub(env, 'id', {});
  assert(seen[0].locationHint === 'weur' && seen[1] === null, JSON.stringify(seen));
});
await check('/cfg: site key only with the secret; features', async () => {
  const none = P.cfg({}); assert(none.turnstileSiteKey === '' && none.features.turn === false && none.features.turnstile === false && none.features.moderation === false && none.ver, JSON.stringify(none));
  const half = P.cfg({ TURNSTILE_SITE_KEY: 'k' }); assert(half.turnstileSiteKey === '', 'site key without secret');
  const all = P.cfg({ TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET: 's', TURN_KEY_ID: 'a', TURN_KEY_API_TOKEN: 'b', AI: { run() {} }, AE: { writeDataPoint() {} } });
  assert(all.turnstileSiteKey === 'k' && all.features.turn && all.features.turnstile && all.features.moderation && all.features.analytics, JSON.stringify(all));
});

// a local fake for Cloudflare's TURN API and Turnstile siteverify
const fake = { turn: 0, turnFail: false, auth: null, body: null };
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.startsWith('/v1/turn/keys/KEYID/credentials/generate-ice-servers')) {
      fake.turn++; fake.auth = req.headers.authorization; fake.body = b;
      if (fake.turnFail) { res.writeHead(500); res.end('{}'); return; }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp'], username: 'u' + fake.turn, credential: 'c' }] }));
    } else if (req.url === '/siteverify') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: /token=?.*GOOD|GOOD/.test(b) }));
    } else { res.writeHead(404); res.end(); }
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${srv.address().port}`;
await check('/turn: public list without secrets; Cloudflare credentials with them (6 h TTL, reused 1 h); API down -> public', async () => {
  const pub = await P.iceServers({}); assert(pub.src === 'public' && pub.iceServers.some((s) => /openrelay/.test(JSON.stringify(s.urls))), JSON.stringify(pub));
  P._resetIce();
  const env = { TURN_KEY_ID: 'KEYID', TURN_KEY_API_TOKEN: 'TOKEN', TURN_API: FAKE };
  const a = await P.iceServers(env), b = await P.iceServers(env);
  assert(a.src === 'cf' && a.iceServers[0].username === 'u1' && b.iceServers[0].username === 'u1' && fake.turn === 1, JSON.stringify(a));
  assert(fake.auth === 'Bearer TOKEN' && JSON.parse(fake.body).ttl === 21600, 'auth/ttl');
  P._resetIce(); fake.turnFail = true;
  const c = await P.iceServers(env); assert(c.src === 'public' && /500/.test(c.err), JSON.stringify(c));
  P._resetIce();
  const d = await P.iceServers({ TURN_KEY_ID: 'KEYID', TURN_KEY_API_TOKEN: 'TOKEN', TURN_API: 'http://127.0.0.1:9' }); assert(d.src === 'public' && d.err, 'unreachable');
  P._resetIce(); fake.turnFail = false;
});
await check('verifyTurnstile: no secret = pass; honours TURNSTILE_VERIFY_URL; fails closed', async () => {
  assert(await P.verifyTurnstile({}, '') === true, 'no secret');
  const env = { TURNSTILE_SECRET: 'sec', TURNSTILE_VERIFY_URL: FAKE + '/siteverify' };
  assert(await P.verifyTurnstile(env, 'GOOD-token', '1.2.3.4') === true, 'good');
  assert(await P.verifyTurnstile(env, 'bad-token') === false, 'bad');
  assert(await P.verifyTurnstile(env, '') === false, 'empty');
  assert(await P.verifyTurnstile({ TURNSTILE_SECRET: 's', TURNSTILE_VERIFY_URL: 'http://127.0.0.1:9/x' }, 'GOOD') === false, 'unreachable = fail closed');
});
await check('limit(): RL_API keyed per IP or per cloud id; free paths; guarded without a binding', async () => {
  const keys = []; let allow = true;
  const env = { RL_API: { limit: async ({ key }) => { keys.push(key); return { success: allow }; } } };
  const req = (path, ip) => [new Request('http://x' + path, { headers: ip ? { 'CF-Connecting-IP': ip } : {} }), new URL('http://x' + path)];
  assert(await P.limit(...req('/cfg', '1.1.1.1').slice(0, 1), env, req('/cfg')[1]) === null, 'allowed');
  await P.limit(req('/player/0123456789', '1.1.1.1')[0], env, req('/player/0123456789')[1]);
  for (const p of ['/health', '/ws/room/ABCDE', '/player/new']) await P.limit(req(p)[0], env, req(p)[1]);
  assert(keys.join() === 'ip:1.1.1.1,id:0123456789', keys.join());
  allow = false; const r = await P.limit(req('/turn')[0], env, req('/turn')[1]);
  assert(r && r.status === 429 && r.headers.get('Retry-After') === '60', 'blocked');
  assert(await P.limit(req('/turn')[0], {}, req('/turn')[1]) === null, 'no binding');
  assert(await P.limit(req('/turn')[0], { RL_API: { limit: async () => { throw new Error('x'); } } }, req('/turn')[1]) === null, 'binding error = allow');
});
srv.close();
const bad = results.filter((r) => !r.ok); console.log(`${results.length - bad.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);

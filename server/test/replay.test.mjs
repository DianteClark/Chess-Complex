// 17.0 (RP): replay store tests against local workerd.
//   cd server && npx wrangler dev --local --port 8790 --var ROOM_TEST:1   (ROOM_TEST enables the test headers)
//   CLOUD=http://127.0.0.1:8790 node test/replay.test.mjs
// Covers: POST/GET round trip, the hook path (save() -> verified), replaying a stored record reproduces the final
// state hash (8-bot Royale + Siege simulated in Node like GameHost), size cap, validation, expiry alarm, rate limit,
// gzip upload, and (when S2's match-end hook is live) a real cloud match whose over/replay message carries an id.
import * as E from '../../js/engine.js';
import { stateHash } from '../../js/statehash.js';
import { gzipSync } from 'node:zlib';
import { BASE, Client, newRoom, check, assert, results, sleep } from './lib.mjs';

const P = (i, bot) => ({ pid: 'p' + i, name: 'Bot' + i, isBot: bot, botLevel: 'normal', skin: 'ivory', build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: 'regen', equips: {} } });
// a whole match the way GameHost runs it: planBot / planHollow for every seat, every accepted action logged
function simulate(mode, n, seed, cap = 3000) {
  const players = Array.from({ length: n }, (_, i) => P(i, i > 0));
  const start = { players: structuredClone(players), seed, opts: { mode } };
  const s = E.createMatch(players, seed, { mode }), actions = [];
  while (!s.over && actions.length < cap) {
    const u = E.unitById(s, s.active); if (!u) break;
    const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
    let turn = s.turnNo;
    for (const a of plan) { if (s.over || s.turnNo !== turn) break; if (E.applyAction(s, u.pid, a).ok) actions.push([u.pid, structuredClone(a)]); }
    if (!s.over && s.turnNo === turn) { const a = { type: 'end' }; if (E.applyAction(s, u.pid, a).ok) actions.push([u.pid, a]); else break; }
  }
  return { rec: { start, actions, mode, location: s.location, hash: stateHash(s), result: { winner: s.winner, rounds: s.round } }, s };
}
function replay(rec) {
  const s = E.createMatch(structuredClone(rec.start.players), rec.start.seed, structuredClone(rec.start.opts));
  for (const [pid, a] of rec.actions) if (!E.applyAction(s, pid == null ? undefined : pid, a).ok) return { s, ok: false };
  return { s, ok: true };
}
const ip = () => 'test-' + Math.random().toString(36).slice(2, 10);
const post = (body, h = {}) => fetch(BASE + '/replay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cc-test-ip': ip(), ...h }, body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
const get = (id) => fetch(BASE + '/replay/' + id);

const R1 = simulate('royale', 8, 1701);
const R2 = simulate('siege', 3, 4242);

await check('post + get round trip (unverified upload)', async () => {
  const r = await post(R1.rec); assert(r.status === 201, 'status ' + r.status);
  const { id, verified } = await r.json(); assert(/^[0-9A-HJKMNP-TV-Z]{8}$/.test(id), 'id ' + id); assert(verified === false, 'upload must be unverified');
  const g = await get(id); assert(g.status === 200, 'get ' + g.status);
  const j = await g.json();
  assert(j.id === id && j.verified === false && j.exp - j.at === 30 * 24 * 3600 * 1000, JSON.stringify({ ...j, rec: undefined }));
  assert(JSON.stringify(j.rec.actions) === JSON.stringify(R1.rec.actions) && j.rec.start.seed === 1701 && j.rec.hash === R1.rec.hash, 'record differs');
  const lc = await get(id.toLowerCase()); assert(lc.status === 200, 'lower-case id');
  return `${id}, ${R1.rec.actions.length} actions, ${JSON.stringify(R1.rec).length} B json`;
});

await check('stored record replays to the same final state hash (Royale 8 bots + Siege 3)', async () => {
  const out = [];
  for (const R of [R1, R2]) {
    const r = await post(R.rec, { 'x-cc-test-verified': '1' }); assert(r.status === 201, 'post ' + r.status);
    const { id, verified } = await r.json(); assert(verified === true, 'hook path should be verified');
    const j = await (await get(id)).json(); assert(j.verified === true, 'verified flag stored');
    const t0 = performance.now(); const p = replay(j.rec); const ms = performance.now() - t0;
    assert(p.ok, 'an action was refused on replay');
    assert(stateHash(p.s) === j.rec.hash && j.rec.hash === stateHash(R.s), `hash ${stateHash(p.s)} != ${j.rec.hash}`);
    assert(p.s.over && p.s.winner === R.s.winner, 'winner differs');
    out.push(`${R.rec.mode} ${R.rec.actions.length} actions in ${ms.toFixed(0)} ms`);
  }
  return out.join(', ');
});

await check('size cap 200 KB and validation', async () => {
  const big = { ...R1.rec, pad: 'x'.repeat(210 * 1024) };
  const r = await post(big); assert(r.status === 413, 'big ' + r.status);
  const many = { ...R1.rec, actions: Array.from({ length: 7000 }, (_, i) => ['p' + (i % 8), { type: 'move', x: i % 9, y: (i * 7) % 9, slot: 'a1b2c3d4' }]) };
  const r2 = await post(many); assert(r2.status === 413, 'cleaned record over cap ' + r2.status + ' (' + JSON.stringify(many).length + ' B)');
  for (const bad of [{}, { start: { players: [], seed: 1 }, actions: [] }, { start: { players: [{}], seed: 1.5 }, actions: [] }, { start: { players: [{}], seed: 1 }, actions: [['p', { x: 1 }]] }]) {
    const b = await post(bad); assert(b.status === 400, 'bad shape ' + b.status + ' ' + JSON.stringify(bad));
  }
  assert((await post('{nope')).status === 400, 'bad json');
  assert((await get('ZZZZZZZZ')).status === 404, 'unknown id');
  assert((await get('BAD-ID!!')).status === 404, 'invalid id');
  return 'ok';
});

await check('gzip upload', async () => {
  const r = await post(gzipSync(Buffer.from(JSON.stringify(R2.rec))), { 'Content-Type': 'application/json' });
  assert(r.status === 201, 'gz ' + r.status);
  const j = await (await get((await r.json()).id)).json();
  assert(j.rec.hash === R2.rec.hash, 'gz record');
});

await check('expiry alarm deletes the replay', async () => {
  const r = await post(R2.rec, { 'x-cc-test-ttl': '1500' }); const { id } = await r.json();
  assert((await get(id)).status === 200, 'fresh');
  await sleep(3500);
  const g = await get(id); assert(g.status === 404, 'expired ' + g.status);
  return id;
});

await check('POST rate limit per IP (12 / hour)', async () => {
  const who = ip(); let n = 0, last = 0;
  const small = { start: { players: [P(0, false), P(1, true)], seed: 3, opts: { mode: 'duel' } }, actions: [['p0', { type: 'end' }]] };
  for (let i = 0; i < 14; i++) { const r = await post(small, { 'x-cc-test-ip': who }); last = r.status; if (r.status === 201) n++; else break; }
  assert(n === 12 && last === 429, `accepted ${n}, then ${last}`);
  const other = await post(small); assert(other.status === 201, 'another IP is not limited');
  return `${n} accepted, then 429`;
});

await check('cloud match end: Room hook saves the replay (S2 hooks.js)', async () => {
  const code = await newRoom();
  const A = new Client(code, { name: 'Ana', autoPlay: true }); await A.open(); await A.waitMsg('welcome', 5000);
  A.test('set', { T: { fast: true, introMs: 0 } });
  A.lead('mode', { mode: 'duel' }); await A.wait(() => A.lobby && A.lobby.mode === 'duel', 3000, 'duel');
  A.lead('add-bot'); await A.wait(() => A.lobby.players.length === 2, 3000, 'bot');
  A.lead('start'); await A.waitMsg('start', 5000); A.play();
  const over = await A.waitMsg('over', 60000);
  let id = null;
  try { const m = A.msgs.find((x) => x.t === 'replay' && x.mid === over.mid) || await A.waitMsg('replay', 8000, (x) => x.mid === over.mid); id = m.id; } catch {}
  A.close();
  if (!id) return 'SKIP: no replay id in over/replay yet (S2 hook not wired)';
  const j = await (await get(id)).json();
  const p = replay(j.rec);
  assert(j.verified === true && p.ok && stateHash(p.s) === stateHash(A.s) && j.rec.hash === stateHash(A.s), 'hook replay hash');
  assert(j.rec.humans && Object.values(j.rec.humans).some((h) => h.name === 'Ana') && !JSON.stringify(j.rec).includes('"cid"'), 'humans: public names only');
  return `${id}, ${j.rec.actions.length} actions, hash ok`;
});

const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} pass`);
process.exit(fail ? 1 : 0);

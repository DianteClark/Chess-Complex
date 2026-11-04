// 17.0 (S2): platform tests against real local workerd. Spawns two `wrangler dev` instances itself:
//   plain  :8788  --var ROOM_TEST:1                         (no AI, no secrets: every fallback path)
//   faked  :8795  --var ROOM_TEST:1 MOD_FAKE:1 + fake TURN / Turnstile secrets pointing at a local fake API
// Usage: cd server && node test/platform.e2e.mjs        (PLAIN=<url> to reuse an already running plain instance)
// Checks: /cfg, /turn (with and without secrets), moderation fallback + model verdict + shared cache, identity
// (cid/cproof against the Player DO), the match record through the real Room (replays to the final hash) and the
// replay id handed to clients, Turnstile on /player/new, RL_API rate limiting (last: it leaves the IP limited for 60 s).
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../../js/engine.js';
import { stateHash, protoVer } from '../../js/statehash.js';
import { PEER_OPTS } from '../../js/net.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAIN = (process.env.PLAIN || 'http://127.0.0.1:8788').replace(/\/$/, ''), FAKED = 'http://127.0.0.1:8795';
process.env.CLOUD = PLAIN;
const { Client, check, assert, results } = await import('./lib.mjs');

// fake Cloudflare TURN API + Turnstile siteverify
const fake = { turn: 0, verify: 0 };
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.includes('/v1/turn/keys/KEYID/credentials/generate-ice-servers') && req.headers.authorization === 'Bearer TOKEN') {
      fake.turn++; res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'user' + fake.turn, credential: 'cred' }] }));
    } else if (req.url === '/siteverify') { fake.verify++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: b.includes('GOOD') })); }
    else { res.writeHead(404); res.end('{}'); }
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${srv.address().port}`;

const procs = [];
async function up(base, vars) {
  try { if ((await fetch(base + '/health')).ok) return false; } catch {}
  const port = new URL(base).port, persist = mkdtempSync(join(tmpdir(), 's2e-'));
  const args = ['wrangler', 'dev', '--local', '--port', port, '--ip', '127.0.0.1', '--persist-to', persist];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
  const p = spawn('npx', args, { cwd: root, stdio: 'ignore', detached: true, env }); procs.push(p);
  for (let i = 0; i < 180; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) return true; } catch {} }
  throw new Error('wrangler dev did not start on ' + port);
}
const down = () => { for (const p of procs) try { process.kill(-p.pid, 'SIGKILL'); } catch {} };
process.on('exit', down);
await Promise.all([
  up(PLAIN, { ROOM_TEST: 1 }),
  up(FAKED, { ROOM_TEST: 1, MOD_FAKE: 1, TURN_KEY_ID: 'KEYID', TURN_KEY_API_TOKEN: 'TOKEN', TURN_API: FAKE, TURNSTILE_SITE_KEY: 'site-key-1', TURNSTILE_SECRET: 'sec', TURNSTILE_VERIFY_URL: FAKE + '/siteverify' }),
]);

const getJ = async (u, o) => { const r = await fetch(u, o); return { r, j: await r.json().catch(() => null) }; };
async function roomAt(base, names, T = { introMs: 0 }) {
  const code = (await (await fetch(base + '/room', { method: 'POST' })).json()).code;
  const ws = base.replace(/^http/, 'ws');
  const cs = [];
  for (const n of names) {
    const c = new Client(code, { name: n.name || n }); c.ws0 = ws;
    await open(c, ws, n.extra || {}); await c.waitMsg('welcome', 6000); cs.push(c);
  }
  cs[0].test('set', { T }); await sleep(80);
  return { code, cs };
}
// lib.mjs's Client opens against PLAIN; this opens against any base
function open(c, wsBase, extra) {
  return new Promise((res, rej) => {
    const ws = c.ws = new WebSocket(`${wsBase}/ws/room/${c.code}`);
    ws.onopen = () => { c.send({ t: 'hello', pid: c.tok, name: c.name, profile: c.profile, ver: c.ver, ...extra }); res(c); };
    ws.onerror = () => rej(new Error('ws error')); ws.onclose = (e) => { c.closed = true; c.closeCode = e.code; c.kick(); };
    ws.onmessage = (e) => c.onMsg(e.data);
  });
}
async function startAll(cs) {
  for (const c of cs.slice(1)) c.send({ t: 'ready', on: true });
  await sleep(150);
  const n0 = cs.map((c) => c.count('start')); cs[0].lead('start');
  for (const [i, c] of cs.entries()) await c.wait(() => c.count('start') > n0[i], 6000, 'start');
}

// ---------------------------------------------------------------- /cfg + /turn
await check('/cfg without secrets: no site key, features off, same ver as /health, CORS for the Pages origin', async () => {
  const { r, j } = await getJ(PLAIN + '/cfg', { headers: { Origin: 'https://dianteclark.github.io' } });
  const h = (await getJ(PLAIN + '/health')).j;
  assert(r.status === 200 && j.turnstileSiteKey === '' && j.features.turn === false && j.features.turnstile === false && j.ver === h.ver && j.ver === protoVer(), JSON.stringify(j));
  assert(r.headers.get('access-control-allow-origin') === 'https://dianteclark.github.io', 'cors');
  return 'features ' + JSON.stringify(j.features);
});
await check('/cfg with secrets: site key + features on', async () => {
  const { j } = await getJ(FAKED + '/cfg');
  assert(j.turnstileSiteKey === 'site-key-1' && j.features.turn && j.features.turnstile && j.features.moderation, JSON.stringify(j));
});
await check('/turn without secrets = the public PEER_OPTS list', async () => {
  const { r, j } = await getJ(PLAIN + '/turn');
  assert(r.status === 200 && j.src === 'public' && JSON.stringify(j.iceServers) === JSON.stringify(PEER_OPTS.config.iceServers), JSON.stringify(j));
});
await check('/turn with (fake) secrets = Cloudflare credentials, reused across requests', async () => {
  const a = (await getJ(FAKED + '/turn')).j, b = (await getJ(FAKED + '/turn')).j;
  assert(a.src === 'cf' && a.iceServers[0].username === 'user1' && b.iceServers[0].username === 'user1' && fake.turn === 1, JSON.stringify(a) + ' calls ' + fake.turn);
  assert(a.iceServers.some((s) => JSON.stringify(s.urls).includes('stun:stun.l.google.com')), 'public STUN kept');
  return `ttl ${a.ttl} s`;
});

// ---------------------------------------------------------------- moderation
const chatX = (c) => c.msgs.filter((m) => m.t === 'chat' && m.x).map((m) => m.x);
await check('moderation without AI (local): custom phrase delivered word-filtered (fallback)', async () => {
  const { cs: [A, B] } = await roomAt(PLAIN, ['Ann', 'Ben']);
  A.lead('add-bot'); await sleep(100); await startAll([A, B]);
  A.send({ t: 'chat', x: 'so nasty move' });
  await B.wait(() => chatX(B).includes('so nasty move'), 5000, 'delivered');
  const m = (await A.testGet('mod')).mod;
  assert(m && m.n === 1 && m.src.filter === 1 && m.blocked === 0, JSON.stringify(m));
  A.close(); B.close();
  return 'why ' + (m.last && m.last.why);
});
await check('moderation with the (fake) model: unsafe shadowed to the sender, safe delivered; verdict cached across rooms', async () => {
  const r1 = await roomAt(FAKED, ['Ann', 'Ben']); const [A, B] = r1.cs;
  A.lead('add-bot'); await sleep(100); await startAll([A, B]);
  A.send({ t: 'chat', x: 'you are nasty' });
  await A.wait(() => chatX(A).includes('you are nasty'), 5000, 'sender sees own line');
  await sleep(3200); A.send({ t: 'chat', x: 'well played' });
  await B.wait(() => chatX(B).includes('well played'), 5000, 'safe delivered');
  assert(!chatX(B).includes('you are nasty'), 'unsafe reached the other player');
  const m1 = (await A.testGet('mod')).mod; assert(m1.src.ai === 2 && m1.blocked === 1, JSON.stringify(m1));
  const r2 = await roomAt(FAKED, ['Cat', 'Dan']); const [C, D] = r2.cs;
  C.lead('add-bot'); await sleep(100); await startAll([C, D]);
  C.send({ t: 'chat', x: 'YOU ARE NASTY' });
  await C.wait(() => chatX(C).includes('YOU ARE NASTY'), 5000, 'sender');
  await sleep(3200); C.send({ t: 'chat', x: 'you  are nasty!' });
  await sleep(1200);
  assert(!chatX(D).some((x) => /nasty/i.test(x)), 'cached unsafe delivered');
  const m2 = (await C.testGet('mod')).mod; assert(m2.src.cache === 1 && m2.blocked >= 1, 'second room hits the shared cache: ' + JSON.stringify(m2));
  for (const c of [A, B, C, D]) c.close();
  return JSON.stringify(m2.src);
});

// ---------------------------------------------------------------- identity
await check('identity: hello cid/cproof verified against the Player DO; wrong proof not verified; proof never echoed', async () => {
  const { j: pl } = await getJ(PLAIN + '/player/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert(pl && pl.id && pl.secret, 'player/new ' + JSON.stringify(pl));
  const { cs: [A, B, C] } = await roomAt(PLAIN, [{ name: 'Ann', extra: { cid: pl.id, cproof: pl.secret } }, { name: 'Ben', extra: { cid: pl.id, cproof: 'ZZZZZZZZZZZZZZZZ' } }, 'Cy']);
  await A.wait(() => A.msgs.some((m) => m.t === 'ident'), 5000, 'ident A');
  await B.wait(() => B.msgs.some((m) => m.t === 'ident'), 5000, 'ident B');
  const ia = A.last('ident'), ib = B.last('ident');
  assert(ia.verified === true && ia.cid === pl.id && ib.verified === false && ib.cid === null, JSON.stringify([ia, ib]));
  const seats = (await A.testGet('ident')).seats;
  const sa = seats.find((s) => s.pid === A.myPid), sc = seats.find((s) => s.pid === C.myPid);
  assert(sa.verified && sa.cid === pl.id && !sc.verified && !sc.cid, JSON.stringify(seats));
  for (const c of [A, B, C]) assert(!JSON.stringify(c.msgs).includes(pl.secret), 'secret echoed to ' + c.name);
  for (const c of [A, B, C]) c.close();
});

// ---------------------------------------------------------------- record + hook
await check('record through the real Room: replays to the final hash; replay id reaches clients (when replay.save works)', async () => {
  const { j: pl } = await getJ(PLAIN + '/player/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const code = (await (await fetch(PLAIN + '/room', { method: 'POST' })).json()).code;
  const A = new Client(code, { name: 'Ann', autoPlay: true }); await open(A, PLAIN.replace(/^http/, 'ws'), { cid: pl.id, cproof: pl.secret }); await A.waitMsg('welcome');
  const B = new Client(code, { name: 'Ben' }); await open(B, PLAIN.replace(/^http/, 'ws'), {}); await B.waitMsg('welcome'); // Ben never acts: turn timeouts
  await A.wait(() => A.msgs.some((m) => m.t === 'ident'), 5000, 'ident');
  A.test('set', { T: { introMs: 0, fast: true, turnMs: 400, turnGrace: 0 } }); await sleep(100);
  A.lead('mode', { mode: 'royale' }); A.lead('add-bot'); A.lead('add-bot'); await sleep(150);
  await startAll([A, B]);
  await A.waitMsg('over', 240000).catch((e) => { throw new Error(e.message + ' at v' + (A.s && A.s.v) + ' round ' + (A.s && A.s.round) + ' last ' + A.msgs.slice(-4).map((m) => m.t + (m.why ? ':' + m.why : '')).join(',')); });
  const got = await A.testGet('rec'); const rec = got.rec;
  assert(rec && rec.mid === A.start.mid && rec.actions.length === A.s.v, `rec actions ${rec && rec.actions.length} vs v ${A.s.v}`);
  const s = E.createMatch(rec.start.players, rec.start.seed, rec.start.opts);
  for (const [pid, a] of rec.actions) assert(E.applyAction(s, pid ?? undefined, a).ok, 'replayed action refused'); // null pid = a Hollow
  assert(stateHash(s) === rec.result.hash && stateHash(s) === stateHash(A.s), 'hash');
  assert(rec.humans[A.myPid].verified && rec.humans[A.myPid].cid === pl.id && !rec.humans[B.myPid].verified, 'humans ' + JSON.stringify(rec.humans));
  const tos = rec.actions.filter((x) => x[2] === 1 && x[0] === B.myPid).length; assert(tos > 0, 'timeouts not recorded');
  // RP's replay.save (if it works here) answers an id: {t:'replay'} + lobby.party.replay
  const rp = A.msgs.find((m) => m.t === 'replay' && m.mid === rec.mid) || await A.waitMsg('replay', 6000).catch(() => null);
  let note = `${rec.actions.length} actions, ${tos} timeouts`;
  if (rp) {
    assert(rp.mid === rec.mid && B.msgs.some((m) => m.t === 'replay' && m.id === rp.id), 'replay to all');
    await A.wait(() => A.lobby.party.replay && A.lobby.party.replay.id === rp.id, 3000, 'lobby.party.replay');
    const g = await getJ(PLAIN + '/replay/' + rp.id);
    note += `, replay ${rp.id} (GET ${g.r.status})`;
  } else note += ', no replay id (replay.save returned null)';
  A.close(); B.close();
  return note;
});

// ---------------------------------------------------------------- Turnstile + rate limits
await check('Turnstile on /player/new (P): 403 without a token, 201 with a passing one (helper + TURNSTILE_VERIFY_URL)', async () => {
  const no = await fetch(FAKED + '/player/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const bad = await fetch(FAKED + '/player/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstile: 'nope' }) });
  const ok = await fetch(FAKED + '/player/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstile: 'GOOD-1' }) });
  assert(no.status === 403 && bad.status === 403 && ok.status === 201, `${no.status} ${bad.status} ${ok.status}`);
  const plain = await fetch(PLAIN + '/player/new', { method: 'POST' }); assert(plain.status === 201, 'no secret: no check ' + plain.status);
});
await check('RL_API: 429 after 240 API requests a minute from one IP; /health stays free', async () => {
  let first429 = 0;
  for (let i = 1; i <= 300 && !first429; i += 20) {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, k) => fetch(FAKED + '/cfg').then((r) => r.status)));
    const k = rs.indexOf(429); if (k >= 0) first429 = i + k;
  }
  assert(first429 > 200 && first429 <= 260, 'first 429 at ' + first429);
  const r = await fetch(FAKED + '/turn'); assert(r.status === 429 && r.headers.get('retry-after') === '60', 'limited ' + r.status);
  assert((await fetch(FAKED + '/health')).status === 200, 'health limited');
  return 'first 429 at request ' + first429;
});

srv.close(); down();
const bad = results.filter((r) => !r.ok); console.log(`${results.length - bad.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);

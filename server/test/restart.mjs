// 17.0 (S1): hibernation/eviction safety. Spawns its own `wrangler dev` (port 8798, persisted to a temp dir), starts a
// match, kills the runtime during a human's turn (the room is not in memory any more, like an evicted object), restarts
// it, and checks that (1) the stored alarm still fires the turn timeout, (2) the player resumes with start{resume} +
// snap and the hashes keep matching, (3) the party survives. Usage: node test/restart.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateHash } from '../../js/statehash.js';
import * as E from '../../js/engine.js';

const PORT = 8798; process.env.CLOUD = `http://127.0.0.1:${PORT}`;
const { Client, newRoom, sleep, check, assert, results } = await import('./lib.mjs');
const root = join(dirname(fileURLToPath(import.meta.url)), '..'), persist = mkdtempSync(join(tmpdir(), 's1r-'));
let proc = null;
async function up() {
  proc = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--var', 'ROOM_TEST:1', '--persist-to', persist], { cwd: root, stdio: 'ignore', detached: true });
  for (let i = 0; i < 120; i++) { await sleep(500); try { if ((await fetch(process.env.CLOUD + '/health')).ok) return; } catch {} }
  throw new Error('wrangler dev did not start');
}
async function down() { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} await sleep(1500); }

await up();
await check('room survives a runtime restart mid-match (stored state + stored alarm)', async () => {
  const code = await newRoom();
  const A = new Client(code, { name: 'Alice' }); await A.open(); await A.waitMsg('welcome');
  A.test('set', { T: { introMs: 0, turnMs: 6000, turnGrace: 0 } });
  A.lead('add-bot'); await A.wait(() => A.lobby && A.lobby.players.length === 2, 3000, 'bot');
  A.lead('start'); await A.waitMsg('start', 4000);
  // wait for my turn (clock running), then pull the plug
  await A.wait(() => A.s && E.unitById(A.s, A.s.active) && E.unitById(A.s, A.s.active).pid === A.myPid && A.msgs.some((m) => m.dl > 0), 15000, 'my turn');
  const v0 = A.s.v, h0 = stateHash(A.s), killedAt = Date.now();
  await down(); await up();
  const A2 = new Client(code, { tok: A.tok, name: 'Alice' }); await A2.open({ resume: { mid: A.start.mid } });
  const st = await A2.waitMsg('start', 6000); assert(st.resume && st.mid === A.start.mid, 'resume start');
  const sn = await A2.waitMsg('snap', 6000); assert(sn.v >= v0, 'snap v');
  if (sn.v === v0) assert(stateHash(A2.s) === h0, 'stored state differs from the pre-restart state');
  // the stored turn clock fires (timeout) without anyone acting, or fired already while the runtime was down
  const to = A2.msgs.find((m) => m.t === 'a' && m.to === 1) || await A2.waitMsg('a', 12000, (m) => m.to === 1);
  assert(to.pid === A2.myPid, 'timeout for me');
  await A2.wait(() => A2.count('h') > 0 || A2.s.v >= v0 + 8, 20000, 'a hash after restart').catch(() => {});
  assert(A2.hashBad === 0 && A2.gaps === 0, `hash bad ${A2.hashBad} gaps ${A2.gaps}`);
  assert(A2.lobby && A2.lobby.players.length === 2 && A2.lobby.leader === A2.myPid, 'party kept');
  A2.close();
  return `snap at v${sn.v} (was v${v0}), timeout ${to._at - killedAt} ms after the kill`;
});
await down();
const bad = results.filter((r) => !r.ok); console.log(`${results.length - bad.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);

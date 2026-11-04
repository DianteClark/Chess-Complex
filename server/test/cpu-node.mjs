// 17.0 (S1): CPU time per Room handler, measured with process.cpuUsage (thread CPU, not wall clock, so a loaded box
// does not inflate it). Drives RoomCore (the DO's logic) in Node with a fake io and a simulated clock; same V8 engine
// as workerd. Usage: node test/cpu-node.mjs [matches=6] [mode=royale]
import { RoomCore } from '../src/core.js';
import { protoVer } from '../../js/statehash.js';

const N = +(process.argv[2] || 6), MODE = process.argv[3] || 'royale';
let clock = 1_800_000_000_000, armed = 0;
const socks = [];
const io = {
  now: () => clock, sockets: () => socks.filter((x) => x.pid && !x.gone).map((x) => ({ ws: x, pid: x.pid })),
  send(ws, s) { ws.out++; ws.bytes += s.length; }, close(ws) { ws.gone = true; }, bind(ws, pid) { ws.pid = pid; },
  async save() {}, async wipe() {}, async arm(at) { armed = at; },
};
const core = new RoomCore(null, io, { test: true });
await core.init('TEST1');
const ws = { out: 0, bytes: 0 }; socks.push(ws);
await core.onMessage(ws, null, { t: 'hello', pid: 'tok-cpu-test-0001', name: 'Spec', ver: protoVer(), profile: {} });
if (MODE !== 'royale') core.lead(ws, ws.pid, { op: 'group', group: MODE === 'siege' ? 'coop' : 'competitive' }), core.lead(ws, ws.pid, { op: 'mode', mode: MODE });
core.lead(ws, ws.pid, { op: 'fill-bots' });
core.T.introMs = 0;
const us = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };
const withPlan = [], stepOnly = [], all = [];
let actions = 0;
for (let k = 0; k < N; k++) {
  core.lead(ws, ws.pid, { op: 'start' });
  core.handle(ws, ws.pid, { t: 'leave' }); // all seats bots
  await core.flush();
  let guard = 0;
  while (core.R.m && !core.R.m.s.over && armed && guard++ < 20000) {
    clock = Math.max(clock, armed);
    const p0 = core.cpu.plan.length, t0 = us();
    await core.onAlarm();
    const dt = us() - t0;
    all.push(dt); (core.cpu.plan.length > p0 ? withPlan : stepOnly).push(dt);
  }
  actions += core.R.m.s.v;
  core.handle(ws, ws.pid, { t: 'back' });
}
const st = (a) => { const b = a.slice().sort((x, y) => x - y); const q = (p) => b[Math.min(b.length - 1, Math.floor(b.length * p))]; return `n=${b.length} p50=${q(0.5).toFixed(2)} p95=${q(0.95).toFixed(2)} p99=${q(0.99).toFixed(2)} max=${b[b.length - 1].toFixed(2)} ms`; };
console.log(`${MODE}, ${N} all-bot matches, ${actions} actions, ${ws.out} messages (${(ws.bytes / Math.max(1, ws.out)).toFixed(0)} B avg) to one client`);
console.log('  alarm with planBot   ' + st(withPlan));
console.log('  alarm, step only     ' + st(stepOnly));
console.log('  every alarm          ' + st(all));
console.log(`  over 8 ms: ${all.filter((x) => x > 8).length} of ${all.length} alarms`);

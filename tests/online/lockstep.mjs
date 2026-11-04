// 17.0 (N2): lockstep replay check, no server needed. A "server" engine runs full bot matches (planBot/planHollow,
// timeouts as {type:'end'}) and records every accepted action as the wire message {t:'a', v, pid, a}; a "client"
// engine built from the same createMatch(players, seed, opts) replays the JSON round-tripped stream with applyAction
// and compares stateHash every 8 actions (and at the end). Also checks a mid-match snap (JSON state) keeps in step,
// and that bot flags (seat changes) never change the hash.
// Usage: node tests/online/lockstep.mjs [--actions 300]
import { createMatch, applyAction, planBot, planHollow, unitById } from '../../js/engine.js';
import { stateHash } from '../../js/statehash.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MAX = +arg('--actions', 300);
const P = (i, n) => ({ pid: 'p' + i, name: 'P' + i, isBot: i >= n, skin: 'ivory', build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: ['regen', 'thorns', 'bastion', 'scavenger'][i % 4], equips: {} } });
const cases = [
  ['royale', 8, 1, {}], ['royale', 8, 2, { location: 'forge' }], ['siege', 4, 2, {}], ['squads', 7, 3, {}],
  ['blitz', 6, 1, {}], ['hill', 6, 1, {}], ['royale', 8, 1, { custom: { location: 'spire', mirror: true, hazards: true, events: true, storm: 'fast' } }],
  ['gauntlet', 3, 1, {}], ['duel', 2, 1, {}],
];
let fails = 0;
for (const [mode, n, humans, extra] of cases) {
  const players = Array.from({ length: n }, (_, i) => P(i, humans));
  const seed = 1000 + n * 7 + humans;
  const opts = { mode, ...extra };
  const S = createMatch(structuredClone(players), seed, structuredClone(opts));
  const wire = JSON.parse(JSON.stringify({ players, seed, opts }));
  let C = createMatch(wire.players, wire.seed, wire.opts);
  const t0 = performance.now(); let planMs = 0, applyMs = 0, maxStep = 0;
  const log = [], bad = [];
  let k = 0;
  if (stateHash(S) !== stateHash(C)) bad.push('initial hash differs');
  while (!S.over && k < MAX) {
    const u = unitById(S, S.active); if (!u) break;
    const t1 = performance.now();
    // humans: a scripted "player" that sometimes times out; bots/hollows: the real planners
    const plan = u.kind === 'hollow' ? planHollow(S, u) : u.pid && players.find((p) => p.pid === u.pid && !p.isBot) && k % 5 === 0 ? [] : planBot(S, u);
    planMs += performance.now() - t1;
    const turn = S.turnNo;
    for (const a of [...plan, { type: 'end' }]) {
      if (S.over || S.active !== u.id || S.turnNo !== turn) break;
      const t2 = performance.now();
      const r = applyAction(S, u.pid, a);
      const dt = performance.now() - t2; applyMs += dt; maxStep = Math.max(maxStep, dt);
      if (!r.ok) continue;
      k++;
      log.push(JSON.stringify({ t: 'a', v: S.v, pid: u.pid, a }));
      if (k === 40) { u.bot = !u.bot; } // a seat change mid-match is not part of the hash
      if (S.v % 8 === 0) log.push(JSON.stringify({ t: 'h', v: S.v, x: stateHash(S) }));
      if (k === 120) log.push(JSON.stringify({ t: 'snap', v: S.v, state: S }));
    }
  }
  log.push(JSON.stringify({ t: 'h', v: S.v, x: stateHash(S) }));
  // client replay
  let applied = 0, hashes = 0;
  for (const line of log) {
    const m = JSON.parse(line);
    if (m.t === 'a') {
      if (m.v !== C.v + 1) { bad.push(`gap ${C.v} -> ${m.v}`); break; }
      const r = applyAction(C, m.pid, m.a);
      if (!r.ok || C.v !== m.v) { bad.push(`replay refused v${m.v} ${JSON.stringify(m.a)}`); break; }
      applied++;
    } else if (m.t === 'h') { hashes++; if (C.v === m.v && stateHash(C) !== m.x) { bad.push(`hash mismatch at v${m.v}`); break; } }
    else if (m.t === 'snap') { if (stateHash(m.state) !== stateHash(C)) bad.push(`snap differs at v${m.v}`); C = m.state; }
  }
  const ok = !bad.length && C.v === S.v && stateHash(C) === stateHash(S);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${mode.padEnd(8)} ${n}p ${JSON.stringify(extra)} actions ${applied} hashes ${hashes} v${S.v} over ${S.over} | server plan ${planMs.toFixed(0)} ms apply ${applyMs.toFixed(0)} ms (max step ${maxStep.toFixed(1)} ms) total ${(performance.now() - t0).toFixed(0)} ms${bad.length ? ' | ' + bad.join('; ') : ''}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);

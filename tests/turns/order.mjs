// 15.2: round-based initiative. Every living unit acts at most once per round, and within a round units act in
// descending SPD (with tempo nudges) order. node tests/turns/order.mjs [games]
// 16.0: tiers (Seize first, Hourglass last, Held after everyone), a held turn resumes once, Reversal flips SPD.
import { createMatch, applyAction, planBot, planHollow, unitById, effSpd, initiative, turnTier, canHold, predictOrder, turnQueue, nextTurn, HOLD } from '../../js/engine.js';
import { roster } from '../../tools/run.mjs';
const N = +process.argv[2] || 60; let fails = 0, rounds = 0, inv = 0, turns = 0, holds = 0, excused = 0, lastEv = [];
const modes = ['royale', 'duel', 'squads', 'siege', 'blitz', 'chaos', 'hill', 'gauntlet'];
for (let g = 0; g < N; g++) {
  const mode = modes[g % modes.length];
  const s = createMatch(roster(mode === 'duel' ? 2 : 8, g), 500 + g, { mode });
  let r = s.round, seen = new Map(), prev = null, steps = 0;
  const check = () => {
    if (s.round !== r) { rounds++; r = s.round; seen = new Map(); prev = null; }
    const u = unitById(s, s.active); if (!u) return;
    turns++;
    const resumed = s.turn && s.turn.resumed;
    if (seen.has(u.id) && !(resumed && seen.get(u.id) === 1)) { fails++; if (fails < 6) console.log(`FAIL g${g} ${mode} r${s.round}: ${u.name} acted twice`); }
    if (resumed) holds++;
    seen.set(u.id, resumed ? 2 : 1);
    // nobody still waiting this round may outrank the unit that got the turn (gauge already reset on u, so compare the
    // recorded pick-time tier and initiative)
    for (const v of s.units) if (v.alive && v.rt !== s.round && v.id !== u.id && v.id < ceil) {
      const tv = turnTier(v, s.round);
      if (tv < s.pickTier || (tv === s.pickTier && initiative(v, s) > s.pickInit + 1e-9)) { if (lastEv.some((q) => q.e === 'kingPhase')) { excused++; continue; } /* a King phase right after the pick (haste, knockback onto a shrine) changes SPD after the order was decided */ inv++; if (inv < 6) console.log(`ORDER g${g} ${mode} r${s.round}: ${u.name} (${s.pickTier}/${s.pickInit}) before ${v.name} (${tv}/${initiative(v, s)})`); }
    }
  };
  // record initiative at pick time: wrap by peeking before each end
  const snap = () => { ceil = s.nextId; };
  let ceil = s.nextId;
  snap(); { const u = unitById(s, s.active); u._init = effSpd(u); } check();
  while (!s.over && steps < 40000) {
    const u = unitById(s, s.active);
    const plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    for (const a of plan) { snap(); lastEv = applyAction(s, u.pid, a).ev; steps++; if (s.active !== u.id || s.over) break; }
    if (s.active === u.id && !s.over) { snap(); lastEv = applyAction(s, u.pid, { type: 'end' }).ev; }
    steps++;
    if (!s.over) { const n = unitById(s, s.active); if (n._init === undefined) n._init = effSpd(n); check(); }
  }
}
console.log(`turn order: ${N} matches, ${rounds} rounds, ${turns} turns, double turns ${fails}, order inversions ${inv} (+${excused} after a King phase), bot holds resumed ${holds}`);

// ---- 16.0 deterministic: Hold, tempo tiers, Reversal (constructed 4-pawn states, SPD 12.5 / 12 / 11 / 10) ----
let uf = 0; const T = (name, ok, info = '') => { if (!ok) { uf++; console.log(`FAIL ${name} ${info}`); } };
function fresh(seed = 3) {
  const s = createMatch(roster(4, 0), seed, { mode: 'royale', mutator: 'none' });
  s.units = s.units.filter((u) => u.kind === 'player'); s.items = [];
  s.units.forEach((u, i) => { u.piece = 'pawn'; u.pts = { hp: 0, atk: 0, def: 0, spd: 3 - i }; u.buffs = []; u.status = []; u.gauge = 0; u.passive = 'regen'; u.x = 2 + i * 3; u.y = 8; u.momentum = 0; u.attune = 0; });
  s.round = 3; s.storm = { ring: 0, crack: false }; s.rules = { ...s.rules, first: 99, crown: 99 };
  for (const u of s.units) u.rt = null;
  s.active = null; nextTurn(s, []); return s;
}
const nm = (s) => s.units.find((u) => u.id === s.active).name.replace(/\d+$/, '') + s.units.findIndex((u) => u.id === s.active);
const idx = (s) => s.units.findIndex((u) => u.id === s.active);
const act = (s, a) => applyAction(s, unitById(s, s.active).pid, a);
{ // Hold: the held unit acts after everyone still waiting, once per round, and starts next round 3 SPD later
  const s = fresh(), [A] = s.units; T('hold: fastest acts first', idx(s) === 0, nm(s));
  T('hold: legal at turn start', canHold(s, A));
  const r = act(s, { type: 'hold' }); T('hold: accepted', r.ok && r.ev.some((e) => e.e === 'hold' && e.id === A.id));
  const q = predictOrder(s, 4); T('hold: strip shows the held unit last this round', q[3] === A.id, JSON.stringify(q));
  T('hold: turnQueue lists it as held', turnQueue(s).held.includes(A.id));
  const order = [idx(s)]; for (let k = 0; k < 3; k++) { act(s, { type: 'end' }); order.push(idx(s)); }
  T('hold: order B C D then A', order.join() === '1,2,3,0', order.join());
  T('hold: resumed turn is flagged', s.turn.resumed === true);
  T('hold: not twice in a round', !canHold(s, A) && !act(s, { type: 'hold' }).ok);
  act(s, { type: 'end' });
  T('hold: next round A carries -' + HOLD.gauge + ' gauge', A.gauge === -HOLD.gauge, String(A.gauge));
  T('hold: next round A acts after D (12.5 - 3 < 10)', idx(s) === 1, nm(s));
  const seq = [idx(s)]; for (let k = 0; k < 3; k++) { act(s, { type: 'end' }); seq.push(idx(s)); }
  T('hold: next round order B C D A', seq.join() === '1,2,3,0', seq.join());
}
{ // two holds keep their SPD order; no hold after moving, using an ability, or as the last unit waiting
  const s = fresh(); act(s, { type: 'hold' }); act(s, { type: 'hold' });
  const o = [idx(s)]; for (let k = 0; k < 3; k++) { act(s, { type: 'end' }); o.push(idx(s)); }
  T('hold x2: C D A B', o.join() === '2,3,0,1', o.join());
  const s2 = fresh(), U = unitById(s2, s2.active);
  const mv = [{ x: U.x + 1, y: U.y }, { x: U.x, y: U.y + 1 }, { x: U.x - 1, y: U.y }].find((m) => act(s2, { type: 'move', ...m }).ok);
  T('hold: illegal after moving', mv && !canHold(s2, U) && !act(s2, { type: 'hold' }).ok);
  const s3 = fresh(); for (let k = 0; k < 3; k++) act(s3, { type: 'end' });
  T('hold: illegal for the last unit waiting', idx(s3) === 3 && !canHold(s3, unitById(s3, s3.active)));
}
{ // Reversal: s.reversal === s.round flips SPD order (slowest first); gauge nudges keep their direction
  const s = createMatch(roster(4, 0), 3, { mode: 'royale', mutator: 'none' }); s.units = s.units.filter((u) => u.kind === 'player');
  s.units.forEach((u, i) => { u.piece = 'pawn'; u.pts = { hp: 0, atk: 0, def: 0, spd: 3 - i }; u.buffs = []; u.status = []; u.gauge = 0; u.rt = null; u.passive = 'regen'; u.momentum = 0; u.attune = 0; });
  s.round = 4; s.reversal = 4; s.active = null; s.rules = { ...s.rules, first: 99, crown: 99 }; nextTurn(s, []);
  const o = [idx(s)]; for (let k = 0; k < 3; k++) { act(s, { type: 'end' }); o.push(idx(s)); }
  T('reversal: D C B A', o.join() === '3,2,1,0', o.join());
  const q = turnQueue(s); T('reversal: queue flags the reversed round', q.reversed && !q.nextReversed);
  act(s, { type: 'end' }); T('reversal: next round is normal again (A first)', idx(s) === 0, nm(s));
  const s2 = fresh(); s2.reversal = s2.round + 1; const nq = turnQueue(s2);
  T('reversal: telegraphed next round shows reversed', nq.nextReversed && nq.next.join() === s2.units.map((u) => u.id).reverse().join(), JSON.stringify(nq.next));
}
{ // tempo tiers: Seized acts first, Hourglassed last (but before held units)
  const s = createMatch(roster(4, 0), 3, { mode: 'royale', mutator: 'none' }); s.units = s.units.filter((u) => u.kind === 'player');
  s.units.forEach((u, i) => { u.piece = 'pawn'; u.pts = { hp: 0, atk: 0, def: 0, spd: 3 - i }; u.buffs = []; u.status = []; u.gauge = 0; u.rt = null; u.passive = 'regen'; u.momentum = 0; u.attune = 0; });
  s.round = 4; s.units[3].tempo = { k: 'first', r: 4 }; s.units[0].tempo = { k: 'last', r: 4 }; s.active = null; s.rules = { ...s.rules, first: 99, crown: 99 }; nextTurn(s, []);
  const o = [idx(s)]; act(s, { type: 'end' }); o.push(idx(s)); act(s, { type: 'hold' }); o.push(idx(s)); for (let k = 0; k < 2; k++) { act(s, { type: 'end' }); o.push(idx(s)); }
  T('tempo: D(seized) B, B holds, C A(hourglassed) B(held)', o.join() === '3,1,2,0,1', o.join());
}
console.log(`16.0 order unit tests: ${uf ? uf + ' FAIL' : 'all pass'}`);
console.log(fails === 0 && inv === 0 && !uf ? 'PASS every unit acts once per round, fastest first' : 'FAIL'); process.exit(fails || inv || uf ? 1 : 0);

// 15.2: round-based initiative. Every living unit acts at most once per round, and within a round units act in
// descending SPD (with tempo nudges) order. node tests/turns/order.mjs [games]
import { createMatch, applyAction, planBot, planHollow, unitById, effSpd, initiative } from '../../js/engine.js';
import { roster } from '../../tools/run.mjs';
const N = +process.argv[2] || 60; let fails = 0, rounds = 0, inv = 0, turns = 0;
const modes = ['royale', 'duel', 'squads', 'siege', 'blitz', 'chaos', 'hill', 'gauntlet'];
for (let g = 0; g < N; g++) {
  const mode = modes[g % modes.length];
  const s = createMatch(roster(mode === 'duel' ? 2 : 8, g), 500 + g, { mode });
  let r = s.round, seen = new Map(), prev = null, steps = 0;
  const check = () => {
    if (s.round !== r) { rounds++; r = s.round; seen = new Map(); prev = null; }
    const u = unitById(s, s.active); if (!u) return;
    turns++;
    if (seen.has(u.id)) { fails++; if (fails < 6) console.log(`FAIL g${g} ${mode} r${s.round}: ${u.name} acted twice`); }
    seen.set(u.id, 1);
    // nobody still waiting this round may outrank the unit that got the turn (gauge already reset on u, so compare the
    // recorded pick-time initiative)
    for (const v of s.units) if (v.alive && v.rt !== s.round && v.id !== u.id && v.id < ceil && initiative(v) > s.pickInit + 1e-9) { inv++; if (inv < 6) console.log(`ORDER g${g} ${mode} r${s.round}: ${u.name} (${s.pickInit}) before ${v.name} (${initiative(v)})`); }
  };
  // record initiative at pick time: wrap by peeking before each end
  const snap = () => { ceil = s.nextId; };
  let ceil = s.nextId;
  snap(); { const u = unitById(s, s.active); u._init = effSpd(u); } check();
  while (!s.over && steps < 40000) {
    const u = unitById(s, s.active);
    const plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    for (const a of plan) { snap(); applyAction(s, u.pid, a); steps++; if (s.active !== u.id || s.over) break; }
    if (s.active === u.id && !s.over) { snap(); applyAction(s, u.pid, { type: 'end' }); }
    steps++;
    if (!s.over) { const n = unitById(s, s.active); if (n._init === undefined) n._init = effSpd(n); check(); }
  }
}
console.log(`turn order: ${N} matches, ${rounds} rounds, ${turns} turns, double turns ${fails}, order inversions ${inv}`);
console.log(fails === 0 && inv === 0 ? 'PASS every unit acts once per round, fastest first' : 'FAIL'); process.exit(fails || inv ? 1 : 0);

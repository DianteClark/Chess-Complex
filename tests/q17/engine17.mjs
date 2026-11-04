// C2 17.0: player feedback regressions (headless, constructed states + bot matches).
// node tests/q17/engine17.mjs [--verbose]
//   SD Sudden Death  storm damage only in the void; on the last (safe) tiles the burn is Sudden Death: dmg sd:true,
//                    death cause 'sudden', log "Sudden Death eliminated", {e:'suddenDeath'} each round, 6% + 2%/round
//   BI Bishop        Sidestep: diagonals up to 4 plus 1 tile straight, so it can change tile colour; Archbishop too;
//                    applyAction accepts it (move how 'step'); bots use it; deterministic
import * as E from '../../js/engine.js';
import * as D from '../../js/data.js';
import { stateHash } from '../../js/statehash.js';
import { roster, play } from '../../tools/run.mjs';
const VERB = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const check = (g, name, ok, info = '') => { if (ok) pass++; else fail++; if (VERB || !ok) console.log(`${ok ? 'PASS' : 'FAIL'} ${g} ${name}${info !== '' ? ' :: ' + info : ''}`); };
const safe = (g, name, fn) => { try { fn(); } catch (e) { fail++; console.log(`FAIL ${g} ${name} (threw) :: ${e.message} @ ${(e.stack.split('\n')[1] || '').trim()}`); } };

function mk(n = 2, seed = 5) {
  const s = E.createMatch(roster(n, 0), seed, { mode: 'royale', mutator: 'none' });
  s.units = s.units.filter((u) => u.kind === 'player'); s.items = [];
  for (let i = 0; i < s.tiles.length; i++) s.tiles[i] = { t: 'floor' };
  s.storm = { ring: 0, crack: false }; s.rules = { ...s.rules, first: 99, crown: 99 }; s.round = 12;
  s.units.forEach((u, i) => { u.piece = 'pawn'; u.pts = { hp: 0, atk: 0, def: 0, spd: 0 }; u.buffs = []; u.status = []; u.gauge = 0; u.passive = 'none'; u.momentum = 0; u.attune = 0; u.shards = 0; u.x = 1 + i; u.y = 1; u.hp = E.stats(u).maxHp; u.cd = { sig: 0, eq: 0 }; u.ult = 0; u.sw = true; });
  return s;
}
function forceTurn(s, u) { for (const w of s.units) if (w.alive) { w.gauge = 0; w.rt = s.round; } u.rt = null; s.roundTurns = 0; s.active = null; const ev = []; E.nextTurn(s, ev); return ev; }
const evs = (ev, e, f = () => true) => ev.filter((q) => q.e === e && f(q));
const stormHits = (ev, u) => evs(ev, 'dmg', (q) => q.id === u.id && q.storm);

// ---------- SD ----------
safe('SD', 'no storm damage on safe or cracked tiles before Sudden Death', () => {
  const s = mk(); const [A, B] = s.units; s.storm = { ring: 6, crack: false };
  A.x = 7; A.y = 6; B.x = 7; B.y = 7; // ring 6 (the last ring that will fall) and ring 7 (the final tiles)
  check('SD', 'ring 6 safe at storm.ring 6', E.ringOf(7, 6) === 6 && !E.isVoid(s, 7, 6) && !E.suddenDeath(s) && E.suddenDeathPct(s) === 0);
  check('SD', 'ring 6 piece takes no storm damage', stormHits(forceTurn(s, A), A).length === 0 && A.hp === E.stats(A).maxHp);
  check('SD', 'ring 7 piece takes no storm damage', stormHits(forceTurn(s, B), B).length === 0 && B.hp === E.stats(B).maxHp);
  s.storm.crack = true;
  check('SD', 'cracked ring 6 piece takes no damage yet', stormHits(forceTurn(s, A), A).length === 0 && A.hp === E.stats(A).maxHp);
});
safe('SD', 'void burn is storm, not Sudden Death', () => {
  const s = mk(); const [A] = s.units; s.storm = { ring: 3, crack: false }; A.x = 2; A.y = 8;
  const h = stormHits(forceTurn(s, A), A);
  check('SD', 'void piece: one storm hit, 20% max HP, no sd flag', h.length === 1 && !h[0].sd && h[0].n === Math.max(4, Math.round(E.stats(A).maxHp * 0.2)), JSON.stringify(h));
});
safe('SD', 'Sudden Death on the final tiles is flagged and escalates', () => {
  const s = mk(); const [A, B] = s.units; s.storm = { ring: E.STORM.maxRing, crack: false, sdAt: 12 }; A.x = 7; A.y = 7; B.x = 8; B.y = 8;
  check('SD', 'final tile is not void', !E.isVoid(s, 7, 7) && E.suddenDeath(s));
  const pcts = [];
  for (let k = 0; k < 3; k++) {
    s.round = 12 + k; A.hp = E.stats(A).maxHp; const h = stormHits(forceTurn(s, A), A);
    pcts.push(h.length === 1 && h[0].sd ? h[0].n : -1);
  }
  const mh = E.stats(A).maxHp, want = [0.06, 0.08, 0.10].map((p) => Math.max(3, Math.round(mh * p)));
  check('SD', 'sd:true hits of 6%, 8%, 10% max HP', JSON.stringify(pcts) === JSON.stringify(want), `${pcts} want ${want}`);
  check('SD', 'suddenDeathPct = 0.06 + 0.02 per round', Math.abs(E.suddenDeathPct(s) - 0.10) < 1e-9);
});
safe('SD', 'a Sudden Death kill says Sudden Death, never the storm', () => {
  const s = mk(); const [A] = s.units; s.storm = { ring: E.STORM.maxRing, crack: false, sdAt: 12 }; A.x = 7; A.y = 7; A.hp = 1;
  const ev = forceTurn(s, A); const d = evs(ev, 'death', (q) => q.id === A.id)[0];
  check('SD', 'death cause sudden', d && d.cause === 'sudden', JSON.stringify(d));
  check('SD', 'log line', s.log.some((l) => l === `Sudden Death eliminated ${A.name}`) && !s.log.some((l) => l === `The storm eliminated ${A.name}`), s.log.slice(-3).join(' | '));
});
safe('SD', 'bot matches: every storm hit is in the void or flagged sd, {e:suddenDeath} each SD round', () => {
  let bad = 0, sdHits = 0, voidHits = 0, sdEv = 0, sdEvBad = 0, firstOk = true;
  for (const mode of ['blitz', 'duel', 'royale']) for (let g = 0; g < 6; g++) {
    const s = E.createMatch(roster(mode === 'duel' ? 2 : 8, g), 900 + g, { mode });
    let steps = 0, firsts = 0;
    const chk = (ev) => { for (const e of ev) {
      if (e.e === 'dmg' && e.storm) { const u = E.unitById(s, e.id); if (e.sd) { sdHits++; if (!E.suddenDeath(s)) bad++; } else { voidHits++; if (!E.isVoid(s, u.x, u.y)) bad++; } }
      if (e.e === 'suddenDeath') { sdEv++; if (e.first) firsts++; if (Math.round(E.suddenDeathPct(s) * 100) !== e.pct || e.round !== s.round) sdEvBad++; }
    } };
    while (!s.over && steps < 40000) {
      const u = E.unitById(s, s.active); const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u), turn = s.turnNo;
      for (const a of plan) { chk(E.applyAction(s, u.pid, a).ev || []); steps++; if (s.turnNo !== turn || s.over) break; }
      if (s.turnNo === turn && !s.over) chk(E.applyAction(s, u.pid, { type: 'end' }).ev || []);
      steps++;
    }
    if (firsts > 1) firstOk = false;
  }
  check('SD', 'no storm-tagged hit on a safe tile outside Sudden Death', bad === 0 && voidHits > 0 && sdHits > 0, `bad ${bad} void ${voidHits} sd ${sdHits}`);
  check('SD', 'suddenDeath events carry the round and pct, first once', sdEv > 0 && sdEvBad === 0 && firstOk, `n ${sdEv} bad ${sdEvBad}`);
});

// ---------- BI ----------
const key = (m) => m.x + ',' + m.y;
safe('BI', 'Sidestep moves', () => {
  const s = mk(); const [A, B] = s.units; A.piece = 'bishop'; A.x = 8; A.y = 8; B.x = 14; B.y = 1; forceTurn(s, A);
  const ms = E.legalMoves(s, A), set = new Set(ms.map(key));
  check('BI', '16 diagonal + 4 sidestep on an open floor', ms.length === 20, ms.length);
  check('BI', 'all four orthogonal neighbours, nothing further straight', ['9,8', '7,8', '8,9', '8,7'].every((k) => set.has(k)) && !set.has('10,8') && !set.has('8,6'));
  check('BI', 'sidesteps change tile colour, diagonals never do', ms.every((m) => ((m.x + m.y) % 2 === (A.x + A.y) % 2) === !m.side) && ms.filter((m) => m.side).length === 4);
  s.tiles[8 * 16 + 9] = { t: 'wall' }; B.x = 8; B.y = 7;
  const ms2 = new Set(E.legalMoves(s, A).map(key));
  check('BI', 'blocked by walls and pieces', !ms2.has('9,8') && !ms2.has('8,7') && ms2.has('7,8') && ms2.has('8,9'));
  const t0 = s.turnNo, r = E.applyAction(s, A.pid, { type: 'move', x: 7, y: 8 }); const mv = evs(r.ev, 'move', (q) => q.id === A.id)[0];
  check('BI', 'applyAction accepts a sidestep, move how step', r.ok && A.x === 7 && A.y === 8 && mv && mv.how === 'step', JSON.stringify(mv));
  check('BI', 'a Sidestep before acting spends the action (turn passes)', s.turnNo !== t0);
});
safe('BI', 'strike first, then Sidestep', () => {
  const s = mk(); const [A, B] = s.units; A.piece = 'bishop'; A.x = 8; A.y = 8; B.x = 10; B.y = 10; forceTurn(s, A);
  const r1 = E.applyAction(s, A.pid, { type: 'ability', slot: 'atk', x: 9, y: 9 });
  check('BI', 'ray hits', r1.ok && evs(r1.ev, 'dmg', (q) => q.id === B.id).length === 1 && s.active === A.id);
  const t1 = s.turnNo, r2 = E.applyAction(s, A.pid, { type: 'move', x: 8, y: 7 });
  check('BI', 'sidestep after the action', r2.ok && A.x === 8 && A.y === 7 && s.turnNo !== t1);
  const s2 = mk(); const [C, F] = s2.units; C.piece = 'bishop'; C.x = 8; C.y = 8; F.x = 12; F.y = 1; forceTurn(s2, C);
  const t2 = s2.turnNo; E.applyAction(s2, C.pid, { type: 'move', x: 9, y: 8 });
  check('BI', 'no attack after a Sidestep', s2.turnNo !== t2);
  const s3 = mk(); const [G, H] = s3.units; G.piece = 'bishop'; G.x = 8; G.y = 8; H.x = 12; H.y = 1; forceTurn(s3, G);
  const t3 = s3.turnNo; E.applyAction(s3, G.pid, { type: 'move', x: 10, y: 10 });
  check('BI', 'a diagonal slide keeps the action', s3.turnNo === t3 && E.canAct(s3, G));
  const p = E.planBot(s3, G); const mi = p.findIndex((a) => a.type === 'move'), m = p[mi];
  check('BI', 'bot plans never pair a Sidestep with an ability', !(m && Math.abs(m.x - G.x) + Math.abs(m.y - G.y) === 1 && p.some((a, i) => i > mi && a.type === 'ability')));
});
safe('BI', 'Archbishop keeps Sidestep, other pieces unchanged', () => {
  const s = mk(); const [A, B] = s.units; A.piece = 'bishop'; A.hone = { bishop: D.MAX_HONE }; A.x = 8; A.y = 8; B.x = 14; B.y = 1; forceTurn(s, A);
  check('BI', 'ascended bishop', E.ascended(A) && E.legalMoves(s, A).filter((m) => m.side).length === 4);
  const n = {}; for (const p of ['pawn', 'knight', 'rook', 'queen', 'veteran', 'champion']) { A.piece = p; n[p] = E.legalMoves(s, A).length; }
  check('BI', 'move counts of other pieces', JSON.stringify(n) === JSON.stringify({ pawn: 8, knight: 8, rook: 16, queen: 40, veteran: 8, champion: 8 }), JSON.stringify(n));
});
safe('BI', 'bots sidestep and matches stay deterministic', () => {
  let side = 0;
  for (let g = 0; g < 4; g++) {
    const s = E.createMatch(roster(8, g), 300 + g, { mode: 'royale' });
    let steps = 0;
    while (!s.over && steps < 40000) {
      const u = E.unitById(s, s.active); const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u), turn = s.turnNo;
      for (const a of plan) { if (a.type === 'move' && u.piece === 'bishop' && (a.x + a.y) % 2 !== (u.x + u.y) % 2) side++; E.applyAction(s, u.pid, a); steps++; if (s.turnNo !== turn || s.over) break; }
      if (s.turnNo === turn && !s.over) E.applyAction(s, u.pid, { type: 'end' });
      steps++;
    }
  }
  check('BI', 'bot Bishops use Sidestep', side > 0, side);
  const h = () => stateHash(play(roster(8, 3), 4321, { mode: 'royale' }));
  check('BI', 'same seed, same final hash', h() === h());
});

console.log(`engine17: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// C 16.0: deterministic engine tests for docs/DESIGN_16.md sections 1 and 2 (headless, constructed states).
// node tests/q16/engine16.mjs [--verbose]
//   OK Overkill   spill = 50% of the excess into the attacker's nearest enemy next to the victim, one hop, players only
//   GD Guard      one hit <= max(35, 60 - DEF)% of max HP, players + King only, preview capped, DoTs not capped
//   SW Second Wind once per match, first hit that leaves you alive under 25%: heal 10% max + 1 per HP point
//   IN Interest   start of each round: +1 shard per 5 held, max +2, {e:'interest'}
//   TE tempo      Seize / Hourglass / Anchor / Time Fracture: data, prices, events, next-round order, bots use them
import * as E from '../../js/engine.js';
import * as D from '../../js/data.js';
import { roster, play } from '../../tools/run.mjs';
const VERB = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const check = (g, name, ok, info = '') => { if (ok) pass++; else fail++; if (VERB || !ok) console.log(`${ok ? 'PASS' : 'FAIL'} ${g} ${name}${info !== '' ? ' :: ' + info : ''}`); };
const safe = (g, name, fn) => { try { fn(); } catch (e) { fail++; console.log(`FAIL ${g} ${name} (threw) :: ${e.message} @ ${(e.stack.split('\n')[1] || '').trim()}`); } };

// 4 pawns on a clear floor, no hollows/items/storm, round 9 (past Steadfast)
function mk(n = 4, seed = 5) {
  const s = E.createMatch(roster(n, 0), seed, { mode: 'royale', mutator: 'none' });
  s.units = s.units.filter((u) => u.kind === 'player'); s.items = [];
  for (let i = 0; i < s.tiles.length; i++) s.tiles[i] = { t: 'floor' };
  s.storm = { ring: 0, crack: false }; s.rules = { ...s.rules, first: 99, crown: 99 }; s.round = 9;
  s.units.forEach((u, i) => { u.piece = 'pawn'; u.pts = { hp: 0, atk: 0, def: 0, spd: 0 }; u.buffs = []; u.status = []; u.gauge = 0; u.passive = 'regen'; u.momentum = 0; u.attune = 0; u.shards = 0; u.x = 1 + i; u.y = 1; u.hp = E.stats(u).maxHp; u.cd = { sig: 0, eq: 0 }; u.ult = 0; u.sw = false; });
  return s;
}
const place = (u, x, y) => { u.x = x; u.y = y; };
// hand the turn to u (its turn start runs)
function forceTurn(s, u) { for (const w of s.units) if (w.alive) { w.gauge = 0; w.rt = s.round; } u.rt = null; s.roundTurns = 0; s.active = null; const ev = []; E.nextTurn(s, ev); return ev; }
const evs = (ev, e, f = () => true) => ev.filter((q) => q.e === e && f(q));
const atk = (s, u, x, y) => E.applyAction(s, u.pid, { type: 'ability', slot: 'atk', x, y });

// ---------- OK Overkill ----------
safe('OK', 'basic spill', () => {
  const s = mk(), [A, V, W, X] = s.units;
  place(A, 5, 5); place(V, 6, 6); place(W, 7, 7); place(X, 12, 12); V.hp = 1;
  forceTurn(s, A); const r = atk(s, A, 6, 6);
  const hit = evs(r.ev, 'dmg', (q) => q.id === V.id)[0], ok = evs(r.ev, 'overkill');
  check('OK', 'kill event then one overkill event', r.ok && !V.alive && ok.length === 1, JSON.stringify(ok));
  const want = Math.max(1, Math.round((hit.n - 1) * E.OVERKILL.spill));
  check('OK', 'spill = 50% of the excess', ok[0] && ok[0].id === A.id && ok[0].from === V.id && ok[0].to === W.id && ok[0].dmg === want, `got ${ok[0] && ok[0].dmg} want ${want} (hit ${hit.n})`);
  check('OK', 'splash target loses that much HP, dmg event flagged overkill', W.hp === E.stats(W).maxHp - want && evs(r.ev, 'dmg', (q) => q.id === W.id && q.overkill && q.src === A.id).length === 1);
});
safe('OK', 'nearest enemy of the attacker, one hop, never chains', () => {
  const s = mk(5), [A, V, W, X, Y] = s.units;
  place(A, 5, 5); place(V, 6, 6); place(W, 7, 7); place(X, 6, 5); place(Y, 8, 8); V.hp = 1; X.hp = 1; W.hp = 1;
  forceTurn(s, A); const r = atk(s, A, 6, 6); const ok = evs(r.ev, 'overkill');
  check('OK', 'picks the enemy closest to the attacker (X at 1 tile over W at 2)', ok.length === 1 && ok[0].to === X.id, JSON.stringify(ok));
  check('OK', 'a kill by the spill does not spill again', !X.alive && ok.length === 1 && W.alive && Y.hp === E.stats(Y).maxHp);
});
safe('OK', 'no target, allies and Hollow attackers', () => {
  const s = mk(), [A, V, W] = s.units; place(A, 5, 5); place(V, 6, 6); place(W, 12, 12); V.hp = 1;
  forceTurn(s, A); const r = atk(s, A, 6, 6);
  check('OK', 'nothing next to the victim: no spill', !evs(r.ev, 'overkill').length);
  const s2 = E.createMatch(roster(4, 0), 5, { mode: 'squads', mutator: 'none' }); const P = s2.units.filter((u) => u.kind === 'player');
  const a = P[0], mate = P.find((u) => u !== a && u.team === a.team), foe = P.filter((u) => u.team !== a.team);
  if (mate && foe.length) {
    for (const u of s2.units) if (u.kind === 'hollow') { u.alive = false; u.x = -50 - u.id; }
    for (let i = 0; i < s2.tiles.length; i++) s2.tiles[i] = { t: 'floor' }; s2.items = []; s2.round = 9; s2.rules = { ...s2.rules, first: 99, crown: 99 };
    place(a, 5, 5); place(foe[0], 6, 6); place(mate, 7, 7); foe.slice(1).forEach((u, i) => place(u, 13, 2 + i * 2)); foe[0].hp = 1; foe[0].status = [];
    forceTurn(s2, a); const r2 = atk(s2, a, 6, 6);
    check('OK', 'never spills into an ally', !evs(r2.ev, 'overkill').length, JSON.stringify(evs(r2.ev, 'overkill')));
  }
});
safe('OK', 'storm / burn kills never spill', () => {
  const s = mk(), [A, V, W] = s.units; place(A, 2, 2); place(V, 6, 6); place(W, 7, 7); V.hp = 1;
  E.addStatus(s, V, 'burn', [], { t: 2, src: A.id }); const ev = forceTurn(s, V);
  check('OK', 'burn tick kill: no overkill', !V.alive && !evs(ev, 'overkill').length);
});

// ---------- GD Guard ----------
safe('GD', 'percentages', () => {
  const s = mk(), [A] = s.units;
  check('GD', 'pawn DEF 5 -> 55%', E.guardPct(A) === 55, E.guardPct(A));
  A.piece = 'rook'; check('GD', 'rook DEF 14 -> 46%', E.guardPct(A) === 46, E.guardPct(A));
  A.pts.def = 10; A.piece = 'pawn'; const d = E.stats(A).def; check('GD', `DEF ${d} -> ${Math.max(35, 60 - d)}%`, E.guardPct(A) === Math.max(35, 60 - d));
  A.piece = 'rook'; check('GD', 'floor 35%', E.guardPct(A) === 35, `def ${E.stats(A).def}`);
  const h = { kind: 'hollow', hpMax: 100, buffs: [] }; check('GD', 'Hollows/bosses are not guarded', E.guardCap(h) === Infinity && E.guardPct(h) === 100);
});
safe('GD', 'caps a hit, emits guard, preview honest', () => {
  const s = mk(), [A, V] = s.units; place(A, 5, 5); place(V, 6, 6);
  A.buffs.push({ k: 'atk', v: 12, t: 9 });
  const cap = E.guardCap(V), pv = E.previewDamage(A, V, 1, s);
  check('GD', 'preview max capped at the Guard cap', pv[1] === cap && pv[0] <= cap, `${pv} cap ${cap}`);
  forceTurn(s, A); const r = atk(s, A, 6, 6);
  const d = evs(r.ev, 'dmg', (q) => q.id === V.id)[0], g = evs(r.ev, 'guard', (q) => q.id === V.id)[0];
  check('GD', 'hit = cap, guard.saved > 0', d && d.n === cap && g && g.saved > 0 && V.alive, JSON.stringify({ d, g, cap }));
  A.buffs = []; const s2 = mk(), [a2, v2] = s2.units; place(a2, 5, 5); place(v2, 6, 6); forceTurn(s2, a2); const r2 = atk(s2, a2, 6, 6);
  check('GD', 'no guard event on a small hit', !evs(r2.ev, 'guard').length);
});
safe('GD', 'DoT ticks are not capped', () => {
  const s = mk(), [, V] = s.units; V.passive = 'regen'; const mx = E.stats(V).maxHp;
  E.addStatus(s, V, 'poison', [], { t: 3, n: 3, src: 1 });
  const ev = forceTurn(s, V); check('GD', 'no guard event from poison', !evs(ev, 'guard').length && evs(ev, 'dmg', (q) => q.dot === 'poison').length === 1, mx);
});

// ---------- SW Second Wind ----------
safe('SW', 'triggers once', () => {
  const s = mk(), [A, V] = s.units; V.pts.hp = 4; const mx = E.stats(V).maxHp; V.hp = Math.ceil(mx * 0.25);
  place(A, 5, 5); place(V, 6, 6); A.buffs.push({ k: 'atk', v: 0.05, t: 9 });
  forceTurn(s, A); const r = atk(s, A, 6, 6); const sw = evs(r.ev, 'secondwind');
  const want = Math.round(mx * E.SECOND_WIND.heal + E.SECOND_WIND.perPt * 4);
  check('SW', 'one secondwind event with heal = 10% max + 1 per HP point', sw.length === 1 && sw[0].id === V.id && sw[0].heal === want && V.sw === true, `${JSON.stringify(sw)} want ${want}`);
  check('SW', 'a heal event too', evs(r.ev, 'heal', (q) => q.id === V.id && q.n === want).length === 1);
  V.hp = 3; forceTurn(s, A); const r2 = atk(s, A, 6, 6);
  check('SW', 'never twice in a match', !evs(r2.ev, 'secondwind').length);
});
safe('SW', 'not from DoTs, not when the hit kills, not for Hollows', () => {
  const s = mk(), [A, V] = s.units; const mx = E.stats(V).maxHp; V.hp = Math.ceil(mx * 0.27);
  E.addStatus(s, V, 'burn', [], { t: 2, src: A.id }); const ev = forceTurn(s, V);
  check('SW', 'burn tick under 25%: no Second Wind', V.alive && V.hp < mx * 0.25 && !evs(ev, 'secondwind').length && !V.sw, `${V.hp}/${mx}`);
  V.hp = 1; place(A, 5, 5); place(V, 6, 6); forceTurn(s, A); const r = atk(s, A, 6, 6);
  check('SW', 'killing hit: no Second Wind', !V.alive && !evs(r.ev, 'secondwind').length);
});

// ---------- IN Interest ----------
safe('IN', 'per 5 held, max 2, one event per player who got any', () => {
  const s = mk(), [A, B, C, Dd] = s.units; A.shards = 3; B.shards = 5; C.shards = 12; Dd.shards = 40;
  for (const u of s.units) u.rt = s.round; s.active = null; const ev = []; E.nextTurn(s, ev);
  const I = evs(ev, 'interest'), by = Object.fromEntries(I.map((q) => [q.id, q.n]));
  check('IN', 'one round passed', s.round === 10);
  check('IN', '3 -> none, 5 -> +1, 12 -> +2, 40 -> +2 (max)', !by[A.id] && by[B.id] === 1 && by[C.id] === 2 && by[Dd.id] === 2 && I.length === 3, JSON.stringify(by));
  check('IN', 'shards actually added', A.shards === 3 && B.shards === 6 && C.shards === 14 && Dd.shards === 42);
  check('IN', 'interestFor() previews next round', E.interestFor(B) === 1 && E.interestFor(A) === 0);
});

// ---------- TE tempo equips ----------
const TE = { knight: 'seize', bishop: 'hourglass', rook: 'anchor', queen: 'fracture' };
safe('TE', 'data', () => {
  for (const [pc, id] of Object.entries(TE)) {
    const A = D.ABILITIES[id];
    check('TE', `${id}: on ${pc}'s equip list, named, desc, cd, unlock 1000-1500, tempo kind`, D.PIECES[pc].equips.includes(id) && A && A.name && A.desc && A.cd > 0 && A.unlock >= 1000 && A.unlock <= 1500 && ['first', 'last', 'both'].includes(A.tempo), JSON.stringify(A));
  }
});
function tempoCase(pc, setup) {
  const s = mk(), [A, V, W] = s.units; A.piece = pc; A.equips = { ...A.equips, [pc]: TE[pc] };
  place(A, 6, 6); setup(s, A, V, W);
  forceTurn(s, A); const opts = E.abilityOptions(s, A, 'eq'); const o = opts.find((q) => q.hits.includes(V.id)) || opts[0];
  const r = E.applyAction(s, A.pid, { type: 'ability', slot: 'eq', x: o.anchor.x, y: o.anchor.y });
  return { s, A, V, W, r, opts };
}
safe('TE', 'Seize', () => {
  const { s, A, V, r } = tempoCase('knight', (s, A, V, W) => { place(V, 7, 8); place(W, 12, 12); });
  const t = evs(r.ev, 'tempo');
  check('TE', 'seize: hits and sets tempo first on the user for next round', r.ok && t.length === 1 && t[0].id === A.id && t[0].k === 'first' && A.tempo && A.tempo.r === s.round + 1 && evs(r.ev, 'dmg', (q) => q.id === V.id).length === 1, JSON.stringify(t));
  A.pts.spd = 0; for (const u of s.units) if (u !== A) u.pts.spd = 6;
  for (const u of s.units) u.rt = s.round; s.active = null; E.nextTurn(s, []);
  check('TE', 'seize: user acts first next round despite the lowest SPD', s.active === A.id, `active ${s.active}`);
  check('TE', 'seize: cooldown set', A.cd.eq === D.ABILITIES.seize.cd || A.cd.eq === D.ABILITIES.seize.cd - 1);
});
safe('TE', 'Hourglass', () => {
  const { s, V, r } = tempoCase('bishop', (s, A, V, W) => { place(V, 9, 9); place(W, 12, 1); });
  check('TE', 'hourglass: target slowed and sent last', r.ok && evs(r.ev, 'tempo', (q) => q.id === V.id && q.k === 'last').length === 1 && (V.status || []).some((q) => q.k === 'slow') && V.tempo.k === 'last', JSON.stringify(r.ev.map((q) => q.e)));
  V.pts.spd = 9; for (const u of s.units) u.rt = s.round; s.active = null; E.nextTurn(s, []);
  const q = E.turnQueue(s); check('TE', 'hourglass: fastest target acts last next round', q.now[q.now.length - 1] === V.id, JSON.stringify(q.now));
});
safe('TE', 'Anchor', () => {
  const { A, V, W, r } = tempoCase('rook', (s, A, V, W) => { place(V, 7, 6); place(W, 5, 7); });
  check('TE', 'anchor: every adjacent enemy sent last, user DEF buff', r.ok && evs(r.ev, 'tempo', (q) => q.k === 'last').length === 2 && V.tempo && W.tempo && A.buffs.some((b) => b.k === 'def'), JSON.stringify(evs(r.ev, 'tempo')));
});
safe('TE', 'Time Fracture', () => {
  const { A, V, W, r } = tempoCase('queen', (s, A, V, W) => { place(V, 8, 8); place(W, 12, 12); });
  check('TE', 'fracture: enemies in 2 tiles last, user first', r.ok && V.tempo && V.tempo.k === 'last' && !W.tempo && A.tempo && A.tempo.k === 'first', JSON.stringify(evs(r.ev, 'tempo')));
});
safe('TE', 'bots use the tempo equips and Hold (rarely)', () => {
  const used = {}; let holds = 0, turns = 0;
  for (let g = 0; g < 10; g++) {
    const P = roster(8, g); for (const p of P) Object.assign(p.build.equips, TE);
    const s = E.createMatch(P, 900 + g, { mode: 'royale' }); let steps = 0;
    while (!s.over && steps < 20000) {
      const u = E.unitById(s, s.active); const turn = s.turnNo; turns++;
      const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
      for (const a of plan) { if (s.over || s.turnNo !== turn) break; const r = E.applyAction(s, u.pid, a); steps++; for (const q of r.ev) { if (q.e === 'ability' && Object.values(TE).includes(q.ab)) used[q.ab] = (used[q.ab] || 0) + 1; if (q.e === 'hold') holds++; } }
      if (!s.over && s.turnNo === turn) E.applyAction(s, u.pid, { type: 'end' }); steps++;
    }
  }
  check('TE', 'every tempo equip gets used by bots', Object.values(TE).every((id) => used[id] > 0), JSON.stringify(used));
  check('TE', `Hold is rare (${holds} in ${turns} turns)`, holds > 0 && holds / turns < 0.05);
});
safe('TE', 'hold is validated', () => {
  const s = mk(), [A, B] = s.units; forceTurn(s, A);
  check('TE', 'hold from the wrong player is rejected', !E.applyAction(s, B.pid, { type: 'hold' }).ok);
  check('TE', 'malformed actions are rejected', !E.applyAction(s, A.pid, { type: 'HOLD' }).ok && !E.applyAction(s, A.pid, null).ok && !E.applyAction(s, A.pid, 'hold').ok && s.active === A.id);
  check('TE', 'hold is illegal when nobody else is still waiting', !E.canHold(s, A) && !E.applyAction(s, A.pid, { type: 'hold' }).ok);
  B.rt = null; check('TE', 'a legal hold passes the turn', E.applyAction(s, A.pid, { type: 'hold' }).ok && s.active === B.id);
});

console.log(`engine16: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

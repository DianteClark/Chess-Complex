// Storm movement (QA, 10.2), engine level. Owner wants players inside the storm zone to move freely and just take the burn.
// Usage: node tests/storm/storm-engine.mjs [--modes royale,duel,blitz,squads,siege] [--seeds 6] [--verbose]
// For every mode x piece x seed: a player STARTS a turn in the void (ring < storm.ring) and must
//   S1 take the storm burn at turn start (dmg event storm:true, hp drops)
//   S2 have legal moves, including at least one safe tile (out) and, where geometry allows, a void tile
//   S3 move out (applyAction ok, unit now on a safe tile)
//   S4 on its next turn move back into the void (applyAction ok)
//   S5 start the following turn in the void and take the burn again (and still be able to move)
//   S6 deep void (ring 0, storm fully collapsed to maxRing) still yields legal moves
import * as E from '../../js/engine.js';
import { MODES, SIZE } from '../../js/data.js';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const modes = String(args.modes || 'royale,duel,blitz,squads,siege').split(',').filter((m) => MODES[m]);
const SEEDS = +(args.seeds || 6);
const PIECES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const P = (i, bot) => ({ pid: 'p' + i, name: 'P' + i, isBot: !!bot, botLevel: 'normal', skin: 'ivory', build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: 'regen', equips: {} } });
let pass = 0; const fails = [];
const check = (c, msg) => { if (c) pass++; else fails.push(msg); return c; };

// Advance to the next turn of `who` (other units just end their turn). Returns the events of the transition.
function toTurnOf(s, who) {
  const ev = [];
  for (let g = 0; g < 400 && !s.over; g++) {
    const a = E.unitById(s, s.active);
    if (a === who && s.turn && !s.turn.moved && !s.turn.acted && g > 0) return ev;
    const r = E.applyAction(s, a.pid, { type: 'end' });
    if (!r.ok) return null;
    ev.push(...r.ev);
    if (E.unitById(s, s.active) === who) return ev;
  }
  return null;
}
const keep = (s, u) => { for (const v of s.units) if (v.alive && v !== u && v.kind === 'player') v.hp = E.stats(v).maxHp; u.hp = E.stats(u).maxHp; };
function clearAround(s, x0, y0, r = 3) { for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) if (E.inB(x, y) && E.isSolid(s, x, y) && E.tileAt(s, x, y).t !== 'out') s.tiles[y * SIZE + x] = { t: 'floor' }; }
function setPiece(u, piece) { if (piece === 'king' && !u.kingStats) u.kingStats = E.baseStats({ ...u, piece: 'queen' }); u.piece = piece; }
function vacate(s, u, x, y) { const o = E.unitAt(s, x, y); if (o && o !== u) { o.alive = false; o.hp = 0; } }

for (const mode of modes) for (const piece of PIECES) for (let seed = 1; seed <= SEEDS; seed++) {
  const tag = `${mode}/${piece}/s${seed}`;
  const n = mode === 'duel' ? 2 : mode === 'squads' ? 4 : mode === 'siege' ? 2 : 3;
  let s; try { s = E.createMatch(Array.from({ length: n }, (_, i) => P(i, i > 0)), seed * 7919, { mode }); } catch (e) { fails.push(`${tag}: createMatch threw ${e.message}`); continue; }
  const u = s.units.find((v) => v.pid === 'p0');
  // the storm has collapsed 3 rings beyond the arena edge
  const base = s.arena ? s.arena.x0 : 0;
  s.storm.ring = Math.min(E.STORM.maxRing, base + 3); s.storm.crack = false;
  const ring = s.storm.ring;
  // place u in the void at ring-1, along the top edge middle, with clear surroundings
  const vx = 8, vy = ring - 1;
  clearAround(s, vx, vy, 3); for (let y = vy - 3; y <= vy + 3; y++) for (let x = vx - 3; x <= vx + 3; x++) if (E.inB(x, y)) vacate(s, u, x, y);
  s.items = s.items.filter((i) => Math.max(Math.abs(i.x - vx), Math.abs(i.y - vy)) > 3);
  setPiece(u, piece); u.x = vx; u.y = vy; keep(s, u);
  if (!check(E.isVoid(s, u.x, u.y), `${tag}: setup: (${vx},${vy}) is not void at ring ${ring}`)) continue;
  // S1: start a turn in the void
  if (s.active === u.id) { E.applyAction(s, u.pid, { type: 'end' }); }
  keep(s, u); const hp0 = u.hp;
  const ev1 = toTurnOf(s, u);
  if (!check(ev1, `${tag}: never got back to p0's turn`)) continue;
  if (!check(u.alive, `${tag}: p0 died on the way to its turn`)) continue;
  check(E.isVoid(s, u.x, u.y), `${tag}: p0 left the void between turns (${u.x},${u.y})`);
  check(ev1.some((e) => e.e === 'dmg' && e.id === u.id && e.storm) && u.hp < hp0, `${tag}: S1 no storm burn at turn start (hp ${hp0} -> ${u.hp})`);
  // S2: legal moves, out and within (re-clear: Siege waves can spawn next to us during the turn hand-off)
  for (let y = u.y - 3; y <= u.y + 3; y++) for (let x = u.x - 3; x <= u.x + 3; x++) if (E.inB(x, y)) vacate(s, u, x, y);
  check(E.canMove(s, u), `${tag}: S2 canMove false at turn start in the void (turn=${JSON.stringify(s.turn)})`);
  const lm = E.legalMoves(s, u);
  const safe = lm.filter((m) => !E.isVoid(s, m.x, m.y)), inVoid = lm.filter((m) => E.isVoid(s, m.x, m.y));
  if (!check(lm.length > 0, `${tag}: S2 no legal moves from the void`)) continue;
  if (!check(safe.length > 0, `${tag}: S2 no legal move out of the void (moves: ${lm.map((m) => m.x + ',' + m.y).join(' ')})`)) continue;
  if (piece !== 'bishop' && piece !== 'knight') check(inVoid.length > 0, `${tag}: S2 no legal move within the void`);
  // S3: move out
  const out = safe[0];
  const r3 = E.applyAction(s, u.pid, { type: 'move', x: out.x, y: out.y });
  check(r3.ok && u.x === out.x && u.y === out.y, `${tag}: S3 move out to (${out.x},${out.y}) rejected (ok=${r3.ok}) now at (${u.x},${u.y})`);
  if (s.active === u.id) E.applyAction(s, u.pid, { type: 'end' });
  // S4: next turn, move back in
  keep(s, u);
  if (!check(toTurnOf(s, u), `${tag}: S4 never got the next turn`)) continue;
  const back = E.legalMoves(s, u).filter((m) => E.isVoid(s, m.x, m.y));
  if (!check(back.length > 0, `${tag}: S4 no legal move back into the void from (${u.x},${u.y})`)) continue;
  const b = back[0];
  const r4 = E.applyAction(s, u.pid, { type: 'move', x: b.x, y: b.y });
  check(r4.ok && u.x === b.x && u.y === b.y && E.isVoid(s, u.x, u.y), `${tag}: S4 move back into void (${b.x},${b.y}) rejected (ok=${r4.ok})`);
  if (s.active === u.id) E.applyAction(s, u.pid, { type: 'end' });
  // S5: burn again, still mobile
  keep(s, u); const hp5 = u.hp;
  const ev5 = toTurnOf(s, u);
  if (!check(ev5 && u.alive, `${tag}: S5 lost p0`)) continue;
  check(ev5.some((e) => e.e === 'dmg' && e.id === u.id && e.storm) && u.hp < hp5, `${tag}: S5 no storm burn on the second void turn`);
  check(E.canMove(s, u) && E.legalMoves(s, u).length > 0, `${tag}: S5 cannot move on the second void turn`);
}
// S6: deep void, storm at maxRing, piece at the corner region
for (const piece of PIECES) {
  const s = E.createMatch([P(0), P(1, true)], 99, { mode: 'royale' });
  const u = s.units.find((v) => v.pid === 'p0');
  s.storm.ring = E.STORM.maxRing; clearAround(s, 2, 2, 3); for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) vacate(s, u, x, y);
  setPiece(u, piece); u.x = 2; u.y = 2; keep(s, u);
  if (s.active === u.id) E.applyAction(s, u.pid, { type: 'end' });
  const ev = toTurnOf(s, u);
  check(ev && u.alive && E.canMove(s, u) && E.legalMoves(s, u).length > 0, `deep/${piece}: no legal moves in deep void at maxRing`);
}
// S7/S8: natural collapse, nothing cleared by the test. Play turns (everyone ends) until the storm has collapsed 3 rings
// past the arena edge; then S7 every void tile inside the arena is standable terrain (no hidden walls/crates/pits that the
// renderer draws as empty void), S8 a piece dropped on any free void tile has a legal move unless boxed in by units.
for (const mode of modes) for (let seed = 1; seed <= SEEDS; seed++) {
  const tag = `natural/${mode}/s${seed}`;
  const n = mode === 'duel' ? 2 : mode === 'squads' ? 4 : mode === 'siege' ? 2 : 4;
  let s; try { s = E.createMatch(Array.from({ length: n }, (_, i) => P(i, true)), seed * 104729, { mode }); } catch (e) { fails.push(`${tag}: createMatch threw ${e.message}`); continue; }
  const base = s.arena ? s.arena.x0 : 0, goal = Math.min(E.STORM.maxRing, base + 3);
  for (let g = 0; g < 20000 && !s.over && s.storm.ring < goal; g++) {
    for (const v of s.units) if (v.alive && v.kind === 'player') v.hp = E.stats(v).maxHp; // nobody dies, the storm just closes
    const a = E.unitById(s, s.active); if (!E.applyAction(s, a.pid, { type: 'end' }).ok) break;
  }
  if (s.storm.ring < goal) { fails.push(`${tag}: storm only reached ring ${s.storm.ring} (wanted ${goal}, over=${s.over})`); continue; }
  const A = s.arena || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
  const hidden = [];
  for (let y = A.y0; y <= A.y1; y++) for (let x = A.x0; x <= A.x1; x++) if (E.isVoid(s, x, y) && E.isSolid(s, x, y)) hidden.push(`${x},${y}:${E.tileAt(s, x, y).t}`);
  check(!hidden.length, `${tag}: S7 ${hidden.length} solid tiles inside the void (drawn as empty): ${hidden.slice(0, 6).join(' ')}`);
  const u = s.units.find((v) => v.alive && v.kind === 'player');
  let boxedFree = 0, tried = 0;
  for (let y = A.y0; y <= A.y1; y++) for (let x = A.x0; x <= A.x1; x++) {
    if (!E.isVoid(s, x, y) || E.unitAt(s, x, y) || E.isSolid(s, x, y)) continue;
    for (const pc of ['pawn', 'rook', 'bishop', 'knight']) {
      const ox = u.x, oy = u.y, op = u.piece; u.x = x; u.y = y; u.piece = pc; tried++;
      const lm = E.legalMoves(s, u);
      const dirs = pc === 'rook' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : pc === 'bishop' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      const nbFree = dirs.some(([dx, dy]) => E.inB(x + dx, y + dy) && !E.unitAt(s, x + dx, y + dy) && !E.isSolid(s, x + dx, y + dy));
      if (!lm.length && nbFree && pc !== 'knight') boxedFree++;
      u.x = ox; u.y = oy; u.piece = op;
    }
  }
  check(boxedFree === 0, `${tag}: S8 ${boxedFree}/${tried} void placements with free neighbours but no legal move`);
}
const total = pass + fails.length;
console.log(`storm-engine: ${pass}/${total} checks pass, ${fails.length} fail (${modes.join(',')} x ${PIECES.length} pieces x ${SEEDS} seeds)`);
const uniq = new Map(); for (const f of fails) { const k = f.replace(/\/s\d+/, '/s*').replace(/\(.*?\)/g, '()'); uniq.set(k, (uniq.get(k) || 0) + 1); }
for (const [k, n] of [...uniq].slice(0, args.verbose ? 999 : 25)) console.log(`  FAIL x${n} ${k}`);
if (args.verbose) fails.slice(0, 60).forEach((f) => console.log('   ', f));
process.exit(fails.length ? 1 : 0);

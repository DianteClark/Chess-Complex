// 15.0 combat balance (C): King rate, presets, placement by final piece and by bot road, Ascension, statuses, length.
// node tools/sim15.mjs [games] [mode] [--rand]   (--rand: random passives and equips, like abilitysim)
// Tunables: K.<key>=v sets KING_T, P.<road>=w sets BOT_PLANS, e.g. node tools/sim15.mjs 200 royale K.hp=1.1 P.pawn=0.2
import { unitById, ascended, KING_T, BOT_PLANS } from '../js/engine.js';
import { roster, play, avg, pct } from './run.mjs';

const args = process.argv.slice(2), flags = new Set(args.filter((a) => a.startsWith('--'))), pos = args.filter((a) => !a.startsWith('--') && !a.includes('='));
for (const a of args.filter((x) => x.includes('='))) { const [k, v] = a.split('='); const [o, f] = k.split('.'); (o === 'K' ? KING_T : BOT_PLANS)[f] = +v; }
const N = +pos[0] || 200, mode = pos[1] || 'royale', randomize = flags.has('--rand');
const T = { rounds: [], turns: [], kingWin: 0, crowned: 0, kingHeld: [], preset: {}, byPiece: {}, byPlan: {}, statusEv: {}, dot: 0, dmg: 0, phases: 0, warn: 0, raceWins: 0, done: 0, stalls: 0, crownBy: {} };
const add = (o, k, place, won) => { const q = (o[k] ||= { n: 0, place: 0, win: 0, top3: 0 }); q.n++; q.place += place; q.win += won; q.top3 += place <= 3 ? 1 : 0; };
for (let g = 0; g < N; g++) {
  const players = roster(8, g, { randomize });
  // tap events: wrap applyAction through play's state by replaying logs is costly, so read the state log instead
  const s = play(players, 1000 + g, { mode });
  if (!s.over) { T.stalls++; continue; }
  T.done++; T.rounds.push(s.round); T.turns.push(s.turnNo);
  const w = unitById(s, s.winner);
  if (w && w.piece === 'king') T.kingWin++;
  if (s.log.some((l) => l.includes('claimed the Crown'))) T.crowned++;
  if (w) { const pn = w.name.replace(/\d+$/, ''); T.preset[pn] = (T.preset[pn] || 0) + 1; }
  const kg = s.units.find((u) => u.kind === 'player' && u.kingStats); if (kg) { const pn = kg.name.replace(/\d+$/, ''); T.crownBy[pn] = (T.crownBy[pn] || 0) + 1; }
  for (const u of s.units) if (u.kind === 'player') {
    const place = u.place || 1, won = u.id === s.winner ? 1 : 0;
    const pc = u.piece === 'king' ? 'king' : ascended(u) ? 'asc-' + u.piece : u.piece;
    add(T.byPiece, pc, place, won);
    if (u.piece === 'king') add(T.byPiece, 'king<' + (ascended({ ...u, piece: u.kingFrom }) ? 'asc-' : '') + u.kingFrom, place, won);
    add(T.byPlan, u.plan || '-', place, won);
  }
  T.phases += s.log.filter((l) => l.includes('is enraged')).length;
}
const rows = (o) => Object.entries(o).sort((a, b) => a[1].place / a[1].n - b[1].place / b[1].n).map(([k, q]) => `  ${k.padEnd(18)} n=${String(q.n).padStart(4)}  avgPlace=${(q.place / q.n).toFixed(2)}  win=${pct(q.win, q.n).padStart(6)}  top3=${pct(q.top3, q.n)}`).join('\n');
console.log(`mode=${mode} games=${N} done=${T.done} stalls=${T.stalls} rand=${randomize}`);
console.log(`avgRounds=${avg(T.rounds)} maxRounds=${Math.max(...T.rounds)} avgTurns=${avg(T.turns)}  kingWin=${pct(T.kingWin, T.done)} crownGames=${pct(T.crowned, T.done)} phaseEnrages/game=${(T.phases / T.done).toFixed(2)}`);
console.log('preset win: ' + Object.entries(T.preset).map(([k, v]) => `${k} ${pct(v, T.done)}`).join(', '));
console.log('crowned by preset: ' + Object.entries(T.crownBy).map(([k, v]) => `${k} ${pct(v, T.done)}`).join(', '));
console.log('placement by final piece (1 = winner, 8 = first out):\n' + rows(T.byPiece));
console.log('placement by bot road:\n' + rows(T.byPlan));

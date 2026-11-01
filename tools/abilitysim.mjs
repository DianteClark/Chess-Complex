// Ability / passive balance: random loadouts, win rate of each passive and each equip (by the piece the winner ended on).
// node tools/abilitysim.mjs [games] [mode]
import { unitById } from '../js/engine.js';
import { PIECES, PASSIVES } from '../js/data.js';
import { roster, play, pct } from './run.mjs';

const N = +process.argv[2] || 200, mode = process.argv[3] || 'royale';
const pas = {}, eq = {};
for (let g = 0; g < N; g++) {
  const players = roster(8, g, { randomize: true });
  const s = play(players, 7000 + g, { mode });
  if (!s.over) continue;
  for (const u of s.units) if (u.kind === 'player') {
    const won = u.id === s.winner ? 1 : 0;
    (pas[u.passive] ||= { n: 0, w: 0 }); pas[u.passive].n++; pas[u.passive].w += won;
    const pc = u.piece === 'king' ? u.kingFrom : u.piece;
    if (pc && PIECES[pc] && PIECES[pc].equips.length) { const k = pc + ':' + u.equips[pc]; (eq[k] ||= { n: 0, w: 0 }); eq[k].n++; eq[k].w += won; }
  }
}
console.log('passive win rate (fair share 12.5%)');
for (const k of Object.keys(PASSIVES)) if (pas[k]) console.log('  ' + k.padEnd(10), pct(pas[k].w, pas[k].n), `(${pas[k].n})`);
console.log('equip win rate among players who ended on that piece');
for (const pc of Object.keys(PIECES)) for (const e of PIECES[pc].equips) { const q = eq[pc + ':' + e]; if (q) console.log('  ' + (pc + ':' + e).padEnd(20), pct(q.w, q.n), `(${q.n})`); }

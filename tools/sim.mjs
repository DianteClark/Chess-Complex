// Headless balance + crash test: run full bot-only matches.
import { createMatch, applyAction, planBot, planHollow, unitById, alivePlayers, stats } from '../js/engine.js';
import { PRESETS, PIECES } from '../js/data.js';

const N = +process.argv[2] || 50;
const presets = Object.values(PRESETS);
const tally = { piecesAtWin: {}, rounds: [], turns: [], presetWins: {}, kills: 0, crowned: 0, stalls: 0 };
for (let g = 0; g < N; g++) {
  const players = Array.from({ length: 8 }, (_, i) => {
    const p = presets[i % presets.length];
    const equips = {}; for (const k of Object.keys(PIECES)) if (PIECES[k].equips.length) equips[k] = PIECES[k].equips[(i + g) % 3];
    return { pid: 'p' + i, name: p.name + i, isBot: true, build: { pts: p.pts, passive: p.passive, equips }, preset: p.name };
  });
  const s = createMatch(players, 1000 + g);
  let steps = 0;
  while (!s.over && steps < 20000) {
    const u = unitById(s, s.active);
    const plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    for (const a of plan) {
      const pid = u.pid;
      const r = applyAction(s, pid, a);
      steps++;
      if (s.active !== u.id || s.over) break;
      if (!r.ok && a.type !== 'end') { /* invalid planned action: skip */ }
    }
    if (s.active === u.id && !s.over) applyAction(s, u.pid, { type: 'end' });
    for (const v of s.units) if (v.alive && (Number.isNaN(v.hp) || v.hp > stats(v).maxHp + 1)) throw new Error('bad hp ' + JSON.stringify(v));
  }
  if (!s.over) { tally.stalls++; continue; }
  const w = unitById(s, s.winner);
  tally.rounds.push(s.round); tally.turns.push(s.turnNo);
  if (w) { tally.piecesAtWin[w.piece] = (tally.piecesAtWin[w.piece] || 0) + 1; tally.presetWins[w.name.replace(/\d+$/, '')] = (tally.presetWins[w.name.replace(/\d+$/, '')] || 0) + 1; }
  tally.crowned += s.log.some((l) => l.includes('claimed the Crown')) ? 1 : 0;
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log({ games: N, stalls: tally.stalls, avgRounds: avg(tally.rounds), avgTurns: avg(tally.turns), maxRounds: Math.max(...tally.rounds), piecesAtWin: tally.piecesAtWin, presetWins: tally.presetWins, crownGames: tally.crowned });

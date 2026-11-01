// Headless balance + crash test: bot-only 8-player Royale. node tools/sim.mjs [games] [mode]
import { unitById } from '../js/engine.js';
import { roster, play, avg, pct } from './run.mjs';

const N = +process.argv[2] || 50, mode = process.argv[3] || 'royale';
const tally = { piecesAtWin: {}, rounds: [], turns: [], presetWins: {}, crowned: 0, stalls: 0, att: [], ult: [] };
for (let g = 0; g < N; g++) {
  const s = play(roster(8, g), 1000 + g, { mode });
  if (!s.over) { tally.stalls++; continue; }
  const w = unitById(s, s.winner);
  tally.rounds.push(s.round); tally.turns.push(s.turnNo);
  if (w) { tally.att.push(w.attune); tally.ult.push(w.ults); tally.piecesAtWin[w.piece] = (tally.piecesAtWin[w.piece] || 0) + 1; const pn = w.name.replace(/\d+$/, ''); tally.presetWins[pn] = (tally.presetWins[pn] || 0) + 1; }
  tally.crowned += s.log.some((l) => l.includes('claimed the Crown')) ? 1 : 0;
}
const done = N - tally.stalls;
console.log({ mode, games: N, stalls: tally.stalls, avgRounds: avg(tally.rounds), avgTurns: avg(tally.turns), maxRounds: Math.max(...tally.rounds),
  kingWin: pct(tally.piecesAtWin.king || 0, done), piecesAtWin: tally.piecesAtWin,
  presetWin: Object.fromEntries(Object.entries(tally.presetWins).map(([k, v]) => [k, pct(v, done)])), crownGames: tally.crowned, winnerAttune: avg(tally.att), winnerUlts: avg(tally.ult) });

// Every mode, bot-only: termination, length, King rate; co-op modes report win rate and waves.
// node tools/modesim.mjs [games per mode] [mode,mode,...]
import * as ENG from '../js/engine.js';
const { unitById } = ENG;
for (const a of process.argv.slice(2).filter((x) => x.includes('='))) { const [k, v] = a.split('='); const [o, f] = k.split('.'); ENG[o][f] = +v; } // 16.0: e.g. INTEREST.per=6 OVERKILL.spill=0.4
import { MODES } from '../js/data.js';
import { roster, play, avg, pct } from './run.mjs';

const G = +process.argv[2] || 80;
const only = process.argv[3] ? process.argv[3].split(',') : null;
const SIZES = { royale: [8], blitz: [8], duel: [2], squads: [8], siege: [1, 2, 4], daily: [8], hill: [8, 4], chaos: [8], gauntlet: [1, 2, 4] };
for (const mode of Object.keys(MODES)) {
  if (only && !only.includes(mode)) continue;
  for (const n of SIZES[mode] || [8]) {
    const rounds = [], turns = []; let stalls = 0, kings = 0, wins = 0, waves = [], hillWins = 0, slot0 = 0;
    const ev = {};
    for (let g = 0; g < G; g++) {
      const s = play(roster(n, g), 50 + g, { mode });
      if (!s.over) { stalls++; continue; }
      rounds.push(s.round); turns.push(s.turnNo);
      const w = unitById(s, s.winner);
      if (w && w.piece === 'king') kings++;
      if (s.siege) { if (s.siegeWon) wins++; waves.push(s.siegeWon ? s.siege.waves : s.siege.wave - 1); }
      if (s.hill && w && (s.hill.score[w.id] || 0) >= s.hill.goal) hillWins++;
    }
    const done = G - stalls;
    const out = { n, stalls, avgRounds: avg(rounds), maxRounds: Math.max(...rounds), avgTurns: avg(turns) };
    if (MODES[mode].siege) Object.assign(out, { winRate: pct(wins, done), avgWavesCleared: avg(waves) });
    else out.kingWin = pct(kings, done);
    if (MODES[mode].hill) out.wonOnThrone = pct(hillWins, done);
    console.log(mode, JSON.stringify(out));
  }
}

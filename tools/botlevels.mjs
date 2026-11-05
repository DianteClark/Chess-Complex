// 18.0 (BT): difficulty head-to-head. Mixed 8-bot Royales; seat levels rotate per game so every preset/spawn plays
// every tier equally. Reports win share (and avg place) per tier.
// node tools/botlevels.mjs [games=400] [mode=royale] [mix=hard,normal]   (mix: 2 or 3 comma-separated levels)
import * as ENG from '../js/engine.js';
import { roster, play, pct } from './run.mjs';

const args = process.argv.slice(2).filter((a) => !a.includes('='));
for (const a of process.argv.slice(2).filter((x) => x.includes('='))) { const [k, v] = a.split('='); const [o, f] = k.split('.'); ENG[o][f] = +v; }
const N = +args[0] || 400, mode = args[1] || 'royale', mix = (args[2] || 'hard,normal').split(',');
const T = {}; for (const l of mix) T[l] = { seats: 0, win: 0, place: 0, top3: 0 };
let done = 0;
for (let g = 0; g < N; g++) {
  const players = roster(8, g);
  players.forEach((p, i) => { p.botLevel = mix[(i + g) % mix.length]; });
  const s = play(players, 7000 + g, { mode });
  if (!s.over) continue;
  done++;
  for (const u of s.units) if (u.kind === 'player') {
    const q = T[players.find((p) => p.pid === u.pid).botLevel];
    q.seats++; q.place += u.place || 1; if (u.id === s.winner) q.win++; if ((u.place || 1) <= 3) q.top3++;
  }
}
console.log(`mode=${mode} games=${N} done=${done} mix=${mix.join('/')}`);
for (const [l, q] of Object.entries(T)) console.log(`  ${l.padEnd(7)} seats=${q.seats} winShare=${pct(q.win, done).padStart(6)} (fair ${pct(q.seats / done, 8)})  avgPlace=${(q.place / q.seats).toFixed(2)}  top3=${pct(q.top3, q.seats)}`);

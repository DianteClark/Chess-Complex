import { createMatch, applyAction, planBot, planHollow, unitById, alivePlayers } from '../js/engine.js';
import { PRESETS, PIECES } from '../js/data.js';
for (const [mode, n] of [['royale', 8], ['blitz', 8], ['duel', 2], ['daily', 8]]) {
  const rounds = [], turns = []; let stalls = 0, kings = 0;
  for (let g = 0; g < 80; g++) {
    const ps = Object.values(PRESETS);
    const players = Array.from({ length: n }, (_, i) => { const p = ps[i % 4]; const eq = {}; for (const k of Object.keys(PIECES)) if (PIECES[k].equips.length) eq[k] = PIECES[k].equips[(g + i) % 3]; return { pid: 'p' + i, name: 'B' + i, isBot: true, build: { pts: p.pts, passive: p.passive, equips: eq } }; });
    const s = createMatch(players, 50 + g, { mode });
    let k = 0;
    while (!s.over && k++ < 30000) { const u = unitById(s, s.active); const plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u); for (const a of plan) { applyAction(s, u.pid, a); if (s.active !== u.id || s.over) break; } if (s.active === u.id && !s.over) applyAction(s, u.pid, { type: 'end' }); }
    if (!s.over) { stalls++; continue; }
    rounds.push(s.round); turns.push(s.turnNo); if (unitById(s, s.winner)?.piece === 'king') kings++;
    for (const u of s.units) if (u.alive) { const t = s.tiles[u.y * 16 + u.x].t; if (t === 'out' || t === 'wall') throw new Error('unit on ' + t); }
  }
  const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  console.log(mode, { stalls, avgRounds: avg(rounds), avgTurns: avg(turns), kingWins: kings });
}

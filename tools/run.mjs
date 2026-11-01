// Shared headless match runner for the balance tools.
import { createMatch, applyAction, planBot, planHollow, unitById, stats } from '../js/engine.js';
import { PRESETS, PIECES, PASSIVES } from '../js/data.js';

export const presets = Object.values(PRESETS);
export function mulberry(a) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Bot roster: presets in rotation, equips cycling through every option so new abilities get equal time.
export function roster(n, g, { randomize = false } = {}) {
  const r = mulberry(g * 7919 + 13);
  return Array.from({ length: n }, (_, i) => {
    const p = presets[i % presets.length];
    const equips = {}; for (const k of Object.keys(PIECES)) if (PIECES[k].equips.length) { const E = PIECES[k].equips; equips[k] = randomize ? E[Math.floor(r() * E.length)] : E[(i + g) % E.length]; }
    const pas = Object.keys(PASSIVES);
    const passive = randomize ? pas[Math.floor(r() * pas.length)] : p.passive;
    return { pid: 'p' + i, name: p.name + i, preset: p.name, isBot: true, botLevel: 'normal', build: { pts: p.pts, passive, equips } };
  });
}
export function play(players, seed, opts = {}, maxSteps = 40000) {
  const s = createMatch(players, seed, opts);
  let steps = 0;
  while (!s.over && steps < maxSteps) {
    const u = unitById(s, s.active);
    const plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    for (const a of plan) { applyAction(s, u.pid, a); steps++; if (s.active !== u.id || s.over) break; }
    if (s.active === u.id && !s.over) applyAction(s, u.pid, { type: 'end' });
    steps++;
    for (const v of s.units) if (v.alive && (Number.isNaN(v.hp) || v.hp > stats(v).maxHp + 1)) throw new Error('bad hp ' + v.name + ' ' + v.hp);
    for (const v of s.units) if (v.alive) { const t = s.tiles[v.y * 16 + v.x].t; if (t === 'out' || t === 'wall' || t === 'pit' || t === 'rubble' || t === 'crate' || t === 'chest') throw new Error(`unit ${v.name} on ${t} (mode ${s.mode}, seed ${seed})`); }
  }
  return s;
}
export const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
export const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '-');

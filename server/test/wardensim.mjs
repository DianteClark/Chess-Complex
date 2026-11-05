// 18.1 (L3): Warden Rating calibration. Plays bot-only Siege / Gauntlet runs for every party shape and skill level and
// dumps run facts (js/warden.js runFacts) as JSON lines, then prints score / rating distributions for the current
// WARDEN consts. Usage: node server/test/wardensim.mjs [games per config] [out.jsonl]   (or --eval in.jsonl)
import { readFileSync, writeFileSync } from 'node:fs';
import { roster } from '../../tools/run.mjs';
import { createMatch, applyAction, planBot, planHollow, unitById } from '../../js/engine.js';
import { runFacts, runScore, aggregate, WTIERS, wtierOf } from '../../js/warden.js';
const args = process.argv.slice(2);
const SHAPES = [ // humans, bot allies
  { h: 1, b: 0 }, { h: 1, b: 1 }, { h: 1, b: 3 }, { h: 2, b: 0 }, { h: 3, b: 0 }, { h: 4, b: 0 }, { h: 2, b: 2 },
];
// skill proxies for the 'human' seats: bot tiers, plus weaker players (an easy bot that passes some turns)
const LV = ['novice', 'casual', 'easy', 'normal', 'hard'];
const SKIP = { novice: 0.35, casual: 0.15 };
function play(players, seed, opts, skip) {
  const s = createMatch(players, seed, opts); let r = seed >>> 0, steps = 0;
  const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  while (!s.over && steps < 40000) {
    const u = unitById(s, s.active), turn = s.turnNo;
    if (u.kind !== 'hollow' && skip[u.pid] && rnd() < skip[u.pid]) { applyAction(s, u.pid, { type: 'end' }); steps++; continue; }
    const plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    for (const a of plan) { applyAction(s, u.pid, a); steps++; if (s.turnNo !== turn || s.over) break; }
    if (s.turnNo === turn && !s.over) applyAction(s, u.pid, { type: 'end' });
    steps++;
  }
  return s;
}
let rows = [];
if (args[0] === '--eval') rows = readFileSync(args[1], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
else {
  const G = +args[0] || 20, out = args[1] || '/tmp/l318/wsim.jsonl';
  let g = 0;
  for (const mode of ['siege', 'gauntlet']) for (const sh of SHAPES) for (const lv of LV) for (let k = 0; k < G; k++, g++) {
    const n = sh.h + sh.b, P = roster(n, g, { randomize: true });
    const skip = {}; P.forEach((p, i) => { p.botLevel = i < sh.h ? (SKIP[lv] ? 'easy' : lv) : 'normal'; if (i < sh.h && SKIP[lv]) skip[p.pid] = SKIP[lv]; });
    const s = play(P, 1000 + g, { mode }, skip);
    for (let i = 0; i < sh.h; i++) {
      const f = runFacts(s, P[i].pid); f.team.forEach((t, j) => { t.human = j < sh.h; });
      rows.push({ mode, h: sh.h, b: sh.b, lv, g, ...f });
    }
  }
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n'));
}
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : 0; };
const by = {};
for (const r of rows) { const k = `${r.mode} h${r.h}b${r.b} ${r.lv}`; (by[k] = by[k] || { s: [], w: 0, c: 0, n: 0 }); const sc = runScore(r).score; by[k].s.push(sc); by[k].w += r.won ? 1 : 0; by[k].c += r.cleared; by[k].n++; r.score = sc; }
console.log('config                     n  win%  waves  p25  p50  p75  p90');
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(26), String(v.n).padStart(3), String(Math.round(100 * v.w / v.n)).padStart(5), (v.c / v.n).toFixed(1).padStart(6), ...[0.25, 0.5, 0.75, 0.9].map((p) => String(q(v.s, p)).padStart(4)));
// ratings: a "player" = one skill level and a preferred mode/party mix, 30 runs drawn from that pool
const pool = (pred) => rows.filter(pred).map((r) => r.score);
let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const ratings = [];
for (const lv of LV) for (const mix of ['solo', 'duo', 'quad', 'bots', 'any']) for (const mode of ['siege', 'gauntlet', 'both']) {
  const P = pool((r) => r.lv === lv && (mode === 'both' || r.mode === mode) && (mix === 'solo' ? r.h === 1 && r.b === 0 : mix === 'duo' ? r.h === 2 : mix === 'quad' ? r.h === 4 : mix === 'bots' ? r.h === 1 && r.b > 0 : true));
  if (!P.length) continue;
  for (let p = 0; p < 6; p++) { const runs = Array.from({ length: 30 }, () => P[Math.floor(rnd() * P.length)]); ratings.push({ lv, mix, mode, r: aggregate(runs).r }); }
}
// population weights for the bands: real players are weaker than the bots, so the low skill proxies weigh more
const POP = { novice: 30, casual: 30, easy: 20, normal: 15, hard: 5 };
const R = ratings.flatMap((x) => Array(POP[x.lv]).fill(x.r));
console.log('\nrating percentiles (all sim players):', [0.1, 0.3, 0.5, 0.72, 0.9, 0.97].map((p) => `p${Math.round(p * 100)}=${Math.round(q(R, p))}`).join(' '));
for (const lv of LV) for (const mix of ['solo', 'duo', 'quad', 'bots']) { const a = ratings.filter((x) => x.lv === lv && x.mix === mix).map((x) => x.r); console.log(`  ${lv.padEnd(6)} ${mix.padEnd(5)} median ${Math.round(q(a, 0.5))}  tier ${wtierOf(q(a, 0.5)).name}`); }
const dist = {}; for (const x of R) { const t = wtierOf(x).name; dist[t] = (dist[t] || 0) + 1; }
console.log('tier spread:', WTIERS.map((t) => `${t.name} ${Math.round(100 * (dist[t.name] || 0) / R.length)}%`).join(', '));

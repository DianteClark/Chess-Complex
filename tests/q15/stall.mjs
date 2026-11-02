// Q 15.0: find bot Royale matches that do not finish (stall hunter). node tests/q15/stall.mjs [--n 100] [--mode royale] [--max 8000]
import * as E from '../../js/engine.js';
import * as D from '../../js/data.js';
const A = process.argv.slice(2); const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const N = +arg('n', 100), MODE = arg('mode', 'royale'), MAX = +arg('max', 8000), SEED0 = +arg('seed0', 90001), STEP = +arg('step', 7919), PS0 = +arg('ps0', 300);
function mulberry(a) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PO = Object.keys(D.PIECES).filter((k) => D.PIECES[k].equips && D.PIECES[k].equips.length);
function players(n, seed) { const r = mulberry(seed), out = []; for (let i = 0; i < n; i++) { const p = D.PRESETS.bruiser; const equips = {}; for (const pc of PO) equips[pc] = D.PIECES[pc].equips[Math.floor(r() * Math.min(2, D.PIECES[pc].equips.length))]; out.push({ pid: 'p' + i, name: 'P' + i, isBot: true, botLevel: 'normal', skin: 'ivory', build: { pts: { ...p.pts }, passive: p.passive, equips } }); } return out; }
let bad = 0;
for (let i = 0; i < N; i++) {
  const seed = SEED0 + i * STEP; const s = E.createMatch(players(8, PS0 + i), seed, { mode: MODE }); let st = 0;
  const hist = [];
  for (; st < MAX && !s.over; st++) { const u = E.unitById(s, s.active); const turn = s.turnNo; const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u); for (const a of plan) { if (s.over || s.turnNo !== turn) break; E.applyAction(s, u.pid, a); } if (!s.over && s.turnNo === turn) E.applyAction(s, u.pid, { type: 'end' }); if (st > MAX - 40) hist.push(`${u.name}/${u.piece} hp${Math.round(u.hp)} @${u.x},${u.y} plan=${JSON.stringify(plan).slice(0, 80)}`); }
  if (!s.over) { bad++; const ps = s.units.filter((u) => u.alive && u.kind === 'player'); console.log(`UNFINISHED i=${i} seed=${seed} ps0=${PS0 + i} round ${s.round} turnNo ${s.turnNo} loc ${s.location} storm ring ${s.storm.ring} alive ${ps.map((u) => `${u.name}/${u.piece} team${u.team} hp${Math.round(u.hp)}/${Math.round(E.stats(u).maxHp)} @${u.x},${u.y}${(u.status || []).map((q) => ' ' + q.k + q.t).join('')}`).join(' | ')} hollows ${s.units.filter((u) => u.alive && u.kind === 'hollow').length}`); console.log('  last turns: ' + hist.slice(-8).join('\n    ')); }
}
console.log(`stall: ${bad}/${N} ${MODE} matches unfinished after ${MAX} steps`);
process.exitCode = bad ? 1 : 0;

// 15.0 combat fuzzer (C): status-heavy builds, pawn line / Ascension / boss King, tampered online builds and actions,
// status + boss invariants after every action, and a replay determinism check. node tools/combatfuzz.mjs [matches] [seed]
import * as E from '../js/engine.js';
import { PIECES, PASSIVES, STATUS, MODES, SIZE } from '../js/data.js';
import { mulberry } from './run.mjs';

const N = +process.argv[2] || 40, SEED = +process.argv[3] || 1;
const pick = (r, a) => a[Math.floor(r() * a.length)];
const STP = ['kindle', 'venom', 'rime', 'aegis', 'adrenaline', 'ward', 'opportunist'];
const EQ = { pawn: ['firebrand', 'dart'], knight: ['hoarfrost', 'skirmish'], bishop: ['blessing', 'hex'], rook: ['scorch', 'concuss'], queen: ['frostNova', 'plague'] };
const BAD = ['__proto__', 'constructor', 'toString', '', null, 42, 'king', 'veteran', 'nova'];
function mkPlayers(r, n, humans) {
  return Array.from({ length: n }, (_, i) => {
    const equips = {}; for (const pc of Object.keys(EQ)) equips[pc] = r() < 0.75 ? pick(r, EQ[pc]) : r() < 0.5 ? pick(r, PIECES[pc].equips) : pick(r, BAD);
    if (r() < 0.1) equips.veteran = pick(r, BAD);
    const passive = r() < 0.8 ? pick(r, STP) : pick(r, Object.keys(PASSIVES));
    return { pid: 'p' + i, name: 'P' + i, isBot: i >= humans, botLevel: pick(r, ['easy', 'normal', 'hard']), build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive, equips } };
  });
}
const MAL = (r) => pick(r, [null, 7, 'end', {}, { type: 'ability', slot: 'eq', x: NaN, y: 0 }, { type: 'promote', to: 'champion' }, { type: 'promote', to: 'veteran' }, { type: 'promote', to: '__proto__' },
  { type: 'ability', slot: 'ult', x: -5, y: 3 }, { type: 'ability', slot: 'status' }, { type: 'move', x: 1e9, y: 2 }, { type: 'promote', to: 'hone', level: 9 }, { type: 'ability', slot: 'sig', x: '3', y: '4' }]);
function check(s, tag) {
  const bad = [];
  for (const u of s.units) {
    if (!u.alive) { if (u.status && u.status.length) bad.push(`${tag}: dead unit ${u.id} keeps status`); continue; }
    if (!Number.isFinite(u.hp) || u.hp <= 0 || u.hp > E.stats(u).maxHp + 0.001) bad.push(`${tag}: unit ${u.id} hp ${u.hp}/${E.stats(u).maxHp}`);
    if (!PIECES[u.piece] && u.kind === 'player') bad.push(`${tag}: unknown piece ${u.piece}`);
    const seen = new Set();
    for (const q of u.status || []) {
      if (!STATUS[q.k]) bad.push(`${tag}: unit ${u.id} unknown status ${q.k}`);
      if (seen.has(q.k)) bad.push(`${tag}: unit ${u.id} duplicate status ${q.k}`); seen.add(q.k);
      if (!Number.isInteger(q.t) || q.t < 1 || q.t > 9) bad.push(`${tag}: unit ${u.id} status ${q.k} t=${q.t}`);
      if (q.k === 'poison' && !(q.n >= 1 && q.n <= 3)) bad.push(`${tag}: poison stacks ${q.n}`);
      if (q.k === 'shield' && !(q.n > 0)) bad.push(`${tag}: empty shield kept ${q.n}`);
      if (q.k === 'exposed' && (u.piece !== 'king' || !(q.n >= 1 && q.n <= E.KING_T.exposeMax))) bad.push(`${tag}: exposed on ${u.piece} n=${q.n}`);
    }
    if (seen.has('freeze') && seen.has('stun')) bad.push(`${tag}: unit ${u.id} frozen and stunned`);
    if (seen.has('freeze') && seen.has('burn')) bad.push(`${tag}: unit ${u.id} frozen and burning`);
    if (!Number.isFinite(E.effSpd(u))) bad.push(`${tag}: spd ${E.effSpd(u)}`);
  }
  if (s.kingBoss) { const k = E.unitById(s, s.kingBoss.id); if (!k || !k.alive || k.piece !== 'king') bad.push(`${tag}: stale kingBoss ${s.kingBoss.id}`); else if (![0, 1, 2].includes(s.kingBoss.phase)) bad.push(`${tag}: phase ${s.kingBoss.phase}`); }
  if (s.crownWarn && (!E.inB(s.crownWarn.x, s.crownWarn.y) || s.crownSpawned)) bad.push(`${tag}: bad crownWarn ${JSON.stringify(s.crownWarn)}`);
  if (s._act) bad.push(`${tag}: action context leaked`);
  return bad;
}
const snap = (s) => { const o = JSON.parse(JSON.stringify(s, (k, v) => (k === '_guard' ? undefined : v))); delete o.aiSeed; return JSON.stringify(o); };
const modes = ['royale', 'blitz', 'duel', 'squads', 'hill', 'chaos', 'siege'].filter((m) => MODES[m]);
let fails = [], matches = 0, ev = {}, t0 = Date.now();
for (let i = 0; i < N; i++) {
  const mode = modes[i % modes.length], [lo, hi] = MODES[mode].players, n = MODES[mode].teams ? hi : Math.max(lo, Math.min(hi, 2 + (i % 7)));
  const r = mulberry(SEED * 977 + i), humans = i % 3, seed = SEED * 31 + i * 7919;
  const s = E.createMatch(mkPlayers(r, n, humans), seed, { mode }); const log = [];
  let steps = 0;
  const act = (pid, a) => { let res; try { res = E.applyAction(s, pid, a); } catch (e) { fails.push(`${mode} seed ${seed}: threw on ${JSON.stringify(a)}: ${e.stack.split('\n').slice(0, 2).join(' ')}`); return null; }
    log.push([pid, a]); for (const q of res.ev) ev[q.e + (q.k ? ':' + q.k : '')] = (ev[q.e + (q.k ? ':' + q.k : '')] || 0) + 1;
    const b = check(s, `${mode} seed ${seed} step ${steps}`); if (b.length) fails.push(...b.slice(0, 2)); steps++; return res; };
  while (!s.over && steps < 8000 && fails.length < 20) {
    const u = E.unitById(s, s.active), turn = s.turnNo;
    if (r() < 0.05) { act(pick(r, [u.pid, 'x']), MAL(r)); continue; }
    if (u.kind === 'player' && !u.bot && r() < 0.6) {
      const c = [{ type: 'end' }]; if (E.canMove(s, u)) for (const m of E.legalMoves(s, u)) c.push({ type: 'move', x: m.x, y: m.y });
      for (const sl of ['atk', 'sig', 'eq', 'ult']) if (E.canUse(s, u, sl)) for (const o of E.abilityOptions(s, u, sl)) c.push({ type: 'ability', slot: sl, x: o.anchor.x, y: o.anchor.y });
      for (const o of E.promoteOptions(u)) if (o.cost <= u.shards) c.push({ type: 'promote', to: o.to });
      act(u.pid, pick(r, c)); continue;
    }
    const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
    for (const a of plan) { if (s.over || s.turnNo !== turn) break; if (!act(u.pid, a)) break; }
    if (!s.over && s.turnNo === turn) act(u.pid, { type: 'end' });
  }
  matches++;
  if (!s.over) fails.push(`${mode} seed ${seed}: unfinished at round ${s.round}`);
  const s2 = E.createMatch(mkPlayers(mulberry(SEED * 977 + i), n, humans), seed, { mode });
  for (const [pid, a] of log) E.applyAction(s2, pid, a);
  if (snap(s2) !== snap(s)) fails.push(`${mode} seed ${seed}: replay diverged`);
}
console.log(`combat fuzz: ${matches} matches in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('events: ' + Object.entries(ev).filter(([k]) => /status|cleanse|resist|kingPhase|crownWarn|ascend|enrage|dmg/.test(k)).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(fails.length ? `FAILURES (${fails.length}):\n  ` + [...new Set(fails)].slice(0, 25).join('\n  ') : 'ALL COMBAT INVARIANTS HELD');
process.exitCode = fails.length ? 1 : 0;

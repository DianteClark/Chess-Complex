// Chess Complex engine fuzzer (A10, 10.0).
// Usage: node tests/fuzz/engine-fuzz.mjs [--matches 60] [--seed 1] [--max 6000] [--json out.json] [--mode royale]
// Plays seeded matches in every mode and player count with a mix of bot plans, random legal actions and malformed
// actions, and checks invariants after every action. Then replays the action log to check determinism.
import * as E from '../../js/engine.js';
import { PIECES, PRESETS, PASSIVES, MODES, SIZE, MUTATORS } from '../../js/data.js';
const MUTS = Object.keys(MUTATORS);
import fs from 'fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const N = +(args.matches || 60), SEED0 = +(args.seed || 1), MAXA = +(args.max || 6000);

function mulberry(a) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const PIECE_ORDER = Object.keys(PIECES).filter((k) => PIECES[k].equips);

function mkPlayers(r, n, humans) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = PRESETS[pick(r, Object.keys(PRESETS))];
    const equips = {}; for (const pc of PIECE_ORDER) equips[pc] = pick(r, PIECES[pc].equips);
    const passive = r() < 0.4 ? pick(r, Object.keys(PASSIVES)) : p.passive;
    out.push({ pid: 'p' + i, name: 'P' + i, isBot: i >= humans, botLevel: pick(r, ['easy', 'normal', 'hard']), skin: 'ivory', build: { pts: { ...p.pts }, passive, equips } });
  }
  return out;
}

const MALFORMED = (r, s) => {
  const x = Math.floor(r() * SIZE), y = Math.floor(r() * SIZE);
  return pick(r, [
    null, undefined, 42, 'end', [], {}, { type: 'move' }, { type: 'move', x: NaN, y: NaN }, { type: 'move', x: -1, y: 99 },
    { type: 'move', x: String(x), y: String(y) }, { type: 'move', x: x + 0.5, y }, { type: 'move', x: Infinity, y: -Infinity },
    { type: 'ability', slot: 'nope', x, y }, { type: 'ability', slot: '__proto__', x, y }, { type: 'ability', slot: 'constructor', x, y },
    { type: 'ability', slot: 'atk', x: 1e9, y: -1e9 }, { type: 'ability', slot: 'ult', x, y }, { type: 'ability', slot: 'sig' },
    { type: 'ability', slot: 'atk', x: null, y: undefined }, { type: 'promote', to: 'king' }, { type: 'promote', to: 'queen' },
    { type: 'promote', to: '__proto__' }, { type: 'promote', to: 'constructor' }, { type: 'promote', to: 'hollow' }, { type: 'promote' },
    { type: 'emote', k: 'x' }, { type: 'END' }, { type: 'toString' }, { type: 'move', x, y, __proto__: { type: 'end' } },
  ]);
};

function randomLegal(r, s, u) {
  const c = [];
  if (E.canMove(s, u)) for (const m of E.legalMoves(s, u)) c.push({ type: 'move', x: m.x, y: m.y });
  for (const slot of ['atk', 'sig', 'eq', 'ult']) if (E.canUse(s, u, slot)) for (const o of E.abilityOptions(s, u, slot)) c.push({ type: 'ability', slot, x: o.anchor.x, y: o.anchor.y });
  if (u.kind === 'player') for (const o of E.promoteOptions(u)) if (o.cost <= u.shards) c.push({ type: 'promote', to: o.to });
  c.push({ type: 'end' });
  return pick(r, c);
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
function invariants(s, tag) {
  const bad = [];
  const seen = new Map();
  for (const u of s.units) {
    if (!u.alive) { if (u.hp > 0 && u.kind === 'player') bad.push(`${tag}: dead unit ${u.id} has hp ${u.hp}`); continue; }
    if (!fin(u.hp) || u.hp <= 0) bad.push(`${tag}: alive unit ${u.id} (${u.kind}/${u.piece}) hp=${u.hp}`);
    const mx = E.stats(u).maxHp; if (!fin(mx) || u.hp > mx + 0.001) bad.push(`${tag}: unit ${u.id} hp ${u.hp} > max ${mx}`);
    if (!Number.isInteger(u.x) || !Number.isInteger(u.y) || !E.inB(u.x, u.y)) bad.push(`${tag}: unit ${u.id} out of bounds (${u.x},${u.y})`);
    else if (E.isSolid(s, u.x, u.y)) bad.push(`${tag}: unit ${u.id} (${u.piece}) standing on solid tile ${E.tileAt(s, u.x, u.y).t} at (${u.x},${u.y})`);
    const k = u.y * SIZE + u.x; if (seen.has(k)) bad.push(`${tag}: overlap units ${seen.get(k)} and ${u.id} at (${u.x},${u.y})`); seen.set(k, u.id);
    if (!fin(u.gauge)) bad.push(`${tag}: unit ${u.id} gauge ${u.gauge}`);
    if (u.kind === 'player') {
      if (!fin(u.shards) || u.shards < 0) bad.push(`${tag}: unit ${u.id} shards ${u.shards}`);
      if (!PIECES[u.piece]) bad.push(`${tag}: unit ${u.id} unknown piece ${u.piece}`);
      for (const k2 of ['atk', 'def', 'spd']) if (!fin(E.stats(u)[k2])) bad.push(`${tag}: unit ${u.id} stat ${k2}=${E.stats(u)[k2]}`);
      if (u.ult != null && (!fin(u.ult) || u.ult < 0)) bad.push(`${tag}: unit ${u.id} ult ${u.ult}`);
    }
  }
  for (const it of s.items) if (!E.inB(it.x, it.y) || !Number.isInteger(it.x)) bad.push(`${tag}: item ${it.k} out of bounds (${it.x},${it.y})`);
  if (!s.over) {
    const a = E.unitById(s, s.active);
    if (!a) bad.push(`${tag}: active ${s.active} does not exist`);
    else if (!a.alive) bad.push(`${tag}: active unit ${a.id} is dead`);
    if (!s.turn) bad.push(`${tag}: no turn object`);
    if (!s.siege && E.teamsAlive(s).size <= 1 && !s.tutorial) bad.push(`${tag}: ${E.teamsAlive(s).size} teams alive but match not over`);
  } else if (!s.siege && s.mode !== 'hill' && E.alivePlayers(s).length > 1 && E.teamsAlive(s).size > 1) bad.push(`${tag}: over with ${E.teamsAlive(s).size} teams alive`);
  if (s.over && s.winner != null && !E.unitById(s, s.winner)) bad.push(`${tag}: winner ${s.winner} does not exist`);
  if (!fin(s.round) || !fin(s.turnNo)) bad.push(`${tag}: round/turnNo not finite`);
  return bad;
}
const snap = (s) => JSON.stringify(s, (k, v) => (k === '_guard' ? undefined : typeof v === 'number' && !Number.isFinite(v) ? 'NF:' + v : v));

function play(cfg) {
  const { mode, n, humans, seed, fuzzSeed, mutator } = cfg;
  const r = mulberry(fuzzSeed);
  const players = mkPlayers(r, n, humans);
  const fails = [], log = [], evCounts = {};
  let s;
  try { s = E.createMatch(players, seed, { mode, mutator }); } catch (e) { return { fails: [`createMatch threw: ${e.stack.split('\n').slice(0, 3).join(' < ')}`], log, s: null }; }
  fails.push(...invariants(s, 'create'));
  let steps = 0, rejected = 0, malformedAccepted = 0, lastTurn = -1, sameTurnSteps = 0;
  const ACT = (pid, a, kind) => {
    const before = kind !== 'plan' ? snap(s) : null;
    let res;
    try { res = E.applyAction(s, pid, a); } catch (e) { fails.push(`step ${steps} applyAction threw on ${kind} ${JSON.stringify(a)} by ${pid}: ${e.message} @ ${(e.stack.split('\n')[1] || '').trim()}`); return { ok: false, threw: true }; }
    log.push([pid, a === undefined ? '__undef' : a]);
    if (!res.ok) { rejected++; if (before && snap(s) !== before) fails.push(`step ${steps} rejected ${kind} action ${JSON.stringify(a)} mutated state`); }
    else if (kind === 'malformed') { malformedAccepted++; if (typeof a !== 'object' || a == null || !['move', 'ability', 'promote', 'end'].includes(a.type)) fails.push(`step ${steps} malformed action accepted: ${JSON.stringify(a)}`); }
    for (const q of res.ev || []) { evCounts[q.e] = (evCounts[q.e] || 0) + 1; for (const [k, v] of Object.entries(q)) if (typeof v === 'number' && !Number.isFinite(v)) fails.push(`step ${steps} event ${q.e}.${k}=${v}`); }
    const inv = invariants(s, `step ${steps} after ${kind} ${JSON.stringify(a)}`); if (inv.length) fails.push(...inv.slice(0, 3));
    steps++;
    return res;
  };
  while (!s.over && steps < MAXA && fails.length < 12) {
    const u = E.unitById(s, s.active);
    if (!u) { fails.push(`step ${steps}: no active unit`); break; }
    if (s.turnNo === lastTurn) { if (++sameTurnSteps > 60) { fails.push(`step ${steps}: turn ${s.turnNo} stuck after 60 actions`); break; } } else { lastTurn = s.turnNo; sameTurnSteps = 0; }
    try { E.predictOrder(s, 8); } catch (e) { fails.push(`predictOrder threw: ${e.message}`); }
    const roll = r();
    if (roll < 0.06) { ACT(pick(r, [u.pid, 'nobody', undefined, players[0].pid]), MALFORMED(r, s), 'malformed'); continue; }
    if (roll < 0.09) { const other = s.units.find((w) => w.alive && w.pid && w.pid !== u.pid); if (other) { ACT(other.pid, randomLegal(r, s, u), 'wrongpid'); continue; } }
    const human = u.kind === 'player' && !u.bot;
    if (human || roll < 0.25) {
      const a = r() < 0.15 ? { type: 'end' } : randomLegal(r, s, u);
      ACT(u.pid, a, 'random');
    } else {
      let plan;
      try { plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u); } catch (e) { fails.push(`step ${steps} plan threw for ${u.kind}/${u.piece}: ${e.message} @ ${(e.stack.split('\n')[1] || '').trim()}`); ACT(u.pid, { type: 'end' }, 'plan'); continue; }
      const turn = s.turnNo;
      for (const a of plan) { if (s.over || s.turnNo !== turn) break; const res = ACT(u.pid, a, 'plan'); if (res.threw) break; }
      if (!s.over && s.turnNo === turn && s.active === u.id) ACT(u.pid, { type: 'end' }, 'plan');
    }
  }
  if (!s.over && fails.length < 12) fails.push(`did not terminate within ${MAXA} actions (round ${s.round}, turn ${s.turnNo}, alive ${E.alivePlayers(s).length}, siege wave ${s.siege ? s.siege.wave : '-'})`);
  // determinism: replay the log
  if (s.over || steps >= MAXA) {
    try {
      const s2 = E.createMatch(mkPlayers(mulberry(fuzzSeed), n, humans), seed, { mode, mutator });
      for (const [pid, a] of log) E.applyAction(s2, pid, a === '__undef' ? undefined : a);
      // aiSeed is planner RNG state: the replay applies logged actions without re-planning
      const strip = (x) => { const o = JSON.parse(snap(x)); delete o.aiSeed; return JSON.stringify(o); };
      if (strip(s2) !== strip(s)) {
        const A = JSON.parse(snap(s)), B = JSON.parse(snap(s2)); const diff = Object.keys(A).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
        fails.push(`replay of ${log.length} actions diverged in: ${diff.join(', ')}`);
      }
    } catch (e) { fails.push(`replay threw: ${e.message}`); }
  }
  return { fails, steps, rejected, malformedAccepted, rounds: s.round, over: s.over, winner: s.winner, evCounts, s };
}

// bot-only determinism: two independent runs with the same seed must produce the same final state
function botsOnly(mode, n, seed) {
  const run = () => {
    const s = E.createMatch(mkPlayers(mulberry(seed), n, 0), seed, { mode });
    for (let i = 0; i < MAXA && !s.over; i++) {
      const u = E.unitById(s, s.active); const turn = s.turnNo;
      const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
      for (const a of plan) { if (s.over || s.turnNo !== turn) break; E.applyAction(s, u.pid, a); }
      if (!s.over && s.turnNo === turn) E.applyAction(s, u.pid, { type: 'end' });
    }
    return s;
  };
  const a = run(), b = run();
  return { same: snap(a) === snap(b), over: a.over, round: a.round };
}

const modes = args.mode ? [args.mode] : Object.keys(MODES);
const cfgs = [];
let k = 0;
for (let i = 0; i < N; i++) for (const mode of modes) {
  const [lo, hi] = MODES[mode].players;
  let n = lo + (i % (hi - lo + 1));
  if (MODES[mode].teams && n % MODES[mode].teams) n++;
  if (n > hi) n = hi;
  const humans = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : Math.min(n, 2);
  // half the matches force each map mutator in turn, the rest let the engine pick
  cfgs.push({ mode, n, humans, mutator: i % 2 ? MUTS[(i >> 1) % MUTS.length] : undefined, seed: (SEED0 * 7919 + k * 104729) | 0, fuzzSeed: SEED0 * 31 + k++ });
}
const t0 = Date.now();
const report = { cfgs: cfgs.length, failures: [], perMode: {}, botsOnly: [], ms: 0 };
const uniq = new Map();
for (const c of cfgs) {
  const res = play(c);
  const pm = report.perMode[c.mode] = report.perMode[c.mode] || { matches: 0, failed: 0, steps: 0, rounds: [], unfinished: 0 };
  pm.matches++; pm.steps += res.steps || 0; pm.rounds.push(res.rounds); if (!res.over) pm.unfinished++;
  if (res.fails.length) {
    pm.failed++;
    for (const f of res.fails) { const key = c.mode + '|' + f.replace(/step \d+/g, 'step N').replace(/\d+/g, '#').slice(0, 140); if (!uniq.has(key)) uniq.set(key, { ...c, msg: f, count: 0 }); uniq.get(key).count++; }
  }
}
for (const mode of modes) for (let j = 0; j < 3; j++) { const [lo, hi] = MODES[mode].players; const n = MODES[mode].teams ? hi : Math.max(lo, hi - j); try { report.botsOnly.push({ mode, n, ...botsOnly(mode, n, 900 + j) }); } catch (e) { report.botsOnly.push({ mode, n, threw: e.message }); } }
report.failures = [...uniq.values()];
report.ms = Date.now() - t0;
for (const [m, pm] of Object.entries(report.perMode)) { pm.avgRounds = +(pm.rounds.reduce((a, b) => a + b, 0) / pm.rounds.length).toFixed(1); pm.maxRounds = Math.max(...pm.rounds); delete pm.rounds; }
console.log(`engine fuzz: ${cfgs.length} matches in ${(report.ms / 1000).toFixed(1)}s`);
for (const [m, pm] of Object.entries(report.perMode)) console.log(`  ${m.padEnd(7)} matches=${pm.matches} failed=${pm.failed} unfinished=${pm.unfinished} avgRounds=${pm.avgRounds} maxRounds=${pm.maxRounds} actions=${pm.steps}`);
const bo = report.botsOnly.filter((b) => !b.same || b.threw); console.log(`  bots-only determinism: ${report.botsOnly.length - bo.length}/${report.botsOnly.length} identical` + (bo.length ? ' FAIL ' + JSON.stringify(bo) : ''));
console.log(report.failures.length ? `FAILURES (${report.failures.length} unique):` : 'ALL INVARIANTS HELD');
for (const f of report.failures.slice(0, 40)) console.log(`  [${f.mode} n=${f.n} humans=${f.humans} mut=${f.mutator || '-'} seed=${f.seed} fuzz=${f.fuzzSeed} x${f.count}] ${f.msg.slice(0, 400)}`);
if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 1));
process.exitCode = report.failures.length || bo.length ? 1 : 0;

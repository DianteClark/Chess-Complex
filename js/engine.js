// Chess Complex — authoritative rules engine. Pure data in, events out.
import {
  SIZE, PIECES, ABILITIES, EVOLVE, EVOLVE_COST, MAX_HONE, honeCost, STAT_GAIN,
  PLAYER_COLORS, HOLLOW_STATS, ATTUNE, MODES, STEADFAST_ROUND, CALM_ROUNDS, TEAM_COLORS, MUTATORS, PASSIVES,
} from './data.js';
import { MODE_ALIAS } from './data.js'; // 15.0 (W)
import { STATUS, ASCEND, evolveCost, WORLD_EVENTS } from './data.js'; // 15.0 (C)
import { LOCATIONS, LOC_EVENTS, LOC_T, chooseLocation, sanitizeCustom, stormRules, eventWeights, weightedPick } from './locations.js'; // 15.0 (W)

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = DIRS8.slice(0, 4);
const DIAG = DIRS8.slice(4);
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const RING8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // 15.0: neighbours in clockwise order (Sweep arcs)

export const STORM = { firstCrack: 5, every: 3, maxRing: 7 };
export const CROWN_ROUND = 7;

// ---------- random ----------
export function rand(s) {
  let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (s, n) => Math.floor(rand(s) * n);

// ---------- helpers ----------
export const inB = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export const tileAt = (s, x, y) => (inB(x, y) ? s.tiles[y * SIZE + x] : null);
export const ringOf = (x, y) => Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
export const isVoid = (s, x, y) => ringOf(x, y) < s.storm.ring;
export const isCracked = (s, x, y) => s.storm.crack && ringOf(x, y) === s.storm.ring;
// 17.0 (C2): Sudden Death (board fully closed, s.storm.ring >= STORM.maxRing): share of max HP every piece burns at the
// start of its turn this round. 0 before Sudden Death. 6% plus 2% per round since it began (s.storm.sdAt).
export const SUDDEN = { base: 0.06, per: 0.02 };
export const suddenDeath = (s) => !!s.storm && s.storm.ring >= STORM.maxRing;
export const suddenDeathPct = (s) => (suddenDeath(s) ? SUDDEN.base + SUDDEN.per * Math.max(0, s.round - (s.storm.sdAt == null ? s.round : s.storm.sdAt)) : 0);
export const unitAt = (s, x, y) => s.units.find((u) => u.alive && u.x === x && u.y === y) || null;
export const unitById = (s, id) => s.units.find((u) => u.id === id) || null;
const SOLID = { wall: 1, rubble: 1, crate: 1, chest: 1, out: 1, pit: 1 };
// 10.0: hazard themes. A match has one (s.mutator) or, in Chaos, several (s.mutators).
export const HAZARDS = ['lava', 'ice', 'portals', 'geysers', 'conveyor', 'crumble', 'rift', 'poison']; // 15.0 (W): + bog poison pools
export const mutOn = (s, k) => s.mutator === k || !!(s.mutators && s.mutators.includes(k));
export const HILL = { x0: 6, y0: 6, x1: 9, y1: 9 };
export const onThrone = (s, x, y) => { const t = tileAt(s, x, y); return !!t && t.t === 'throne' && !isVoid(s, x, y); };
export const isSolid = (s, x, y) => { const t = tileAt(s, x, y); return !t || !!SOLID[t.t]; };
export const canStand = (s, x, y) => inB(x, y) && !isSolid(s, x, y) && !unitAt(s, x, y);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const alivePlayers = (s) => s.units.filter((u) => u.alive && u.kind === 'player');
// Teams (Squads, Siege). Royale players have no team, so nobody is an ally.
export const ally = (a, b) => !!(a && b && a !== b && a.team != null && a.team === b.team);
export const teamKey = (u) => (u.team != null ? 't' + u.team : 'u' + u.id);
export const teamsAlive = (s) => new Set(alivePlayers(s).map(teamKey));
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export function baseStats(u) {
  let b;
  if (u.piece === 'king') b = u.kingStats;
  else {
    const p = PIECES[u.piece];
    const m = 1 + 0.15 * (u.hone[u.piece] || 0);
    b = {
      hp: Math.round((p.hp + u.pts.hp * STAT_GAIN.hp) * m),
      atk: Math.round((p.atk + u.pts.atk * STAT_GAIN.atk) * m),
      def: Math.round((p.def + u.pts.def * STAT_GAIN.def) * m),
      spd: p.spd + u.pts.spd * STAT_GAIN.spd,
    };
  }
  return b;
}
export const attuneSpd = (u) => Math.floor((u.attune || 0) / ATTUNE.spdEvery);
export function stats(u) {
  if (u.kind === 'hollow') return { maxHp: u.hpMax || HOLLOW_STATS.hp, atk: u.atkB || HOLLOW_STATS.atk, def: u.dummy ? 2 : u.defB || HOLLOW_STATS.def, spd: (u.dummy ? 5 : u.spdB || HOLLOW_STATS.spd) + buffSum(u, 'spd') };
  const b = baseStats(u), a = u.attune || 0;
  const maxHp = Math.round(b.hp * (1 + ATTUNE.hp * a));
  let atkM = u.buffs.reduce((m, q) => (q.k === 'atk' ? m * q.v : m), 1);
  if (u.status && u.status.some((q) => q.k === 'enrage')) atkM *= KING_T.enrage; // 15.0 boss King phase enrage
  if (u.passive === 'laststand' && u.hp > 0 && u.hp < maxHp * 0.3) atkM *= 1.3;
  return {
    maxHp, atk: Math.round(b.atk * (1 + ATTUNE.atk * a) * atkM), def: Math.round(b.def * (1 + ATTUNE.def * a)),
    spd: b.spd + attuneSpd(u) + (u.momentum || 0) * 2 + buffSum(u, 'spd'),
  };
}
function buffSum(u, k) { let v = u.buffs.reduce((a, b) => a + (b.k === k ? b.v : 0), 0); if (k === 'spd' && u.status) for (const q of u.status) v += q.k === 'haste' ? 3 : q.k === 'slow' ? -3 : 0; return v; } // 15.0: haste and slow
function defMul(u) { let m = u.buffs.reduce((a, b) => (b.k === 'def' ? a * b.v : a), 1); const x = u.status && u.status.find((q) => q.k === 'exposed'); if (x) m *= Math.max(0.2, 1 - KING_T.expose * (x.n || 1)); return m; } // 15.0: Exposed King
// Diminishing returns past 12 so stacking SPD is not a free win.
export const effSpd = (u) => { const v = Math.max(3, stats(u).spd); return v <= 12 ? v : 12 + (v - 12) * 0.5; };
export const honed = (u) => (u.hone[u.piece] || 0) > 0;

// ---------- creation ----------
const SPAWNS = [[1, 1], [14, 14], [14, 1], [1, 14], [7, 1], [8, 14], [1, 8], [14, 7]];
const TEAM_SPAWNS = [[[1, 1], [3, 2]], [[14, 14], [12, 13]], [[14, 1], [13, 3]], [[1, 14], [2, 12]]];

export function createMatch(players, seed = (Math.random() * 2 ** 31) | 0, opts = {}) {
  opts = matchOpts(opts); // 15.0 (W): retired mode ids (mirror), validated Custom rules in opts.custom
  const modeId = MODES[opts.mode] ? opts.mode : 'royale', M = MODES[modeId];
  const s = {
    seed, v: 0, round: 1, roundTurns: 0, turnNo: 0, over: false, winner: null,
    tiles: [], units: [], items: [], storm: { ring: 0, crack: false }, event: null, meteors: [], bloodMoon: 0, lastEvent: null,
    active: null, turn: null, crownSpawned: false, log: [], nextId: 1, firstBlood: false,
    mode: modeId, rules: { first: M.storm.first, every: M.storm.every, crown: M.crown, events: M.events, turnMs: M.turnMs }, arena: M.arena || null,
    mutator: 'none', teams: M.teams || 0, siege: M.siege ? { wave: 0, waves: M.siege.waves, next: 2, since: 0, gauntlet: !!M.siege.gauntlet } : null, finalTwo: false,
    hill: M.hill ? { goal: M.hill.goal, alone: M.hill.alone || 2, contested: M.hill.contested ?? 1, score: {}, holder: null } : null, eclipse: 0, frenzy: 0, bounty: null,
  };
  locSetup(s, opts); // 15.0 (W): s.location, Custom storm speed
  // 10.0 Mirror Match: one random build, rolled from the seed, for everyone. 15.0 (W): Daily (build of the day) and Custom mirror builds
  if (M.mirror || opts.custom.mirror) {
    const pts = { hp: 0, atk: 0, def: 0, spd: 0 }, keys = Object.keys(pts);
    for (let i = 0; i < 10; i++) { let k = keys[ri(s, 4)]; if (pts[k] >= 5) k = keys.find((q) => pts[q] < 5); pts[k]++; }
    const pas = Object.keys(PASSIVES), equips = {};
    for (const pc of Object.keys(PIECES)) if (PIECES[pc].equips.length) equips[pc] = PIECES[pc].equips[ri(s, PIECES[pc].equips.length)];
    s.mirrorBuild = mirrorGiven(players, opts, modeId) || { pts, passive: pas[ri(s, pas.length)], equips };
    const B = s.mirrorBuild;
    players = players.map((p) => ({ ...p, build: { pts: { ...B.pts }, passive: B.passive, equips: { ...B.equips } } }));
  }
  for (let i = 0; i < SIZE * SIZE; i++) s.tiles.push({ t: 'floor' });
  const A = s.arena;
  const inArena = (x, y) => !A || (x >= A.x0 && x <= A.x1 && y >= A.y0 && y <= A.y1);
  if (A) { for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!inArena(x, y)) s.tiles[y * SIZE + x] = { t: 'out' }; s.storm.ring = A.x0; }
  const sc = A ? 0.4 : 0.5 + 0.5 * Math.min(8, players.length) / 8; // content scales with arena size and player count

  let spawnOrder = A ? [[A.x0 + 1, A.y0 + 1], [A.x1 - 1, A.y1 - 1]] : s.siege ? [[6, 6], [9, 9], [9, 6], [6, 9]] : SPAWNS.slice();
  if (s.siege && players.length > 4) spawnOrder.push([7, 5], [8, 10], [5, 8], [10, 7]); // spare co-op spawns (lists are only shuffled in place)
  for (let i = spawnOrder.length - 1; i > 0; i--) { const j = ri(s, i + 1); [spawnOrder[i], spawnOrder[j]] = [spawnOrder[j], spawnOrder[i]]; }
  if (s.teams) { const pairs = TEAM_SPAWNS.slice(); for (let i = pairs.length - 1; i > 0; i--) { const j = ri(s, i + 1); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; } spawnOrder = pairs.flat(); }
  const reserved = new Set();
  const reserve = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) reserved.add((y + dy) * SIZE + x + dx); };
  spawnOrder.forEach(([x, y]) => reserve(x, y, 1));
  reserve(7, 7, 1); reserve(8, 8, 1);
  const free = (x, y) => inB(x, y) && inArena(x, y) && !reserved.has(y * SIZE + x) && s.tiles[y * SIZE + x].t === 'floor';
  const randFree = (minRing = 1) => {
    for (let k = 0; k < 400; k++) { const x = ri(s, SIZE), y = ri(s, SIZE); if (ringOf(x, y) >= minRing + (A ? A.x0 : 0) && free(x, y) && !s.items.some((it) => it.x === x && it.y === y) && !s.units.some((u) => u.x === x && u.y === y)) return [x, y]; }
    return null;
  };
  const set = (x, y, t, extra = {}) => { s.tiles[y * SIZE + x] = { t, ...extra }; };

  // 10.0 King of the Hill: the Throne dais at the centre
  if (s.hill) for (let y = HILL.y0 - 1; y <= HILL.y1 + 1; y++) for (let x = HILL.x0 - 1; x <= HILL.x1 + 1; x++) { if (x >= HILL.x0 && x <= HILL.x1 && y >= HILL.y0 && y <= HILL.y1) set(x, y, 'throne'); reserved.add(y * SIZE + x); } // a clear apron around the dais
  // shrines in each quadrant
  (A ? [[A.x0 + 2, A.y1 - 2], [A.x1 - 2, A.y0 + 2]] : [[4, 4], [11, 4], [4, 11], [11, 11]]).forEach(([x, y]) => { set(x, y, 'shrine', { cd: 0 }); reserved.add(y * SIZE + x); });
  // wall clusters
  for (let c = 0; c < Math.round(11 * sc); c++) {
    const p = randFree(2); if (!p) continue;
    let [x, y] = p; const len = 2 + ri(s, 3); const d = ORTH[ri(s, 4)];
    for (let i = 0; i < len; i++) { if (free(x, y)) set(x, y, 'wall'); x += d[0]; y += d[1]; if (rand(s) < 0.3) { const t = ORTH[ri(s, 4)]; x += t[0]; y += t[1]; } }
  }
  for (let i = 0; i < Math.round(16 * sc); i++) { const p = randFree(1); if (p) set(p[0], p[1], 'rubble', { hp: 2 }); }
  for (let i = 0; i < Math.round(5 * sc); i++) {
    const p = randFree(1); if (!p) continue;
    let [x, y] = p;
    for (let k = 0; k < 4; k++) { if (free(x, y)) set(x, y, 'bramble'); const d = DIRS8[ri(s, 8)]; x += d[0]; y += d[1]; }
  }
  // 5.0 map mutators: one hazard theme per match
  // 15.0 (W): the hazard now comes from the location (locHazards); opts.mutator still forces a theme
  const mut = locHazards(s, M, opts, !!A);
  for (const hz of mut === 'chaos' ? s.mutators : [mut]) genHazard(hz);
  function genHazard(mut) {
  if (mut === 'lava' || mut === 'ice') {
    for (let c = 0; c < (mut === 'lava' ? 4 : 5); c++) {
      const p = randFree(2); if (!p) continue;
      let [x, y] = p;
      for (let k = 0; k < (mut === 'lava' ? 4 : 6); k++) { if (free(x, y)) set(x, y, mut); const d = ORTH[ri(s, 4)]; x += d[0]; y += d[1]; }
    }
  } else if (mut === 'portals') {
    for (let k = 0, made = 0; k < 40 && made < 2; k++) {
      const p = randFree(2); if (!p) break;
      const [x, y] = p, mx = SIZE - 1 - x, my = SIZE - 1 - y;
      if (Math.abs(mx - x) + Math.abs(my - y) < 6 || !free(mx, my)) continue;
      set(x, y, 'portal', { pair: made }); set(mx, my, 'portal', { pair: made }); reserved.add(y * SIZE + x); reserved.add(my * SIZE + mx); made++;
    }
  } else if (mut === 'geysers') {
    for (let k = 0, made = 0; k < 60 && made < 6; k++) { const p = randFree(2); if (!p) break; if (DIRS8.some(([dx, dy]) => tileAt(s, p[0] + dx, p[1] + dy) && tileAt(s, p[0] + dx, p[1] + dy).t === 'geyser')) continue; set(p[0], p[1], 'geyser', { ph: made % 3 }); reserved.add(p[1] * SIZE + p[0]); made++; }
  } else if (mut === 'conveyor') {
    for (let k = 0, made = 0; k < 60 && made < 3; k++) {
      const p = randFree(2); if (!p) break;
      const [dx, dy] = ORTH[ri(s, 4)]; const line = [];
      for (let i = 0; i < 5; i++) { const x = p[0] + dx * i, y = p[1] + dy * i; if (!free(x, y) || ringOf(x, y) < 1) break; line.push([x, y]); }
      if (line.length < 4) continue;
      for (const [x, y] of line) { set(x, y, 'conveyor', { dx, dy }); reserved.add(y * SIZE + x); }
      made++;
    }
  } else if (mut === 'crumble') {
    for (let c = 0; c < 6; c++) {
      const p = randFree(2); if (!p) continue;
      let [x, y] = p;
      for (let k = 0; k < 4; k++) { if (free(x, y)) set(x, y, 'crumble', { hp: 2 }); const d = ORTH[ri(s, 4)]; x += d[0]; y += d[1]; }
    }
  } else if (mut === 'poison' || mut === 'brambles') { // 15.0 (W): Witchwood Bog pools; Royal Gardens hedges
    const P = mut === 'poison';
    for (let c = 0; c < (P ? 5 : 6); c++) {
      const p = randFree(2); if (!p) continue;
      let [x, y] = p;
      for (let k = 0; k < (P ? 4 : 5); k++) { if (free(x, y)) set(x, y, P ? 'poison' : 'bramble'); const d = (P ? ORTH : DIRS8)[ri(s, P ? 4 : 8)]; x += d[0]; y += d[1]; }
    }
  } else if (mut === 'cogs') spireCogsGen(s, free, set, reserved, randFree); // 16.0 (L) spire
  }
  for (let i = 0; i < Math.round(20 * sc); i++) { const p = randFree(1); if (p) set(p[0], p[1], 'crate', { hp: 1 }); }
  for (let i = 0; i < Math.round(12 * sc); i++) { const p = randFree(1); if (p) s.items.push({ x: p[0], y: p[1], k: 'shard', n: 1 }); }

  players.forEach((p, i) => {
    const [x, y] = spawnOrder[i] || randFree(1) || [7, 7];
    const u = {
      id: s.nextId++, pid: p.pid, name: p.name, bot: !!p.isBot, kind: 'player', slot: i,
      team: s.teams ? Math.floor(i / s.teams) : s.siege ? 0 : null,
      color: s.teams ? TEAM_COLORS[Math.floor(i / s.teams) % TEAM_COLORS.length] : PLAYER_COLORS[i % PLAYER_COLORS.length], skin: p.skin || 'ivory', finisher: p.finisher || 'shatter', trail: p.trail || 'none', title: String(p.title || '').slice(0, 24),
      piece: 'pawn', hone: {}, pts: { ...p.build.pts }, passive: p.build.passive, equips: { ...p.build.equips },
      x, y, hp: 1, gauge: 0, shards: 0, cd: { sig: 0, eq: 0 }, buffs: [], status: [],
      alive: true, kills: 0, momentum: 0, mark: null, place: 0, dmgDealt: 0, attune: 0, ult: 0, ults: 0, botLevel: p.botLevel || 'normal', pref: rand(s) < 0.5 ? 'knight' : 'bishop',
      plan: botPlan(rand(s)), // 15.0 (C): the bot's promotion road (queen, rook, ascend, pawn line)
    };
    u.hp = stats(u).maxHp; u.shards = M.startShards || 0;
    s.units.push(u);
  });

  // Hollows guard shard caches
  // a starter shard two tiles from every spawn
  for (const u of s.units) {
    const c = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2 && free(u.x + dx, u.y + dy) && !s.items.some((it) => it.x === u.x + dx && it.y === u.y + dy)) c.push([u.x + dx, u.y + dy]);
    if (c.length) { const [x, y] = c[ri(s, c.length)]; s.items.push({ x, y, k: 'shard', n: 1 }); }
  }
  for (let i = 0; i < (A ? 2 : s.siege ? 0 : Math.round(6 * sc)); i++) {
    const p = randFree(A ? 2 : 3); if (!p) continue;
    const [x, y] = p;
    const h = {
      id: s.nextId++, kind: 'hollow', name: 'Hollow', piece: 'hollow', x, y, hx: x, hy: y, hp: HOLLOW_STATS.hp,
      gauge: 0, shards: 2, cd: { sig: 0, eq: 0 }, buffs: [], status: [], alive: true, hone: {}, color: '#7c7a99', skin: 'hollow',
    };
    s.units.push(h);
    const around = DIRS8.map(([dx, dy]) => [x + dx, y + dy]).filter(([ax, ay]) => free(ax, ay) && !s.items.some((it) => it.x === ax && it.y === ay));
    if (around.length) { const [ax, ay] = around[ri(s, around.length)]; s.items.push({ x: ax, y: ay, k: 'shard', n: 1 }); }
  }

  const ev = [];
  nextTurn(s, ev);
  return s;
}

// ---------- tutorial arena ----------
export const ARENA = { x0: 4, y0: 5, x1: 11, y1: 11 };
export function createTutorial(player) {
  const s = createMatch([player], 7, { mutator: 'none', location: 'gardens' });
  s.tutorial = true; s.units = s.units.filter((u) => u.kind === 'player'); s.items = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const inside = x >= ARENA.x0 && x <= ARENA.x1 && y >= ARENA.y0 && y <= ARENA.y1;
    s.tiles[y * SIZE + x] = { t: inside ? 'floor' : 'out' };
  }
  const me = s.units[0]; me.x = 5; me.y = 9; me.gauge = 100;
  s.active = me.id; me.rt = s.round; s.turn = { moved: false, acted: false, extraMoves: 0, rooted: false };
  return s;
}
export function spawnDummy(s, x, y, hp = 40) {
  const old = unitAt(s, x, y); if (old) return old;
  if (tileAt(s, x, y)) s.tiles[y * SIZE + x] = { t: 'floor' };
  const d = { id: s.nextId++, kind: 'hollow', dummy: true, name: 'Dummy', piece: 'hollow', x, y, hx: x, hy: y, hp, hpMax: hp, gauge: 0, shards: 0, cd: { sig: 0, eq: 0 }, buffs: [], status: [], alive: true, hone: {}, color: '#7c7a99', skin: 'hollow' };
  s.units.push(d);
  return d;
}

// ---------- movement ----------
export function legalMoves(s, u) {
  const out = [];
  const add = (x, y, jump) => out.push({ x, y, jump: !!jump });
  const slide = (dirs, max) => {
    for (const [dx, dy] of dirs) {
      for (let i = 1; i <= max; i++) {
        const x = u.x + dx * i, y = u.y + dy * i;
        if (!canStand(s, x, y)) break;
        add(x, y);
        if (tileAt(s, x, y).t === 'bramble') break; // brambles catch sliding pieces
      }
    }
  };
  switch (u.piece) {
    case 'knight': for (const [dx, dy] of KNIGHT) if (canStand(s, u.x + dx, u.y + dy)) add(u.x + dx, u.y + dy, true); break;
    case 'bishop': // 17.0 (C2): Sidestep. Diagonals up to 4, or 1 tile straight, so a Bishop is no longer locked to one tile colour
      slide(DIAG, 4);
      for (const [dx, dy] of ORTH) if (canStand(s, u.x + dx, u.y + dy)) out.push({ x: u.x + dx, y: u.y + dy, jump: false, side: true });
      break;
    case 'rook': slide(ORTH, 4); break;
    case 'queen': slide(DIRS8, 5); break;
    default: for (const [dx, dy] of DIRS8) if (canStand(s, u.x + dx, u.y + dy)) add(u.x + dx, u.y + dy); // pawn, king, hollow
  }
  return out;
}

export function canMove(s, u) { return s.turn && s.active === u.id && (!s.turn.moved || s.turn.extraMoves > 0) && !s.turn.rooted; }
export function canAct(s, u) { return s.turn && s.active === u.id && !s.turn.acted; }
export function canUse(s, u, slot) {
  if (!s.turn || s.active !== u.id) return false;
  const id = slotAbility(u, slot); if (!id) return false;
  if (s.turn.stunned) return false; // 15.0: a stunned piece cannot act at all this turn (free actions included)
  if (slot === 'ult') return (u.ult || 0) >= 100 && !s.turn.acted;
  if (slot !== 'atk' && u.cd[slot] > 0) return false;
  return ABILITIES[id].free ? true : !s.turn.acted;
}
// 15.0 (C): bot promotion roads, rolled once per player at match start
export const BOT_PLANS = { queen: 0.32, rook: 0.18, ascend: 0.28, pawn: 0.22 };
function botPlan(r) { let a = 0; for (const [k, w] of Object.entries(BOT_PLANS)) { a += w; if (r < a) return k; } return 'queen'; }

// ---------- abilities ----------
export function slotAbility(u, slot) {
  if (u.kind === 'hollow') {
    if (u.role === 'regent') return slot === 'atk' ? 'soulLance' : slot === 'sig' ? 'wraithStep' : null;
    if (slot !== 'atk') return null;
    return u.role === 'caster' ? 'hexBolt' : u.boss ? 'colossusSlam' : 'hollowClaw';
  }
  if (slot === 'atk') return PIECES[u.piece].attack;
  if (slot === 'sig') return PIECES[u.piece].sig;
  if (slot === 'eq') { if (u.piece === 'king') return null; const pc = PIECES[u.piece].equipFrom || u.piece, L = PIECES[pc].equips, e = u.equips && u.equips[pc]; return L.includes(e) ? e : L[0] || null; } // pawn line keeps the Pawn's equip
  if (slot === 'ult') return PIECES[u.piece].ult;
  return null;
}
export function abilityCd(u, id) {
  const base = ABILITIES[id].cd;
  if ((id === 'vault' || id === 'transpose' || id === 'decree' || id === 'heroicLeap') && honed(u)) return base - 1;
  return base;
}

const pt = (x, y) => ({ x, y });
function hitsOn(s, u, tiles) { const ids = []; for (const t of tiles) { const v = unitAt(s, t.x, t.y); if (v && v !== u) ids.push(v.id); } return ids; }
function lineTiles(s, u, dx, dy, max, { stopAtUnit = false } = {}) {
  const tiles = [];
  for (let i = 1; i <= max; i++) {
    const x = u.x + dx * i, y = u.y + dy * i;
    if (!inB(x, y)) break;
    tiles.push(pt(x, y));
    if (isSolid(s, x, y)) break;
    if (stopAtUnit && unitAt(s, x, y)) break;
  }
  return tiles;
}
function tShape(u, dx, dy) {
  const px = dy !== 0 ? 1 : 0, py = dx !== 0 ? 1 : 0;
  const sx = u.x + dx, sy = u.y + dy, bx = u.x + dx * 2, by = u.y + dy * 2;
  return [pt(sx, sy), pt(bx - px, by - py), pt(bx, by), pt(bx + px, by + py)].filter((t) => inB(t.x, t.y));
}
const around8 = (x, y) => DIRS8.map(([dx, dy]) => pt(x + dx, y + dy)).filter((t) => inB(t.x, t.y));

// Each option: { anchor, tiles, hits, mult, kind, util, data }
export function abilityOptions(s, u, slot) {
  const id = slotAbility(u, slot);
  if (!id) return [];
  const o = [];
  const opt = (anchor, tiles, mult, extra = {}) => o.push({ anchor, tiles, mult, hits: mult > 0 ? hitsOn(s, u, tiles) : [], ...extra });
  const self = pt(u.x, u.y);
  // 15.0: leap to (x, y) and hit tiles around the landing (never the tile the piece leaves)
  // 17.0 (A0): one occupancy lookup per call instead of a unit scan per tile (Valor builds ~48 anchors x 24 tiles)
  let occ = null; const occAt = (x, y) => { if (!occ) { occ = new Map(); for (const v of s.units) if (v.alive && !occ.has(v.y * 16 + v.x)) occ.set(v.y * 16 + v.x, v); } return occ.get(y * 16 + x) || null; };
  const leapOpt = (x, y, tiles, mult) => { const tl = tiles.filter((t) => !(t.x === u.x && t.y === u.y)); o.push({ anchor: pt(x, y), tiles: tl, mult, hits: tl.map((t) => occAt(t.x, t.y)).filter((v) => v && v !== u).map((v) => v.id), kind: 'leap', data: { x, y } }); };
  switch (id) {
    case 'pawnStrike': for (const [dx, dy] of DIAG) if (inB(u.x + dx, u.y + dy)) opt(pt(u.x + dx, u.y + dy), [pt(u.x + dx, u.y + dy)], 1.0); break;
    case 'hollowClaw':
    case 'royalStrike': for (const t of around8(u.x, u.y)) opt(t, [t], id === 'royalStrike' ? 1.4 : 1.0); break;
    case 'tstrike': case 'stagger':
      for (const [dx, dy] of ORTH) { let tl = tShape(u, dx, dy); if (tl.length && isSolid(s, tl[0].x, tl[0].y)) tl = tl.slice(0, 1); if (tl.length) opt(tl[0], tl, id === 'stagger' ? 0.9 : 1.0); } break;
    case 'ray': for (const [dx, dy] of DIAG) { const tl = lineTiles(s, u, dx, dy, 3); if (tl.length) opt(tl[0], tl, 1.0); } break;
    case 'slam':
      for (const [dx, dy] of ORTH) {
        const cx = u.x + dx, cy = u.y + dy, px = dy !== 0 ? 1 : 0, py = dx !== 0 ? 1 : 0;
        const tl = [pt(cx - px, cy - py), pt(cx, cy), pt(cx + px, cy + py)].filter((t) => inB(t.x, t.y));
        if (inB(cx, cy)) opt(pt(cx, cy), tl, 1.1);
      } break;
    case 'starburst': opt(self, around8(u.x, u.y), 1.0); break;
    case 'cross': { const tl = []; for (const [dx, dy] of DIAG) tl.push(...lineTiles(s, u, dx, dy, 2)); opt(self, tl, 0.9); break; }
    case 'checkmate': { const tl = []; for (const [dx, dy] of DIRS8) tl.push(...lineTiles(s, u, dx, dy, 3)); opt(self, tl, 0.7); break; }
    case 'shove':
      for (const t of around8(u.x, u.y)) { const v = unitAt(s, t.x, t.y); if (v) opt(t, [t], 0.5, { kind: 'shove' }); } break;
    case 'pickpocket':
      for (const t of around8(u.x, u.y)) { const v = unitAt(s, t.x, t.y); if (v) opt(t, [t], 0.8, { util: v.shards > 0 ? 8 : 0 }); } break;
    case 'vault': case 'sprint': opt(self, [self], 0, { kind: 'extraMove', util: 3 }); break;
    case 'digin': opt(self, [self], 0, { kind: 'buff', util: 4 }); break;
    case 'fortify': opt(self, [self], 0, { kind: 'buff', util: 5 }); break;
    case 'rally': opt(self, [self], 0, { kind: 'buff', util: 6 }); break;
    case 'royalGuard': opt(self, [self], 0, { kind: 'buff', util: 6 + (1 - u.hp / stats(u).maxHp) * 30 }); break;
    case 'sanctuary': opt(self, [self], 0, { kind: 'heal', util: (1 - u.hp / stats(u).maxHp) * 45 }); break;
    case 'trample':
      for (const [dx, dy] of KNIGHT) {
        const x = u.x + dx, y = u.y + dy;
        if (canStand(s, x, y)) { const tl = around8(x, y).filter((t) => !(t.x === u.x && t.y === u.y)); o.push({ anchor: pt(x, y), tiles: tl, mult: 0.75, hits: tl.map((t) => unitAt(s, t.x, t.y)).filter((v) => v && v !== u).map((v) => v.id), kind: 'leap', data: { x, y } }); }
      } break;
    case 'transpose': {
      const range = honed(u) ? 8 : 6;
      for (const [dx, dy] of DIAG) {
        for (let i = 1; i <= range; i++) {
          const x = u.x + dx * i, y = u.y + dy * i;
          if (!inB(x, y) || isSolid(s, x, y)) break;
          const v = unitAt(s, x, y);
          if (v) { opt(pt(x, y), [pt(x, y)], 0, { kind: 'swap', data: { id: v.id }, util: 2 }); break; }
        }
      } break;
    }
    case 'charge': {
      for (const [dx, dy] of ORTH) {
        const path = []; let hit = null; let end = null;
        for (let i = 1; i <= 5; i++) {
          const x = u.x + dx * i, y = u.y + dy * i;
          if (!inB(x, y)) break;
          const v = unitAt(s, x, y);
          if (v) { hit = v; path.push(pt(x, y)); break; }
          if (isSolid(s, x, y)) { path.push(pt(x, y)); break; }
          path.push(pt(x, y)); end = pt(x, y);
        }
        if (!path.length) continue;
        o.push({ anchor: path[path.length - 1], tiles: path, mult: honed(u) ? 1.6 : 1.3, hits: hit ? [hit.id] : [], kind: 'charge', data: { dx, dy } });
      } break;
    }
    case 'decree': {
      for (const [dx, dy] of DIRS8) {
        let last = null; const path = [];
        for (let i = 1; i <= 5; i++) {
          const x = u.x + dx * i, y = u.y + dy * i;
          if (!inB(x, y) || isSolid(s, x, y)) break;
          path.push(pt(x, y));
          if (!unitAt(s, x, y)) last = i;
        }
        if (last) {
          const tl = path.slice(0, last);
          o.push({ anchor: tl[tl.length - 1], tiles: tl, mult: honed(u) ? 1.2 : 1.0, hits: hitsOn(s, u, tl), kind: 'dash', data: { x: tl[tl.length - 1].x, y: tl[tl.length - 1].y } });
        }
      } break;
    }
    case 'blink':
      if (!u.mark) opt(self, [self], 0, { kind: 'mark', util: 1 });
      else if (canStand(s, u.mark.x, u.mark.y)) opt(pt(u.mark.x, u.mark.y), [pt(u.mark.x, u.mark.y)], 0, { kind: 'teleport', util: 2 });
      break;
    case 'rampart':
      for (const [dx, dy] of ORTH) { const x = u.x + dx, y = u.y + dy; if (canStand(s, x, y) && tileAt(s, x, y).t === 'floor' && !isVoid(s, x, y)) opt(pt(x, y), [pt(x, y)], 0, { kind: 'wall', util: 2 }); } break;
    case 'siege':
      for (const [dx, dy] of ORTH) { const tl = lineTiles(s, u, dx, dy, 6, { stopAtUnit: true }); if (tl.length) opt(tl[tl.length - 1], tl, 1.2, { kind: 'shot' }); } break;
    case 'dominion': {
      const tl = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && inB(u.x + dx, u.y + dy)) tl.push(pt(u.x + dx, u.y + dy));
      opt(self, tl, 0.3, { kind: 'dominion' }); break;
    }
    case 'enPassant':
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = u.x + dx, y = u.y + dy;
        if ((dx || dy) && canStand(s, x, y)) { const tl = around8(x, y).filter((t) => !(t.x === u.x && t.y === u.y)); o.push({ anchor: pt(x, y), tiles: tl, mult: 1.3, hits: tl.map((t) => unitAt(s, t.x, t.y)).filter((v) => v && v !== u).map((v) => v.id), kind: 'leap', data: { x, y } }); }
      } break;
    case 'fork':
      for (const [dx, dy] of KNIGHT) {
        const x = u.x + dx, y = u.y + dy;
        if (!canStand(s, x, y)) continue;
        const tl = KNIGHT.map(([a, b]) => pt(x + a, y + b)).filter((t) => inB(t.x, t.y) && !(t.x === u.x && t.y === u.y));
        o.push({ anchor: pt(x, y), tiles: tl, mult: 1.7, hits: tl.map((t) => unitAt(s, t.x, t.y)).filter((v) => v && v !== u).map((v) => v.id), kind: 'leap', data: { x, y } });
      } break;
    case 'excommunicate': { const tl = []; for (const [dx, dy] of DIAG) tl.push(...lineTiles(s, u, dx, dy, 15)); opt(self, tl, 1.4); break; }
    case 'nova': { const tl = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && inB(u.x + dx, u.y + dy)) tl.push(pt(u.x + dx, u.y + dy)); opt(self, tl, 1.6); break; }
    case 'divineRight': opt(self, around8(u.x, u.y), 1.2, { util: (1 - u.hp / stats(u).maxHp) * 50 }); break;
    case 'castling':
      for (const [dx, dy] of ORTH) {
        for (let i = 1; i <= 8; i++) {
          const x = u.x + dx * i, y = u.y + dy * i;
          if (!inB(x, y) || isSolid(s, x, y)) break;
          const v = unitAt(s, x, y);
          if (v) { const tl = around8(x, y).filter((t) => !(t.x === u.x && t.y === u.y)); o.push({ anchor: pt(x, y), tiles: tl, mult: 1.4, hits: tl.map((t) => unitAt(s, t.x, t.y)).filter((w) => w && w !== u).map((w) => w.id).concat(i === 1 ? [v.id] : []), kind: 'swap', data: { id: v.id } }); break; }
        }
      } break;
    case 'execute':
      for (const v of s.units) if (v.alive && v !== u && !ally(u, v) && cheb(u, v) <= 2) opt(pt(v.x, v.y), [pt(v.x, v.y)], v.hp / stats(v).maxHp < 0.3 ? 2.5 : 1.0); break;
    case 'tripwire':
      for (const t of around8(u.x, u.y)) if (canStand(s, t.x, t.y) && !isVoid(s, t.x, t.y) && !isCracked(s, t.x, t.y) && !s.items.some((i) => i.x === t.x && i.y === t.y)) opt(t, [t], 0, { kind: 'trap', util: 3 });
      break;
    case 'lance':
      for (const [dx, dy] of ORTH) { const tl = lineTiles(s, u, dx, dy, 2); if (tl.length) opt(tl[0], tl, 1.25, { data: { dx, dy } }); } break;
    case 'penance':
      for (const [dx, dy] of DIAG) {
        const tl = lineTiles(s, u, dx, dy, 4, { stopAtUnit: true }); const last = tl[tl.length - 1];
        const v = last && unitAt(s, last.x, last.y);
        if (v && !ally(u, v)) opt(last, [last], 1.0, { kind: 'shot', util: (1 - u.hp / stats(u).maxHp) * 10 });
      } break;
    case 'quake': { const tl = []; for (const [dx, dy] of ORTH) tl.push(...lineTiles(s, u, dx, dy, 2)); opt(self, tl, 0.8); break; }
    case 'gambit': if (u.hp > stats(u).maxHp * 0.35) opt(self, [self], 0, { kind: 'buff', util: 5 }); break;
    case 'colossusSlam': { const tl = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inB(u.x + dx, u.y + dy)) tl.push(pt(u.x + dx, u.y + dy)); opt(self, tl, 1.25); break; }
    // ---- 10.0 equips ----
    case 'phalanx': opt(self, ORTH.map(([dx, dy]) => pt(u.x + dx, u.y + dy)).filter((t) => inB(t.x, t.y)), 0.8); break;
    case 'outflank': for (const [dx, dy] of KNIGHT) { const t = pt(u.x + dx, u.y + dy); if (inB(t.x, t.y)) opt(t, [t], 1.15); } break;
    case 'consecrate':
      for (const [dx, dy] of DIAG) for (let i = 1; i <= 3; i++) {
        const x = u.x + dx * i, y = u.y + dy * i;
        if (!inB(x, y) || isSolid(s, x, y)) break;
        if (i >= 2) { const tl = [pt(x, y), ...around8(x, y)].filter((t) => !(t.x === u.x && t.y === u.y)); opt(pt(x, y), tl, 0.8); }
      } break;
    case 'repel': opt(self, around8(u.x, u.y), 0.6, { kind: 'repel' }); break;
    case 'bombard':
      for (const [dx, dy] of ORTH) { const x = u.x + dx * 3, y = u.y + dy * 3; if (inB(x, y)) opt(pt(x, y), [pt(x, y), ...ORTH.map(([a, b]) => pt(x + a, y + b))].filter((t) => inB(t.x, t.y)), 0.8); } break;
    case 'gravity': {
      const ring = around8(u.x, u.y);
      const pulled = s.units.filter((v) => v.alive && v !== u && !ally(u, v) && cheb(u, v) <= 2).map((v) => v.id);
      o.push({ anchor: self, tiles: ring, mult: 0.7, hits: pulled, kind: 'pull' }); break;
    }
    // ---- 15.0 (C) status equips and the pawn line ----
    case 'firebrand': case 'skirmish': case 'halberd':
      for (const t of around8(u.x, u.y)) opt(t, [t], id === 'firebrand' ? 0.85 : id === 'skirmish' ? 0.95 : 1.1, id === 'skirmish' ? { util: hasSt(u, 'haste') ? 0 : 3 } : {}); break;
    case 'dart': case 'hex':
      for (const [dx, dy] of id === 'dart' ? DIRS8 : DIAG) {
        const tl = lineTiles(s, u, dx, dy, id === 'dart' ? 4 : 5, { stopAtUnit: true }); const last = tl[tl.length - 1];
        const v = last && unitAt(s, last.x, last.y);
        if (v && v !== u && !ally(u, v)) opt(last, tl, id === 'dart' ? 0.55 : 0.6, { kind: 'shot' });
      } break;
    case 'hoarfrost':
      for (const [dx, dy] of KNIGHT) { const x = u.x + dx, y = u.y + dy; if (canStand(s, x, y)) leapOpt(x, y, around8(x, y), 0.5); } break;
    case 'blessing': opt(self, [self], 0, { kind: 'buff', util: 2 + (1 - u.hp / stats(u).maxHp) * 30 + (harmed(u) ? 12 : 0) - (hasSt(u, 'shield') ? 8 : 0) }); break;
    case 'shieldWall': {
      const adj = s.units.filter((v) => v.alive && v !== u && !ally(u, v) && cheb(u, v) === 1).length;
      opt(self, around8(u.x, u.y), 0, { kind: 'buff', util: 2 + (1 - u.hp / stats(u).maxHp) * 26 + adj * 3 - (hasSt(u, 'shield') ? 8 : 0) }); break;
    }
    case 'scorch':
      for (const [dx, dy] of ORTH) {
        const cx = u.x + dx, cy = u.y + dy, px = dy !== 0 ? 1 : 0, py = dx !== 0 ? 1 : 0;
        if (inB(cx, cy)) opt(pt(cx, cy), [pt(cx - px, cy - py), pt(cx, cy), pt(cx + px, cy + py)].filter((t) => inB(t.x, t.y)), 0.8);
      } break;
    case 'concuss': for (const [dx, dy] of ORTH) { const t = pt(u.x + dx, u.y + dy); if (inB(t.x, t.y)) opt(t, [t], 1.0); } break;
    // ---- 16.0 (C) tempo equips ----
    case 'seize': for (const [dx, dy] of KNIGHT) { const t = pt(u.x + dx, u.y + dy); if (inB(t.x, t.y)) opt(t, [t], TEMPO_T.seize, { util: TEMPO_T.firstUtil }); } break;
    case 'hourglass':
      for (const [dx, dy] of DIAG) {
        const tl = lineTiles(s, u, dx, dy, 5, { stopAtUnit: true }); const last = tl[tl.length - 1];
        const v = last && unitAt(s, last.x, last.y);
        if (v && v !== u && !ally(u, v)) opt(last, tl, TEMPO_T.hourglass, { kind: 'shot' });
      } break;
    case 'anchor': opt(self, around8(u.x, u.y), TEMPO_T.anchor, { util: 2 }); break;
    case 'fracture': { const tl = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && inB(u.x + dx, u.y + dy)) tl.push(pt(u.x + dx, u.y + dy)); opt(self, tl, TEMPO_T.fracture, { util: TEMPO_T.firstUtil }); break; }
    case 'frostNova': case 'plague': { const tl = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && inB(u.x + dx, u.y + dy)) tl.push(pt(u.x + dx, u.y + dy)); opt(self, tl, id === 'frostNova' ? 0.45 : 0.3); break; }
    case 'warcry': opt(self, around8(u.x, u.y), 1.4); break;
    case 'sweep':
      for (let i = 0; i < 8; i++) {
        const arc = [RING8[(i + 7) % 8], RING8[i], RING8[(i + 1) % 8]].map(([dx, dy]) => pt(u.x + dx, u.y + dy)).filter((t) => inB(t.x, t.y));
        const c = pt(u.x + RING8[i][0], u.y + RING8[i][1]); if (inB(c.x, c.y)) opt(c, arc, 0.9);
      } break;
    case 'heroicLeap':
      for (const [dx, dy] of DIRS8) for (const k of [2, 3]) { const x = u.x + dx * k, y = u.y + dy * k; if (canStand(s, x, y)) leapOpt(x, y, around8(x, y), 0.7); } break;
    case 'valor':
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = u.x + dx, y = u.y + dy; if ((!dx && !dy) || !canStand(s, x, y)) continue;
        const tl = []; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) if ((a || b) && inB(x + a, y + b)) tl.push(pt(x + a, y + b));
        leapOpt(x, y, tl, 1.2);
      } break;
    // ---- 10.0 Siege enemies ----
    case 'hexBolt': case 'soulLance':
      for (const [dx, dy] of DIRS8) {
        const tl = lineTiles(s, u, dx, dy, id === 'hexBolt' ? 3 : 5, { stopAtUnit: true }); const last = tl[tl.length - 1];
        const v = last && unitAt(s, last.x, last.y);
        if (v && v.kind === 'player') opt(last, id === 'soulLance' ? tl : [last], id === 'soulLance' ? 1.1 : 1.0, { kind: 'shot' });
      } break;
    case 'wraithStep':
      for (const p of alivePlayers(s)) for (const [dx, dy] of DIRS8) {
        const x = p.x + dx * 3, y = p.y + dy * 3;
        if (canStand(s, x, y) && !isVoid(s, x, y) && !o.some((q) => q.anchor.x === x && q.anchor.y === y)) opt(pt(x, y), [pt(x, y)], 0, { kind: 'teleport', data: { at: p.id } });
      } break;
  }
  if (slot === 'ult' && ascended(u)) for (const q of o) { q.mult *= 1.3; q.asc = true; } // 15.0 Ascension: empowered ultimate
  // no friendly fire: allies never count as hits
  if (u.team != null) for (const q of o) q.hits = q.hits.filter((id) => !ally(u, unitById(s, id)));
  return o;
}

// ---------- 15.0 (C): status effects ----------
// u.status = [{ k, t, n?, src?, live?, by? }]. t counts down at the affected unit's turn start; freeze and stun take
// effect at that turn start (live) and end with that turn. Events: {e:'status', id, k, on, t, n, src?}, DoT ticks
// {e:'dmg', id, n, dot:k}, {e:'resist', id, k} when an immunity blocks one, {e:'cleanse', id, ks}.
export const getSt = (u, k) => (u && u.status ? u.status.find((q) => q.k === k) || null : null);
export const hasSt = (u, k) => !!getSt(u, k);
export const stN = (u, k) => { const q = getSt(u, k); return q ? q.n || 0 : 0; };
export const harmed = (u) => !!(u && u.status && u.status.some((q) => STATUS[q.k] && STATUS[q.k].bad && q.k !== 'exposed'));
export const ascended = (u) => !!(u && u.kind === 'player' && ASCEND[u.piece] && ((u.hone && u.hone[u.piece]) || 0) >= MAX_HONE);
// Boss King tuning (tools/sim15.mjs sweeps these). converge/focus: how hard bots gang up on it.
// Tuned with 300-game sweeps for ~40% King wins in 8-bot Royale (15.0). HP pool = (piece HP x hp + 5) x (1 + hpPer per rival beyond 1).
export const BISHOP_T = { sideActs: 1 }; // 17.0 (C2): Sidestep spends the action (sim tunable: BISHOP_T.sideActs=0)
export const KING_T = { floor: 0.9, hp: 1.09, /* 17.0 (C2): floor was 0.85, hp 1.06 (King 28-32% after Bishop Sidestep) */ hpPer: 0.03, aura: 2, expose: 0.2, exposeMax: 4, shock: 0.8, enrage: 1.25, heal: 0.0125, converge: 1.2, focus: 16 };
export function addStatus(s, u, k, ev, o = {}) {
  if (!u || !u.alive || s.over || !STATUS[k]) return false;
  let t = Math.max(1, Math.round(o.t ?? STATUS[k].t));
  const resist = (u.passive === 'ward' && (k === 'freeze' || k === 'stun' || k === 'slow')) || (ascended(u) && u.piece === 'queen' && (k === 'slow' || k === 'freeze'))
    || (k === 'freeze' && hasSt(u, 'stun')) || (k === 'stun' && hasSt(u, 'freeze')); // never locked out of both move and action
  if (resist) { ev.push({ e: 'resist', id: u.id, k }); return false; }
  if (u.passive === 'ward' && (k === 'burn' || k === 'poison')) t = Math.max(1, t - 1);
  if (k === 'burn' && hasSt(u, 'freeze')) removeStatus(s, u, 'freeze', ev, 'melt'); // fire thaws
  if (k === 'freeze' && hasSt(u, 'burn')) removeStatus(s, u, 'burn', ev, 'snuff'); // frost puts the fire out
  if (!u.status) u.status = [];
  let q = getSt(u, k);
  if (!q) { q = { k, t: 0 }; u.status.push(q); }
  q.t = Math.max(q.t, t);
  if (k === 'poison') q.n = Math.min(3, (q.n || 0) + Math.max(1, o.n || 1));
  else if (k === 'shield') q.n = Math.max(q.n || 0, Math.max(1, Math.round(o.n || 1)));
  else if (k === 'exposed') q.n = o.n || 1;
  if (o.src != null) q.src = o.src;
  if (k === 'freeze' || k === 'stun') q.live = false;
  const e = { e: 'status', id: u.id, k, on: true, t: q.t, n: q.n || 0 }; if (o.src != null) e.src = o.src; if (typeof o.src === 'number') e.by = o.src; // by: the unit that applied it
  ev.push(e);
  return true;
}
export const applyStatus = addStatus; // name W's location code asked for
// why (optional): 'melt' (fire thawed a freeze), 'snuff' (frost put out a burn), 'break' (shield popped), 'cleanse'
export function removeStatus(s, u, k, ev, why) {
  if (!u || !u.status) return;
  const i = u.status.findIndex((q) => q.k === k); if (i < 0) return;
  u.status.splice(i, 1);
  const e = { e: 'status', id: u.id, k, on: false, t: 0, n: 0 }; if (why) e.why = why;
  ev.push(e);
}
function cleanse(s, u, ev) {
  const ks = (u.status || []).filter((q) => STATUS[q.k] && STATUS[q.k].bad && q.k !== 'exposed').map((q) => q.k);
  for (const k of ks) removeStatus(s, u, k, ev, 'cleanse');
  if (ks.length) ev.push({ e: 'cleanse', id: u.id, ks });
  return ks.length;
}
// Shields soak damage before HP: the status shield first, then a Siege Brute's shield. Returns what is left.
function soak(s, u, dmg, ev, src, crit) {
  const q = getSt(u, 'shield');
  if (q && dmg > 0) {
    const ab = Math.min(q.n || 0, dmg); q.n -= ab; dmg -= ab;
    if (ab > 0) { const e = { e: 'dmg', id: u.id, n: ab, shield: true }; if (src) e.src = src.id; if (crit) e.crit = true; ev.push(e); }
    if (q.n <= 0) { removeStatus(s, u, 'shield', ev, 'break'); ev.push({ e: 'shieldBreak', id: u.id }); }
  }
  if (u.shield > 0 && dmg > 0) {
    const ab = Math.min(u.shield, dmg); u.shield -= ab; dmg -= ab;
    const e = { e: 'dmg', id: u.id, n: ab, shield: true }; if (src) e.src = src.id; if (crit) e.crit = true; ev.push(e);
    if (u.shield <= 0) { u.shield = 0; ev.push({ e: 'shieldBreak', id: u.id }); }
  }
  return dmg;
}
// Burn and poison ticks. The piece that applied it gets the credit (and the kill).
function dot(s, u, n, k, srcId, ev) {
  if (s.over || !u.alive) return;
  const src = srcId != null ? unitById(s, srcId) : null, by = src && src.alive && src !== u ? src : null;
  let dmg = soak(s, u, Math.max(1, Math.round(n)), ev, null, false);
  if (dmg <= 0) return;
  u.hp -= dmg; ev.push({ e: 'dmg', id: u.id, n: dmg, dot: k });
  if (u.kind === 'player') chargeUlt(u, dmg * 0.8, ev);
  if (by && by.kind === 'player') { by.dmgDealt = (by.dmgDealt || 0) + dmg; chargeUlt(by, dmg * 0.5, ev); }
  if (u.hp <= 0) kill(s, u, by, ev, k);
}
// Turn start: burn and poison tick, freeze and stun take hold, timers count down, passives fire.
function statusTurn(s, u, ev) {
  if (u.status && u.status.length) {
    const mx = stats(u).maxHp;
    for (const q of u.status.slice()) {
      if (!u.alive || s.over) return;
      if (q.k === 'burn') dot(s, u, mx * 0.06, 'burn', q.src, ev);
      else if (q.k === 'poison') dot(s, u, mx * 0.03 * (q.n || 1), 'poison', q.src, ev);
      else if (q.k === 'freeze') { s.turn.rooted = true; q.live = true; }
      else if (q.k === 'stun') { s.turn.stunned = true; s.turn.acted = true; q.live = true; }
    }
    if (!u.alive || s.over) return;
    for (const q of u.status.slice()) if (!q.live && --q.t <= 0) removeStatus(s, u, q.k, ev);
  }
  if (u.kind !== 'player') return;
  if (u.passive === 'aegis') { u.aegisN = ((u.aegisN || 0) + 1) % 3; if (u.aegisN === 0) addStatus(s, u, 'shield', ev, { n: stats(u).maxHp * 0.1, t: 1 }); }
  if (ascended(u) && u.piece === 'bishop') heal(s, u, stats(u).maxHp * 0.05, ev);
  // the King's royal aura slows every enemy that starts a turn near it
  const K = s.kingBoss && unitById(s, s.kingBoss.id);
  if (K && K.alive && K !== u && !ally(K, u) && cheb(K, u) <= KING_T.aura) addStatus(s, u, 'slow', ev, { t: 1, src: K.id });
}
// Freeze and stun end with the turn they spoiled.
function statusTurnEnd(s, u, ev) {
  if (!u || !u.status) return;
  for (const q of u.status.slice()) if (q.live) removeStatus(s, u, q.k, ev);
}
// On-hit effects for the action being resolved: the ability's own statuses, passives and Ascension.
function actProcs(s, src, tgt, ev) {
  const A = s._act;
  if (!tgt.alive || s.over || A.done.includes(tgt.id)) return;
  A.done.push(tgt.id);
  const o = { src: src.id };
  if (A.st) A.st(tgt, o);
  if (src.passive === 'kindle' && A.slot === 'atk') addStatus(s, tgt, 'burn', ev, o);
  if (src.passive === 'venom') addStatus(s, tgt, 'poison', ev, o);
  if (src.passive === 'rime') addStatus(s, tgt, 'slow', ev, o);
  if (ascended(src)) {
    if (src.piece === 'bishop' && A.id === 'ray') addStatus(s, tgt, 'poison', ev, o);
    else if (src.piece === 'rook' && A.id === 'slam') addStatus(s, tgt, 'slow', ev, o);
    else if (A.slot === 'ult') addStatus(s, tgt, { knight: 'stun', bishop: 'burn', queen: 'freeze' }[src.piece] || 'slow', ev, o);
  }
}
// Exposed: every different attacker that hits the King before its next turn strips more DEF.
function expose(s, king, src, ev) {
  if (!king.alive || src === king || ally(src, king)) return;
  let q = getSt(king, 'exposed');
  if (q && (q.by || []).includes(src.id)) return;
  const by = q ? [...(q.by || []), src.id] : [src.id];
  addStatus(s, king, 'exposed', ev, { n: Math.min(KING_T.exposeMax, by.length), t: 1 });
  q = getSt(king, 'exposed'); if (q) q.by = by;
}
// Boss King phases: crossing 66% and 33% HP sets off a free shockwave and a short enrage.
function kingPhase(s, ev) {
  const K = s.kingBoss; if (!K || s.over) return;
  const u = unitById(s, K.id); if (!u || !u.alive || u.piece !== 'king') return;
  const r = u.hp / stats(u).maxHp, want = r <= 0.33 ? 2 : r <= 0.66 ? 1 : 0;
  while (K.phase < want && u.alive && !s.over) {
    K.phase++;
    const tiles = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && inB(u.x + dx, u.y + dy)) tiles.push(pt(u.x + dx, u.y + dy));
    ev.push({ e: 'kingPhase', id: u.id, phase: K.phase, tiles });
    const victims = s.units.filter((v) => v.alive && v !== u && !ally(u, v) && cheb(u, v) <= 2).sort((a, b) => cheb(u, a) - cheb(u, b) || a.id - b.id);
    for (const v of victims) { if (s.over || !u.alive) break; if (!v.alive) continue; dealDamage(s, u, v, KING_T.shock, ev, { reflect: false }); if (v.alive && !s.over) pushUnit(s, u, v, sgn(v.x - u.x), sgn(v.y - u.y), 1, 0.3, ev); }
    if (!u.alive || s.over) break;
    addStatus(s, u, 'enrage', ev, { t: 2 }); ev.push({ e: 'enrage', id: u.id });
    addStatus(s, u, 'haste', ev, { t: 2 });
    s.log.push(`${u.name} is enraged`);
  }
  syncBoss(s);
}
function syncBoss(s) {
  const K = s.kingBoss; if (!K) return;
  const u = unitById(s, K.id);
  if (!u || !u.alive || u.piece !== 'king') { s.kingBoss = null; return; }
  K.hp = u.hp; K.hpMax = stats(u).maxHp;
}

// ---------- damage ----------
function dealDamage(s, src, tgt, mult, ev, { reflect = true } = {}) {
  if (s.over || !tgt.alive || mult <= 0 || ally(src, tgt)) return 0;
  const a = stats(src), d = stats(tgt);
  let m = mult * (0.9 + rand(s) * 0.2) * dmgMods(src, tgt);
  const crit = rand(s) < (s.eclipse ? 0.2 : 0.1);
  if (crit) m *= 1.5;
  if (s.bloodMoon) m *= 1.3;
  let dmg = Math.max(1, Math.round(a.atk * m * 30 / (30 + d.def * defMul(tgt))));
  if (s.round < STEADFAST_ROUND && tgt.kind === 'player' && (tgt.hp >= d.maxHp || (s._guard && s._guard.has(tgt.id))) && dmg >= tgt.hp) { dmg = tgt.hp - 1; ev.push({ e: 'steadfast', id: tgt.id }); }
  if (s.round < STEADFAST_ROUND && tgt.kind === 'player' && tgt.hp >= d.maxHp) (s._guard || (s._guard = new Set())).add(tgt.id);
  dmg = guardHit(s, tgt, dmg, ev); // 16.0 (C): DEF Guard caps a single hit
  const raw = dmg;
  dmg = soak(s, tgt, dmg, ev, src, crit); // 15.0: status shields, then Siege Brute shields
  if (raw > dmg && src.kind === 'player') { src.dmgDealt = (src.dmgDealt || 0) + raw - dmg; chargeUlt(src, (raw - dmg) * 0.8, ev); }
  if (tgt.piece === 'king' && tgt.kind === 'player') expose(s, tgt, src, ev);
  if (dmg <= 0) { if (s._act && s._act.src === src.id) actProcs(s, src, tgt, ev); return raw; }
  tgt.hp -= dmg;
  if (src.kind === 'player') { src.dmgDealt = (src.dmgDealt || 0) + dmg; chargeUlt(src, dmg * 1.1, ev); }
  if (tgt.kind === 'player') chargeUlt(tgt, dmg * 0.8, ev);
  ev.push({ e: 'dmg', id: tgt.id, src: src.id, n: dmg, crit });
  if (tgt.hp <= 0) { const over = -tgt.hp; kill(s, tgt, src, ev); overkill(s, src, tgt, over, ev); } // 16.0 (C): ATK Overkill
  else { secondWind(s, tgt, ev); adrenaline(s, tgt, ev); } // 16.0 (C): HP Second Wind
  if (s._act && s._act.src === src.id && !s.over) actProcs(s, src, tgt, ev);
  if (!s.over && src.alive && src.passive === 'lifesteal' && src !== tgt) heal(s, src, Math.max(1, dmg * 0.14), ev); // 15.0: 10% -> 14% (sims: weakest base ability)
  if (!s.over && tgt.alive && reflect && tgt.passive === 'thorns' && src !== tgt && cheb(src, tgt) <= 1 && src.alive && !ally(src, tgt)) {
    const r = Math.max(1, Math.round(dmg * 0.3));
    src.hp -= r; ev.push({ e: 'dmg', id: src.id, src: tgt.id, n: r, thorns: true });
    if (src.hp <= 0) kill(s, src, tgt, ev);
  }
  return dmg;
}
function chargeUlt(u, n, ev) {
  if (u.kind !== 'player' || !u.alive) return;
  const was = u.ult || 0; u.ult = Math.min(100, was + n); // 15.0: the boss King charges at the normal rate
  if (was < 100 && u.ult >= 100) ev.push({ e: 'ultReady', id: u.id });
}
// Damage modifiers that do not roll dice (shared with previewDamage).
function dmgMods(src, tgt) {
  const d = stats(tgt); let m = 1;
  if (src.passive === 'first' && tgt.hp >= d.maxHp * 0.6) m *= 1.5;
  if (src.passive === 'predator' && tgt.hp < d.maxHp * 0.35) m *= 1.25;
  if (src.passive === 'opportunist' && harmed(tgt)) m *= 1.25;
  if (src.passive === 'rime' && hasSt(tgt, 'freeze')) m *= 1.25;
  if (ascended(src)) m *= src.piece === 'knight' ? 1.2 : src.piece === 'bishop' ? 1.15 : src.piece === 'queen' ? 1.1 : 1;
  if (tgt.braced) m *= 0.8;
  if (ascended(tgt) && tgt.piece === 'rook') m *= 0.85;
  m *= speedEdge(src, tgt);
  return m;
}
// 15.2: SPD sets turn order and gives a Speed Edge: +3% damage per point of SPD you have over your target, and -3%
// per point under (both capped at 15%). Turns are once per round now, so this keeps SPD worth investing in.
export const SPEED_EDGE = { per: 0.03, cap: 0.15 };
export const speedEdge = (a, b) => 1 + Math.max(-SPEED_EDGE.cap, Math.min(SPEED_EDGE.cap, SPEED_EDGE.per * (effSpd(a) - effSpd(b))));
// ---------- 16.0 (C): stat identities ----------
// ATK Overkill: damage past what a kill needed spills (spill x) into the attacker's nearest enemy next to the victim.
// One hop, never chains, player attackers only, piece hits only (storm/hazards/DoTs use dealFixed/dot).
// DEF Guard: one hit never takes more than (base - DEF)% of max HP, floor %. Players and the King only, piece hits only.
// HP Second Wind: once per match, the first hit that leaves a player alive under `below` heals heal x maxHp + perPt per HP point.
export const OVERKILL = { spill: 0.5 };
export const GUARD = { base: 60, floor: 35 };
export const SECOND_WIND = { below: 0.25, heal: 0.1, perPt: 1 };
export const guardPct = (u) => (u && u.kind === 'player' ? Math.max(GUARD.floor, GUARD.base - stats(u).def) : 100);
export const guardCap = (u) => (u && u.kind === 'player' ? Math.max(1, Math.round(stats(u).maxHp * guardPct(u) / 100)) : Infinity);
function guardHit(s, u, dmg, ev) {
  const cap = guardCap(u);
  if (dmg > cap) { ev.push({ e: 'guard', id: u.id, saved: dmg - cap }); return cap; }
  return dmg;
}
function secondWind(s, u, ev) {
  if (u.kind !== 'player' || !u.alive || u.sw || s.over || u.piece === 'king') return; // the boss King has its phases instead
  const mx = stats(u).maxHp; if (u.hp >= mx * SECOND_WIND.below) return;
  u.sw = true; const h0 = u.hp;
  heal(s, u, mx * SECOND_WIND.heal + SECOND_WIND.perPt * ((u.pts && u.pts.hp) || 0), ev);
  ev.push({ e: 'secondwind', id: u.id, heal: u.hp - h0 });
}
function overkill(s, src, victim, over, ev) {
  if (s.over || !src || src.kind !== 'player' || over <= 0) return;
  const n0 = Math.max(1, Math.round(over * OVERKILL.spill));
  const md = (w) => Math.abs(w.x - src.x) + Math.abs(w.y - src.y);
  const w = s.units.filter((q) => q.alive && q !== src && q !== victim && !ally(src, q) && cheb(q, victim) <= 1)
    .sort((a, b) => cheb(src, a) - cheb(src, b) || md(a) - md(b) || a.id - b.id)[0];
  if (!w) return;
  let n = guardHit(s, w, n0, ev);
  if (s.round < STEADFAST_ROUND && w.kind === 'player' && w.hp >= stats(w).maxHp && n >= w.hp) { n = w.hp - 1; ev.push({ e: 'steadfast', id: w.id }); }
  ev.push({ e: 'overkill', id: src.id, from: victim.id, to: w.id, dmg: n });
  n = soak(s, w, n, ev, src, false);
  if (n <= 0) return;
  w.hp -= n;
  src.dmgDealt = (src.dmgDealt || 0) + n; chargeUlt(src, n * 1.1, ev);
  if (w.kind === 'player') chargeUlt(w, n * 0.8, ev);
  ev.push({ e: 'dmg', id: w.id, src: src.id, n, overkill: true });
  if (w.hp <= 0) kill(s, w, src, ev); else { secondWind(s, w, ev); adrenaline(s, w, ev); }
}
function adrenaline(s, u, ev) {
  if (u.passive !== 'adrenaline' || !u.alive || u.kind !== 'player' || (u.adrenAt && s.round < u.adrenAt)) return;
  const mx = stats(u).maxHp; if (u.hp >= mx * 0.5) return;
  u.adrenAt = s.round + 3;
  addStatus(s, u, 'haste', ev, { t: 2 }); addStatus(s, u, 'shield', ev, { n: mx * 0.12, t: 2 });
}
function dealFixed(s, tgt, n, ev, tag) {
  if (s.over || !tgt.alive) return;
  let dmg = Math.max(1, Math.round(n * (s.bloodMoon ? 1.3 : 1)));
  dmg = soak(s, tgt, dmg, ev, null, false);
  if (dmg <= 0) return 0;
  tgt.hp -= dmg; ev.push({ e: 'dmg', id: tgt.id, n: dmg, [tag]: true });
  if (tgt.kind === 'player') chargeUlt(tgt, dmg * 0.8, ev);
  if (tgt.hp <= 0) kill(s, tgt, null, ev, tag); else adrenaline(s, tgt, ev);
  return dmg;
}
function heal(s, u, n, ev) {
  if (hasSt(u, 'poison')) n *= 0.5; // 15.0: poison halves healing
  const mx = stats(u).maxHp; const h = Math.min(mx - u.hp, Math.round(n));
  if (h > 0) { u.hp += h; ev.push({ e: 'heal', id: u.id, n: h }); }
}
function hitTile(s, src, x, y, ev) {
  const t = tileAt(s, x, y); if (!t) return;
  if (t.t === 'crate') {
    s.tiles[y * SIZE + x] = { t: 'floor' };
    ev.push({ e: 'crate', x, y });
    const r = rand(s);
    const extra = src && src.passive === 'scavenger' ? 1 : 0;
    const put = (it) => (isVoid(s, x, y) ? dropNear(s, x, y, it) : s.items.push({ x, y, ...it }));
    if (r < 0.6) put({ k: 'shard', n: 1 + extra });
    else {
      put({ k: r < 0.82 ? 'potion' : 'haste', n: 1 });
      if (extra) dropNear(s, x, y, { k: 'shard', n: 1 });
    }
  } else if (t.t === 'chest') {
    t.hp -= 1; ev.push({ e: 'chest', x, y, broke: t.hp <= 0 });
    if (t.hp <= 0) {
      s.tiles[y * SIZE + x] = { t: 'floor' };
      s.items.push({ x, y, k: 'shard', n: 3 });
      dropNear(s, x, y, { k: 'potion', n: 1 });
      dropNear(s, x, y, { k: 'haste', n: 1 });
    }
  } else if (t.t === 'rubble') {
    t.hp -= 1; ev.push({ e: 'rubble', x, y, broke: t.hp <= 0 });
    if (t.hp <= 0) s.tiles[y * SIZE + x] = { t: 'floor' };
  }
}
function dropNear(s, x, y, item) {
  let cands = [pt(x, y), ...around8(x, y)].filter((t) => !isSolid(s, t.x, t.y) && !isVoid(s, t.x, t.y));
  if (!cands.length) cands = freeTiles(s, 0).slice(0, 1);
  if (!cands.length) { for (let yy = 0; yy < SIZE && !cands.length; yy++) for (let xx = 0; xx < SIZE && !cands.length; xx++) if (!isVoid(s, xx, yy) && !isSolid(s, xx, yy)) cands = [pt(xx, yy)]; }
  const spot = cands.find((t) => !s.items.some((i) => i.x === t.x && i.y === t.y)) || cands[0] || pt(x, y);
  if (isSolid(s, spot.x, spot.y) && tileAt(s, spot.x, spot.y) && tileAt(s, spot.x, spot.y).t !== 'out') s.tiles[spot.y * SIZE + spot.x] = { t: 'floor' };
  const same = s.items.find((i) => i.x === spot.x && i.y === spot.y && i.k === item.k && item.k === 'shard');
  if (same) same.n += item.n; else s.items.push({ x: spot.x, y: spot.y, ...item });
}
function aoe(s, u, tiles, mult, ev, onHit) {
  ev.push({ e: 'aoe', id: u.id, tiles, kind: mult > 0 ? 'hit' : 'fx' });
  const victims = tiles.map((t) => unitAt(s, t.x, t.y)); // snapshot so knockback can't make a piece get hit twice
  const done = new Set();
  tiles.forEach((t, i) => {
    if (!u.alive || s.over) return;
    const v = victims[i];
    if (v && v !== u) { if (ally(u, v) || done.has(v.id) || !v.alive) return; done.add(v.id); dealDamage(s, u, v, mult, ev); if (onHit && v.alive) onHit(v); }
    else if (!v && !unitAt(s, t.x, t.y)) hitTile(s, u, t.x, t.y, ev);
  });
}

function kill(s, v, killer, ev, cause = null) {
  if (!v.alive) return;
  v.alive = false; v.hp = 0; v.status = []; // 15.0: statuses end with the piece (the death event implies it)
  if (s.kingBoss && s.kingBoss.id === v.id) s.kingBoss = null;
  ev.push({ e: 'death', id: v.id, by: killer ? killer.id : null, x: v.x, y: v.y, cause });
  if (killer && killer !== v) chargeUlt(killer, 20, ev);
  const loot = (v.shards || 0);
  if (loot > 0) dropNear(s, v.x, v.y, { k: 'shard', n: loot });
  v.shards = 0;
  if (v.piece === 'king') { dropNear(s, v.x, v.y, { k: 'shard', n: 4 }); ev.push({ e: 'msg', text: 'The Crown has shattered', tone: 'gold' }); }
  if (v.kind === 'hollow' && v.boss && s.siege && !s.crownSpawned && v.wave < s.siege.waves) { s.crownSpawned = true; dropNear(s, v.x, v.y, { k: 'crown', n: 1 }); ev.push({ e: 'msg', text: 'The Colossus dropped the Crown', tone: 'gold' }); }
  const de = ev.find((q) => q.e === 'death' && q.id === v.id);
  if (v.kind === 'hollow' && killer && killer.kind === 'player') killer.hk = (killer.hk || 0) + 1;
  // 10.0 Royal Decree bounty
  if (s.bounty && s.bounty.id === v.id) {
    s.bounty = null;
    if (killer && killer !== v && killer.kind === 'player' && killer.alive) { gainShards(s, killer, 3, ev); chargeUlt(killer, 25, ev); ev.push({ e: 'bountyClaim', id: killer.id, of: v.id, n: 3 }); }
  }
  // 10.0 Splitters burst into two Mites
  if (v.role === 'splitter' && s.siege && cause !== 'crumble') {
    const spots = around8(v.x, v.y).filter((t) => canStand(s, t.x, t.y) && !isVoid(s, t.x, t.y)).slice(0, 2), ids = [];
    for (const t of spots) { const m = mkHollow(s, t.x, t.y, { role: 'mite', name: 'Mite', hunt: true, wave: v.wave, hpMax: Math.max(8, Math.round(v.hpMax * 0.35)), atkB: Math.max(3, Math.round(v.atkB * 0.6)), defB: Math.max(1, v.defB - 2), spdB: v.spdB + 2, shards: 0, gauge: 50, color: '#c9a0ff' }); ids.push(m.id); }
    if (ids.length) ev.push({ e: 'split', id: v.id, ids, tiles: spots });
  }
  if (v.kind === 'player') {
    const wasKing = v.piece === 'king';
    s.log.push(`${killer && killer !== v ? killer.name : cause === 'meteor' ? 'A meteor' : cause === 'lava' ? 'The lava' : cause === 'trap' ? 'A trap' : cause === 'geyser' ? 'A geyser' : cause === 'crumble' ? 'The crumbling floor' : cause === 'burn' ? 'Fire' : cause === 'sudden' ? 'Sudden Death' : cause === 'poison' ? 'Poison' : WORLD_EVENTS[cause] ? 'The ' + WORLD_EVENTS[cause].name : 'The storm'} eliminated ${v.name}`);
    if (killer && killer !== v && killer.kind === 'player') {
      killer.kills++;
      if (killer.passive === 'momentum') killer.momentum = Math.min(4, killer.momentum + 1);
      if (de) {
        de.streak = killer.kills; if (!s.firstBlood) { s.firstBlood = true; de.firstBlood = true; }
        if (v.kills >= 3) de.shutdown = true;
        if (wasKing) de.regicide = true;
      }
    }
    if (s.siege) {
      v.place = 0;
      if (alivePlayers(s).length) { dropNear(s, v.x, v.y, { k: 'soul', n: 1, id: v.id, team: v.team, exp: s.round + 3 }); ev.push({ e: 'soul', id: v.id, x: v.x, y: v.y }); }
      else { s.over = true; s.winner = null; s.items = s.items.filter((i) => i.k !== 'soul'); for (const p of s.units) if (p.kind === 'player') p.place = 2; ev.push({ e: 'over', winner: null, siege: true, wave: s.siege.wave }); }
      return;
    }
    const mates = s.units.filter((w) => w.kind === 'player' && w.alive && ally(w, v));
    if (mates.length) {
      v.place = 0;
      dropNear(s, v.x, v.y, { k: 'soul', n: 1, id: v.id, team: v.team, exp: s.round + 3 });
      ev.push({ e: 'soul', id: v.id, x: v.x, y: v.y });
    } else {
      const place = teamsAlive(s).size + 1;
      for (const w of s.units) if (w.kind === 'player' && (w === v || (v.team != null && w.team === v.team))) w.place = place;
      if (v.team != null) s.items = s.items.filter((i) => !(i.k === 'soul' && i.team === v.team));
    }
    const left = teamsAlive(s);
    if (left.size <= 1) {
      const alive = alivePlayers(s);
      s.over = true; s.winner = alive[0] ? alive[0].id : null;
      for (const w of s.units) if (w.kind === 'player' && alive[0] && (w === alive[0] || ally(w, alive[0]))) w.place = 1;
      ev.push({ e: 'over', winner: s.winner, team: alive[0] ? alive[0].team : null });
    } else if (left.size === 2 && !s.finalTwo && s.units.filter((w) => w.kind === 'player').length > 2) { s.finalTwo = true; ev.push({ e: 'final', teams: !!s.teams }); }
  } else if (v.wave && s.siege && !s.units.some((w) => w.alive && w.wave)) {
    siegeCleared(s, ev);
  }
}

// ---------- 5.0: Siege ----------
function mkHollow(s, x, y, extra) {
  const h = { id: s.nextId++, kind: 'hollow', name: 'Hollow', piece: 'hollow', x, y, hx: x, hy: y, hpMax: HOLLOW_STATS.hp, atkB: HOLLOW_STATS.atk, defB: HOLLOW_STATS.def, spdB: HOLLOW_STATS.spd,
    gauge: 0, shards: 1, cd: { sig: 0, eq: 0 }, buffs: [], status: [], alive: true, hone: {}, color: '#7c7a99', skin: 'hollow', ...extra };
  h.hp = h.hpMax; s.units.push(h); return h;
}
export const isBossWave = (S, w) => !!S.gauntlet || w === S.waves || w === Math.floor(S.waves / 2);
export const SIEGE_T = { spd: 0.4, c0: 1.5, cw: 0.3, hs: 0.1, as: 0.24, force: 4, boss: 0.84, ring: 3, pf0: 0.6, pf: 0.2, g: [1, 0.42, 0.87, 1.1, 1.4], gForce: 8, enrage: 10 };
function siegeCleared(s, ev) {
  const S = s.siege;
  if (S.wave >= S.waves) {
    const alive = alivePlayers(s);
    s.over = true; s.winner = alive[0] ? alive[0].id : null; s.siegeWon = true;
    for (const p of s.units) if (p.kind === 'player') p.place = 1;
    ev.push({ e: 'over', winner: s.winner, siege: true, won: true, wave: S.wave });
    return;
  }
  S.next = s.round + 1;
  for (const p of alivePlayers(s)) heal(s, p, stats(p).maxHp * (S.gauntlet ? 0.35 : 0.2), ev);
  ev.push({ e: 'wave', phase: 'clear', n: S.wave, next: S.wave + 1, boss: isBossWave(S, S.wave + 1) });
}
// 10.0 Siege enemy roles. Multipliers apply to the wave's base Hollow stats.
export const ROLES = {
  stalker:  { name: 'Stalker',  hp: 0.6,  atk: 0.8,  def: 0,  spd: 3,  color: '#5ad1ff', from: 3, w: 1 },
  caster:   { name: 'Hexer',    hp: 0.7,  atk: 0.8,  def: -1, spd: 0,  color: '#ff7ad9', from: 4, w: 1 },
  splitter: { name: 'Splitter', hp: 0.75, atk: 0.9,  def: 0,  spd: 0,  color: '#b07cff', from: 5, w: 1.5 },
  brute:    { name: 'Brute',    hp: 1.1,  atk: 1.1,  def: 2,  spd: -2, color: '#d9a066', from: 6, w: 1.7, shield: 0.35 },
};
const ROLE_KEYS = Object.keys(ROLES);
export const GAUNTLET = [
  { boss: 'colossus', escort: ['plain', 'stalker'] },
  { boss: 'regent', escort: ['caster', 'plain'] },
  { boss: 'elder', escort: ['brute', 'splitter'] },
  { boss: 'regent2', also: 'colossus', escort: ['stalker', 'caster', 'splitter'] },
];
function bossStats(kind, nP, k) {
  if (kind === 'regent' || kind === 'regent2') { const big = kind === 'regent2'; return { boss: true, role: 'regent', name: big ? 'Regent Ascendant' : 'Wraith Regent', hpMax: Math.round(((big ? 330 : 240) + nP * (big ? 95 : 70)) * k), atkB: Math.round((big ? 24 : 19) * Math.sqrt(k)), defB: big ? 10 : 8, spdB: 9, shards: 6, color: '#5affc8' }; }
  const big = kind === 'elder';
  return { boss: true, name: big ? 'Elder Colossus' : 'Colossus', hpMax: Math.round(((big ? 420 : 260) + nP * (big ? 120 : 70)) * k), atkB: Math.round((big ? 26 : 19) * Math.sqrt(k)), defB: big ? 12 : 9, spdB: 7, shards: 6, color: '#a06bff' };
}
function roleStats(role, base) {
  const R = ROLES[role]; if (!R) return { ...base };
  const hpMax = Math.max(10, Math.round(base.hpMax * R.hp));
  return { role, name: R.name, color: R.color, hpMax, atkB: Math.max(3, Math.round(base.atkB * R.atk)), defB: Math.max(1, base.defB + R.def), spdB: base.spdB + R.spd, ...(R.shield ? { shield: Math.round(hpMax * R.shield), shieldMax: Math.round(hpMax * R.shield) } : {}) };
}
function spawnWave(s, ev) {
  const S = s.siege; S.wave++; S.next = 0; S.since = s.round;
  const w = S.wave, nP = s.units.filter((u) => u.kind === 'player').length;
  const G = S.gauntlet ? GAUNTLET[Math.min(GAUNTLET.length, w) - 1] : null;
  const boss = isBossWave(S, w);
  // waves are sized to what the defenders can clear; leftovers count against the next wave so Hollows never pile up
  const left = s.units.filter((h) => h.alive && h.wave && (!G || !h.boss)).length;
  const target = G ? nP : Math.min(14, Math.ceil((boss ? 0.5 : 1) * (SIEGE_T.c0 + SIEGE_T.cw * w) * nP));
  const count = Math.max(boss ? 0 : 1, target - left);
  const edge = []; for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (ringOf(x, y) <= SIEGE_T.ring && ringOf(x, y) >= 1 && canStand(s, x, y)) edge.push(pt(x, y));
  const tiles = [];
  const mk = (extra) => {
    if (!edge.length) return null;
    const t = edge.splice(ri(s, edge.length), 1)[0]; tiles.push(t);
    return mkHollow(s, t.x, t.y, { hunt: true, wave: w, ...extra });
  };
  const ew = G ? 2 * w : w; // Gauntlet escorts are as tough as the matching Siege waves
  const pf = SIEGE_T.pf0 + SIEGE_T.pf * nP; // fewer defenders, gentler Hollows
  const hs = 1 + SIEGE_T.hs * (ew - 1), as = (1 + SIEGE_T.as * (ew - 1)) * pf;
  const base = { hpMax: Math.round(HOLLOW_STATS.hp * hs), atkB: Math.round(HOLLOW_STATS.atk * as), defB: HOLLOW_STATS.def + Math.floor(ew / 3), spdB: Math.round(HOLLOW_STATS.spd + ew * SIEGE_T.spd) };
  // special Hollows weigh more than plain ones, so a wave's total threat stays close to 5.0's
  for (let i = 0, budget = count; budget > 0.25; i++) {
    let role = 'plain';
    if (G) role = G.escort[i % G.escort.length];
    else { const pool = [...Array(nP === 1 ? 5 : 3).fill('plain'), ...ROLE_KEYS.filter((k) => w >= ROLES[k].from)]; role = pool[ri(s, pool.length)]; }
    if (!G && i > 0 && ROLES[role] && ROLES[role].w > budget + 0.3) role = 'plain';
    budget -= G ? 1 : ROLES[role] ? ROLES[role].w : 1;
    mk(roleStats(role, base));
  }
  if (boss) {
    const kinds = G ? [G.boss, ...(G.also ? [G.also] : [])] : [w >= S.waves ? 'elder' : 'colossus'];
    for (const kd of kinds) { const b = mk(bossStats(kd, nP, SIEGE_T.boss * (G ? SIEGE_T.g[Math.min(4, nP)] : 1) * (G && G.also ? 0.75 : 1))); if (b) ev.push({ e: 'msg', text: `${b.name} approaches`, tone: 'gold' }); }
  }
  ev.push({ e: 'wave', phase: 'start', n: w, of: S.waves, boss, tiles });
  s.log.push(`Wave ${w} begins`);
}

// ---------- shards / attunement ----------
function gainShards(s, u, n, ev) {
  u.shards += n;
  const before = u.attune || 0, after = u.piece === 'king' ? before : Math.min(ATTUNE.max, before + n);
  if (after > before) {
    const mx0 = stats(u).maxHp;
    u.attune = after;
    u.hp += stats(u).maxHp - mx0;
    const milestone = Math.floor(after / 5) > Math.floor(before / 5);
    ev.push({ e: 'attune', id: u.id, lv: after, milestone, tier: Math.floor(after / 5) });
  }
}

// ---------- landing / pickups ----------
function land(s, u, ev) {
  const t = tileAt(s, u.x, u.y);
  // traps catch players and Hollows alike (never their owner or the owner's team)
  for (let i = s.items.length - 1; i >= 0 && u.alive; i--) {
    const it = s.items[i];
    if (it.k !== 'trap' || it.x !== u.x || it.y !== u.y) continue;
    const owner = unitById(s, it.owner);
    if (it.owner === u.id || (owner && ally(owner, u)) || (u.team != null && it.team === u.team)) continue;
    s.items.splice(i, 1);
    ev.push({ e: 'trap', id: u.id, x: u.x, y: u.y, by: it.owner });
    u.gauge -= 35;
    if (owner && owner.alive) dealDamage(s, owner, u, 0.9, ev, { reflect: false }); else dealFixed(s, u, 10, ev, 'trap');
  }
  // 10.0 crumbling floor: the first step cracks it, the second step breaks it
  if (u.alive && t && t.t === 'crumble') {
    if (t.hp > 1) { t.hp = 1; ev.push({ e: 'hazard', kind: 'crumble', phase: 'crack', x: u.x, y: u.y }); }
    else {
      s.tiles[u.y * SIZE + u.x] = { t: 'pit' };
      ev.push({ e: 'hazard', kind: 'crumble', phase: 'collapse', x: u.x, y: u.y, id: u.id });
      const keep = s.items.filter((i) => i.x === u.x && i.y === u.y); s.items = s.items.filter((i) => !keep.includes(i));
      for (const it of keep) dropNear(s, u.x, u.y, { ...it });
      dealFixed(s, u, Math.max(5, stats(u).maxHp * 0.12), ev, 'crumble');
      if (s.over || !u.alive) return;
      const to = nearestStand(s, u.x, u.y);
      if (to) moveUnit(s, u, to.x, to.y, ev, 'push'); else kill(s, u, null, ev, 'crumble');
      return;
    }
  }
  if (u.kind !== 'player' || !u.alive) return;
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i];
    if (it.x !== u.x || it.y !== u.y || it.k === 'trap') continue;
    if (it.k === 'soul') {
      const dead = unitById(s, it.id);
      if (dead && !dead.alive && ally(u, dead)) { if (revive(s, dead, u, ev)) s.items.splice(i, 1); continue; }
      s.items.splice(i, 1);
      { ev.push({ e: 'soulDeny', id: u.id, x: u.x, y: u.y, of: it.id }); gainShards(s, u, 1, ev); }
      continue;
    }
    s.items.splice(i, 1);
    if (it.k === 'shard') { ev.push({ e: 'pickup', id: u.id, k: 'shard', n: it.n }); gainShards(s, u, it.n, ev); }
    else if (it.k === 'potion') { ev.push({ e: 'pickup', id: u.id, k: 'potion' }); cleanse(s, u, ev); heal(s, u, stats(u).maxHp * 0.35, ev); } // 15.0: potions and shrines also cleanse
    else if (it.k === 'haste') { ev.push({ e: 'pickup', id: u.id, k: 'haste' }); u.gauge += 45; }
    else if (it.k === 'crown') crown(s, u, ev);
  }
  if (t && t.t === 'shrine' && t.cd === 0) {
    t.cd = 4; ev.push({ e: 'shrine', x: u.x, y: u.y, id: u.id });
    cleanse(s, u, ev); heal(s, u, stats(u).maxHp * 0.4, ev);
  }
  if (t && t.t === 'bramble') { u.gauge -= 25; ev.push({ e: 'bramble', id: u.id }); }
  if (t && t.t === 'poison') locPoisonPool(s, u, ev); // 15.0 (W)
  if (t && t.t === 'portal' && !s._porting) {
    let dest = null;
    for (let y = 0; y < SIZE && !dest; y++) for (let x = 0; x < SIZE && !dest; x++) { const q = s.tiles[y * SIZE + x]; if (q.t === 'portal' && q.pair === t.pair && (x !== u.x || y !== u.y) && canStand(s, x, y) && !isVoid(s, x, y)) dest = pt(x, y); }
    if (dest) { s._porting = true; ev.push({ e: 'portal', id: u.id, from: pt(u.x, u.y), to: dest }); moveUnit(s, u, dest.x, dest.y, ev, 'portal'); s._porting = false; }
  }
}
// Closest free, safe tile (ring search), for pieces that lose their footing.
function nearestStand(s, x, y) {
  for (let r = 1; r < SIZE; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (canStand(s, nx, ny) && !isVoid(s, nx, ny)) return pt(nx, ny);
    }
  }
  return null;
}
function revive(s, v, by, ev) {
  const spot = around8(by.x, by.y).find((t) => canStand(s, t.x, t.y) && !isVoid(s, t.x, t.y));
  if (!spot) return false;
  v.alive = true; v.x = spot.x; v.y = spot.y; v.place = 0; v.buffs = []; v.status = []; v.gauge = 40; v.mark = null;
  if (v.piece === 'king') { v.piece = v.kingFrom || 'pawn'; v.kingStats = null; v.cd = { sig: 0, eq: 0 }; } // the Crown shattered when they fell
  v.hp = Math.max(1, Math.round(stats(v).maxHp * 0.4));
  ev.push({ e: 'revive', id: v.id, by: by.id, x: v.x, y: v.y });
  s.log.push(`${by.name} revived ${v.name}`);
  return true;
}
function crown(s, u, ev) {
  let st = baseStats(u);
  if (PIECES[u.piece].tier < 3 && alivePlayers(s).length > 3) { const r = baseStats({ ...u, piece: 'rook' }), f = KING_T.floor; st = { hp: Math.max(st.hp, Math.round(r.hp * f)), atk: Math.max(st.atk, Math.round(r.atk * f)), def: Math.max(st.def, Math.round(r.def * f)), spd: st.spd }; } // 17.0 (C2): floor a KING_T tunable (was 0.85; Sidestep lets more Bishops take the Crown)
  const before = stats(u).maxHp;
  st.maxHp = st.hp;
  u.kingFrom = u.piece;
  // 15.0 (C): the King is a raid boss. Its HP pool grows with the number of rivals left to fight it.
  const rivals = alivePlayers(s).filter((w) => w !== u && !ally(u, w)).length;
  u.kingStats = { hp: Math.max(before, Math.round((st.maxHp * KING_T.hp + 5) * (1 + KING_T.hpPer * Math.max(0, rivals - 1)))), atk: st.atk + 1, def: st.def + 1, spd: Math.max(6, (PIECES[u.piece].spd || 10) + u.pts.spd - 3) };
  u.piece = 'king'; u.cd = { sig: 0, eq: 0 }; u.mark = null;
  u.hp = Math.max(1, Math.min(stats(u).maxHp, u.hp + stats(u).maxHp - before));
  ev.push({ e: 'crowned', id: u.id });
  if (!s.siege) { const mx = stats(u).maxHp, r = u.hp / mx; s.kingBoss = { id: u.id, name: u.name, hp: u.hp, hpMax: mx, phase: r <= 0.33 ? 2 : r <= 0.66 ? 1 : 0, aura: KING_T.aura }; }
  s.log.push(`${u.name} claimed the Crown`);
}
function moveUnit(s, u, x, y, ev, how = 'step') {
  const from = pt(u.x, u.y);
  u.x = x; u.y = y;
  ev.push({ e: 'move', id: u.id, from, to: pt(x, y), how });
  if (how === 'jump' && s.active === u.id && u.piece === 'knight' && ascended(u)) addStatus(s, u, 'shield', ev, { n: stats(u).maxHp * 0.12, t: 1 }); // Ascended Knight: Cavalry
  const tl = tileAt(s, x, y);
  if (tl && tl.t === 'ice' && how !== 'ice' && how !== 'portal' && how !== 'swap') {
    const dx = sgn(x - from.x), dy = sgn(y - from.y);
    let n = 0;
    while (n < 3 && (dx || dy) && tileAt(s, u.x, u.y) && tileAt(s, u.x, u.y).t === 'ice' && canStand(s, u.x + dx, u.y + dy)) {
      land(s, u, ev); if (!u.alive) return;
      const a = pt(u.x, u.y); u.x += dx; u.y += dy; n++;
      ev.push({ e: 'move', id: u.id, from: a, to: pt(u.x, u.y), how: 'ice' });
    }
  }
  land(s, u, ev);
}
function pushUnit(s, src, v, dx, dy, dist, bonus, ev) {
  for (let i = 0; i < dist && !s.over && v.alive; i++) {
    const nx = v.x + dx, ny = v.y + dy;
    const blocker = unitAt(s, nx, ny);
    if (!inB(nx, ny) || isSolid(s, nx, ny) || blocker) {
      ev.push({ e: 'impact', x: v.x, y: v.y });
      dealDamage(s, src, v, bonus, ev, { reflect: false });
      if (blocker) dealDamage(s, src, blocker, bonus * 0.7, ev, { reflect: false });
      else if (inB(nx, ny)) hitTile(s, src, nx, ny, ev);
      return;
    }
    moveUnit(s, v, nx, ny, ev, 'push');
  }
}

// ---------- actions ----------
export function useAbility(s, u, slot, anchor, ev) {
  const id = slotAbility(u, slot);
  if (!id) return false;
  if (u.cd[slot] > 0 && slot !== 'atk') return false;
  const opts = abilityOptions(s, u, slot);
  const o = opts.find((q) => q.anchor.x === anchor.x && q.anchor.y === anchor.y);
  if (!o) return false;
  ev.push({ e: 'ability', id: u.id, ab: id, slot, anchor, from: { x: u.x, y: u.y }, tiles: o.tiles, n: o.hits.length, ...(o.asc ? { asc: true } : {}) });
  const pieceAtCast = u.piece;
  // 15.0 (C): on-hit statuses for this action (applied once per piece hit, see actProcs)
  const S = (k, x) => (v, q) => addStatus(s, v, k, ev, { ...q, ...x });
  const ST = { firebrand: S('burn'), dart: S('poison', { n: 2 }), scorch: S('burn'), concuss: S('stun'), plague: S('poison', { n: 2 }), hoarfrost: S('freeze'), warcry: S('stun'), valor: S('burn'), dominion: S('slow'),
    hex: (v, q) => { addStatus(s, v, 'poison', ev, { ...q, n: 2 }); addStatus(s, v, 'slow', ev, q); },
    hourglass: (v, q) => { addStatus(s, v, 'slow', ev, q); setTempo(s, v, 'last', u, ev); }, anchor: (v) => setTempo(s, v, 'last', u, ev), fracture: (v) => setTempo(s, v, 'last', u, ev), // 16.0 (C)
    frostNova: (v, q) => { addStatus(s, v, 'slow', ev, q); if (cheb(u, v) <= 1) addStatus(s, v, 'freeze', ev, q); } };
  s._act = { src: u.id, id, slot, done: [], st: ST[id] || null };
  let cdOverride = null;
  switch (id) {
    case 'shove': {
      const v = unitAt(s, o.anchor.x, o.anchor.y);
      dealDamage(s, u, v, 0.5, ev);
      if (v.alive) pushUnit(s, u, v, sgn(v.x - u.x), sgn(v.y - u.y), honed(u) ? 2 : 1, 0.6, ev);
      break;
    }
    case 'pickpocket': {
      const v = unitAt(s, o.anchor.x, o.anchor.y);
      dealDamage(s, u, v, 0.8, ev);
      if (v.shards > 0) { v.shards--; ev.push({ e: 'pickup', id: u.id, k: 'shard', n: 1, steal: v.id }); gainShards(s, u, 1, ev); }
      break;
    }
    case 'vault': case 'sprint': s.turn.extraMoves++; ev.push({ e: 'buff', id: u.id, k: 'move' }); break;
    case 'digin': u.buffs.push({ k: 'def', v: 1.6, t: 1 }); ev.push({ e: 'buff', id: u.id, k: 'def' }); break;
    case 'fortify': u.buffs.push({ k: 'def', v: 2, t: 1 }); s.turn.rooted = true; ev.push({ e: 'buff', id: u.id, k: 'def' }); break;
    case 'royalGuard': u.buffs.push({ k: 'def', v: 2, t: 1 }); heal(s, u, stats(u).maxHp * 0.15, ev); ev.push({ e: 'buff', id: u.id, k: 'def' }); break;
    case 'rally': u.buffs.push({ k: 'spd', v: 4, t: 2 }); u.gauge += 20; ev.push({ e: 'buff', id: u.id, k: 'spd' }); break;
    case 'sanctuary': heal(s, u, stats(u).maxHp * 0.3, ev); ev.push({ e: 'buff', id: u.id, k: 'heal' }); break;
    case 'stagger': aoe(s, u, o.tiles, o.mult, ev, (v) => { v.gauge -= 40; ev.push({ e: 'stagger', id: v.id }); }); break;
    case 'trample':
      moveUnit(s, u, o.data.x, o.data.y, ev, 'jump');
      if (u.alive) aoe(s, u, around8(u.x, u.y), 0.75, ev);
      break;
    case 'transpose': {
      const v = unitById(s, o.data.id);
      const a = pt(u.x, u.y), b = pt(v.x, v.y);
      u.x = b.x; u.y = b.y; v.x = a.x; v.y = a.y;
      ev.push({ e: 'move', id: u.id, from: a, to: b, how: 'swap' }, { e: 'move', id: v.id, from: b, to: a, how: 'swap' });
      land(s, u, ev); land(s, v, ev);
      break;
    }
    case 'charge': {
      const { dx, dy } = o.data;
      const last = o.tiles[o.tiles.length - 1];
      const v = unitAt(s, last.x, last.y);
      const solid = isSolid(s, last.x, last.y);
      const stopAt = v || solid ? o.tiles[o.tiles.length - 2] : last;
      if (stopAt) moveUnit(s, u, stopAt.x, stopAt.y, ev, 'dash');
      ev.push({ e: 'aoe', id: u.id, tiles: [last], kind: 'hit' });
      if (v) { dealDamage(s, u, v, o.mult, ev); if (v.alive) pushUnit(s, u, v, dx, dy, honed(u) ? 3 : 2, 0.4, ev); }
      else if (solid) hitTile(s, u, last.x, last.y, ev);
      break;
    }
    case 'decree': {
      const from = pt(u.x, u.y);
      const victims = o.tiles.map((t) => unitAt(s, t.x, t.y)).filter((v) => v && v !== u);
      u.x = o.data.x; u.y = o.data.y;
      ev.push({ e: 'move', id: u.id, from, to: pt(u.x, u.y), how: 'dash' });
      ev.push({ e: 'aoe', id: u.id, tiles: o.tiles, kind: 'hit' });
      for (const v of victims) dealDamage(s, u, v, o.mult, ev);
      if (u.alive) land(s, u, ev);
      break;
    }
    case 'blink':
      if (o.kind === 'mark') { u.mark = pt(u.x, u.y); ev.push({ e: 'mark', id: u.id, x: u.x, y: u.y }); cdOverride = 0; }
      else { const m = u.mark; u.mark = null; moveUnit(s, u, m.x, m.y, ev, 'blink'); }
      break;
    case 'rampart':
      s.tiles[o.anchor.y * SIZE + o.anchor.x] = { t: 'rubble', hp: 3, built: true };
      ev.push({ e: 'rampart', x: o.anchor.x, y: o.anchor.y });
      { const moved = s.items.filter((i) => i.x === o.anchor.x && i.y === o.anchor.y); s.items = s.items.filter((i) => !moved.includes(i)); for (const it of moved) dropNear(s, o.anchor.x, o.anchor.y, { k: it.k, n: it.n }); }
      break;
    case 'dominion':
      aoe(s, u, o.tiles, 0.3, ev, (v) => { v.gauge -= 30; }); // 15.0: the slow is now a real status (ST.dominion)
      break;
    case 'enPassant': case 'fork':
      moveUnit(s, u, o.data.x, o.data.y, ev, 'jump');
      if (u.alive) aoe(s, u, o.tiles, o.mult, ev);
      break;
    case 'nova': aoe(s, u, o.tiles, o.mult, ev, (v) => { v.gauge -= 30; ev.push({ e: 'stagger', id: v.id }); }); break;
    case 'divineRight': heal(s, u, stats(u).maxHp * 0.25, ev); aoe(s, u, o.tiles, o.mult, ev); break;
    case 'castling': {
      const v = unitById(s, o.data.id);
      const a = pt(u.x, u.y), b = pt(v.x, v.y);
      u.x = b.x; u.y = b.y; v.x = a.x; v.y = a.y;
      ev.push({ e: 'move', id: u.id, from: a, to: b, how: 'swap' }, { e: 'move', id: v.id, from: b, to: a, how: 'swap' });
      land(s, u, ev); land(s, v, ev);
      u.buffs.push({ k: 'def', v: 1.5, t: 1 });
      if (u.alive && ascended(u)) addStatus(s, u, 'shield', ev, { n: stats(u).maxHp * 0.25, t: 2 }); // Fortress Rook
      if (u.alive) aoe(s, u, around8(u.x, u.y), o.mult, ev);
      break;
    }
    case 'tripwire': {
      const mine = s.items.filter((i) => i.k === 'trap' && i.owner === u.id);
      if (mine.length >= 2) s.items.splice(s.items.indexOf(mine[0]), 1);
      s.items.push({ x: o.anchor.x, y: o.anchor.y, k: 'trap', n: 1, owner: u.id, team: u.team });
      ev.push({ e: 'trapSet', id: u.id, x: o.anchor.x, y: o.anchor.y });
      break;
    }
    case 'lance': { const { dx, dy } = o.data; aoe(s, u, o.tiles, o.mult, ev, (v) => pushUnit(s, u, v, dx, dy, 1, 0.3, ev)); break; }
    case 'penance': { const v = unitAt(s, o.anchor.x, o.anchor.y); ev.push({ e: 'aoe', id: u.id, tiles: o.tiles, kind: 'hit' }); if (v) { const d = dealDamage(s, u, v, o.mult, ev); if (u.alive && d > 0) heal(s, u, d * 0.5, ev); } break; }
    case 'quake': aoe(s, u, o.tiles, o.mult, ev, (v) => { v.gauge -= 25; ev.push({ e: 'stagger', id: v.id }); }); break;
    case 'gambit': { const cost = Math.max(1, Math.round(u.hp * 0.12)); u.hp = Math.max(1, u.hp - cost); u.buffs.push({ k: 'atk', v: 1.4, t: 2 }); ev.push({ e: 'dmg', id: u.id, n: cost, self: true }, { e: 'buff', id: u.id, k: 'atk' }); break; }
    case 'repel': aoe(s, u, o.tiles, o.mult, ev, (v) => pushUnit(s, u, v, sgn(v.x - u.x), sgn(v.y - u.y), 1, 0.35, ev)); break;
    case 'gravity': {
      const near = s.units.filter((v) => v.alive && v !== u && !ally(u, v) && cheb(u, v) >= 2 && cheb(u, v) <= 3).sort((a, b) => cheb(u, a) - cheb(u, b) || a.id - b.id);
      for (const v of near) { if (s.over || !u.alive) break; const nx = v.x - sgn(v.x - u.x), ny = v.y - sgn(v.y - u.y); if (v.alive && canStand(s, nx, ny)) moveUnit(s, v, nx, ny, ev, 'pull'); }
      if (u.alive && !s.over) aoe(s, u, around8(u.x, u.y), o.mult, ev);
      break;
    }
    case 'wraithStep': moveUnit(s, u, o.anchor.x, o.anchor.y, ev, 'blink'); break;
    // ---- 15.0 (C) ----
    case 'skirmish': aoe(s, u, o.tiles, o.mult, ev); if (u.alive && !s.over) addStatus(s, u, 'haste', ev, { t: 2 }); break;
    case 'warcry': aoe(s, u, o.tiles, o.mult, ev); if (u.alive && !s.over) addStatus(s, u, 'haste', ev, { t: 2 }); break;
    // 16.0 (C) tempo equips (the 'last' part is an on-hit proc in ST above)
    case 'seize': case 'fracture': aoe(s, u, o.tiles, o.mult, ev); if (u.alive && !s.over) setTempo(s, u, 'first', u, ev); break;
    case 'anchor': aoe(s, u, o.tiles, o.mult, ev); if (u.alive && !s.over) { u.buffs.push({ k: 'def', v: TEMPO_T.anchorDef, t: 1 }); ev.push({ e: 'buff', id: u.id, k: 'def' }); } break;
    case 'dart': case 'hex': case 'hourglass': {
      ev.push({ e: 'aoe', id: u.id, tiles: o.tiles, kind: 'hit' });
      const last = o.tiles[o.tiles.length - 1], v = unitAt(s, last.x, last.y);
      if (v) dealDamage(s, u, v, o.mult, ev);
      break;
    }
    case 'hoarfrost': case 'heroicLeap': case 'valor':
      moveUnit(s, u, o.data.x, o.data.y, ev, 'jump');
      if (u.alive && !s.over) aoe(s, u, o.tiles, o.mult, ev);
      break;
    case 'blessing': cleanse(s, u, ev); addStatus(s, u, 'shield', ev, { n: stats(u).maxHp * 0.25, t: 2 }); break;
    case 'shieldWall':
      addStatus(s, u, 'shield', ev, { n: stats(u).maxHp * 0.22, t: 2 });
      ev.push({ e: 'aoe', id: u.id, tiles: o.tiles, kind: 'fx' });
      for (const v of s.units.filter((w) => w.alive && w !== u && !ally(u, w) && cheb(u, w) === 1).sort((a, b) => a.id - b.id)) addStatus(s, v, 'slow', ev, { src: u.id });
      break;
    case 'hexBolt': case 'soulLance': {
      ev.push({ e: 'aoe', id: u.id, tiles: o.tiles, kind: 'hit' });
      const last = o.tiles[o.tiles.length - 1], v = unitAt(s, last.x, last.y);
      if (v) dealDamage(s, u, v, o.mult, ev);
      break;
    }
    default:
      aoe(s, u, o.tiles, o.mult, ev);
  }
  delete s._act;
  if (slot === 'ult') { u.ult = 0; u.ults = (u.ults || 0) + 1; }
  else if (slot !== 'atk' && u.piece === pieceAtCast) u.cd[slot] = cdOverride ?? abilityCd(u, id);
  if (!ABILITIES[id].free) s.turn.acted = true;
  if (s.turn) s.turn.used = true; // 16.0 (C): no Hold after any ability, free ones included
  return true;
}

export function promoteOptions(u) {
  if (u.kind !== 'player' || u.piece === 'king') return [];
  // Fixed ladder: every later rung is listed, with the total cost of climbing to it in one go.
  const best = new Map();
  const walk = (pc, acc, steps) => { for (const to of EVOLVE[pc] || []) { const c = acc + evolveCost(to); if (!best.has(to) || best.get(to).cost > c) best.set(to, { cost: c, steps: steps + 1 }); walk(to, c, steps + 1); } };
  walk(u.piece, 0, 0);
  const out = [...best.entries()].map(([to, v]) => ({ to, cost: v.cost, steps: v.steps, type: 'evolve' })).sort((a, b) => a.cost - b.cost || (a.to < b.to ? -1 : 1));
  const h = u.hone[u.piece] || 0;
  if (h < MAX_HONE) out.push({ to: 'hone', cost: honeCost(h, PIECES[u.piece].tier), type: 'hone', level: h + 1 });
  return out;
}
function promote(s, u, to, ev) {
  const o = promoteOptions(u).find((p) => p.to === to);
  if (!o || u.shards < o.cost) return false;
  const before = stats(u).maxHp;
  u.shards -= o.cost;
  if (o.type === 'evolve') { u.piece = to; u.cd = { sig: 0, eq: 0 }; u.mark = null; }
  else u.hone[u.piece] = (u.hone[u.piece] || 0) + 1;
  u.hp = Math.max(1, Math.min(stats(u).maxHp, u.hp + Math.max(0, stats(u).maxHp - before)));
  ev.push({ e: 'promote', id: u.id, piece: u.piece, hone: u.hone[u.piece] || 0, type: o.type });
  if (o.type === 'hone' && ascended(u)) { ev.push({ e: 'ascend', id: u.id, piece: u.piece }); s.log.push(`${u.name} ascended: ${ASCEND[u.piece].name}`); } // 15.0 (C)
  s.log.push(o.type === 'evolve' ? `${u.name} evolved into a ${PIECES[to].name}` : `${u.name} honed their ${PIECES[u.piece].name}`);
  return true;
}

// action: {type:'move',x,y} | {type:'ability',slot,x,y} | {type:'promote',to} | {type:'end'}
export function applyAction(s, pid, a) {
  const ev = [];
  if (s.over || !a || typeof a !== 'object') return { ok: false, ev };
  const u = unitById(s, s.active);
  if (!u || u.pid !== pid) return { ok: false, ev };
  let ok = false; s._guard = null;
  if (a.type === 'move' && canMove(s, u)) {
    const m = legalMoves(s, u).find((q) => q.x === a.x && q.y === a.y);
    if (m) {
      if (s.turn.moved) s.turn.extraMoves--; else s.turn.moved = true;
      if (m.side && BISHOP_T.sideActs) s.turn.acted = true; // 17.0 (C2): a Sidestep before acting spends the action (no free re-aim of the diagonals)
      moveUnit(s, u, m.x, m.y, ev, m.jump ? 'jump' : m.side ? 'step' : PIECES[u.piece] && u.piece !== 'pawn' && u.piece !== 'king' && !PIECES[u.piece].line ? 'slide' : 'step');
      ok = true;
    }
  } else if (a.type === 'ability' && canUse(s, u, a.slot)) {
    ok = useAbility(s, u, a.slot, { x: a.x, y: a.y }, ev);
  } else if (a.type === 'promote') {
    ok = promote(s, u, a.to, ev);
  } else if (a.type === 'hold' && canHold(s, u)) { // 16.0 (C): Hold, go to the back of this round's queue
    u.held = s.round; u.rt = null; ev.push({ e: 'hold', id: u.id }); s.log.push(`${u.name} held their turn`); ok = true;
  } else if (a.type === 'end') ok = true;

  if (ok && a.type === 'hold') { s.v++; if (!s.over) nextTurn(s, ev, true); syncBoss(s); }
  else if (ok) {
    s.v++;
    const kos = ev.filter((q) => q.e === 'death' && q.by === u.id && (unitById(s, q.id) || {}).kind === 'player').length;
    if (kos >= 2) ev.push({ e: 'multi', id: u.id, n: kos });
    if (!s.over) kingPhase(s, ev); // 15.0 (C): boss King phase shockwaves
    const done = a.type === 'end' || !u.alive || s.over || (s.turn.acted && (!canMove(s, u) || legalMoves(s, u).length === 0));
    if (done && u.passive === 'bastion') { u.braced = u.alive && !s.turn.moved; if (u.braced) ev.push({ e: 'buff', id: u.id, k: 'braced' }); }
    if (done && !s.over) nextTurn(s, ev);
    syncBoss(s);
  }
  s._guard = null;
  return { ok, ev };
}

// ---------- turn flow ----------
// 15.2: round-based initiative. Every living unit acts exactly once per round, fastest SPD first, so nobody
// gets two turns before someone else gets one. Tempo effects (Stagger, brambles, Haste pickups, Rally) still
// work: they nudge u.gauge, which moves a unit up to 6 places' worth of SPD earlier or later until it acts.
// Ties go to a seeded coin flip rolled at the start of each round, so they are fair and deterministic.
// 16.0 (C) turn-order tactics. Within a round units act by tier, then by initiative:
//   tier 0 = Seized (u.tempo = { k:'first', r }), 1 = everyone, 2 = Hourglassed (u.tempo k:'last'), 3 = Held this round (u.held === round).
// Reversal hook: while s.reversal === s.round the SPD part of initiative is negated (slowest first); gauge nudges keep
// their direction and the Speed Edge is unchanged. L's Clockwork Spire only needs to set s.reversal.
// Hold ({type:'hold'}): legal on your own turn before you move, act or use any ability (promoting is fine), once per
// round, not while frozen or stunned, and only while at least one other unit is still waiting this round. The held turn
// resumes after everyone still waiting (no second turn start: no extra DoT ticks or cooldowns), and the next round
// starts HOLD.gauge later (gauge -30 = -3 SPD).
export const HOLD = { gauge: 30 };
// 16.0 (C) tempo equips: hit multipliers, Anchor's DEF buff, bot value of acting first / of each enemy sent last
export const BOT_HOLD = { minAct: 6, range: 4, chance: 0.35 };
export const TEMPO_T = { seize: 0.8, hourglass: 0.5, anchor: 0.7, anchorDef: 1.25, fracture: 0.4, firstUtil: 4, lastUtil: 3 };
// u.tempo = { k:'first'|'last', r }: the unit acts first / last (before tier 1 / after it, before held units) in round r
function setTempo(s, v, k, by, ev) {
  if (!v || !v.alive || s.over) return;
  v.tempo = { k, r: s.round + 1 };
  ev.push({ e: 'tempo', id: v.id, k, by: by ? by.id : null, r: s.round + 1 });
}
const gaugeAdj = (u) => Math.max(-6, Math.min(6, (u.gauge || 0) / 10));
const spdSign = (s, r) => (s && s.reversal != null && s.reversal === r ? -1 : 1);
export const initiative = (u, s = null) => spdSign(s, s && s.round) * effSpd(u) + gaugeAdj(u);
export const turnTier = (u, r) => (u.held === r ? 3 : u.tempo && u.tempo.r === r ? (u.tempo.k === 'first' ? 0 : 2) : 1);
// does a act before b in round r (default: the current round)?
export function outranks(s, a, b, r = s.round) {
  const ta = turnTier(a, r), tb = turnTier(b, r); if (ta !== tb) return ta < tb;
  const g = spdSign(s, r), d = (g * effSpd(a) + gaugeAdj(a)) - (g * effSpd(b) + gaugeAdj(b)); if (Math.abs(d) > 1e-9) return d > 0;
  const e = g * (effSpd(a) - effSpd(b)); if (e) return e > 0;
  return (a.tb || 0) !== (b.tb || 0) ? (a.tb || 0) > (b.tb || 0) : a.id < b.id;
}
export function canHold(s, u) {
  const T = s && s.turn;
  return !!(T && u && !s.over && s.active === u.id && u.alive && u.kind === 'player' && !T.moved && !T.acted && !T.rooted && !T.stunned && !T.used && !T.resumed && !(T.extraMoves > 0)
    && u.held !== s.round && s.units.some((w) => w.alive && w !== u && w.rt !== s.round));
}
function nextUp(s) { let best = null; for (const u of s.units) if (u.alive && u.rt !== s.round && (!best || outranks(s, u, best))) best = u; return best; }
// a held turn resumes without a second turn start; a Freeze or Stun that landed while waiting spoils it now
function resumeTurn(s, u) {
  s.turn.resumed = true;
  for (const q of u.status || []) if (!q.live && (q.k === 'freeze' || q.k === 'stun')) { q.live = true; if (q.k === 'freeze') s.turn.rooted = true; else { s.turn.stunned = true; s.turn.acted = true; } }
}
export function nextTurn(s, ev, held = false) {
  if (s.active != null && !held) statusTurnEnd(s, unitById(s, s.active), ev); // 15.0: freeze and stun end with the turn they spoiled
  if (s.round === 1 && !s.tbInit) { s.tbInit = 1; for (const u of s.units) u.tb = rand(s); }
  for (let guard = 0; guard < 400 && !s.over; guard++) {
    let best = nextUp(s);
    if (!best) {
      if (!s.units.some((u) => u.alive)) return;
      s.round++; s.roundTurns = 0; onRound(s, ev); if (s.over) return;
      for (const u of s.units) u.tb = rand(s);
      best = nextUp(s); if (!best) return;
    }
    const resumed = best.held === s.round; // 16.0 (C): a held turn coming back
    s.pickInit = initiative(best, s); s.pickTier = turnTier(best, s.round); best.rt = s.round; best.gauge = resumed ? -HOLD.gauge : 0;
    if (best.tempo && best.tempo.r <= s.round) delete best.tempo;
    s.turnNo++;
    if (best.kind === 'player' && !resumed) s.roundTurns++;
    if (!best.alive) continue;
    s.active = best.id;
    s.turn = { moved: false, acted: false, extraMoves: 0, rooted: false };
    if (resumed) resumeTurn(s, best); else startTurn(s, best, ev);
    if (!s.over) kingPhase(s, ev);
    if (best.alive && !s.over) { ev.push(resumed ? { e: 'turn', id: best.id, resumed: true } : { e: 'turn', id: best.id }); return; }
  }
}

function startTurn(s, u, ev) {
  u.buffs = u.buffs.filter((b) => --b.t > 0 || b.t === undefined);
  if (u.braced) u.braced = false;
  statusTurn(s, u, ev); if (!u.alive || s.over) return; // 15.0 (C): burn/poison ticks, freeze/stun, Aegis, Grace, royal aura
  if (u.role === 'stalker') s.turn.extraMoves = 1;
  // 10.0: a hunting Hollow walled off from every player burrows through after two stuck turns, so no fight can stall
  if (u.kind === 'hollow' && u.hunt && !u.dummy) {
    const ps = alivePlayers(s); let tg = null; for (const p of ps) if (!tg || cheb(u, p) < cheb(u, tg)) tg = p;
    if (tg && cheb(u, tg) > 1 && !pathStep(s, u, tg)) u.stuck = (u.stuck || 0) + 1; else u.stuck = 0;
    if (u.stuck >= 2 && tg) {
      let to = null;
      for (let r = 2; r <= 4 && !to; r++) for (let dy = -r; dy <= r && !to; dy++) for (let dx = -r; dx <= r && !to; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && canStand(s, tg.x + dx, tg.y + dy) && !isVoid(s, tg.x + dx, tg.y + dy)) to = pt(tg.x + dx, tg.y + dy);
      if (to) { u.stuck = 0; ev.push({ e: 'burrow', id: u.id, from: pt(u.x, u.y), to }); moveUnit(s, u, to.x, to.y, ev, 'blink'); if (!u.alive || s.over) return; }
    }
  }
  if (s.hill && u.kind === 'player') { hillTick(s, u, ev); if (s.over) return; }
  if (u.role === 'regent' && !u.summoned && u.hp < u.hpMax * 0.5) {
    u.summoned = true;
    const spots = around8(u.x, u.y).filter((t) => canStand(s, t.x, t.y) && !isVoid(s, t.x, t.y)).slice(0, 2), ids = [];
    for (const t of spots) ids.push(mkHollow(s, t.x, t.y, { ...roleStats(ids.length ? 'stalker' : 'caster', { hpMax: Math.round(u.hpMax * 0.12), atkB: Math.round(u.atkB * 0.5), defB: 4, spdB: 9 }), hunt: true, wave: u.wave, shards: 1, gauge: 40 }).id);
    if (ids.length) ev.push({ e: 'summon', id: u.id, ids, tiles: spots });
  }
  for (const k of ['sig', 'eq']) if (u.cd[k] > 0) u.cd[k]--;
  if (u.passive === 'regen') heal(s, u, 1 + Math.floor((u.attune || 0) / 10), ev);
  if (u.piece === 'king') heal(s, u, stats(u).maxHp * KING_T.heal, ev);
  if (s.teams && u.kind === 'player' && s.units.some((w) => w.alive && ally(u, w) && cheb(u, w) <= 2)) u.buffs.push({ k: 'def', v: 1.15, t: 1, bond: true });
  const lt = tileAt(s, u.x, u.y);
  if (lt && lt.t === 'lava') { dealFixed(s, u, Math.max(4, stats(u).maxHp * 0.08), ev, 'lava'); if (!u.alive) return; }
  if (lt && lt.t === 'poison') locPoisonPool(s, u, ev); // 15.0 (W)
  if (s.storm.ring >= STORM.maxRing && u.kind === 'player') {
    // Sudden death escalates: 6% plus 2% per round since it began, so healers can never out-sustain it forever.
    // 17.0 (C2): this is Sudden Death, not the storm. The last ring never collapses; everyone on it burns. The event
    // carries sd:true (storm:true kept for older consumers: check e.sd first) and a kill is cause 'sudden', so the
    // feed / kill log never claim the storm reached a safe tile.
    if (s.storm.sdAt == null) s.storm.sdAt = s.round;
    const d = Math.max(3, Math.round(stats(u).maxHp * suddenDeathPct(s)));
    u.hp -= d; ev.push({ e: 'dmg', id: u.id, n: d, storm: true, sd: true });
    if (u.hp <= 0) { kill(s, u, null, ev, 'sudden'); return; }
  }
  if (isVoid(s, u.x, u.y)) {
    const d = Math.max(4, Math.round(stats(u).maxHp * 0.2));
    u.hp -= d; ev.push({ e: 'dmg', id: u.id, n: d, storm: true });
    if (u.hp <= 0) kill(s, u, null, ev);
  }
}

// 10.2: the void swallows everything on the collapsed rings. Walls, rubble, crates, chests, pits and hazard tiles there
// become bare floor, so pieces caught in the storm can move freely through it (the renderers already draw the void as
// empty). Arena 'out' tiles stay solid. Pieces in the void just take the storm burn at the start of their turn.
export function swallowVoid(s) {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (ringOf(x, y) >= s.storm.ring) continue;
    const t = s.tiles[y * SIZE + x];
    if (t.t !== 'floor' && t.t !== 'out') s.tiles[y * SIZE + x] = { t: 'floor' };
  }
}
function freeTiles(s, minRing) {
  const out = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (ringOf(x, y) >= Math.max(minRing, s.storm.ring + 1) && !isSolid(s, x, y) && !unitAt(s, x, y) && !s.items.some((i) => i.x === x && i.y === y)) out.push(pt(x, y));
  return out;
}
function worldEvents(s, ev) {
  const r = s.round;
  // resolve last round's event
  s.bloodMoon = 0; s.eclipse = 0; s.frenzy = 0;
  if (s.meteors.length) {
    const hit = new Set();
    for (const m of s.meteors) for (const [dx, dy] of [[0, 0], ...ORTH]) { const x = m.x + dx, y = m.y + dy; if (inB(x, y)) hit.add(y * SIZE + x); }
    const tiles = [...hit].map((i) => pt(i % SIZE, Math.floor(i / SIZE)));
    ev.push({ e: 'world', kind: 'meteor', phase: 'strike', tiles, centers: s.meteors });
    for (const t of tiles) { const v = unitAt(s, t.x, t.y); if (v) dealFixed(s, v, 26, ev, 'meteor'); else hitTile(s, null, t.x, t.y, ev); if (s.over) break; }
    s.meteors = [];
    if (s.over) return;
  }
  locResolve(s, ev); if (s.over) return; // 15.0 (W): telegraphed location events strike, sandstorm clears
  if (s.custom && s.custom.events === false) return; // 15.0 (W): Custom lobby with world events off
  const EV = (s.rules && s.rules.events) || 3;
  if (r < EV || r % EV !== 0) return;
  const nAlive = alivePlayers(s).length;
  const pool = (s.siege ? ['shardRain', 'supply', ...(s.siege.gauntlet ? ['manaSurge'] : [])] : r < CALM_ROUNDS ? ['shardRain', 'supply', 'earthquake', 'manaSurge', 'frenzy']
    : ['shardRain', 'meteor', 'bloodMoon', 'supply', 'earthquake', 'manaSurge', 'frenzy', 'eclipse', 'restless', ...(nAlive >= 3 ? ['bounty'] : [])]).filter((k) => k !== s.lastEvent);
  const kind = s.location ? locPickEvent(s, pool, r) : pool[ri(s, pool.length)]; // 15.0 (W): location-weighted pool
  if (!kind) return;
  s.lastEvent = kind;
  if (kind === 'shardRain') {
    const f = freeTiles(s, 1); const tiles = [];
    const nRain = Math.max(4, Math.min(10, alivePlayers(s).length + 2));
    for (let i = 0; i < nRain && f.length; i++) { const t = f.splice(ri(s, f.length), 1)[0]; s.items.push({ x: t.x, y: t.y, k: 'shard', n: 1 }); tiles.push(t); }
    ev.push({ e: 'world', kind, tiles });
  } else if (kind === 'meteor') {
    const players = alivePlayers(s); const ms = [];
    for (let i = 0; i < Math.min(5, players.length + 1); i++) {
      const p = players[i % players.length];
      const x = Math.max(0, Math.min(SIZE - 1, p.x + ri(s, 3) - 1)), y = Math.max(0, Math.min(SIZE - 1, p.y + ri(s, 3) - 1));
      if (!ms.some((m) => m.x === x && m.y === y)) ms.push(pt(x, y));
    }
    s.meteors = ms;
    ev.push({ e: 'world', kind, phase: 'warn', centers: ms });
  } else if (kind === 'bloodMoon') { s.bloodMoon = 1; ev.push({ e: 'world', kind }); }
  else if (kind === 'supply') {
    const f = freeTiles(s, 3).filter((t) => s.tiles[t.y * SIZE + t.x].t === 'floor');
    if (f.length) { const t = f[ri(s, f.length)]; s.tiles[t.y * SIZE + t.x] = { t: 'chest', hp: 3 }; ev.push({ e: 'world', kind, x: t.x, y: t.y }); }
  }
  else if (kind === 'eclipse') { s.eclipse = 1; ev.push({ e: 'world', kind }); }
  else if (kind === 'frenzy') { s.frenzy = 1; const ids = []; for (const u of s.units) if (u.alive) { u.buffs.push({ k: 'spd', v: 3, t: 2, frenzy: true }); ids.push(u.id); } ev.push({ e: 'world', kind, ids }); }
  else if (kind === 'manaSurge') { const ids = []; const sub = []; for (const u of alivePlayers(s)) { chargeUlt(u, 35, sub); ids.push(u.id); } ev.push({ e: 'world', kind, ids }, ...sub); }
  else if (kind === 'bounty') {
    const ps = alivePlayers(s).slice().sort((a, b) => b.kills - a.kills || (b.attune || 0) - (a.attune || 0) || (b.piece === 'king') - (a.piece === 'king') || a.id - b.id);
    if (ps.length) { s.bounty = { id: ps[0].id, round: r }; ev.push({ e: 'world', kind, id: ps[0].id }); }
  } else if (kind === 'earthquake') {
    const tiles = [];
    const walls = []; for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (s.tiles[y * SIZE + x].t === 'wall' && !isVoid(s, x, y)) walls.push(pt(x, y));
    for (let i = 0; i < 6 && walls.length; i++) { const t = walls.splice(ri(s, walls.length), 1)[0]; s.tiles[t.y * SIZE + t.x] = { t: 'rubble', hp: 1 }; tiles.push({ x: t.x, y: t.y, t: 'rubble' }); }
    const f = freeTiles(s, 1).filter((t) => s.tiles[t.y * SIZE + t.x].t === 'floor' && !alivePlayers(s).some((p) => cheb(p, t) <= 1));
    for (let i = 0; i < 4 && f.length; i++) { const t = f.splice(ri(s, f.length), 1)[0]; s.tiles[t.y * SIZE + t.x] = { t: 'rubble', hp: 2 }; tiles.push({ x: t.x, y: t.y, t: 'rubble', rise: true }); }
    ev.push({ e: 'world', kind, tiles });
  } else if (kind === 'restless') {
    const ps = alivePlayers(s);
    const f = freeTiles(s, 1).filter((t) => ps.every((p) => cheb(p, t) >= 3));
    const tiles = [], ids = [];
    for (let i = 0; i < Math.min(3, Math.ceil(ps.length / 3)) && f.length; i++) {
      const t = f.splice(ri(s, f.length), 1)[0];
      const h = mkHollow(s, t.x, t.y, { hunt: true, risen: true, name: 'Risen Hollow', hpMax: Math.round(HOLLOW_STATS.hp * 1.2), atkB: HOLLOW_STATS.atk + 2, gauge: 0, shards: 2 });
      tiles.push(t); ids.push(h.id);
    }
    ev.push({ e: 'world', kind, tiles, ids });
  }
  else if (Object.prototype.hasOwnProperty.call(LOC_EVENTS, kind)) locEvent(s, kind, ev); // 15.0 (W)
  s.event = { kind, round: r };
}

// ---------- 15.0 (W): locations ----------
// Data and tuning live in js/locations.js. State: s.location (id), s.locWarn (a telegraphed event waiting to strike:
// { kind, round, tiles, centers?, center?, area?, rings? }), s.sandstorm (1 for the round of a Sandstorm).
// Events: {e:'location', id} (first state, see introEvents), {e:'world', kind, phase:'warn'|'strike', ...} for the
// telegraphed ones and {e:'world', kind, ...} for the instant ones; statuses go through C's applyStatus.
const wOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
// Normalise createMatch opts: retired mode ids, Custom rules. Never throws on junk.
function matchOpts(o) {
  const src = o && typeof o === 'object' ? o : {};
  const out = { ...src };
  let extra = null;
  if (typeof src.mode === 'string' && !wOwn(MODES, src.mode) && wOwn(MODE_ALIAS, src.mode)) { const a = MODE_ALIAS[src.mode]; out.mode = a.mode; extra = a.custom || null; }
  else if (!(typeof src.mode === 'string' && wOwn(MODES, src.mode))) out.mode = 'royale';
  out.custom = sanitizeCustom({ ...(src.custom && typeof src.custom === 'object' ? src.custom : {}), ...(extra || {}) });
  if (!wOwn(MUTATORS, out.mutator)) delete out.mutator;
  return out;
}
// The first state's events: the location reveal (the wheel lands on it). GameHost.start publishes these.
export function introEvents(s) { return s && s.location ? [{ e: 'location', id: s.location }] : []; }
function locSetup(s, opts) {
  s.location = chooseLocation(s.seed, opts, opts.custom);
  s.locWarn = null; s.sandstorm = 0; s.reversal = 0; // 16.0 (L) spire: s.reversal = the round being played in reverse
  if (opts.custom.storm !== 'normal') { const r = stormRules(s.rules.first, s.rules.every, opts.custom.storm); s.rules.first = r.first; s.rules.every = r.every; }
  s.custom = opts.custom;
}
// A build every piece shares: opts.mirrorBuild, else in Daily the first human's build (the build of the day main.js
// hands out), else null (createMatch rolls one from the seed). Anything malformed is ignored.
function mirrorGiven(players, opts, modeId) {
  const ok = (b) => {
    if (!b || typeof b !== 'object' || !b.pts || typeof b.pts !== 'object' || !wOwn(PASSIVES, b.passive)) return null;
    const pts = {}; let tot = 0;
    for (const k of ['hp', 'atk', 'def', 'spd']) { const v = Math.floor(Number(b.pts[k]) || 0); if (v < 0 || v > 10) return null; pts[k] = v; tot += v; }
    if (tot > 10) return null;
    const equips = {};
    for (const pc of Object.keys(PIECES)) { const E = PIECES[pc].equips || []; if (!E.length) continue; equips[pc] = b.equips && E.includes(b.equips[pc]) ? b.equips[pc] : E[0]; }
    return { pts, passive: b.passive, equips };
  };
  if (opts.mirrorBuild) { const b = ok(opts.mirrorBuild); if (b) return b; }
  if (modeId === 'daily') { const h = players.find((p) => p && !p.isBot); if (h) return ok(h.build); }
  return null;
}
function locHazards(s, M, opts, arena) {
  let mut;
  if (wOwn(MUTATORS, opts.mutator)) mut = opts.mutator;
  else if (arena || s.siege || opts.custom.hazards === false) mut = 'none';
  else if (M.chaos) mut = 'chaos';
  else { const pool = (LOCATIONS[s.location] || {}).hazards || ['none']; mut = pool[ri(s, pool.length)]; }
  if (!wOwn(MUTATORS, mut)) mut = 'none';
  s.mutator = mut;
  if (mut === 'chaos') {
    const pool = HAZARDS.slice(); s.mutators = [];
    const own = opts.mutator ? [] : ((LOCATIONS[s.location] || {}).hazards || []).filter((h) => h !== 'brambles');
    if (own.length) { const h = own[ri(s, own.length)]; s.mutators.push(h); if (pool.includes(h)) pool.splice(pool.indexOf(h), 1); }
    while (s.mutators.length < 2 && pool.length) s.mutators.push(pool.splice(ri(s, pool.length), 1)[0]);
  }
  return mut;
}
function locPickEvent(s, pool, r) {
  const calm = !s.siege && r < CALM_ROUNDS;
  return weightedPick(eventWeights(s.location, pool, { calm, last: s.lastEvent }), rand(s));
}
// Statuses go through C's status system (addStatus / removeStatus in the 15.0 (C) section).
function locStatus(s, u, k, ev, t, n, src) { if (u && u.alive && !s.over) addStatus(s, u, k, ev, { t, n, src }); }
function locCleanse(s, u, ks, ev) { if (u && u.alive) for (const k of ks) removeStatus(s, u, k, ev); }
function locPoisonPool(s, u, ev) {
  if (!u.alive || s.over || isVoid(s, u.x, u.y)) return;
  ev.push({ e: 'hazard', kind: 'poison', x: u.x, y: u.y, id: u.id });
  locStatus(s, u, 'poison', ev, LOC_T.poisonPool.t, LOC_T.poisonPool.poison, 'poisonPool');
}
const SHELTER = { wall: 1, rubble: 1, crate: 1, chest: 1, shrine: 1 };
const sheltered = (s, u) => DIRS8.some(([dx, dy]) => { const t = tileAt(s, u.x + dx, u.y + dy); return !!t && !!SHELTER[t.t]; });
const liveTile = (s, x, y) => inB(x, y) && !isVoid(s, x, y) && tileAt(s, x, y).t !== 'out';
const emptyFloor = (s, x, y) => liveTile(s, x, y) && tileAt(s, x, y).t === 'floor' && !unitAt(s, x, y) && !s.items.some((i) => i.x === x && i.y === y);
function areaTiles(s, a) { const out = []; for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) if (liveTile(s, x, y)) out.push(pt(x, y)); return out; }
// Start a location event (warn for telegraphed ones, effect at once for the rest).
function locEvent(s, kind, ev) {
  const r = s.round, ps = alivePlayers(s);
  if (kind === 'blizzard') {
    const halves = [{ x0: 0, y0: 0, x1: 7, y1: 15 }, { x0: 8, y0: 0, x1: 15, y1: 15 }, { x0: 0, y0: 0, x1: 15, y1: 7 }, { x0: 0, y0: 8, x1: 15, y1: 15 }];
    const area = halves[ri(s, 4)], tiles = areaTiles(s, area);
    s.locWarn = { kind, round: r, area, tiles };
    ev.push({ e: 'world', kind, phase: 'warn', area, tiles });
  } else if (kind === 'eruption') {
    const centers = [];
    for (let i = 0; i < Math.min(4, ps.length + 1) && ps.length; i++) {
      const p = ps[i % ps.length];
      const x = Math.max(0, Math.min(SIZE - 1, p.x + ri(s, 3) - 1)), y = Math.max(0, Math.min(SIZE - 1, p.y + ri(s, 3) - 1));
      if (liveTile(s, x, y) && !centers.some((c) => c.x === x && c.y === y)) centers.push(pt(x, y));
    }
    const tiles = []; for (const c of centers) for (const [dx, dy] of [[0, 0], ...ORTH]) { const x = c.x + dx, y = c.y + dy; if (liveTile(s, x, y) && !tiles.some((t) => t.x === x && t.y === y)) tiles.push(pt(x, y)); }
    s.locWarn = { kind, round: r, centers, tiles };
    ev.push({ e: 'world', kind, phase: 'warn', centers, tiles });
  } else if (kind === 'flood') {
    const lo = s.storm.ring, hi = Math.min(5, s.storm.ring + LOC_T.flood.band - 1);
    const tiles = []; if (lo <= hi) for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { const g = ringOf(x, y); if (g >= lo && g <= hi && liveTile(s, x, y)) tiles.push(pt(x, y)); }
    s.locWarn = { kind, round: r, rings: [lo, hi], tiles };
    ev.push({ e: 'world', kind, phase: 'warn', rings: [lo, hi], tiles });
  } else if (kind === 'gravityWell') {
    const f = freeTiles(s, Math.min(6, s.storm.ring + 2));
    const near = f.filter((t) => ps.some((p) => cheb(p, t) <= LOC_T.gravityWell.radius && cheb(p, t) >= 2));
    const pool = near.length ? near : f;
    if (!pool.length) return;
    const center = pool[ri(s, pool.length)];
    const tiles = [center, ...around8(center.x, center.y).filter((t) => liveTile(s, t.x, t.y))];
    s.locWarn = { kind, round: r, center, radius: LOC_T.gravityWell.radius, tiles };
    ev.push({ e: 'world', kind, phase: 'warn', center, radius: LOC_T.gravityWell.radius, tiles });
  } else if (kind === 'toxicFog') {
    const p = ps.length ? ps[ri(s, ps.length)] : pt(7, 7);
    const x0 = Math.max(0, Math.min(SIZE - 6, p.x - 2 - ri(s, 2))), y0 = Math.max(0, Math.min(SIZE - 6, p.y - 2 - ri(s, 2)));
    const area = { x0, y0, x1: x0 + 5, y1: y0 + 5 }, tiles = areaTiles(s, area);
    s.locWarn = { kind, round: r, area, tiles };
    ev.push({ e: 'world', kind, phase: 'warn', area, tiles });
  } else if (kind === 'bloom') {
    const ids = [], made = [], sub = [];
    for (const u of ps) { ids.push(u.id); locCleanse(s, u, ['burn', 'poison'], sub); heal(s, u, stats(u).maxHp * LOC_T.bloom.heal, sub); }
    const f = freeTiles(s, s.storm.ring + 1).filter((t) => tileAt(s, t.x, t.y).t === 'floor' && ps.every((p) => cheb(p, t) >= 2));
    for (let i = 0; i < LOC_T.bloom.brambles && f.length; i++) { const t = f.splice(ri(s, f.length), 1)[0]; s.tiles[t.y * SIZE + t.x] = { t: 'bramble' }; made.push({ x: t.x, y: t.y, t: 'bramble' }); }
    ev.push({ e: 'world', kind, ids, made }, ...sub);
  } else if (kind === 'sandstorm') {
    s.sandstorm = 1; const ids = ps.map((u) => u.id), sub = [];
    for (const u of ps) locStatus(s, u, 'slow', sub, LOC_T.sandstorm.slow, 1, 'sandstorm');
    ev.push({ e: 'world', kind, ids }, ...sub);
  } else if (kind === 'overcharge') {
    const ids = [], stunned = [], sub = [];
    for (const u of ps) { ids.push(u.id); if (u.cd && typeof u.cd === 'object') for (const k of Object.keys(u.cd)) u.cd[k] = 0; chargeUlt(u, LOC_T.overcharge.ult, sub); }
    for (const u of s.units) if (u.alive) { const t = tileAt(s, u.x, u.y); if (t && t.t === 'conveyor' && !isVoid(s, u.x, u.y)) { stunned.push(u.id); locStatus(s, u, 'stun', sub, LOC_T.overcharge.stun, 1, 'overcharge'); } }
    ev.push({ e: 'world', kind, ids, stunned }, ...sub);
  } else if (kind === 'reversal') spireReversalWarn(s, ev); // 16.0 (L) spire
}
// Called at the top of every round (from worldEvents): clear one-round flags and strike a pending telegraph.
function locResolve(s, ev) {
  s.sandstorm = 0;
  if (spireReversalTick(s, ev)) return; // 16.0 (L) spire: Reversal ends / strikes
  const W = s.locWarn; if (!W) return;
  s.locWarn = null;
  const tiles = (W.tiles || []).filter((t) => liveTile(s, t.x, t.y));
  const inSet = new Set(tiles.map((t) => t.y * SIZE + t.x));
  const victims = () => s.units.filter((u) => u.alive && inSet.has(u.y * SIZE + u.x)).sort((a, b) => a.id - b.id);
  const sub = [];
  if (W.kind === 'blizzard') {
    const ids = [];
    for (const u of victims()) if (!sheltered(s, u)) { ids.push(u.id); locStatus(s, u, 'freeze', sub, LOC_T.blizzard.freeze, 1, 'blizzard'); }
    const f = tiles.filter((t) => emptyFloor(s, t.x, t.y)), made = [];
    for (let i = 0; i < LOC_T.blizzard.ice && f.length; i++) { const t = f.splice(ri(s, f.length), 1)[0]; s.tiles[t.y * SIZE + t.x] = { t: 'ice' }; made.push({ x: t.x, y: t.y, t: 'ice' }); }
    ev.push({ e: 'world', kind: 'blizzard', phase: 'strike', area: W.area, tiles, ids, made }, ...sub);
  } else if (W.kind === 'eruption') {
    const ids = [], made = [];
    ev.push({ e: 'world', kind: 'eruption', phase: 'strike', centers: W.centers, tiles, ids });
    const strike = ev[ev.length - 1];
    for (const u of victims()) {
      ids.push(u.id);
      dealFixed(s, u, Math.max(4, stats(u).maxHp * LOC_T.eruption.dmg), ev, 'eruption'); if (s.over) return;
      if (u.alive) locStatus(s, u, 'burn', ev, LOC_T.eruption.burn, 1, 'eruption');
    }
    for (const c of W.centers || []) { if (made.length >= LOC_T.eruption.lava) break; if (emptyFloor(s, c.x, c.y)) { s.tiles[c.y * SIZE + c.x] = { t: 'lava' }; made.push({ x: c.x, y: c.y, t: 'lava' }); } }
    strike.made = made;
  } else if (W.kind === 'flood') {
    const ids = [];
    for (const u of victims()) { ids.push(u.id); locStatus(s, u, 'slow', sub, LOC_T.flood.slow, 1, 'flood'); }
    ev.push({ e: 'world', kind: 'flood', phase: 'strike', rings: W.rings, tiles, ids }, ...sub);
  } else if (W.kind === 'toxicFog') {
    const ids = [];
    for (const u of victims()) { ids.push(u.id); locStatus(s, u, 'poison', sub, LOC_T.toxicFog.t, LOC_T.toxicFog.poison, 'toxicFog'); }
    ev.push({ e: 'world', kind: 'toxicFog', phase: 'strike', area: W.area, tiles, ids }, ...sub);
  } else if (W.kind === 'gravityWell') {
    const c = W.center, G = LOC_T.gravityWell, ids = [], hit = [];
    ev.push({ e: 'world', kind: 'gravityWell', phase: 'strike', center: c, radius: G.radius, tiles, ids, hit });
    const pulled = s.units.filter((u) => u.alive && cheb(u, c) <= G.radius && !isVoid(s, u.x, u.y)).sort((a, b) => cheb(a, c) - cheb(b, c) || a.id - b.id);
    for (const u of pulled) {
      if (!u.alive) continue;
      let moved = false;
      for (let k = 0; k < G.pull && u.alive && !s.over; k++) {
        const d = cheb(u, c); if (d <= 1) break;
        const opts = around8(u.x, u.y).filter((t) => canStand(s, t.x, t.y) && !isVoid(s, t.x, t.y) && cheb(t, c) < d);
        if (!opts.length) break;
        opts.sort((a, b) => (Math.abs(a.x - c.x) + Math.abs(a.y - c.y)) - (Math.abs(b.x - c.x) + Math.abs(b.y - c.y)) || a.y - b.y || a.x - b.x);
        moveUnit(s, u, opts[0].x, opts[0].y, ev, 'pull'); moved = true;
      }
      if (s.over) return;
      if (moved) ids.push(u.id);
      if (u.alive && cheb(u, c) <= 1) { hit.push(u.id); dealFixed(s, u, Math.max(3, stats(u).maxHp * G.dmg), ev, 'gravityWell'); if (s.over) return; }
    }
  }
}

// ---------- 16.0 (L) spire: Clockwork Spire (Cogwheels hazard + Reversal signature event) ----------
// Cog tiles {t:'cog', ring, i, hx, hy}: each ring is a 2x2 gear, i = 0 top-left, 1 top-right, 2 bottom-right,
// 3 bottom-left (clockwise on screen); (hx, hy) is the hub, the corner point the four tiles share. Cogs are plain floor
// for movement, abilities and bots. At the end of every round (hazardsTick) a piece on a cog steps to the next cog of
// its ring if that tile is free; a ring with a piece on every cog turns as a whole. A ring loses its turn once the storm
// swallows one of its cogs (they become floor). Events: {e:'cog', moves:[{id, fx, fy, x, y}]} then the move events.
function spireCogsGen(s, free, set, reserved, randFree) {
  const C = LOC_T.cogs || { rings: 4, min: 2 };
  const nearCog = (x, y) => { for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) { const t = tileAt(s, x + dx, y + dy); if (t && t.t === 'cog') return true; } return false; };
  for (let k = 0, made = 0; k < 80 && made < C.rings; k++) {
    const p = randFree(2); if (!p) break;
    const [x, y] = p, Q = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    if (!Q.every(([qx, qy]) => free(qx, qy) && ringOf(qx, qy) >= 2) || nearCog(x, y)) continue;
    Q.forEach(([qx, qy], i) => { set(qx, qy, 'cog', { ring: made, i, hx: x + 1, hy: y + 1 }); reserved.add(qy * SIZE + qx); });
    made++;
  }
}
function spireCogsTick(s, ev) {
  const rings = new Map();
  for (let i = 0; i < s.tiles.length; i++) {
    const t = s.tiles[i]; if (t.t !== 'cog') continue;
    const x = i % SIZE, y = (i / SIZE) | 0; if (isVoid(s, x, y)) continue;
    let R = rings.get(t.ring); if (!R) rings.set(t.ring, (R = [null, null, null, null]));
    R[t.i & 3] = pt(x, y);
  }
  const moves = [], movers = [];
  for (const key of [...rings.keys()].sort((a, b) => a - b)) {
    const R = rings.get(key);
    const occ = R.map((p) => (p ? unitAt(s, p.x, p.y) : null));
    if (!occ.some(Boolean)) continue;
    if (R.every(Boolean) && occ.every(Boolean)) { // a full gear turns as one
      occ.forEach((u, i) => { const to = R[(i + 1) & 3]; movers.push([u, pt(u.x, u.y)]); u.x = to.x; u.y = to.y; });
      continue;
    }
    const done = new Set();
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < 4; i++) { // riders step into free cogs; a queue advances over the passes
      const p = R[i]; if (!p) continue;
      const u = unitAt(s, p.x, p.y); if (!u || done.has(u.id)) continue;
      const to = R[(i + 1) & 3]; if (!to || !canStand(s, to.x, to.y)) continue;
      done.add(u.id); movers.push([u, pt(u.x, u.y)]); u.x = to.x; u.y = to.y;
    }
  }
  if (!movers.length) return;
  for (const [u, f] of movers) moves.push({ id: u.id, fx: f.x, fy: f.y, x: u.x, y: u.y });
  ev.push({ e: 'cog', moves });
  for (const [u, f] of movers) ev.push({ e: 'move', id: u.id, from: f, to: pt(u.x, u.y), how: 'cog' });
  for (const [u] of movers) { if (s.over) return; if (u.alive) land(s, u, ev); }
}
// Reversal: telegraphed one round ahead (s.locWarn, no tiles), then for exactly one round the turn order runs slowest
// SPD first (C's nextUp/predictOrder read s.reversal === s.round). Speed Edge is unchanged. s.reversal is set to the
// coming round as soon as it is telegraphed, so predictOrder's next-round preview already shows it reversed.
function spireReversalWarn(s, ev) {
  s.reversal = s.round + 1;
  s.locWarn = { kind: 'reversal', round: s.round, tiles: [] };
  ev.push({ e: 'world', kind: 'reversal', phase: 'warn', tiles: [], round: s.reversal });
}
// From locResolve at the top of each round. Returns true when it consumed the pending Reversal telegraph.
function spireReversalTick(s, ev) {
  if (s.reversal && s.reversal < s.round) { s.reversal = 0; ev.push({ e: 'reversal', on: false }); }
  const W = s.locWarn;
  if (!W || W.kind !== 'reversal') return false;
  s.locWarn = null;
  if (s.reversal === s.round) ev.push({ e: 'reversal', on: true, round: s.round });
  return true;
}

// ---------- 10.0: map hazards, once per round ----------
function hazardsTick(s, ev) {
  const r = s.round;
  if (mutOn(s, 'geysers')) {
    const warn = [], erupt = [];
    for (let i = 0; i < s.tiles.length; i++) { const t = s.tiles[i]; if (t.t !== 'geyser') continue; t.ph = ((t.ph || 0) + 1) % 3; const p = pt(i % SIZE, (i / SIZE) | 0); if (isVoid(s, p.x, p.y)) continue; if (t.ph === 2) warn.push(p); else if (t.ph === 0) erupt.push(p); }
    if (warn.length) ev.push({ e: 'hazard', kind: 'geyser', phase: 'warn', tiles: warn });
    if (erupt.length) {
      const hit = []; for (const g of erupt) for (const [dx, dy] of [[0, 0], ...ORTH]) if (inB(g.x + dx, g.y + dy) && !hit.some((h) => h.x === g.x + dx && h.y === g.y + dy)) hit.push(pt(g.x + dx, g.y + dy));
      ev.push({ e: 'hazard', kind: 'geyser', phase: 'erupt', tiles: hit, centers: erupt });
      for (const t of hit) {
        const v = unitAt(s, t.x, t.y); if (!v) continue;
        dealFixed(s, v, Math.max(6, stats(v).maxHp * 0.1), ev, 'geyser'); if (s.over) return;
        if (!v.alive) continue;
        v.gauge -= 15;
        const g = erupt.find((c) => c.x === v.x && c.y === v.y);
        if (g) { const to = ORTH.map(([dx, dy]) => pt(v.x + dx * 2, v.y + dy * 2)).concat(around8(v.x, v.y)).find((q) => canStand(s, q.x, q.y) && !isVoid(s, q.x, q.y)); if (to) moveUnit(s, v, to.x, to.y, ev, 'jump'); if (s.over) return; }
      }
    }
  }
  if (mutOn(s, 'conveyor')) {
    const riders = s.units.filter((u) => u.alive && tileAt(s, u.x, u.y) && tileAt(s, u.x, u.y).t === 'conveyor').sort((a, b) => a.id - b.id);
    let moved = 0;
    for (let pass = 0; pass < 2; pass++) for (const u of riders) { // two passes so a queue of riders all advance
      if (u._rode || !u.alive) continue;
      const t = tileAt(s, u.x, u.y); if (!t || t.t !== 'conveyor') continue;
      const nx = u.x + t.dx, ny = u.y + t.dy;
      if (canStand(s, nx, ny)) { u._rode = true; moveUnit(s, u, nx, ny, ev, 'conveyor'); moved++; if (s.over) break; }
    }
    for (const u of riders) delete u._rode;
    if (moved) ev.push({ e: 'hazard', kind: 'conveyor', n: moved });
    if (s.over) return;
  }
  if (mutOn(s, 'cogs')) { spireCogsTick(s, ev); if (s.over) return; } // 16.0 (L) spire
  if (mutOn(s, 'rift') && r >= 3 && r % 3 === 0) {
    const ps = alivePlayers(s).filter((u) => !isVoid(s, u.x, u.y));
    if (ps.length >= 2) {
      const a = ps.splice(ri(s, ps.length), 1)[0]; const others = ps.filter((v) => !ally(a, v)); const b = (others.length ? others : ps)[ri(s, (others.length ? others : ps).length)];
      const pa = pt(a.x, a.y), pb = pt(b.x, b.y);
      ev.push({ e: 'hazard', kind: 'rift', a: a.id, b: b.id, from: pa, to: pb });
      a.x = pb.x; a.y = pb.y; b.x = pa.x; b.y = pa.y;
      ev.push({ e: 'move', id: a.id, from: pa, to: pb, how: 'swap' }, { e: 'move', id: b.id, from: pb, to: pa, how: 'swap' });
      land(s, a, ev); if (!s.over) land(s, b, ev);
    }
  }
}
// ---------- 10.0: King of the Hill ----------
// Start a turn on the Throne: +2 if you hold it alone, +1 if it is contested.
function hillTick(s, u, ev) {
  const H = s.hill;
  if (!onThrone(s, u.x, u.y)) { if (H.holder === u.id) H.holder = null; return; }
  const on = alivePlayers(s).filter((v) => onThrone(s, v.x, v.y));
  const contested = on.some((v) => v !== u && !ally(u, v));
  const add = contested ? H.contested : H.alone;
  H.score[u.id] = (H.score[u.id] || 0) + add; H.holder = contested ? null : u.id;
  ev.push({ e: 'hill', phase: contested ? 'contested' : 'score', id: u.id, add, n: H.score[u.id], goal: H.goal, ids: on.map((v) => v.id) });
  chargeUlt(u, 6, ev);
  if (H.score[u.id] >= H.goal) endHill(s, u, ev);
}
function endHill(s, u, ev) {
  const H = s.hill;
  const ps = s.units.filter((w) => w.kind === 'player').sort((a, b) => (H.score[b.id] || 0) - (H.score[a.id] || 0) || (b.alive - a.alive) || ((a.place || 99) - (b.place || 99)) || a.id - b.id);
  let pl = 2; for (const w of ps) w.place = w === u ? 1 : pl++;
  s.over = true; s.winner = u.id;
  s.log.push(`${u.name} held the Throne`);
  ev.push({ e: 'over', winner: u.id, hill: true, team: u.team });
}
// 16.0 (C) Shard Interest: at the start of each round every living player gains +1 shard per INTEREST.per held (max INTEREST.max).
export const INTEREST = { per: 5, max: 2 };
export const interestFor = (u) => (u && u.alive && u.kind === 'player' && u.piece !== 'king' ?Math.min(INTEREST.max, Math.floor((u.shards || 0) / INTEREST.per)) : 0);
function shardInterest(s, ev) {
  for (const u of s.units) { const n = interestFor(u); if (n > 0) { gainShards(s, u, n, ev); ev.push({ e: 'interest', id: u.id, n }); } }
}
function onRound(s, ev) {
  for (const t of s.tiles) if (t.t === 'shrine' && t.cd > 0) t.cd--;
  const r = s.round;
  if (s.tutorial) return;
  shardInterest(s, ev); // 16.0 (C)
  for (const it of s.items) if (it.k === 'soul' && r >= it.exp) { ev.push({ e: 'soulFade', of: it.id, x: it.x, y: it.y }); it.gone = true; }
  s.items = s.items.filter((i) => !i.gone);
  worldEvents(s, ev);
  if (s.over) return;
  hazardsTick(s, ev);
  if (s.over) return;
  if (s.siege) {
    const S = s.siege;
    // bosses enrage when a fight drags on (sooner in the Gauntlet), so every run ends
    if (r - S.since > (S.gauntlet ? SIEGE_T.enrage : SIEGE_T.enrage + 4)) for (const b of s.units) if (b.alive && b.boss) { b.atkB = Math.round(b.atkB * 1.08) + 1; b.spdB = Math.min(16, (b.spdB || 7) + 1); b.hunt = true; ev.push({ e: 'enrage', id: b.id }); }
    if ((S.next && r >= S.next) || (S.wave > 0 && S.wave < S.waves && !S.next && r - S.since >= (S.gauntlet ? SIEGE_T.gForce : SIEGE_T.force))) spawnWave(s, ev);
    else if (S.wave >= S.waves && r - S.since >= 8 && s.units.some((w) => w.alive && w.wave && !w.boss)) { ev.push({ e: 'msg', text: 'The last Hollows crumble. Only the boss remains.', tone: 'cyan' }); for (const h of s.units.filter((w) => w.alive && w.wave && !w.boss)) { kill(s, h, null, ev, 'crumble'); if (s.over) break; } }
  }
  const R = s.rules || { first: STORM.firstCrack, every: STORM.every, crown: CROWN_ROUND };
  if (s.storm.ring < STORM.maxRing && r >= R.first && (r - R.first) % R.every === 0 && !s.storm.crack) {
    s.storm.crack = true;
    ev.push({ e: 'storm', phase: 'crack', ring: s.storm.ring });
  } else if (s.storm.crack && (R.every === 1 || (r - R.first) % R.every === 1)) {
    s.storm.crack = false; s.storm.ring++;
    swallowVoid(s);
    s.items = s.items.filter((i) => i.k === 'crown' || !isVoid(s, i.x, i.y));
    for (const it of s.items) if (it.k === 'crown' && isVoid(s, it.x, it.y)) {
      const ft = freeTiles(s, s.storm.ring + 2); let c = ft.length ? ft[ri(s, ft.length)] : null;
      for (let y = 0; y < SIZE && !c; y++) for (let x = 0; x < SIZE && !c; x++) if (!isVoid(s, x, y) && !isSolid(s, x, y) && !unitAt(s, x, y)) c = pt(x, y);
      if (!c) { c = pt(7, 7); if (isSolid(s, 7, 7)) s.tiles[7 * SIZE + 7] = { t: 'floor' }; }
      it.x = c.x; it.y = c.y;
    }
    ev.push({ e: 'storm', phase: 'collapse', ring: s.storm.ring });
  }
  // 17.0 (C2): announce Sudden Death every round it runs ({e:'suddenDeath', round, pct, first}) with the burn for the round
  if (suddenDeath(s)) {
    const first = s.storm.sdAt == null; if (first) s.storm.sdAt = r;
    const pct = Math.round(suddenDeathPct(s) * 100);
    ev.push({ e: 'suddenDeath', round: r, pct, first });
    s.log.push(`Sudden Death: every piece burns ${pct}% max HP this turn`);
  }
  // 15.0 (C): the Crown is telegraphed a round early (s.crownWarn, {e:'crownWarn'}) so claiming it is a race.
  const crownSpot = () => { const ft = freeTiles(s, Math.max(3, s.storm.ring + (s.storm.crack ? 3 : 2))); return ft.length ? ft[ri(s, ft.length)] : pt(7, 7); };
  if (!s.crownSpawned && !s.crownWarn && r >= R.crown - 1) {
    const p = crownSpot(); s.crownWarn = { x: p.x, y: p.y, round: Math.max(r + 1, R.crown) };
    ev.push({ e: 'crownWarn', x: p.x, y: p.y, round: s.crownWarn.round });
    s.log.push('The Crown will appear next round');
  }
  if (!s.crownSpawned && s.crownWarn && r >= s.crownWarn.round) {
    s.crownSpawned = true;
    let spot = pt(s.crownWarn.x, s.crownWarn.y); s.crownWarn = null;
    const on = unitAt(s, spot.x, spot.y);
    if (isVoid(s, spot.x, spot.y) || (on && on.kind !== 'player')) spot = nearestStand(s, spot.x, spot.y) || pt(7, 7);
    if (isSolid(s, spot.x, spot.y)) s.tiles[spot.y * SIZE + spot.x] = { t: 'floor' };
    ev.push({ e: 'crownSpawn', x: spot.x, y: spot.y });
    s.log.push('The Crown has appeared');
    const winner = unitAt(s, spot.x, spot.y);
    if (winner && winner.kind === 'player') crown(s, winner, ev); // whoever got there first wins the race
    else s.items.push({ x: spot.x, y: spot.y, k: 'crown', n: 1 });
  }
}

// Predict the next n turns (for the turn-order strip)
// 16.0 (C): { now: [active, ...rest of this round in order], next: [next round's order], round, reversed, nextReversed,
// held: [ids holding this round] } for the strip's round divider. Units that already acted keep their pending gauge
// nudges into next round, a held unit carries its -HOLD.gauge, Seize/Hourglass (u.tempo) and a telegraphed Reversal apply.
export function turnQueue(s) {
  const alive = s.units.filter((u) => u.alive), r1 = s.round + 1;
  const now = (s.active != null && alive.some((u) => u.id === s.active) ? [s.active] : [])
    .concat(alive.filter((u) => u.rt !== s.round && u.id !== s.active).sort((a, b) => (outranks(s, a, b) ? -1 : 1)).map((u) => u.id));
  const next = alive.map((u) => ({ ...u, gauge: u.rt === s.round ? u.gauge || 0 : u.held === s.round ? -HOLD.gauge : 0 })).sort((a, b) => (outranks(s, a, b, r1) ? -1 : 1)).map((u) => u.id);
  return { now, next, round: s.round, reversed: s.reversal === s.round, nextReversed: s.reversal === r1, held: alive.filter((u) => u.held === s.round && u.rt !== s.round).map((u) => u.id) };
}
// Predict the next n turns (for the turn-order strip): this round, then next round's order repeated
export function predictOrder(s, n = 8) {
  const q = turnQueue(s), out = q.now.slice(0, n);
  for (let k = 0; out.length < n && q.next.length && k < 8; k++) for (const id of q.next) { if (out.length >= n) break; out.push(id); }
  return out;
}

// Damage range preview for the UI: [min, max] before crits.
export function previewDamage(src, tgt, mult, s = null) {
  if (mult <= 0) return [0, 0];
  const a = stats(src), d = stats(tgt);
  const m = mult * dmgMods(src, tgt) * (s && s.bloodMoon ? 1.3 : 1); // 15.0: same modifiers as dealDamage (passives, Ascension, Exposed via defMul); pass s for Blood Moon
  const k = 30 / (30 + d.def * defMul(tgt));
  const cap = guardCap(tgt); // 16.0 (C): Guard caps every single hit, crits included
  return [Math.min(cap, Math.max(1, Math.round(a.atk * m * 0.9 * k))), Math.min(cap, Math.max(1, Math.round(a.atk * m * 1.1 * k)))];
}

// ---------- AI ----------
function estDmg(src, tgt, mult) { return Math.min(guardCap(tgt), Math.max(1, stats(src).atk * mult * 30 / (30 + stats(tgt).def * defMul(tgt)))); }

// Breadth-first step toward a target, so hunters walk around walls instead of getting stuck.
function pathStep(s, u, target) {
  const prev = new Map(); const start = u.y * SIZE + u.x; prev.set(start, -1);
  const q = [start];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi], cx = c % SIZE, cy = (c / SIZE) | 0;
    if (Math.max(Math.abs(cx - target.x), Math.abs(cy - target.y)) <= 1 && c !== start) {
      let k = c; while (prev.get(k) !== start) k = prev.get(k);
      return pt(k % SIZE, (k / SIZE) | 0);
    }
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx, ny = cy + dy, ni = ny * SIZE + nx;
      if (!prev.has(ni) && canStand(s, nx, ny) && !isVoid(s, nx, ny)) { prev.set(ni, c); q.push(ni); }
    }
  }
  return null;
}
export function planHollow(s, u) {
  if (u.dummy) return [{ type: 'end' }];
  const players = alivePlayers(s);
  let target = null, bd = 99;
  for (const p of players) { const d = cheb(u, p); if (d < bd) { bd = d; target = p; } }
  if (target && (u.role === 'caster' || u.role === 'regent')) return planRanged(s, u, players);
  const acts = [];
  const adj = (x, y) => players.find((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) === 1);
  if (target && (bd <= 4 || u.hunt)) {
    const ox = u.x, oy = u.y; let pos = pt(u.x, u.y);
    for (let step = 0; step < (s.turn && s.turn.rooted ? 0 : u.role === 'stalker' ? 2 : 1); step++) { // 15.0: frozen Hollows hold still
      if (adj(pos.x, pos.y)) break;
      u.x = pos.x; u.y = pos.y; const d0 = cheb(pos, target);
      let mv = legalMoves(s, u).filter((m) => !isVoid(s, m.x, m.y)).sort((a, b) => cheb(a, target) - cheb(b, target))[0];
      if (u.hunt && (!mv || cheb(mv, target) >= d0)) mv = pathStep(s, u, target) || mv;
      u.x = ox; u.y = oy;
      if (mv && (cheb(mv, target) < d0 || u.hunt)) { acts.push({ type: 'move', x: mv.x, y: mv.y }); pos = mv; } else break;
    }
    const v = adj(pos.x, pos.y);
    if (v) acts.push(u.boss ? { type: 'ability', slot: 'atk', x: pos.x, y: pos.y } : { type: 'ability', slot: 'atk', x: v.x, y: v.y });
  } else if (cheb(u, { x: u.hx, y: u.hy }) > 1 || isVoid(s, u.x, u.y)) {
    const goal = isVoid(s, u.x, u.y) ? pt(7, 7) : pt(u.hx, u.hy);
    const mv = legalMoves(s, u).sort((a, b) => cheb(a, goal) - cheb(b, goal))[0];
    if (mv) acts.push({ type: 'move', x: mv.x, y: mv.y });
  }
  acts.push({ type: 'end' });
  return acts;
}
// 10.0 ranged Hollows (Hexer, Wraith Regent): keep a line on someone, shoot the weakest, never hug.
function planRanged(s, u, players) {
  const acts = [], ox = u.x, oy = u.y;
  const shots = (x, y) => { u.x = x; u.y = y; const o = abilityOptions(s, u, 'atk'); u.x = ox; u.y = oy; return o; };
  const pickShot = (o) => o.slice().sort((a, b) => { const va = unitAt(s, a.anchor.x, a.anchor.y), vb = unitAt(s, b.anchor.x, b.anchor.y); return (va ? va.hp : 999) - (vb ? vb.hp : 999) || a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x; })[0];
  const nearP = (x, y) => players.reduce((m, p) => Math.min(m, Math.max(Math.abs(p.x - x), Math.abs(p.y - y))), 99);
  let pos = pt(u.x, u.y);
  // the Regent blinks to a fresh firing line when it has none
  if (u.role === 'regent' && !(u.cd.sig > 0) && (!shots(pos.x, pos.y).length || nearP(pos.x, pos.y) <= 1)) {
    const tele = abilityOptions(s, u, 'sig').map((o) => ({ o, n: shots(o.anchor.x, o.anchor.y), d: nearP(o.anchor.x, o.anchor.y) })).filter((q) => q.n.length && q.d >= 2);
    tele.sort((a, b) => b.n.length - a.n.length || a.o.anchor.y - b.o.anchor.y || a.o.anchor.x - b.o.anchor.x);
    if (tele.length) { acts.push({ type: 'ability', slot: 'sig', x: tele[0].o.anchor.x, y: tele[0].o.anchor.y }); pos = tele[0].o.anchor; }
  }
  const here = shots(pos.x, pos.y);
  if (pos.x === ox && pos.y === oy && (!here.length || nearP(ox, oy) <= 1)) {
    const mv = legalMoves(s, u).filter((m) => !isVoid(s, m.x, m.y)).map((m) => ({ m, n: shots(m.x, m.y).length, d: nearP(m.x, m.y) }))
      .sort((a, b) => (b.n > 0 && b.d >= 2) - (a.n > 0 && a.d >= 2) || b.n - a.n || Math.abs(a.d - 3) - Math.abs(b.d - 3) || a.m.y - b.m.y || a.m.x - b.m.x)[0];
    if (mv && (mv.n || !here.length)) {
      let to = mv.m;
      if (!mv.n && u.hunt) { const near = players.slice().sort((a, b) => cheb(u, a) - cheb(u, b) || a.id - b.id)[0]; to = (nearP(ox, oy) > 3 && pathStep(s, u, near)) || mv.m; }
      acts.push({ type: 'move', x: to.x, y: to.y }); pos = to;
    }
  }
  const fire = shots(pos.x, pos.y);
  if (fire.length) { const o = pickShot(fire.map((q) => ({ ...q }))); acts.push({ type: 'ability', slot: 'atk', x: o.anchor.x, y: o.anchor.y }); }
  acts.push({ type: 'end' });
  return acts;
}

// The AI rolls its own dice so replaying an action log reproduces the match exactly.
function aiRand(s) { s.aiSeed = ((s.aiSeed ?? (s.seed ^ 0x9e3779b9)) * 1664525 + 1013904223) >>> 0; return s.aiSeed / 4294967296; }
// 15.0 (C): a bot's promotion pick for its road. queen: climb to the Queen and hone it. rook: stop at the Rook and
// make it a Fortress. ascend: stay a Knight or Bishop (u.pref) and Ascend it. pawn: Veteran, Champion, then hone.
function botPromo(u) {
  const opts = promoteOptions(u).filter((o) => o.cost <= u.shards); if (!opts.length) return null;
  const evo = opts.filter((o) => o.type === 'evolve'), hone = opts.find((o) => o.type === 'hone') || null;
  const line = (pc) => !!PIECES[pc].line;
  const climb = (maxTier) => {
    const c = evo.filter((o) => !line(o.to) && PIECES[o.to].tier <= maxTier), top = c.reduce((m, o) => Math.max(m, PIECES[o.to].tier), 0);
    return c.find((o) => PIECES[o.to].tier === top && (top !== 2 || o.to === u.pref)) || c.find((o) => PIECES[o.to].tier === top) || null;
  };
  switch (u.plan) {
    case 'rook': return climb(3) || (u.piece === 'rook' ? hone : null);
    case 'ascend': return u.piece === 'pawn' ? evo.find((o) => o.to === u.pref) || null : u.piece === u.pref ? hone : null;
    case 'pawn': return evo.filter((o) => line(o.to)).sort((a, b) => b.cost - a.cost)[0] || (u.piece === 'champion' ? hone : null);
    default: return climb(4) || (u.piece === 'queen' ? hone : null);
  }
}
export function planBot(s, u) {
  const acts = [];
  // promotion first
  for (let k = 0; k < 4; k++) {
    const pick = botPromo(u); // 15.0 (C): each bot follows its road (u.plan)
    if (!pick) break;
    acts.push({ type: 'promote', to: pick.to });
    // simulate locally on a shallow copy so movement planning uses new piece
    u = { ...u, shards: u.shards - pick.cost, piece: pick.type === 'evolve' ? pick.to : u.piece, hone: pick.type === 'hone' ? { ...u.hone, [u.piece]: (u.hone[u.piece] || 0) + 1 } : u.hone, cd: pick.type === 'evolve' ? { sig: 0, eq: 0 } : u.cd };
  }
  const real = unitById(s, u.id);
  const enemies = s.units.filter((v) => v.alive && v.id !== u.id && !ally(real, v));
  const mates = s.teams ? s.units.filter((v) => v.alive && ally(real, v)) : [];
  const st = stats(u);
  const hpR = real.hp / st.maxHp;
  const safeRing = s.storm.ring + (s.storm.crack ? 1 : 0);
  const shardItems = s.items;
  // tiles about to be hit by a geyser next round
  const hot = new Set();
  for (let i = 0; i < s.tiles.length; i++) { const t = s.tiles[i]; if (t.t === 'geyser' && t.ph === 2) { const gx = i % SIZE, gy = (i / SIZE) | 0; for (const [dx, dy] of [[0, 0], ...ORTH]) if (inB(gx + dx, gy + dy)) hot.add((gy + dy) * SIZE + gx + dx); } }
  if (s.locWarn && Array.isArray(s.locWarn.tiles)) for (const t of s.locWarn.tiles) hot.add(t.y * SIZE + t.x); // 15.0 (W): telegraphed location events
  const bountyT = s.bounty ? unitById(s, s.bounty.id) : null;
  const sick = harmed(real), kingE = s.kingBoss && s.kingBoss.id !== real.id ? unitById(s, s.kingBoss.id) : null; // 15.0 (C)

  // 17.0 (A0): posScore depends only on the tile (not on where the planner has the bot standing), so memoize it per plan;
  // leap/charge options re-scored the same tiles hundreds of times (Champion's Valor: 48 anchors x every move).
  const psMemo = new Map();
  const posScore = (x, y) => { const k = y * SIZE + x; let v = psMemo.get(k); if (v === undefined) { v = posScoreRaw(x, y); psMemo.set(k, v); } return v; };
  const posScoreRaw = (x, y) => {
    let sc = 0;
    if (isVoid(s, x, y)) sc -= 60 + (s.storm.ring - ringOf(x, y)) * 14; else if (ringOf(x, y) < safeRing) sc -= 25; // deeper void scores worse, so bots climb out
    if (ringOf(x, y) < safeRing + 1 && s.round >= s.rules.first - 1) sc -= 4;
    for (const it of shardItems) {
      const d = Math.max(Math.abs(it.x - x), Math.abs(it.y - y));
      const val = it.k === 'crown' ? 70 : it.k === 'shard' ? 14 * it.n : it.k === 'potion' ? (1 - hpR) * 30 + (sick ? 10 : 0) :it.k === 'trap' ? 0 : it.k === 'soul' ? (it.team === real.team ? 90 : 20) : 6;
      if (d === 0) sc += val; else sc += val / (d + 1.5) * 0.6;
    }
    const t = tileAt(s, x, y);
    if (t.t === 'shrine' && t.cd === 0) sc += (1 - hpR) * 40 + (sick ? 14 : 0); // shrines also cleanse
    if (t.t === 'bramble') sc -= 4;
    if (t.t === 'lava') sc -= 20; // 15.0: lava also burns
    if (s.crownWarn) { const d = Math.max(Math.abs(s.crownWarn.x - x), Math.abs(s.crownWarn.y - y)); sc += d === 0 ? 60 : 60 / (d + 1.5) * 0.6; } // race to the telegraphed Crown
    if (kingE) { const d = Math.max(Math.abs(kingE.x - x), Math.abs(kingE.y - y)); if (hpR >= 0.45) sc -= d * KING_T.converge; else if (d <= KING_T.aura) sc -= 4; } // gang up on the boss King; the hurt keep out of its aura
    if (t.t === 'poison') sc -= 12; // 15.0 (W)
    // 10.0 hazards and modes
    if (t.t === 'crumble') sc -= t.hp > 1 ? 2 : 28;
    else if (t.t === 'conveyor') sc -= 1;
    if (hot.size && (hot.has(y * SIZE + x))) sc -= 18;
    if (s.hill) { const lead = Math.max(0, ...Object.values(s.hill.score)); sc += onThrone(s, x, y) ? 26 + (lead >= s.hill.goal - 2 ? 12 : 0) : -Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) * 1.3; }
    if (bountyT && bountyT !== real) { const d = Math.max(Math.abs(bountyT.x - x), Math.abs(bountyT.y - y)); if (hpR > 0.4) sc -= d * 0.6; }
    for (const m of mates) if (Math.max(Math.abs(m.x - x), Math.abs(m.y - y)) <= 2) sc += 4;
    let near = 99;
    for (const e of enemies) if (e.kind === 'player' || s.siege) near = Math.min(near, Math.max(Math.abs(e.x - x), Math.abs(e.y - y)));
    if (near < 99) sc += hpR > 0.4 ? -near * 1.4 : near * 1.2;
    // threat: enemies adjacent
    const adj = enemies.filter((e) => Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) <= 1).length;
    sc -= adj * (hpR < 0.35 ? 8 : 1.5);
    return sc;
  };
  // 15.0 (C): what the statuses an action applies are worth on a target (0 when it would be wasted or resisted)
  const stVal = (k, v, n) => {
    const prime = v.kind === 'player' || (s.siege && v.wave), mx = stats(v).maxHp, w = prime ? 1 : 0.3;
    if (k === 'burn') return w * (hasSt(v, 'burn') ? 1 : mx * 0.06 * 2 * 0.7);
    if (k === 'poison') { const have = stN(v, 'poison'); return w * (Math.max(0, Math.min(3, have + n) - have) * mx * 0.03 * 3 * 0.6); }
    if (v.passive === 'ward' || (ascended(v) && v.piece === 'queen' && k !== 'stun')) return 0;
    if (k === 'freeze') return hasSt(v, 'freeze') || hasSt(v, 'stun') ? 0 : w * (hasSt(v, 'burn') ? 2 : 7);
    if (k === 'stun') return hasSt(v, 'stun') || hasSt(v, 'freeze') ? 0 : w * 11;
    if (k === 'slow') return hasSt(v, 'slow') ? 0 : w * 4;
    return 0;
  };
  const procsFor = (slot) => {
    const id = slotAbility(u, slot); if (!id) return [];
    const L = [...(ABILITIES[id].st || [])];
    if (u.passive === 'kindle' && slot === 'atk') L.push('burn');
    if (u.passive === 'venom') L.push('poison');
    if (u.passive === 'rime') L.push('slow');
    if (ascended(u)) { if (u.piece === 'bishop' && id === 'ray') L.push('poison'); else if (u.piece === 'rook' && id === 'slam') L.push('slow'); else if (slot === 'ult') L.push({ knight: 'stun', bishop: 'burn', queen: 'freeze' }[u.piece] || 'slow'); }
    return L.map((k) => [k, k === 'poison' && (id === 'dart' || id === 'hex' || id === 'plague') ? 2 : 1]);
  };
  const actScore = (opts, slot) => {
    let best = null, bs = 0;
    const procs = procsFor(slot);
    const sid = slotAbility(u, slot), tp = sid && ABILITIES[sid] ? ABILITIES[sid].tempo : null, sendsLast = tp === 'last' || tp === 'both'; // 16.0 (C)
    for (const o of opts) {
      let sc = o.util || 0;
      for (const hid of o.hits) {
        const v = unitById(s, hid); if (!v) continue;
        const d = estDmg(u, v, o.mult), sh = stN(v, 'shield') + (v.shield || 0), dh = Math.max(0, d - sh); // shields soak first
        const prime = v.kind === 'player' || (s.siege && v.wave); // in Siege the Hollows are the enemy
        sc += Math.min(dh, v.hp) * (prime ? 1.2 : 0.8) + Math.min(d, sh) * 0.4;
        if (dh >= v.hp) sc += prime ? 45 + (v.boss ? 60 : 0) : 18 + v.shards * 6;
        else { for (const [k, n] of procs) sc += stVal(k, v, n); if (sendsLast && !(v.tempo && v.tempo.k === 'last' && v.tempo.r === s.round + 1)) sc += TEMPO_T.lastUtil * (prime ? 1 : 0.4); }
        if (v.piece === 'king') sc += KING_T.focus + stN(v, 'exposed') * 4; // gang up on an Exposed King
        if (bountyT && v === bountyT) sc += d >= v.hp ? 30 : 8;
      }
      if (o.kind === 'charge' || o.kind === 'dash' || o.kind === 'leap') sc += posScore(o.anchor.x, o.anchor.y) * 0.3;
      // break crates in reach
      for (const t of o.tiles) { const tl = tileAt(s, t.x, t.y); if (tl && tl.t === 'crate' && o.mult > 0) sc += 6; }
      if (sc > bs) { bs = sc; best = o; }
    }
    return { best, bs };
  };

  const ox = real.x, oy = real.y;
  const moves = [{ x: ox, y: oy, stay: true }, ...(canMove(s, real) ? legalMovesFor(s, u) : [])];
  let plan = null, top = -1e9;
  for (const m of moves) {
    real.x = m.x; real.y = m.y; // temporary
    const ps = posScore(m.x, m.y);
    let bestAct = null, as = 0;
    if (canAct(s, real) && !(m.side && BISHOP_T.sideActs)) { // 17.0 (C2): a Sidestep spends the action
      for (const slot of ['atk', 'sig', 'eq', 'ult']) {
        if (slot === 'ult' ? (real.ult || 0) < 100 : slot !== 'atk' && u.cd[slot] > 0) continue;
        const sid = slotAbility(u, slot); if (sid && ABILITIES[sid].free) continue;
        const { best, bs } = actScore(abilityOptionsFor(s, u, real, slot), slot);
        if (best && bs > as) { as = bs; bestAct = { slot, o: best }; }
      }
    }
    const noise = u.botLevel === 'easy' ? aiRand(s) * 30 : u.botLevel === 'hard' ? 0 : aiRand(s) * 4;
    const total = ps + as * (u.botLevel === 'easy' ? 0.6 : u.botLevel === 'hard' ? 1.25 : 1) + (m.stay ? (real.passive === 'bastion' ? 2.5 : 0.5) : 0) + noise;
    if (total > top) { top = total; plan = { m, bestAct, as }; }
  }
  real.x = ox; real.y = oy;
  // 16.0 (C): Hold, rarely: nothing worthwhile in reach, and an enemy that could threaten us still acts after us this round
  if (!acts.length && plan && plan.as < BOT_HOLD.minAct && u.botLevel !== 'easy' && canHold(s, real)) {
    const threat = enemies.some((e) => (e.kind === 'player' || (s.siege && e.wave)) && e.rt !== s.round && cheb(e, real) <= BOT_HOLD.range);
    if (threat && aiRand(s) < BOT_HOLD.chance) return [{ type: 'hold' }];
  }
  if (plan) {
    if (!plan.m.stay) acts.push({ type: 'move', x: plan.m.x, y: plan.m.y });
    if (plan.bestAct) acts.push({ type: 'ability', slot: plan.bestAct.slot, x: plan.bestAct.o.anchor.x, y: plan.bestAct.o.anchor.y });
  }
  acts.push({ type: 'end' });
  return acts;
}
// Use (possibly promoted) virtual unit stats while reading real position/board.
function legalMovesFor(s, vu) { const r = unitById(s, vu.id); const save = r.piece; r.piece = vu.piece; const m = legalMoves(s, r); r.piece = save; return m; }
function abilityOptionsFor(s, vu, r, slot) {
  const save = { piece: r.piece, hone: r.hone };
  r.piece = vu.piece; r.hone = vu.hone;
  const o = abilityOptions(s, r, slot);
  r.piece = save.piece; r.hone = save.hone;
  return o;
}

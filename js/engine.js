// Chess Complex — authoritative rules engine. Pure data in, events out.
import {
  SIZE, PIECES, ABILITIES, EVOLVE, EVOLVE_COST, MAX_HONE, honeCost, STAT_GAIN,
  PLAYER_COLORS, HOLLOW_STATS, ATTUNE, MODES, STEADFAST_ROUND, CALM_ROUNDS, TEAM_COLORS, MUTATORS,
} from './data.js';

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = DIRS8.slice(0, 4);
const DIAG = DIRS8.slice(4);
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

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
export const unitAt = (s, x, y) => s.units.find((u) => u.alive && u.x === x && u.y === y) || null;
export const unitById = (s, id) => s.units.find((u) => u.id === id) || null;
const SOLID = { wall: 1, rubble: 1, crate: 1, chest: 1, out: 1 };
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
  if (u.passive === 'laststand' && u.hp > 0 && u.hp < maxHp * 0.3) atkM *= 1.3;
  return {
    maxHp, atk: Math.round(b.atk * (1 + ATTUNE.atk * a) * atkM), def: Math.round(b.def * (1 + ATTUNE.def * a)),
    spd: b.spd + attuneSpd(u) + (u.momentum || 0) * 2 + buffSum(u, 'spd'),
  };
}
function buffSum(u, k) { return u.buffs.reduce((a, b) => a + (b.k === k ? b.v : 0), 0); }
function defMul(u) { return u.buffs.reduce((a, b) => (b.k === 'def' ? a * b.v : a), 1); }
// Diminishing returns past 12 so stacking SPD is not a free win.
export const effSpd = (u) => { const v = Math.max(3, stats(u).spd); return v <= 12 ? v : 12 + (v - 12) * 0.5; };
export const honed = (u) => (u.hone[u.piece] || 0) > 0;

// ---------- creation ----------
const SPAWNS = [[1, 1], [14, 14], [14, 1], [1, 14], [7, 1], [8, 14], [1, 8], [14, 7]];
const TEAM_SPAWNS = [[[1, 1], [3, 2]], [[14, 14], [12, 13]], [[14, 1], [13, 3]], [[1, 14], [2, 12]]];

export function createMatch(players, seed = (Math.random() * 2 ** 31) | 0, opts = {}) {
  const modeId = MODES[opts.mode] ? opts.mode : 'royale', M = MODES[modeId];
  const s = {
    seed, v: 0, round: 1, roundTurns: 0, turnNo: 0, over: false, winner: null,
    tiles: [], units: [], items: [], storm: { ring: 0, crack: false }, event: null, meteors: [], bloodMoon: 0, lastEvent: null,
    active: null, turn: null, crownSpawned: false, log: [], nextId: 1, firstBlood: false,
    mode: modeId, rules: { first: M.storm.first, every: M.storm.every, crown: M.crown, events: M.events, turnMs: M.turnMs }, arena: M.arena || null,
    mutator: 'none', teams: M.teams || 0, siege: M.siege ? { wave: 0, waves: M.siege.waves, next: 2, since: 0 } : null, finalTwo: false,
  };
  for (let i = 0; i < SIZE * SIZE; i++) s.tiles.push({ t: 'floor' });
  const A = s.arena;
  const inArena = (x, y) => !A || (x >= A.x0 && x <= A.x1 && y >= A.y0 && y <= A.y1);
  if (A) { for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!inArena(x, y)) s.tiles[y * SIZE + x] = { t: 'out' }; s.storm.ring = A.x0; }
  const sc = A ? 0.4 : 0.5 + 0.5 * Math.min(8, players.length) / 8; // content scales with arena size and player count

  let spawnOrder = A ? [[A.x0 + 1, A.y0 + 1], [A.x1 - 1, A.y1 - 1]] : s.siege ? [[6, 6], [9, 9], [9, 6], [6, 9]] : SPAWNS.slice();
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
  const mut = MUTATORS[opts.mutator] ? opts.mutator : A || s.siege ? 'none' : ['none', 'lava', 'ice', 'portals'][ri(s, 4)];
  s.mutator = mut;
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
  }
  for (let i = 0; i < Math.round(20 * sc); i++) { const p = randFree(1); if (p) set(p[0], p[1], 'crate', { hp: 1 }); }
  for (let i = 0; i < Math.round(12 * sc); i++) { const p = randFree(1); if (p) s.items.push({ x: p[0], y: p[1], k: 'shard', n: 1 }); }

  players.forEach((p, i) => {
    const [x, y] = spawnOrder[i];
    const u = {
      id: s.nextId++, pid: p.pid, name: p.name, bot: !!p.isBot, kind: 'player', slot: i,
      team: s.teams ? Math.floor(i / s.teams) : s.siege ? 0 : null,
      color: s.teams ? TEAM_COLORS[Math.floor(i / s.teams) % TEAM_COLORS.length] : PLAYER_COLORS[i % PLAYER_COLORS.length], skin: p.skin || 'ivory', finisher: p.finisher || 'shatter', trail: p.trail || 'none', title: String(p.title || '').slice(0, 24),
      piece: 'pawn', hone: {}, pts: { ...p.build.pts }, passive: p.build.passive, equips: { ...p.build.equips },
      x, y, hp: 1, gauge: rand(s) * 40, shards: 0, cd: { sig: 0, eq: 0 }, buffs: [],
      alive: true, kills: 0, momentum: 0, mark: null, place: 0, dmgDealt: 0, attune: 0, ult: 0, ults: 0, botLevel: p.botLevel || 'normal', pref: rand(s) < 0.5 ? 'knight' : 'bishop',
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
      gauge: rand(s) * 50, shards: 2, cd: { sig: 0, eq: 0 }, buffs: [], alive: true, hone: {}, color: '#7c7a99', skin: 'hollow',
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
  const s = createMatch([player], 7, { mutator: 'none' });
  s.tutorial = true; s.units = s.units.filter((u) => u.kind === 'player'); s.items = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const inside = x >= ARENA.x0 && x <= ARENA.x1 && y >= ARENA.y0 && y <= ARENA.y1;
    s.tiles[y * SIZE + x] = { t: inside ? 'floor' : 'out' };
  }
  const me = s.units[0]; me.x = 5; me.y = 9; me.gauge = 100;
  s.active = me.id; s.turn = { moved: false, acted: false, extraMoves: 0, rooted: false };
  return s;
}
export function spawnDummy(s, x, y, hp = 40) {
  const old = unitAt(s, x, y); if (old) return old;
  if (tileAt(s, x, y)) s.tiles[y * SIZE + x] = { t: 'floor' };
  const d = { id: s.nextId++, kind: 'hollow', dummy: true, name: 'Dummy', piece: 'hollow', x, y, hx: x, hy: y, hp, hpMax: hp, gauge: 0, shards: 0, cd: { sig: 0, eq: 0 }, buffs: [], alive: true, hone: {}, color: '#7c7a99', skin: 'hollow' };
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
    case 'bishop': slide(DIAG, 4); break;
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
  if (slot === 'ult') return (u.ult || 0) >= 100 && !s.turn.acted;
  if (slot !== 'atk' && u.cd[slot] > 0) return false;
  return ABILITIES[id].free ? true : !s.turn.acted;
}

// ---------- abilities ----------
export function slotAbility(u, slot) {
  if (u.kind === 'hollow') return slot === 'atk' ? (u.boss ? 'colossusSlam' : 'hollowClaw') : null;
  if (slot === 'atk') return PIECES[u.piece].attack;
  if (slot === 'sig') return PIECES[u.piece].sig;
  if (slot === 'eq') return u.piece === 'king' ? null : u.equips[u.piece] || PIECES[u.piece].equips[0];
  if (slot === 'ult') return PIECES[u.piece].ult;
  return null;
}
export function abilityCd(u, id) {
  const base = ABILITIES[id].cd;
  if ((id === 'vault' || id === 'transpose' || id === 'decree') && honed(u)) return base - 1;
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
      for (const [dx, dy] of ORTH) { const x = u.x + dx, y = u.y + dy; if (canStand(s, x, y) && tileAt(s, x, y).t === 'floor') opt(pt(x, y), [pt(x, y)], 0, { kind: 'wall', util: 2 }); } break;
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
  }
  // no friendly fire: allies never count as hits
  if (u.team != null) for (const q of o) q.hits = q.hits.filter((id) => !ally(u, unitById(s, id)));
  return o;
}

// ---------- damage ----------
function dealDamage(s, src, tgt, mult, ev, { reflect = true } = {}) {
  if (s.over || !tgt.alive || mult <= 0 || ally(src, tgt)) return 0;
  const a = stats(src), d = stats(tgt);
  let m = mult * (0.9 + rand(s) * 0.2);
  if (src.passive === 'first' && tgt.hp >= d.maxHp * 0.6) m *= 1.5;
  const crit = rand(s) < 0.1;
  if (crit) m *= 1.5;
  if (s.bloodMoon) m *= 1.3;
  if (tgt.piece === 'king') m *= 1.1;
  let dmg = Math.max(1, Math.round(a.atk * m * 30 / (30 + d.def * defMul(tgt))));
  if (s.round < STEADFAST_ROUND && tgt.kind === 'player' && (tgt.hp >= d.maxHp || (s._guard && s._guard.has(tgt.id))) && dmg >= tgt.hp) { dmg = tgt.hp - 1; ev.push({ e: 'steadfast', id: tgt.id }); }
  if (s.round < STEADFAST_ROUND && tgt.kind === 'player' && tgt.hp >= d.maxHp) (s._guard || (s._guard = new Set())).add(tgt.id);
  tgt.hp -= dmg;
  if (src.kind === 'player') { src.dmgDealt = (src.dmgDealt || 0) + dmg; chargeUlt(src, dmg * 1.1, ev); }
  if (tgt.kind === 'player') chargeUlt(tgt, dmg * 0.8, ev);
  ev.push({ e: 'dmg', id: tgt.id, src: src.id, n: dmg, crit });
  if (tgt.hp <= 0) kill(s, tgt, src, ev);
  if (!s.over && src.alive && src.passive === 'lifesteal' && src !== tgt) heal(s, src, Math.max(1, dmg * 0.1), ev);
  if (!s.over && tgt.alive && reflect && tgt.passive === 'thorns' && src !== tgt && cheb(src, tgt) <= 1 && src.alive && !ally(src, tgt)) {
    const r = Math.max(1, Math.round(dmg * 0.3));
    src.hp -= r; ev.push({ e: 'dmg', id: src.id, src: tgt.id, n: r, thorns: true });
    if (src.hp <= 0) kill(s, src, tgt, ev);
  }
  return dmg;
}
function chargeUlt(u, n, ev) {
  if (u.kind !== 'player' || !u.alive) return;
  const was = u.ult || 0; u.ult = Math.min(100, was + (u.piece === 'king' ? n * 0.5 : n));
  if (was < 100 && u.ult >= 100) ev.push({ e: 'ultReady', id: u.id });
}
function dealFixed(s, tgt, n, ev, tag) {
  if (s.over || !tgt.alive) return;
  const dmg = Math.max(1, Math.round(n * (s.bloodMoon ? 1.3 : 1)));
  tgt.hp -= dmg; ev.push({ e: 'dmg', id: tgt.id, n: dmg, [tag]: true });
  if (tgt.kind === 'player') chargeUlt(tgt, dmg * 0.8, ev);
  if (tgt.hp <= 0) kill(s, tgt, null, ev, tag);
  return dmg;
}
function heal(s, u, n, ev) {
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
  v.alive = false; v.hp = 0;
  ev.push({ e: 'death', id: v.id, by: killer ? killer.id : null, x: v.x, y: v.y, cause });
  if (killer && killer !== v) chargeUlt(killer, 20, ev);
  const loot = (v.shards || 0);
  if (loot > 0) dropNear(s, v.x, v.y, { k: 'shard', n: loot });
  v.shards = 0;
  if (v.piece === 'king') { dropNear(s, v.x, v.y, { k: 'shard', n: 4 }); ev.push({ e: 'msg', text: 'The Crown has shattered', tone: 'gold' }); }
  if (v.kind === 'hollow' && v.boss && s.siege && !s.crownSpawned && v.wave < s.siege.waves) { s.crownSpawned = true; dropNear(s, v.x, v.y, { k: 'crown', n: 1 }); ev.push({ e: 'msg', text: 'The Colossus dropped the Crown', tone: 'gold' }); }
  const de = ev.find((q) => q.e === 'death' && q.id === v.id);
  if (v.kind === 'hollow' && killer && killer.kind === 'player') killer.hk = (killer.hk || 0) + 1;
  if (v.kind === 'player') {
    const wasKing = v.piece === 'king';
    s.log.push(`${killer && killer !== v ? killer.name : cause === 'meteor' ? 'A meteor' : cause === 'lava' ? 'The lava' : cause === 'trap' ? 'A trap' : 'The storm'} eliminated ${v.name}`);
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
export const isBossWave = (S, w) => w === S.waves || w === Math.floor(S.waves / 2);
export const SIEGE_T = { spd: 0.4, c0: 1.2, cw: 0.3, hs: 0.1, as: 0.3, force: 4, boss: 0.8, ring: 3, pf0: 0.6, pf: 0.2 };
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
  for (const p of alivePlayers(s)) heal(s, p, stats(p).maxHp * 0.2, ev);
  ev.push({ e: 'wave', phase: 'clear', n: S.wave, next: S.wave + 1, boss: isBossWave(S, S.wave + 1) });
}
function spawnWave(s, ev) {
  const S = s.siege; S.wave++; S.next = 0; S.since = s.round;
  const w = S.wave, nP = s.units.filter((u) => u.kind === 'player').length;
  const boss = isBossWave(S, w);
  // waves are sized to what the defenders can clear; leftovers count against the next wave so Hollows never pile up
  const left = s.units.filter((h) => h.alive && h.wave).length;
  const target = Math.min(14, Math.ceil((boss ? 0.5 : 1) * (SIEGE_T.c0 + SIEGE_T.cw * w) * nP));
  const count = Math.max(boss ? 0 : 1, target - left);
  const edge = []; for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (ringOf(x, y) <= SIEGE_T.ring && ringOf(x, y) >= 1 && canStand(s, x, y)) edge.push(pt(x, y));
  const tiles = [];
  const mk = (extra) => {
    if (!edge.length) return null;
    const t = edge.splice(ri(s, edge.length), 1)[0]; tiles.push(t);
    const h = { id: s.nextId++, kind: 'hollow', name: 'Hollow', piece: 'hollow', x: t.x, y: t.y, hx: t.x, hy: t.y, hunt: true, wave: w,
      gauge: rand(s) * 60, shards: 1, cd: { sig: 0, eq: 0 }, buffs: [], alive: true, hone: {}, color: '#7c7a99', skin: 'hollow', ...extra };
    h.hp = h.hpMax; s.units.push(h); return h;
  };
  const pf = SIEGE_T.pf0 + SIEGE_T.pf * nP; // fewer defenders, gentler Hollows
  const hs = 1 + SIEGE_T.hs * (w - 1), as = (1 + SIEGE_T.as * (w - 1)) * pf;
  for (let i = 0; i < count; i++) mk({ hpMax: Math.round(HOLLOW_STATS.hp * hs), atkB: Math.round(HOLLOW_STATS.atk * as), defB: HOLLOW_STATS.def + Math.floor(w / 3), spdB: Math.round(HOLLOW_STATS.spd + w * SIEGE_T.spd) });
  if (boss) {
    const big = w >= S.waves;
    const b = mk({ boss: true, name: big ? 'Elder Colossus' : 'Colossus', hpMax: Math.round(((big ? 420 : 260) + nP * (big ? 120 : 70)) * SIEGE_T.boss), atkB: Math.round((big ? 26 : 19) * Math.sqrt(SIEGE_T.boss)), defB: big ? 12 : 9, spdB: 7, shards: 6, color: '#a06bff' });
    if (b) ev.push({ e: 'msg', text: `${b.name} approaches`, tone: 'gold' });
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
    else if (it.k === 'potion') { ev.push({ e: 'pickup', id: u.id, k: 'potion' }); heal(s, u, stats(u).maxHp * 0.35, ev); }
    else if (it.k === 'haste') { ev.push({ e: 'pickup', id: u.id, k: 'haste' }); u.gauge += 45; }
    else if (it.k === 'crown') crown(s, u, ev);
  }
  if (t && t.t === 'shrine' && t.cd === 0) {
    t.cd = 4; ev.push({ e: 'shrine', x: u.x, y: u.y, id: u.id });
    heal(s, u, stats(u).maxHp * 0.4, ev);
  }
  if (t && t.t === 'bramble') { u.gauge -= 25; ev.push({ e: 'bramble', id: u.id }); }
  if (t && t.t === 'portal' && !s._porting) {
    let dest = null;
    for (let y = 0; y < SIZE && !dest; y++) for (let x = 0; x < SIZE && !dest; x++) { const q = s.tiles[y * SIZE + x]; if (q.t === 'portal' && q.pair === t.pair && (x !== u.x || y !== u.y) && canStand(s, x, y) && !isVoid(s, x, y)) dest = pt(x, y); }
    if (dest) { s._porting = true; ev.push({ e: 'portal', id: u.id, from: pt(u.x, u.y), to: dest }); moveUnit(s, u, dest.x, dest.y, ev, 'portal'); s._porting = false; }
  }
}
function revive(s, v, by, ev) {
  const spot = around8(by.x, by.y).find((t) => canStand(s, t.x, t.y) && !isVoid(s, t.x, t.y));
  if (!spot) return false;
  v.alive = true; v.x = spot.x; v.y = spot.y; v.place = 0; v.buffs = []; v.gauge = 40; v.mark = null;
  if (v.piece === 'king') { v.piece = v.kingFrom || 'pawn'; v.kingStats = null; v.cd = { sig: 0, eq: 0 }; } // the Crown shattered when they fell
  v.hp = Math.max(1, Math.round(stats(v).maxHp * 0.4));
  ev.push({ e: 'revive', id: v.id, by: by.id, x: v.x, y: v.y });
  s.log.push(`${by.name} revived ${v.name}`);
  return true;
}
function crown(s, u, ev) {
  let st = baseStats(u);
  if (PIECES[u.piece].tier < 3 && alivePlayers(s).length > 3) { const r = baseStats({ ...u, piece: 'rook' }); st = { hp: Math.max(st.hp, Math.round(r.hp * 0.85)), atk: Math.max(st.atk, Math.round(r.atk * 0.85)), def: Math.max(st.def, Math.round(r.def * 0.85)), spd: st.spd }; }
  const before = stats(u).maxHp;
  st.maxHp = st.hp;
  u.kingFrom = u.piece;
  u.kingStats = { hp: Math.round(st.maxHp * 1.05) + 5, atk: st.atk + 1, def: st.def + 1, spd: Math.max(6, PIECES[u.piece].spd + u.pts.spd - 3) };
  u.piece = 'king'; u.cd = { sig: 0, eq: 0 }; u.mark = null;
  u.hp += stats(u).maxHp - before;
  ev.push({ e: 'crowned', id: u.id });
  s.log.push(`${u.name} claimed the Crown`);
}
function moveUnit(s, u, x, y, ev, how = 'step') {
  const from = pt(u.x, u.y);
  u.x = x; u.y = y;
  ev.push({ e: 'move', id: u.id, from, to: pt(x, y), how });
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
  ev.push({ e: 'ability', id: u.id, ab: id, slot, anchor, from: { x: u.x, y: u.y }, tiles: o.tiles, n: o.hits.length });
  const pieceAtCast = u.piece;
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
      aoe(s, u, o.tiles, 0.3, ev, (v) => { v.gauge -= 30; v.buffs.push({ k: 'spd', v: -3, t: 2 }); });
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
    default:
      aoe(s, u, o.tiles, o.mult, ev);
  }
  if (slot === 'ult') { u.ult = 0; u.ults = (u.ults || 0) + 1; }
  else if (slot !== 'atk' && u.piece === pieceAtCast) u.cd[slot] = cdOverride ?? abilityCd(u, id);
  if (!ABILITIES[id].free) s.turn.acted = true;
  return true;
}

export function promoteOptions(u) {
  if (u.kind !== 'player' || u.piece === 'king') return [];
  // Fixed ladder: every later rung is listed, with the total cost of climbing to it in one go.
  const best = new Map();
  const walk = (pc, acc, steps) => { for (const to of EVOLVE[pc]) { const c = acc + EVOLVE_COST[PIECES[to].tier]; if (!best.has(to) || best.get(to).cost > c) best.set(to, { cost: c, steps: steps + 1 }); walk(to, c, steps + 1); } };
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
      moveUnit(s, u, m.x, m.y, ev, m.jump ? 'jump' : PIECES[u.piece] && u.piece !== 'pawn' && u.piece !== 'king' ? 'slide' : 'step');
      ok = true;
    }
  } else if (a.type === 'ability' && canUse(s, u, a.slot)) {
    ok = useAbility(s, u, a.slot, { x: a.x, y: a.y }, ev);
  } else if (a.type === 'promote') {
    ok = promote(s, u, a.to, ev);
  } else if (a.type === 'end') ok = true;

  if (ok) {
    s.v++;
    const kos = ev.filter((q) => q.e === 'death' && q.by === u.id && (unitById(s, q.id) || {}).kind === 'player').length;
    if (kos >= 2) ev.push({ e: 'multi', id: u.id, n: kos });
    const done = a.type === 'end' || !u.alive || (s.turn.acted && (!canMove(s, u) || legalMoves(s, u).length === 0));
    if (done && !s.over) nextTurn(s, ev);
  }
  s._guard = null;
  return { ok, ev };
}

// ---------- turn flow ----------
export function nextTurn(s, ev) {
  for (let guard = 0; guard < 200 && !s.over; guard++) {
    const alive = s.units.filter((u) => u.alive);
    let best = null;
    for (let k = 0; k < 400 && !best; k++) {
      for (const u of alive) if (u.gauge >= 100 && (!best || u.gauge > best.gauge || (u.gauge === best.gauge && u.id < best.id))) best = u;
      if (!best) for (const u of alive) u.gauge += effSpd(u);
    }
    if (!best) { for (const u of alive) if (!best || u.gauge > best.gauge) best = u; if (!best) return; best.gauge = 100; }
    best.gauge -= 100;
    s.turnNo++;
    if (best.kind === 'player') {
      s.roundTurns++;
      if (s.roundTurns >= alivePlayers(s).length) { s.roundTurns = 0; s.round++; onRound(s, ev); if (s.over) return; }
    }
    if (!best.alive) continue;
    s.active = best.id;
    s.turn = { moved: false, acted: false, extraMoves: 0, rooted: false };
    startTurn(s, best, ev);
    if (best.alive && !s.over) { ev.push({ e: 'turn', id: best.id }); return; }
  }
}

function startTurn(s, u, ev) {
  u.buffs = u.buffs.filter((b) => --b.t > 0 || b.t === undefined);
  for (const k of ['sig', 'eq']) if (u.cd[k] > 0) u.cd[k]--;
  if (u.passive === 'regen') heal(s, u, 1 + Math.floor((u.attune || 0) / 10), ev);
  if (u.piece === 'king') heal(s, u, stats(u).maxHp * 0.02, ev);
  if (s.teams && u.kind === 'player' && s.units.some((w) => w.alive && ally(u, w) && cheb(u, w) <= 2)) u.buffs.push({ k: 'def', v: 1.15, t: 1, bond: true });
  const lt = tileAt(s, u.x, u.y);
  if (lt && lt.t === 'lava') { dealFixed(s, u, Math.max(4, stats(u).maxHp * 0.08), ev, 'lava'); if (!u.alive) return; }
  if (s.storm.ring >= STORM.maxRing && u.kind === 'player') {
    const d = Math.max(3, Math.round(stats(u).maxHp * 0.06));
    u.hp -= d; ev.push({ e: 'dmg', id: u.id, n: d, storm: true });
    if (u.hp <= 0) { kill(s, u, null, ev); return; }
  }
  if (isVoid(s, u.x, u.y)) {
    const d = Math.max(4, Math.round(stats(u).maxHp * 0.2));
    u.hp -= d; ev.push({ e: 'dmg', id: u.id, n: d, storm: true });
    if (u.hp <= 0) kill(s, u, null, ev);
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
  s.bloodMoon = 0;
  if (s.meteors.length) {
    const hit = new Set();
    for (const m of s.meteors) for (const [dx, dy] of [[0, 0], ...ORTH]) { const x = m.x + dx, y = m.y + dy; if (inB(x, y)) hit.add(y * SIZE + x); }
    const tiles = [...hit].map((i) => pt(i % SIZE, Math.floor(i / SIZE)));
    ev.push({ e: 'world', kind: 'meteor', phase: 'strike', tiles, centers: s.meteors });
    for (const t of tiles) { const v = unitAt(s, t.x, t.y); if (v) dealFixed(s, v, 26, ev, 'meteor'); else hitTile(s, null, t.x, t.y, ev); if (s.over) break; }
    s.meteors = [];
    if (s.over) return;
  }
  const EV = (s.rules && s.rules.events) || 3;
  if (r < EV || r % EV !== 0) return;
  const pool = (r < CALM_ROUNDS || s.siege ? ['shardRain', 'supply'] : ['shardRain', 'meteor', 'bloodMoon', 'supply']).filter((k) => k !== s.lastEvent);
  const kind = pool[ri(s, pool.length)];
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
  s.event = { kind, round: r };
}

function onRound(s, ev) {
  for (const t of s.tiles) if (t.t === 'shrine' && t.cd > 0) t.cd--;
  const r = s.round;
  if (s.tutorial) return;
  for (const it of s.items) if (it.k === 'soul' && r >= it.exp) { ev.push({ e: 'soulFade', of: it.id, x: it.x, y: it.y }); it.gone = true; }
  s.items = s.items.filter((i) => !i.gone);
  worldEvents(s, ev);
  if (s.over) return;
  if (s.siege) {
    const S = s.siege;
    if ((S.next && r >= S.next) || (S.wave > 0 && S.wave < S.waves && !S.next && r - S.since >= SIEGE_T.force)) spawnWave(s, ev);
    else if (S.wave >= S.waves && r - S.since >= 8 && s.units.some((w) => w.alive && w.wave && !w.boss)) { ev.push({ e: 'msg', text: 'The last Hollows crumble. Only the Colossus remains.', tone: 'cyan' }); for (const h of s.units.filter((w) => w.alive && w.wave && !w.boss)) { kill(s, h, null, ev, 'crumble'); if (s.over) break; } }
  }
  const R = s.rules || { first: STORM.firstCrack, every: STORM.every, crown: CROWN_ROUND };
  if (s.storm.ring < STORM.maxRing && r >= R.first && (r - R.first) % R.every === 0 && !s.storm.crack) {
    s.storm.crack = true;
    ev.push({ e: 'storm', phase: 'crack', ring: s.storm.ring });
  } else if (s.storm.crack && (R.every === 1 || (r - R.first) % R.every === 1)) {
    s.storm.crack = false; s.storm.ring++;
    s.items = s.items.filter((i) => i.k === 'crown' || !isVoid(s, i.x, i.y));
    for (const it of s.items) if (it.k === 'crown' && isVoid(s, it.x, it.y)) {
      const ft = freeTiles(s, s.storm.ring + 2); let c = ft.length ? ft[ri(s, ft.length)] : null;
      for (let y = 0; y < SIZE && !c; y++) for (let x = 0; x < SIZE && !c; x++) if (!isVoid(s, x, y) && !isSolid(s, x, y) && !unitAt(s, x, y)) c = pt(x, y);
      if (!c) { c = pt(7, 7); if (isSolid(s, 7, 7)) s.tiles[7 * SIZE + 7] = { t: 'floor' }; }
      it.x = c.x; it.y = c.y;
    }
    ev.push({ e: 'storm', phase: 'collapse', ring: s.storm.ring });
  }
  if (!s.crownSpawned && r >= R.crown) {
    s.crownSpawned = true;
    const ft = freeTiles(s, Math.max(3, s.storm.ring + 2)); const spots = ft.length ? [ft[ri(s, ft.length)]] : [pt(7, 7)];
    const spot = spots.find((p) => !isSolid(s, p.x, p.y) && !unitAt(s, p.x, p.y)) || pt(7, 7);
    if (isSolid(s, spot.x, spot.y)) s.tiles[spot.y * SIZE + spot.x] = { t: 'floor' };
    s.items.push({ x: spot.x, y: spot.y, k: 'crown', n: 1 });
    ev.push({ e: 'crownSpawn', x: spot.x, y: spot.y });
    s.log.push('The Crown has appeared');
  }
}

// Predict the next n turns (for the turn-order strip)
export function predictOrder(s, n = 8) {
  const sim = s.units.filter((u) => u.alive).map((u) => ({ id: u.id, g: u.gauge, sp: effSpd(u) }));
  const out = s.active ? [s.active] : [];
  for (let k = 0; k < 2000 && out.length < n; k++) {
    let best = null;
    for (const u of sim) if (u.g >= 100 && (!best || u.g > best.g || (u.g === best.g && u.id < best.id))) best = u;
    if (best) { best.g -= 100; out.push(best.id); } else for (const u of sim) u.g += u.sp;
  }
  return out;
}

// Damage range preview for the UI: [min, max] before crits.
export function previewDamage(src, tgt, mult) {
  if (mult <= 0) return [0, 0];
  const a = stats(src), d = stats(tgt);
  let m = mult;
  if (src.passive === 'first' && tgt.hp >= d.maxHp * 0.6) m *= 1.5;
  const k = 30 / (30 + d.def * defMul(tgt));
  return [Math.max(1, Math.round(a.atk * m * 0.9 * k)), Math.max(1, Math.round(a.atk * m * 1.1 * k))];
}

// ---------- AI ----------
function estDmg(src, tgt, mult) { return Math.max(1, stats(src).atk * mult * 30 / (30 + stats(tgt).def * defMul(tgt))); }

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
  const acts = [];
  const adj = (x, y) => players.find((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) === 1);
  if (target && (bd <= 4 || u.hunt)) {
    let pos = pt(u.x, u.y);
    if (!adj(u.x, u.y)) {
      let mv = legalMoves(s, u).filter((m) => !isVoid(s, m.x, m.y)).sort((a, b) => cheb(a, target) - cheb(b, target))[0];
      if (u.hunt && (!mv || cheb(mv, target) >= bd)) mv = pathStep(s, u, target) || mv;
      if (mv && (cheb(mv, target) < bd || u.hunt)) { acts.push({ type: 'move', x: mv.x, y: mv.y }); pos = mv; }
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

// The AI rolls its own dice so replaying an action log reproduces the match exactly.
function aiRand(s) { s.aiSeed = ((s.aiSeed ?? (s.seed ^ 0x9e3779b9)) * 1664525 + 1013904223) >>> 0; return s.aiSeed / 4294967296; }
export function planBot(s, u) {
  const acts = [];
  // promotion first
  for (let k = 0; k < 3; k++) {
    const opts = promoteOptions(u).filter((o) => o.cost <= u.shards);
    if (!opts.length) break;
    const evo = opts.filter((o) => o.type === 'evolve');
    const top = evo.reduce((m, o) => Math.max(m, PIECES[o.to].tier), 0);
    let pick = evo.find((o) => PIECES[o.to].tier === top && (top !== 2 || o.to === u.pref)) || evo.find((o) => PIECES[o.to].tier === top);
    if (!pick && u.piece === 'queen') pick = opts.find((o) => o.type === 'hone');
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

  const posScore = (x, y) => {
    let sc = 0;
    if (isVoid(s, x, y)) sc -= 60; else if (ringOf(x, y) < safeRing) sc -= 25;
    if (ringOf(x, y) < safeRing + 1 && s.round >= s.rules.first - 1) sc -= 4;
    for (const it of shardItems) {
      const d = Math.max(Math.abs(it.x - x), Math.abs(it.y - y));
      const val = it.k === 'crown' ? 70 : it.k === 'shard' ? 14 * it.n : it.k === 'potion' ? (1 - hpR) * 30 : it.k === 'trap' ? 0 : it.k === 'soul' ? (it.team === real.team ? 90 : 20) : 6;
      if (d === 0) sc += val; else sc += val / (d + 1.5) * 0.6;
    }
    const t = tileAt(s, x, y);
    if (t.t === 'shrine' && t.cd === 0) sc += (1 - hpR) * 40;
    if (t.t === 'bramble') sc -= 4;
    if (t.t === 'lava') sc -= 14;
    for (const m of mates) if (Math.max(Math.abs(m.x - x), Math.abs(m.y - y)) <= 2) sc += 4;
    let near = 99;
    for (const e of enemies) if (e.kind === 'player' || s.siege) near = Math.min(near, Math.max(Math.abs(e.x - x), Math.abs(e.y - y)));
    if (near < 99) sc += hpR > 0.4 ? -near * 1.4 : near * 1.2;
    // threat: enemies adjacent
    const adj = enemies.filter((e) => Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) <= 1).length;
    sc -= adj * (hpR < 0.35 ? 8 : 1.5);
    return sc;
  };
  const actScore = (opts) => {
    let best = null, bs = 0;
    for (const o of opts) {
      let sc = o.util || 0;
      for (const hid of o.hits) {
        const v = unitById(s, hid); if (!v) continue;
        const d = estDmg(u, v, o.mult);
        const prime = v.kind === 'player' || (s.siege && v.wave); // in Siege the Hollows are the enemy
        sc += Math.min(d, v.hp) * (prime ? 1.2 : 0.8);
        if (d >= v.hp) sc += prime ? 45 + (v.boss ? 60 : 0) : 18 + v.shards * 6;
        if (v.piece === 'king') sc += 10;
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
    if (canAct(s, real)) {
      for (const slot of ['atk', 'sig', 'eq', 'ult']) {
        if (slot === 'ult' ? (real.ult || 0) < 100 : slot !== 'atk' && u.cd[slot] > 0) continue;
        const sid = slotAbility(u, slot); if (sid && ABILITIES[sid].free) continue;
        const { best, bs } = actScore(abilityOptionsFor(s, u, real, slot));
        if (best && bs > as) { as = bs; bestAct = { slot, o: best }; }
      }
    }
    const noise = u.botLevel === 'easy' ? aiRand(s) * 30 : u.botLevel === 'hard' ? 0 : aiRand(s) * 4;
    const total = ps + as * (u.botLevel === 'easy' ? 0.6 : u.botLevel === 'hard' ? 1.25 : 1) + (m.stay ? 0.5 : 0) + noise;
    if (total > top) { top = total; plan = { m, bestAct }; }
  }
  real.x = ox; real.y = oy;
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

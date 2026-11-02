// Chess Complex 15.0 (W): the World Tour. Pure data and pure helpers, no DOM, no engine import (engine.js imports this).
//
// A match is played at one location. The host picks it deterministically from the match seed (Daily: the seed is the
// date's seed, so everyone gets the location of the day; Custom lobby: the host may choose). s.location = id.
// The location drives: hazards (replacing the old random mutator roll), the world event pool and weights, weather,
// music and background scenery. The player's equipped store board is still drawn as the board surface on top.
//
// Fields:
//   name, blurb        UI copy (location wheel, intro card, codex)
//   weather            [primary, secondary|null] weather ids that world.js already draws
//   hazards            pool of MUTATORS ids; one is rolled per match (Chaos stacks the location's pick plus one more)
//   events             weights over WORLD_EVENTS kinds (missing = 1 for a generic event, 0 for another location's
//                      signature event); signature events first
//   music              music theme id for AU (music.js); falls back to the mode theme if AU has none
//   backdrop           backdrop id for E1/E2 (js/backdrops/<id>.js)
//   board              default board look (BOARDS id) used when the player has no board of their own equipped
//   mood               colour hints for backdrops, lighting and the wheel: sky top/bottom, fog, key light, accent
export const LOCATIONS = {
  citadel: {
    name: 'Frost Citadel', blurb: 'A fortress of ice under a frozen sky. Blizzards freeze anyone caught in the open.',
    weather: ['snow', 'aurora'], hazards: ['ice'],
    events: { blizzard: 5, shardRain: 2, supply: 2, eclipse: 1.5 },
    music: 'loc_citadel', backdrop: 'citadel', board: 'frostcourt',
    mood: { sky: ['#1b2a4a', '#060a16'], fog: 'rgba(200,230,255,0.10)', light: '#cfe8ff', accent: '#7fe0ff' },
  },
  forge: {
    name: 'Volcanic Forge', blurb: 'A foundry carved into a living volcano. The mountain erupts and sets the board alight.',
    weather: ['embers', 'ash'], hazards: ['lava', 'geysers'],
    events: { eruption: 5, meteor: 2.5, bloodMoon: 1.5, earthquake: 1.5 },
    music: 'loc_forge', backdrop: 'forge', board: 'hellgate',
    mood: { sky: ['#3a0e06', '#0a0302'], fog: 'rgba(255,110,40,0.08)', light: '#ffb070', accent: '#ff5a1f' },
  },
  temple: {
    name: 'Sunken Temple', blurb: 'Drowned halls of an old order. The tide rises and drags at every step.',
    weather: ['rain', 'fog'], hazards: ['geysers', 'portals'],
    events: { flood: 5, manaSurge: 2, shardRain: 1.5, eclipse: 1.5 },
    music: 'loc_temple', backdrop: 'temple', board: 'stormpeak',
    mood: { sky: ['#0e2a33', '#03090c'], fog: 'rgba(60,200,230,0.10)', light: '#a8f0ff', accent: '#3ddcff' },
  },
  gardens: {
    name: 'Royal Gardens', blurb: 'The palace gardens in full bloom. Thorny hedges, a generous spring and a price on the leader.',
    weather: ['petals', 'leaves'], hazards: ['brambles'],
    events: { bloom: 4, bounty: 3, supply: 2, shardRain: 1.5, meteor: 0.5 },
    music: 'loc_gardens', backdrop: 'gardens', board: 'grove',
    mood: { sky: ['#2a4a3a', '#0a1410'], fog: 'rgba(255,220,235,0.06)', light: '#fff2c8', accent: '#9be3b4' },
  },
  ruins: {
    name: 'Desert Ruins', blurb: 'A buried kingdom in the dunes. Sandstorms blind the board and the ground gives way.',
    weather: ['sand', 'dust'], hazards: ['crumble'],
    events: { sandstorm: 4, earthquake: 3, supply: 1.5, bloodMoon: 1.5 },
    music: 'loc_ruins', backdrop: 'ruins', board: 'dunes',
    mood: { sky: ['#6a4220', '#1a0f06'], fog: 'rgba(230,180,110,0.10)', light: '#ffd9a0', accent: '#e8b04a' },
  },
  works: {
    name: 'Iron Works', blurb: 'A roaring factory of belts and pistons. War drums pound and the machines overcharge.',
    weather: ['ash', 'fog'], hazards: ['conveyor'],
    events: { overcharge: 4, frenzy: 3, supply: 1.5, meteor: 1.5 },
    music: 'loc_works', backdrop: 'works', board: 'clocktower',
    mood: { sky: ['#2a2a30', '#08080a'], fog: 'rgba(180,170,150,0.10)', light: '#ffcf8a', accent: '#ff9a3d' },
  },
  rift: {
    name: 'Astral Rift', blurb: 'A shattered island adrift in the stars. Mana surges and gravity bends toward the void.',
    weather: ['stars', 'void'], hazards: ['portals', 'rift'],
    events: { gravityWell: 4, manaSurge: 3, eclipse: 1.5, shardRain: 1.5 },
    music: 'loc_rift', backdrop: 'rift', board: 'eventhorizon',
    mood: { sky: ['#1a1450', '#02010a'], fog: 'rgba(180,140,255,0.08)', light: '#d8c8ff', accent: '#b04dff' },
  },
  bog: {
    name: 'Witchwood Bog', blurb: 'A rotten marsh where the dead do not rest. Poison pools and choking fog.',
    weather: ['fog', 'fireflies'], hazards: ['poison'],
    events: { toxicFog: 4, restless: 3, eclipse: 1.5, shardRain: 1.5 },
    music: 'loc_bog', backdrop: 'bog', board: 'crypt',
    mood: { sky: ['#1a2418', '#050805'], fog: 'rgba(140,200,90,0.12)', light: '#c8e8a0', accent: '#8cff5a' },
  },
};
export const LOCATION_IDS = Object.keys(LOCATIONS);
// Location-only world events (handled by engine.js locEvent). hostile = kept out of the calm early rounds.
// tele = telegraphed one round ahead ({phase:'warn'} then {phase:'strike'} next round).
export const LOC_EVENTS = {
  blizzard:    { at: 'citadel', hostile: true, tele: true },
  eruption:    { at: 'forge', hostile: true, tele: true },
  flood:       { at: 'temple', hostile: true, tele: true },
  bloom:       { at: 'gardens' },
  sandstorm:   { at: 'ruins', hostile: true },
  overcharge:  { at: 'works' },
  gravityWell: { at: 'rift', hostile: true, tele: true },
  toxicFog:    { at: 'bog', hostile: true, tele: true },
};
// Tuning for the location events (engine.js reads these).
export const LOC_T = {
  blizzard: { freeze: 1, ice: 5 },          // frozen 1 turn unless sheltered (next to a wall, rubble, crate or shrine)
  eruption: { dmg: 0.1, burn: 2, lava: 2 },  // 10% max HP, burn 2 turns, up to 2 vents become lava
  flood: { band: 3, slow: 2 },               // outer 3 rings inside the storm, slow 2 turns
  bloom: { heal: 0.1, brambles: 4 },         // heal 10% max HP, cleanse burn/poison, brambles sprout
  sandstorm: { slow: 1 },                    // vision drops for the round (s.sandstorm), everyone slowed 1 turn
  overcharge: { ult: 15, stun: 1 },          // cooldowns refresh, +15 ult; pieces on conveyors stunned 1 turn
  gravityWell: { radius: 5, pull: 2, dmg: 0.08 },
  toxicFog: { poison: 1, t: 3 },
  poisonPool: { poison: 1, t: 3 },           // start a turn on, or land on, a bog pool: +1 poison stack
};

// ---------- deterministic pick ----------
// Independent of the engine's RNG stream (a hash of the seed), so choosing a location never shifts map generation.
export function seedHash(seed, salt = 0) {
  let h = (Number(seed) | 0) ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
export const isLocation = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(LOCATIONS, id);
export function pickLocation(seed) { return LOCATION_IDS[seedHash(seed, 0x10c) % LOCATION_IDS.length]; }
// Daily: the location of the day comes from the same date seed the Daily match uses (progression.dailySeed(date)).
export const locationOfDay = (dailySeedValue) => pickLocation(dailySeedValue);
// The wheel needs an order to spin through; the engine's pick is LOCATION_IDS[index].
export const wheelIndex = (id) => Math.max(0, LOCATION_IDS.indexOf(id));

// ---------- Custom lobby rules ----------
// opts.custom = { location: id|'random', mirror: bool, hazards: bool, events: bool, storm: 'slow'|'normal'|'fast' }
// (bots are lobby seats, not a rule). A top-level opts.location (party leader's pick) wins over custom.location.
// The host validates with sanitizeCustom before createMatch (createMatch also re-validates). Unknown keys are dropped.
export const STORM_SPEEDS = { slow: { name: 'Slow', first: 2, every: 1 }, normal: { name: 'Normal', first: 0, every: 0 }, fast: { name: 'Fast', first: -2, every: -1 } };
export const CUSTOM_DEFAULT = Object.freeze({ location: 'random', mirror: false, hazards: true, events: true, storm: 'normal' });
export function sanitizeCustom(c) {
  const d = CUSTOM_DEFAULT;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ...d };
  const own = (k) => Object.prototype.hasOwnProperty.call(c, k);
  const loc = own('location') ? c.location : d.location;
  const storm = own('storm') ? c.storm : d.storm;
  return {
    location: isLocation(loc) ? loc : 'random',
    mirror: own('mirror') ? c.mirror === true : d.mirror,
    hazards: own('hazards') ? c.hazards !== false : d.hazards,
    events: own('events') ? c.events !== false : d.events,
    storm: typeof storm === 'string' && Object.prototype.hasOwnProperty.call(STORM_SPEEDS, storm) ? storm : 'normal',
  };
}
// Storm rules after a Custom storm speed. Modes without a storm (first >= 900) are left alone.
export function stormRules(first, every, speed) {
  const S = STORM_SPEEDS[speed] || STORM_SPEEDS.normal;
  if (!(first < 900)) return { first, every };
  return { first: Math.max(2, first + S.first), every: Math.max(1, every + S.every) };
}
// Which location a match uses: explicit opts.location > Custom choice > seed pick.
export function chooseLocation(seed, opts = {}, custom = null) {
  if (isLocation(opts.location)) return opts.location;
  if (custom && isLocation(custom.location)) return custom.location;
  return pickLocation(seed);
}
// Weighted event pick. pool = the generic kinds allowed this round; adds the location's own signature events.
// r = a uniform random number in [0,1) from the engine RNG. Returns null if nothing is available.
export function eventWeights(locId, pool, { calm = false, last = null } = {}) {
  const L = LOCATIONS[locId], out = [];
  const W = (L && L.events) || {};
  for (const k of pool) if (k !== last) { const w = Object.prototype.hasOwnProperty.call(W, k) ? W[k] : 1; if (w > 0) out.push([k, w]); }
  for (const [k, def] of Object.entries(LOC_EVENTS)) {
    if (k === last || out.some((q) => q[0] === k) || (calm && def.hostile)) continue;
    const w = def.at === locId ? (Object.prototype.hasOwnProperty.call(W, k) ? W[k] : 3) : 0;
    if (w > 0) out.push([k, w]);
  }
  return out;
}
export function weightedPick(list, r) {
  let tot = 0; for (const [, w] of list) tot += w;
  if (!(tot > 0)) return null;
  let x = r * tot;
  for (const [k, w] of list) { x -= w; if (x < 0) return k; }
  return list[list.length - 1][0];
}

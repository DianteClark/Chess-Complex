// 17.0 (L2): the Daily Challenge setup, shared by the game (main.js startSolo) and the cloud Board (server/src/board.js),
// so a submitted run can be re-simulated on the server with exactly the createMatch inputs the phone used.
// Pure module: no DOM at import (the Worker bundles it).
//   dailyLoadout(day)        -> the build of the day {preset, pts, passive, equips, seed}
//   dailySetup(day, human)   -> {players, seed, opts} for createMatch (human = main.js me(): pid 'me', name, skin...)
//   dailyResult(s, pid)      -> {place, total, kills, dmg, score} from a finished (or human-eliminated) state
// day = the game's local date key 'YYYY-M-D' (main.js today()).
import { PRESETS, PIECES, PASSIVES, SKINS, FINISHERS, TRAILS } from './data.js';
import { dailySeed, dailyScore } from './progression.js';

export const PIECE_ORDER = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
export const BOT_NAMES = ['Morphy', 'Tal', 'Capablanca', 'Lasker', 'Alekhine', 'Petrosian', 'Botvinnik', 'Steinitz', 'Anderssen', 'Philidor', 'Nimzo', 'Reti', 'Polgar', 'Rubinstein'];
export const DAILY_BOTS = 7;
export const DAY_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export const utcDayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`; };
// Day number (days since 1970-01-01) of a day key, for "is this within a day of now" checks.
export function dayNum(day) { const m = DAY_RE.exec(String(day || '')); if (!m) return NaN; return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5); }

export function dailyLoadout(day) {
  const seed = dailySeed(day); const keys = Object.keys(PRESETS); const preset = keys[seed % keys.length];
  const equips = {}; PIECE_ORDER.forEach((pc, i) => { equips[pc] = PIECES[pc].equips[(seed >>> (i * 2)) % 3]; });
  return { preset, pts: { ...PRESETS[preset].pts }, passive: PRESETS[preset].passive, equips, seed };
}

// main.js botPlayer(), with Math.random replaced by the daily LCG (same call order, so the same bots come out).
function botPlayer(rnd, i, used, mySkin) {
  const names = BOT_NAMES.filter((n) => !used.includes(n));
  const name = names[Math.floor(rnd() * names.length)] || 'Bot' + i;
  const keys = Object.keys(PRESETS), p = PRESETS[keys[Math.floor(rnd() * keys.length)]];
  const equips = {}; for (const pc of PIECE_ORDER) { const list = PIECES[pc].equips; equips[pc] = list[Math.floor(rnd() * list.length)]; }
  const pks = Object.keys(PASSIVES), passive = rnd() < 0.3 ? pks[Math.floor(rnd() * pks.length)] : p.passive;
  const skins = Object.keys(SKINS).filter((k) => k !== mySkin && SKINS[k].price != null), fins = Object.keys(FINISHERS).filter((k) => FINISHERS[k].price != null);
  const trails = Object.keys(TRAILS);
  return { trail: trails[Math.floor(rnd() * trails.length)], pid: 'bot' + i + rnd().toString(36).slice(2, 6), name, isBot: true, botLevel: 'hard', skin: skins[Math.floor(rnd() * skins.length)], finisher: fins[Math.floor(rnd() * fins.length)], build: { pts: { ...p.pts }, passive, equips } };
}

export function dailySetup(day, human) {
  const L = dailyLoadout(day);
  const h = { ...(human || {}), pid: 'me', name: String((human && human.name) || 'Player').slice(0, 14) };
  if (!SKINS[h.skin]) h.skin = 'ivory';
  delete h.isBot; delete h.botLevel;
  h.build = { pts: { ...L.pts }, passive: L.passive, equips: { ...L.equips } };
  const players = [h];
  let st = L.seed >>> 0; const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  for (let i = 0; i < DAILY_BOTS; i++) players.push(botPlayer(rnd, i, players.map((p) => p.name), h.skin));
  return { players, seed: L.seed, opts: { mode: 'daily' } };
}

export function dailyResult(s, pid = 'me') {
  const u = s && s.units && s.units.find((v) => v.pid === pid && v.kind === 'player');
  if (!u) return null;
  const alive = s.units.filter((v) => v.alive && v.kind === 'player').length;
  const place = u.alive ? (s.over ? 1 : alive) : u.place;
  const total = s.units.filter((v) => v.kind === 'player').length;
  const kills = u.kills || 0, dmg = u.dmgDealt || 0;
  return { place, total, kills, dmg, score: dailyScore(place, kills, dmg, total), final: !!(s.over || !u.alive) };
}

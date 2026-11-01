// Season track (Crown Path), achievements and titles. Pure functions over the saved profile.
import { SEASON, SEASON_REWARDS, ACHIEVEMENTS, SKINS, BOARDS, FINISHERS, DEFAULT_SKINS, DEFAULT_BOARDS, DEFAULT_FINISHERS, PIECES, MASTERY_MAX, masteryCost, MASTERY_TITLES } from './data.js';

export function ensureProgress(p) {
  p.stats = Object.assign({ games: 0, wins: 0, kills: 0, crowns: 0, queens: 0, shardsTotal: 0, ults: 0, hollows: 0, streak: 0, bestStreak: 0, hardWins: 0, flawless: 0, blitzWins: 0, duelWins: 0, dailyDays: 0, squadWins: 0, siegeWins: 0, bestWave: 0, revives: 0, colossi: 0, topMastery: 0 }, p.stats || {});
  if (!p.mastery || typeof p.mastery !== 'object') p.mastery = {};
  for (const k of Object.keys(PIECES)) p.mastery[k] = Math.max(0, Math.floor(+p.mastery[k] || 0));
  // migrate legacy counters
  p.stats.games = Math.max(p.stats.games, p.games || 0); p.stats.wins = Math.max(p.stats.wins, p.wins || 0);
  p.stats.kills = Math.max(p.stats.kills, p.kills || 0); p.stats.crowns = Math.max(p.stats.crowns, p.crowns || 0);
  if (!p.season || p.season.id !== SEASON.id) p.season = { id: SEASON.id, xp: 0, tier: 0 };
  if (!Array.isArray(p.achievements)) p.achievements = [];
  if (!Array.isArray(p.titles)) p.titles = [];
  if (p.title === undefined) p.title = '';
  if (!p.daily) p.daily = { date: '', best: 0, days: [] };
  return p;
}

export const seasonTier = (p) => Math.min(SEASON.tiers, Math.floor(p.season.xp / SEASON.tierXp));
export const seasonProgress = (p) => (p.season.xp % SEASON.tierXp) / SEASON.tierXp;

export function rewardLabel(r) {
  if (r.skin) return { kind: 'Piece Set', name: SKINS[r.skin].name, icon: 'skin', id: r.skin };
  if (r.board) return { kind: 'Board', name: BOARDS[r.board].name, icon: 'board', id: r.board };
  if (r.finisher) return { kind: 'Finisher', name: FINISHERS[r.finisher].name, icon: 'finisher', id: r.finisher };
  if (r.title) return { kind: 'Title', name: r.title, icon: 'title' };
  return { kind: 'Reward', name: `${r.marks} Marks`, icon: 'marks' };
}

function grant(p, r) {
  if (r.marks) p.marks += r.marks;
  if (r.skin && !p.owned.includes(r.skin)) p.owned.push(r.skin);
  if (r.board && !p.ownedBoards.includes(r.board)) p.ownedBoards.push(r.board);
  if (r.finisher && !p.ownedFinishers.includes(r.finisher)) p.ownedFinishers.push(r.finisher);
  if (r.title && !p.titles.includes(r.title)) p.titles.push(r.title);
}

// Adds season XP; returns the list of tiers newly reached with their rewards (already granted).
export function addSeasonXp(p, xp) {
  ensureProgress(p);
  const before = seasonTier(p);
  p.season.xp += xp;
  const after = seasonTier(p);
  const out = [];
  for (let t = before + 1; t <= after; t++) { const r = SEASON_REWARDS[t]; grant(p, r); out.push({ tier: t, ...r }); }
  p.season.tier = after;
  return out;
}

export function achievementValue(p, a) {
  const s = p.stats;
  switch (a.stat) {
    case 'level': return p.level;
    case 'discoveries': return (p.discovered || []).length;
    case 'tutorialDone': return (p.tutorial || []).includes('graduation') || (p.tutorial || []).length >= 5 ? 1 : 0;
    case 'cosmetics': return p.owned.length + p.ownedBoards.length + p.ownedFinishers.length - DEFAULT_SKINS.length - DEFAULT_BOARDS.length - DEFAULT_FINISHERS.length + 3;
    default: return s[a.stat] || 0;
  }
}

// Unlocks any achievements whose goal is met; grants Marks + the achievement name as a title.
export function checkAchievements(p) {
  ensureProgress(p);
  const out = [];
  for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
    if (p.achievements.includes(id)) continue;
    if (achievementValue(p, a) >= a.goal) { p.achievements.push(id); p.marks += a.reward; if (!p.titles.includes(a.name)) p.titles.push(a.name); out.push({ id, ...a }); }
  }
  return out;
}

// Record a finished match into lifetime stats.
export function recordMatch(p, m) {
  ensureProgress(p);
  const s = p.stats;
  s.games++; s.kills += m.kills; s.hollows += m.hollows; s.ults += m.ults; s.shardsTotal += m.shards;
  if (m.crown) s.crowns++;
  if (m.queen) s.queens++;
  if (m.win) {
    s.wins++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (m.hard) s.hardWins++;
    if (m.minHpRatio >= 0.5) s.flawless++;
    if (m.mode === 'blitz') s.blitzWins++;
    if (m.mode === 'duel') s.duelWins++;
    if (m.mode === 'squads') s.squadWins++;
    if (m.mode === 'siege') s.siegeWins++;
  } else s.streak = 0;
  if (m.mode === 'siege') s.bestWave = Math.max(s.bestWave, m.cleared || 0);
  s.revives += m.revives || 0; s.colossi += m.colossi || 0;
  p.games = s.games; p.wins = s.wins; p.kills = s.kills; p.crowns = s.crowns;
}

// Daily challenge: deterministic seed + loadout from the date.
export function dailySeed(date) { let h = 2166136261; for (const c of 'cc-daily-' + date) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function dailyScore(place, kills, dmg, total) { return Math.max(0, (total - place) * 100) + kills * 150 + Math.round(dmg / 2) + (place === 1 ? 500 : 0); }

// ---------- 5.0: piece mastery ----------
export function masteryLevel(xp) {
  let lv = 1, left = xp;
  while (lv < MASTERY_MAX && left >= masteryCost(lv)) { left -= masteryCost(lv); lv++; }
  return { lv, into: left, need: lv < MASTERY_MAX ? masteryCost(lv) : 0 };
}
// pieces: list of pieces held this match (final last). Returns [{piece, gain, from, to, title}]
export function addMastery(p, pieces, perf) {
  ensureProgress(p);
  const out = []; const uniq = [...new Set(pieces)].filter((k) => PIECES[k]);
  const fin = uniq[uniq.length - 1];
  for (const k of uniq) {
    const gain = k === fin ? 60 + perf.kills * 25 + (perf.hollows || 0) * 4 + (perf.win ? 80 : 0) + Math.min(60, Math.round((perf.dmg || 0) / 20)) : 25;
    const from = masteryLevel(p.mastery[k]).lv;
    p.mastery[k] += gain;
    const to = masteryLevel(p.mastery[k]).lv;
    let title = null;
    for (let l = from + 1; l <= to; l++) { p.marks += 30; if (MASTERY_TITLES[l]) { title = `${PIECES[k].name} ${MASTERY_TITLES[l]}`; if (!p.titles.includes(title)) p.titles.push(title); } if (l === MASTERY_MAX) p.marks += 300; }
    out.push({ piece: k, gain, from, to, title });
  }
  p.stats.topMastery = Math.max(p.stats.topMastery || 0, ...Object.values(p.mastery).map((x) => masteryLevel(x).lv));
  return out;
}

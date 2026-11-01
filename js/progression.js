// Season track (Crown Path), achievements, titles, login streak, collections and profile stats. Pure functions over the saved profile.
import { SEASON, PAST_SEASONS, SEASON_REWARDS, ACHIEVEMENTS, SKINS, BOARDS, FINISHERS, TRAILS, EMOTE_PACKS, BUNDLES, MODES, LOGIN_REWARDS, RARITIES, DEFAULT_SKINS, DEFAULT_BOARDS, DEFAULT_FINISHERS, PIECES, MASTERY_MAX, masteryCost, MASTERY_TITLES } from './data.js';

const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

export function ensureProgress(p) {
  p.stats = Object.assign({ games: 0, wins: 0, kills: 0, crowns: 0, queens: 0, shardsTotal: 0, ults: 0, hollows: 0, streak: 0, bestStreak: 0, hardWins: 0, flawless: 0, blitzWins: 0, duelWins: 0, dailyDays: 0, squadWins: 0, siegeWins: 0, bestWave: 0, revives: 0, colossi: 0, topMastery: 0, dmgTotal: 0 }, p.stats && typeof p.stats === 'object' ? p.stats : {});
  for (const k of Object.keys(p.stats)) if (typeof p.stats[k] !== 'number' || !isFinite(p.stats[k])) p.stats[k] = 0;
  if (!p.mastery || typeof p.mastery !== 'object') p.mastery = {};
  for (const k of Object.keys(PIECES)) p.mastery[k] = Math.max(0, Math.floor(+p.mastery[k] || 0));
  // migrate legacy counters
  p.stats.games = Math.max(p.stats.games, p.games || 0); p.stats.wins = Math.max(p.stats.wins, p.wins || 0);
  p.stats.kills = Math.max(p.stats.kills, p.kills || 0); p.stats.crowns = Math.max(p.stats.crowns, p.crowns || 0);
  // seasons: a profile from an older season keeps a record of how far it got, then starts the new track at tier 0
  if (!Array.isArray(p.pastSeasons)) p.pastSeasons = [];
  p.pastSeasons = p.pastSeasons.filter((s) => s && typeof s === 'object' && typeof s.id === 'number');
  if (!p.season || typeof p.season !== 'object' || p.season.id !== SEASON.id) {
    const old = p.season && typeof p.season === 'object' ? p.season : null;
    if (old && typeof old.id === 'number' && old.id !== SEASON.id && !p.pastSeasons.some((s) => s.id === old.id)) p.pastSeasons.push({ id: old.id, tier: Math.max(0, Math.floor(+old.tier || 0)) });
    p.season = { id: SEASON.id, xp: 0, tier: 0 };
  }
  p.season.xp = Math.max(0, Math.floor(+p.season.xp || 0));
  p.season.tier = Math.min(SEASON.tiers, Math.floor(p.season.xp / SEASON.tierXp));
  if (!Array.isArray(p.season.pending)) p.season.pending = [];
  if (typeof p.season.shown !== 'number') p.season.shown = p.season.tier; // last tier whose item reward was shown with the reveal // tiers whose reward fell back (e.g. finisher not shipped yet)
  if (!Array.isArray(p.achievements)) p.achievements = [];
  if (!Array.isArray(p.titles)) p.titles = [];
  p.titles = arr(p.titles);
  if (typeof p.title !== 'string') p.title = '';
  if (!p.daily) p.daily = { date: '', best: 0, days: [] };
  if (!p.login || typeof p.login !== 'object') p.login = { last: '', streak: 0, best: 0, claimed: '' };
  for (const k of ['streak', 'best']) p.login[k] = Math.max(0, Math.floor(+p.login[k] || 0));
  for (const k of ['last', 'claimed']) if (typeof p.login[k] !== 'string') p.login[k] = '';
  p.modesPlayed = arr(p.modesPlayed); p.modesWon = arr(p.modesWon);
  p.collections = arr(p.collections).filter((k) => BUNDLES[k]);
  return p;
}

export const seasonTier = (p) => Math.min(SEASON.tiers, Math.floor(p.season.xp / SEASON.tierXp));
export const seasonProgress = (p) => (p.season.xp % SEASON.tierXp) / SEASON.tierXp;
export function seasonDaysLeft(now = new Date()) { const e = new Date(SEASON.ends + 'T00:00:00'); return Math.max(0, Math.ceil((e - now) / 86400000)); }

// A reward whose item does not exist in this build (e.g. a finisher still in development) pays its fallback.
export function resolveReward(r) {
  if (!r) return { marks: 0 };
  if (r.finisher && !FINISHERS[r.finisher]) return r.fallback || { marks: 500 };
  if (r.skin && !SKINS[r.skin]) return r.fallback || { marks: 500 };
  if (r.board && !BOARDS[r.board]) return r.fallback || { marks: 500 };
  if (r.trail && !TRAILS[r.trail]) return r.fallback || { marks: 300 };
  if (r.emote && !EMOTE_PACKS[r.emote]) return r.fallback || { marks: 200 };
  return r;
}
export const rewardKind = (r) => (r.skin ? 'skin' : r.board ? 'board' : r.finisher ? 'finisher' : r.trail ? 'trail' : r.emote ? 'emote' : null);
export function rewardLabel(r0) {
  const r = resolveReward(r0);
  if (r.skin) return { kind: 'Piece Set', name: SKINS[r.skin].name, icon: 'skin', id: r.skin, k: 'skin' };
  if (r.board) return { kind: 'Board', name: BOARDS[r.board].name, icon: 'board', id: r.board, k: 'board' };
  if (r.finisher) return { kind: 'Finisher', name: FINISHERS[r.finisher].name, icon: 'finisher', id: r.finisher, k: 'finisher' };
  if (r.trail) return { kind: 'Trail', name: TRAILS[r.trail].name, icon: 'trail', id: r.trail, k: 'trail' };
  if (r.emote) return { kind: 'Emote Pack', name: EMOTE_PACKS[r.emote].name, icon: 'emote', id: r.emote, k: 'emote' };
  if (r.title) return { kind: 'Title', name: r.title, icon: 'title' };
  return { kind: 'Marks', name: `${r.marks || 0} Marks`, icon: 'marks' };
}

function push(list, id) { if (!list.includes(id)) list.push(id); }
export function grantReward(p, r0) {
  const r = resolveReward(r0);
  if (r.marks) p.marks += r.marks;
  if (r.skin) push(p.owned, r.skin);
  if (r.board) push(p.ownedBoards, r.board);
  if (r.finisher) push(p.ownedFinishers, r.finisher);
  if (r.trail) { if (!Array.isArray(p.ownedTrails)) p.ownedTrails = ['none']; push(p.ownedTrails, r.trail); }
  if (r.emote) { if (!Array.isArray(p.ownedEmotes)) p.ownedEmotes = ['basic']; push(p.ownedEmotes, r.emote); }
  if (r.title) push(p.titles, r.title);
  return r;
}

// Adds season XP; returns the list of tiers newly reached with their rewards (already granted).
export function addSeasonXp(p, xp) {
  ensureProgress(p);
  const before = seasonTier(p);
  p.season.xp += Math.max(0, Math.floor(xp));
  const after = seasonTier(p);
  const out = [];
  for (let t = before + 1; t <= after; t++) { const r = SEASON_REWARDS[t]; const got = grantReward(p, r); if (got !== r) p.season.pending.push(t); out.push({ tier: t, ...got }); }
  p.season.tier = after;
  return out;
}
// If a fallback was paid for a tier and the real item has since shipped, grant the item too.
export function settlePending(p) {
  ensureProgress(p);
  const out = [];
  p.season.pending = p.season.pending.filter((t) => { const r = SEASON_REWARDS[t]; if (r && resolveReward(r) === r) { grantReward(p, { ...r, marks: 0 }); out.push({ tier: t, ...r }); return false; } return true; });
  return out;
}

// ---------- counts ----------
const OWN_KEYS = { skin: ['owned', SKINS, DEFAULT_SKINS], board: ['ownedBoards', BOARDS, DEFAULT_BOARDS], finisher: ['ownedFinishers', FINISHERS, DEFAULT_FINISHERS], trail: ['ownedTrails', TRAILS, ['none']], emote: ['ownedEmotes', EMOTE_PACKS, ['basic']] };
export function rarityOfAny(kind, id) {
  const T = OWN_KEYS[kind][1][id];
  if (T && T.rarity) return T.rarity;
  const r = (RARITIES[kind] || {})[id];
  if (r) return r;
  if (T && T.price == null) return 'season';
  return kind === 'finisher' && T && T.price ? (T.price >= 1500 ? 'mythic' : T.price >= 800 ? 'legendary' : T.price >= 450 ? 'epic' : 'rare') : 'common';
}
export function ownedCounts(p) {
  const out = { total: 0, all: 0, byKind: {}, byRarity: {} };
  for (const [kind, [key, T, defs]] of Object.entries(OWN_KEYS)) {
    const owned = arr(p[key]).filter((id) => T[id]);
    out.byKind[kind] = { owned: owned.length, total: Object.keys(T).length };
    out.total += owned.filter((id) => !defs.includes(id)).length; out.all += Object.keys(T).length - defs.length;
    for (const id of owned) { const r = rarityOfAny(kind, id); out.byRarity[r] = (out.byRarity[r] || 0) + 1; }
  }
  return out;
}
export function collectionDone(p, key) {
  const B = BUNDLES[key]; if (!B) return false;
  return B.items.every(([k, id]) => !OWN_KEYS[k][1][id] || arr(p[OWN_KEYS[k][0]]).includes(id));
}
// Grants completion rewards for any collection that is fully owned and not yet claimed. Returns the newly claimed list.
export function claimCollections(p) {
  ensureProgress(p);
  const out = [];
  for (const key of Object.keys(BUNDLES)) {
    if (p.collections.includes(key) || !BUNDLES[key].reward || !collectionDone(p, key)) continue;
    p.collections.push(key); grantReward(p, BUNDLES[key].reward); out.push({ key, ...BUNDLES[key] });
  }
  return out;
}

export function achievementGoal(a) { return a.goal === 'modes' ? Object.keys(MODES).length : a.goal; }
export function achievementValue(p, a) {
  const s = p.stats;
  switch (a.stat) {
    case 'level': return p.level;
    case 'discoveries': return (p.discovered || []).length;
    case 'tutorialDone': return (p.tutorial || []).includes('graduation') || (p.tutorial || []).length >= 5 ? 1 : 0;
    case 'cosmetics': return ownedCounts(p).total + 3;
    case 'mythics': return ownedCounts(p).byRarity.mythic || 0;
    case 'collections': return (p.collections || []).length;
    case 'modesPlayed': return (p.modesPlayed || []).filter((m) => MODES[m]).length;
    case 'modesWon': return (p.modesWon || []).filter((m) => MODES[m]).length;
    case 'mastered': return Object.values(p.mastery || {}).filter((x) => masteryLevel(x).lv >= MASTERY_MAX).length;
    case 'minMastery': return Math.min(...['pawn', 'knight', 'bishop', 'rook', 'queen'].filter((k) => PIECES[k]).map((k) => masteryLevel((p.mastery || {})[k] || 0).lv));
    case 'bestLogin': return (p.login || {}).best || 0;
    case 'seasonTier': return seasonTier(p);
    case 'seasonsPlayed': return (p.pastSeasons || []).length + 1;
    case 'wished': return Math.max(s.wished || 0, (p.wishlist || []).length);
    default: return s[a.stat] || 0;
  }
}

// Unlocks any achievements whose goal is met; grants Marks + the achievement name as a title.
export function checkAchievements(p) {
  ensureProgress(p);
  const out = [];
  for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
    if (p.achievements.includes(id)) continue;
    if (achievementValue(p, a) >= achievementGoal(a)) { p.achievements.push(id); p.marks += a.reward; if (!p.titles.includes(a.name)) p.titles.push(a.name); out.push({ id, ...a }); }
  }
  return out;
}

// Record a finished match into lifetime stats.
export function recordMatch(p, m) {
  ensureProgress(p);
  const s = p.stats;
  s.games++; s.kills += m.kills || 0; s.hollows += m.hollows || 0; s.ults += m.ults || 0; s.shardsTotal += m.shards || 0; s.dmgTotal += Math.max(0, Math.round(m.dmg || 0));
  if (m.crown) s.crowns++;
  if (m.queen) s.queens++;
  if (m.mode && !p.modesPlayed.includes(m.mode)) p.modesPlayed.push(m.mode);
  if (m.win) {
    s.wins++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (m.mode && !p.modesWon.includes(m.mode)) p.modesWon.push(m.mode);
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

// ---------- 10.0: daily login streak ----------
const dkey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
// Returns { day (1-7 in the cycle), streak, reward } if today's reward is unclaimed, else null.
export function loginStatus(p, now = new Date()) {
  ensureProgress(p);
  const today = dkey(now), y = new Date(now); y.setDate(y.getDate() - 1);
  const L = p.login;
  if (L.claimed === today) return { claimed: true, streak: L.streak, day: ((L.streak - 1) % 7) + 1, reward: LOGIN_REWARDS[(L.streak - 1) % 7] };
  const streak = L.last === dkey(y) ? L.streak + 1 : 1;
  return { claimed: false, streak, day: ((streak - 1) % 7) + 1, reward: LOGIN_REWARDS[(streak - 1) % 7] };
}
export function claimLogin(p, now = new Date()) {
  const st = loginStatus(p, now);
  if (st.claimed) return null;
  p.login.streak = st.streak; p.login.best = Math.max(p.login.best, st.streak); p.login.last = p.login.claimed = dkey(now);
  grantReward(p, st.reward);
  st.tiers = st.reward.xp ? addSeasonXp(p, st.reward.xp) : [];
  return st;
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

export { PAST_SEASONS };

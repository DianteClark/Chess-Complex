// Chess Complex 18.1 "Warden Rating" (L3): the co-op performance rating (Siege + Gauntlet, solo and 2-4 players).
// Pure module shared by the client (js/wardenui.js, js/ranks.js) and the cloud Board (server/src/warden.js,
// server/src/lbcore.js): run facts from a finished engine state, the run score, the rating aggregate, tiers and the
// weekly co-op season rewards. No window/document at import (the Worker bundles it).
//
// Co-op is played against the AI, so this is a PERFORMANCE rating, not Elo:
//   run score = round( BASE x MODE x PARTY x SHARE )
//     BASE  = wave * (cleared / waves) ^ curve + (won ? win : 0)          how far the team got (0..1000)
//     MODE  = mode[siege | gauntlet]                                       Gauntlet is the harder board
//     PARTY = (1 + sum of ally weights) ^ -party                           solo with no allies = 1; every ally
//             human ally weight 1, bot ally weight bot[easy|normal|hard]   (human or bot) makes the run easier
//     SHARE = 1 + carry * clamp(n * share - 1, -1, 1)                      contribution, a small +-carry swing
//             share = kills * w.hk + damage * w.dmg + revives * w.rev      (each as your fraction of the team's)
//   Warden Rating = mean of your best ceil(k / 3) (at most best = 10) run scores among your last k (at most
//   window = 30) counted runs: the top third of recent form, so playing more neither inflates nor drags it.
//   Provisional (hidden from the board, dashed badge) until prov = 5 counted runs.
//   Weekly co-op season points = the sum of your best 10 run scores this week (ISO week, Monday 00:00 UTC).
// Bands were set from simulated bot runs (server/test/wardensim.mjs; numbers in docs/V10_NOTES.md, L3 note).
export const WARDEN = {
  wave: 800, curve: 1.15, win: 200,
  mode: { siege: 1, gauntlet: 1.2 },
  party: 0.2,
  bot: { easy: 0.8, normal: 1.15, hard: 1.4 },
  carry: 0.15, w: { hk: 0.45, dmg: 0.45, rev: 0.1 },
  window: 30, best: 10, prov: 5, seasonBest: 10,
  quit: 0, // score of a registered solo run that was abandoned (counts in the window)
};
export const COOP_MODES = ['siege', 'gauntlet'];
export const isCoop = (mode) => COOP_MODES.includes(mode);

// ---------- run facts (from a finished, or player-eliminated, engine state) ----------
// -> {mode, waves, cleared, won, n, me, team: [{pid, human, lvl, hk, dmg, rev}], final}
export function runFacts(s, pid) {
  const S = s && s.siege; if (!S || !Array.isArray(s.units)) return null;
  const team = s.units.filter((u) => u.kind === 'player');
  const me = team.findIndex((u) => u.pid === pid); if (me < 0) return null;
  const won = !!s.siegeWon;
  const cleared = won ? S.waves : Math.max(0, Math.min(S.waves, S.next ? S.wave : S.wave - 1));
  // revives are only in the match log ("<name> revived <name>"); a shared name splits its count
  const names = {}; for (const u of team) names[u.name] = (names[u.name] || 0) + 1;
  const rev = {}; for (const l of Array.isArray(s.log) ? s.log : []) { const m = /^(.+?) revived /.exec(String(l)); if (m && names[m[1]]) rev[m[1]] = (rev[m[1]] || 0) + 1; }
  return {
    mode: S.gauntlet ? 'gauntlet' : 'siege', waves: S.waves, cleared, won, n: team.length, me,
    team: team.map((u) => ({ pid: u.pid, human: !u.bot, lvl: u.botLevel || 'normal', hk: u.hk || 0, dmg: Math.round(u.dmgDealt || 0), rev: (rev[u.name] || 0) / names[u.name] })),
    final: !!(s.over || !team[me].alive),
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// contribution multiplier of team member i (1 when alone or exactly average)
export function shareMul(team, i, W = WARDEN) {
  const n = team.length; if (n < 2) return 1;
  let share = 0, wsum = 0;
  for (const k of ['hk', 'dmg', 'rev']) {
    const tot = team.reduce((a, t) => a + (+t[k] || 0), 0);
    if (!(tot > 0)) continue; // nobody did this: its weight is dropped, not handed out evenly
    share += W.w[k] * ((+team[i][k] || 0) / tot); wsum += W.w[k];
  }
  if (!wsum) return 1;
  return 1 + W.carry * clamp(n * (share / wsum) - 1, -1, 1);
}
export function partyMul(team, i, W = WARDEN) {
  let eff = 1;
  team.forEach((t, k) => { if (k !== i) eff += t.human ? 1 : (W.bot[t.lvl] ?? W.bot.normal); });
  return eff ** -W.party;
}
// -> {score, base, mode, party, share}
export function runScore(f, W = WARDEN) {
  if (!f || !isCoop(f.mode) || !(f.waves > 0)) return { score: 0, base: 0, mode: 0, party: 0, share: 0 };
  const base = W.wave * clamp(f.cleared / f.waves, 0, 1) ** W.curve + (f.won ? W.win : 0);
  const mode = W.mode[f.mode] || 1, party = partyMul(f.team, f.me, W), share = shareMul(f.team, f.me, W);
  return { score: Math.round(base * mode * party * share), base: Math.round(base), mode, party: +party.toFixed(3), share: +share.toFixed(3) };
}
// every member's score at once (cloud rooms)
export const teamScores = (f, W = WARDEN) => f.team.map((_, i) => runScore({ ...f, me: i }, W).score);

// ---------- aggregate ----------
// scores: newest first (any length; only the first `window` are read). -> {r, k, used, prov}
export function aggregate(scores, W = WARDEN) {
  const last = (Array.isArray(scores) ? scores : []).slice(0, W.window).map((v) => Math.max(0, +v || 0));
  const k = last.length; if (!k) return { r: 0, k: 0, used: 0, prov: true };
  const used = Math.min(W.best, Math.ceil(k / 3));
  const top = [...last].sort((a, b) => b - a).slice(0, used);
  return { r: Math.round((top.reduce((a, b) => a + b, 0) / used) * 10) / 10, k, used, prov: k < W.prov };
}
// weekly season points: the sum of the best `seasonBest` run scores of the week. best: the kept list (desc)
export function seasonAdd(best, score, W = WARDEN) {
  const b = [...(Array.isArray(best) ? best : []), Math.max(0, +score || 0)].sort((x, y) => y - x).slice(0, W.seasonBest);
  return { best: b, pts: b.reduce((a, v) => a + v, 0) };
}

// ---------- tiers ----------
// art: hex emblem (not the Crown shield), glyph per tier. Bands: see the header (simulated distribution).
export const WTIERS = [
  { id: 'squire', name: 'Squire', min: 0, color: '#b9c2b0', c2: '#5c6656' },
  { id: 'sentinel', name: 'Sentinel', min: 450, color: '#8fe0c8', c2: '#2b7a66' },
  { id: 'guardian', name: 'Guardian', min: 650, color: '#7ec8f2', c2: '#25628c' },
  { id: 'bulwark', name: 'Bulwark', min: 800, color: '#e9b46a', c2: '#8a5420' },
  { id: 'paladin', name: 'Paladin', min: 920, color: '#f4e3a1', c2: '#a07d22' },
  { id: 'warden', name: 'Warden', min: 1050, color: '#c6f27a', c2: '#3f7a1c' },
];
export function wtierOf(r, prov) {
  const v = Math.max(0, Math.round(Number(r) || 0));
  let i = 0; for (let k = 0; k < WTIERS.length; k++) if (v >= WTIERS[k].min) i = k;
  return { ...WTIERS[i], i, r: v, prov: !!prov, next: WTIERS[i + 1] ? WTIERS[i + 1].min : null };
}
// wire shape on rows / lobby seats: {w, wp?} merged into the {r, p?} rank object (js/rivals.js cleanRk keeps it)
export const wkPub = (wr, games, W = WARDEN) => (games > 0 ? { w: Math.round(Number(wr) || 0), ...(games >= W.prov ? {} : { wp: 1 }) } : {});
export function cleanWk(x) {
  if (!x || typeof x !== 'object' || x.w == null) return null;
  const w = Math.round(Number(x.w)); if (!Number.isFinite(w) || w < 0 || w > 5000) return null;
  return x.wp ? { w, wp: 1 } : { w };
}

// ---------- weekly co-op season rewards (Board rollover -> Player DO inbox k:'wseason' -> js/ranks.js) ----------
export const WSEASON_REWARDS = [
  { max: 1, id: 'w_champion', title: 'Lord of the Keep', banner: 'warden_champion' },
  { max: 3, id: 'w_podium', title: 'Keepwarden', banner: 'warden_podium' },
  { max: 10, id: 'w_elite', title: 'Wavebreaker', banner: 'warden_elite' },
  { max: 50, id: 'w_contender', title: 'Hollowbane', banner: 'warden_contender' },
];
export const wrewardFor = (rank) => WSEASON_REWARDS.find((x) => rank >= 1 && rank <= x.max) || null;
// apply one inbox item to a profile (idempotent). -> {rank, rw} when something new was granted, else null
export function applyReward(p, it) {
  const rw = wrewardFor(+it.rank); if (!p || !rw) return null;
  p.titles = Array.isArray(p.titles) ? p.titles : [];
  if (!p.titles.includes(rw.title)) p.titles.push(rw.title);
  p.ownedBanners = Array.isArray(p.ownedBanners) ? p.ownedBanners : [];
  if (!p.ownedBanners.includes(rw.banner)) p.ownedBanners.push(rw.banner);
  p.wardenRewards = [...(Array.isArray(p.wardenRewards) ? p.wardenRewards : []).filter((x) => x && x.sid !== it.sid), { sid: String(it.sid || '').slice(0, 12), rank: +it.rank | 0, reward: rw.id, title: rw.title, banner: rw.banner }].slice(-12);
  return { rank: +it.rank | 0, rw };
}

// ---------- solo: start validation (the server rebuilds the createMatch inputs from clean fields only) ----------
import { PASSIVES, PIECES, SKINS, FINISHERS, TRAILS, STAT_POINTS } from './data.js';
const LEVELS = ['easy', 'normal', 'hard'];
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, n) : '');
function cleanPts(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {}; let sum = 0;
  for (const k of ['hp', 'atk', 'def', 'spd']) { const v = p[k] ?? 0; if (!Number.isInteger(v) || v < 0) return null; out[k] = v; sum += v; }
  return sum <= STAT_POINTS ? out : null;
}
function cleanBuild(b) {
  if (!b || typeof b !== 'object') return null;
  const pts = cleanPts(b.pts); if (!pts || !own(PASSIVES, b.passive)) return null;
  const equips = {};
  for (const pc of Object.keys(PIECES)) { const E = PIECES[pc].equips || []; if (!E.length) continue; const e = b.equips && b.equips[pc]; if (!E.includes(e)) return null; equips[pc] = e; }
  return { pts, passive: b.passive, equips };
}
export function cleanStart(players, opts, mode, seed) {
  if (!isCoop(mode) || !Array.isArray(players) || players.length < 1 || players.length > 4) return null;
  if (!opts || typeof opts !== 'object' || opts.mode !== mode || opts.custom || (opts.nemesis && Object.keys(opts.nemesis).length)) return null;
  const o = { mode }; if (opts.location != null) { if (typeof opts.location !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(opts.location)) return null; o.location = opts.location; }
  const out = [], pids = new Set();
  for (let i = 0; i < players.length; i++) {
    const p = players[i]; if (!p || typeof p !== 'object') return null;
    const bot = i > 0;
    if (bot ? !(p.isBot === true && LEVELS.includes(p.botLevel) && typeof p.pid === 'string' && /^bot[0-9a-z]{1,20}$/.test(p.pid)) : (p.pid !== 'me' || p.isBot)) return null;
    if (pids.has(p.pid)) return null; pids.add(p.pid);
    const build = cleanBuild(p.build); if (!build) return null;
    const q = { pid: p.pid, name: clip(p.name, 14) || 'Player', title: clip(p.title, 24), skin: own(SKINS, p.skin) ? p.skin : 'ivory', finisher: own(FINISHERS, p.finisher) ? p.finisher : 'shatter', trail: own(TRAILS, p.trail) ? p.trail : 'none', build };
    if (bot) { q.isBot = true; q.botLevel = p.botLevel; }
    out.push(q);
  }
  return { players: out, seed, opts: o };
}


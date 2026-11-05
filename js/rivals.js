// Chess Complex 18.0 "Rivals" (NE): shared pure helpers for Nemesis + Ranks. Imported by the client (js/nemesis.js,
// js/ranks.js, main.js) AND the cloud server (server/src/core.js, board.js), so both ends agree on tiers and on how a
// player's Nemesis is matched to a seat. No window/document: safe in workerd and Node.

// ---------- Ranks: Crown Rating tiers (lbcore.js: start 1200, floor 100, provisional for the first 10 rated games) ----------
export const PROVISIONAL = 10;
export const TIERS = [
  { id: 'pawn', name: 'Pawn', min: 0, color: '#9aa3b5', c2: '#5d6578' },
  { id: 'knight', name: 'Knight', min: 1100, color: '#7fd1a8', c2: '#2f7d5a' },
  { id: 'bishop', name: 'Bishop', min: 1250, color: '#7fb7ff', c2: '#2e5fae' },
  { id: 'rook', name: 'Rook', min: 1400, color: '#c49bff', c2: '#6a3fb5' },
  { id: 'queen', name: 'Queen', min: 1550, color: '#ff8fb8', c2: '#a8355f' },
  { id: 'king', name: 'King', min: 1750, color: '#ffd166', c2: '#b9832a' },
];
// {r, games} | {r, p} -> {id, name, color, c2, r, prov, next (rating of the next tier or null), i}
export function tierOf(r, games) {
  const v = Math.round(Number(r) || 1200);
  const prov = typeof games === 'boolean' ? games : !(Number(games) >= PROVISIONAL);
  let i = 0; for (let k = 0; k < TIERS.length; k++) if (v >= TIERS[k].min) i = k;
  const T = TIERS[i];
  return { ...T, i, r: v, prov, next: TIERS[i + 1] ? TIERS[i + 1].min : null };
}
// wire shape used in lobbies and leaderboard rows: {r, p} (p = 1 while provisional)
export function rkPub(r, games) { return { r: Math.round(Number(r) || 1200), ...(Number(games) >= PROVISIONAL ? {} : { p: 1 }) }; }
export function cleanRk(x) {
  if (!x || typeof x !== 'object') return null;
  const r = Math.round(Number(x.r));
  if (!Number.isFinite(r) || r < 0 || r > 5000) return null;
  const o = x.p ? { r, p: 1 } : { r };
  const w = Math.round(Number(x.w)); if (x.w != null && Number.isFinite(w) && w >= 0 && w <= 5000) { o.w = w; if (x.wp) o.wp = 1; } // 18.1 (L3): Warden Rating (co-op) rides along
  return o;
}

// ---------- Weekly season rewards (board.js rollover -> Player DO inbox -> cloud save) ----------
export const SEASON_REWARDS = [
  { max: 1, id: 'champion', title: 'Season Champion', banner: 'season_champion' },
  { max: 3, id: 'podium', title: 'Season Finalist', banner: 'season_podium' },
  { max: 10, id: 'elite', title: 'Season Elite', banner: 'season_elite' },
  { max: 50, id: 'contender', title: 'Season Contender', banner: 'season_contender' },
];
export const rewardFor = (rank) => SEASON_REWARDS.find((x) => rank >= 1 && rank <= x.max) || null;

// ---------- Nemesis matching ----------
// nid = a public, non-reversible handle for a verified cloud id (12 Crockford chars of SHA-256('cc-nem:' + cid)).
// The Room computes it for verified seats; a peer-to-peer member reports its own (unverified, cosmetic stakes only).
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export async function nidOf(cid) {
  if (typeof cid !== 'string' || !/^[0-9A-Za-z]{10}$/.test(cid)) return null;
  try {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cc-nem:' + cid.toUpperCase())));
    let out = ''; for (let i = 0; i < 12; i++) out += B32[d[i] & 31];
    return out;
  } catch { return null; }
}
export const NID_RE = /^[0-9A-Z]{12}$/;
// what a client says about its Nemesis: {nid, n} (a person) | {bot: name, n} (a bot, by name)
export function cleanNem(x) {
  if (!x || typeof x !== 'object') return null;
  const n = Math.max(1, Math.min(99, Math.floor(+x.n) || 1));
  if (typeof x.nid === 'string' && NID_RE.test(x.nid)) return { nid: x.nid, n };
  if (typeof x.bot === 'string' && x.bot.trim()) return { bot: x.bot.replace(/[<>]/g, '').slice(0, 14), n };
  return null;
}
// seats: [{pid, isBot, name, nid?, nem?}] -> createMatch opts.nemesis ({hunterPid: {pid, n}}) or null.
// A human hunts the seat whose nid matches (or the bot with that name); bots may carry nem too (solo prey).
export function nemMap(seats) {
  if (!Array.isArray(seats)) return null;
  const out = {};
  for (const p of seats) {
    const e = p && cleanNem(p.nem); if (!e || typeof p.pid !== 'string') continue;
    const t = seats.find((q) => q && q !== p && typeof q.pid === 'string' && (e.nid ? !q.isBot && q.nid === e.nid : q.isBot && q.name === e.bot));
    if (t) out[p.pid] = { pid: t.pid, n: e.n };
  }
  return Object.keys(out).length ? out : null;
}

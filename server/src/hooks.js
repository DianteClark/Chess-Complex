// 17.0 (S2): match-end fan-out. The Room calls matchEnded(env, ctx, rec) once per finished match; it never throws.
//   replay.save(env, rec) -> replay id (awaited, so the Room can hand it to clients: {t:'replay', mid, id})
//   stats.record(env, rec), board.rate(env, rec), platform.track(env, rec) -> ctx.waitUntil (fire and forget)
// Modules are registered by room.js with use({stats, board, replay, platform}) (or passed as the 4th argument in
// tests), so this file imports nothing Cloudflare-specific and runs in Node. A missing export is skipped; a throwing or
// hanging one is caught / timed out and logged, and never breaks the match or the other consumers.
//
// rec (v:1, <= 200 KB, see docs/V10_NOTES.md "S2 -> all"):
//   { v, id, mid, room, ver, mode, location, t0, t1,
//     start: { players, seed, opts },            exact createMatch(players, seed, opts) inputs
//     actions: [[pid, a, to?], ...],              every accepted action in order (humans, bots, timeouts: to = 1)
//     humans: { [seatPid]: { name, cid, verified, title, avatar, drops, left, pub? } },  cid only when verified
//     seats: same object as humans (alias),       pub = {name, title, avatar} from the verified cloud profile
//     actions pid null = a Hollow (no pid): replay with applyAction(s, pid ?? undefined, a)
//     result: { winner, winnerPid, team, places: [{pid, id, name, place, bot, team}], rounds, siegeWon, wave, v, hash },
//     tampered?, big?,  state (non-enumerable, in memory only: the final engine state; never in JSON) }
export const REC_MAX = 200 * 1024;
export const H = { timeout: 8000 }; // per consumer
let MODS = {};
export function use(mods) { MODS = { ...MODS, ...(mods || {}) }; return MODS; }

const log = (...a) => { try { console.log('[hooks]', ...a); } catch {} };
function call(mod, name, env, rec) {
  const fn = mod && mod[name];
  if (typeof fn !== 'function') return null;
  let to;
  const p = (async () => fn(env, rec))();
  return Promise.race([p, new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout')), H.timeout); })])
    .finally(() => clearTimeout(to))
    .catch((e) => { log(name, 'failed:', String(e && e.message || e).slice(0, 160)); return null; });
}
// enforce the size cap: drop the action list first (a record without actions can't be replayed, flagged big)
// (rec.state, the final state in memory, is non-enumerable: not counted, kept on the capped copy)
export function capRec(rec) {
  try {
    if (JSON.stringify(rec).length <= REC_MAX) return rec;
    const keep = (r) => { if (rec.state) Object.defineProperty(r, 'state', { value: rec.state, enumerable: false }); return r; };
    const r = keep({ ...rec, actions: [], big: true });
    if (JSON.stringify(r).length <= REC_MAX) return r;
    return keep({ ...r, start: { seed: rec.start && rec.start.seed, opts: rec.start && rec.start.opts, players: [] } });
  } catch { return rec; }
}

// Returns Promise<replay id | null>. ctx: anything with waitUntil (Worker ctx, or the Room's collector).
export async function matchEnded(env, ctx, rec, mods) {
  try {
    const M = mods || MODS;
    rec = capRec(rec);
    const bg = (p) => { if (!p) return; try { if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); } catch {} };
    bg(call(M.stats, 'record', env, rec));
    bg(call(M.board, 'rate', env, rec));
    bg(call(M.platform, 'track', env, rec));
    const r = await call(M.replay, 'save', env, rec);
    const id = typeof r === 'string' ? r : r && typeof r.id === 'string' ? r.id : null;
    return id && /^[A-Za-z0-9_-]{4,40}$/.test(id) ? id : null;
  } catch (e) { log('matchEnded failed:', String(e && e.message || e).slice(0, 160)); return null; }
}

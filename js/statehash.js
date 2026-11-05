// 17.0 (S1): shared by the cloud server (server/src/room.js) and the client (js/cloud.js). Lockstep check: the server
// and every client run the same deterministic engine; every 8 actions the server sends stateHash(s) and a client whose
// hash differs asks for a snapshot. Both ends must import THIS file so the hash is identical.
// Pure module: no window/document, safe in workerd and Node.
import { createMatch, applyAction, legalMoves, canMove, unitById } from './engine.js';

// Fields that are not part of the lockstep contract:
//  aiSeed  planner RNG (only the server plans bots; replays apply the planned actions)
//  _guard  scratch the engine clears after each action
//  bot     on units: who drives the seat (server-side scheduling only, mirrored by {t:'seat'})
const SKIP = new Set(['aiSeed', '_guard']);

// 32-bit FNV-1a over a canonical walk of the value (key order = insertion order, which the engine fixes; a JSON
// round trip keeps it). Numbers hash by their String() form, so 1 and 1.0 agree and NaN/Infinity are stable.
export function stateHash(s) {
  let h = 0x811c9dc5;
  const str = (t) => { for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } };
  const walk = (v, unit) => {
    if (v === null || v === undefined) { str(v === null ? '~n' : '~u'); return; }
    const ty = typeof v;
    if (ty === 'number') { str('#' + v); return; }
    if (ty === 'string') { str('"'); str(v); str('"'); return; }
    if (ty === 'boolean') { str(v ? '~t' : '~f'); return; }
    if (Array.isArray(v)) { str('['); for (let i = 0; i < v.length; i++) walk(v[i], false); str(']'); return; }
    if (ty === 'object') {
      str('{');
      for (const k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        const x = v[k];
        if (x === undefined || typeof x === 'function' || SKIP.has(k) || (unit && k === 'bot')) continue;
        str(k); str(':'); walk(x, false);
      }
      str('}');
    }
  };
  if (!s || typeof s !== 'object') return 0;
  str('{');
  for (const k in s) {
    if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
    const x = s[k];
    if (x === undefined || SKIP.has(k)) continue;
    str(k); str(':');
    if (k === 'units' && Array.isArray(x)) { str('['); for (const u of x) walk(u, true); str(']'); }
    else walk(x, false);
  }
  str('}');
  return h >>> 0;
}

// Protocol + engine fingerprint. A short scripted match (fixed players, seed, moves, ends) runs through createMatch
// and applyAction; any engine/data change that alters outcomes changes the fingerprint, so a stale client is told
// to update ({t:'bye', why:'update'}) instead of desyncing. Bump PROTO when the wire format changes.
export const PROTO = 3; // 3 = 18.0 (NE): Nemesis (opts.nemesis -> s.nemesis, Vendetta / Thorn rules). 2 = 17.0 (C2): Bishop Sidestep, Sudden Death events, King/preset retune (the scripted fingerprint below does not reach them)
let _ver = null;
export function protoVer() {
  if (_ver) return _ver;
  const P = (i) => ({ pid: 'fp' + i, name: 'P' + i, isBot: i > 0, build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: 'regen', equips: {} } });
  let h = 0;
  for (const [mode, n] of [['royale', 6], ['siege', 2], ['squads', 6]]) {
    const s = createMatch(Array.from({ length: n }, (_, i) => P(i)), 4242 + n, { mode });
    for (let k = 0; k < 30 && !s.over; k++) {
      const u = unitById(s, s.active); if (!u) break;
      let a = { type: 'end' };
      if (canMove(s, u) && (k % 3) !== 2) { const ms = legalMoves(s, u); if (ms.length) { const m = ms[(k * 7 + s.turnNo) % ms.length]; a = { type: 'move', x: m.x, y: m.y }; } }
      if (!applyAction(s, u.pid, a).ok) applyAction(s, u.pid, { type: 'end' });
    }
    h = (Math.imul(h ^ stateHash(s), 16777619) >>> 0);
  }
  _ver = `p${PROTO}-${h.toString(36)}`;
  return _ver;
}

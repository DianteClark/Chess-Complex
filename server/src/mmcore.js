// 17.1 (MM): public matchmaking logic (plain JS, no Cloudflare APIs, so Node can drive it). The Matchmaker DO
// (match.js) wraps it. One global instance tracks every PUBLIC room: Quick Play rooms (created here, auto-start) and
// party rooms a leader switched to Public. Private rooms never reach it, so their codes can't leak.
//
// Entry: {code, mode, n (seats taken), h (humans), cap, st 'lobby'|'starting'|'live' (18.0 LV: + w, wcap spectators), qp, loc (region hint), created, up,
//         ip (hash of the creator / leader IP, never the IP itself), pend [timestamps of joins handed out]}
export const L = {
  pendMs: 15000,        // a Quick Play join handed out counts as a taken seat for this long (until the Room reports)
  freshMs: 30000,       // a room with no humans yet is still joinable this long after creation (its first player is on the way)
  ttl: 600000,          // no report for 10 min = stale (Rooms report every lobby change, and unregister when they start/close)
  ttlStarting: 120000,  // a countdown that never turned into a match
  roomsPerIp: 3,        // public rooms one IP may have listed at once
  quickPerMin: 20,      // Quick Play requests per IP per minute (RL_API's 240/min still applies on top)
  createsPer10: 6,      // Quick Play rooms one IP may create per 10 minutes
  listMax: 30,          // rooms in one Browse answer
  maxRooms: 2000,       // hard cap on tracked rooms (oldest dropped)
};
export const REGION_GROUP = { wnam: 'am', enam: 'am', sam: 'am', weur: 'eu', eeur: 'eu', me: 'eu', afr: 'eu', apac: 'ap', oc: 'ap' };
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(+v || 0)));
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

export class MatchCore {
  constructor(saved, o = {}) {
    this.L = { ...L, ...(o.L || {}) };
    this.rooms = new Map();
    for (const e of (saved && saved.rooms) || []) if (e && CODE_RE.test(e.code)) this.rooms.set(e.code, e);
    this.ipq = new Map(); // ip hash -> {q: [quick times], c: [create times]} (memory only: an evicted DO forgets, RL_API remains)
    this.dirty = false;
  }
  dump() { return { rooms: [...this.rooms.values()] }; }
  pending(e, now) { e.pend = (e.pend || []).filter((t) => now - t < this.L.pendMs); return e.pend.length; }
  taken(e, now) { return e.n + this.pending(e, now); }
  live(e, now) {
    const age = now - (e.up || e.created || 0);
    if (age > (e.st === 'starting' ? this.L.ttlStarting : this.L.ttl)) return false;
    if (e.h <= 0 && !this.pending(e, now) && now - (e.created || 0) > this.L.freshMs) return false; // everyone left
    return true;
  }
  prune(now) {
    let n = 0;
    for (const [k, e] of this.rooms) if (!this.live(e, now)) { this.rooms.delete(k); n++; }
    if (this.rooms.size > this.L.maxRooms) { const old = [...this.rooms.values()].sort((a, b) => a.up - b.up).slice(0, this.rooms.size - this.L.maxRooms); for (const e of old) this.rooms.delete(e.code); n += old.length; }
    if (n) this.dirty = true;
    return n;
  }
  nextAlarm(now) { return this.rooms.size ? now + 60000 : 0; }
  ipCount(ip, except) { if (!ip) return 0; let n = 0; for (const e of this.rooms.values()) if (e.ip === ip && e.code !== except && e.st !== 'live') n++; return n; } // 18.0 (LV): live listings (watch only) never use up the cap
  bucket(ip) { let b = this.ipq.get(ip); if (!b) { b = { q: [], c: [] }; this.ipq.set(ip, b); if (this.ipq.size > 5000) this.ipq.delete(this.ipq.keys().next().value); } return b; }

  // A Room reports its public state (or its removal). Returns {ok} or {ok:false, why:'cap'} for a NEW listing over the
  // per-IP cap (the Room then switches itself back to Private and tells its leader).
  reg(b, now) {
    const code = str(b && b.code, 5); if (!code || !CODE_RE.test(code)) return { ok: false, why: 'bad' };
    const old = this.rooms.get(code);
    const ip = str(b.ip, 32) || (old && old.ip) || null;
    if (!old && ip && b.st !== 'live' && this.ipCount(ip, code) >= this.L.roomsPerIp) return { ok: false, why: 'cap' };
    const e = {
      code, mode: str(b.mode, 16) || 'royale', n: int(b.n, 0, 16), h: int(b.h, 0, 16), cap: int(b.cap, 1, 16),
      st: b.st === 'starting' ? 'starting' : b.st === 'live' ? 'live' : 'lobby', qp: !!b.qp, loc: str(b.loc, 8), created: +b.created || (old && old.created) || now, up: now, ip,
      pend: old ? old.pend || [] : [],
    };
    if (e.st === 'live') { e.w = int(b.w, 0, 64); e.wcap = int(b.wcap, 0, 64); e.pend = []; } // 18.0 (LV): a live public match (Watch in Browse)
    // seats the Room now reports were (some of) the joins handed out: stop counting those twice
    if (old && e.n > old.n && e.pend.length) e.pend.splice(0, Math.min(e.pend.length, e.n - old.n));
    this.rooms.set(code, e); this.dirty = true;
    return { ok: true };
  }
  unreg(code) { if (this.rooms.delete(code)) this.dirty = true; return { ok: true }; }

  score(e, loc) {
    if (!loc || !e.loc) return 0;
    if (e.loc === loc) return 2;
    return REGION_GROUP[e.loc] && REGION_GROUP[e.loc] === REGION_GROUP[loc] ? 1 : 0;
  }
  // best open Quick Play lobby for this mode: nearest region first, then the fullest (fill toward capacity), then oldest
  pick(mode, loc, exclude, now) {
    let best = null, bk = null;
    for (const e of this.rooms.values()) {
      if (!e.qp || e.st === 'live' || e.mode !== mode || (exclude && exclude.includes(e.code)) || !this.live(e, now)) continue; // 18.0 (LV): never a live match
      const t = this.taken(e, now); if (t >= e.cap) continue;
      const k = [this.score(e, loc), t, -(e.created || 0)];
      if (!bk || k[0] > bk[0] || (k[0] === bk[0] && (k[1] > bk[1] || (k[1] === bk[1] && k[2] > bk[2])))) { best = e; bk = k; }
    }
    return best;
  }
  // Quick Play: {code} of a lobby to join, or {create:true} when a new room should be made (the caller makes it,
  // then calls placed()), or {error, retry} when this IP is over its limits.
  quick(b, now) {
    const ip = str(b.ip, 32) || 'anon', mode = str(b.mode, 16) || 'royale', loc = str(b.loc, 8);
    const exclude = Array.isArray(b.exclude) ? b.exclude.filter((x) => typeof x === 'string').slice(0, 8) : [];
    const k = this.bucket(ip);
    k.q = k.q.filter((t) => now - t < 60000);
    if (k.q.length >= this.L.quickPerMin) return { error: 'slow', retry: Math.ceil((60000 - (now - k.q[0])) / 1000) };
    k.q.push(now);
    const e = this.pick(mode, loc, exclude, now);
    if (e) { e.pend.push(now); this.dirty = true; return { code: e.code, created: false, n: e.n, cap: e.cap }; }
    k.c = k.c.filter((t) => now - t < 600000);
    if (k.c.length >= this.L.createsPer10) return { error: 'slow', retry: Math.ceil((600000 - (now - k.c[0])) / 1000) };
    if (this.ipCount(ip) >= this.L.roomsPerIp) return { error: 'cap' };
    return { create: true };
  }
  // a Quick Play room was just made for this caller: list it at once (with the caller's seat pending), so a second
  // Quick Play a moment later lands in the same room instead of making another
  placed(b, code, cap, now) {
    const ip = str(b.ip, 32) || 'anon';
    this.bucket(ip).c.push(now);
    this.rooms.set(code, { code, mode: str(b.mode, 16) || 'royale', n: 0, h: 0, cap, st: 'lobby', qp: true, loc: str(b.loc, 8), created: now, up: now, ip, pend: [now] });
    this.dirty = true;
  }
  // Browse: public lobbies with a free seat (both Quick Play and leader-hosted public parties), then (18.0 LV) live public
  // matches with a free spectator slot (st 'live', w / wcap). No IPs, no names.
  list(mode, loc, now) {
    const out = [];
    for (const e of this.rooms.values()) {
      if ((mode && e.mode !== mode) || !this.live(e, now)) continue;
      if (e.st === 'live') { if (e.h > 0 && (e.w || 0) < (e.wcap || 8)) out.push({ code: e.code, mode: e.mode, n: e.n, h: e.h, cap: e.cap, st: 'live', qp: e.qp, loc: e.loc || null, age: Math.round((now - (e.created || now)) / 1000), near: this.score(e, loc), w: e.w || 0, wcap: e.wcap || 8 }); continue; } // 18.0 (LV): Watch
      const t = this.taken(e, now); if (t >= e.cap || (e.h <= 0 && !this.pending(e, now))) continue;
      out.push({ code: e.code, mode: e.mode, n: Math.min(e.cap, t), h: e.h, cap: e.cap, st: e.st, qp: e.qp, loc: e.loc || null, age: Math.round((now - (e.created || now)) / 1000), near: this.score(e, loc) });
    }
    out.sort((a, b) => (a.st === 'live') - (b.st === 'live') || b.near - a.near || (b.st === 'starting') - (a.st === 'starting') || b.n - a.n || a.age - b.age);
    return out.slice(0, this.L.listMax);
  }
}

// R 10.3: camera turn director. Each turn plays as a beat: the camera glides (eased Hermite curve that carries the
// current velocity, distance-scaled duration, capped screen speed) to frame the acting piece and everything its action
// touches, holds while that turn's events play, then moves on to the next actor. The renderer queues every turn's
// events on its timeline (render.js setState) and gives each new actor a lead-in so the glide lands before the action
// starts; this module only decides where the camera goes, when it may move, and how fast the timeline should play.
//
// Rules: a finger on the board freezes the camera (input calls hold/release), a manual pan or pinch is respected until
// the player's next turn or a recentre tap, the Camera setting picks 'all' (follow every turn), 'mine' (only my turns;
// spectators still follow everyone) or 'free' (never moves on its own), and reduced motion swaps long glides for a quick
// fade. Holds and glides shrink and the timeline speeds up (pace) when the backlog of queued turns grows.
import { unitById } from './engine.js';

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export class CamDirector {
  constructor(r) {
    this.r = r; this.clock = 0; this.speed = 1; this.mode = 'all';
    this.stats = { glides: 0, skipped: 0, held: 0, fades: 0, compress: 0, flush: 0 };
    this.reset();
  }
  reset() {
    this.g = null; this.user = false; this.userAt = -9; this.finger = false; this.pend = null; this.relAt = -9; this.watch = null;
    this.actor = null; this.box = null; this.fade = null; this.fadeA = 0; this.shotBack = null; this.myTurnAt = -1; this.speed = 1;
  }
  // ------------------------------------------------------------------ policy
  spectating() { const r = this.r, me = r.myId != null && r.state ? unitById(r.state, r.myId) : null; return !me || !me.alive; }
  // Is this actor's turn worth a camera beat? Players and bosses yes; Hollows only when they hit the viewer.
  worth(id) { const u = id != null && this.r.state ? unitById(this.r.state, id) : null; return !u || u.kind === 'player' || !!u.boss; }
  allowed(actor, kind) {
    if (kind === 'final') return true; // the match's last moment always gets its shot
    if (this.user || this.mode === 'free') return false;
    if (this.watch != null) return actor === this.watch;
    if (this.mode === 'mine' && !this.spectating()) return actor != null && actor === this.r.myId;
    return true;
  }
  // ------------------------------------------------------------------ geometry
  view() { const r = this.r; return { w: r.VW || r.W, h: r.VH || r.H }; }
  tgt() { const c = this.r.cam, g = this.g; return g ? { x: g.x1, y: g.y1, z: g.z1 } : { x: c.tx, y: c.ty, z: c.tz }; }
  clampXY(x, y, z) {
    const r = this.r, B = r.bounds || { x0: 0, y0: 0, x1: 15, y1: 15 }, { w, h } = this.view();
    const cl = (v, span, lo, hi) => { const hw = span / z / 2, len = hi - lo + 1; return len + 1 <= hw * 2 ? lo + len / 2 : Math.max(lo + hw - 0.5, Math.min(hi + 1.5 - hw, v)); };
    return [cl(x, w, B.x0, B.x1), cl(y, h, B.y0, B.y1)];
  }
  // Where the camera should be to show `box` (tile coords, inclusive): keep the current zoom when the box fits at it,
  // and move only as far as needed to bring the box inside the view with margin m (so small actions cost no motion).
  plan(box, o = {}) {
    const r = this.r, { w, h } = this.view(), m = o.m ?? 1.3, close = r.defaultZoom();
    const bx0 = box.x0 - m, bx1 = box.x1 + 1 + m, by0 = box.y0 - m, by1 = box.y1 + 1 + m, bw = bx1 - bx0, bh = by1 - by0;
    // R 15.0: never zoom out past the current level's floor (8x8 level: at most 0.8x; board level: the whole board)
    const lo = r.zoomFloor ? r.zoomFloor() : r.fitZoom;
    const zd = clampN(Math.min(close, w / bw, h / bh), lo, r.maxZ);
    const cur = o.cur || this.tgt();
    let z = cur.z >= zd * 0.8 && cur.z <= zd * 1.25 && cur.z >= lo * 0.98 && w / cur.z >= bw && h / cur.z >= bh ? cur.z : zd;
    if (o.push) z = Math.min(r.maxZ, z * o.push);
    const hw = w / z / 2, hh = h / z / 2;
    let cx = bw >= hw * 2 ? (bx0 + bx1) / 2 : clampN(cur.x, bx1 - hw, bx0 + hw);
    let cy = bh >= hh * 2 ? (by0 + by1) / 2 : clampN(cur.y, by1 - hh, by0 + hh);
    // a box wider than the view at this level: keep the actor at least a tile inside the frame
    const k = o.keep; if (k) { if (bw >= hw * 2) cx = clampN(cx, k.x + 1.5 - hw, k.x - 0.5 + hw); if (bh >= hh * 2) cy = clampN(cy, k.y + 1.5 - hh, k.y - 0.5 + hh); }
    return { x: cx, y: cy, z };
  }
  // ------------------------------------------------------------------ motion
  maxPx() { const { w, h } = this.view(); return 1.5 * Math.min(w, h) + 150; } // peak pan speed, screen px per real second
  durFor(x, y, z, from) {
    const c = from || this.r.cam, dist = Math.hypot(x - c.x, y - c.y), dz = Math.abs(Math.log(z / (c.z || z)));
    if (dist < 0.08 && dz < 0.02) return 0;
    if (this.r.reduced && dist > 4.5) return 0.3; // fade cut
    let d = clampN(0.32 + 0.065 * dist + 0.45 * dz, 0.3, 1.0);
    if (this.r.reduced) d = Math.min(d, 0.3);
    return Math.max(d, this.cap(x, y, z, c)); // director clock seconds
  }
  // shortest allowed glide: peak pan speed under maxPx() and peak zoom rate under 2.4/s, in real time at the current pace
  cap(x, y, z, from) { const c = from || this.r.cam; return Math.max(1.5 * Math.hypot(x - c.x, y - c.y) * Math.max(z, c.z || z) / this.maxPx(), (1.5 * Math.abs(Math.log(z / (c.z || z)))) / 2.4) * this.speed; }
  // Start a glide. x/y/z null keep the current target. Returns the expected duration in timeline seconds (0 = no move).
  glide(x, y, z, o = {}) {
    const r = this.r, c = r.cam, T = this.tgt();
    if (!o.force && !this.allowed(o.actor, o.kind)) { this.stats.skipped++; return 0; }
    if (r.intro && r.intro.fly && r.intro.t < 1.7) return 0;
    z = clampN(z ?? T.z, r.minZ || 1, r.maxZ || 999);
    [x, y] = this.clampXY(x ?? T.x, y ?? T.y, z);
    if (this.finger && !o.force) { this.pend = { x, y, z, o }; this.stats.held++; return 0; }
    if (this.g && Math.hypot(x - this.g.x1, y - this.g.y1) < 0.08 && Math.abs(Math.log(z / this.g.z1)) < 0.02) return Math.max(0, this.g.t0 + this.g.dur - this.clock) / this.speed;
    let dur = this.durFor(x, y, z);
    if (!dur) { if (!this.g) { c.tx = x; c.ty = y; c.tz = z; } return 0; }
    if (o.quick) dur = Math.max(dur * o.quick, this.cap(x, y, z));
    c.tx = x; c.ty = y; c.tz = z; this.stats.glides++;
    if (r.reduced && Math.hypot(x - c.x, y - c.y) > 4.5) { this.g = null; this.fade = { t: 0, x, y, z, cut: false }; this.stats.fades++; return 0.3 / this.speed; }
    // carry the current speed into the new curve along the new direction only, capped so the curve never overshoots
    // (a sideways or backwards component would curl the path into a visible back-and-forth)
    const dx = x - c.x, dy = y - c.y, l = Math.hypot(dx, dy), along = this.g && l > 0.01 ? clampN(((c.vx || 0) * dx + (c.vy || 0) * dy) / l, 0, (2 * l) / dur) : 0;
    const vx = l > 0.01 ? (dx / l) * along : 0, vy = l > 0.01 ? (dy / l) * along : 0, dzz = z - c.z;
    const vz = this.g && (c.vz || 0) * dzz > 0 ? clampN(c.vz, -Math.abs(2 * dzz / dur), Math.abs(2 * dzz / dur)) : 0;
    this.g = { t0: this.clock, dur, x0: c.x, y0: c.y, z0: c.z, vx, vy, vz, x1: x, y1: y, z1: z, beat: !!o.beat };
    return dur / this.speed;
  }
  // Remaining time (timeline seconds) of the current glide (capped at 1 s), so the next events wait for the camera to land.
  busy() { const g = this.g; return g ? Math.min(1, Math.max(0, g.t0 + g.dur - this.clock) / this.speed) : this.fade ? 0.3 / this.speed : 0; }
  // ------------------------------------------------------------------ beats
  // A new actor's turn: frame the piece (near the middle of the view, close zoom).
  turn(id) {
    const r = this.r, d = r.disp.get(id); this.actor = id; this.box = null; this.shotBack = null;
    if (id === r.myId) { this.user = false; this.myTurnAt = -1; this.pend = null; }
    else if (this.user && this.spectating() && r.real - this.userAt > 6) this.user = false; // spectators have no 'next turn': a pan holds ~6 s, then the next beat takes over
    if (!d || !this.worth(id) && id !== this.watch) return 0;
    const p = this.plan({ x0: d.tx, y0: d.ty, x1: d.tx, y1: d.ty }, { m: 2.3 });
    const close = r.defaultZoom(), z = p.z >= close * 0.8 && p.z <= close * 1.25 ? p.z : close;
    return this.glide(p.x, p.y, z, { actor: id, kind: 'turn', beat: true });
  }
  // Estimated lead-in for the next actor (timeline seconds) without moving anything.
  lead(id) {
    const r = this.r, d = r.disp.get(id); if (!d || !this.allowed(id, 'turn') || (!this.worth(id) && id !== this.watch)) return 0;
    const u = r.state && unitById(r.state, id), x = u ? u.x : d.tx, y = u ? u.y : d.ty;
    const p = this.plan({ x0: x, y0: y, x1: x, y1: y }, { m: 2.3 }), T = this.tgt();
    return this.durFor(p.x, p.y, p.z, { x: T.x, y: T.y, z: T.z }) / Math.max(1, this.speed);
  }
  // Lead-in (timeline seconds) for an action whose box will not fit the framing the camera is about to have, so the camera
  // starts moving a moment before the piece does instead of chasing it. Estimated without moving anything.
  actLead(box, actor) {
    const r = this.r; if (!this.allowed(actor, 'act') || (!this.worth(actor) && actor !== this.watch)) return 0;
    let cur, b = box;
    if (this.actor === actor) { cur = this.tgt(); if (this.box) b = { x0: Math.min(this.box.x0, box.x0), y0: Math.min(this.box.y0, box.y0), x1: Math.max(this.box.x1, box.x1), y1: Math.max(this.box.y1, box.y1) }; }
    else { const d = r.disp.get(actor); if (!d) return 0; const z = r.defaultZoom(), [x, y] = this.clampXY(d.tx + 0.5, d.ty + 0.5, z); cur = { x, y, z }; }
    const p = this.plan(b, { cur });
    return this.durFor(p.x, p.y, p.z, cur) / Math.max(1, this.speed);
  }
  // An action of the current turn: widen the turn's box with it and keep the whole thing in view.
  act(box, actor, o = {}) {
    if (actor !== this.actor) { this.actor = actor; this.box = null; }
    if (actor != null && !this.worth(actor) && actor !== this.watch && !o.hitsMe) return 0;
    const b = this.box ? { x0: Math.min(this.box.x0, box.x0), y0: Math.min(this.box.y0, box.y0), x1: Math.max(this.box.x1, box.x1), y1: Math.max(this.box.y1, box.y1) } : { ...box };
    this.box = b;
    // a push-in zooms about the un-pushed framing's centre, so the zoom back at impact is a pure zoom (no sideways whip)
    const ad = actor != null ? this.r.disp.get(actor) : null;
    const p = this.plan(b, ad ? { keep: { x: ad.tx, y: ad.ty } } : {}), z = o.push && !this.r.reduced ? Math.min(this.r.maxZ, p.z * o.push) : p.z;
    return this.glide(p.x, p.y, z, { actor, kind: o.hitsMe ? 'mine' : 'act', beat: true, quick: o.quick });
  }
  // A short look at one tile (soul, boss arrival) that keeps the current turn's framing logic.
  look(x, y, o = {}) { const p = this.plan({ x0: Math.floor(x), y0: Math.floor(y), x1: Math.floor(x), y1: Math.floor(y) }, { m: 1.6 }); return this.glide(p.x, p.y, p.z, { actor: o.actor ?? this.actor, kind: o.kind || 'event' }); }
  // Cinematic push-in on a moment, then a pure zoom back (same centre, so no whip).
  shot(x, y, zMul, dur, o = {}) {
    const r = this.r, back = this.tgt().z;
    const t = this.glide(x, y, Math.min(r.maxZ, r.defaultZoom() * zMul), { actor: o.actor ?? this.actor, kind: o.kind || 'shot' });
    if (t || (this.g && o.kind !== 'final')) this.shotBack = o.kind === 'final' ? null : { at: this.clock + dur * this.speed, z: back, actor: o.actor ?? this.actor };
    return t;
  }
  // ------------------------------------------------------------------ input
  hold() { const c = this.r.cam; this.finger = true; if (this.g) { if (!this.mine()) this.pend = { x: this.g.x1, y: this.g.y1, z: this.g.z1, o: { actor: this.actor, kind: 'act' } }; this.g = null; } this.shotBack = null; this.fade = null; this.fadeA = 0; c.tx = c.x; c.ty = c.y; c.tz = c.z; c.vx = c.vy = c.vz = 0; }
  release() { if (!this.finger) return; this.finger = false; this.relAt = this.r.real; if (this.mine()) this.pend = null; }
  manual() { this.user = true; this.userAt = this.r.real; this.g = null; this.pend = null; this.shotBack = null; } // pan / pinch / wheel
  mine() { const r = this.r; return !!(r.state && r.myId != null && r.state.active === r.myId && !r.state.over); }
  // ------------------------------------------------------------------ per frame
  // Timeline pace from the backlog of queued visuals: 1x normally, up to ~2.6x when bot turns pile up, faster still when
  // the viewer's own turn is waiting behind them; at most 1.8x while an ultimate cine is on screen (unless my turn waits).
  pace(back, realDt) {
    const mine = this.myTurnAt > this.r.time;
    let k = back < 0.8 ? 1 : Math.min(2.8, 1 + (back - 0.8) * 0.6);
    if (this.r.cine && !mine) k = Math.min(k, 1.8); // the cine runs at the same pace, so it stays in step either way
    if (mine) k = Math.max(k, Math.min(3.5, 1 + back * 1.2));
    this.speed += (k - this.speed) * Math.min(1, realDt * 4);
    if (Math.abs(this.speed - k) < 0.01) this.speed = k;
    return this.speed;
  }
  // Drives the camera; returns true when a glide set the position this frame (the renderer's spring then stays out).
  update(realDt, flying) {
    const r = this.r, c = r.cam;
    this.clock += realDt * this.speed;
    if (flying) { this.g = null; return false; }
    if (this.fade) {
      const f = this.fade; f.t += realDt;
      if (!f.cut && f.t >= 0.12) { f.cut = true; c.x = c.tx = f.x; c.y = c.ty = f.y; c.z = c.tz = f.z; c.vx = c.vy = c.vz = 0; }
      this.fadeA = f.t < 0.12 ? f.t / 0.12 : Math.max(0, 1 - (f.t - 0.12) / 0.16);
      if (f.t >= 0.28) { this.fade = null; this.fadeA = 0; }
      return true;
    }
    if (this.pend && !this.finger && r.real - this.relAt > 0.35) { const p = this.pend; this.pend = null; this.glide(p.x, p.y, p.z, p.o); }
    if (this.shotBack && this.clock >= this.shotBack.at && !this.finger) { const b = this.shotBack; this.shotBack = null; if (!this.user) this.glide(null, null, b.z, { force: true }); }
    const g = this.g; if (!g) return false;
    const D = g.dur, s = Math.min(1, (this.clock - g.t0) / D), s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1;
    c.x = h00 * g.x0 + h10 * D * g.vx + h01 * g.x1; c.vx = (d00 * g.x0 + d10 * D * g.vx - d00 * g.x1) / D;
    c.y = h00 * g.y0 + h10 * D * g.vy + h01 * g.y1; c.vy = (d00 * g.y0 + d10 * D * g.vy - d00 * g.y1) / D;
    c.z = h00 * g.z0 + h10 * D * g.vz + h01 * g.z1; c.vz = (d00 * g.z0 + d10 * D * g.vz - d00 * g.z1) / D;
    if (s >= 1) { this.g = null; c.x = c.tx = g.x1; c.y = c.ty = g.y1; c.z = c.tz = g.z1; c.vx = c.vy = c.vz = 0; }
    return true;
  }
}

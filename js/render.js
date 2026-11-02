// Board renderer: themed tiles, pieces, telegraphs, sequenced combat VFX, camera juice.
import { SIZE, BOARDS, ABILITIES, TRAILS } from './data.js';
import { drawPiece, skinOf, PIECE_TOP, pieceKind, isAnimatedSkin } from './pieces.js';
import { hiSprite } from './fx.js';
import { ringOf, stats, unitById, previewDamage } from './engine.js';
import { FX } from './fx.js';
import * as W10 from './world.js'; // A5 10.0: materials, lighting, void, weather, overlays
import { CamDirector } from './camdir.js'; // R 10.3: turn-by-turn camera beats
import * as HZ from './hazards10.js'; // A9 10.0: fallback visuals for new hazard tiles / unit states

const ease = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const lerp = (a, b, t) => a + (b - a) * t;
const byY = (a, b) => a.y - b.y;
const FPAD = 0.7; // static floor cache covers [-FPAD, SIZE+FPAD] in world units
const MELEE = new Set(['pawnStrike', 'hollowClaw', 'royalStrike', 'pickpocket', 'shove', 'execute', 'tstrike', 'stagger', 'slam', 'lance']);
const IMPACT = { pawnStrike: 0.12, hollowClaw: 0.12, royalStrike: 0.14, pickpocket: 0.12, shove: 0.12, execute: 0.16, tstrike: 0.12, stagger: 0.12, slam: 0.12, ray: 0.08, siege: 0.25, cross: 0.1, checkmate: 0.1, starburst: 0.1, dominion: 0.1, trample: 0.1, charge: 0.04, decree: 0.04, tripwire: 0.05, lance: 0.1, penance: 0.24, quake: 0.12, gambit: 0.1, colossusSlam: 0.3, phalanx: 0.1, outflank: 0.12, consecrate: 0.2, repel: 0.08, bombard: 0.3, gravity: 0.3, hexBolt: 0.2, soulLance: 0.14, wraithStep: 0.05 };
// cached soft-glow and badge sprites (avoid per-frame gradients / tiny-font text)
const GLOW = new Map();
export function glowSprite(color) {
  let c = GLOW.get(color); if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, 64, 64);
  GLOW.set(color, c); return c;
}
const BADGE = new Map();
try { document.fonts && document.fonts.addEventListener('loadingdone', () => BADGE.clear()); } catch {}
function badgeSprite(text, col) {
  const key = text + '|' + col; let c = BADGE.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 52; const x = c.getContext('2d');
  x.fillStyle = '#0d0b13'; x.beginPath(); x.arc(26, 26, 24, 0, Math.PI * 2); x.fill();
  x.strokeStyle = col; x.lineWidth = 3; x.stroke();
  x.fillStyle = col === '#5fd8ff' ? '#9df3ff' : col; x.font = `700 ${text.length > 2 ? 20 : 27}px "Chakra Petch", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 26, 28);
  if (BADGE.size > 300) BADGE.clear();
  BADGE.set(key, c); return c;
}
// B3 10.1: the big glowing titles (ultimate cine name, screen banners) are rendered once into a sprite: outlined text
// with shadowBlur, redrawn every frame, was the costliest thing on screen during those moments. Same drawing calls,
// at the canvas's device resolution; shadowBlur is in device pixels either way.
const GLOWTXT = new Map();
try { document.fonts && document.fonts.addEventListener('loadingdone', () => GLOWTXT.clear()); } catch {}
function glowText(text, font, px, lw, stroke, fill, glow, blur, sheen, dpr) {
  const key = text + '|' + font + '|' + lw + '|' + stroke + '|' + fill + '|' + glow + '|' + blur + '|' + sheen + '|' + dpr;
  let e = GLOWTXT.get(key); if (e) return e;
  const m = (glowText.m ||= document.createElement('canvas').getContext('2d')); m.font = font;
  const pad = Math.ceil(lw + blur / dpr * 1.5 + 4), w = Math.ceil(m.measureText(text).width + pad * 2), h = Math.ceil(px * 1.4 + pad * 2);
  const c = document.createElement('canvas'); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
  const x = c.getContext('2d'); x.scale(dpr, dpr); x.translate(w / 2, h / 2); x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = lw; x.lineJoin = 'round'; x.strokeStyle = stroke; x.strokeText(text, 0, 0);
  if (fill === 'gold') { const g = x.createLinearGradient(0, -px / 2, 0, px / 2); g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#ffe9a8'); g.addColorStop(1, '#d6a33a'); x.fillStyle = g; } else x.fillStyle = fill;
  if (blur) { x.shadowColor = glow; x.shadowBlur = blur; }
  x.fillText(text, 0, 0); x.shadowBlur = 0;
  if (sheen) { x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillText(text, 0, -px * 0.03); }
  if (GLOWTXT.size > 12) GLOWTXT.clear();
  e = { c, w, h }; GLOWTXT.set(key, e); return e;
}
// 5.0: paired portal colours, tile art cache
export const PORTAL_COLS = ['#3de0ff', '#ff5ad8'];
const TEX = new Map();
function tileTex(kind, v) {
  const key = kind + v; let c = TEX.get(key); if (c) return c;
  const N = 64; c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  let seed = v * 9301 + (kind === 'lava' ? 49297 : 233280); const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  if (kind === 'lava') {
    const g = x.createRadialGradient(N * 0.5, N * 0.5, 4, N * 0.5, N * 0.5, N * 0.75); g.addColorStop(0, '#ffb23d'); g.addColorStop(0.5, '#f0561a'); g.addColorStop(1, '#8a1a08');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    // cooling crust plates
    for (let i = 0; i < 5; i++) {
      const cx = r() * N, cy = r() * N, rr = 7 + r() * 9; x.fillStyle = 'rgba(40,10,6,0.82)';
      x.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, q = rr * (0.7 + r() * 0.5); x[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * q, cy + Math.sin(a) * q); } x.closePath(); x.fill();
      x.strokeStyle = 'rgba(255,170,60,0.55)'; x.lineWidth = 1.2; x.stroke();
    }
    x.strokeStyle = 'rgba(255,240,170,0.6)'; x.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) { x.beginPath(); let px = r() * N, py = r() * N; x.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (r() - 0.5) * 22; py += (r() - 0.5) * 22; x.lineTo(px, py); } x.stroke(); }
  } else if (kind === 'ice') {
    const g = x.createLinearGradient(0, 0, N, N); g.addColorStop(0, '#d8f6ff'); g.addColorStop(0.45, '#9fd8f0'); g.addColorStop(1, '#5ea6cf');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    x.fillStyle = 'rgba(255,255,255,0.28)'; x.beginPath(); x.moveTo(0, N * 0.35); x.lineTo(N * 0.35, 0); x.lineTo(N * 0.55, 0); x.lineTo(0, N * 0.55); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineWidth = 1;
    for (let i = 0; i < 3; i++) { let px = r() * N, py = r() * N; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 3; k++) { px += (r() - 0.5) * 30; py += (r() - 0.5) * 30; x.lineTo(px, py); } x.stroke(); }
    x.strokeStyle = 'rgba(40,90,130,0.35)'; x.lineWidth = 1;
    for (let i = 0; i < 2; i++) { let px = r() * N, py = r() * N; x.beginPath(); x.moveTo(px, py); px += (r() - 0.5) * 26; py += (r() - 0.5) * 26; x.lineTo(px, py); x.stroke(); }
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 2; x.strokeRect(1, 1, N - 2, N - 2);
  }
  TEX.set(key, c); return c;
}

export class Renderer {
  constructor(canvas, hooks = {}) {
    this.c = canvas; this.x = canvas.getContext('2d');
    this.hooks = hooks;
    this.cam = { x: SIZE / 2, y: SIZE / 2, z: 40, tx: SIZE / 2, ty: SIZE / 2, tz: 40 };
    this.fx = new FX(); this.cd = new CamDirector(this); this.beats = [];
    this.disp = new Map(); this.floats = []; this.bubbles = [];
    this.shake = 0; this.time = 0; this.real = 0; this.state = null; this.overlay = null; this.myId = null;
    this.hitFlash = new Map(); this.follow = true; this.hs = 0; this.slow = null; this.punch = 0;
    this.theme = BOARDS.hall; this.shakeOn = true; this.timers = [];
    this.motes = Array.from({ length: 46 }, () => ({ x: Math.random() * SIZE, y: Math.random() * SIZE, v: 0.05 + Math.random() * 0.15, p: Math.random() * 6, s: 0.015 + Math.random() * 0.03 }));
    this.intro = null; this.bounds = null; this.marks = [];
    this.lights = []; this.weather = new W10.Weather(); this.themeId = 'hall'; this.look = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  setQuality(q) { this.quality = q || 'auto'; this.lowQ = q === 'low'; this.ftAvg = 16; this.ftT = 0; this.aq = { tier: this.lowQ ? 2 : 0, t: 0, warm: 1, hold: 6, upAt: -1e9 }; this.resize(); }
  // B3 10.1: adaptive quality for 'auto'. Tiers: 0 full (DPR up to 2), 1 DPR 1.5 with every effect, 2 lowQ (DPR 1, cheap
  // effects). Steps down after ~1.2 s averaging over 22 ms a frame (under ~45 fps); steps back up after a calm spell near
  // the display rate. A step-up that fails within 5 s doubles the wait before the next try (6 s up to 48 s), so it settles.
  autoQuality(realDt) {
    const q = this.aq || (this.aq = { tier: 0, t: 0, warm: 1, hold: 6, upAt: -1e9 });
    this.ftAvg = (this.ftAvg || 16) * 0.92 + realDt * 1000 * 0.08;
    if (q.warm > 0) { q.warm -= realDt; q.t = 0; return; } // just resized / rebaked: ignore the first second
    const full = Math.min(2, devicePixelRatio || 1), tiers = full > 1.5 ? [0, 1, 2] : [0, 2], i = Math.max(0, tiers.indexOf(q.tier));
    let next = q.tier;
    if (this.ftAvg > 22) { q.t = q.t > 0 ? q.t + realDt : realDt; if (q.t > 1.2 && i < tiers.length - 1) next = tiers[i + 1]; }
    else if (this.ftAvg < 17.8 && i > 0) { q.t = q.t < 0 ? q.t - realDt : -realDt; if (-q.t > q.hold) next = tiers[i - 1]; }
    else q.t = 0;
    if (next === q.tier) return;
    if (next > q.tier && this.real - q.upAt < 5) q.hold = Math.min(48, q.hold * 2); // the last step up did not hold
    if (next < q.tier) q.upAt = this.real;
    q.tier = next; q.t = 0; q.warm = 1; this.ftAvg = 16.7;
    this.lowQ = next === 2; this.resize();
  }
  setTheme(id) { this.themeId = BOARDS[id] ? id : 'hall'; this.theme = BOARDS[this.themeId]; this.look = null; this.wallSpr = null; this.weather = new W10.Weather(); this.fcache = null; }
  lookOf() { if (!this.look || this.look.th !== this.theme) { this.look = W10.lookOf(this.themeId, this.theme); this.look.th = this.theme; } return this.look; }
  light(x, y, col, rad, life, a) { W10.addLight(this, x, y, col, rad, life, a); }
  // cinematic framing: briefly push the camera in on a big moment, then hand control back
  // R 10.3: shots go through the camera director (respects the Camera setting, a finger on the board and a manual pan)
  shot(x, y, zMul = 1.2, dur = 1, kind = 'shot', actor) { if (this.reduced) return; this.cd.shot(x + 0.5, y + 0.5, zMul, dur, { kind, actor }); }
  // R 10.3: 'follow' is the director's view of a manual override (false after a pan/pinch until my turn or a recentre)
  get follow() { return !this.cd.user; }
  set follow(v) { this.cd.user = !v; if (v) { this.cd.watch = null; this.cd.specSet = false; } }
  resize() {
    const full = Math.min(2, devicePixelRatio || 1), dpr = this.lowQ ? 1 : this.quality === 'auto' && this.aq && this.aq.tier === 1 ? Math.min(full, 1.5) : full;
    if (this.aq) this.aq.warm = Math.max(this.aq.warm, 0.6);
    // U 10.2: layout size, not getBoundingClientRect: a resize during a screen transition (scale .94-.99) used to bake the
    // shrunken size in, so the bitmap was stretched and taps landed up to a tile off until the next resize
    const r = this.c.clientWidth ? { width: this.c.clientWidth, height: this.c.clientHeight } : this.c.getBoundingClientRect();
    this.W = r.width || innerWidth; this.H = r.height || innerHeight; this.dpr = dpr;
    this.c.width = Math.round(this.W * dpr); this.c.height = Math.round(this.H * dpr);
    this.pad = this.pad || { t: 0, b: 0, r: 0 };
    this.VH = Math.max(120, this.H - this.pad.t - this.pad.b); this.CY = this.pad.t + this.VH / 2;
    this.VW = Math.max(160, this.W - (this.pad.r || 0)); this.CX = this.VW / 2;
    const bw = this.bounds ? this.bounds.x1 - this.bounds.x0 + 1 : SIZE, bh = this.bounds ? this.bounds.y1 - this.bounds.y0 + 1 : SIZE;
    this.fitZoom = Math.min(this.VW / (bw + 1.2), this.VH / (bh + 1.2));
    this.minZ = this.fitZoom * 0.9; this.maxZ = Math.max(this.fitZoom * 3, 70);
    if (!this.zoomSet) { this.cam.z = this.cam.tz = this.defaultZoom(); }
  }
  setPad(t, b, r = 0) { this.pad = { t, b, r }; this.resize(); }
  defaultZoom() { return this.bounds ? this.fitZoom : Math.max(this.fitZoom, Math.min(this.VW || this.W, this.VH) / 10.5); }
  setBounds(b) { this.bounds = b; this.zoomSet = false; this.resize(); if (b) { this.cam.x = this.cam.tx = (b.x0 + b.x1 + 1) / 2; this.cam.y = this.cam.ty = (b.y0 + b.y1 + 1) / 2; } }
  get z() { return this.cam.z * (1 + this.punch); }
  toScreen(wx, wy) { return [(wx - this.cam.x) * this.z + (this.CX ?? this.W / 2), (wy - this.cam.y) * this.z + this.CY]; }
  toWorld(sx, sy, v) { if (v) return [(sx - v.cx) / v.z + v.x, (sy - v.cy) / v.z + v.y]; return [(sx - (this.CX ?? this.W / 2)) / this.z + this.cam.x, (sy - this.CY) / this.z + this.cam.y]; }
  // U 10.2: the screen->world mapping as drawn right now (punch zoom included; shake is a zero-mean jitter and left out).
  // Input freezes one of these at touch-down so a tap maps to the tile the player saw, even while the camera moves.
  view() { return { cx: this.CX ?? this.W / 2, cy: this.CY, z: this.z, x: this.cam.x, y: this.cam.y }; }
  // U 10.2: a finger on the board stops any camera glide (follow, focus, cinematic shot) where it is, like touching a
  // flung map, so the board holds still under a tap and its confirm. Not during the intro fly-over.
  hold() {
    if (this.intro && this.intro.fly && this.intro.t < 1.7) return;
    this.cd.hold(); // R 10.3: frozen until release(); an interrupted spectator glide resumes shortly after the finger lifts
  }
  release() { this.cd.release(); }
  tileAtScreen(sx, sy) { const [wx, wy] = this.toWorld(sx, sy); const x = Math.floor(wx), y = Math.floor(wy); return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null; }
  // R 10.3: an explicit look (callers outside the turn director): eased glide, never a snap
  focus(x, y) { this.cd.glide(x + 0.5, y + 0.5, null, { force: true }); }
  // the recentre tap: hand the camera back to the director and glide to the piece
  recentre(x, y) { this.cd.user = false; this.cd.watch = null; this.cd.glide(x + 0.5, y + 0.5, this.defaultZoom(), { force: true }); }
  // spectator target: null follows every turn, an id follows that piece's turns (idempotent: called on every update)
  spectate(id) { const cd = this.cd; if (cd.specSet && cd.watch === id) return; cd.specSet = true; cd.watch = id; cd.user = false; const d = this.disp.get(id ?? (this.state && this.state.active)); if (d) cd.glide(d.tx + 0.5, d.ty + 0.5, null, { force: true }); }
  setCamMode(m) { this.cd.mode = m === 'mine' || m === 'free' ? m : 'all'; }
  // real ms until the visuals of the latest state start playing (callouts wait this long so they land with the action)
  leadMs() { return Math.max(0, ((this.lastBase ?? this.time) - this.time) / (this.cd.speed || 1)) * 1000; }
  zoomBy(f, sx = this.CX ?? this.W / 2, sy = this.CY) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.z = this.cam.tz = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z * f));
    this.zoomSet = true; this.cam.vx = this.cam.vy = this.cam.vz = 0; this.cd.manual();
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny; this.cam.tx = this.cam.x; this.cam.ty = this.cam.y;
  }
  pan(dx, dy) { this.cam.x -= dx / this.z; this.cam.y -= dy / this.z; this.cam.tx = this.cam.x; this.cam.ty = this.cam.y; this.cam.vx = this.cam.vy = 0; this.cd.manual(); }
  overview() { const b = this.bounds; this.cd.manual(); this.cd.glide(b ? (b.x0 + b.x1 + 1) / 2 : SIZE / 2, b ? (b.y0 + b.y1 + 1) / 2 : SIZE / 2, this.fitZoom, { force: true }); this.zoomSet = true; }
  closeup() { const cd = this.cd; cd.user = false; this.zoomSet = true; const d = this.disp.get(this.state && this.state.active); if (d) cd.glide(d.tx + 0.5, d.ty + 0.5, this.defaultZoom(), { force: true }); else cd.glide(null, null, this.defaultZoom(), { force: true }); }
  reset() { this.disp.clear(); this.fx.reset(); this.floats = []; this.bubbles = []; this.timers = []; this.state = null; this.zoomSet = false; this.follow = true; this.hs = 0; this.slow = null; this.punch = 0; this.intro = null; this.marks = []; this.overlay = null; this.cine = null; this.hurt = 0; this.shake = 0; this.hitFlash.clear(); this.seqEnd = 0; this.bgCache = null; this.banner = null; this.dim = null; this.lights = []; this.fcache = null; this.cd.reset(); this.beats = []; this.cineFree = 0; this.lastActEnd = 0; this.introEnd = 0; this.lastBase = null; }

  kick(n) { if (this.shakeOn && !this.reduced) this.shake = Math.min(16, this.shake + n); }
  hitstop(t) { if (!this.reduced) this.hs = Math.max(this.hs, t); }
  slowmo(scale, dur) { if (!this.reduced) this.slow = { scale, dur, t: 0 }; }
  later(t, fn) { const T = { at: (this.base ?? this.time) + t, fn }; this.timers.push(T); return T; }
  camAt(t, fn) { this.later(t, fn).cam = true; } // R 10.3: a camera keyframe (compress() may drop it)
  // R 10.3: far behind (many fast bot turns queued): the current beat plays out untouched; everything after it is
  // squeezed into ~1.5 s in order (no snap, no lost events) and only the last camera keyframe of that stretch is kept.
  compress() {
    const nb = this.beats.find((b) => b.at > this.time), E = nb ? nb.at : this.time, end = this.seqEnd || 0, span = end - E;
    if (span <= 1.6) return;
    const k = 1.5 / span, f = (a) => (a > E ? E + (a - E) * k : a);
    let last = null; for (const T of this.timers) if (T.cam && T.at > E && (!last || T.at >= last.at)) last = T;
    this.timers = this.timers.filter((T) => !(T.cam && T.at > E && T !== last));
    for (const T of this.timers) T.at = f(T.at);
    for (const d of this.disp.values()) { if (d.deathAt != null) d.deathAt = f(d.deathAt); if (d.hideUntil != null) d.hideUntil = f(d.hideUntil); if (d.drop && !d.drop.landed) d.drop.t0 = f(d.drop.t0); }
    for (const b of this.beats) b.at = f(b.at);
    this.seqEnd = f(end); this.cineFree = f(this.cineFree || 0); this.lastActEnd = f(this.lastActEnd || 0); if (this.cd.myTurnAt > E) this.cd.myTurnAt = f(this.cd.myTurnAt);
    this.cd.stats.compress++;
  }
  flush() {
    const due = this.timers.sort((a, b) => a.at - b.at); this.timers = [];
    const saveBase = this.base; this.base = this.time;
    for (const t of due) t.fn();
    this.base = saveBase;
    this.seqEnd = this.time; this.beats = []; this.cineFree = 0; this.lastActEnd = 0; this.cd.myTurnAt = -1; this.cd.stats.flush++;
    for (const d of this.disp.values()) { d.t0 = -9; d.x = d.sx = d.tx; d.y = d.sy = d.ty; d.lunge = null; d.warp = null; }
  }
  sfx(n) { this.hooks.sfx && this.hooks.sfx(n); }
  haptic(p) { this.hooks.haptic && this.hooks.haptic(p); }
  colorOf(id) { const u = this.state && unitById(this.state, id); return u ? u.color : '#fff'; }
  glowOf(id) { const u = this.state && unitById(this.state, id); return u ? skinOf(u.skin).glow : '#fff'; }
  // 5.0 teams: is unit `id` (or a raw team number) on the viewer's side?
  viewer() { return this.myId != null && this.state ? unitById(this.state, this.myId) : null; }
  sideOf(id, team) {
    if (id != null && id === this.myId) return true;
    const me = this.viewer(); if (!me || me.team == null) return false;
    if (team === undefined) { const u = this.state && unitById(this.state, id); team = u ? u.team : null; }
    return team != null && team === me.team;
  }
  announce(text, sub, color, opts = {}) {
    // A1: in a match every screen banner goes through the Director (js/announcer.js) so it never stacks with DOM callouts.
    // Wave banners are announced by main.js already (richer copy); the replay renderer (no Director) keeps the canvas banner.
    if (this.dir) { if (!/^WAVE/.test(text)) this.dir.say({ text, sub, color, tier: opts.ominous ? 3 : 1, prio: opts.ominous ? 80 : 48, key: opts.key || 'c:' + text, kicker: opts.kicker }); return; }
    this.banner = { text, sub, color, t: 0, life: opts.life || 2.2, ominous: !!opts.ominous };
  }
  emote(id, text) { this.bubbles = this.bubbles.filter((b) => b.id !== id); this.bubbles.push({ id, text, t: 0, life: 2.8 }); }

  startIntro(s, myId) {
    this.intro = { t: 0, fly: !this.reduced }; this.cd.g = null; this.cd.fade = null; this.cd.fadeA = 0;
    this.introEnd = this.time + (this.intro.fly ? 1.95 : 0.7 + s.units.filter((u) => u.alive).length * 0.09 + 0.45); // R 10.3: turns queue behind the drop-in
    this.cam.x = this.cam.tx = SIZE / 2; this.cam.y = this.cam.ty = SIZE / 2; this.cam.z = this.cam.tz = this.fitZoom * 0.92; this.cam.vx = this.cam.vy = this.cam.vz = 0;
    const players = s.units.filter((u) => u.alive);
    players.forEach((u, i) => {
      const d = this.disp.get(u.id); if (!d) return;
      d.drop = { t0: this.time + 0.7 + i * 0.09, dur: 0.42, landed: false };
    });
    this.later(0.7 + players.length * 0.09 + 0.6, () => {
      const me = unitById(this.state, myId);
      if (me && this.intro && this.intro.fly && this.intro.t < 1.7) this.intro.pend = me.id; // fly-over still running: frame() applies it when it lands
      else if (me) this.cd.glide(me.x + 0.5, me.y + 0.5, this.defaultZoom(), { force: true });
    });
  }

  setState(s, events = [], first = false) {
    const now = this.time;
    for (const u of s.units) {
      let d = this.disp.get(u.id);
      if (!d) { d = { face: u.x > SIZE / 2 ? -1 : 1, x: u.x, y: u.y, sx: u.x, sy: u.y, tx: u.x, ty: u.y, t0: -9, dur: 0.2, how: 'step', piece: u.piece, pop: 0, hp: u.hp, ghost: u.hp, lunge: null, deathAt: null, drop: null }; this.disp.set(u.id, d); }
      if (d.piece !== u.piece) { d.pop = 1; d.piece = u.piece; }
    }
    const prevActive = this.state ? this.state.active : null;
    this.state = s;
    if (first) return;
    // R 10.3: turns queue one after another (no interleaving, no cut-off). Far behind: squeeze what follows the current
    // beat; only a huge backlog (a hidden tab coming back) falls back to the instant flush.
    const back0 = (this.seqEnd || 0) - this.time;
    if (back0 > 30) this.flush(); else if (back0 > 7) this.compress();
    this.base = Math.max(this.time, this.seqEnd || 0, this.introEnd || 0, this.time + this.cd.busy());
    this.lastBase = this.base; this.beatEnd = null;
    const now0 = this.base, cd = this.cd, back = this.base - this.time;
    const quick = back > 2.5 ? 0.45 : back > 1.2 ? 0.7 : 1; // holds and glides shrink when turns pile up
    this.beats = this.beats.filter((b) => b.at > this.time - 4);
    // the turn's action box: the actor, where it goes, what its ability covers and everyone it hits
    const actor = prevActive, ti = events.findIndex((q) => q.e === 'turn');
    let box = null, hitsMe = false;
    const add = (x, y) => { if (x == null || y == null) return; if (!box) box = { x0: x, y0: y, x1: x, y1: y }; else { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); } };
    for (const e of ti < 0 ? events : events.slice(0, ti)) {
      if (e.e === 'move' && (e.id === actor || e.how === 'push' || e.how === 'pull')) { if (e.id === actor) add(e.from.x, e.from.y); add(e.to.x, e.to.y); }
      else if (e.e === 'ability' && e.id === actor) { add(e.from.x, e.from.y); add(e.anchor.x, e.anchor.y); for (const q of e.tiles || []) add(q.x, q.y); }
      else if (e.e === 'dmg' && e.src === actor && e.id !== actor && !e.self) { const v = unitById(s, e.id), d = this.disp.get(e.id); if (v && v.alive) add(v.x, v.y); else if (d) add(d.tx, d.ty); if (e.id === this.myId) hitsMe = true; }
    }
    const ultEv = events.find((q) => q.e === 'ability' && q.slot === 'ult' && q.id === actor);
    if (box && !ultEv) this.camAt(0, () => cd.act(box, actor, { quick, hitsMe }));
    // the camera leads a wide action by a beat (up to ~0.3 s) so the piece never runs out of frame
    let t = box && !ultEv ? Math.min(0.3, cd.actLead(box, actor) * 0.55) * quick : 0; let hits = 0; let lastAb = null;
    for (const e of events) {
      if (e.e === 'move') {
        const d = this.disp.get(e.id); if (!d) continue;
        const dist = Math.hypot(e.to.x - d.tx, e.to.y - d.ty);
        const dur = e.how === 'jump' ? 0.38 : e.how === 'blink' || e.how === 'swap' ? 0.22 : e.how === 'dash' ? 0.12 + dist * 0.025 : e.how === 'push' ? 0.16 : e.how === 'ice' ? 0.09 + dist * 0.05 : e.how === 'portal' ? 0.01 : 0.13 + dist * 0.045;
        const start = t;
        this.later(start, () => {
          d.sx = d.x; d.sy = d.y; d.tx = e.to.x; d.ty = e.to.y; d.t0 = this.time; d.how = e.how; d.dur = dur;
          if (e.how !== 'push' && e.to.x !== e.from.x) d.face = e.to.x < e.from.x ? -1 : 1;
          if (e.how === 'dash') this.fx.beam({ x: e.from.x + 0.5, y: e.from.y + 0.55 }, { x: e.to.x + 0.5, y: e.to.y + 0.55 }, this.colorOf(e.id), 0.4, 0.5);
          if (e.how === 'blink' || e.how === 'swap') this.fx.burst(e.from.x + 0.5, e.from.y + 0.5, this.glowOf(e.id), 14, 2.5);
          if (e.how === 'ice') { this.fx.burst(e.from.x + 0.5, e.from.y + 0.85, '#e8fbff', this.lowQ ? 4 : 8, 1.6, 'dust'); this.fx.burst(e.from.x + 0.5, e.from.y + 0.8, '#bfefff', 5, 2.2); }
          if (e.how === 'portal') {
            const pt = this.state.tiles[e.to.y * SIZE + e.to.x], col = PORTAL_COLS[(pt && pt.pair) || 0];
            d.x = d.sx = e.to.x; d.y = d.sy = e.to.y; d.warp = { t0: this.time, out: false };
            this.fx.burst(e.to.x + 0.5, e.to.y + 0.5, col, 20, 3); this.fx.ring(e.to.x + 0.5, e.to.y + 0.75, col, 1.8, 0.5, 0.08); this.fx.pillar(e.to.x + 0.5, e.to.y + 0.86, col, 0.5, 0.5, 3);
          }
          if ((e.how === 'conveyor' || e.how === 'pull') && this.fx.moveFx) this.fx.moveFx(e);
          this.sfx(e.how === 'jump' ? 'jump' : e.how === 'step' || e.how === 'push' ? 'step' : e.how === 'dash' ? 'whoosh' : e.how === 'blink' || e.how === 'swap' ? 'blink' : e.how === 'ice' ? 'ice:skid' : e.how === 'portal' ? 'portal' : e.how === 'pull' ? 'pull' : e.how === 'conveyor' ? 'conveyor' : 'slide');
        });
        if (e.how === 'jump') this.later(start + dur, () => { this.fx.burst(e.to.x + 0.5, e.to.y + 0.85, '#d9cfb8', 12, 2, 'dust'); this.fx.ring(e.to.x + 0.5, e.to.y + 0.86, '#ffffff', 1.2, 0.35, 0.05); d.squash = 1; this.kick(3); this.sfx('land'); });
        else if (e.how !== 'push') this.later(start + dur, () => { d.squash = 0.5; if (!this.lowQ && e.how !== 'portal') this.fx.burst(e.to.x + 0.5, e.to.y + 0.86, '#d9cfb8', 3, 0.9, 'dust'); });
        t += e.how === 'push' ? dur * 0.6 : dur * 0.8;
      } else if (e.e === 'ability') {
        hits = 0; lastAb = e.ab;
        const d = this.disp.get(e.id);
        if (e.slot === 'ult') {
          // R 10.3: one ultimate cine at a time; each gets its own framed moment (push-in on the whole action, then a
          // pure zoom back at impact, same centre)
          if (this.base + t < (this.cineFree || 0)) t = this.cineFree - this.base;
          const st = t, ub = e.id === actor ? box : null; this.cineFree = this.base + st + 1.12;
          if (ub) this.camAt(st, () => cd.act(ub, actor, { push: 1.14, hitsMe }));
          this.later(st, () => {
            const u = unitById(this.state, e.id);
            this.cine = { t: 0, life: 1.05, name: ABILITIES[e.ab].name, color: u ? u.color : '#ffd24d', who: u ? u.name : '', mine: e.id === this.myId, piece: u ? u.piece : 'pawn' };
            if (this.dir) this.dir.cine(this.cine.life / Math.max(1, this.cd.speed)); // A1: the cine owns the hero lane; DOM callouts wait (R 10.3: at the timeline's pace)
            this.punch = Math.max(this.punch, 0.3); this.light(e.from.x + 0.5, e.from.y + 0.6, '#ffd24d', 3.2, 1.1);
            this.fx.ultCharge(e.from.x + 0.5, e.from.y + 0.5, u ? u.color : '#ffd24d', this.glowOf(e.id));
            this.sfx('ultcharge'); this.haptic([20, 30, 20, 30, 20]);
          });
          t += 0.8;
          if (ub) this.camAt(t, () => cd.act(ub, actor, { hitsMe }));
        }
        const start = t;
        const secret = e.ab === 'tripwire' && !this.sideOf(e.id);
        this.later(start, () => {
          if (secret) { this.fx.burst(e.from.x + 0.5, e.from.y + 0.6, '#d8d2e8', 3, 0.8, 'dust'); return; } // enemies only see a shuffle
          if (d && e.anchor.x !== e.from.x) d.face = e.anchor.x < e.from.x ? -1 : 1;
          if (d && MELEE.has(e.ab)) { const dx = e.anchor.x - e.from.x, dy = e.anchor.y - e.from.y, l = Math.hypot(dx, dy) || 1; d.lunge = { t0: this.time, dx: dx / l, dy: dy / l, dur: 0.26 }; }
          this.fx.ability(e, this.colorOf(e.id), this.glowOf(e.id));
          this.light(e.anchor.x + 0.5, e.anchor.y + 0.5, this.glowOf(e.id), e.slot === 'ult' ? 3.4 : 2.2, e.slot === 'ult' ? 0.9 : 0.5);
          this.sfx('ab:' + e.ab);
          if (e.ab === 'colossusSlam' && d) { d.squash = 1; this.later(0.26, () => { d.squash = 1; this.punch = Math.max(this.punch, 0.08); this.hitstop(0.07); this.haptic([60, 30, 90]); }); }
          if (e.ab === 'quake') this.haptic([30, 20, 30, 20, 30]);
        });
        t += IMPACT[e.ab] ?? 0.06;
      } else if (e.e === 'dmg') {
        hits++;
        const n = hits;
        this.later(t, () => this.onDmg(e, n));
        t += 0.025;
      } else if (e.e === 'death') {
        const d = this.disp.get(e.id); if (d) d.deathAt = now0 + t + 0.06;
        this.later(t + 0.06, () => this.onDeath(e));
        t += 0.2;
      } else if (e.e === 'portal') {
        const d = this.disp.get(e.id);
        t += 0.05;
        this.later(t, () => { this.onFx(e); if (d) d.warp = { t0: this.time, out: true }; });
        t += 0.17;
      } else if (e.e === 'revive') {
        const d = this.disp.get(e.id); if (d) d.hideUntil = now0 + t + 0.45;
        this.later(t, () => this.onFx(e));
        t += 0.7;
      } else if (e.e === 'wave' && e.phase === 'start') {
        const st = t;
        this.later(st, () => this.onFx(e));
        const fresh = s.units.filter((u) => u.alive && u.wave === e.n);
        fresh.forEach((u, i) => { const d = this.disp.get(u.id); if (d) { d.x = d.sx = d.tx = u.x; d.y = d.sy = d.ty = u.y; d.hp = d.ghost = u.hp; d.drop = { t0: now0 + st + 0.55 + (u.boss ? 0.5 : i * 0.06), dur: u.boss ? 0.55 : 0.42, landed: false, boss: !!u.boss, quiet: i > 2 && !u.boss }; } });
        t += 0.4;
      } else if (e.e === 'turn') {
        // R 10.3: the beat boundary. Hold on the last action a moment, then glide to the next actor; its events (the
        // next messages) start once the camera has landed.
        if (box || hits) this.lastActEnd = this.base + t;
        const hold = cd.worth(actor) ? 0.32 * quick * (e.id === this.myId ? 0.6 : 1) : 0.05; // my turn: hand control back sooner
        if (this.lastActEnd && this.base + t < this.lastActEnd + hold) t = this.lastActEnd + hold - this.base;
        this.lastActEnd = 0;
        this.later(t, () => this.onFx(e));
        this.beatEnd = this.base + t; // this message's own visuals end here; what follows is the hand-off glide
        this.camAt(t, () => cd.turn(e.id));
        this.beats.push({ at: this.base + t, actor: e.id });
        if (e.id === this.myId) cd.myTurnAt = this.base + t;
        t += cd.lead(e.id) * (quick < 1 ? 0.8 : 0.9);
      } else if (e.e === 'world' && e.kind === 'meteor' && e.phase === 'strike') {
        this.later(t, () => this.onFx(e));
        t += 0.75;
      } else {
        this.later(t, () => this.onFx(e));
      }
    }
    if (hits >= 2 && lastAb) this.later(t, () => { const a = events.find((q) => q.e === 'ability'); if (a) this.floats.push({ x: a.anchor.x + 0.5, y: a.anchor.y - 1, text: `${hits} HITS`, t: 0, life: 1.1, color: '#ffd24d', size: 0.75 }); });
    // safety sync after the sequence plays
    this.later(t + 0.15, () => {
      for (const u of this.state.units) {
        const d = this.disp.get(u.id); if (!d) continue;
        d.hp = u.alive ? u.hp : 0;
        if (u.alive && !d.moving && (d.tx !== u.x || d.ty !== u.y)) { d.sx = d.x; d.sy = d.y; d.tx = u.x; d.ty = u.y; d.t0 = this.time; d.dur = 0.2; d.how = 'step'; }
      }
    });
    if (ti < 0 && (box || hits)) this.lastActEnd = this.base + t;
    if (ti < 0 && s.active != null && s.active !== prevActive && !s.over) { const id = s.active; this.camAt(t, () => cd.turn(id)); this.beats.push({ at: this.base + t, actor: id }); } // a turn change without a 'turn' event
    this.seqEnd = this.base + t + 0.05;
    this.base = null;
  }

  onDmg(e, n) {
    const d = this.disp.get(e.id); if (!d) return;
    const x = d.x + 0.5, y = d.y;
    d.hp = Math.max(0, d.hp - e.n);
    const srcD = e.src != null ? this.disp.get(e.src) : null, ang = srcD && srcD !== d ? Math.atan2(d.y - srcD.y, d.x - srcD.x) : -Math.PI / 2;
    const fxHit = () => this.fx.hit(x, y + 0.45, { n: e.n, crit: e.crit, elem: e.self ? 'self' : e.lava ? 'lava' : e.storm ? 'storm' : e.trap ? 'trap' : e.thorns ? 'thorns' : null, ang });
    if (e.self) { // Gambit's blood price: muted, no camera juice
      this.floats.push({ x: x + 0.25, y: y - 0.8, text: '-' + e.n, t: 0, life: 1, color: '#c97a80', size: 0.7 });
      fxHit(); this.hitFlash.set(e.id, 0.5);
      return;
    }
    const big = e.crit || e.n >= 25;
    this.floats.push({ x: x + (n > 1 ? (Math.random() - 0.5) * 0.4 : 0), y: y - 0.9, text: String(e.n), t: 0, life: 1.15, color: e.lava ? '#ff9a3d' : e.trap ? '#ffb86b' : e.storm ? '#ff6b6b' : e.thorns ? '#b6ff7a' : e.crit ? '#ffd24d' : '#ffffff', size: big ? 1.4 : 1, crit: e.crit, rot: (Math.random() - 0.5) * 0.3 });
    if (e.lava) { fxHit(); this.light(x, y + 0.6, '#ff8a3d', 1.6, 0.35); this.hitFlash.set(e.id, 1); d.recoil = null; this.kick(3); this.sfx('sizzle'); if (e.id === this.myId) { this.haptic(30); this.hurt = 1; } return; }
    if (e.crit) this.floats.push({ x, y: y - 1.45, text: 'CRITICAL', t: 0, life: 0.9, color: '#ffd24d', size: 0.55 });
    this.hitFlash.set(e.id, 1);
    d.recoil = { t0: this.time, src: e.src };
    fxHit();
    this.light(x, y + 0.6, e.storm ? '#ff3b3b' : e.crit ? '#ffd24d' : '#fff1d6', big ? 2.2 : 1.4, big ? 0.4 : 0.25, big ? 1 : 0.7);
    this.kick(e.crit ? 10 : Math.min(7, 2 + e.n / 8));
    if (e.crit) { this.hitstop(0.09); this.punch = Math.max(this.punch, 0.05); }
    else if (e.n >= 20) this.hitstop(0.045);
    this.sfx(e.shield ? 'block' : e.crit ? 'crit' : e.storm ? 'burn' : 'hit');
    if (e.id === this.myId) { this.haptic(e.crit ? [30, 40, 60] : 25); this.hurt = 1; }
  }
  onDeath(e) {
    const s = this.state; const v = unitById(s, e.id); if (!v) return;
    const d = this.disp.get(e.id); if (!d) return;
    const killer = e.by ? unitById(s, e.by) : null;
    const fin = killer && killer.kind === 'player' ? killer.finisher || 'shatter' : 'shatter';
    this.fx.finisher(v.kind === 'hollow' ? 'shatter' : fin, d.x + 0.5, d.y + 0.86, v.piece, v.skin, skinOf(v.skin).glow);
    this.kick(v.kind === 'player' ? 14 : 8);
    this.light(d.x + 0.5, d.y + 0.7, skinOf(v.skin).glow, v.kind === 'player' ? 3 : 1.8, v.kind === 'player' ? 0.8 : 0.4);
    if (v.kind === 'player' && s.over) this.shot(d.x, d.y, 1.45, 1.6, 'final');
    this.sfx(v.kind === 'player' ? 'kill:' + fin : 'shatter');
    if (v.kind === 'player') {
      this.hitstop(0.12);
      const final = s.over;
      this.slowmo(final ? 0.18 : 0.35, final ? 1.6 : 0.7);
      this.punch = Math.max(this.punch, final ? 0.22 : 0.1);
      if (e.by === this.myId || e.id === this.myId) this.haptic([40, 30, 80]);
      if (e.streak) this.hooks.streak && this.hooks.streak(e);
      if (e.regicide) { this.fx.flash(0.5, '#ffe7a0'); this.punch = Math.max(this.punch, 0.2); this.slowmo(0.2, 1.2); this.fx.ring(d.x + 0.5, d.y + 0.86, '#ffd24d', 4.5, 0.9, 0.16); }
      if (e.shutdown) { this.fx.flash(0.35, '#9fd4ff'); this.punch = Math.max(this.punch, 0.16); this.fx.shock(d.x + 0.5, d.y + 0.6, 'rgba(160,210,255,0.5)', 2.4, 0.5); }
    }
  }
  onFx(e) {
    const fx = this.fx, s = this.state;
    const at = (id) => { const d = this.disp.get(id); return d ? [d.x + 0.5, d.y] : [0, 0]; };
    switch (e.e) {
      case 'heal': { const [x, y] = at(e.id); const d = this.disp.get(e.id); if (d) d.hp += e.n; this.floats.push({ x, y: y - 0.9, text: '+' + e.n, t: 0, life: 1, color: '#6dffa8', size: 0.9 }); fx.burst(x, y + 0.4, '#6dffa8', 10, 1.5, 'up'); if (e.id === this.myId) this.sfx('heal'); break; }
      case 'aoe': for (const t of e.tiles) fx.flashTile(t.x, t.y, e.kind === 'hit' ? '#ff5d5d' : '#7fe0ff'); break;
      case 'crate': fx.burst(e.x + 0.5, e.y + 0.5, '#c9934d', 14, 3.5, 'chunk'); fx.burst(e.x + 0.5, e.y + 0.5, '#d6b05c', 6, 3, 'chunk'); this.kick(3); this.sfx('crate'); break;
      case 'rubble': fx.burst(e.x + 0.5, e.y + 0.5, '#8d8aa0', e.broke ? 16 : 6, 3, 'chunk'); this.sfx('rubble'); break;
      case 'impact': fx.burst(e.x + 0.5, e.y + 0.6, '#ffe2a8', 14, 3.5); fx.shock(e.x + 0.5, e.y + 0.6, 'rgba(255,220,160,0.5)', 1, 0.3); this.kick(7); this.hitstop(0.05); this.sfx('impact'); break;
      case 'pickup': {
        const [x, y] = at(e.id);
        const col = e.k === 'shard' ? '#9df3ff' : e.k === 'potion' ? '#ff6b8b' : '#ffe04d';
        fx.burst(x, y + 0.2, col, 14, 2, 'up'); fx.ring(x, y + 0.8, col, 1.2, 0.4);
        this.floats.push({ x, y: y - 1.15, text: e.k === 'shard' ? `+${e.n} SHARD${e.n > 1 ? 'S' : ''}` : e.k === 'potion' ? 'POTION' : 'HASTE', t: 0, life: 1.2, color: col, size: 0.62 });
        this.sfx('pickup');
        if (e.id === this.myId && e.k === 'shard' && this.hooks.shard) { const [sx, sy] = this.toScreen(x, y + 0.3); this.hooks.shard(sx, sy, e.n); }
        break;
      }
      case 'promote': case 'crowned': {
        const [x, y] = at(e.id);
        fx.promote(x, y + 0.86, this.colorOf(e.id), this.glowOf(e.id), { crowned: e.e === 'crowned' });
        this.light(x, y + 0.6, e.e === 'crowned' ? '#ffd24d' : this.glowOf(e.id), 3.6, 1.2);
        if (e.e === 'crowned' || e.id === this.myId) { const d = this.disp.get(e.id); if (d) this.shot(d.x, d.y, 1.25, 1.1, 'shot', e.id); }
        this.kick(9); this.hitstop(0.1); this.punch = Math.max(this.punch, 0.1);
        if (e.id === this.myId) { this.slowmo(0.4, 0.6); this.haptic([20, 40, 20, 40, 60]); }
        this.sfx(e.e === 'crowned' ? 'crown' : e.piece ? 'promote:' + e.piece : 'promote');
        break;
      }
      case 'shrine': this.light(e.x + 0.5, e.y + 0.5, '#7fe0ff', 2.6, 0.9); fx.ring(e.x + 0.5, e.y + 0.7, '#7fe0ff', 2.4, 0.9); fx.pillar(e.x + 0.5, e.y + 0.86, '#7fe0ff', 0.6, 0.8, 4); this.sfx('shrine'); break;
      case 'storm':
        if (e.phase === 'collapse') {
          const ring = e.ring - 1;
          for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (ringOf(x, y) === ring) {
            const ang = Math.atan2(y - SIZE / 2 + 0.5, x - SIZE / 2 + 0.5);
            fx.fallTile(x, y, (x + y) % 2 ? this.theme.dark : this.theme.light, ((ang + Math.PI) / (Math.PI * 2)) * 0.9);
            if (!this.lowQ && (x + y) % 3 === 0) { const dl = ((ang + Math.PI) / (Math.PI * 2)) * 0.9; this.later(dl, () => { fx.burst(x + 0.5, y + 0.6, '#5a5068', 4, 2, 'chunk'); fx.burst(x + 0.5, y + 0.6, '#b9a27e', 3, 1.4, 'dust'); }); }
          }
          this.light(SIZE / 2, SIZE / 2, '#ff3b3b', SIZE * 0.7, 0.8, 0.6);
          this.kick(14); this.sfx('storm'); this.haptic([60, 40, 120]);
        } else { this.kick(5); this.sfx(e.phase === 'crack' ? 'storm:crack' : 'warn'); }
        break;
      case 'stagger': { const [x, y] = at(e.id); this.floats.push({ x, y: y - 1.25, text: 'STAGGERED', t: 0, life: 1, color: '#c9a6ff', size: 0.55 }); break; }
      case 'buff': { const [x, y] = at(e.id); fx.ring(x, y + 0.8, e.k === 'atk' ? '#ff4a2a' : e.k === 'def' ? '#7fb6ff' : e.k === 'spd' || e.k === 'move' ? '#ffe04d' : e.k === 'heal' ? '#6dffa8' : '#ffffff', 1.5, 0.6); this.sfx('buff'); break; }
      case 'rampart': fx.burst(e.x + 0.5, e.y + 0.6, '#b8b2c8', 14, 3, 'chunk'); fx.shock(e.x + 0.5, e.y + 0.6, 'rgba(200,190,220,0.4)', 0.9); this.kick(5); this.sfx('rampart'); break;
      case 'crownSpawn': this.light(e.x + 0.5, e.y + 0.5, '#ffd24d', 4, 1.6); fx.crownSpawn(e.x + 0.5, e.y + 0.62); this.kick(6); this.sfx('crownspawn'); break;
      case 'mark': fx.ring(e.x + 0.5, e.y + 0.6, '#c9a6ff', 1.2, 0.7); break;
      case 'attune': {
        const [x, y] = at(e.id);
        const d = this.disp.get(e.id);
        if (e.milestone) {
          fx.ring(x, y + 0.86, '#9df3ff', 3.2, 0.8, 0.12); fx.shock(x, y + 0.6, 'rgba(157,243,255,0.45)', 1.8, 0.45); fx.burst(x, y, '#d8fbff', 30, 3.5, 'up'); fx.pillar(x, y + 0.86, '#9df3ff', 0.6, 0.8, 5);
          this.floats.push({ x, y: y - 1.5, text: `ATTUNEMENT ${['I', 'II', 'III', 'IV', 'V', 'VI'][e.tier - 1] || e.tier}`, t: 0, life: 1.6, color: '#9df3ff', size: 0.75 });
          this.kick(5); this.sfx('attune'); if (e.id === this.myId) this.haptic([20, 30, 40]);
        } else this.floats.push({ x: x + 0.35, y: y - 0.6, text: `+ATTUNE`, t: 0, life: 0.9, color: '#7fe0ff', size: 0.45 });
        if (d) d.attunePulse = 1;
        break;
      }
      case 'ultReady': { const [x, y] = at(e.id); fx.ring(x, y + 0.86, '#ffd24d', 2, 0.6, 0.1); if (e.id === this.myId) { this.floats.push({ x, y: y - 1.5, text: 'ULTIMATE READY', t: 0, life: 1.5, color: '#ffd24d', size: 0.6 }); this.sfx('ultready'); this.haptic([30, 40, 30]); } break; }
      case 'chest': fx.burst(e.x + 0.5, e.y + 0.5, '#ffd24d', e.broke ? 30 : 10, 4, 'coin'); fx.burst(e.x + 0.5, e.y + 0.5, '#c9934d', 10, 3, 'chunk'); this.kick(e.broke ? 8 : 3); if (e.broke) { fx.ring(e.x + 0.5, e.y + 0.7, '#ffd24d', 3, 0.7, 0.12); fx.flash(0.3, '#ffe7a0'); this.floats.push({ x: e.x + 0.5, y: e.y - 0.6, text: 'CACHE OPENED', t: 0, life: 1.3, color: '#ffd24d', size: 0.6 }); } this.sfx(e.broke ? 'chest:open' : 'chest'); break;
      case 'world':
        if (e.kind === 'meteor' && e.phase === 'strike') {
          e.centers.forEach((c, i) => fx.meteor(c.x + 0.5, c.y + 0.6, i * 0.08, '#ff8a3d', () => { this.kick(9); this.sfx('impact'); }));
          this.later(0.55, () => { for (const t of e.tiles) fx.flashTile(t.x, t.y, '#ff6a2a', 0.6); for (const c of e.centers) this.light(c.x + 0.5, c.y + 0.5, '#ff8a3d', 3, 0.9); this.haptic([60, 30, 60]); });
          this.sfx('meteorfall');
        } else if (e.kind === 'meteor') { this.sfx('warn'); }
        else if (e.kind === 'shardRain') { e.tiles.forEach((t, i) => fx.meteor(t.x + 0.5, t.y + 0.5, i * 0.12, '#9df3ff')); this.sfx('pickup'); }
        else if (e.kind === 'supply') { fx.pillar(e.x + 0.5, e.y + 0.86, '#ffd24d', 1, 1.4, 9); fx.meteor(e.x + 0.5, e.y + 0.6, 0, '#ffd24d', () => { this.kick(10); this.sfx('land'); }); }
        else if (e.kind === 'bloodMoon') { fx.flash(0.4, '#ff2a2a'); this.sfx('dark'); }
        else { if (fx.event) fx.event(e, at); this.sfx('world:' + e.kind); } // A6/A9: earthquake, manaSurge, eclipse, frenzy, bounty, restless...
        break;
      case 'over': {
        const w = unitById(s, e.winner); const d = w && this.disp.get(w.id);
        if (e.siege && !e.won) { // Siege defeat: the board goes dark
          this.later(0.4, () => { this.dim = { t: 0 }; fx.flash(0.5, '#3a0010'); this.kick(10); this.slowmo(0.25, 1.6); this.sfx('announce:defeat'); this.cd.glide(null, null, this.fitZoom, { force: true }); this.cd.user = true; });
          break;
        }
        if (e.siege && e.won) {
          this.later(0.6, () => this.sfx('announce:victory'));
          for (let i = 0; i < 6; i++) this.later(1.4 + i * 0.4, () => { const cols = ['#ffd24d', '#c77dff', '#5cff9d', '#7fe0ff']; fx.firework(2 + Math.random() * (SIZE - 4), 2 + Math.random() * (SIZE - 6), cols[i % cols.length]); });
        }
        if (e.team != null && w) for (const m of s.units) if (m !== w && m.kind === 'player' && m.alive && m.team === e.team) { const md = this.disp.get(m.id); if (md) this.later(1.0, () => this.fx.pillar(md.x + 0.5, md.y + 0.86, m.color, 0.9, 2, 8)); }
        if (d) {
          this.later(0.9, () => { this.cd.glide(d.x + 0.5, d.y + 0.5, this.defaultZoom() * 1.5, { kind: 'final' }); this.cd.user = true; this.fx.pillar(d.x + 0.5, d.y + 0.86, '#ffd24d', 1.2, 2.2, 9); });
          for (let i = 0; i < 9; i++) this.later(1.2 + i * 0.32, () => { const cols = ['#ffd24d', '#7fe0ff', '#ff4d6d', '#5cff9d', '#c77dff']; this.fx.firework(d.x + 0.5 + (Math.random() - 0.5) * 3, d.y - 1.5 - Math.random() * 2, cols[i % cols.length]); this.sfx('firework'); });
        }
        break;
      }
      // ---------- 5.0 ----------
      case 'portal': {
        const pt = s.tiles[e.from.y * SIZE + e.from.x], col = PORTAL_COLS[(pt && pt.pair) || 0];
        fx.burst(e.from.x + 0.5, e.from.y + 0.5, col, 18, 2.6); fx.ring(e.from.x + 0.5, e.from.y + 0.7, col, 1.4, 0.35, 0.06);
        fx.parts.push(...Array.from({ length: this.lowQ ? 8 : 16 }, (_, i) => ({ kind: 'spiral', cx: e.from.x + 0.5, cy: e.from.y + 0.45, a: i / 16 * 6.28, r: 0.7, x: 0, y: 0, life: 0.35, t: 0, color: i % 2 ? col : '#ffffff', size: 0.035, vx: 0, vy: 0, g: 0 })));
        break;
      }
      case 'trapSet': {
        if (!this.sideOf(e.id)) break; // invisible to enemies
        fx.ring(e.x + 0.5, e.y + 0.62, 'rgba(255,90,70,0.9)', 1, 0.4, 0.03);
        fx.burst(e.x + 0.5, e.y + 0.6, '#ffd2c8', 4, 0.8);
        this.floats.push({ x: e.x + 0.5, y: e.y - 0.1, text: 'ARMED', t: 0, life: 0.9, color: '#ff8a7a', size: 0.42 });
        break;
      }
      case 'trap': {
        const cx = e.x + 0.5, cy = e.y + 0.55;
        fx.slash(cx, cy, '#e8e2f0', -0.4, 0.42, 0.22); fx.slash(cx, cy, '#e8e2f0', Math.PI - 0.4, 0.42, 0.22);
        fx.burst(cx, cy, '#b8b2c8', 12, 3.5, 'chunk'); fx.burst(cx, cy, '#ff6a4d', 10, 3);
        fx.flashTile(e.x, e.y, '#ff4d3d', 0.5); fx.shock(cx, cy + 0.1, 'rgba(255,90,70,0.45)', 1.1, 0.3);
        this.floats.push({ x: cx, y: e.y - 1.35, text: 'TRAPPED', t: 0, life: 1.2, color: '#ff7a5c', size: 0.62 });
        this.kick(7); this.hitstop(0.06); this.sfx('trap'); if (e.id === this.myId) this.haptic([40, 20, 40]);
        break;
      }
      case 'soul': {
        const col = this.colorOf(e.id);
        fx.pillar(e.x + 0.5, e.y + 0.86, col, 0.35, 0.9, 3); fx.burst(e.x + 0.5, e.y + 0.4, col, 14, 1.2, 'up'); fx.ring(e.x + 0.5, e.y + 0.75, col, 1.3, 0.6);
        if (this.sideOf(e.id)) this.floats.push({ x: e.x + 0.5, y: e.y - 0.7, text: 'SOUL - RESCUE IT', t: 0, life: 1.6, color: col, size: 0.45 });
        this.sfx('soul');
        break;
      }
      case 'revive': {
        const d = this.disp.get(e.id), u = unitById(s, e.id), col = u ? u.color : '#fff';
        const cx = e.x + 0.5, cy = e.y + 0.86;
        fx.revive(cx, cy, col); // A6: both beats (gather, then the +0.45s burst)
        this.cd.look(e.x + 0.5, e.y + 0.5, { actor: e.by ?? e.id }); this.sfx('soul');
        this.later(0.45, () => {
          if (d) { d.hideUntil = null; d.deathAt = null; d.x = d.sx = d.tx = e.x; d.y = d.sy = d.ty = e.y; d.t0 = -9; d.lunge = d.recoil = d.drop = d.warp = null; d.hp = d.ghost = u && u.alive ? u.hp : d.hp; d.pop = 1; d.squash = 1; d.reviveAt = this.time; }
          this.light(cx, cy - 0.3, '#fff6d0', 3.4, 1.2);
          this.floats.push({ x: cx, y: e.y - 1.1, text: 'REVIVED', t: 0, life: 1.6, color: '#fff3c4', size: 0.85 });
          this.kick(8); this.punch = Math.max(this.punch, 0.12); this.hitstop(0.08);
          if (e.id === this.myId || e.by === this.myId) { this.slowmo(0.4, 0.7); this.haptic([30, 40, 30, 40, 90]); }
        });
        break;
      }
      case 'soulDeny': {
        const col = this.colorOf(e.of), cx = e.x + 0.5, cy = e.y + 0.4;
        fx.burst(cx, cy, col, 22, 4.5); fx.burst(cx, cy, '#ffffff', 10, 3.5); fx.ring(cx, cy + 0.4, '#ff4d6d', 2, 0.45, 0.08);
        fx.shock(cx, cy + 0.3, 'rgba(255,77,109,0.45)', 1.3, 0.3);
        this.floats.push({ x: cx, y: e.y - 0.8, text: 'DENIED', t: 0, life: 1.3, color: '#ff4d6d', size: 0.7 });
        this.kick(5); this.sfx('souldeny');
        break;
      }
      case 'soulFade': {
        const col = this.colorOf(e.of);
        fx.burst(e.x + 0.5, e.y + 0.3, col, 10, 0.8, 'up'); fx.ring(e.x + 0.5, e.y + 0.75, col, 1, 0.5, 0.03);
        if (this.sideOf(e.of)) this.sfx('soulfade');
        break;
      }
      case 'wave':
        if (e.phase === 'start') {
          e.tiles.forEach((t, i) => this.later(i * 0.05, () => {
            fx.waveSpawn(t.x + 0.5, t.y + 0.62, false); if (i < 6) this.light(t.x + 0.5, t.y + 0.5, '#8f5cff', 1.6, 0.7);
          }));
          if (e.boss) {
            this.announce('WAVE ' + e.n, 'THE COLOSSUS AWAKENS', '#b77dff', { life: 2.8, ominous: true });
            fx.flash(0.45, '#2a0a4a'); this.kick(12); this.punch = Math.max(this.punch, 0.1); this.haptic([80, 60, 80, 60, 160]);
            const b = s.units.find((u) => u.alive && u.boss && u.wave === e.n); if (b) this.later(0.6, () => this.cd.look(b.x + 0.5, b.y + 0.5, { actor: b.id, kind: 'boss' }));
          } else { this.announce('WAVE ' + e.n, e.of ? `OF ${e.of}` : '', '#c9a6ff'); this.kick(4); this.sfx('announce:wave'); }
          this.sfx('hollowrise');
        } else if (e.phase === 'clear') {
          this.announce('WAVE CLEARED', e.boss ? 'A COLOSSUS STIRS' : `WAVE ${e.next} INCOMING`, '#ffd24d', { life: 2.2 });
          fx.flash(0.3, '#fff1c4'); this.punch = Math.max(this.punch, 0.06);
          const cols = ['#ffd24d', '#7fe0ff', '#5cff9d', '#c77dff'];
          for (let i = 0; i < (this.lowQ ? 3 : 5); i++) this.later(0.15 + i * 0.22, () => { fx.firework(this.cam.x + (Math.random() - 0.5) * 5, this.cam.y - 1 - Math.random() * 2.5, cols[i % cols.length]); this.sfx('firework'); });
          this.sfx('announce:waveclear');
        }
        break;
      case 'multi': {
        const [x, y] = at(e.id);
        fx.flash(0.35, '#ffe7a0'); fx.ring(x, y + 0.8, '#ffd24d', 3.6, 0.7, 0.14); fx.shock(x, y + 0.5, 'rgba(255,220,120,0.45)', 2.2, 0.45);
        this.punch = Math.max(this.punch, 0.16); this.slowmo(0.3, 0.9); this.kick(8);
        break;
      }
      case 'final':
        fx.flash(0.4, '#ff2a3a'); this.punch = Math.max(this.punch, 0.12); this.slowmo(0.45, 0.8); this.kick(6);
        this.haptic([60, 40, 60]);
        break;
      case 'steadfast': { const [x, y] = at(e.id); this.floats.push({ x, y: y - 1.5, text: 'STEADFAST', t: 0, life: 1.4, color: '#9df3ff', size: 0.6 }); fx.glyph(x, y - 0.3, '#9df3ff', 'shield', 1); fx.ring(x, y + 0.8, '#9df3ff', 1.8, 0.6); this.sfx('steadfast'); break; }
      case 'bramble': { const [x, y] = at(e.id); this.floats.push({ x, y: y - 1.2, text: 'SLOWED', t: 0, life: 0.9, color: '#d58bea', size: 0.5 }); break; }
      default: { // A6 fx.event draws A9's hazard / world / siege-role events
        if (this.fx.event) this.fx.event(e, at);
        HZ.event(this, e, at); // B4 10.1: tile-anchored hazard art (eruption columns, rift tears, throne pulses, pit collapses)
        const SN = { split: 'split', shieldBreak: 'shieldbreak', summon: 'summon', bountyClaim: 'bountyclaim', enrage: 'enrage' };
        if (e.e === 'hazard' && e.kind) this.sfx('hazard:' + e.kind + ':' + (e.phase || 'go'));
        else if (e.e === 'hill') this.sfx(e.contested ? 'hill:contested' : 'hill:score');
        else if (SN[e.e]) this.sfx(SN[e.e]);
        if (e.x != null && e.y != null && (e.e === 'hazard' || e.e === 'enrage')) this.light(e.x + 0.5, e.y + 0.5, e.e === 'enrage' ? '#ff3b3b' : '#ffb070', 2, 0.6);
      }
    }
    void s;
  }

  frame(realDt) {
    this.real += realDt;
    if (this.quality === 'auto') this.autoQuality(realDt);
    if (this.reduced) this.punch = 0;
    this.fx.cap = this.lowQ ? 260 : 600; this.fx.lowQ = this.lowQ; this.fx.reduced = this.reduced;
    // R 10.3: the timeline plays faster while turns are queued (pace from the backlog) instead of skipping them
    const sp = this.cd.pace(Math.max(0, (this.seqEnd || 0) - this.time), realDt), pdt = realDt * sp;
    let dt = pdt;
    if (this.hs > 0) { this.hs -= pdt; dt = realDt * 0.04; }
    else if (this.slow) { this.slow.t += pdt; const k = Math.min(1, this.slow.t / this.slow.dur); dt = pdt * lerp(this.slow.scale, 1, k * k); if (k >= 1) this.slow = null; }
    this.time += dt; this._wdt = dt;
    if (this.intro) this.intro.t += dt;
    if (this.timers.length) { const due = this.timers.filter((t) => t.at <= this.time); this.timers = this.timers.filter((t) => t.at > this.time); due.forEach((t) => t.fn()); }
    this.fx.update(dt);
    if (this.fx.impactKick) { this.kick(this.fx.impactKick); this.fx.impactKick = 0; }
    if (this.cine) { this.cine.t += pdt; if (this.cine.t > this.cine.life) this.cine = null; }
    if (this.banner) { this.banner.t += realDt; if (this.banner.t > this.banner.life) this.banner = null; }
    if (this.dim) this.dim.t += realDt;
    const cam = this.cam;
    // A5 10.0 / R 10.3: director glides (turn beats, shots) drive the camera; the critically damped spring only settles
    // leftovers (resize, bounds) when no glide is running; the intro fly-over overrides both
    const flying = this.intro && this.intro.fly && this.intro.t < 1.7;
    if (!this.cd.update(realDt, flying)) { const sdt = Math.min(0.05, realDt); W10.spring(cam, 'x', 'vx', cam.tx, 0.24, sdt); W10.spring(cam, 'y', 'vy', cam.ty, 0.24, sdt); W10.spring(cam, 'z', 'vz', cam.tz, 0.28, sdt); }
    if (!flying && this.intro && this.intro.pend != null) { const me = unitById(this.state, this.intro.pend); this.intro.pend = null; if (me) this.cd.glide(me.x + 0.5, me.y + 0.5, this.defaultZoom(), { force: true }); }
    if (flying) { const p = ease(Math.min(1, this.intro.t / 1.7)); cam.x = cam.tx = SIZE / 2; cam.y = cam.ty = SIZE / 2 + 5.5 * (1 - p); cam.z = cam.tz = this.fitZoom * (0.58 + 0.34 * p); cam.vx = cam.vy = cam.vz = 0; }
    const z = this.z;
    const B = this.bounds || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
    const clamp = (v, span, lo, hi, zz) => { const h = span / zz / 2, len = hi - lo + 1; return len + 1 <= h * 2 ? lo + len / 2 : Math.max(lo + h - 0.5, Math.min(hi + 1.5 - h, v)); };
    if (!flying) { cam.x = clamp(cam.x, this.VW || this.W, B.x0, B.x1, z); cam.y = clamp(cam.y, this.VH, B.y0, B.y1, z); }
    if (!flying) cam.tx = clamp(cam.tx, this.VW || this.W, B.x0, B.x1, cam.tz); cam.ty = clamp(cam.ty, this.VH, B.y0, B.y1, cam.tz);
    this.punch *= Math.pow(0.02, realDt);
    for (const d of this.disp.values()) {
      const t = Math.max(0, Math.min(1, (this.time - d.t0) / d.dur));
      const e = d.how === 'jump' ? t : d.how === 'push' ? easeBack(t) : ease(t);
      d.x = lerp(d.sx, d.tx, e); d.y = lerp(d.sy, d.ty, e);
      d.moving = t < 1;
      d.mt = t;
      d.lift = d.how === 'jump' ? Math.sin(t * Math.PI) * 0.9 : d.moving && !this.reduced && (d.how === 'step' || d.how === 'slide' || d.how === 'dash') ? Math.sin(t * Math.PI) * Math.min(0.2, 0.07 + Math.hypot(d.tx - d.sx, d.ty - d.sy) * 0.03) : 0;
      d.pop = Math.max(0, d.pop - dt * 1.6);
      d.squash = Math.max(0, (d.squash || 0) - dt * 5);
      // HP chip-down: the lost chunk holds, flashes, then drains
      if (d.hpPrev != null && d.hp < d.hpPrev) { d.chipHold = 0.45; d.barFlash = 1; }
      if (d.hpPrev != null && d.hp > d.hpPrev) d.healGlow = 1;
      d.hpPrev = d.hp;
      if (d.ghost > d.hp) { if (d.chipHold > 0) d.chipHold -= dt; else d.ghost = Math.max(d.hp, d.ghost - dt * Math.max(35, (d.ghost - d.hp) * 3.5)); } else d.ghost = d.hp;
      d.barFlash = Math.max(0, (d.barFlash || 0) - dt * 4); d.healGlow = Math.max(0, (d.healGlow || 0) - dt * 2);
    }
    for (const l of this.lights) l.t += dt;
    if (this.lights.length) this.lights = this.lights.filter((l) => l.t < l.life);
    for (const b of this.bubbles) b.t += realDt;
    this.bubbles = this.bubbles.filter((b) => b.t < b.life);
    this.shake *= Math.pow(0.002, realDt);
    this.hurt = Math.max(0, (this.hurt || 0) - realDt * 2);
    for (const [id, f] of this.hitFlash) { const v = f - dt * 6; if (v <= 0) this.hitFlash.delete(id); else this.hitFlash.set(id, v); }
    this.floats = this.floats.filter((p) => (p.t += dt) < p.life);
    for (const m of this.motes) { m.y -= m.v * realDt; m.p += realDt; if (m.y < -0.5) { m.y = SIZE + 0.5; m.x = Math.random() * SIZE; } }
    this.draw();
  }

  tileVisible(x, y) {
    if (!this.intro || this.intro.t > 1.6) return 1;
    const d = Math.hypot(x - SIZE / 2 + 0.5, y - SIZE / 2 + 0.5);
    return Math.max(0, Math.min(1, (this.intro.t * 12 - d) / 3));
  }

  draw() {
    const { x: ctx, W, H, dpr } = this;
    const s = this.state, th = this.theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bk = W + 'x' + H + th.name + this.CY + 'x' + dpr;
    if (!this.bgCache || this.bgCache.k !== bk) { // pre-rendered 1:1 so each frame is a plain blit, not a gradient fill
      const bg = ctx.createRadialGradient(W / 2, this.CY, 10, W / 2, this.CY, Math.max(W, H) * 0.8);
      bg.addColorStop(0, th.bg[0]); bg.addColorStop(1, th.bg[1]);
      const vg0 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg0.addColorStop(0, 'rgba(0,0,0,0)'); vg0.addColorStop(1, 'rgba(0,0,0,0.55)');
      const mk = (fill) => { const c = document.createElement('canvas'); c.width = this.c.width; c.height = this.c.height; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = fill; g.fillRect(0, 0, W, H); return c; };
      this.bgCache = { k: bk, bg, vg0, bgC: mk(bg), vgC: mk(vg0) };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.bgCache.bgC, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!s) return;
    if (s.bloodMoon) { const mx = W * 0.8, my = this.pad.t + 70; ctx.globalAlpha = 0.7; ctx.drawImage(glowSprite('#ff3c28'), mx - 160, my - 160, 320, 320); ctx.globalAlpha = 1; ctx.fillStyle = '#ff5a40'; ctx.beginPath(); ctx.arc(mx, my, 34, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(120,10,10,0.5)'; ctx.beginPath(); ctx.arc(mx + 8, my - 6, 30, 0, Math.PI * 2); ctx.fill(); }
    const z = this.z, T = this.time;
    const sh = this.shake;
    const ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;
    ctx.save();
    ctx.translate((this.CX ?? W / 2) + ox, this.CY + oy); ctx.scale(z, z); ctx.translate(-this.cam.x, -this.cam.y);

    const FB = this.bounds || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
    const intro = this.intro && this.intro.t < 1.6;
    if (intro) this.drawStatic(ctx, true); // tiles pop in: draw live
    else { // blit only the visible part of the cached board
      const fc = this.floorCache(), k = fc.c.width / (SIZE + FPAD * 2);
      const [ax, ay] = this.toWorld(-sh, -sh), [bx, by] = this.toWorld(W + sh, H + sh);
      const x0 = Math.max(-FPAD, Math.floor(ax)), y0 = Math.max(-FPAD, Math.floor(ay)), x1 = Math.min(SIZE + FPAD, Math.ceil(bx)), y1 = Math.min(SIZE + FPAD, Math.ceil(by));
      if (Math.abs((z * dpr) / k - 1) < 0.002) { // B3 10.1: baked at the on-screen scale: copy 1:1 on whole device pixels, no resampling
        const offX = Math.round(dpr * ((this.CX ?? W / 2) + ox) - k * (this.cam.x + FPAD)), offY = Math.round(dpr * (this.CY + oy) - k * (this.cam.y + FPAD));
        const sx = Math.max(0, -offX), sy = Math.max(0, -offY), sw = Math.min(fc.c.width, this.c.width - offX) - sx, sh2 = Math.min(fc.c.height, this.c.height - offY) - sy;
        if (sw > 0 && sh2 > 0) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fc.c, sx, sy, sw, sh2, sx + offX, sy + offY, sw, sh2); ctx.restore(); }
      } else if (x1 > x0 && y1 > y0) ctx.drawImage(fc.c, (x0 + FPAD) * k, (y0 + FPAD) * k, (x1 - x0) * k, (y1 - y0) * k, x0, y0, x1 - x0, y1 - y0);
    }
    W10.drawStormVoid(this, ctx, T); // swirling nebula in the collapsed ring + glowing storm seam
    // animated floor layer on top of the cached static board
    let lavaQ = null;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const t = s.tiles[y * SIZE + x]; if (t.t === 'out') continue;
      const vis = intro ? this.tileVisible(x, y) : 1;
      if (vis <= 0) continue;
      const ring = ringOf(x, y);
      if (ring < s.storm.ring) continue;
      ctx.globalAlpha = vis;
      if (th.stars && (x * 7 + y * 13) % 5 === 0) { const tw = 0.3 + 0.7 * Math.abs(Math.sin(T * 1.5 + x * 3 + y)); ctx.fillStyle = `rgba(220,240,255,${tw * 0.7})`; ctx.fillRect(x + 0.2 + ((x * 31) % 6) / 10, y + 0.2 + ((y * 17) % 6) / 10, 0.035, 0.035); }
      if (th.lava && (x * 73 + y * 151) % 7 === 1) { const a = 0.35 + 0.3 * Math.sin(T * 2 + x + y); ctx.strokeStyle = `rgba(255,110,30,${a})`; ctx.lineWidth = 0.035; ctx.beginPath(); ctx.moveTo(x + 0.15, y + 0.7); ctx.lineTo(x + 0.45, y + 0.55); ctx.lineTo(x + 0.6, y + 0.75); ctx.lineTo(x + 0.88, y + 0.6); ctx.stroke(); }
      if (t.t === 'floor') { if (s.storm.crack && ring === s.storm.ring) this.drawCrack(x, y, T); continue; }
      if (t.t === 'bramble') this.drawBramble(x, y);
      else if (t.t === 'shrine') this.drawShrine(x, y, t.cd === 0, T);
      else if (t.t === 'lava') { this.drawLava(x, y, T); (lavaQ ||= []).push(x, y); }
      else if (t.t === 'ice') this.drawIce(x, y, T);
      else if (t.t === 'portal') this.drawPortal(x, y, t.pair || 0, T);
      else if (HZ.TILES[t.t]) HZ.tile(this, ctx, t, x, y, T); // A9
      if (s.storm.crack && ring === s.storm.ring) this.drawCrack(x, y, T);
    }
    ctx.globalAlpha = 1;
    if (th.glowGrid) {
      const sweep = (T * 3) % (SIZE + 6) - 3;
      ctx.strokeStyle = 'rgba(0,240,255,0.5)'; ctx.lineWidth = 0.04;
      ctx.beginPath(); ctx.moveTo(0, sweep); ctx.lineTo(SIZE, sweep); ctx.stroke();
    }
    if (lavaQ && !this.lowQ) { // heat haze spilling onto neighbouring tiles
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < lavaQ.length; i += 2) { const p = 0.5 + 0.5 * Math.sin(T * 1.7 + lavaQ[i] * 1.3 + lavaQ[i + 1]); this.glowDot(lavaQ[i] + 0.5, lavaQ[i + 1] + 0.5, 1.2, '#ff6a1e', 0.3 + p * 0.15); }
      ctx.globalCompositeOperation = 'source-over';
    }
    this.fx.drawFalls(ctx, th);
    this.fx.drawGround(ctx);
    W10.drawLighting(this, ctx, T); // light map: darkness with holes cut by shrines, lava, portals, crown, units, flashes
    W10.drawGroundFog(this, ctx, T);

    // active spotlight
    const act = s.active && unitById(s, s.active);
    if (act && act.alive && !s.over) {
      const d = this.disp.get(act.id);
      if (d) this.glowDot(d.x + 0.5, d.y + 0.6, 1.6, '#fff0c8', 0.26 + 0.1 * Math.sin(T * 4));
    }

    W10.drawOverlays(this, T);
    for (const m of this.marks) {
      const p = 0.5 + 0.5 * Math.sin(T * 5);
      this.glowDot(m.x + 0.5, m.y + 0.5, 0.75, '#ffd76e', 0.7 + p * 0.3);
      ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 0.06; ctx.strokeRect(m.x + 0.08, m.y + 0.08, 0.84, 0.84);
      const ay = m.y - 0.55 - Math.abs(Math.sin(T * 4)) * 0.3;
      ctx.fillStyle = '#ffd76a'; ctx.beginPath(); ctx.moveTo(m.x + 0.3, ay); ctx.lineTo(m.x + 0.7, ay); ctx.lineTo(m.x + 0.5, ay + 0.25); ctx.closePath(); ctx.fill();
      if (m.label) { ctx.font = '700 0.2px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; const w = ctx.measureText(m.label).width + 0.14; ctx.fillStyle = 'rgba(10,9,15,0.9)'; ctx.fillRect(m.x + 0.5 - w / 2, ay - 0.3, w, 0.26); ctx.fillStyle = '#ffe3a1'; ctx.fillText(m.label, m.x + 0.5, ay - 0.06); }
    }
    if (s.meteors && s.meteors.length) {
      for (const m of s.meteors) {
        const p = 0.5 + 0.5 * Math.sin(T * 8);
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = m.x + dx, y = m.y + dy; if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue; ctx.fillStyle = `rgba(255,80,30,${0.18 + p * 0.18})`; ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92); }
        ctx.strokeStyle = `rgba(255,140,60,${0.6 + p * 0.4})`; ctx.lineWidth = 0.06;
        ctx.beginPath(); ctx.arc(m.x + 0.5, m.y + 0.5, 0.42 + p * 0.08, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(m.x - 0.1, m.y + 0.5); ctx.lineTo(m.x + 1.1, m.y + 0.5); ctx.moveTo(m.x + 0.5, m.y - 0.1); ctx.lineTo(m.x + 0.5, m.y + 1.1); ctx.stroke();
      }
    }

    for (const u of s.units) if (u.alive && u.mark) { ctx.strokeStyle = '#c9a6ff'; ctx.lineWidth = 0.04; ctx.setLineDash([0.1, 0.08]); ctx.beginPath(); ctx.arc(u.mark.x + 0.5, u.mark.y + 0.5, 0.32, T, T + Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    for (const it of s.items) if (this.tileVisible(it.x, it.y) >= 1) this.drawItem(it, T);
    if (s.teams || s.siege) this.drawBonds(T);

    const pool = this.drawPool ||= [], draws = this.drawList ||= []; draws.length = 0;
    const put = (y, t, a, b, c) => { let e = pool[draws.length]; if (!e) pool.push(e = {}); e.y = y; e.t = t; e.a = a; e.b = b; e.c = c; draws.push(e); };
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const t = s.tiles[y * SIZE + x];
      if ((t.t === 'wall' || t.t === 'rubble' || t.t === 'crate' || t.t === 'chest') && ringOf(x, y) >= s.storm.ring) { const vis = intro ? this.tileVisible(x, y) : 1; if (vis > 0) put(y + 0.5, 0, t, y * SIZE + x, vis); }
    }
    for (const u of s.units) {
      const d = this.disp.get(u.id); if (!d) continue;
      const showing = u.alive || (d.deathAt != null && this.time < d.deathAt);
      if (!showing) continue;
      if (d.drop && this.time < d.drop.t0) continue;
      if (d.hideUntil != null && this.time < d.hideUntil) continue;
      put(d.y + 0.6, 1, u, d, 0);
    }
    this.nLabels = 0;
    draws.sort(byY);
    for (const e of draws) { if (e.t === 0) this.drawSolid(e.a, e.b % SIZE, (e.b / SIZE) | 0, e.c); else this.drawUnit(e.a, e.b, T); }
    HZ.overlay(this, ctx, s, T); // A9: shields, role rings, bounty, eclipse
    for (let i = 0; i < this.nLabels; i++) this.drawLabel(this.labels[i], T);

    this.weather.draw(this, ctx, T, Math.min(0.05, this._wdt || 0.016));
    this.fx.drawAbove(ctx);
    ctx.restore();

    { const tint = this.lookOf().tint; if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); } }
    if (s.bloodMoon) { ctx.globalAlpha = 0.16 + 0.04 * Math.sin(this.real * 2); ctx.fillStyle = '#ff1a1a'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    if (this.dim) { ctx.globalAlpha = Math.min(0.5, this.dim.t * 0.3); ctx.fillStyle = '#12020a'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    this.drawScreenText(ox, oy);

    // screen flash / vignettes
    if (this.fx.screenFlash > 0.01 && !this.reduced) { ctx.globalAlpha = this.fx.screenFlash * 0.7; ctx.fillStyle = this.fx.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    const me = this.myId && unitById(s, this.myId);
    let red = 0;
    if (me && me.alive) {
      const d = this.disp.get(me.id); const r = d ? d.hp / stats(me).maxHp : 1;
      if (r < 0.3) red = 0.25 + 0.2 * Math.max(0, Math.sin(this.real * 6));
      if (ringOf(me.x, me.y) < s.storm.ring || (s.storm.crack && ringOf(me.x, me.y) === s.storm.ring)) red = Math.max(red, 0.3 + 0.15 * Math.sin(this.real * 8));
    }
    red = Math.max(red, this.hurt * 0.45);
    let vg = null;
    if (red > 0) { // quantised so the gradient is rebuilt only when the level changes
      const q = Math.round(red * 20) / 20, vc = this.redVg || (this.redVg = {});
      if (vc.q !== q || vc.k !== this.bgCache.k) { const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(120,0,10,${0.45 + q})`); vc.g = g; vc.q = q; vc.k = this.bgCache.k; }
      vg = vc.g;
    }
    if (vg) { ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); } else if (this.litVg && !intro) { /* A5: vignette already baked into the light map */ } else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.bgCache.vgC, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    if (this.cd.fadeA > 0) { ctx.globalAlpha = Math.min(1, this.cd.fadeA) * 0.92; ctx.fillStyle = '#07060b'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; } // R 10.3: reduced-motion cut
    if (this.banner) this.drawBanner(ctx, W, H);
    if (this.cine) this.drawCine(ctx, W, H);
    if (this.slow) { ctx.globalAlpha = 0.25 * (1 - this.slow.t / this.slow.dur); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H * 0.08); ctx.fillRect(0, H * 0.92, W, H * 0.08); ctx.globalAlpha = 1; }
    // A5: intro letterbox while the camera flies over the arena
    if (this.intro && this.intro.fly && this.intro.t < 2.2) { const k = this.intro.t < 1.6 ? 1 : 1 - (this.intro.t - 1.6) / 0.6; ctx.fillStyle = '#000'; ctx.globalAlpha = 0.85 * k; ctx.fillRect(0, 0, W, H * 0.07); ctx.fillRect(0, H * 0.93, W, H * 0.07); ctx.globalAlpha = 1; }
  }

  drawScreenText(ox, oy) {
    const ctx = this.x, z = this.z, s = this.state;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // A1 float layout: newer floats stack above older ones instead of printing on top of them,
    // and no float draws under a Director-owned message (hero callout, cine band, feed, chip, hint, lethal).
    const occ = this.dir ? this.dir.occupied() : null, placed = [];
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const f of this.floats) {
      const k = f.t / f.life;
      const [sx, sy0] = this.toScreen(f.x, f.y - ease(Math.min(1, k * 1.4)) * 0.7);
      const pop = k < 0.12 ? 1 + (1 - k / 0.12) * 0.8 : 1;
      const px = Math.max(12, z * 0.42) * f.size * pop;
      ctx.font = `800 ${px}px "Chakra Petch", system-ui, sans-serif`;
      const tw = ctx.measureText(f.text).width + 4;
      let lift = f.lift || 0;
      const box = { x: sx + ox - tw / 2, y: sy0 + oy - px * 0.5 - lift, w: tw, h: px };
      for (let i = 0; i < 6; i++) { const p = placed.find((q) => hit(q, box)); if (!p) break; lift += box.y + box.h - p.y + 3; box.y = sy0 + oy - px * 0.5 - lift; }
      f.lift = lift; placed.push(box);
      if (occ && occ.some((o) => hit(o, box))) continue;
      const sy = sy0 - lift;
      ctx.save(); ctx.translate(sx + ox, sy + oy); ctx.rotate((f.rot || 0) * (1 - k));
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.lineWidth = Math.max(3, px * 0.2); ctx.strokeStyle = 'rgba(8,6,14,0.92)'; ctx.lineJoin = 'round'; ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // damage preview labels
    const ov = this.overlay;
    const me = this.myId && unitById(s, this.myId);
    if (ov && ov.preview && me) {
      for (const id of ov.preview.hits || []) {
        const v = unitById(s, id); const d = this.disp.get(id); if (!v || !d) continue;
        const [lo, hi] = previewDamage(me, v, ov.preview.mult);
        const ko = lo >= v.hp, maybe = !ko && hi >= v.hp;
        const [sx, sy] = this.toScreen(d.x + 0.5, d.y + 0.86 + (PIECE_TOP[v.piece] || -1) * 0.92 - 0.55);
        const text = ko ? 'KO' : `${lo}-${hi}${maybe ? ' KO?' : ''}`;
        const px = Math.max(11, z * 0.28);
        ctx.font = `800 ${px}px "Chakra Petch", sans-serif`;
        const w = ctx.measureText(text).width + px;
        const bob = Math.sin(this.real * 6) * 2;
        ctx.fillStyle = ko ? '#ffd24d' : 'rgba(150,20,30,0.92)';
        roundRect(ctx, sx - w / 2, sy - px * 0.75 + bob, w, px * 1.5, px * 0.4); ctx.fill();
        ctx.fillStyle = ko ? '#1a1205' : '#fff'; ctx.fillText(text, sx, sy + bob);
      }
    }
    // emote bubbles
    for (const b of this.bubbles) {
      const d = this.disp.get(b.id); const u = unitById(s, b.id); if (!d || !u || !u.alive) continue;
      const k = b.t / b.life; const pop = k < 0.08 ? easeBack(k / 0.08) : 1;
      const [sx, sy] = this.toScreen(d.x + 0.5, d.y + 0.86 + (PIECE_TOP[u.piece] || -1) * 0.92 - 0.7);
      const px = Math.max(12, z * 0.3);
      ctx.font = `700 ${px}px "Chakra Petch", sans-serif`;
      const w = ctx.measureText(b.text).width + px * 1.2, h = px * 1.7;
      if (occ && occ.some((o) => hit(o, { x: sx - w / 2, y: sy - h * 1.1, w, h: h * 1.2 }))) continue; // A1: never under a Director message
      ctx.save(); ctx.translate(sx, sy - h * 0.5); ctx.scale(pop, pop); ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
      ctx.fillStyle = '#f6f1ff'; roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, h / 2 - 1); ctx.lineTo(0, h / 2 + 7); ctx.lineTo(6, h / 2 - 1); ctx.fill();
      ctx.fillStyle = u.color; ctx.fillRect(-w / 2 + 4, -h / 2 + 3, 3, h - 6);
      ctx.fillStyle = '#1a1626'; ctx.fillText(b.text, 3, 1);
      ctx.restore();
    }
  }

  drawWeather(ctx, T) {
    const th = this.theme, w = th.weather || 'dust';
    for (let mi = 0; mi < this.motes.length; mi += this.lowQ ? 2 : 1) {
      const m = this.motes[mi];
      const a = 0.5 + 0.5 * Math.sin(m.p * 2);
      if (w === 'petals') {
        const x = m.x + Math.sin(m.p * 0.7) * 0.8, y = SIZE - m.y;
        ctx.globalAlpha = 0.55; ctx.fillStyle = m.s > 0.03 ? '#ffd1dc' : '#fff6f0';
        ctx.save(); ctx.translate(x, y); ctx.rotate(m.p); ctx.beginPath(); ctx.ellipse(0, 0, m.s * 2.2, m.s * 1.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else if (w === 'pixels') {
        ctx.globalAlpha = a * 0.6; ctx.fillStyle = m.s > 0.03 ? '#ff3df2' : '#00f0ff'; ctx.fillRect(m.x, m.y, m.s * 1.8, m.s * 1.8);
      } else if (w === 'embers') {
        ctx.globalAlpha = a * 0.8; ctx.fillStyle = a > 0.6 ? '#ffd27a' : '#ff6a1f'; ctx.beginPath(); ctx.arc(m.x + Math.sin(m.p * 1.7) * 0.4, m.y, m.s * 1.2, 0, Math.PI * 2); ctx.fill();
      } else if (w === 'fireflies') {
        const x = m.x + Math.sin(m.p * 0.9) * 0.9, y = m.y + Math.cos(m.p * 0.6) * 0.9 + (SIZE - m.y) * 0;
        const blink = Math.max(0, Math.sin(m.p * 2.5 + m.x));
        ctx.globalAlpha = blink * 0.9;
        ctx.fillStyle = 'rgba(220,255,140,0.25)'; ctx.beginPath(); ctx.arc(x, y, 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(240,255,190,0.95)'; ctx.beginPath(); ctx.arc(x, y, 0.045, 0, Math.PI * 2); ctx.fill();
      } else if (w === 'snow') {
        const x = m.x + Math.sin(m.p * 0.8) * 0.5, y = SIZE - m.y;
        ctx.globalAlpha = 0.75; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, m.s * 1.4, 0, Math.PI * 2); ctx.fill();
      } else if (w === 'bubbles') {
        ctx.globalAlpha = 0.35 + a * 0.3; ctx.strokeStyle = '#9dfff6'; ctx.lineWidth = 0.012; ctx.beginPath(); ctx.arc(m.x + Math.sin(m.p * 1.3) * 0.25, m.y, m.s * 2.2, 0, Math.PI * 2); ctx.stroke();
      } else if (w === 'stars') {
        ctx.globalAlpha = a * 0.7; ctx.fillStyle = '#e8f6ff'; ctx.fillRect(m.x, m.y, m.s, m.s);
      } else {
        ctx.globalAlpha = 0.15 + 0.15 * Math.sin(m.p * 2); ctx.fillStyle = th.mote; ctx.beginPath(); ctx.arc(m.x + Math.sin(m.p) * 0.3, m.y, m.s, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (w === 'stars' && Math.random() < 0.006) this.fx.beam({ x: Math.random() * SIZE, y: Math.random() * 4 }, { x: Math.random() * SIZE, y: 4 + Math.random() * 6 }, '#d8f6ff', 0.05, 0.6);
    ctx.globalAlpha = 1;
  }
  drawCine(ctx, W, H) {
    // A1 10.0: the ultimate cine draws inside the Director's hero lane (same slot DOM callouts use, never both at once).
    const c = this.cine, k = c.t / c.life, calm = this.reduced;
    if (this.dir) this.dir.holdCine();
    const R = this.dir ? this.dir.heroRect() : { y: this.pad.t + 30, h: Math.min(110, H * 0.13), w: W, cx: W / 2 };
    const inA = Math.min(1, k * 7), outK = k > 0.8 ? (k - 0.8) / 0.2 : 0, a = inA * (1 - outK);
    const eo = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    // dim + letterbox
    ctx.globalAlpha = 0.42 * a; ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, W, H);
    const lb = H * 0.075 * eo(k * 5) * (1 - outK);
    ctx.globalAlpha = 0.92; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, lb); ctx.fillRect(0, H - lb, W, lb);
    const bh = R.h * 0.84 * (1 - outK * 0.9), by = R.y + (R.h - bh) / 2, sk = Math.min(18, bh * 0.16);
    const s1 = calm ? 0 : (1 - eo(k * 4.5)) * -W, s2 = calm ? 0 : (1 - eo((k - 0.03) * 4.5)) * W;
    const band = (dx, inset, fill, alpha) => { ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(dx, by + sk + inset); ctx.lineTo(dx + W, by - sk + inset); ctx.lineTo(dx + W, by + bh - sk - inset); ctx.lineTo(dx, by + bh + sk - inset); ctx.closePath(); ctx.fill(); };
    band(s1, -4, c.color, 0.9 * a);                    // colour slash from the left
    band(s2, 3, 'rgba(10,8,16,0.9)', a);              // dark plate from the right
    // speed lines inside the plate
    if (!calm && !this.lowQ) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, by - sk, W, bh + sk * 2); ctx.clip();
      ctx.globalAlpha = 0.22 * a; ctx.fillStyle = c.color;
      for (let i = 0; i < 9; i++) { const yy = by + ((i * 37) % 100) / 100 * bh, len = W * (0.18 + ((i * 53) % 30) / 100), xx = ((c.t * (900 + i * 140) + i * 211) % (W + len)) - len; ctx.fillRect(W - xx - len, yy, len, 1.5); }
      ctx.restore();
    }
    // gold rules
    ctx.globalAlpha = a; ctx.fillStyle = '#ffd98a';
    const rw = W * eo(k * 3.5);
    ctx.fillRect(R.cx - rw / 2, by - sk * 0.2 + 2, rw, 1.5); ctx.fillRect(R.cx - rw / 2, by + bh + sk * 0.2 - 3.5, rw, 1.5);
    // text: kicker, title (slow push-in after a slam), player
    const name = c.name.toUpperCase(), cy = by + bh / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let px = Math.min(56, R.w / 8, bh * 0.44);
    ctx.font = `900 ${px}px Cinzel, serif`;
    const tw = ctx.measureText(name).width; if (tw > R.w * 0.88) { px *= (R.w * 0.88) / tw; ctx.font = `900 ${px}px Cinzel, serif`; }
    const slam = calm ? 1 : k < 0.09 ? 1.28 - 0.28 * eo(k / 0.09) : 1 + 0.05 * Math.min(1, (k - 0.09) / 0.8);
    const kp = Math.max(9, Math.min(12, px * 0.24));
    ctx.save(); ctx.translate(R.cx, cy - kp * 0.35); ctx.scale(slam, slam);
    ctx.globalAlpha = a * Math.min(1, k * 9);
    { const gt = glowText(name, ctx.font, px, Math.max(4, px * 0.12), 'rgba(0,0,0,0.9)', 'gold', c.color, this.lowQ ? 0 : 18, false, this.dpr); ctx.drawImage(gt.c, -gt.w / 2, -gt.h / 2, gt.w, gt.h); ctx.lineJoin = 'round'; }
    if (!calm && k < 0.16) { ctx.globalAlpha = (1 - k / 0.16) * 0.8 * a; ctx.fillStyle = '#fff'; ctx.fillText(name, 0, 0); }
    ctx.restore();
    ctx.globalAlpha = a;
    ctx.font = `800 ${kp}px "Chakra Petch", sans-serif`;
    const sub = ('ULTIMATE  /  ' + c.who).toUpperCase().split('').join(String.fromCharCode(8202));
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(sub, R.cx, cy + px * 0.64 + kp * 0.2);
    ctx.fillStyle = c.mine ? '#ffe9a8' : c.color; ctx.fillText(sub, R.cx, cy + px * 0.64 + kp * 0.2);
    ctx.globalAlpha = 1;
  }
  // ---------- static board cache: frame + floor + void base + grid ----------
  floorCache() {
    const s = this.state, th = this.theme, want = this.z * this.dpr;
    // geometric zoom buckets (~12% apart) so the blit is close to 1:1; capped for memory
    const cap = this.lowQ ? 64 : 128, span = SIZE + FPAD * 2;
    let px = Math.min(cap, Math.max(16, Math.round(Math.pow(1.12, Math.ceil(Math.log(want) / Math.log(1.12))))));
    // B3 10.1: near the resting zoom, bake at exactly the on-screen scale so draw() can blit 1:1 (see the fast path there)
    const rest = this.defaultZoom() * this.dpr;
    if (rest <= cap && Math.abs(want / rest - 1) < 0.07) px = Math.round(span * rest) / span;
    // the content part of the key only changes with the state object (new each update), so it is not rebuilt per frame
    const B = this.bounds, mk = this.fcMemo || (this.fcMemo = {});
    if (mk.s !== s || mk.ring !== s.storm.ring || mk.th !== th || mk.B !== B) {
      let oh = 0; for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i].t === 'out') oh = (oh * 31 + i) | 0;
      mk.s = s; mk.ring = s.storm.ring; mk.th = th; mk.B = B;
      mk.pre = th.name + '|' + this.lookOf().mat + '|' + s.storm.ring + '|'; mk.post = '|' + oh + '|' + W10.solidsKey(s) + '|' + (B ? B.x0 + ',' + B.y0 + ',' + B.x1 + ',' + B.y1 : '');
    }
    const key = mk.pre + px + mk.post;
    let fc = this.fcache;
    if (fc && fc.key === key) return fc;
    const kNoPx = mk.pre + mk.post;
    if (fc && fc.kNoPx === kNoPx && Math.abs(this.cam.z - this.cam.tz) > this.cam.tz * 0.04) return fc; // A5: keep scaling the old bake mid-zoom; rebake once the zoom settles
    // B3 10.1: only the zoom changed and the old bake is within 0.8-1.25x of the screen scale: keep scaling it (a bake costs
    // 15-50 ms, and camera shots used to cost two of them); a zoom back near rest still rebakes for the exact 1:1 copy
    if (fc && fc.kNoPx === kNoPx && fc.px && px !== Math.round(span * rest) / span && want / fc.px > 0.8 && want / fc.px < 1.25) return fc;
    const n = Math.round(span * px);
    if (!fc) fc = this.fcache = { c: document.createElement('canvas') };
    if (fc.c.width !== n) { fc.c.width = n; fc.c.height = n; }
    const g = fc.c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, n, n);
    g.setTransform(px, 0, 0, px, FPAD * px, FPAD * px);
    const save = this.x; this.x = g; this.drawStatic(g, false); this.x = save;
    fc.key = key; fc.kNoPx = kNoPx; fc.px = px; this.cacheBuilds = (this.cacheBuilds || 0) + 1;
    return fc;
  }
  drawStatic(ctx, live) {
    const s = this.state, th = this.theme;
    const FB = this.bounds || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
    const fw = FB.x1 - FB.x0 + 1, fh = FB.y1 - FB.y0 + 1;
    void s; void th; void FB; void fw; void fh;
    W10.paintBoard(this, ctx, live); // A5 10.0: material tiles, plinth, cliffs, baked contact shadows
  }
  drawWall(th, x, y, vis) { const ctx = this.x; ctx.save(); ctx.translate(x, y); W10.paintWall(ctx, th, this.lookOf(), (x * 7 + y * 3) % 3, vis); ctx.restore(); }
  drawBanner(ctx, W, H) {
    const b = this.banner, k = b.t / b.life;
    const a = Math.min(1, b.t / 0.16) * (k > 0.78 ? (1 - k) / 0.22 : 1);
    const cy = this.pad.t + this.VH * 0.3;
    let px = Math.min(68, W / 6.5);
    const pop = this.reduced ? 1 : 1 + Math.pow(1 - Math.min(1, b.t / 0.28), 3) * 0.6;
    const jx = b.ominous && !this.reduced ? (Math.random() - 0.5) * 3 * (1 - k) : 0, jy = b.ominous && !this.reduced ? (Math.random() - 0.5) * 3 * (1 - k) : 0;
    ctx.save(); ctx.globalAlpha = a;
    const bh = px * (b.sub ? 2.3 : 1.7);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    const band = b.ominous ? 'rgba(30,6,50,0.82)' : 'rgba(8,6,14,0.66)';
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.2, band); g.addColorStop(0.8, band); g.addColorStop(1, 'rgba(0,0,0,0)');
    const grow = this.reduced ? 1 : Math.min(1, b.t / 0.2);
    ctx.fillStyle = g; ctx.fillRect(0, cy - bh / 2 * grow, W, bh * grow);
    ctx.fillStyle = b.color; ctx.globalAlpha = a * 0.8; ctx.fillRect(W * 0.18, cy - bh / 2 * grow, W * 0.64, 2); ctx.fillRect(W * 0.18, cy + bh / 2 * grow - 2, W * 0.64, 2);
    ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(W / 2 + jx, cy - (b.sub ? px * 0.28 : 0) + jy); ctx.scale(pop, pop);
    ctx.font = `900 ${px}px Cinzel, serif`;
    const tw = ctx.measureText(b.text).width; if (tw > W * 0.86) { px *= W * 0.86 / tw; ctx.font = `900 ${px}px Cinzel, serif`; }
    { const gt = glowText(b.text, ctx.font, px, Math.max(4, px * 0.12), 'rgba(6,4,10,0.95)', b.color, b.color, this.lowQ ? 0 : b.ominous ? 26 : 16, true, this.dpr); ctx.drawImage(gt.c, -gt.w / 2, -gt.h / 2, gt.w, gt.h); }
    ctx.lineJoin = 'round';
    if (b.sub) { ctx.font = `700 ${Math.max(12, px * 0.3)}px "Chakra Petch", sans-serif`; ctx.lineWidth = 4; ctx.strokeText(b.sub, 0, px * 0.78); ctx.fillStyle = b.ominous ? '#e8d4ff' : '#f2ecff'; ctx.fillText(b.sub, 0, px * 0.78); }
    ctx.restore();
  }
  drawLava(x, y, T) {
    const ctx = this.x, s = this.state, v = (x * 7 + y * 13) % 4;
    ctx.drawImage(tileTex('lava', v), x, y, 1, 1);
    const p = 0.5 + 0.5 * Math.sin(T * 1.8 + x * 1.3 + y * 0.7);
    ctx.fillStyle = `rgba(255,214,110,${0.04 + p * 0.16})`; ctx.fillRect(x, y, 1, 1);
    // crust rim where the pool meets solid floor
    const isL = (xx, yy) => xx >= 0 && yy >= 0 && xx < SIZE && yy < SIZE && s.tiles[yy * SIZE + xx].t === 'lava';
    ctx.fillStyle = 'rgba(30,8,4,0.85)';
    if (!isL(x, y - 1)) ctx.fillRect(x, y, 1, 0.06); if (!isL(x, y + 1)) ctx.fillRect(x, y + 0.94, 1, 0.06);
    if (!isL(x - 1, y)) ctx.fillRect(x, y, 0.06, 1); if (!isL(x + 1, y)) ctx.fillRect(x + 0.94, y, 0.06, 1);
    if (this.lowQ) return;
    for (let i = 0; i < 2; i++) {
      const sd = (x * 17 + y * 29 + i * 11) % 13, ph = (T * (0.35 + sd * 0.02) + sd * 0.37 + i * 0.5) % 1;
      const bx = x + 0.2 + ((sd * 5 + i * 3) % 7) / 10, by = y + 0.2 + ((sd * 3 + i * 5) % 7) / 10, r = 0.02 + ph * 0.08;
      ctx.globalAlpha = ph < 0.85 ? 0.85 : (1 - ph) / 0.15;
      ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120,30,8,0.8)'; ctx.lineWidth = 0.015; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,230,0.8)'; ctx.beginPath(); ctx.arc(bx - r * 0.35, by - r * 0.35, r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (Math.random() < 0.012) this.fx.burst(x + 0.2 + Math.random() * 0.6, y + 0.5, Math.random() < 0.5 ? '#ffb43d' : '#ff6a1f', 1, 0.7, 'up');
  }
  drawIce(x, y, T) {
    const ctx = this.x, sd = (x * 13 + y * 7) % 9;
    ctx.drawImage(tileTex('ice', sd % 4), x, y, 1, 1);
    const c = ((T * 0.32 + sd * 0.61) % 4.5) * 1.1;
    if (c < 2) { // glint sweep along the diagonal
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * Math.sin(c / 2 * Math.PI)})`; ctx.lineWidth = 0.06;
      ctx.beginPath(); if (c <= 1) { ctx.moveTo(x + c, y); ctx.lineTo(x, y + c); } else { ctx.moveTo(x + 1, y + c - 1); ctx.lineTo(x + c - 1, y + 1); } ctx.stroke();
    }
    const tw = Math.pow(Math.max(0, Math.sin(T * 1.3 + sd * 2.1)), 12);
    if (tw > 0.05) { const gx = x + 0.25 + (sd % 3) * 0.22, gy = y + 0.3 + ((sd * 2) % 3) * 0.18, r = 0.09 * tw; ctx.strokeStyle = `rgba(255,255,255,${tw})`; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(gx - r, gy); ctx.lineTo(gx + r, gy); ctx.moveTo(gx, gy - r); ctx.lineTo(gx, gy + r); ctx.stroke(); }
  }
  drawPortal(x, y, pair, T) {
    const ctx = this.x, cx = x + 0.5, cy = y + 0.5, col = PORTAL_COLS[pair % PORTAL_COLS.length];
    const p = 0.5 + 0.5 * Math.sin(T * 3 + pair * 2);
    this.glowDot(cx, cy, 0.68, col, 0.45);
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.82);
    ctx.fillStyle = '#07040f'; ctx.beginPath(); ctx.arc(0, 0, 0.4, 0, Math.PI * 2); ctx.fill();
    this.glowDot(0, 0, 0.4, col, 0.6 + p * 0.3); this.glowDot(0, 0, 0.14, '#ffffff', 0.7 + p * 0.3);
    const dir = pair % 2 ? -1 : 1;
    ctx.rotate(T * 1.8 * dir); ctx.strokeStyle = col; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.rotate(Math.PI * 2 / 3); ctx.lineWidth = 0.045; ctx.beginPath();
      for (let k = 0; k <= 8; k++) { const q = k / 8, a = q * 2.6 * dir, r = 0.06 + q * 0.32; ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.rotate(-T * 3 * dir); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.025; ctx.setLineDash([0.12, 0.09]);
    ctx.beginPath(); ctx.arc(0, 0, 0.43, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = col; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.arc(0, 0, 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (!this.lowQ && Math.random() < 0.06) { const a = Math.random() * 6.28; this.fx.parts.push({ kind: 'spiral', cx, cy, a, r: 0.5, x: cx, y: cy, life: 0.6, t: 0, color: Math.random() < 0.5 ? col : '#ffffff', size: 0.025, vx: 0, vy: 0, g: 0 }); }
  }
  drawBonds(T) {
    const ctx = this.x, s = this.state, ps = s.units.filter((u) => u.alive && u.kind === 'player' && u.team != null);
    ctx.lineCap = 'round';
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j]; if (a.team !== b.team || Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > 2) continue;
      if (!s.teams && !this.sideOf(a.id)) continue;
      const da = this.disp.get(a.id), db = this.disp.get(b.id); if (!da || !db || da.drop || db.drop || da.warp || db.warp || (da.hideUntil && this.time < da.hideUntil) || (db.hideUntil && this.time < db.hideUntil)) continue;
      const mine = this.sideOf(a.id), x1 = da.x + 0.5, y1 = da.y + 0.86, x2 = db.x + 0.5, y2 = db.y + 0.86;
      ctx.globalAlpha = mine ? 0.5 : 0.25; ctx.strokeStyle = a.color; ctx.lineWidth = 0.035;
      ctx.setLineDash([0.12, 0.1]); ctx.lineDashOffset = -T * 0.6;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      if (mine && s.teams) { const k = (T * 0.6) % 1; ctx.globalAlpha = 0.8 * Math.sin(k * Math.PI); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, 0.04, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }
  drawVoid(x, y, T, overlay = false) {
    const ctx = this.x;
    if (!overlay) { ctx.fillStyle = '#050307'; ctx.fillRect(x, y, 1, 1); }
    const f = 0.5 + 0.5 * Math.sin(T * 1.5 + x * 0.7 + y * 0.9);
    ctx.fillStyle = `rgba(255,60,40,${0.04 + f * 0.07})`; ctx.fillRect(x, y, 1, 1);
    const seed = (x * 31 + y * 17) % 10;
    const ey = y + 1 - ((T * 0.3 + seed * 0.1) % 1);
    ctx.fillStyle = `rgba(255,120,60,${0.6 * f})`; ctx.fillRect(x + 0.2 + seed * 0.06, ey, 0.04, 0.04);
  }
  drawCrack(x, y, T) {
    const ctx = this.x;
    const a = 0.45 + 0.35 * Math.sin(T * 6 + (x + y) * 0.4);
    ctx.fillStyle = `rgba(255,50,40,${0.1 + a * 0.12})`; ctx.fillRect(x, y, 1, 1);
    const h = (x * 13 + y * 7) % 5;
    ctx.beginPath(); ctx.moveTo(x + 0.1, y + 0.3 + h * 0.08); ctx.lineTo(x + 0.4, y + 0.5); ctx.lineTo(x + 0.55, y + 0.3); ctx.lineTo(x + 0.9, y + 0.6 - h * 0.05);
    ctx.moveTo(x + 0.4, y + 0.5); ctx.lineTo(x + 0.45, y + 0.9); ctx.moveTo(x + 0.55, y + 0.3); ctx.lineTo(x + 0.62, y + 0.05);
    ctx.strokeStyle = 'rgba(20,4,4,0.8)'; ctx.lineWidth = 0.07; ctx.stroke();
    ctx.strokeStyle = `rgba(255,${120 + a * 80 | 0},70,${0.5 + a * 0.5})`; ctx.lineWidth = 0.03; ctx.stroke();
    if (Math.random() < 0.01) this.fx.burst(x + 0.5, y + 0.5, '#ff6a3d', 1, 0.6, 'up');
    if (!this.lowQ && Math.random() < 0.004) this.fx.burst(x + 0.5, y + 0.9, '#4a4058', 2, 1.2, 'chunk'); // edge crumbling
  }
  drawBramble(x, y) {
    const v = (x * 5 + y * 3) % 3, sway = this.reduced ? 0 : Math.sin(this.time * 1.3 + x + y) * 0.015;
    W10.blitProp(this.x, W10.brambleProp(v), x + sway, y);
  }
  drawShrine(x, y, on, T) {
    const ctx = this.x, cx = x + 0.5, cy = y + 0.5;
    const p = on ? 0.6 + 0.4 * Math.sin(T * 2.5) : 0.15;
    W10.blitProp(ctx, W10.shrineBase(on), x, y);
    if (on) { this.glowDot(cx, cy + 0.02, 0.75, '#7fe0ff', p * 0.8); if (Math.random() < 0.05) this.fx.burst(cx, cy + 0.2, '#9df3ff', 1, 0.5, 'up'); }
    ctx.strokeStyle = on ? `rgba(160,236,255,${0.5 + p * 0.5})` : 'rgba(120,120,150,0.4)'; ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.02, 0.27, 0.24, 0, T * (on ? 0.8 : 0), T * (on ? 0.8 : 0) + Math.PI * 1.5); ctx.stroke();
    // floating crystal
    const bob = on && !this.reduced ? Math.sin(T * 2) * 0.04 : 0, ky = cy - 0.12 + bob;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(cx, cy + 0.06, 0.08 - bob * 0.5, 0.03, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = on ? '#5fd8ff' : '#5a6078'; ctx.beginPath(); ctx.moveTo(cx, ky - 0.2); ctx.lineTo(cx + 0.08, ky - 0.05); ctx.lineTo(cx, ky + 0.06); ctx.lineTo(cx - 0.08, ky - 0.05); ctx.closePath(); ctx.fill();
    ctx.fillStyle = on ? '#e8fdff' : '#8a90a8'; ctx.beginPath(); ctx.moveTo(cx, ky - 0.2); ctx.lineTo(cx + 0.03, ky - 0.05); ctx.lineTo(cx, ky + 0.06); ctx.closePath(); ctx.fill();
    if (on) { ctx.globalCompositeOperation = 'lighter'; this.glowDot(cx, ky - 0.06, 0.3, '#9df3ff', 0.5 + p * 0.3); ctx.globalCompositeOperation = 'source-over'; }
  }
  drawSolid(t, x, y, vis = 1) {
    const ctx = this.x, th = this.theme;
    ctx.globalAlpha = vis;
    const rise = (1 - vis) * 0.6;
    if (t.t === 'wall') {
      if (vis >= 1) W10.blitProp(ctx, W10.wallProp(this, (x * 7 + y * 3) % 3), x, y); else this.drawWall(th, x, y, vis);
    } else if (t.t === 'rubble' && !this.lowQ0) {
      W10.blitProp(ctx, W10.rubbleProp(!!t.built, t.hp === 1 && !t.built, (x * 3 + y) % 3), x, y - rise);
    } else if (t.t === 'chest' && !this.lowQ0) {
      const T = this.time;
      this.glowDot(x + 0.5, y + 0.55, 0.95, '#ffd24d', (0.6 + 0.3 * Math.sin(T * 3)) * vis);
      W10.blitProp(ctx, W10.chestProp(), x, y - rise);
      const gk = (T * 0.5 + x * 0.3) % 2.2; if (gk < 1) { ctx.globalCompositeOperation = 'lighter'; this.glowDot(x + 0.15 + gk * 0.7, y + 0.42 - Math.sin(gk * Math.PI) * 0.12, 0.12, '#fff6d0', Math.sin(gk * Math.PI)); ctx.globalCompositeOperation = 'source-over'; }
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < t.hp ? '#ffd24d' : 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 0.3 + i * 0.15, y + 1.0, 0.1, 0.05); }
      if (Math.random() < 0.05) this.fx.burst(x + 0.5, y + 0.4, '#ffe9a8', 1, 0.6, 'up');
    } else if (t.t === 'crate' && !this.lowQ0) {
      W10.blitProp(ctx, W10.crateProp(), x, y - rise);
    } else if (t.t === 'rubble') {
      const stones = t.built ? [[0.5, 0.55, 0.36]] : [[0.32, 0.62, 0.2], [0.66, 0.6, 0.22], [0.5, 0.38, 0.18]];
      for (const [sx, sy0, r] of stones) {
        const sy = sy0 - rise;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x + sx, y + sy0 + r * 0.6, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = t.built ? '#5b5672' : '#4a4658';
        ctx.beginPath(); ctx.moveTo(x + sx - r, y + sy + r * 0.4); ctx.lineTo(x + sx - r * 0.7, y + sy - r * 0.6); ctx.lineTo(x + sx + r * 0.3, y + sy - r * 0.8); ctx.lineTo(x + sx + r, y + sy - r * 0.1); ctx.lineTo(x + sx + r * 0.8, y + sy + r * 0.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(x + sx - r * 0.7, y + sy - r * 0.6); ctx.lineTo(x + sx + r * 0.3, y + sy - r * 0.8); ctx.lineTo(x + sx, y + sy - r * 0.2); ctx.closePath(); ctx.fill();
      }
      if (t.built) { ctx.strokeStyle = 'rgba(214,176,92,0.4)'; ctx.lineWidth = 0.03; ctx.strokeRect(x + 0.22, y + 0.3, 0.56, 0.4); }
      if (t.hp === 1 && !t.built) { ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.025; ctx.beginPath(); ctx.moveTo(x + 0.4, y + 0.3); ctx.lineTo(x + 0.5, y + 0.5); ctx.lineTo(x + 0.45, y + 0.65); ctx.stroke(); }
    } else if (t.t === 'chest') {
      const T = this.time, b = 0.1, w = 0.8;
      this.glowDot(x + 0.5, y + 0.5, 0.9, '#ffd24d', (0.7 + 0.3 * Math.sin(T * 3)) * vis);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + b + 0.04, y + 0.9, w, 0.12);
      ctx.fillStyle = '#3d2a6e'; ctx.fillRect(x + b, y + 0.55, w, 0.38);
      ctx.fillStyle = '#5a3fa0'; ctx.beginPath(); ctx.moveTo(x + b, y + 0.55); ctx.quadraticCurveTo(x + 0.5, y + 0.1, x + 1 - b, y + 0.55); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 0.05; ctx.strokeRect(x + b, y + 0.55, w, 0.38);
      ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.33); ctx.lineTo(x + 0.5, y + 0.93); ctx.stroke();
      ctx.fillStyle = '#ffd24d'; ctx.fillRect(x + 0.42, y + 0.6, 0.16, 0.14);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < t.hp ? '#ffd24d' : 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 0.3 + i * 0.15, y + 1.0, 0.1, 0.05); }
      if (Math.random() < 0.05) this.fx.burst(x + 0.5, y + 0.4, '#ffe9a8', 1, 0.6, 'up');
    } else if (t.t === 'crate') {
      const b = 0.14, h = 0.24, w = 1 - b * 2;
      const wob = Math.sin(this.time * 2 + x * 3 + y) * 0.01;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + b + 0.04, y + 1 - b - 0.02, w, 0.12);
      ctx.fillStyle = '#5a3a1e'; ctx.fillRect(x + b, y + 1 - b - h - rise, w, h);
      ctx.fillStyle = '#8a5a2e'; ctx.fillRect(x + b, y + b - h + 0.1 - rise + wob, w, w - 0.1);
      ctx.strokeStyle = '#d6b05c'; ctx.lineWidth = 0.035; ctx.strokeRect(x + b + 0.02, y + b - h + 0.12 - rise + wob, w - 0.04, w - 0.14);
      ctx.beginPath(); ctx.moveTo(x + b + 0.02, y + b - h + 0.12 - rise); ctx.lineTo(x + 1 - b - 0.02, y + 1 - b - h - 0.02 - rise); ctx.stroke();
      ctx.fillStyle = '#d6b05c'; ctx.fillRect(x + 0.46, y + 1 - b - h - rise, 0.08, h);
    }
    ctx.globalAlpha = 1;
  }
  drawItem(it, T) {
    const ctx = this.x, cx = it.x + 0.5, cy = it.y + 0.5;
    if (it.k === 'trap') { if (this.sideOf(it.owner, it.team)) this.drawTrap(it, T); return; }
    if (it.k === 'soul') { this.drawSoul(it, T); return; }
    const bob = Math.sin(T * 3 + it.x + it.y) * 0.06;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy + 0.28, 0.18 - bob, 0.06, 0, 0, Math.PI * 2); ctx.fill();
    if (it.k === 'shard') {
      this.glowDot(cx, cy, 0.5, '#9df3ff', 0.85);
      const w = 0.14 * Math.abs(Math.cos(T * 2 + it.x)) + 0.04;
      ctx.save(); ctx.translate(cx, cy - 0.05 + bob);
      ctx.fillStyle = '#5fd8ff'; ctx.beginPath(); ctx.moveTo(0, -0.26); ctx.lineTo(w, -0.04); ctx.lineTo(0, 0.2); ctx.lineTo(-w, -0.04); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d8fbff'; ctx.beginPath(); ctx.moveTo(0, -0.26); ctx.lineTo(w * 0.4, -0.04); ctx.lineTo(0, 0.2); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (Math.random() < 0.02) this.fx.burst(cx, cy, '#d8fbff', 1, 0.4, 'up');
      if (it.n > 1) this.badge(cx + 0.25, cy - 0.25, 'x' + it.n);
    } else if (it.k === 'potion') {
      ctx.save(); ctx.translate(cx, cy + bob);
      ctx.fillStyle = '#ff4d74'; ctx.beginPath(); ctx.arc(0, 0.04, 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd0db'; ctx.fillRect(-0.05, -0.22, 0.1, 0.12);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(-0.05, -0.01, 0.04, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (it.k === 'haste') {
      ctx.save(); ctx.translate(cx, cy + bob);
      ctx.fillStyle = '#ffe04d'; ctx.beginPath(); ctx.moveTo(0.06, -0.26); ctx.lineTo(-0.12, 0.03); ctx.lineTo(0, 0.03); ctx.lineTo(-0.06, 0.26); ctx.lineTo(0.13, -0.05); ctx.lineTo(0.01, -0.05); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (it.k === 'crown') {
      this.glowDot(cx, cy, 1.1, '#ffd24d', 1);
      ctx.save(); ctx.translate(cx, cy - 0.1 + bob * 1.5);
      ctx.strokeStyle = 'rgba(255,230,140,0.5)'; ctx.lineWidth = 0.03;
      for (let i = 0; i < 8; i++) { const a = T * 0.6 + i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3); ctx.lineTo(Math.cos(a) * 0.55, Math.sin(a) * 0.55); ctx.stroke(); }
      this.crownShape(ctx);
      ctx.restore();
      if (Math.random() < 0.08) this.fx.burst(cx, cy, '#ffe9a8', 1, 0.8, 'up');
    }
  }
  drawTrap(it, T) {
    const ctx = this.x, x = it.x, y = it.y;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = 'rgba(255,110,90,0.35)'; ctx.lineWidth = 0.02; ctx.setLineDash([0.08, 0.08]); ctx.strokeRect(x + 0.12, y + 0.12, 0.76, 0.76); ctx.setLineDash([]);
    const a = [x + 0.2, y + 0.62], b = [x + 0.8, y + 0.52];
    ctx.strokeStyle = '#5a5468'; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
    for (const [px, py] of [a, b]) { ctx.beginPath(); ctx.moveTo(px, py + 0.08); ctx.lineTo(px, py - 0.08); ctx.stroke(); }
    ctx.strokeStyle = '#cfd6e6'; ctx.lineWidth = 0.014; ctx.beginPath(); ctx.moveTo(a[0], a[1] - 0.05); ctx.lineTo(b[0], b[1] - 0.05); ctx.stroke();
    const gk = (T * 0.7 + x * 0.3) % 1; ctx.fillStyle = `rgba(255,255,255,${0.8 * Math.sin(gk * Math.PI)})`;
    ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * gk, a[1] - 0.05 + (b[1] - a[1]) * gk, 0.02, 0, Math.PI * 2); ctx.fill();
    const blink = Math.sin(T * 5 + y) > 0.6;
    ctx.fillStyle = blink ? '#ff4d3d' : '#6a1a14'; ctx.beginPath(); ctx.arc(b[0], b[1] - 0.1, 0.03, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
  }
  drawSoul(it, T) {
    const ctx = this.x, u = unitById(this.state, it.id), col = u ? u.color : '#c9a6ff';
    const cx = it.x + 0.5, base = it.y + 0.78, bob = Math.sin(T * 2.4 + it.x) * 0.05;
    const p = 0.5 + 0.5 * Math.sin(T * 3 + it.y);
    ctx.globalAlpha = 0.35 + p * 0.3; ctx.strokeStyle = col; ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.ellipse(cx, base, 0.3 + p * 0.05, 0.1, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    this.glowDot(cx, base - 0.3 + bob, 0.55, col, 0.4 + p * 0.15);
    ctx.save(); ctx.translate(cx, base - 0.12 + bob);
    const f1 = Math.sin(T * 9 + it.x * 3) * 0.035, f2 = Math.sin(T * 7.3 + 1) * 0.03;
    const flame = (sc, fill, a) => {
      ctx.globalAlpha = a; ctx.fillStyle = fill; ctx.beginPath();
      ctx.moveTo(f1 * sc, -0.5 * sc); ctx.quadraticCurveTo((0.26 + f2) * sc, -0.2 * sc, 0.17 * sc, 0.02 * sc);
      ctx.quadraticCurveTo(0, 0.17 * sc, -0.17 * sc, 0.02 * sc); ctx.quadraticCurveTo((-0.26 + f2) * sc, -0.2 * sc, f1 * sc, -0.5 * sc); ctx.fill();
    };
    flame(1, col, 0.7); flame(0.62, '#ffffff', 0.55);
    ctx.globalAlpha = 0.9; ctx.fillStyle = '#0d0b13'; ctx.beginPath(); ctx.arc(-0.05, -0.12, 0.022, 0, Math.PI * 2); ctx.arc(0.05, -0.12, 0.022, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
    if (!this.lowQ && Math.random() < 0.08) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.25, y: base - 0.45 + bob, vx: 0, vy: -0.5, g: -0.2, life: 0.7, t: 0, color: col, size: 0.025, kind: 'spark', rot: 0, vr: 0 });
    const left = Math.max(0, (it.exp ?? this.state.round) - this.state.round);
    this.badge(cx + 0.26, base - 0.62 + bob, String(left), col);
  }
  crownShape(ctx) {
    ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#7a5208'; ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.moveTo(-0.24, 0.12); ctx.lineTo(-0.26, -0.14); ctx.lineTo(-0.12, -0.02); ctx.lineTo(0, -0.2); ctx.lineTo(0.12, -0.02); ctx.lineTo(0.26, -0.14); ctx.lineTo(0.24, 0.12); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(0, 0.04, 0.04, 0, Math.PI * 2); ctx.fill();
  }
  badge(x, y, text, col = '#5fd8ff') { this.x.drawImage(badgeSprite(text, col), x - 0.135, y - 0.135, 0.27, 0.27); }
  glowDot(x, y, r, color, a = 1) { const ctx = this.x, pa = ctx.globalAlpha; ctx.globalAlpha = pa * a; ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = pa; }

  drawUnit(u, d, T) {
    const ctx = this.x, s = this.state;
    let cx = d.x + 0.5, base = d.y + 0.86;
    // lunge / recoil offsets
    if (d.lunge) { const k = (this.time - d.lunge.t0) / d.lunge.dur; if (k >= 1) d.lunge = null; else { const a = k < 0.4 ? -Math.sin(k / 0.4 * Math.PI) * 0.08 : Math.sin((k - 0.4) / 0.6 * Math.PI) * 0.38; cx += d.lunge.dx * a; base += d.lunge.dy * a; } }
    if (d.recoil) { const k = (this.time - d.recoil.t0) / 0.25; if (k >= 1) d.recoil = null; else { const src = unitById(s, d.recoil.src); if (src) { const dx = d.x - src.x, dy = d.y - src.y, l = Math.hypot(dx, dy) || 1; const a = Math.sin(k * Math.PI) * 0.14; cx += dx / l * a; base += dy / l * a; } } }
    let dropY = 0;
    if (d.drop) {
      const k = (this.time - d.drop.t0) / d.drop.dur;
      if (k >= 1) {
        if (!d.drop.landed) {
          d.drop.landed = true; d.squash = 1;
          if (d.drop.boss) { this.fx.bossSlam(cx, base); this.light(cx, base - 0.2, '#a06bff', 3.6, 1); this.shot(d.x, d.y, 1.2, 1); this.kick(14); this.hitstop(0.08); this.sfx('colossus'); this.haptic([80, 40, 120]); }
          else { this.fx.burst(cx, base, '#d9cfb8', d.drop.quiet ? 6 : 14, 2.5, 'dust'); this.fx.ring(cx, base, u.kind === 'hollow' && u.wave ? '#a06bff' : u.color, 1.6, 0.45, 0.06); this.kick(d.drop.quiet ? 1 : 2.5); if (!d.drop.quiet) this.sfx('land'); }
        }
        d.drop = null;
      }
      else dropY = -(1 - k * k) * 8;
    }
    const active = s.active === u.id && !s.over;
    const mine = u.id === this.myId;
    const sk = skinOf(u.skin);
    const dying = !u.alive;
    const boss = !!u.boss, BS = boss ? 1.5 : u.role === 'mite' ? 0.7 : 1;
    // portal warp (shrink into the gate, pop out of its twin)
    let wx = 1, wy = 1;
    if (d.warp) {
      const k = (this.time - d.warp.t0) / (d.warp.out ? 0.16 : 0.3);
      if (d.warp.out) { const q = Math.min(1, k); wx = 1 - q; wy = 1 + q * 0.5; }
      else if (k >= 1) d.warp = null; else { wx = wy = Math.max(0, easeBack(k)); }
    }
    if (wx <= 0.01) return;
    { // A5: soft contact shadow, offset away from the north-west key light; shrinks while airborne
      const air = Math.min(1, d.lift * 0.9 + (dropY < 0 ? -dropY / 8 : 0));
      W10.drawShadow(ctx, cx + 0.04 + d.lift * 0.1, base + 0.01, Math.max(0.1, 0.4 * BS * wx * (1 - air * 0.55)), (dying ? 0.4 : 0.62) * (1 - air * 0.6));
    }
    if (boss && !dying) {
      const p = 0.5 + 0.5 * Math.sin(T * 2.2);
      this.glowDot(cx, base - 0.7, 1.35, '#7a2cff', 0.45 + p * 0.2);
      ctx.strokeStyle = `rgba(176,110,255,${0.5 + p * 0.4})`; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.ellipse(cx, base, 0.62, 0.2, 0, 0, Math.PI * 2); ctx.stroke();
      if (!this.lowQ && Math.random() < 0.3) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.8, y: base - Math.random() * 1.2, vx: (Math.random() - 0.5) * 0.2, vy: -0.6, g: -0.2, life: 0.8, t: 0, color: Math.random() < 0.5 ? '#a06bff' : '#e0c8ff', size: 0.035, kind: 'spark', rot: 0, vr: 0 });
    }
    const atkBuff = !dying && u.buffs && u.buffs.some((b) => b.k === 'atk');
    if (atkBuff) {
      const p = 0.5 + 0.5 * Math.sin(T * 6 + u.id);
      this.glowDot(cx, base - 0.45, 0.85, '#ff3a1a', 0.35 + p * 0.25);
      ctx.strokeStyle = `rgba(255,90,40,${0.45 + p * 0.4})`; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.ellipse(cx, base, 0.44 + p * 0.04, 0.15, 0, 0, Math.PI * 2); ctx.stroke();
      if (Math.random() < (this.lowQ ? 0.1 : 0.25)) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.5, y: base - Math.random() * 0.7, vx: 0, vy: -0.8, g: -0.3, life: 0.5, t: 0, color: Math.random() < 0.5 ? '#ff3a1a' : '#ffb03d', size: 0.03, kind: 'spark', rot: 0, vr: 0 });
    }
    if (d.how === 'ice' && d.moving && Math.random() < 0.6) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.3, y: base, vx: (Math.random() - 0.5) * 0.6, vy: -0.3, g: 1, life: 0.35, t: 0, color: '#e8fbff', size: 0.03, kind: 'spark', rot: 0, vr: 0 });
    if (this.threats && this.threats.includes(u.id) && !dying) {
      const k = 0.5 + 0.5 * Math.sin(T * 7); ctx.strokeStyle = `rgba(255,50,70,${0.5 + k * 0.5})`; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.ellipse(cx, base, 0.5 + k * 0.06, 0.18 + k * 0.02, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (u.kind === 'player') {
      // A5: team ring = dark disc, coloured band, bright inner rim; active piece gets a turning dashed halo + light shaft
      ctx.globalAlpha = 0.32; ctx.fillStyle = '#05040a'; ctx.beginPath(); ctx.ellipse(cx, base, 0.4, 0.14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = active ? 0.8 + 0.2 * Math.sin(T * 6) : 0.9; ctx.strokeStyle = u.color; ctx.lineWidth = active ? 0.075 : 0.055; ctx.stroke();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.015; ctx.beginPath(); ctx.ellipse(cx, base - 0.005, 0.34, 0.11, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      if (active) {
        ctx.globalAlpha = 0.22; ctx.fillStyle = u.color; ctx.beginPath(); ctx.ellipse(cx, base, 0.4, 0.14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.85; ctx.strokeStyle = u.color; ctx.lineWidth = 0.03; ctx.setLineDash([0.12, 0.08]); ctx.lineDashOffset = -T * 0.5;
        ctx.beginPath(); ctx.ellipse(cx, base, 0.5, 0.18, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
        ctx.globalAlpha = 0.5 * (1 - ((T * 1.2) % 1)); const rr = 0.4 + ((T * 1.2) % 1) * 0.35; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.ellipse(cx, base, rr, rr * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
        if (!this.lowQ && !s.over) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.16 + 0.06 * Math.sin(T * 3); const g = this.shaft || (this.shaft = (() => { const c = document.createElement('canvas'); c.width = 16; c.height = 128; const q = c.getContext('2d'), gr = q.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); q.fillStyle = gr; q.fillRect(0, 0, 16, 128); return c; })()); ctx.drawImage(g, cx - 0.32, base - 1.9, 0.64, 1.9); ctx.globalCompositeOperation = 'source-over'; }
      }
      ctx.globalAlpha = 1;
      if (!mine && !dying && u.team != null && this.sideOf(u.id)) { // ally marker: double chevron under the base ring
        const cy = base + 0.2 + Math.sin(T * 3 + u.id) * 0.015;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const [w, c] of [[0.075, 'rgba(8,6,14,0.85)'], [0.035, u.color]]) {
          ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
          ctx.moveTo(cx - 0.11, cy + 0.04); ctx.lineTo(cx, cy - 0.03); ctx.lineTo(cx + 0.11, cy + 0.04);
          ctx.moveTo(cx - 0.11, cy + 0.11); ctx.lineTo(cx, cy + 0.04); ctx.lineTo(cx + 0.11, cy + 0.11); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
    }
    const hone = u.hone ? (u.hone[u.piece] || 0) : 0;
    if (u.piece === 'king' || hone > 0) {
      this.glowDot(cx, base - 0.5, 0.8, u.piece === 'king' ? '#ffd24d' : '#9df3ff', 0.42 + 0.17 * Math.sin(T * 3));
      if (Math.random() < 0.08) this.fx.burst(cx + (Math.random() - 0.5) * 0.5, base - 0.4, u.piece === 'king' ? '#ffe9a8' : '#9df3ff', 1, 0.5, 'up');
    }
    const bob = d.moving ? 0 : Math.sin(T * 2.2 + u.id) * 0.015;
    const pop = d.pop > 0 ? 1 + Math.sin(d.pop * Math.PI) * 0.3 : 1;
    const sq = d.squash > 0 ? Math.sin(d.squash * Math.PI) * 0.18 : 0;
    const stretch = d.how === 'jump' && d.moving ? d.lift * 0.08 : dropY < 0 ? 0.12 : 0;
    ctx.save();
    ctx.translate(cx, base - d.lift + bob + dropY);
    if (d.moving && !this.reduced && (d.how === 'step' || d.how === 'slide' || d.how === 'dash')) ctx.rotate(Math.sin((d.mt || 0) * Math.PI) * 0.11 * Math.sign(d.tx - d.sx)); // lean into the step
    if (!d.moving && !dying && !this.reduced) {
      const ph = T + u.id * 1.7;
      if (u.piece === 'knight') ctx.rotate(Math.sin(ph * 1.3) * 0.035 * (d.face || 1));
      else if (u.piece === 'bishop') ctx.rotate(Math.sin(ph * 0.9) * 0.03);
      else if (u.piece === 'queen' || u.piece === 'king') ctx.translate(0, -Math.abs(Math.sin(ph * 1.1)) * 0.02);
      else if (u.piece === 'pawn' && (ph % 6) < 0.35) ctx.translate(0, -Math.sin(((ph % 6) / 0.35) * Math.PI) * 0.06);
    }
    const breathe = u.piece === 'rook' && !d.moving ? Math.sin(T * 1.6 + u.id) * 0.012 : 0;
    ctx.scale(0.92 * BS * wx * pop * (1 + sq - stretch * 0.5) * (u.piece === 'knight' ? (d.face || 1) : 1), 0.92 * BS * wy * pop * (1 - sq + stretch + breathe));
    if (u.kind === 'hollow') ctx.translate(0, Math.sin(T * 3 + u.id) * 0.04);
    let fl = this.hitFlash.get(u.id) || (dying ? 1 : 0);
    if (d.reviveAt != null) { const rk = 1 - (this.time - d.reviveAt) / 0.7; if (rk <= 0) d.reviveAt = null; else fl = Math.max(fl, rk); }
    const pk = pieceKind(u); // A4: the Colossus has its own model
    if (isAnimatedSkin(u.skin)) drawPiece(ctx, pk, u.skin, { flash: fl, alpha: 1, t: T, outline: mine ? 'rgba(255,255,255,0.22)' : null });
    else {
      const sp = hiSprite(pk, u.skin), S = 1 / 160;
      if (mine) { ctx.globalAlpha = 0.22; ctx.drawImage(hiSprite(pk, u.skin, 'white'), -96 * S * 1.06, -224 * S * 1.03, 192 * S * 1.06, 240 * S * 1.03); ctx.globalAlpha = 1; }
      ctx.drawImage(sp, -96 * S, -224 * S, 192 * S, 240 * S);
      if (fl > 0) { ctx.globalAlpha = Math.min(1, fl); ctx.drawImage(hiSprite(pk, u.skin, 'white'), -96 * S, -224 * S, 192 * S, 240 * S); ctx.globalAlpha = 1; }
    }
    ctx.restore();
    if (!dying && u.buffs && u.buffs.some((b) => b.k === 'def' && !b.bond && b.v > 1)) { // A5: shield dome for DEF buffs
      const p = 0.5 + 0.5 * Math.sin(T * 3 + u.id), h = 1.25 * BS, w = 1.0 * BS, y0 = base - d.lift + dropY;
      ctx.globalAlpha = 0.45 + p * 0.2; ctx.drawImage(W10.shieldDome(), cx - w / 2, y0 - h * 0.86, w, h); ctx.globalAlpha = 1;
    }
    if (Math.random() < 0.07 && u.kind === 'player' && sk.fx !== 'dust') {
      const col = sk.fx === 'ember' ? '#ff8a3d' : sk.fx === 'frost' ? '#d6f7ff' : sk.fx === 'leaf' ? '#8de37a' : sk.fx === 'spark' ? '#00f0ff' : sk.fx === 'star' ? '#d6a6ff' : '#ffe9a8';
      this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.4, y: base - 0.3 - Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.2, vy: -0.4, g: -0.1, life: 0.9, t: 0, color: col, size: 0.025, kind: 'spark', rot: 0, vr: 0 });
    }
    if (u.trail && u.trail !== 'none' && (d.moving || d.lunge) && TRAILS[u.trail]) {
      const TR = TRAILS[u.trail], cols = TR.colors && TR.colors.length ? TR.colors : ['#ffffff'];
      const tk = TR.kind || (u.trail === 'royal' ? 'coin' : u.trail === 'petals' ? 'chunk' : 'spark'), tg = TR.g ?? (u.trail === 'royal' ? 2 : -0.2), ts = TR.size ?? (u.trail === 'petals' ? 0.05 : 0.035), tf = TR.floor ?? u.trail === 'royal';
      for (let i = 0; i < (this.lowQ ? 1 : 2); i++) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.3, y: base - 0.15 - d.lift - Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.4, vy: -0.2 - Math.random() * 0.4, g: tg, life: 0.6 + Math.random() * 0.4, t: 0, color: cols[(Math.random() * cols.length) | 0], size: ts, kind: tk, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, floor: tf ? base : null });
    }
    if (u.kind === 'hollow' && Math.random() < 0.1) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.3, y: base - 0.1, vx: 0, vy: -0.3, g: -0.1, life: 0.8, t: 0, color: '#8f8cff', size: 0.03, kind: 'spark', rot: 0, vr: 0 });
    // attunement crystals orbit
    const tier = Math.floor((u.attune || 0) / 5);
    if (tier > 0 && !dying) {
      d.attunePulse = Math.max(0, (d.attunePulse || 0) - 0.03);
      for (let i = 0; i < tier; i++) {
        const a = T * 1.6 + (i / tier) * Math.PI * 2, rx = 0.46, ry = 0.16;
        const ox = Math.cos(a) * rx, oy = Math.sin(a) * ry;
        const behind = Math.sin(a) < 0;
        ctx.globalAlpha = behind ? 0.45 : 1;
        ctx.save(); ctx.translate(cx + ox, base - 0.45 + oy - d.lift + dropY); const sc = (1 + (d.attunePulse || 0) * 0.6) * (behind ? 0.8 : 1); ctx.scale(sc, sc);
        ctx.fillStyle = '#5fd8ff'; ctx.beginPath(); ctx.moveTo(0, -0.09); ctx.lineTo(0.05, 0); ctx.lineTo(0, 0.08); ctx.lineTo(-0.05, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8fdff'; ctx.beginPath(); ctx.moveTo(0, -0.09); ctx.lineTo(0.02, 0); ctx.lineTo(0, 0.08); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    if (u.kind === 'player' && (u.ult || 0) >= 100 && !dying && Math.random() < 0.18) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.5, y: base - Math.random() * 0.9, vx: 0, vy: -0.6, g: -0.2, life: 0.7, t: 0, color: '#ffd24d', size: 0.03, kind: 'spark', rot: 0, vr: 0 });
    // HP bar + name (deferred so labels sit above everything)
    if (!dying && !(dropY < -0.5) && !(d.warp && d.warp.out)) {
      const L = (this.labels ||= [])[this.nLabels] || (this.labels[this.nLabels] = {});
      L.u = u; L.d = d; L.cx = cx; L.base = base; L.mine = mine; L.active = active; this.nLabels++;
    }
  }
  drawLabel(L, T) {
    const ctx = this.x, { u, d, cx, base, mine, active } = L, boss = !!u.boss, BS = boss ? 1.5 : u.role === 'mite' ? 0.7 : 1;
      const top = base + (PIECE_TOP[pieceKind(u)] || -1) * 0.92 * BS - 0.14 - d.lift;
      const mx = stats(u).maxHp, r = Math.max(0, Math.min(1, d.hp / mx)), gr = Math.max(0, Math.min(1, d.ghost / mx));
      if (boss) {
        const w = 1.4, bx = cx - w / 2, h = 0.12;
        ctx.fillStyle = 'rgba(8,6,14,0.92)'; ctx.fillRect(bx - 0.04, top - 0.04, w + 0.08, h + 0.08);
        ctx.strokeStyle = '#c9a6ff'; ctx.lineWidth = 0.025; ctx.strokeRect(bx - 0.04, top - 0.04, w + 0.08, h + 0.08);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, top, w * gr, h);
        ctx.fillStyle = '#9b4dff'; ctx.fillRect(bx, top, w * r, h);
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(bx, top, w * r, 0.03);
        ctx.fillStyle = 'rgba(8,6,14,0.6)'; for (let i = 1; i < 10; i++) ctx.fillRect(bx + w * i / 10 - 0.006, top, 0.012, h);
        ctx.font = '800 0.2px Cinzel, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(8,6,14,0.9)'; ctx.fillText(u.name.toUpperCase(), cx + 0.015, top - 0.05 + 0.015);
        ctx.fillStyle = '#e0c8ff'; ctx.fillText(u.name.toUpperCase(), cx, top - 0.05);
        return;
      }
      // A5: bevelled HP bar with held damage chunk, hit flash, heal glow and 25-HP ticks
      const w = 0.72, bx = cx - w / 2, bh = 0.075;
      ctx.fillStyle = 'rgba(8,6,14,0.9)'; ctx.fillRect(bx - 0.03, top - 0.03, w + 0.06, bh + 0.06);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(bx, top, w, bh);
      if (gr > r) { ctx.fillStyle = d.chipHold > 0 ? '#fff4e0' : '#ff8a6a'; ctx.fillRect(bx + w * r, top, w * (gr - r), bh); }
      const hc = u.kind === 'hollow' ? (u.wave ? '#b49cf0' : '#a7a4d6') : r > 0.5 ? '#5cff9d' : r > 0.25 ? '#ffd24d' : '#ff4d6d';
      ctx.fillStyle = hc; ctx.fillRect(bx, top, w * r, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx, top + bh * 0.62, w * r, bh * 0.38);
      if (mx > 0 && mx <= 400) { ctx.fillStyle = 'rgba(8,6,14,0.55)'; for (let hp = 25; hp < mx; hp += 25) ctx.fillRect(bx + w * hp / mx - 0.004, top, 0.008, bh); }
      if (d.barFlash > 0) { ctx.globalAlpha = d.barFlash; ctx.fillStyle = '#ffffff'; ctx.fillRect(bx - 0.03, top - 0.03, w + 0.06, bh + 0.06); ctx.globalAlpha = 1; }
      if (d.healGlow > 0) { ctx.globalAlpha = d.healGlow * 0.6; ctx.fillStyle = '#b8ffd6'; ctx.fillRect(bx, top, w * r, bh); ctx.globalAlpha = 1; }
      { const st = W10.statusesOf(this.state, u); for (let i = 0; i < st.length && i < 4; i++) { const sz = 0.17, ix = bx - 0.05 - sz - i * (sz + 0.02), iy = top + bh / 2 - sz / 2 + (st[i] === 'root' ? Math.sin(T * 6) * 0.01 : 0); ctx.drawImage(W10.statusIcon(st[i]), ix, iy, sz, sz); } }
      if (u.wave) { ctx.fillStyle = '#a06bff'; ctx.beginPath(); ctx.moveTo(bx - 0.1, top + 0.035); ctx.lineTo(bx - 0.05, top - 0.02); ctx.lineTo(bx, top + 0.035); ctx.lineTo(bx - 0.05, top + 0.09); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(bx, top, w * r, 0.02);
      if (u.kind === 'player') {
        ctx.fillStyle = u.color; ctx.fillRect(bx - 0.025, top - 0.055, 0.14, 0.03);
        if (this.z > 34) {
          ctx.font = `700 0.17px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(8,6,14,0.85)'; ctx.fillText(u.name, cx + 0.012, top - 0.03 + 0.012);
          ctx.fillStyle = mine ? '#ffffff' : '#d8d2e8'; ctx.fillText(u.name, cx, top - 0.03);
        }
        if (u.shards > 0) this.badge(cx + 0.44, top + 0.03, String(u.shards));
        if (u.piece === 'king') { ctx.save(); ctx.translate(cx, top - (this.z > 34 ? 0.34 : 0.16) + Math.sin(T * 2) * 0.03); ctx.scale(0.7, 0.7); this.crownShape(ctx); ctx.restore(); }
      }
      if (active) {
        const ay = top - (this.z > 34 ? 0.45 : 0.25) - Math.abs(Math.sin(T * 4)) * 0.12 - (u.piece === 'king' ? 0.2 : 0);
        if (!mine) { ctx.globalAlpha = 0.85; ctx.scale(1, 1); }
        ctx.strokeStyle = 'rgba(8,6,14,0.85)'; ctx.lineWidth = 0.04; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(cx - 0.12, ay - 0.1); ctx.lineTo(cx + 0.12, ay - 0.1); ctx.lineTo(cx, ay + 0.04); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = mine ? '#ffe3a1' : u.color || '#ffffff'; ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(cx - 0.12, ay - 0.1); ctx.lineTo(cx + 0.12, ay - 0.1); ctx.lineTo(cx, ay + 0.04); ctx.closePath(); ctx.fill();
      }
  }

  drawOverlay(T) {
    const ov = this.overlay ? { ...this.overlay } : (this.danger ? {} : null); if (!ov) return;
    if (this.danger) ov.danger = this.danger;
    const ctx = this.x;
    const pulse = 0.5 + 0.5 * Math.sin(T * 5);
    if (ov.moves) for (const m of ov.moves) {
      const wave = 0.5 + 0.5 * Math.sin(T * 4 - (Math.abs(m.x - (ov.from ? ov.from.x : 0)) + Math.abs(m.y - (ov.from ? ov.from.y : 0))) * 0.8);
      ctx.fillStyle = `rgba(93,200,255,${0.1 + wave * 0.12})`; ctx.fillRect(m.x + 0.06, m.y + 0.06, 0.88, 0.88);
      ctx.strokeStyle = 'rgba(127,224,255,0.75)'; ctx.lineWidth = 0.03; ctx.strokeRect(m.x + 0.1, m.y + 0.1, 0.8, 0.8);
      ctx.fillStyle = 'rgba(200,240,255,0.9)'; ctx.beginPath(); ctx.arc(m.x + 0.5, m.y + 0.5, 0.06 + wave * 0.03, 0, Math.PI * 2); ctx.fill();
    }
    if (ov.danger) for (const t of ov.danger) { ctx.fillStyle = 'rgba(255,60,80,0.16)'; ctx.fillRect(t.x + 0.03, t.y + 0.03, 0.94, 0.94); ctx.strokeStyle = 'rgba(255,90,100,0.35)'; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(t.x + 0.1, t.y + 0.9); ctx.lineTo(t.x + 0.9, t.y + 0.1); ctx.moveTo(t.x + 0.1, t.y + 0.5); ctx.lineTo(t.x + 0.5, t.y + 0.1); ctx.moveTo(t.x + 0.5, t.y + 0.9); ctx.lineTo(t.x + 0.9, t.y + 0.5); ctx.stroke(); }
    if (ov.hover) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.05; this.corners(ov.hover.x + 0.05, ov.hover.y + 0.05, 0.9); }
    if (ov.opts) {
      for (const o of ov.opts) {
        const sel = ov.preview === o;
        if (!sel) for (const t of o.tiles) { ctx.fillStyle = o.mult > 0 ? 'rgba(255,93,93,0.07)' : 'rgba(180,140,255,0.07)'; ctx.fillRect(t.x + 0.06, t.y + 0.06, 0.88, 0.88); }
        const a = o.anchor;
        ctx.strokeStyle = o.mult > 0 ? `rgba(255,120,100,${0.6 + pulse * 0.4})` : `rgba(201,166,255,${0.6 + pulse * 0.4})`;
        ctx.lineWidth = 0.05;
        const inset = 0.08 + pulse * 0.04;
        this.corners(a.x + inset, a.y + inset, 1 - inset * 2);
        if (o.hits && o.hits.length) { ctx.fillStyle = 'rgba(255,80,80,0.9)'; ctx.beginPath(); ctx.arc(a.x + 0.5, a.y + 0.5, 0.06, 0, Math.PI * 2); ctx.fill(); }
      }
      if (ov.preview) {
        const o = ov.preview;
        const g = ctx.createLinearGradient(0, 0, 1, 1); // one gradient per frame, shifted per tile
        const c = o.mult > 0 ? '255,70,70' : '180,140,255';
        g.addColorStop(0, `rgba(${c},${0.25 + pulse * 0.2})`); g.addColorStop(1, `rgba(${c},${0.45 + pulse * 0.15})`);
        for (const t of o.tiles) {
          ctx.translate(t.x, t.y); ctx.fillStyle = g; ctx.fillRect(0.04, 0.04, 0.92, 0.92); ctx.translate(-t.x, -t.y);
          ctx.strokeStyle = o.mult > 0 ? '#ff8a7a' : '#d9c6ff'; ctx.lineWidth = 0.035; ctx.strokeRect(t.x + 0.06, t.y + 0.06, 0.88, 0.88);
        }
      }
    }
  }
  corners(x, y, w) {
    const ctx = this.x, l = w * 0.28;
    ctx.beginPath();
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x + w, y + w - l); ctx.lineTo(x + w, y + w); ctx.lineTo(x + w - l, y + w);
    ctx.moveTo(x + l, y + w); ctx.lineTo(x, y + w); ctx.lineTo(x, y + w - l);
    ctx.stroke();
  }
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

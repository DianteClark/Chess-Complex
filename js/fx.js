// World-space effects system (1 unit = 1 tile). Shared by the board renderer, store previews and tools/vfx.html.
// 10.0 core: pooled particles with a hard cap, additive glow sprites cached per colour, ribbons, sparks with
// gravity and bounce, soft smoke/dust, distortion shock rings, lingering floor decals, impact frames.
// Public API is backwards compatible with 5.0 (render.js and store.js push raw particles into fx.parts).
import { drawPiece, skinOf } from './pieces.js';

const SPR = 80; // sprite pixels per tile
const spriteCache = new Map();
export function pieceSprite(piece, skin, tint = null) {
  const key = piece + '|' + skin + '|' + tint;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const c = document.createElement('canvas');
  c.width = 96; c.height = 120;
  const x = c.getContext('2d');
  x.translate(48, 112); x.scale(SPR * 0.92, SPR * 0.92);
  drawPiece(x, piece, skin, {});
  if (tint) {
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    if (tint === 'gold') { const g = x.createLinearGradient(0, 0, 96, 120); g.addColorStop(0, 'rgba(255,240,170,0.85)'); g.addColorStop(0.5, 'rgba(230,170,40,0.85)'); g.addColorStop(1, 'rgba(120,70,10,0.9)'); x.fillStyle = g; }
    else if (tint === 'ash') x.fillStyle = 'rgba(30,20,18,0.85)';
    else if (tint === 'white') x.fillStyle = 'rgba(255,255,255,1)';
    else x.fillStyle = tint;
    x.fillRect(0, 0, 96, 120);
  }
  if (spriteCache.size > 160) spriteCache.clear();
  spriteCache.set(key, c);
  return c;
}

// High-res static sprites for the board renderer (160 px per tile).
const hiCache = new Map();
export function hiSprite(piece, skin, tint = null) {
  const key = piece + '|' + skin + '|' + tint;
  let c = hiCache.get(key); if (c) { hiCache.delete(key); hiCache.set(key, c); return c; } // LRU touch
  if (hiCache.size >= 64) hiCache.delete(hiCache.keys().next().value); // cap ~11 MB: bots roll random skins every match
  c = document.createElement('canvas'); c.width = 192; c.height = 240;
  const x = c.getContext('2d');
  x.translate(96, 224); x.scale(160, 160);
  drawPiece(x, piece, skin, {});
  if (tint) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = tint === 'white' ? '#ffffff' : tint; x.fillRect(0, 0, 192, 240); }
  hiCache.set(key, c);
  return c;
}

// ---------- helpers ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const TAU = Math.PI * 2;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const PC = new Map();
function parseCol(c) {
  let v = PC.get(c); if (v) return v;
  let r = 255, g = 255, b = 255, a = 1;
  if (typeof c === 'string' && c[0] === '#') {
    let h = c.slice(1); if (h.length <= 4) h = [...h].map((q) => q + q).join('');
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); if (h.length >= 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else if (typeof c === 'string') { const m = c.match(/[\d.]+/g); if (m && m.length >= 3) { r = +m[0]; g = +m[1]; b = +m[2]; if (m[3] != null) a = +m[3]; } }
  v = [r, g, b, a]; if (PC.size > 400) PC.clear(); PC.set(c, v); return v;
}
const rgba = (c, a = 1) => { const [r, g, b, a0] = parseCol(c); return `rgba(${r | 0},${g | 0},${b | 0},${Math.max(0, Math.min(1, a * a0)).toFixed(3)})`; };
const mix = (c, d, k) => { const p = parseCol(c), q = parseCol(d); return `rgb(${(p[0] + (q[0] - p[0]) * k) | 0},${(p[1] + (q[1] - p[1]) * k) | 0},${(p[2] + (q[2] - p[2]) * k) | 0})`; };
function cache(map, key, make, max = 96) { let s = map.get(key); if (s) return s; s = make(); if (map.size > max) map.clear(); map.set(key, s); return s; }

// ---------- cached sprites ----------
const GLOW = new Map(), SOFT = new Map(), FLARE = new Map(), SHOCK = new Map(), PILLAR = new Map(), DECAL = new Map(), SHARDS = new WeakMap(), HALVES = new WeakMap();
function glowSprite(c) { // additive light: white-hot core tinted by colour
  return cache(GLOW, c, () => {
    const s = mk(64, 64), x = s.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, rgba(mix(c, '#ffffff', 0.75), 1)); g.addColorStop(0.16, rgba(mix(c, '#ffffff', 0.3), 0.9));
    g.addColorStop(0.42, rgba(c, 0.32)); g.addColorStop(0.7, rgba(c, 0.08)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return s;
  });
}
function softSprite(c) { // smoke / dust puff, normal blend
  return cache(SOFT, c, () => {
    const s = mk(64, 64), x = s.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, rgba(c, 0.6)); g.addColorStop(0.45, rgba(c, 0.32)); g.addColorStop(0.8, rgba(c, 0.07)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return s;
  });
}
function flareSprite(c) { // star-shaped lens flare
  return cache(FLARE, c, () => {
    const s = mk(128, 128), x = s.getContext('2d');
    x.globalCompositeOperation = 'lighter';
    x.drawImage(glowSprite(c), 24, 24, 80, 80);
    const spike = (len, w, a) => { x.save(); x.translate(64, 64); x.rotate(a); const g = x.createLinearGradient(-len, 0, len, 0); g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.5, rgba(mix(c, '#ffffff', 0.7), 1)); g.addColorStop(1, rgba(c, 0)); x.fillStyle = g; x.beginPath(); x.moveTo(-len, 0); x.lineTo(0, -w); x.lineTo(len, 0); x.lineTo(0, w); x.closePath(); x.fill(); x.restore(); };
    spike(64, 3.2, 0); spike(44, 2.6, Math.PI / 2); spike(26, 1.6, Math.PI / 4); spike(26, 1.6, -Math.PI / 4);
    return s;
  });
}
function shockSprite(color) {
  return cache(SHOCK, color, () => {
    const c = mk(128, 128), x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 30, 64, 64, 64); g.addColorStop(0, rgba(color, 0)); g.addColorStop(0.72, rgba(color, 0.55)); g.addColorStop(0.86, rgba(mix(color, '#ffffff', 0.5), 1)); g.addColorStop(1, rgba(color, 0));
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c;
  }, 64);
}
function pillarSprite(color) {
  return cache(PILLAR, color, () => {
    const c = mk(32, 256), x = c.getContext('2d');
    const v = x.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, rgba(color, 0)); v.addColorStop(0.55, rgba(color, 0.55)); v.addColorStop(0.92, rgba(mix(color, '#ffffff', 0.4), 0.95)); v.addColorStop(1, '#ffffff');
    x.fillStyle = v; x.fillRect(0, 0, 32, 256);
    x.globalCompositeOperation = 'destination-in';
    const h = x.createLinearGradient(0, 0, 32, 0); h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.3, 'rgba(0,0,0,0.7)'); h.addColorStop(0.5, 'rgba(0,0,0,1)'); h.addColorStop(0.7, 'rgba(0,0,0,0.7)'); h.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = h; x.fillRect(0, 0, 32, 256); return c;
  }, 64);
}
// floor decals: scorch, crack, frost, rune, splash, soft, petals. Seeded variants so marks don't repeat.
function seeded(n) { let s = n * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
function decalSprite(type, color, v = 0) {
  return cache(DECAL, type + '|' + color + '|' + v, () => {
    const S = 128, c = mk(S, S), x = c.getContext('2d'), R = seeded(v * 7 + type.length * 13 + 1), m = S / 2;
    if (type === 'scorch') {
      const g = x.createRadialGradient(m, m, 0, m, m, m); g.addColorStop(0, rgba(color, 0.9)); g.addColorStop(0.45, rgba(color, 0.65)); g.addColorStop(0.75, rgba(color, 0.2)); g.addColorStop(1, rgba(color, 0));
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      x.fillStyle = rgba(color, 0.35); for (let i = 0; i < 14; i++) { const a = R() * TAU, d = m * (0.45 + R() * 0.35), r = m * (0.08 + R() * 0.14); x.beginPath(); x.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, r, 0, TAU); x.fill(); }
      x.strokeStyle = rgba(color, 0.5); x.lineCap = 'round'; for (let i = 0; i < 16; i++) { const a = R() * TAU, d0 = m * 0.3, d1 = m * (0.6 + R() * 0.38); x.lineWidth = 1 + R() * 2.5; x.beginPath(); x.moveTo(m + Math.cos(a) * d0, m + Math.sin(a) * d0); x.lineTo(m + Math.cos(a) * d1, m + Math.sin(a) * d1); x.stroke(); }
    } else if (type === 'crack') {
      const g = x.createRadialGradient(m, m, 0, m, m, m * 0.35); g.addColorStop(0, rgba(color, 0.7)); g.addColorStop(1, rgba(color, 0)); x.fillStyle = g; x.fillRect(0, 0, S, S);
      x.strokeStyle = rgba(color, 0.9); x.lineCap = 'round'; x.lineJoin = 'round';
      const branch = (px, py, a, len, w, depth) => { let cx = px, cy = py; x.lineWidth = w; x.beginPath(); x.moveTo(cx, cy); const segs = 4 + ((R() * 3) | 0); for (let i = 0; i < segs; i++) { a += (R() - 0.5) * 0.9; const l = len / segs; cx += Math.cos(a) * l; cy += Math.sin(a) * l; x.lineTo(cx, cy); if (depth < 2 && R() < 0.35) { x.stroke(); branch(cx, cy, a + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), len * 0.45, w * 0.6, depth + 1); x.lineWidth = w; x.beginPath(); x.moveTo(cx, cy); } } x.stroke(); };
      const n = 6 + ((R() * 3) | 0); for (let i = 0; i < n; i++) branch(m, m, (i / n) * TAU + R() * 0.5, m * (0.6 + R() * 0.35), 3.2, 0);
    } else if (type === 'frost') {
      const g = x.createRadialGradient(m, m, 0, m, m, m); g.addColorStop(0, rgba(color, 0.55)); g.addColorStop(0.6, rgba(color, 0.22)); g.addColorStop(1, rgba(color, 0)); x.fillStyle = g; x.fillRect(0, 0, S, S);
      x.strokeStyle = rgba('#ffffff', 0.85); x.lineCap = 'round';
      const n = 9; for (let i = 0; i < n; i++) { const a = (i / n) * TAU + R() * 0.3, L = m * (0.55 + R() * 0.4); x.lineWidth = 2; x.beginPath(); x.moveTo(m, m); x.lineTo(m + Math.cos(a) * L, m + Math.sin(a) * L); x.stroke(); x.lineWidth = 1.2; for (let j = 1; j < 4; j++) { const d = L * j / 4, bx = m + Math.cos(a) * d, by = m + Math.sin(a) * d, bl = L * 0.22 * (1 - j / 5); for (const s of [-0.7, 0.7]) { x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + Math.cos(a + s) * bl, by + Math.sin(a + s) * bl); x.stroke(); } } }
    } else if (type === 'rune') {
      x.strokeStyle = rgba(color, 1); x.fillStyle = rgba(color, 1); x.lineWidth = 2.4;
      x.beginPath(); x.arc(m, m, m * 0.94, 0, TAU); x.stroke(); x.lineWidth = 1.4; x.beginPath(); x.arc(m, m, m * 0.8, 0, TAU); x.stroke(); x.beginPath(); x.arc(m, m, m * 0.42, 0, TAU); x.stroke();
      for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, r0 = m * 0.82, r1 = m * (i % 3 ? 0.88 : 0.93); x.beginPath(); x.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0); x.lineTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1); x.stroke(); }
      x.lineWidth = 1.8; for (const off of [0, Math.PI]) { x.beginPath(); for (let i = 0; i < 3; i++) { const a = off + (i / 3) * TAU - Math.PI / 2; x[i ? 'lineTo' : 'moveTo'](m + Math.cos(a) * m * 0.78, m + Math.sin(a) * m * 0.78); } x.closePath(); x.stroke(); }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2, r = m * 0.61; x.beginPath(); x.arc(m + Math.cos(a) * r, m + Math.sin(a) * r, 3, 0, TAU); x.fill(); }
    } else if (type === 'splash') {
      x.fillStyle = rgba(color, 0.5); for (let i = 0; i < 18; i++) { const a = R() * TAU, d = m * R() * 0.6, r = m * (0.12 + R() * 0.22); x.beginPath(); x.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, r, 0, TAU); x.fill(); }
      x.fillStyle = rgba('#ffffff', 0.25); for (let i = 0; i < 6; i++) { const a = R() * TAU, d = m * R() * 0.5; x.beginPath(); x.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, 2 + R() * 4, 0, TAU); x.fill(); }
    } else if (type === 'petals') {
      for (let i = 0; i < 22; i++) { const a = R() * TAU, d = m * Math.sqrt(R()) * 0.85; x.save(); x.translate(m + Math.cos(a) * d, m + Math.sin(a) * d); x.rotate(R() * TAU); x.fillStyle = rgba(R() < 0.5 ? color : mix(color, '#ffffff', 0.5), 0.85); x.beginPath(); x.ellipse(0, 0, 5, 2.6, 0, 0, TAU); x.fill(); x.restore(); }
    } else { // soft
      const g = x.createRadialGradient(m, m, 0, m, m, m); g.addColorStop(0, rgba(color, 1)); g.addColorStop(0.7, rgba(color, 0.8)); g.addColorStop(1, rgba(color, 0)); x.fillStyle = g; x.fillRect(0, 0, S, S);
    }
    return c;
  }, 120);
}
// Irregular triangular shards cut from a piece sprite (cached per sprite, so a death costs no canvas work twice).
function shardSet(img, lowQ) {
  let set = SHARDS.get(img); if (set && set[lowQ ? 1 : 0]) return set[lowQ ? 1 : 0];
  if (!set) { set = []; SHARDS.set(img, set); }
  const cols = lowQ ? 3 : 4, rows = lowQ ? 3 : 5, W = img.width, H = img.height, cw = W / cols, ch = H / rows;
  const jit = []; for (let r = 0; r <= rows; r++) { jit[r] = []; for (let c = 0; c <= cols; c++) jit[r][c] = [c * cw + (c > 0 && c < cols ? rnd(-0.3, 0.3) * cw : 0), r * ch + (r > 0 && r < rows ? rnd(-0.3, 0.3) * ch : 0)]; }
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p00 = jit[r][c], p10 = jit[r][c + 1], p01 = jit[r + 1][c], p11 = jit[r + 1][c + 1];
    const tris = (r + c) % 2 ? [[p00, p10, p11], [p00, p11, p01]] : [[p00, p10, p01], [p10, p11, p01]];
    for (const t of tris) {
      const minX = Math.floor(Math.min(t[0][0], t[1][0], t[2][0])), minY = Math.floor(Math.min(t[0][1], t[1][1], t[2][1]));
      const maxX = Math.ceil(Math.max(t[0][0], t[1][0], t[2][0])), maxY = Math.ceil(Math.max(t[0][1], t[1][1], t[2][1]));
      const w = Math.max(2, maxX - minX), h = Math.max(2, maxY - minY);
      // skip empty (transparent) shards cheaply by sampling the sprite centre region later in draw; keep all for simplicity
      const s = mk(w, h), x = s.getContext('2d');
      x.beginPath(); x.moveTo(t[0][0] - minX, t[0][1] - minY); x.lineTo(t[1][0] - minX, t[1][1] - minY); x.lineTo(t[2][0] - minX, t[2][1] - minY); x.closePath();
      x.save(); x.clip(); x.drawImage(img, -minX, -minY); x.restore();
      x.globalCompositeOperation = 'source-atop'; x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 1.5; x.stroke();
      out.push({ c: s, cx: minX + w / 2, cy: minY + h / 2, w, h });
    }
  }
  set[lowQ ? 1 : 0] = out; return out;
}
function halfSet(img) { // left / right halves for a clean cleave
  let h = HALVES.get(img); if (h) return h;
  h = [0, 1].map((side) => { const s = mk(img.width, img.height), x = s.getContext('2d'); x.beginPath(); if (side === 0) { x.moveTo(0, 0); x.lineTo(img.width * 0.58, 0); x.lineTo(img.width * 0.42, img.height); x.lineTo(0, img.height); } else { x.moveTo(img.width * 0.58, 0); x.lineTo(img.width, 0); x.lineTo(img.width, img.height); x.lineTo(img.width * 0.42, img.height); } x.closePath(); x.clip(); x.drawImage(img, 0, 0); return s; });
  HALVES.set(img, h); return h;
}

// Finisher lengths (seconds until the piece is fully gone), for previews and tools.
export const FINISHER_LEN = { shatter: 1.1, inferno: 1.6, lightning: 1.3, voidrift: 1.4, midas: 1.6, starfall: 1.5, soulfire: 1.9, coronation: 1.6, confetti: 1.6, frozen: 1.6, ascend: 1.9,
  judgement: 1.9, supernova: 2.0, glitch: 1.5, sakura: 2.0, riptide: 1.8, reaper: 1.9, cyclone: 1.9, finale: 2.1, resign: 2.0, phoenix: 2.1, checkmate: 1.9 };

// Particle defaults: every field a kind might read, so recycled objects never leak state.
const DEF = { x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1.5, life: 0.5, t: 0, color: '#ffffff', size: 0.04, kind: 'spark', rot: 0, vr: 0, floor: null, bounce: 0.35, c0: null, c1: null, cx: 0, cy: 0, a: 0, r: 0, va: 0, rg: 0, rise: 0, ax: 0, ay: 0, bx: 0, by: 0, off: 0, ph: 0, wind: 0, al: 1, px: null, py: null, pv: false };
const NORMAL = new Set(['chunk', 'coin', 'dust', 'smoke', 'petal', 'shard', 'confetti', 'bubble', 'tile']);

export class FX {
  constructor() { this.pool = []; this.rr = 0; this.reset(); }
  reset() {
    this.parts = []; this.shards = []; this.rings = []; this.beams = []; this.bolts = []; this.flashes = [];
    this.meteors = []; this.fireworks = []; this.shocks = []; this.falls = []; this.pillars = []; this.decals = []; this.slashes = []; this.projs = []; this.implodes = []; this.glyphs = []; this.thrusts = [];
    this.ribbons = []; this.flares = []; this.lights = []; this.runes = []; this.frames = []; this.spikes = []; this.halves = []; this.topples = []; this.glitches = []; this.swords = []; this.birds = []; this.funnels = []; this.giants = [];
    this.screenFlash = 0; this.flashColor = '#ffffff'; this.time = 0; this.pending = []; this.crowns = []; this.impactKick = 0;
  }
  after(t, fn) { if (t <= 0) fn(); else this.pending.push({ at: this.time + t, fn }); }
  get calm() { if (this.reduced != null) return !!this.reduced; return typeof document !== 'undefined' && !!document.body && document.body.classList.contains('reduced'); }
  get capN() { return this.cap || (this.lowQ ? 260 : 700); }
  n(k) { const room = this.parts.length / this.capN; let m = this.lowQ ? 0.5 : 1; if (room > 0.7) m *= 0.5; return Math.max(1, Math.round(k * m)); }
  kickCam(n) { this.impactKick = (this.impactKick || 0) + n; }

  // ---------- particle core ----------
  spawn(o) {
    let q;
    const P = this.parts;
    if (P.length >= this.capN) { this.rr = (this.rr + 1) % P.length; q = P[this.rr]; } // hard cap: overwrite round-robin, never grow
    else { q = this.pool.pop() || {}; P.push(q); }
    Object.assign(q, DEF, o); return q;
  }
  burst(x, y, color, n, sp, kind = 'spark', extra = {}) {
    n = this.n(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = (0.35 + Math.random()) * sp;
      const heavy = kind === 'chunk' || kind === 'coin' || kind === 'shard' || kind === 'confetti' || kind === 'ember';
      this.spawn({
        x, y, vx: Math.cos(a) * v, vy: kind === 'up' || kind === 'fire' ? -Math.random() * sp - 0.4 : kind === 'smoke' ? -rnd(0.2, 0.6) : Math.sin(a) * v - (heavy ? 2.4 : 0.5),
        g: kind === 'up' ? -0.4 : kind === 'fire' ? -1.2 : heavy ? 9 : kind === 'dust' ? 0.3 : kind === 'smoke' ? -0.3 : kind === 'petal' ? 0.6 : kind === 'bubble' ? -1.4 : 2.6,
        life: (kind === 'fire' ? 0.5 : kind === 'smoke' ? 0.9 : kind === 'petal' ? 1.2 : 0.35) + Math.random() * 0.55, color,
        size: kind === 'chunk' ? rnd(0.06, 0.13) : kind === 'dust' ? rnd(0.08, 0.14) : kind === 'smoke' ? rnd(0.12, 0.2) : kind === 'fire' ? rnd(0.06, 0.12) : kind === 'coin' ? rnd(0.045, 0.07) : kind === 'shard' ? rnd(0.05, 0.1) : kind === 'petal' ? rnd(0.05, 0.08) : rnd(0.03, 0.065),
        kind, rot: Math.random() * 6, vr: rnd(-12, 12), floor: heavy ? y + rnd(0.15, 0.35) : null, ph: Math.random() * 6, drag: kind === 'petal' ? 2.5 : 1.5, wind: kind === 'petal' ? 2 : 0, ...extra,
      });
    }
  }
  // directional spray (sparks off a hit), ang in radians, spread in radians
  spray(x, y, color, n, sp, ang, spread = 0.8, kind = 'spark', extra = {}) {
    n = this.n(n);
    for (let i = 0; i < n; i++) { const a = ang + rnd(-spread, spread), v = sp * rnd(0.4, 1.1); this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - rnd(0.5, 1.5), g: 7, life: rnd(0.35, 0.7), color, size: rnd(0.025, 0.05), kind, floor: y + rnd(0.3, 0.5), bounce: 0.45, drag: 1.2, ...extra }); }
  }
  // particles drawn inward to a point (anticipation / charge-up)
  gather(x, y, color, n = 16, r = 1.2, life = 0.35) {
    n = this.n(n);
    for (let i = 0; i < n; i++) this.spawn({ kind: 'spiral', cx: x, cy: y, a: Math.random() * TAU, r: r * rnd(0.6, 1.1), life: life * rnd(0.8, 1), color: i % 3 ? color : '#ffffff', size: rnd(0.03, 0.055), t: -Math.random() * life * 0.3 });
  }
  orbit(x, y, color, n = 8, r = 0.4, life = 0.8, rise = 0, va = 6) {
    n = this.n(n);
    for (let i = 0; i < n; i++) this.spawn({ kind: 'orbit', cx: x, cy: y, a: (i / n) * TAU, r, va: va * (Math.random() < 0.5 ? 1 : 1), rise, life, color: i % 2 ? color : '#ffffff', size: rnd(0.03, 0.05) });
  }
  smoke(x, y, color = '#3a3440', n = 6, sp = 0.6, life = 1.1) { n = this.n(n); for (let i = 0; i < n; i++) this.spawn({ kind: 'smoke', x: x + rnd(-0.2, 0.2), y: y + rnd(-0.1, 0.1), vx: rnd(-sp, sp), vy: -rnd(0.2, 0.7), g: -0.25, drag: 1.2, life: life * rnd(0.7, 1.2), color, size: rnd(0.14, 0.24) }); }

  // ---------- primitives (5.0 API) ----------
  ring(x, y, color, r = 1.5, life = 0.6, w = 0.08, delay = 0, inward = false) { this.rings.push({ x, y, color, r, life, w, t: -delay, inward }); if (this.rings.length > 60) this.rings.shift(); }
  shock(x, y, color, r = 1.2, life = 0.35, distort = r >= 2.4) { this.shocks.push({ x, y, color, r, life, t: 0, distort }); if (this.shocks.length > 30) this.shocks.shift(); }
  flashTile(x, y, color, life = 0.45, delay = 0) { this.flashes.push({ x, y, color, life, t: -delay }); if (this.flashes.length > 120) this.flashes.shift(); }
  beam(a, b, color, w = 0.3, life = 0.4) { this.beams.push({ a, b, color, w, life, t: 0, ph: Math.random() * 6 }); }
  pillar(x, y, color, w = 0.7, life = 1.0, h = 7) { this.pillars.push({ x, y, color, w, life, h, t: 0 }); if (!this.lowQ) this.light(x, y, color, w * 2.4, life * 0.8); }
  slash(x, y, color, ang = -0.6, r = 0.45, life = 0.28, w = 1) { this.slashes.push({ x, y, color, ang, r, life, t: 0, w }); }
  glyph(x, y, color, kind, life = 0.9) { this.glyphs.push({ x, y, color, kind, life, t: 0 }); }
  proj(a, b, color, life = 0.26, arc = 0.6, size = 0.14) {
    const pr = { a, b, color, life, t: 0, arc, size }; this.projs.push(pr);
    this.ribbon((k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * arc }), color, life, size * 1.2, 10, 0);
  }
  thrust(a, b, color, w = 0.16, life = 0.32) { this.thrusts.push({ a, b, color, w, life, t: 0 }); }
  stream(a, b, color, n = 14, life = 0.5, spread = 0.35) {
    n = this.n(n);
    for (let i = 0; i < n; i++) this.spawn({ kind: 'seek', ax: a.x, ay: a.y, bx: b.x, by: b.y, x: a.x, y: a.y, off: rnd(-spread, spread), ph: rnd(0, 6.28), t: -i * (life / n) * 0.9, life, color, size: rnd(0.035, 0.06) });
  }
  flash(a = 0.6, color = '#ffffff') { if (this.calm) a *= 0.4; this.screenFlash = Math.max(this.screenFlash, a); this.flashColor = color; }
  bolt(x, y, color = '#cfe8ff', h = 9, life = 0.45) {
    const mkPath = (x0, y0, x1, y1, jag) => { const pts = [[x0, y0]]; const n = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.45)); for (let i = 1; i < n; i++) { const k = i / n; pts.push([x0 + (x1 - x0) * k + rnd(-jag, jag), y0 + (y1 - y0) * k + rnd(-jag * 0.4, jag * 0.4)]); } pts.push([x1, y1]); return pts; };
    const main = mkPath(x + rnd(-1, 1), y - h, x, y, 0.38);
    const forks = [];
    for (let i = 0; i < (this.lowQ ? 1 : 3); i++) { const j = 2 + ((Math.random() * (main.length - 4)) | 0), p = main[j]; forks.push(mkPath(p[0], p[1], p[0] + rnd(-1.6, 1.6), p[1] + rnd(0.6, 1.8), 0.22)); }
    this.bolts.push({ pts: main, forks, color, life, t: 0 });
    this.light(x, y, color, 1.8, life);
  }
  fallTile(x, y, color, delay) { this.falls.push({ x, y, color, delay, t: -delay, life: 0.9, rot: rnd(-1, 1) }); }
  meteor(x, y, delay = 0, color = '#ff8a3d', onHit = null) {
    const m = { x, y, t: -delay, life: 0.5, color, onHit, done: false }; this.meteors.push(m);
    if (!this.lowQ) this.after(delay, () => this.ribbon((k) => ({ x: m.x - 5 * (1 - k), y: m.y - 9 * (1 - k) }), color, m.life, 0.32, 14, 0));
  }
  firework(x, y, color) {
    // rocket climbs from below, then bursts with crackle and falling glitter
    const y0 = y + 2.2;
    this.ribbon((k) => ({ x: x + Math.sin(k * 6) * 0.05, y: y0 - (y0 - y) * (1 - (1 - k) * (1 - k)) }), '#fff1c4', 0.3, 0.06, 8, 0);
    this.after(0.3, () => {
      this.ring(x, y, color, 3.5, 0.8, 0.06); this.flare(x, y, color, 1.6, 0.35);
      const N = this.n(44);
      for (let i = 0; i < N; i++) { const a = (i / N) * TAU, v = 2.5 + Math.random() * 1.5; this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 1.6, life: 0.9 + Math.random() * 0.4, color: i % 3 ? color : '#ffffff', size: 0.04, kind: 'ember', drag: 1.8, ph: Math.random() * 6 }); }
      if (!this.lowQ) this.after(0.5, () => { for (let i = 0; i < 10; i++) this.spawn({ kind: 'star', x: x + rnd(-1.4, 1.4), y: y + rnd(-1, 1.2), vy: 0.4, life: rnd(0.3, 0.6), color: '#ffffff', size: rnd(0.08, 0.14) }); });
    });
  }
  decal(x, y, color, r = 0.45, life = 8) { this.mark('soft', x, y + 0.25, r, { color, life }); }

  // ---------- 10.0 primitives ----------
  // lingering floor mark: type scorch | crack | frost | rune | splash | soft | petals; glow = colour of a cooling inner glow
  mark(type, x, y, r = 0.5, o = {}) {
    const max = this.lowQ ? 20 : 44;
    this.decals.push({ type, x, y, r, color: o.color || (type === 'frost' ? '#bfefff' : type === 'rune' ? '#ffd24d' : type === 'splash' ? '#3dbfff' : 'rgba(18,10,6,0.85)'), life: o.life || 7, t: -(o.delay || 0), rot: o.rot ?? Math.random() * TAU, v: (Math.random() * 3) | 0, glow: o.glow || null, glowLife: o.glowLife || 1.2 });
    if (this.decals.length > max) this.decals.splice(0, this.decals.length - max);
  }
  light(x, y, color, r = 1.5, life = 0.5) { if (this.lights.length > 40) this.lights.shift(); this.lights.push({ x, y, color, r, life, t: 0 }); }
  rune(x, y, color, r = 1, life = 1, spin = 1, delay = 0) { this.runes.push({ x, y, color, r, life, spin, t: -delay }); }
  flare(x, y, color, size = 1, life = 0.3, delay = 0) { this.flares.push({ x, y, color, size, life, t: -delay, rot: Math.random() * 0.4 - 0.2 }); if (this.flares.length > 40) this.flares.shift(); }
  // anime-style impact frame: radial speed lines and a dark pop for a few frames (skipped in reduced motion / low quality)
  impactFrame(x, y, color = '#ffffff', life = 0.16, n = 26) { if (this.calm || this.lowQ) return; this.frames.push({ x, y, color, life, t: 0, ang: Array.from({ length: n }, () => [Math.random() * TAU, rnd(0.01, 0.035), rnd(0.8, 1.6)]) }); }
  // ribbon: a tapered trail following fn(k) -> {x,y} for k in 0..1 over life seconds
  ribbon(fn, color, life, w = 0.12, len = 12, delay = 0, add = true) { this.ribbons.push({ fn, color, life, w, len: this.lowQ ? Math.ceil(len / 2) : len, t: -delay, pts: [], add }); if (this.ribbons.length > 40) this.ribbons.shift(); }
  spike(x, y, color, h = 0.6, life = 0.7, w = 0.18, delay = 0, tip = '#ffffff') { this.spikes.push({ x, y, color, h, life, w, t: -delay, tip, lean: rnd(-0.25, 0.25) }); }

  // ---------- composite helpers ----------
  impact(x, y, color, s = 1, o = {}) {
    this.flare(x, y, color, 0.9 * s, 0.22);
    this.burst(x, y, '#ffffff', 6 * s, 3 * s);
    this.spray(x, y, color, 8 * s, 4 * s, o.ang ?? -Math.PI / 2, o.spread ?? Math.PI);
    if (s >= 1) this.shock(x, y + 0.2, rgba(color, 0.5), 0.9 * s, 0.3);
    this.light(x, y + 0.3, color, 1.2 * s, 0.3);
  }
  debris(x, y, color = '#8d8aa0', n = 10, sp = 3) { this.burst(x, y, color, n, sp, 'chunk'); this.burst(x, y + 0.1, '#cfc4ae', Math.ceil(n * 0.6), 1.4, 'dust'); }
  crater(x, y, r = 0.6, color) { this.mark('crack', x, y, r, { color: color || 'rgba(14,10,8,0.85)', life: 6 }); this.mark('scorch', x, y, r * 0.7, { color: 'rgba(16,12,10,0.5)', life: 5 }); }

  // ---------- hits (render.js onDmg) ----------
  // x,y = victim body; o: { n, crit, color, elem: 'fire'|'ice'|'holy'|'void'|'storm'|'lava'|'trap'|'thorns'|'poison'|'self', ang }
  hit(x, y, o = {}) {
    const n = o.n || 10, big = o.crit || n >= 25, ang = o.ang ?? -Math.PI / 2, col = o.color || '#fff1d6';
    const E = o.elem;
    if (E === 'self') { this.burst(x, y + 0.1, '#8a1020', 8, 1.6); this.burst(x, y, '#ff2a3a', 4, 1, 'up'); return; }
    if (E === 'lava' || E === 'fire') { this.burst(x, y + 0.3, '#ff8a3d', 14, 1.8, 'fire'); this.burst(x, y + 0.1, '#ffd27a', 6, 2.4, 'ember'); this.smoke(x, y - 0.1, '#2a1a14', 3); this.light(x, y + 0.4, '#ff6a1f', 1.2, 0.4); return; }
    if (E === 'storm') { this.burst(x, y, '#ff3b3b', 10, 3); this.spray(x, y, '#ff8a8a', 6, 3, ang, Math.PI); this.flare(x, y, '#ff3b3b', 0.6, 0.18); return; }
    if (E === 'trap') { this.spray(x, y + 0.2, '#ffb86b', 10, 3.5, -Math.PI / 2, 1.2); this.burst(x, y + 0.3, '#b8b2c8', 6, 2.5, 'chunk'); return; }
    if (E === 'thorns') { for (let i = 0; i < 5; i++) this.spike(x + rnd(-0.3, 0.3), y + 0.42, '#5a8a2a', rnd(0.25, 0.45), 0.5, 0.08, i * 0.03, '#b6ff7a'); this.burst(x, y, '#b6ff7a', 8, 2.5); return; }
    if (E === 'ice') { this.burst(x, y, '#d8fbff', 8, 3, 'shard'); this.burst(x, y, '#ffffff', 6, 2.5); this.mark('frost', x, y + 0.4, 0.35, { life: 3 }); }
    if (E === 'holy') { this.flare(x, y, '#fff1b0', 0.8, 0.25); this.burst(x, y, '#fff6d0', 8, 2, 'up'); }
    if (E === 'void') { this.gather(x, y, '#b04dff', 8, 0.6, 0.25); this.burst(x, y, '#d6a6ff', 6, 2.5); }
    // core hit: white pop, directional sparks that fall and bounce, flare
    this.flare(x, y, big ? '#fff1c4' : col, big ? 1.3 : 0.7, big ? 0.24 : 0.15);
    this.spray(x, y, o.crit ? '#ffd24d' : '#fff1d6', big ? 16 : 8, big ? 5 : 3.5, ang, big ? 1.1 : 0.8, 'spark');
    this.burst(x, y, '#ffffff', big ? 8 : 4, big ? 3.5 : 2.5);
    if (big) { this.shock(x, y + 0.35, 'rgba(255,230,180,0.5)', 1.3, 0.3); this.ring(x, y + 0.4, o.crit ? '#ffd24d' : '#ffffff', 1.6, 0.35, 0.06); }
    if (o.crit) {
      this.impactFrame(x, y, '#fff1c4', 0.14, 22); this.flash(0.18, '#fff6d0');
      this.spray(x, y, '#ffffff', 6, 6, ang, 0.5, 'ember');
      this.slash(x, y, '#ffd24d', ang + 1.8, 0.5, 0.22, 1.2);
    }
  }
  // camera-side cue at the moment an ultimate starts (render.js 'ult' wind-up, ~0.8s before the cast)
  ultCharge(x, y, color = '#ffd24d', glow = '#ffe9a8') {
    this.rune(x, y + 0.36, color, 2.4, 1.1, 1.4);
    this.gather(x, y - 0.3, glow, 28, 1.8, 0.7);
    this.after(0.25, () => this.gather(x, y - 0.3, '#ffffff', 14, 1.2, 0.5));
    this.ring(x, y + 0.36, color, 2.6, 0.8, 0.08, 0, true);
    this.pillar(x, y + 0.36, glow, 0.5, 0.9, 5);
    this.light(x, y + 0.3, color, 2.2, 1.0);
    this.after(0.7, () => { this.flare(x, y - 0.3, '#ffffff', 1.4, 0.2); });
  }
  promote(x, y, color = '#ffffff', glow = '#ffe9a8', o = {}) { // x,y = piece base. o.crowned for the King
    const gold = o.crowned ? '#ffd24d' : glow;
    this.rune(x, y, gold, 3, 1.4, 1.2);
    this.gather(x, y - 0.5, gold, 30, 1.6, 0.4);
    this.ring(x, y, gold, 3, 0.4, 0.06, 0, true);
    this.after(0.12, () => {
      this.flash(0.5, o.crowned ? '#ffe7a0' : '#ffffff'); this.impactFrame(x, y - 0.5, gold, 0.16);
      this.pillar(x, y, gold, 1.0, 1.3, 9); this.pillar(x, y, '#ffffff', 0.4, 0.8, 9);
      this.ring(x, y, '#ffd76a', 3.4, 0.9, 0.12); this.ring(x, y, glow, 2.2, 0.9, 0.1, 0.15);
      this.shock(x, y - 0.2, 'rgba(255,240,200,0.45)', 2.2, 0.5);
      this.flare(x, y - 0.6, '#ffffff', 2.2, 0.45);
      this.burst(x, y - 0.5, '#ffe9a8', 40, 4.5, 'up'); this.burst(x, y - 0.5, gold, 18, 5, 'ember');
      this.mark('rune', x, y, 0.7, { color: gold, life: 3 });
      for (let i = 0; i < 6; i++) this.spike(x + Math.cos(i / 6 * TAU) * 0.55, y + Math.sin(i / 6 * TAU) * 0.3, gold, 0.5, 0.6, 0.1, 0.05 + i * 0.02, '#ffffff');
    });
    this.after(0.5, () => this.orbit(x, y - 0.5, gold, 10, 0.55, 0.9, -0.8, 5));
    if (o.crowned) this.after(0.05, () => this.crown(x, y - 1.25, 0.4, 0.9));
  }
  crown(x, y, life = 0.45, hold = 0) { this.crowns.push({ x, y, t: 0, life, hold }); }
  crownPickup(x, y) { this.crown(x, y - 1.1, 0.4); this.after(0.4, () => { this.promote(x, y, '#ffd24d', '#ffe9a8', {}); this.burst(x, y - 0.4, '#ffd24d', 24, 4, 'coin'); }); }
  crownSpawn(x, y) { // x,y = tile centre ground
    this.rune(x, y + 0.2, '#ffd24d', 2.8, 1.6, 0.6); this.pillar(x, y + 0.3, '#ffd24d', 1, 1.6, 9);
    this.ring(x, y + 0.2, '#ffd24d', 4, 1.4, 0.14); this.flash(0.35, '#ffe7a0'); this.flare(x, y - 0.3, '#ffe9a8', 2, 0.6);
    this.after(0.2, () => { this.burst(x, y, '#ffe9a8', 30, 3, 'up'); this.burst(x, y, '#ffd24d', 16, 3, 'coin'); });
  }
  revive(x, y, color = '#ffffff') { // x,y = base. Two beats: soul gathers, then the body reforms in a burst of light
    this.pillar(x, y, '#ffffff', 0.5, 0.6, 7); this.rune(x, y, color, 2.4, 1.3, -1);
    this.gather(x, y - 0.45, color, 28, 1.4, 0.45); this.ring(x, y, color, 2.4, 0.45, 0.05, 0, true);
    this.after(0.45, () => {
      this.flash(0.4, '#fffbe6'); this.pillar(x, y, color, 1.1, 1.3, 9); this.pillar(x, y, '#ffffff', 0.5, 0.9, 9);
      this.ring(x, y, '#ffffff', 3.6, 0.8, 0.14); this.ring(x, y, color, 2.4, 0.8, 0.1, 0.1); this.shock(x, y - 0.2, 'rgba(255,250,220,0.5)', 2, 0.5);
      this.flare(x, y - 0.5, '#ffffff', 2, 0.4); this.burst(x, y - 0.5, '#fff6d0', 40, 4.5, 'up'); this.burst(x, y - 0.5, color, 20, 3);
      this.orbit(x, y - 0.4, color, 12, 0.6, 1, -1, 4); this.mark('rune', x, y, 0.6, { color, life: 3 });
    });
  }
  waveSpawn(x, y, boss = false) { // x,y = tile centre ground; a rift tears open, the Hollow climbs out
    const c = boss ? '#b77dff' : '#8f5cff';
    this.rune(x, y + 0.2, c, boss ? 3.6 : 1.3, boss ? 1.4 : 0.8, -2);
    this.mark('crack', x, y + 0.2, boss ? 1.2 : 0.45, { color: 'rgba(40,10,70,0.9)', life: boss ? 6 : 3, glow: '#a06bff' });
    this.gather(x, y - 0.2, '#c9a6ff', boss ? 24 : 8, boss ? 1.8 : 0.8, 0.4);
    this.after(0.35, () => {
      this.pillar(x, y + 0.3, c, boss ? 1.4 : 0.45, boss ? 1.2 : 0.65, boss ? 9 : 3.5);
      this.burst(x, y, '#c9a6ff', boss ? 30 : 6, boss ? 3 : 1.2, 'up'); this.smoke(x, y + 0.1, '#2a1440', boss ? 8 : 3);
      if (boss) { this.bossSlam(x, y + 0.2); }
    });
  }
  bossSlam(x, y) { // ground impact for the Colossus landing
    this.flash(0.4, '#b06bff'); this.kickCam(12); this.impactFrame(x, y - 0.4, '#e0c8ff', 0.2, 30);
    this.shock(x, y, 'rgba(160,90,255,0.55)', 3.8, 0.55); this.shock(x, y, 'rgba(255,220,170,0.4)', 2.2, 0.3);
    this.ring(x, y, '#c08bff', 5.4, 0.7, 0.18); this.ring(x, y, '#ffffff', 3.2, 0.5, 0.1, 0.06);
    this.debris(x, y, '#5a4a6e', 26, 4.5); this.burst(x, y - 0.2, '#e0c8ff', 24, 5);
    this.mark('crack', x, y, 1.5, { color: 'rgba(25,10,40,0.85)', life: 8, glow: '#a06bff' });
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; this.spike(x + Math.cos(a) * 1.3, y + Math.sin(a) * 0.7, '#4a3a5e', rnd(0.4, 0.8), 0.9, 0.2, 0.04 + i * 0.015, '#c9a6ff'); }
    this.smoke(x, y, '#3a2a4a', 10, 1.4, 1.4);
  }

  shatterSprite(img, x, y, power = 1, opts = {}) {
    // x,y = base centre in world units. Irregular triangles that fly, tumble, land and fade.
    const set = shardSet(img, this.lowQ), scale = 1 / SPR;
    for (const s of set) {
      const px = x + (s.cx - 48) * scale, py = y + (s.cy - 112) * scale;
      const dx = px - x, dy = py - (y - 0.5);
      this.shards.push({
        img: s.c, sw: s.w, sh: s.h, x: px, y: py,
        vx: dx * rnd(3, 6) * power + rnd(-0.5, 0.5) + (opts.vx || 0), vy: dy * rnd(2, 4) * power - rnd(1.5, 3.5) * power,
        rot: 0, vr: rnd(-9, 9) * power, life: opts.life || rnd(0.8, 1.3), t: -(opts.delay || 0), g: opts.g ?? 8, floor: y + rnd(0.05, 0.3), scale, add: !!opts.add,
      });
    }
    if (this.shards.length > 260) this.shards.splice(0, this.shards.length - 260);
  }

  // ---------- finishers (keyed by data.js FINISHERS ids) ----------
  finisher(kind, x, y, piece, skin, glow = '#ffe7a8') {
    const base = pieceSprite(piece, skin), B = y - 0.45; // B = body centre
    switch (kind) {
      case 'inferno': {
        const hot = pieceSprite(piece, skin, 'rgba(255,110,30,0.8)');
        this.implodes.push({ img: hot, x, y, t: 0, life: 0.3, hold: true });
        this.mark('scorch', x, y, 0.2, { life: 0.4, glow: '#ff6a1f' });
        this.gather(x, B, '#ffb43d', 14, 1, 0.3);
        this.after(0.25, () => {
          this.pillar(x, y, '#ff6a1f', 0.9, 1.0, 6); this.pillar(x, y, '#fff2a8', 0.35, 0.7, 6); this.flash(0.3, '#ff7a2a');
          this.shatterSprite(pieceSprite(piece, skin, 'ash'), x, y, 0.5, { life: 1.1, g: 6 });
          for (let i = 0; i < 6; i++) this.after(i * 0.07, () => { this.burst(x + rnd(-0.15, 0.15), B + 0.2, ['#fff2a8', '#ffd27a', '#ffb43d', '#ff6a1f', '#e0400f', '#c2260a'][i], 14, 2.2, 'fire'); this.burst(x, B, '#ffd27a', 4, 3, 'ember'); });
          this.ring(x, y, '#ff8a3d', 2.6, 0.7, 0.1); this.shock(x, y - 0.1, 'rgba(255,120,40,0.5)', 1.6, 0.4);
          this.mark('scorch', x, y, 0.6, { life: 9, glow: '#ff6a1f', glowLife: 2 });
          this.ribbon((k) => ({ x: x + Math.cos(k * 14) * 0.4 * (1 - k), y: y - k * 3 }), '#ffb43d', 0.8, 0.1, 12);
          this.ribbon((k) => ({ x: x + Math.cos(k * 14 + Math.PI) * 0.4 * (1 - k), y: y - k * 3 }), '#ff6a1f', 0.8, 0.1, 12);
        });
        this.after(0.6, () => { this.smoke(x, y - 0.6, '#2a1a14', 10, 0.5, 1.6); this.burst(x, y - 0.1, '#3a2a24', 16, 1.2, 'dust'); });
        break;
      }
      case 'lightning': {
        this.light(x, y, '#9fd4ff', 2, 0.3); this.burst(x, B, '#bfe4ff', 6, 1, 'up');
        this.after(0.18, () => {
          this.bolt(x, y - 0.1); this.after(0.05, () => this.bolt(x + rnd(-0.2, 0.2), y - 0.1, '#ffffff')); this.after(0.14, () => this.bolt(x + rnd(-0.3, 0.3), y - 0.1, '#9fd4ff', 9, 0.3));
          this.flash(0.75, '#e8f4ff'); this.impactFrame(x, B, '#e8f4ff', 0.14);
          this.shatterSprite(pieceSprite(piece, skin, 'white'), x, y, 1.4, { life: 0.2 }); this.shatterSprite(base, x, y, 1.3);
          this.burst(x, B, '#bfe4ff', 30, 5); this.spray(x, B, '#ffffff', 14, 6, -Math.PI / 2, Math.PI, 'ember');
          this.ring(x, y, '#9fd4ff', 3, 0.6, 0.1); this.shock(x, y, 'rgba(159,212,255,0.5)', 2, 0.4);
          this.flare(x, B, '#cfe8ff', 2, 0.3);
          this.mark('scorch', x, y, 0.55, { color: 'rgba(10,14,30,0.75)', life: 9, glow: '#7fb6ff' }); this.mark('crack', x, y, 0.7, { color: 'rgba(10,14,30,0.8)', life: 9 });
          for (let i = 0; i < 4; i++) this.after(0.2 + i * 0.12, () => { const a = Math.random() * TAU; this.beam({ x: x + Math.cos(a) * 0.2, y: y }, { x: x + Math.cos(a) * 0.8, y: y + Math.sin(a) * 0.4 }, '#cfe8ff', 0.05, 0.12); });
          this.smoke(x, y - 0.2, '#4a5060', 6);
        });
        break;
      }
      case 'voidrift':
        this.rune(x, B + 0.4, '#b04dff', 2.2, 1.0, -3);
        this.implodes.push({ img: base, x, y, t: 0, life: 0.6 });
        this.gather(x, B, '#b04dff', 40, 1.8, 0.6); this.gather(x, B, '#e6c8ff', 16, 1.2, 0.5);
        this.ring(x, B + 0.2, '#b04dff', 3, 0.6, 0.08, 0, true);
        this.funnels.push({ x, y: B, t: 0, life: 0.65, color: '#b04dff', disk: true });
        this.after(0.6, () => { this.flash(0.45, '#c99bff'); this.impactFrame(x, B, '#e6c8ff'); this.ring(x, y - 0.3, '#b04dff', 3.4, 0.7, 0.14); this.burst(x, B, '#d6a6ff', 30, 6); this.shock(x, y - 0.2, 'rgba(176,77,255,0.55)', 2.2, 0.45); this.flare(x, B, '#d6a6ff', 2.2, 0.35); this.mark('soft', x, y, 0.5, { color: 'rgba(40,10,70,0.5)', life: 5 }); });
        break;
      case 'midas': {
        const gold = pieceSprite(piece, skin, 'gold');
        this.implodes.push({ img: gold, x, y, t: 0, life: 0.55, hold: true, sweep: base });
        this.after(0.08, () => this.burst(x, B, '#fff1b0', 14, 1.4, 'up'));
        for (let i = 0; i < 4; i++) this.after(0.1 + i * 0.1, () => this.flare(x + rnd(-0.25, 0.25), y - rnd(0.2, 1), '#fff1b0', 0.5, 0.25));
        this.after(0.55, () => {
          this.shatterSprite(gold, x, y, 0.8);
          this.burst(x, B, '#ffd24d', 34, 3.2, 'coin'); this.burst(x, B, '#fff6d0', 20, 4, 'ember');
          this.ring(x, y, '#ffd24d', 2.6, 0.6); this.flash(0.25, '#ffe7a0'); this.flare(x, B, '#ffe9a8', 1.6, 0.3);
          this.mark('soft', x, y, 0.5, { color: 'rgba(255,200,60,0.25)', life: 5 });
          for (let i = 0; i < 6; i++) this.after(0.3 + i * 0.12, () => this.spawn({ kind: 'star', x: x + rnd(-0.6, 0.6), y: y + rnd(-0.1, 0.2), life: 0.35, color: '#fff1b0', size: 0.1 }));
        });
        break;
      }
      case 'coronation':
        this.crown(x, y - 1.0, 0.45);
        this.light(x, y, '#ffd24d', 1.6, 0.5);
        this.after(0.45, () => {
          this.flash(0.6, '#fff1c4'); this.impactFrame(x, B, '#fff1c4', 0.18); this.pillar(x, y, '#ffd24d', 1.2, 1.2, 8);
          this.shatterSprite(pieceSprite(piece, skin, 'gold'), x, y, 1.2);
          this.burst(x, B, '#ffd24d', 40, 5, 'coin'); this.burst(x, B, '#fff6d0', 30, 6, 'ember');
          this.ring(x, y, '#ffd24d', 4, 0.8, 0.16); this.ring(x, y, '#ffffff', 2.6, 0.6, 0.1, 0.1); this.flare(x, B, '#ffe9a8', 2.4, 0.4);
          this.shock(x, y - 0.3, 'rgba(255,220,120,0.55)', 2.4, 0.45); this.kickCam(10);
          this.mark('rune', x, y, 0.8, { color: '#ffd24d', life: 5 }); this.mark('crack', x, y, 0.6, { life: 6 });
        });
        break;
      case 'confetti': {
        const cols = ['#ff4d6d', '#ffd24d', '#5cff9d', '#4dabff', '#c77dff', '#ffffff'];
        this.implodes.push({ img: base, x, y, t: 0, life: 0.22, hold: true, wobble: 1 });
        this.after(0.22, () => {
          this.shatterSprite(base, x, y, 0.9); this.flare(x, B, '#fff6d0', 1.4, 0.2); this.flash(0.2, '#fff6d0');
          const N = this.n(80);
          for (let i = 0; i < N; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 3 + Math.random() * 4; this.spawn({ x, y: B, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 4, drag: 2.4, life: 1.2 + Math.random() * 0.7, color: cols[i % cols.length], size: rnd(0.05, 0.08), kind: 'confetti', rot: Math.random() * 6, vr: rnd(-20, 20), floor: y + rnd(0.05, 0.3), bounce: 0.1, wind: 1.5, ph: Math.random() * 6 }); }
          for (let i = 0; i < (this.lowQ ? 2 : 5); i++) { const a = -Math.PI / 2 + rnd(-0.9, 0.9), L = rnd(1.4, 2.4), c = cols[i % 5]; this.ribbon((k) => ({ x: x + Math.cos(a) * L * Math.sin(k * 1.6) + Math.sin(k * 12 + i) * 0.12, y: B + Math.sin(a) * L * Math.sin(k * 1.6) + k * k * 1.6 }), c, 1.1, 0.07, 14, 0, false); }
          this.ring(x, y, '#ffd24d', 2.2, 0.5); this.burst(x, B, '#ffffff', 10, 3);
        });
        break;
      }
      case 'frozen': {
        const ice = pieceSprite(piece, skin, 'rgba(170,230,255,0.85)');
        this.mark('frost', x, y, 0.9, { life: 9 });
        for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.3; this.spike(x + Math.cos(a) * 0.45, y + Math.sin(a) * 0.22, '#9fdcff', rnd(0.4, 0.75), 1.0, 0.12, 0.05 + i * 0.03, '#ffffff'); }
        this.implodes.push({ img: ice, x, y, t: 0, life: 0.5, hold: true, sweep: base, up: true });
        this.after(0.05, () => { this.burst(x, B, '#e8fbff', 16, 1.5, 'up'); this.ring(x, y, '#9df3ff', 1.6, 0.4); });
        this.after(0.5, () => {
          this.shatterSprite(ice, x, y, 1.3);
          this.burst(x, B, '#d8fbff', 30, 5, 'shard'); this.burst(x, B, '#ffffff', 20, 6);
          this.ring(x, y, '#9df3ff', 3, 0.6, 0.12); this.flash(0.35, '#e8fbff'); this.flare(x, B, '#d8fbff', 1.8, 0.3); this.impactFrame(x, B, '#e8fbff', 0.12);
          this.smoke(x, y - 0.1, '#dff6ff', 8, 0.8, 1.3);
        });
        break;
      }
      case 'ascend':
        this.rune(x, y, '#ffe9a8', 2.4, 1.8, 0.8);
        this.pillar(x, y, '#fff6d0', 1, 1.5, 9);
        this.implodes.push({ img: pieceSprite(piece, skin, 'white'), x, y, t: 0, life: 1.2, rise: true, add: true });
        for (let i = 0; i < 7; i++) this.after(i * 0.12, () => { this.burst(x, B - i * 0.3, '#fff6d0', 8, 1.2, 'up'); this.spawn({ kind: 'petal', x: x + rnd(-0.4, 0.4), y: B - i * 0.3, vx: rnd(-0.5, 0.5), vy: rnd(0.1, 0.4), g: 0.3, life: 1.4, color: '#ffffff', size: 0.07, rot: Math.random() * 6, vr: rnd(-4, 4), wind: 1.5, drag: 2.5, ph: Math.random() * 6 }); });
        this.after(1.0, () => { this.flash(0.45, '#fffbe6'); this.ring(x, y - 2.8, '#ffe9a8', 3, 0.7, 0.1); this.burst(x, y - 2.9, '#ffffff', 40, 4); this.flare(x, y - 2.9, '#fff6d0', 2.4, 0.4); });
        break;
      case 'starfall':
        this.light(x, y, '#9df3ff', 1.6, 0.5); this.ring(x, y, '#9df3ff', 1.6, 0.5, 0.04, 0, true);
        this.meteor(x, y - 0.3, 0, '#9df3ff', () => {
          this.flash(0.5, '#d8f6ff'); this.impactFrame(x, B, '#d8f6ff'); this.shatterSprite(base, x, y, 1.4);
          this.burst(x, B, '#d8f6ff', 30, 5); this.burst(x, B, '#ffe9a8', 20, 4, 'up'); this.spray(x, B, '#9df3ff', 16, 6, -Math.PI / 2, 1.4, 'ember');
          this.ring(x, y, '#9df3ff', 3.4, 0.7, 0.12); this.shock(x, y - 0.2, 'rgba(157,243,255,0.5)', 2, 0.4); this.flare(x, B, '#d8f6ff', 2.2, 0.35);
          this.crater(x, y, 0.8, 'rgba(10,14,40,0.85)'); this.mark('scorch', x, y, 0.5, { color: 'rgba(10,14,40,0.6)', glow: '#9df3ff', life: 9 });
          for (let i = 0; i < 8; i++) this.after(0.2 + i * 0.08, () => this.spawn({ kind: 'star', x: x + rnd(-1, 1), y: y - rnd(0, 1.5), life: 0.4, color: '#d8f6ff', size: rnd(0.07, 0.12) }));
        });
        break;
      case 'soulfire': { // violet soulflame swallows the piece and carries it skyward
        const vio = pieceSprite(piece, skin, 'rgba(150,70,255,0.8)');
        this.implodes.push({ img: vio, x, y, t: 0, life: 0.35, hold: true, sweep: base, up: true });
        this.rune(x, y, '#b06bff', 2, 1.4, 2);
        for (let i = 0; i < 5; i++) this.after(i * 0.07, () => this.burst(x + rnd(-0.15, 0.15), y - 0.2 - i * 0.12, ['#f3e6ff', '#c99bff', '#a05cff', '#7a2cff', '#3a1060'][i], 14, 2, 'fire', { c0: '#f3e6ff', c1: '#2a0a4a' }));
        this.ring(x, y, '#b06bff', 2.4, 0.6, 0.1);
        this.after(0.35, () => {
          this.implodes.push({ img: vio, x, y, t: 0, life: 1.0, rise: true, add: true });
          this.pillar(x, y, '#a05cff', 0.9, 1.2, 9); this.flash(0.35, '#c99bff'); this.flare(x, B, '#e6c8ff', 1.4, 0.3);
          const N = this.n(30); for (let i = 0; i < N; i++) { const a = Math.random() * TAU; this.spawn({ x: x + Math.cos(a) * 0.3, y: y - 0.3, vx: Math.cos(a) * 0.5, vy: -rnd(2, 5), g: -1, life: rnd(0.6, 1.1), color: i % 3 ? '#b06bff' : '#f3e6ff', size: rnd(0.04, 0.08), kind: 'fire', c0: '#f3e6ff', c1: '#2a0a4a' }); }
          this.ribbon((k) => ({ x: x + Math.sin(k * 10) * 0.35, y: y - k * 3.2 }), '#c99bff', 1.0, 0.09, 14);
          this.mark('scorch', x, y, 0.5, { color: 'rgba(60,20,110,0.6)', glow: '#b06bff', life: 8 });
        });
        this.after(1.0, () => { this.burst(x, y - 3, '#e6c8ff', 30, 3); this.ring(x, y - 3, '#c99bff', 2.6, 0.6, 0.08); this.flare(x, y - 3, '#e6c8ff', 1.8, 0.35); });
        break;
      }
      // ---------- 10.0 finishers ----------
      case 'judgement': { // a colossal blade falls from the heavens and cleaves the victim in two
        this.beam({ x, y: y - 9 }, { x, y }, 'rgba(255,230,160,0.6)', 0.05, 0.4);
        this.rune(x, y, '#ffd24d', 1.6, 0.6, 3); this.light(x, y, '#ffd24d', 1.4, 0.5);
        this.swords.push({ x, y, t: 0, fall: 0.32, life: 1.4, color: '#ffe9a8' });
        this.after(0.32, () => {
          const [L, R] = halfSet(base);
          this.halves.push({ img: L, x, y, t: 0, life: 1.1, dir: -1 }, { img: R, x, y, t: 0, life: 1.1, dir: 1 });
          this.flash(0.6, '#fff6d0'); this.impactFrame(x, B, '#fff1c4', 0.2, 32); this.kickCam(12);
          this.flare(x, y - 0.2, '#ffffff', 2.6, 0.35); this.shock(x, y, 'rgba(255,220,140,0.6)', 2.6, 0.45);
          this.ring(x, y, '#ffd24d', 4, 0.7, 0.14); this.ring(x, y, '#ffffff', 2.4, 0.5, 0.08, 0.05);
          this.spray(x, y - 0.1, '#ffd24d', 18, 6, -Math.PI / 2, 1.3, 'ember'); this.debris(x, y, '#9c8a6e', 12, 3);
          this.mark('crack', x, y, 1.0, { life: 9, glow: '#ffd24d' });
          this.beam({ x: x - 0.02, y: y - 1.4 }, { x: x + 0.02, y: y + 0.2 }, '#ffffff', 0.08, 0.25);
        });
        this.after(1.2, () => { this.burst(x, y - 1, '#fff6d0', 24, 2, 'up'); this.flare(x, y - 1.2, '#ffe9a8', 1.4, 0.3); });
        break;
      }
      case 'supernova': { // the victim becomes a star, swells, collapses and detonates
        const wh = pieceSprite(piece, skin, 'white');
        this.implodes.push({ img: wh, x, y, t: 0, life: 0.75, hold: true, swell: true, add: true });
        this.gather(x, B, '#9df3ff', 36, 2.2, 0.7); this.gather(x, B, '#ffd24d', 20, 1.6, 0.6);
        this.rune(x, y, '#9df3ff', 2.6, 1.0, 2.5); this.ring(x, B + 0.3, '#ffffff', 3.4, 0.7, 0.06, 0, true);
        this.flares.push({ x, y: B, color: '#fff6d0', size: 2.2, life: 0.75, t: 0, rot: 0, grow: true });
        this.after(0.75, () => {
          this.flash(0.85, '#ffffff'); this.impactFrame(x, B, '#ffffff', 0.24, 36); this.kickCam(16);
          this.shatterSprite(base, x, y, 1.8, { life: 0.9 });
          this.shock(x, B + 0.3, 'rgba(200,240,255,0.65)', 4.2, 0.6); this.shock(x, B + 0.3, 'rgba(255,220,140,0.5)', 2.4, 0.35);
          this.ring(x, y, '#9df3ff', 6, 0.9, 0.2); this.ring(x, y, '#ffd24d', 4.4, 0.8, 0.14, 0.06); this.ring(x, y, '#ffffff', 2.8, 0.6, 0.1, 0.12);
          this.flare(x, B, '#ffffff', 4, 0.5); this.burst(x, B, '#ffffff', 40, 8); this.burst(x, B, '#9df3ff', 30, 6, 'ember'); this.burst(x, B, '#ffd24d', 20, 5, 'ember');
          this.mark('scorch', x, y, 1.1, { color: 'rgba(8,10,30,0.8)', glow: '#9df3ff', life: 10, glowLife: 2.5 }); this.crater(x, y, 1.1, 'rgba(8,10,30,0.85)');
          if (!this.lowQ) for (let i = 0; i < 10; i++) this.spawn({ kind: 'glow', x: x + rnd(-0.8, 0.8), y: B + rnd(-0.6, 0.4), vx: rnd(-0.3, 0.3), vy: rnd(-0.3, 0.1), life: rnd(1.2, 1.8), color: pick(['#5a3aa8', '#2a6aa8', '#a83a8a']), size: rnd(0.25, 0.45), drag: 1 });
        });
        break;
      }
      case 'glitch': { // digital deletion: scanline tearing, RGB split, pixel scatter
        this.glitches.push({ img: base, c: pieceSprite(piece, skin, '#00f0ff'), m: pieceSprite(piece, skin, '#ff3df2'), x, y, t: 0, life: 0.85 });
        for (let i = 0; i < 4; i++) this.after(i * 0.15, () => { this.flashTile(Math.floor(x) + pick([-1, 0, 0, 1]), Math.floor(y - 0.86 + 0.5), pick(['#00f0ff', '#ff3df2']), 0.15); });
        this.after(0.85, () => {
          this.flash(0.3, '#00f0ff'); this.flare(x, B, '#00f0ff', 1.6, 0.2);
          const N = this.n(46); for (let i = 0; i < N; i++) this.spawn({ kind: 'tile', x: x + rnd(-0.35, 0.35), y: y - rnd(0, 1.05), vx: rnd(-2.5, 2.5), vy: rnd(-3, 0), g: 6, drag: 2, life: rnd(0.5, 1.0), color: pick(['#00f0ff', '#ff3df2', '#ffffff', '#24123d']), size: rnd(0.05, 0.1), floor: y + rnd(0, 0.25), bounce: 0.2 });
          this.ring(x, y, '#00f0ff', 2.4, 0.4, 0.04); this.ring(x, y, '#ff3df2', 1.8, 0.4, 0.04, 0.05);
          this.beam({ x: x - 1.2, y: B }, { x: x + 1.2, y: B }, '#00f0ff', 0.06, 0.18); this.beam({ x: x - 0.8, y: B - 0.3 }, { x: x + 0.8, y: B - 0.3 }, '#ff3df2', 0.05, 0.14);
          this.mark('soft', x, y, 0.45, { color: 'rgba(0,240,255,0.18)', life: 4 });
        });
        break;
      }
      case 'sakura': { // the piece dissolves into a storm of cherry blossoms carried off on the wind
        this.implodes.push({ img: base, x, y, t: 0, life: 1.2, dissolve: true, petal: '#ffb7d0' });
        this.ring(x, y, '#ffd1dc', 2, 0.6, 0.05);
        for (let w = 0; w < (this.lowQ ? 2 : 4); w++) this.ribbon((k) => ({ x: x - 1.2 + k * 3.4, y: B - 0.4 + Math.sin(k * 6 + w * 1.7) * 0.35 - w * 0.15 }), 'rgba(255,220,235,0.5)', 1.1, 0.05, 14, 0.1 + w * 0.12, false);
        this.after(1.0, () => { this.mark('petals', x + 0.3, y, 0.7, { color: '#ffb7d0', life: 7 }); this.flare(x + 0.6, B - 0.6, '#ffd1dc', 1, 0.3); });
        break;
      }
      case 'riptide': { // a whirlpool opens and a column of water drags them under
        const wet = pieceSprite(piece, skin, 'rgba(60,170,255,0.7)');
        this.mark('splash', x, y, 0.9, { color: '#1a5a8a', life: 6 });
        this.funnels.push({ x, y, t: 0, life: 1.1, color: '#3dbfff', water: true });
        this.implodes.push({ img: wet, x, y, t: 0, life: 1.0, sink: true });
        this.after(0.1, () => { this.pillar(x, y, '#3dbfff', 1.0, 1.0, 5); this.ring(x, y, '#9dfff6', 2.6, 0.8, 0.08); });
        for (let i = 0; i < 6; i++) this.after(i * 0.12, () => { this.burst(x, y - 0.1, '#bff6ff', 5, 1, 'bubble'); this.spray(x, y - 0.4, '#9dfff6', 6, 3.5, -Math.PI / 2, 1.2, 'spark', { g: 9 }); });
        this.after(0.95, () => {
          this.flash(0.25, '#9dfff6'); this.shock(x, y, 'rgba(61,191,255,0.55)', 2.4, 0.5);
          this.spray(x, y - 0.2, '#ffffff', 22, 5, -Math.PI / 2, 0.9, 'spark', { g: 10, size: 0.05 }); this.burst(x, y - 0.1, '#bff6ff', 12, 1.6, 'bubble');
          this.ring(x, y, '#3dbfff', 3.4, 0.7, 0.1);
        });
        break;
      }
      case 'reaper': { // a spectral scythe sweeps through; the soul is torn free and the body crumbles to grey dust
        const grey = pieceSprite(piece, skin, 'rgba(120,120,130,0.85)'), ghost = pieceSprite(piece, skin, 'rgba(170,255,220,0.7)');
        this.light(x, y, '#6dffc8', 1.4, 0.6); this.smoke(x, y, '#1a2a24', 6, 0.6);
        this.after(0.15, () => {
          this.slash(x, B, '#9dffd8', -2.6, 0.95, 0.4, 2.2); this.slash(x, B, '#ffffff', -2.5, 0.9, 0.3, 0.8);
          this.flash(0.2, '#9dffd8'); this.impactFrame(x, B, '#c8ffe8', 0.14);
          this.implodes.push({ img: grey, x, y, t: 0, life: 0.5, hold: true });
          this.implodes.push({ img: ghost, x, y, t: 0, life: 1.5, rise: true, add: true, wave: 1 });
        });
        this.after(0.6, () => { this.shatterSprite(grey, x, y, 0.35, { g: 5, life: 0.9 }); this.burst(x, B, '#8a8a90', 22, 1.4, 'dust'); this.smoke(x, B, '#5a5a62', 6, 0.5); this.mark('scorch', x, y, 0.45, { color: 'rgba(30,40,36,0.6)', life: 6 }); });
        this.after(1.2, () => { this.burst(x, y - 2.6, '#c8ffe8', 16, 1.6, 'up'); this.flare(x, y - 2.8, '#c8ffe8', 1, 0.3); });
        break;
      }
      case 'cyclone': { // a tornado whips them up, spins them and flings them off the board
        this.funnels.push({ x, y, t: 0, life: 1.5, color: '#d8e6f0' });
        this.implodes.push({ img: base, x, y, t: 0, life: 1.3, spin: true });
        this.mark('soft', x, y, 0.8, { color: 'rgba(30,30,40,0.35)', life: 3 });
        const N = this.n(30); for (let i = 0; i < N; i++) this.spawn({ kind: 'orbit', cx: x, cy: y - 0.1, a: Math.random() * TAU, r: rnd(0.25, 0.6), rg: 0.3, va: rnd(7, 11), rise: -rnd(1.2, 2.4), life: rnd(0.9, 1.4), color: pick(['#b9a27e', '#d8e6f0', '#8d8aa0']), size: rnd(0.03, 0.06) });
        this.debris(x, y, '#9c8a6e', 8, 2);
        this.after(1.25, () => { this.flare(x + 1.6, y - 3.2, '#ffffff', 1.2, 0.25); this.burst(x + 1.6, y - 3.2, '#ffffff', 14, 3); });
        break;
      }
      case 'finale': { // launched skyward like a rocket, bursting into a fireworks show
        this.burst(x, y, '#fff1c4', 10, 2, 'ember'); this.smoke(x, y, '#5a5060', 6, 0.8);
        this.implodes.push({ img: base, x, y, t: 0, life: 0.55, launch: true });
        this.ribbon((k) => ({ x: x + Math.sin(k * 20) * 0.04, y: y - 0.4 - k * k * 4.5 }), '#ffd27a', 0.55, 0.12, 14);
        for (let i = 0; i < 6; i++) this.after(i * 0.08, () => this.burst(x, y - 0.5 - i * i * 0.12, '#ffb43d', 5, 1.2, 'fire'));
        this.after(0.55, () => {
          this.flash(0.35, '#fff6d0'); this.shatterSprite(base, x, y - 4.4, 1.6, { g: 3, life: 1.0 });
          this.firework(x, y - 4.6, '#ffd24d');
          this.after(0.18, () => this.firework(x - 1.3, y - 3.6, '#ff4d6d')); this.after(0.32, () => this.firework(x + 1.4, y - 3.9, '#4dabff'));
          this.after(0.48, () => this.firework(x + 0.2, y - 5.2, '#5cff9d'));
        });
        this.mark('scorch', x, y, 0.4, { life: 6, glow: '#ffb43d' });
        break;
      }
      case 'resign': { // the victim tips over like a resigned king, then crumbles into chessboard squares
        this.topples.push({ img: base, x, y, t: 0, life: 1.3, dir: Math.random() < 0.5 ? -1 : 1 });
        this.after(0.5, () => { this.debris(x, y, '#b8b2c8', 6, 1.6); this.kickCam(4); this.ring(x, y, '#ffffff', 1.8, 0.4, 0.04); });
        this.after(1.15, () => {
          const N = this.n(36); for (let i = 0; i < N; i++) this.spawn({ kind: 'tile', x: x + rnd(-0.7, 0.7), y: y - rnd(0, 0.3), vx: rnd(-1.5, 1.5), vy: -rnd(1, 3), g: 7, drag: 1.5, life: rnd(0.7, 1.1), color: i % 2 ? '#f3ede0' : '#1a1626', size: rnd(0.07, 0.12), floor: y + rnd(0, 0.25), bounce: 0.3, rot: Math.random() * 6, vr: rnd(-8, 8) });
          this.flare(x, y - 0.2, '#ffffff', 1, 0.2); this.burst(x, y - 0.2, '#ffffff', 10, 2);
        });
        break;
      }
      case 'phoenix': { // a firebird sweeps through, the victim ignites and the bird rises from the ashes
        const hot = pieceSprite(piece, skin, 'rgba(255,120,30,0.85)');
        this.birds.push({ x0: x - 4, y0: B - 1.6, x1: x, y1: B, x2: x + 4, y2: B - 2.2, t: 0, life: 0.6, color: '#ff8a3d', s: 0.8 });
        this.after(0.3, () => {
          this.implodes.push({ img: hot, x, y, t: 0, life: 0.45, hold: true });
          this.flash(0.35, '#ffb43d'); this.flare(x, B, '#ffd27a', 1.8, 0.3); this.impactFrame(x, B, '#ffd27a', 0.12);
          this.burst(x, B, '#ffb43d', 24, 2.4, 'fire'); this.spray(x, B, '#ffd27a', 14, 4, -Math.PI / 2, 1.4, 'ember');
          this.mark('scorch', x, y, 0.7, { life: 9, glow: '#ff6a1f', glowLife: 2 });
        });
        this.after(0.75, () => { this.shatterSprite(pieceSprite(piece, skin, 'ash'), x, y, 0.4, { g: 5 }); this.smoke(x, y - 0.4, '#2a1a14', 8, 0.5, 1.4); });
        this.after(1.0, () => {
          this.birds.push({ x0: x, y0: y - 0.2, x1: x, y1: y - 2, x2: x + 0.3, y2: y - 5, t: 0, life: 1.0, color: '#ffb43d', s: 1.2, rise: true });
          this.pillar(x, y, '#ff8a3d', 0.7, 0.9, 7); this.ring(x, y, '#ffb43d', 2.8, 0.7, 0.1);
          this.burst(x, y - 0.5, '#ffd27a', 20, 3, 'up');
        });
        break;
      }
      case 'checkmate': { // Season 3 capstone: a colossal king topples onto them and the board cracks in a pink and gold shockwave
        const dir = Math.random() < 0.5 ? -1 : 1, king = pieceSprite('king', skin, 'rgba(255,77,141,0.55)');
        this.giants.push({ img: king, x: x - dir * 2.3, y, t: 0, life: 1.25, fall: 0.5, sc: 2.1, dir });
        this.rune(x, y, '#ff4d8d', 2.2, 0.9, 2); this.light(x, y, '#ff4d8d', 2, 0.6);
        this.after(0.5, () => {
          this.flash(0.6, '#ffd76a'); this.impactFrame(x, B, '#ffd76a', 0.22, 34); this.kickCam(16);
          this.shatterSprite(base, x, y, 1.6);
          this.shock(x, y, 'rgba(255,77,141,0.6)', 4.2, 0.6); this.shock(x, y, 'rgba(255,215,106,0.5)', 2.4, 0.35);
          this.ring(x, y, '#ff4d8d', 6, 0.9, 0.18); this.ring(x, y, '#ffd76a', 4.2, 0.8, 0.14, 0.08); this.ring(x, y, '#ffffff', 2.4, 0.5, 0.08, 0.04);
          this.flare(x, B, '#ffd76a', 2.8, 0.4); this.burst(x, B, '#ffd76a', 30, 6, 'ember'); this.burst(x, B, '#ff4d8d', 24, 5); this.debris(x, y, '#5a3a4a', 18, 4.5);
          this.mark('crack', x, y, 1.8, { color: 'rgba(30,6,16,0.9)', life: 10, glow: '#ff4d8d', glowLife: 2 });
          for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, d = 1.1 + (i % 2) * 0.5; this.after(0.04 * (i % 4), () => { this.flashTile(Math.floor(x + Math.cos(a) * d), Math.floor(y - 0.36 + Math.sin(a) * d * 0.7), i % 2 ? '#ff4d8d' : '#ffd76a', 0.6); }); }
          this.smoke(x, y, '#3a1a2a', 10, 1.6, 1.5);
        });
        break;
      }
      default: { // shatter: white pop, glassy triangle shards that land and fade, glints
        this.implodes.push({ img: pieceSprite(piece, skin, 'white'), x, y, t: 0, life: 0.08, hold: true });
        this.after(0.06, () => {
          this.shatterSprite(base, x, y, 1.15);
          this.flare(x, B, '#ffffff', 1.5, 0.22); this.impactFrame(x, B, '#ffffff', 0.1, 18);
          this.burst(x, B, '#ffffff', 20, 5); this.burst(x, B, glow, 18, 4, 'ember');
          this.ring(x, y, '#ffffff', 2.2, 0.6); this.ring(x, y, glow, 1.6, 0.5, 0.06, 0.06);
          this.shock(x, y - 0.1, 'rgba(255,255,255,0.4)', 1.4, 0.35);
          this.burst(x, y, '#cfc4ae', 6, 1.2, 'dust');
          for (let i = 0; i < 4; i++) this.after(0.35 + i * 0.12, () => this.spawn({ kind: 'star', x: x + rnd(-0.7, 0.7), y: y + rnd(-0.05, 0.25), life: 0.3, color: glow, size: 0.09 }));
        });
      }
    }
  }

  // ---------- ability VFX (keyed by data.js ABILITIES ids): returns impact delay in seconds ----------
  ability(ev, color, glow = '#ffe9a8') {
    const { ab, from, anchor, tiles = [] } = ev;
    const fx = from.x + 0.5, fy = from.y + 0.5, ax = anchor.x + 0.5, ay = anchor.y + 0.5;
    const ang = Math.atan2(ay - fy, ax - fx);
    const G = (t) => [t.x + 0.5, t.y + 0.62]; // ground point of a tile
    const ends = (cheb) => { const m = new Map(); for (const t of tiles) { const dx = Math.sign(t.x - from.x), dy = Math.sign(t.y - from.y), k = dx + ',' + dy, d = cheb ? Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y)) : Math.abs(t.x - from.x) + Math.abs(t.y - from.y); if (!m.has(k) || m.get(k).d < d) m.set(k, { t, d }); } return [...m.values()].map((v) => v.t); };
    const glint = (x, y, c = '#ffffff', s = 0.6) => this.flare(x, y, c, s, 0.16);
    switch (ab) {
      // ----- basic attacks and melee -----
      case 'pawnStrike': case 'pickpocket': case 'shove': {
        glint(fx + Math.cos(ang) * 0.25, fy - 0.2, '#fff4d6', 0.5);
        this.after(0.11, () => {
          const c = '#fff4d6';
          if (ab === 'shove') {
            this.thrust({ x: fx, y: fy - 0.15 }, { x: ax + Math.cos(ang) * 0.5, y: ay - 0.15 + Math.sin(ang) * 0.5 }, 'rgba(230,240,255,0.7)', 0.3, 0.25);
            this.shock(ax, ay + 0.15, 'rgba(230,240,255,0.5)', 1.1, 0.3); this.spray(ax, ay + 0.3, '#d9cfb8', 8, 3, ang, 0.6, 'dust');
            for (let i = 0; i < 3; i++) this.beam({ x: ax - Math.cos(ang) * 0.3, y: ay - 0.4 + i * 0.25 }, { x: ax + Math.cos(ang) * 0.8, y: ay - 0.4 + i * 0.25 + Math.sin(ang) * 0.8 }, 'rgba(255,255,255,0.6)', 0.03, 0.2);
          } else this.slash(ax, ay - 0.1, c, ang - 1.1, 0.48, 0.26, 1.1);
          this.impact(ax, ay - 0.1, glow, 0.7, { ang, spread: 0.9 });
          if (ab === 'pickpocket') { this.proj({ x: ax, y: ay - 0.3 }, { x: fx, y: fy - 0.4 }, '#9df3ff', 0.3, 0.5, 0.08); this.after(0.3, () => { this.flare(fx, fy - 0.4, '#9df3ff', 0.7, 0.2); this.burst(fx, fy - 0.4, '#9df3ff', 8, 1.5, 'up'); }); }
        });
        return 0.12;
      }
      case 'hollowClaw':
        this.light(fx, fy, '#8f8cff', 1, 0.3);
        this.after(0.1, () => {
          for (let i = -1; i <= 1; i++) this.slash(ax + Math.cos(ang + Math.PI / 2) * i * 0.12, ay - 0.1 + Math.sin(ang + Math.PI / 2) * i * 0.12, '#b9b6ff', ang - 1, 0.42, 0.24, 0.7);
          this.impact(ax, ay - 0.1, '#8f8cff', 0.7, { ang }); this.smoke(ax, ay, '#2a2450', 2, 0.4, 0.7);
        });
        return 0.12;
      case 'royalStrike':
        glint(fx, fy - 0.5, '#ffd24d', 0.8); this.gather(fx, fy - 0.3, '#ffd24d', 8, 0.6, 0.14);
        this.after(0.13, () => {
          this.slash(ax, ay - 0.1, '#ffe9a8', ang - 1.2, 0.62, 0.3, 1.5); this.slash(ax, ay - 0.1, '#ffffff', ang - 1.1, 0.56, 0.22, 0.6);
          this.impact(ax, ay - 0.1, '#ffd24d', 1.1, { ang }); this.burst(ax, ay, '#ffd24d', 8, 3, 'coin'); this.kickCam(3);
          this.mark('crack', ax, ay + 0.15, 0.35, { life: 4 });
        });
        return 0.14;
      case 'execute':
        this.flare(fx, fy - 0.5, '#ff3b5c', 0.9, 0.2); this.gather(fx, fy - 0.3, '#ff3b5c', 10, 0.8, 0.15);
        this.after(0.14, () => {
          this.slash(ax, ay - 0.1, '#ff3b5c', ang - 1, 0.8, 0.36, 2); this.slash(ax, ay - 0.1, '#ffffff', ang + 2.2, 0.66, 0.3, 1.4);
          this.flash(0.25, '#ff2a4a'); this.impactFrame(ax, ay - 0.1, '#ff8a9a', 0.16); this.kickCam(6);
          this.impact(ax, ay - 0.1, '#ff3b5c', 1.3, { ang }); this.spray(ax, ay, '#8a1020', 12, 3, ang, 0.9, 'ember');
          this.mark('crack', ax, ay + 0.15, 0.5, { life: 6, glow: '#ff2a4a' });
        });
        return 0.16;
      case 'tstrike': case 'stagger': case 'slam': {
        const c = ab === 'stagger' ? '#c9a6ff' : '#ffdcaa';
        this.burst(fx, fy + 0.3, '#d9cfb8', 4, 1.2, 'dust');
        if (ab === 'slam') this.gather(fx, fy - 0.4, '#ffdcaa', 8, 0.7, 0.12);
        tiles.forEach((t, i) => this.after(0.08 + i * 0.03, () => {
          const [gx, gy] = G(t);
          this.shock(gx, gy, rgba(c, 0.5), 0.8, 0.3); this.flare(gx, gy - 0.3, c, 0.5, 0.14);
          this.burst(gx, gy + 0.15, '#d9cfb8', 5, 1.6, 'dust'); this.burst(gx, gy, '#8d8aa0', 3, 2.5, 'chunk');
          if (ab !== 'stagger') this.mark('crack', gx, gy, 0.28, { life: 3 });
          else this.orbit(gx, gy - 0.6, '#c9a6ff', 5, 0.3, 0.7, 0, 8);
          if (i === 0) this.kickCam(ab === 'slam' ? 3 : 2);
        }));
        return 0.1;
      }
      // ----- ranged -----
      case 'ray': {
        const last = tiles[tiles.length - 1] || anchor, ex = last.x + 0.5, ey = last.y + 0.2;
        this.gather(fx, fy - 0.35, glow, 8, 0.5, 0.08); glint(fx, fy - 0.35, glow, 0.7);
        this.beam({ x: fx, y: fy - 0.35 }, { x: ex, y: ey }, glow, 0.32, 0.45); this.beam({ x: fx, y: fy - 0.35 }, { x: ex, y: ey }, '#ffffff', 0.1, 0.3);
        tiles.forEach((t, i) => this.after(i * 0.03, () => { this.burst(t.x + 0.5, t.y + 0.4, glow, 5, 2); this.flashTile(t.x, t.y, glow, 0.3); }));
        this.flare(ex, ey, glow, 1, 0.25);
        return 0.08;
      }
      case 'siege': {
        const last = tiles[tiles.length - 1] || anchor, ex = last.x + 0.5, ey = last.y + 0.4;
        this.flare(fx + Math.cos(ang) * 0.3, fy - 0.3, '#ffd27a', 1.1, 0.18); this.smoke(fx + Math.cos(ang) * 0.3, fy - 0.2, '#6a6070', 4, 0.8, 0.8); this.spray(fx, fy - 0.3, '#ffd27a', 6, 3, ang, 0.4);
        this.proj({ x: fx, y: fy - 0.3 }, { x: ex, y: ey - 0.1 }, '#ffd27a', 0.24, 0.6, 0.12);
        this.after(0.24, () => {
          this.shock(ex, ey + 0.1, 'rgba(255,200,120,0.55)', 1.3, 0.3); this.flare(ex, ey - 0.2, '#ffd27a', 1.3, 0.25);
          this.burst(ex, ey - 0.1, '#ffb43d', 14, 2, 'fire'); this.debris(ex, ey, '#8d8aa0', 8, 3.5); this.smoke(ex, ey - 0.1, '#3a3440', 5, 0.7);
          this.mark('scorch', ex, ey + 0.1, 0.45, { life: 7, glow: '#ff8a3d' }); this.kickCam(4);
        });
        return 0.25;
      }
      case 'cross': case 'checkmate': {
        const gold = ab === 'checkmate' ? '#ffd24d' : glow;
        this.rune(fx, fy + 0.3, gold, ab === 'checkmate' ? 2.2 : 1.6, 0.6, 2);
        glint(fx, fy - 0.35, '#ffffff', 0.9);
        for (const t of ends(true)) { const ex = t.x + 0.5, ey = t.y + 0.2; this.beam({ x: fx, y: fy - 0.35 }, { x: ex, y: ey }, gold, 0.24, 0.45); this.beam({ x: fx, y: fy - 0.35 }, { x: ex, y: ey }, '#ffffff', 0.07, 0.3); this.flare(ex, ey, gold, 0.7, 0.22, 0.04); }
        for (const t of tiles) this.flashTile(t.x, t.y, gold, 0.35, Math.hypot(t.x - from.x, t.y - from.y) * 0.03);
        this.ring(fx, fy + 0.3, gold, 2, 0.5);
        return 0.1;
      }
      case 'starburst':
        this.gather(fx, fy - 0.3, '#fff1c4', 10, 0.8, 0.1);
        this.after(0.06, () => {
          this.shock(fx, fy + 0.2, 'rgba(255,230,160,0.45)', 1.9, 0.4); this.ring(fx, fy + 0.3, '#ffe9a8', 3.4, 0.5, 0.12);
          this.flare(fx, fy - 0.3, '#fff1c4', 1.2, 0.2); this.burst(fx, fy, '#fff1c4', 24, 5);
          for (const t of tiles) { this.flare(t.x + 0.5, t.y + 0.35, '#ffe9a8', 0.55, 0.2, rnd(0, 0.05)); this.flashTile(t.x, t.y, '#ffd24d', 0.3); }
        });
        return 0.1;
      case 'dominion':
        this.rune(fx, fy + 0.3, '#c08bff', 4.4, 1.0, -1.5);
        this.shock(fx, fy + 0.2, 'rgba(176,77,255,0.45)', 2.8, 0.5); this.ring(fx, fy + 0.3, '#c08bff', 5, 0.5, 0.12);
        this.ring(fx, fy + 0.3, '#e6c8ff', 4, 0.7, 0.06, 0.15, true);
        this.burst(fx, fy, '#d6a6ff', 24, 4); this.flare(fx, fy - 0.3, '#d6a6ff', 1.2, 0.25);
        for (const t of tiles) this.after(0.1, () => { this.flashTile(t.x, t.y, '#7a3dff', 0.4); this.burst(t.x + 0.5, t.y - 0.2, '#c08bff', 3, 0.8, 'spark', { g: 3 }); });
        return 0.1;
      // ----- leaps, dashes -----
      case 'trample':
        this.burst(fx, fy + 0.3, '#d9cfb8', 8, 1.6, 'dust'); this.ring(fx, fy + 0.35, '#ffffff', 1, 0.3, 0.04);
        this.after(0.36, () => {
          this.shock(ax, ay + 0.2, 'rgba(255,220,170,0.5)', 1.9, 0.35); this.ring(ax, ay + 0.3, '#ffe2a8', 3, 0.5); this.debris(ax, ay + 0.3, '#8d8aa0', 10, 3);
          this.burst(ax, ay + 0.3, '#d9cfb8', 16, 3, 'dust'); this.flare(ax, ay - 0.1, '#ffe2a8', 1, 0.2); this.crater(ax, ay + 0.2, 0.6); this.kickCam(4);
          for (const t of tiles) this.flashTile(t.x, t.y, '#ffd27a', 0.3, rnd(0, 0.06));
        });
        return 0.4;
      case 'charge': {
        this.burst(fx, fy + 0.3, '#d9cfb8', 10, 2.2, 'dust'); this.spray(fx, fy + 0.3, '#d9cfb8', 6, 2.5, ang + Math.PI, 0.5, 'dust');
        tiles.forEach((t, i) => this.after(0.03 + i * 0.03, () => { const [gx, gy] = G(t); this.burst(gx, gy + 0.1, '#cfc4ae', 4, 1.2, 'dust'); this.mark('soft', gx, gy + 0.1, 0.25, { color: 'rgba(20,14,8,0.25)', life: 2.5 }); }));
        this.thrust({ x: fx, y: fy - 0.1 }, { x: ax, y: ay - 0.1 }, 'rgba(255,240,220,0.5)', 0.35, 0.3);
        return 0.12;
      }
      case 'decree': {
        const last = tiles[tiles.length - 1] || anchor;
        this.ribbon((k) => ({ x: fx + (last.x + 0.5 - fx) * Math.min(1, k * 2), y: fy - 0.3 + (last.y + 0.5 - fy) * Math.min(1, k * 2) }), '#c77dff', 0.4, 0.22, 10);
        this.ribbon((k) => ({ x: fx + (last.x + 0.5 - fx) * Math.min(1, k * 2), y: fy - 0.3 + (last.y + 0.5 - fy) * Math.min(1, k * 2) }), '#ffd24d', 0.35, 0.08, 10);
        tiles.forEach((t, i) => this.after(0.03 + i * 0.03, () => { this.slash(t.x + 0.5, t.y + 0.3, '#ffe9a8', ang - 1.4 + (i % 2) * 2.8, 0.4, 0.2, 0.8); this.burst(t.x + 0.5, t.y + 0.3, '#d6a6ff', 4, 2); }));
        return 0.12;
      }
      case 'enPassant': case 'fork': {
        this.burst(fx, fy + 0.3, '#d9cfb8', 12, 2, 'dust'); this.ring(fx, fy + 0.35, '#ffe2a8', 1.6, 0.35, 0.05); this.flare(fx, fy - 0.2, glow, 1, 0.2);
        this.ribbon((k) => ({ x: fx + (ax - fx) * k, y: fy - 0.3 + (ay - fy) * k - Math.sin(k * Math.PI) * 1.4 }), glow, 0.4, 0.14, 12);
        this.after(0.36, () => {
          this.flash(0.4); this.impactFrame(ax, ay - 0.2, '#fff1c4', 0.18); this.kickCam(6);
          this.shock(ax, ay + 0.2, 'rgba(255,230,160,0.6)', 2.8, 0.5); this.ring(ax, ay + 0.3, '#ffe2a8', 4.5, 0.6, 0.14); this.ring(ax, ay + 0.3, '#ffffff', 2.6, 0.4, 0.08, 0.06);
          this.flare(ax, ay - 0.2, '#fff1c4', 2, 0.3); this.burst(ax, ay + 0.3, glow, 24, 5); this.debris(ax, ay + 0.3, '#8d8aa0', 14, 4); this.crater(ax, ay + 0.2, 0.9);
          if (ab === 'fork') for (const t of tiles) this.after(rnd(0, 0.1), () => { this.beam({ x: ax, y: ay - 0.2 }, { x: t.x + 0.5, y: t.y + 0.3 }, '#ffd24d', 0.08, 0.3); this.flare(t.x + 0.5, t.y + 0.3, '#ffd24d', 0.8, 0.25); this.flashTile(t.x, t.y, '#ffd24d', 0.5); this.burst(t.x + 0.5, t.y + 0.4, '#fff1d6', 8, 3); });
          else for (const t of tiles) this.after(Math.random() * 0.12, () => { this.burst(t.x + 0.5, t.y + 0.5, '#fff1d6', 8, 3); this.flashTile(t.x, t.y, '#ffd24d'); this.shock(t.x + 0.5, t.y + 0.6, 'rgba(255,230,160,0.4)', 0.8, 0.25); });
        });
        return 0.42;
      }
      // ----- holy -----
      case 'excommunicate': {
        this.rune(fx, fy + 0.36, '#ffd24d', 3.2, 1.2, 1.5); this.flash(0.5, '#fff3c4'); this.impactFrame(fx, fy - 0.3, '#fff3c4', 0.2);
        for (const t of ends(false)) { const ex = t.x + 0.5, ey = t.y + 0.2; this.beam({ x: fx, y: fy - 0.35 }, { x: ex, y: ey }, '#fff3c4', 0.42, 0.8); this.beam({ x: fx, y: fy - 0.35 }, { x: ex, y: ey }, '#ffd24d', 0.22, 0.95); this.beam({ x: fx, y: fy - 0.35 }, { x: ex, y: ey }, '#ffffff', 0.08, 0.6); this.flare(ex, ey, '#fff3c4', 1.2, 0.35, 0.05); }
        for (const t of tiles) this.after(Math.hypot(t.x - from.x, t.y - from.y) * 0.025, () => { this.flashTile(t.x, t.y, '#ffd24d', 0.5); this.burst(t.x + 0.5, t.y + 0.3, '#fff6d0', 3, 1.4, 'up'); });
        this.pillar(fx, fy + 0.36, '#ffe9a8', 1.1, 1.0, 9); this.ring(fx, fy + 0.3, '#ffd24d', 4, 0.7, 0.12); this.flare(fx, fy - 0.4, '#ffffff', 2.4, 0.4);
        this.kickCam(6);
        return 0.12;
      }
      case 'penance': {
        const tx = ax, ty = ay - 0.3;
        this.glyph(fx, fy - 0.3, '#fff3c4', 'holy', 0.5); glint(fx, fy - 0.35, '#fff1b0', 0.8);
        this.proj({ x: fx, y: fy - 0.35 }, { x: tx, y: ty }, '#fff1b0', 0.22, 0.4, 0.12);
        this.beam({ x: fx, y: fy - 0.35 }, { x: tx, y: ty }, 'rgba(255,236,170,0.6)', 0.08, 0.35);
        this.after(0.22, () => {
          this.burst(tx, ty, '#fff6d0', 16, 3.5); this.ring(tx, ty + 0.5, '#ffe9a8', 1.8, 0.45, 0.08); this.glyph(tx, ty - 0.2, '#ffe9a8', 'holy', 0.7);
          this.shock(tx, ty + 0.3, 'rgba(255,240,190,0.45)', 1, 0.3); this.flare(tx, ty, '#fff6d0', 1.1, 0.25);
        });
        this.after(0.32, () => { this.stream({ x: tx, y: ty }, { x: fx, y: fy - 0.3 }, '#6dffa8', 18, 0.55); this.stream({ x: tx, y: ty }, { x: fx, y: fy - 0.3 }, '#d6ffe6', 6, 0.5, 0.15); });
        this.after(0.85, () => { this.ring(fx, fy + 0.35, '#6dffa8', 1.4, 0.45); this.burst(fx, fy, '#6dffa8', 10, 1.4, 'up'); this.light(fx, fy + 0.3, '#6dffa8', 1.2, 0.5); });
        return 0.24;
      }
      case 'sanctuary':
        this.rune(fx, fy + 0.36, '#6dffa8', 1.8, 1.2, 1);
        this.glyph(fx, fy + 0.1, '#6dffa8', 'heal'); this.burst(fx, fy, '#6dffa8', 18, 1.5, 'up');
        this.pillar(fx, fy + 0.36, '#6dffa8', 0.6, 0.9, 4); this.orbit(fx, fy - 0.2, '#b6ffd2', 8, 0.45, 1, -0.6, 4);
        return 0.05;
      case 'divineRight':
        this.crown(fx, fy - 1.0, 0.3);
        this.after(0.1, () => {
          this.pillar(fx, fy + 0.36, '#ffd24d', 1.2, 1.1, 8); this.flash(0.5, '#ffe7a0'); this.impactFrame(fx, fy - 0.3, '#ffe7a0');
          this.rune(fx, fy + 0.36, '#ffd24d', 3, 1.2, 1); this.ring(fx, fy + 0.3, '#ffd24d', 3.4, 0.7, 0.12); this.burst(fx, fy, '#fff1c4', 34, 4, 'up');
          for (const t of tiles) { this.beam({ x: fx, y: fy - 0.3 }, { x: t.x + 0.5, y: t.y + 0.3 }, '#ffe9a8', 0.12, 0.35); this.flare(t.x + 0.5, t.y + 0.3, '#ffd24d', 0.8, 0.25); this.flashTile(t.x, t.y, '#ffd24d', 0.45); }
          this.mark('rune', fx, fy + 0.36, 0.8, { color: '#ffd24d', life: 4 });
        });
        return 0.15;
      // ----- buffs / utility -----
      case 'digin':
        this.glyph(fx, fy - 0.3, '#7fb6ff', 'shield'); this.burst(fx, fy + 0.35, '#b9a27e', 8, 1.2, 'dust'); this.mark('crack', fx, fy + 0.36, 0.35, { life: 4 });
        this.ring(fx, fy + 0.35, '#7fb6ff', 1.4, 0.4, 0.05, 0, true);
        return 0.05;
      case 'fortify':
        this.glyph(fx, fy - 0.3, '#7fb6ff', 'shield');
        for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; this.spike(fx + Math.cos(a) * 0.48, fy + 0.36 + Math.sin(a) * 0.26, '#6a6478', 0.4, 0.9, 0.14, i * 0.03, '#b8b2c8'); }
        this.rune(fx, fy + 0.36, '#7fb6ff', 1.6, 0.9, 0.5); this.kickCam(2);
        return 0.05;
      case 'royalGuard':
        this.glyph(fx, fy - 0.3, '#ffd24d', 'shield'); this.ring(fx, fy + 0.35, '#ffd24d', 1.8, 0.5, 0.06);
        this.orbit(fx, fy - 0.3, '#ffe9a8', 10, 0.55, 0.9, 0, 5); this.burst(fx, fy, '#6dffa8', 8, 1.2, 'up');
        return 0.05;
      case 'rally':
        this.glyph(fx, fy, '#ffe04d', 'speed'); this.burst(fx, fy, '#ffe04d', 14, 2, 'up');
        for (let i = 0; i < 3; i++) this.ring(fx, fy - 0.2, '#ffe04d', 1.8 + i * 0.7, 0.4, 0.04, i * 0.08);
        this.flare(fx, fy - 0.6, '#ffe04d', 0.8, 0.2);
        return 0.05;
      case 'vault': case 'sprint':
        this.glyph(fx, fy, '#9df3ff', 'speed'); this.burst(fx, fy + 0.35, '#d9cfb8', 6, 1.5, 'dust');
        this.ribbon((k) => ({ x: fx + Math.cos(k * 9) * 0.4, y: fy + 0.2 - k * 0.9 + Math.sin(k * 9) * 0.15 }), '#9df3ff', 0.45, 0.06, 10);
        return 0.05;
      case 'transpose':
        this.glyph(fx, fy, glow, 'swap'); this.glyph(ax, ay, glow, 'swap');
        this.stream({ x: fx, y: fy - 0.3 }, { x: ax, y: ay - 0.3 }, glow, 10, 0.3, 0.4); this.stream({ x: ax, y: ay - 0.3 }, { x: fx, y: fy - 0.3 }, '#ffffff', 10, 0.3, 0.4);
        this.flare(fx, fy - 0.3, glow, 0.8, 0.2); this.flare(ax, ay - 0.3, glow, 0.8, 0.2);
        this.rune(fx, fy + 0.35, glow, 1.1, 0.5, 3); this.rune(ax, ay + 0.35, glow, 1.1, 0.5, -3);
        return 0.1;
      case 'blink':
        this.glyph(ax, ay, '#c9a6ff', 'swap'); this.rune(ax, ay + 0.35, '#c9a6ff', 1.2, 0.8, 2); this.gather(ax, ay - 0.2, '#c9a6ff', 10, 0.7, 0.3);
        return 0.1;
      case 'rampart':
        this.after(0.05, () => { this.debris(ax, ay + 0.3, '#b8b2c8', 12, 2.5); this.spike(ax - 0.25, ay + 0.4, '#6a6478', 0.4, 0.5, 0.12, 0, '#b8b2c8'); this.spike(ax + 0.25, ay + 0.4, '#6a6478', 0.35, 0.5, 0.12, 0.03, '#b8b2c8'); this.mark('crack', ax, ay + 0.35, 0.45, { life: 5 }); });
        return 0.05;
      case 'castling':
        this.glyph(fx, fy, '#ffd24d', 'swap'); this.glyph(ax, ay, '#ffd24d', 'swap');
        this.stream({ x: fx, y: fy - 0.3 }, { x: ax, y: ay - 0.3 }, '#ffd24d', 12, 0.25, 0.5);
        this.after(0.25, () => {
          this.flash(0.3); this.impactFrame(ax, ay - 0.2, '#ffe9a8', 0.16); this.kickCam(8);
          this.shock(ax, ay + 0.2, 'rgba(255,220,160,0.55)', 2.4, 0.45); this.ring(ax, ay + 0.3, '#ffd24d', 3.6, 0.6, 0.12);
          this.debris(ax, ay, '#8d8aa0', 22, 4); this.flare(ax, ay - 0.2, '#ffe9a8', 1.6, 0.25);
          for (const t of tiles) { this.flashTile(t.x, t.y, '#ffd24d', 0.4); this.mark('crack', t.x + 0.5, t.y + 0.6, 0.3, { life: 4 }); }
          this.crater(ax, ay + 0.3, 0.8);
        });
        return 0.3;
      case 'nova':
        this.gather(fx, fy - 0.3, '#ffffff', 20, 1.6, 0.12);
        this.after(0.06, () => {
          this.flash(0.7, '#ffffff'); this.impactFrame(fx, fy - 0.3, '#fff1c4', 0.22, 34); this.kickCam(10);
          this.shock(fx, fy, 'rgba(255,240,200,0.6)', 3.6, 0.55); this.ring(fx, fy + 0.2, '#ffd24d', 6, 0.7, 0.18); this.ring(fx, fy + 0.2, glow, 4.5, 0.7, 0.12, 0.1);
          this.flare(fx, fy - 0.3, '#ffffff', 3.4, 0.45); this.burst(fx, fy, '#fff1c4', 46, 7); this.burst(fx, fy, glow, 30, 5, 'ember');
          for (const t of tiles) this.flashTile(t.x, t.y, '#ffd24d', 0.6, Math.hypot(t.x - from.x, t.y - from.y) * 0.04);
          this.mark('scorch', fx, fy + 0.36, 1.4, { color: 'rgba(20,14,8,0.6)', glow: '#ffd24d', life: 9, glowLife: 2 });
          if (!this.lowQ) for (let i = 0; i < 6; i++) this.spawn({ kind: 'glow', x: fx + rnd(-1.4, 1.4), y: fy + rnd(-1, 0.6), vx: rnd(-0.3, 0.3), vy: -0.2, life: rnd(1, 1.5), color: pick(['#5a3aa8', '#a8823a', glow]), size: rnd(0.3, 0.5), drag: 1 });
        });
        return 0.12;
      // ----- 5.0 -----
      case 'tripwire': // only the owner's side sees the placement (render.js swaps the anchor for others)
        this.after(0.06, () => { this.burst(ax, ay + 0.3, '#c8d2e0', 5, 0.8, 'dust'); this.ring(ax, ay + 0.35, 'rgba(255,90,70,0.8)', 0.9, 0.35, 0.03); this.beam({ x: ax - 0.35, y: ay + 0.3 }, { x: ax + 0.35, y: ay + 0.3 }, 'rgba(255,90,70,0.8)', 0.02, 0.4); });
        return 0.05;
      case 'lance': {
        const last = tiles[tiles.length - 1] || anchor, ex = last.x + 0.5, ey = last.y + 0.45;
        const dx = Math.sign(last.x - from.x), dy = Math.sign(last.y - from.y);
        glint(fx - dx * 0.2, fy - 0.3, '#ffe2a8', 0.6);
        this.after(0.08, () => {
          this.thrust({ x: fx - dx * 0.1, y: fy - 0.25 }, { x: ex + dx * 0.35, y: ey - 0.2 + dy * 0.35 }, '#ffe2a8', 0.15, 0.34);
          this.thrust({ x: fx, y: fy - 0.25 }, { x: ex + dx * 0.2, y: ey - 0.2 + dy * 0.2 }, glow, 0.08, 0.28);
          tiles.forEach((t, i) => this.after(i * 0.035, () => { this.burst(t.x + 0.5, t.y + 0.45, '#fff1d6', 6, 3); this.flashTile(t.x, t.y, '#ffd27a', 0.3); this.spray(t.x + 0.5, t.y + 0.7, '#d9cfb8', 4, 2, Math.atan2(dy, dx), 0.5, 'dust'); }));
          this.flare(ex + dx * 0.3, ey - 0.2, '#ffffff', 0.9, 0.2); this.spray(ex + dx * 0.3, ey - 0.2, '#ffe2a8', 10, 4, Math.atan2(dy, dx), 0.6);
        });
        return 0.1;
      }
      case 'quake': {
        this.shock(fx, fy + 0.3, 'rgba(210,180,130,0.5)', 1.3, 0.3); this.burst(fx, fy + 0.35, '#b9a27e', 12, 2.5, 'dust'); this.mark('crack', fx, fy + 0.36, 0.6, { life: 5 });
        for (const t of tiles) {
          const d = Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y));
          this.after(0.06 + d * 0.09, () => {
            const [gx, gy] = G(t);
            this.shock(gx, gy, 'rgba(225,190,140,0.55)', 0.95, 0.3); this.spike(gx + rnd(-0.15, 0.15), gy + 0.1, '#7a6a52', rnd(0.3, 0.5), 0.55, 0.14, 0, '#d2b88a');
            this.burst(gx, gy + 0.1, '#9c8a6e', 6, 3, 'chunk'); this.burst(gx, gy + 0.2, '#d9cfb8', 5, 1.4, 'dust');
            this.flashTile(t.x, t.y, '#d2a86a', 0.35); this.mark('crack', gx, gy, 0.36, { life: 4 });
            this.kickCam(1.5);
          });
        }
        return 0.12;
      }
      case 'gambit':
        this.flash(0.22, '#ff1a2a');
        this.rune(fx, fy + 0.36, '#ff2a3a', 1.8, 0.9, -2);
        this.pillar(fx, fy + 0.36, '#ff2a3a', 0.8, 0.7, 4);
        this.ring(fx, fy + 0.35, '#ff3b2a', 2.2, 0.55, 0.1); this.ring(fx, fy + 0.35, '#ffb03d', 1.4, 0.5, 0.06, 0.12);
        this.burst(fx, fy, '#ff2a3a', 18, 2.2, 'up'); this.burst(fx, fy - 0.2, '#ff9a3d', 10, 1.6, 'fire');
        this.glyph(fx, fy - 0.6, '#ff5a3a', 'sword', 0.9);
        this.gather(fx, fy - 0.2, '#ff2a3a', 16, 1.1, 0.45);
        this.after(0.35, () => this.ring(fx, fy + 0.35, '#ff2a3a', 1.6, 0.3, 0.05));
        return 0.1;
      case 'colossusSlam':
        this.gather(fx, fy - 1.0, '#c08bff', 24, 1.4, 0.26); this.burst(fx, fy - 0.6, '#c08bff', 12, 1.2, 'up'); this.light(fx, fy + 0.3, '#a06bff', 2.4, 0.4);
        this.after(0.26, () => {
          this.bossSlam(fx, fy + 0.3);
          for (const t of tiles) { const dd = Math.hypot(t.x - from.x, t.y - from.y); this.flashTile(t.x, t.y, '#a06bff', 0.55, dd * 0.04); this.after(dd * 0.05, () => this.burst(t.x + 0.5, t.y + 0.7, '#8d8aa0', 5, 2.5, 'chunk')); }
        });
        return 0.3;
      // ----- 10.0 equips (A9) -----
      case 'phalanx': // four spear jabs at once
        this.gather(fx, fy - 0.3, '#ffe2a8', 8, 0.6, 0.1);
        this.after(0.09, () => { for (const t of tiles) { const tx = t.x + 0.5, ty = t.y + 0.35; this.thrust({ x: fx, y: fy - 0.25 }, { x: tx + (tx - fx) * 0.3, y: ty + (ty - fy) * 0.3 }, '#ffe2a8', 0.1, 0.26); this.impact(tx, ty, glow, 0.6, { ang: Math.atan2(ty - fy, tx - fx), spread: 0.6 }); this.flashTile(t.x, t.y, '#ffd27a', 0.3); } this.ring(fx, fy + 0.35, '#ffe2a8', 2.2, 0.35, 0.05); this.kickCam(2); });
        return 0.1;
      case 'outflank': // a phantom knight strike from the side, no movement
        this.flare(fx, fy - 0.3, glow, 0.6, 0.15);
        this.ribbon((k) => ({ x: fx + (ax - fx) * k, y: fy - 0.3 + (ay - 0.2 - fy + 0.3) * k - Math.sin(k * Math.PI) * 0.9 }), glow, 0.12, 0.1, 10);
        this.after(0.11, () => { this.slash(ax, ay - 0.1, '#ffe9a8', ang - 1.3, 0.55, 0.26, 1.3); this.impact(ax, ay - 0.1, glow, 1, { ang }); this.shock(ax, ay + 0.2, 'rgba(255,230,170,0.45)', 1, 0.25); });
        return 0.12;
      case 'consecrate': { // holy column slams down on a 3x3
        this.beam({ x: ax, y: ay - 7 }, { x: ax, y: ay + 0.2 }, 'rgba(255,240,190,0.7)', 0.06, 0.2); this.rune(ax, ay + 0.2, '#ffe9a8', 3.2, 1.0, 1.2); glint(fx, fy - 0.4, '#fff1b0', 0.8);
        this.after(0.18, () => {
          this.pillar(ax, ay + 0.3, '#fff3c4', 1.6, 0.8, 8); this.flash(0.3, '#fff3c4'); this.flare(ax, ay - 0.3, '#ffffff', 1.8, 0.3);
          this.shock(ax, ay + 0.2, 'rgba(255,240,190,0.55)', 2.6, 0.45); this.ring(ax, ay + 0.3, '#ffd24d', 3.4, 0.6, 0.12);
          for (const t of tiles) { this.flashTile(t.x, t.y, '#ffe9a8', 0.55, rnd(0, 0.06)); this.burst(t.x + 0.5, t.y + 0.5, '#fff6d0', 4, 1.6, 'up'); }
          this.mark('rune', ax, ay + 0.3, 1.2, { color: '#ffd24d', life: 5 }); this.kickCam(4);
        });
        return 0.2;
      }
      case 'repel': // outward shockwave that shoves everything back
        this.gather(fx, fy - 0.2, '#cfe6ff', 10, 0.8, 0.08);
        this.after(0.06, () => {
          this.shock(fx, fy + 0.3, 'rgba(210,230,255,0.6)', 2.6, 0.4); this.ring(fx, fy + 0.35, '#cfe6ff', 3.2, 0.4, 0.12); this.ring(fx, fy + 0.35, '#ffffff', 2.2, 0.3, 0.06, 0.04);
          for (const t of tiles) { const a = Math.atan2(t.y - from.y, t.x - from.x); this.spray(t.x + 0.5, t.y + 0.7, '#d9cfb8', 4, 2.5, a, 0.4, 'dust'); this.beam({ x: fx + Math.cos(a) * 0.4, y: fy + Math.sin(a) * 0.3 }, { x: fx + Math.cos(a) * 1.4, y: fy + Math.sin(a) * 1.0 }, 'rgba(220,235,255,0.6)', 0.05, 0.2); }
          this.kickCam(3);
        });
        return 0.08;
      case 'bombard': { // mortar shell lobbed over walls, plus-shaped burst
        this.flare(fx, fy - 0.5, '#ffd27a', 1, 0.18); this.smoke(fx, fy - 0.4, '#6a6070', 5, 0.6, 0.9); this.kickCam(2);
        this.proj({ x: fx, y: fy - 0.5 }, { x: ax, y: ay }, '#ffb43d', 0.3, 2.2, 0.13);
        this.after(0.3, () => {
          this.flare(ax, ay - 0.1, '#ffd27a', 1.6, 0.3); this.shock(ax, ay + 0.2, 'rgba(255,190,110,0.55)', 2, 0.35); this.burst(ax, ay, '#ffb43d', 18, 2.4, 'fire');
          this.debris(ax, ay + 0.2, '#8d8aa0', 12, 3.5); this.smoke(ax, ay, '#3a3440', 8, 0.8, 1.2); this.mark('scorch', ax, ay + 0.2, 0.7, { life: 8, glow: '#ff8a3d' }); this.kickCam(6);
          for (const t of tiles) { this.flashTile(t.x, t.y, '#ff8a3d', 0.45); if (t.x !== anchor.x || t.y !== anchor.y) this.spray(t.x + 0.5, t.y + 0.5, '#ffd27a', 5, 3, Math.atan2(t.y - anchor.y, t.x - anchor.x), 0.4, 'ember'); }
        });
        return 0.3;
      }
      case 'gravity': // a dark well pulls inward, then crushes the ring
        this.rune(fx, fy + 0.36, '#7a3dff', 3.6, 0.9, -4); this.funnels.push({ x: fx, y: fy - 0.2, t: 0, life: 0.4, color: '#b04dff', disk: true });
        this.gather(fx, fy - 0.2, '#b04dff', 30, 2.6, 0.3); this.ring(fx, fy + 0.35, '#c08bff', 5, 0.3, 0.08, 0, true);
        this.after(0.28, () => {
          this.flash(0.3, '#7a3dff'); this.shock(fx, fy + 0.3, 'rgba(140,70,255,0.55)', 2.8, 0.4); this.ring(fx, fy + 0.35, '#c08bff', 3, 0.4, 0.12);
          this.flare(fx, fy - 0.2, '#d6a6ff', 1.6, 0.25); this.impactFrame(fx, fy - 0.2, '#d6a6ff', 0.14);
          for (const t of tiles) { this.flashTile(t.x, t.y, '#7a3dff', 0.5); this.burst(t.x + 0.5, t.y + 0.6, '#5a4a6e', 4, 2.5, 'chunk'); this.mark('crack', t.x + 0.5, t.y + 0.6, 0.3, { life: 4, glow: '#a06bff' }); }
          this.kickCam(6);
        });
        return 0.3;
      // ----- 10.0 Siege enemies (A9) -----
      case 'hexBolt':
        this.gather(fx, fy - 0.3, '#ff5af0', 8, 0.6, 0.12); this.glyph(fx, fy - 0.9, '#ff5af0', 'swap', 0.4);
        this.proj({ x: fx, y: fy - 0.3 }, { x: ax, y: ay - 0.2 }, '#ff5af0', 0.2, 0.3, 0.12);
        this.after(0.2, () => { this.flare(ax, ay - 0.2, '#ff5af0', 1, 0.22); this.burst(ax, ay - 0.1, '#ff9af6', 12, 3); this.rune(ax, ay + 0.3, '#ff5af0', 1.2, 0.5, 4); this.smoke(ax, ay, '#3a1040', 3, 0.4, 0.8); });
        return 0.2;
      case 'soulLance': {
        const last = tiles[tiles.length - 1] || anchor, ex = last.x + 0.5, ey = last.y + 0.2;
        this.gather(fx, fy - 0.4, '#9dffd8', 14, 1, 0.12); this.flare(fx, fy - 0.4, '#9dffd8', 0.8, 0.14);
        this.after(0.12, () => { this.beam({ x: fx, y: fy - 0.4 }, { x: ex, y: ey }, '#9dffd8', 0.34, 0.5); this.beam({ x: fx, y: fy - 0.4 }, { x: ex, y: ey }, '#ffffff', 0.1, 0.35); this.flare(ex, ey, '#c8ffe8', 1.3, 0.25); tiles.forEach((t, i) => this.after(i * 0.025, () => { this.flashTile(t.x, t.y, '#6dffc8', 0.35); this.burst(t.x + 0.5, t.y + 0.3, '#c8ffe8', 4, 2); })); this.kickCam(3); });
        return 0.14;
      }
      case 'wraithStep':
        this.smoke(fx, fy + 0.1, '#1a2a24', 6, 0.5, 0.9); this.burst(fx, fy - 0.2, '#9dffd8', 12, 1.6, 'up'); this.gather(ax, ay - 0.2, '#9dffd8', 12, 0.9, 0.3);
        this.after(0.05, () => { this.rune(ax, ay + 0.35, '#6dffc8', 1.4, 0.6, -3); this.flare(ax, ay - 0.2, '#c8ffe8', 0.9, 0.2); });
        return 0.05;
      default: { // anything new (A9 content): read the tiles and do something sensible
        glint(fx, fy - 0.3, glow, 0.7);
        if (tiles.length) tiles.forEach((t, i) => this.after(0.06 + i * 0.025, () => { this.flashTile(t.x, t.y, glow, 0.35); this.burst(t.x + 0.5, t.y + 0.4, glow, 5, 2.4); }));
        if (anchor.x !== from.x || anchor.y !== from.y) this.after(0.06, () => this.impact(ax, ay - 0.1, glow, 0.8, { ang }));
        else { this.ring(fx, fy + 0.35, glow, 1.6, 0.5, 0.06); this.burst(fx, fy, glow, 12, 1.6, 'up'); }
        return 0.08;
      }
    }
  }

  // ---------- 10.0 hazard / world / creature events (A9 content) ----------
  // One call from render.js onFx: fx.event(e, at) where at(id) -> [x, y] like render's helper (x = tile centre, y = tile top).
  // Returns true when it drew something, so callers can keep their own fallback.
  event(e, at = () => [0, 0]) {
    const base = (id) => { const [x, y] = at(id); return [x, y + 0.86]; };
    switch (e.e) {
      case 'hazard':
        if (e.kind === 'geyser' && e.phase === 'warn') { for (const t of e.tiles || []) { this.burst(t.x + 0.5, t.y + 0.7, '#dff6ff', 4, 0.6, 'bubble'); this.smoke(t.x + 0.5, t.y + 0.6, '#cfe6f0', 2, 0.3, 0.9); this.ring(t.x + 0.5, t.y + 0.7, '#9dfff6', 1, 0.5, 0.03); } return true; }
        if (e.kind === 'geyser' && e.phase === 'erupt') {
          for (const c of e.centers || []) { const x = c.x + 0.5, y = c.y + 0.7; this.pillar(x, y, '#dff6ff', 0.9, 1.1, 6); this.spray(x, y - 0.3, '#ffffff', 22, 6, -Math.PI / 2, 0.5, 'spark', { g: 9 }); this.smoke(x, y - 0.5, '#e8f4f8', 10, 0.8, 1.4); this.shock(x, y, 'rgba(200,240,255,0.5)', 2, 0.4); this.mark('splash', x, y, 0.7, { color: '#2a6a8a', life: 5 }); this.kickCam(5); }
          for (const t of e.tiles || []) this.flashTile(t.x, t.y, '#9dfff6', 0.5, rnd(0, 0.08));
          return true;
        }
        if (e.kind === 'crumble') { const x = e.x + 0.5, y = e.y + 0.62; if (e.phase === 'crack') { this.mark('crack', x, y, 0.45, { life: 6 }); this.burst(x, y, '#9c8a6e', 5, 1.5, 'chunk'); this.burst(x, y, '#d9cfb8', 4, 1, 'dust'); } else { this.fallTile(e.x, e.y, '#2a2638', 0); this.debris(x, y, '#7a6a52', 14, 3); this.smoke(x, y, '#3a3036', 5, 0.5); this.shock(x, y, 'rgba(210,180,130,0.45)', 1.2, 0.35); this.kickCam(5); } return true; }
        if (e.kind === 'rift') { const A = e.from || null, Bp = e.to || null; if (A && Bp) { const a = { x: A.x + 0.5, y: A.y + 0.2 }, b = { x: Bp.x + 0.5, y: Bp.y + 0.2 }; this.stream(a, b, '#c77dff', 12, 0.4, 0.5); this.stream(b, a, '#3dfff0', 12, 0.4, 0.5); for (const q of [a, b]) { this.rune(q.x, q.y + 0.4, '#c77dff', 1.4, 0.7, 4); this.flare(q.x, q.y, '#e6c8ff', 1, 0.25); this.gather(q.x, q.y, '#c77dff', 8, 0.7, 0.3); } } return true; }
        if (e.kind === 'conveyor') return true;
        return false;
      case 'world':
        if (e.kind === 'earthquake') { for (const t of e.tiles || []) this.after(rnd(0, 0.5), () => { const x = t.x + 0.5, y = t.y + 0.62; this.debris(x, y, '#7a6a52', 8, 2.6); this.shock(x, y, 'rgba(210,180,130,0.45)', 1.1, 0.35); this.mark('crack', x, y, 0.5, { life: 6 }); this.spike(x, y + 0.1, '#6a5a44', 0.45, 0.6, 0.2, 0, '#b9a27e'); this.kickCam(2); }); return true; }
        if (e.kind === 'manaSurge') { for (const id of e.ids || []) { const [x, y] = base(id); this.pillar(x, y, '#7fe0ff', 0.6, 0.9, 6); this.gather(x, y - 0.5, '#9df3ff', 14, 1.2, 0.5); this.orbit(x, y - 0.5, '#7fe0ff', 8, 0.5, 0.9, -0.5, 6); } this.flash(0.25, '#9df3ff'); return true; }
        if (e.kind === 'eclipse') { this.flash(0.5, '#1a0a2a'); return true; }
        if (e.kind === 'frenzy') { for (const id of e.ids || []) { const [x, y] = base(id); this.ring(x, y, '#ff4a2a', 1.6, 0.5, 0.06); this.burst(x, y - 0.4, '#ff6a3d', 8, 2, 'up'); this.glyph(x, y - 1, '#ff6a3d', 'speed', 0.8); } return true; }
        if (e.kind === 'bounty' && e.id != null) { const [x, y] = base(e.id); this.pillar(x, y, '#ffd24d', 0.6, 1.2, 8); this.rune(x, y, '#ffd24d', 1.6, 1.4, 2); this.glyph(x, y - 1.3, '#ffd24d', 'sword', 1.2); return true; }
        if (e.kind === 'restless') { for (const t of e.tiles || []) this.after(rnd(0, 0.3), () => this.waveSpawn(t.x + 0.5, t.y + 0.62, false)); return true; }
        return false;
      case 'bountyClaim': { const [x, y] = base(e.id); this.burst(x, y - 0.5, '#ffd24d', 24, 4, 'coin'); this.flare(x, y - 0.6, '#ffe9a8', 1.4, 0.3); this.ring(x, y, '#ffd24d', 2.6, 0.6, 0.1); this.pillar(x, y, '#ffd24d', 0.7, 0.9, 6); return true; }
      case 'split': { const [x, y] = base(e.id); this.burst(x, y - 0.4, '#8f8cff', 18, 3.5); this.smoke(x, y - 0.3, '#2a2450', 5); this.flare(x, y - 0.4, '#b9b6ff', 1, 0.2); for (const t of e.tiles || []) { this.proj({ x, y: y - 0.4 }, { x: t.x + 0.5, y: t.y + 0.5 }, '#b9b6ff', 0.3, 0.8, 0.08); this.after(0.3, () => this.burst(t.x + 0.5, t.y + 0.7, '#d9cfb8', 5, 1.2, 'dust')); } return true; }
      case 'shieldBreak': { const [x, y] = base(e.id); this.burst(x, y - 0.5, '#bfe4ff', 16, 4, 'shard'); this.glyph(x, y - 0.5, '#7fb6ff', 'shield', 0.4); this.flare(x, y - 0.5, '#bfe4ff', 1.2, 0.2); this.ring(x, y - 0.4, '#7fb6ff', 1.8, 0.3, 0.06); return true; }
      case 'summon': { const [x, y] = base(e.id); this.rune(x, y, '#a06bff', 2, 1, -2); this.gather(x, y - 0.6, '#c9a6ff', 16, 1.2, 0.4); for (const t of e.tiles || []) this.after(0.2, () => this.waveSpawn(t.x + 0.5, t.y + 0.62, false)); return true; }
      case 'enrage': { const [x, y] = base(e.id); this.ring(x, y, '#ff2a3a', 3, 0.6, 0.12); this.shock(x, y - 0.2, 'rgba(255,40,60,0.5)', 2.4, 0.45); this.burst(x, y - 0.6, '#ff3b2a', 20, 2.5, 'up'); this.burst(x, y - 0.4, '#ff9a3d', 10, 1.6, 'fire'); this.flare(x, y - 0.8, '#ff5a3a', 1.6, 0.3); this.mark('crack', x, y, 1, { life: 6, glow: '#ff2a3a' }); this.kickCam(6); return true; }
      case 'hill': { if (e.id == null) return false; const [x, y] = base(e.id); if (e.phase === 'score') { this.ring(x, y, '#ffd24d', 1.8, 0.6, 0.08); this.burst(x, y - 0.4, '#ffe9a8', 10, 1.6, 'up'); this.flare(x, y - 1.1, '#ffd24d', 0.8, 0.3); } else { this.ring(x, y, '#ff4d6d', 1.6, 0.5, 0.06); this.spray(x, y - 0.4, '#ff8a8a', 6, 2.5, -Math.PI / 2, 1.5); } return true; }
    }
    return false;
  }
  // per-move juice for new movement kinds: fx.moveFx(e) for how 'conveyor' | 'pull' | 'swap' (rift)
  moveFx(e) {
    const x = e.from.x + 0.5, y = e.from.y + 0.8;
    if (e.how === 'conveyor') { this.burst(x, y, '#cfc4ae', 3, 0.8, 'dust'); return true; }
    if (e.how === 'pull') { this.stream({ x, y: y - 0.4 }, { x: e.to.x + 0.5, y: e.to.y + 0.4 }, '#c77dff', 8, 0.3, 0.2); this.ribbon((k) => ({ x: x + (e.to.x + 0.5 - x) * k, y: y - 0.3 + (e.to.y + 0.8 - y) * k }), '#c77dff', 0.3, 0.1, 8); return true; }
    return false;
  }

  // ---------- simulation ----------
  update(dt) {
    this.time += dt;
    if (this.pending.length) { const now = this.time, due = []; let j = 0; for (const p of this.pending) { if (p.at <= now) due.push(p); else this.pending[j++] = p; } this.pending.length = j; for (const p of due) p.fn(); }
    const P = this.parts, pool = this.pool; let j = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.t += dt;
      if (p.t >= p.life) { if (pool.length < 900) pool.push(p); continue; }
      P[j++] = p;
      if (p.t < 0) continue;
      const k = p.kind;
      if (k === 'seek') { const q = Math.max(0, p.t / p.life), e = q * q * (3 - 2 * q), dx = p.bx - p.ax, dy = p.by - p.ay, l = Math.hypot(dx, dy) || 1, w = Math.sin(q * Math.PI) * p.off + Math.sin(p.ph + q * 9) * 0.04; const ox = p.x, oy = p.y; p.x = p.ax + dx * e - dy / l * w; p.y = p.ay + dy * e + dx / l * w; this.prev(p, ox, oy); continue; }
      if (k === 'spiral') { const q = p.t / p.life; const r = p.r * (1 - q * q); p.a += dt * (4 + q * 10); const ox = p.x, oy = p.y; p.x = p.cx + Math.cos(p.a) * r; p.y = p.cy + Math.sin(p.a) * r * 0.6; this.prev(p, ox, oy); continue; }
      if (k === 'orbit') { p.a += (p.va || 6) * dt; p.r += (p.rg || 0) * dt; p.cy += (p.rise || 0) * dt; const ox = p.x, oy = p.y; p.x = p.cx + Math.cos(p.a) * p.r; p.y = p.cy + Math.sin(p.a) * p.r * 0.45; this.prev(p, ox, oy); continue; }
      const drag = p.drag ?? 1.5;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.vx *= 1 - dt * drag; if (k === 'petal' || k === 'confetti' || k === 'smoke') p.vy *= 1 - dt * drag * 0.6;
      if (p.wind) p.vx += Math.sin(this.time * 3 + (p.ph || 0)) * p.wind * dt;
      p.rot = (p.rot || 0) + (p.vr || 0) * dt;
      if (p.floor != null && p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -(p.bounce ?? 0.35); p.vx *= 0.6; p.vr = (p.vr || 0) * 0.5; if (Math.abs(p.vy) < 0.25) { p.vy = 0; p.g = 0; p.vx *= 0.5; } }
    }
    P.length = j;
    if (P.length > this.capN) P.splice(0, P.length - this.capN);
    for (const s of this.shards) {
      if (s.t + dt < 0) continue;
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += s.g * dt; s.rot += s.vr * dt; s.vx *= 1 - dt * 1.2;
      if (s.y > s.floor && s.vy > 0) { s.y = s.floor; s.vy *= -0.3; s.vx *= 0.5; s.vr *= 0.4; if (Math.abs(s.vy) < 0.3) { s.vy = 0; s.vx *= 0.3; s.vr = 0; } }
    }
    const step = (a) => { let n = 0; for (const p of a) { p.t += dt; if (p.t < p.life) a[n++] = p; } a.length = n; return a; };
    step(this.shards); step(this.rings); step(this.beams); step(this.bolts); step(this.flashes); step(this.shocks); step(this.falls); step(this.pillars); step(this.decals);
    step(this.slashes); step(this.projs); step(this.implodes); step(this.glyphs); step(this.thrusts); step(this.flares); step(this.lights); step(this.runes); step(this.frames); step(this.spikes);
    step(this.halves); step(this.topples); step(this.glitches); step(this.swords); step(this.birds); step(this.funnels); step(this.giants);
    for (const r of this.ribbons) {
      r.t += dt; if (r.t < 0) continue;
      const k = Math.min(1, r.t / r.life); if (k < 1) { r.pts.push(r.fn(k)); if (r.pts.length > r.len) r.pts.shift(); } else if (r.pts.length) r.pts.shift();
    }
    this.ribbons = this.ribbons.filter((r) => r.t < 0 || r.t < r.life || r.pts.length > 0);
    // dissolving implodes shed petals / motes from the erosion line
    for (const im of this.implodes) if (im.dissolve && Math.random() < (this.lowQ ? 0.4 : 0.9)) { const k = im.t / im.life, yy = im.y - 1.05 * (1 - k); for (let i = 0; i < 2; i++) this.spawn({ kind: 'petal', x: im.x + rnd(-0.3, 0.3), y: yy, vx: rnd(1, 2.4), vy: -rnd(0.3, 1.2), g: 0.4, drag: 1.4, life: rnd(1.2, 1.8), color: Math.random() < 0.6 ? im.petal : '#ffffff', size: rnd(0.045, 0.075), rot: Math.random() * 6, vr: rnd(-6, 6), wind: 2.5, ph: Math.random() * 6 }); }
    for (const b of this.birds) if (Math.random() < (this.lowQ ? 0.4 : 1)) { const q = this.birdPos(b); this.spawn({ kind: 'fire', x: q.x + rnd(-0.15, 0.15), y: q.y + rnd(-0.1, 0.1), vx: rnd(-0.3, 0.3), vy: rnd(-0.6, 0), g: -0.8, life: rnd(0.3, 0.55), color: '#ff8a3d', c0: '#fff2a8', c1: '#5a1a08', size: rnd(0.06, 0.1) }); }
    for (const m of this.meteors) { m.t += dt; if (!m.done && m.t >= m.life) { m.done = true; this.shock(m.x, m.y + 0.2, 'rgba(255,170,90,0.55)', 1.8, 0.4); this.flare(m.x, m.y, m.color, 1.4, 0.3); this.burst(m.x, m.y, m.color, 22, 4.5); this.burst(m.x, m.y, m.color, 10, 4, 'ember'); this.burst(m.x, m.y, '#3a2a24', 14, 1.5, 'dust'); this.crater(m.x, m.y + 0.1, 0.6); this.mark('scorch', m.x, m.y + 0.1, 0.5, { glow: m.color, life: 10 }); this.ring(m.x, m.y + 0.3, '#ffd27a', 2.6, 0.5, 0.1); if (m.onHit) m.onHit(); this.kickCam(8); } }
    this.meteors = this.meteors.filter((m) => m.t < m.life + 0.05);
    for (const c of this.crowns) c.t += dt;
    this.crowns = this.crowns.filter((c) => c.t < c.life + (c.hold || 0) + 0.05);
    this.screenFlash = Math.max(0, this.screenFlash - dt * 3);
  }
  prev(p, ox, oy) { if (p.pv) { p.px = ox; p.py = oy; } else { p.pv = true; p.px = p.x; p.py = p.y; } }
  birdPos(b) { const k = Math.min(1, b.t / b.life), e = b.rise ? k * k : k, u = 1 - e; return { x: u * u * b.x0 + 2 * u * e * b.x1 + e * e * b.x2, y: u * u * b.y0 + 2 * u * e * b.y1 + e * e * b.y2, k, e }; }

  // ---------- drawing: ground layer (under pieces) ----------
  drawGround(ctx) {
    for (const d of this.decals) {
      if (d.t < 0) continue;
      const a = Math.min(1, d.t / 0.12) * (d.t < d.life - 1.2 ? 1 : Math.max(0, (d.life - d.t) / 1.2)), grow = 0.7 + 0.3 * Math.min(1, d.t / 0.15);
      ctx.save(); ctx.translate(d.x, d.y); ctx.scale(1, 0.55); ctx.rotate(d.rot); ctx.globalAlpha = a;
      const r = d.r * grow; ctx.drawImage(decalSprite(d.type, d.color, d.v), -r, -r, r * 2, r * 2);
      if (d.glow && d.t < d.glowLife) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * (1 - d.t / d.glowLife) * 0.9; const rr = r * 0.9; ctx.drawImage(glowSprite(d.glow), -rr, -rr, rr * 2, rr * 2); ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lights) { const k = l.t / l.life, a = (1 - k) * (1 - k) * 0.7; ctx.globalAlpha = a; ctx.drawImage(glowSprite(l.color), l.x - l.r, l.y - l.r * 0.55, l.r * 2, l.r * 1.1); }
    for (const r of this.runes) {
      if (r.t < 0) continue;
      const k = r.t / r.life, a = Math.min(1, k * 6) * (k > 0.6 ? (1 - k) / 0.4 : 1), rad = r.r * 0.5 * (0.7 + 0.3 * Math.min(1, k * 4));
      ctx.save(); ctx.translate(r.x, r.y); ctx.scale(1, 0.55); ctx.rotate(this.time * r.spin); ctx.globalAlpha = a * 0.9;
      ctx.drawImage(decalSprite('rune', r.color, 0), -rad, -rad, rad * 2, rad * 2);
      if (!this.lowQ) { ctx.globalAlpha = a * 0.35; ctx.drawImage(glowSprite(r.color), -rad, -rad, rad * 2, rad * 2); }
      ctx.restore();
    }
    for (const f of this.flashes) {
      if (f.t < 0) continue;
      const k = f.t / f.life, a = (1 - k);
      ctx.globalAlpha = a * a * 0.4; ctx.fillStyle = f.color; ctx.fillRect(f.x + 0.04, f.y + 0.04, 0.92, 0.92);
      ctx.globalAlpha = a * 0.5; ctx.strokeStyle = f.color; ctx.lineWidth = 0.025; ctx.strokeRect(f.x + 0.06 + k * 0.08, f.y + 0.06 + k * 0.08, 0.88 - k * 0.16, 0.88 - k * 0.16);
    }
    ctx.globalCompositeOperation = 'source-over';
    let distorts = 0;
    for (const s of this.shocks) {
      const k = s.t / s.life, r = s.r * (0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
      if (s.distort && !this.lowQ && !this.calm && distorts < 1 && k < 0.6) { distorts++; this.lens(ctx, s.x, s.y, r, 1 - k / 0.6); }
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(shockSprite(s.color), s.x - r, s.y - r * 0.6, r * 2, r * 1.2);
    }
    ctx.globalAlpha = 1;
  }
  // refraction ring: copies the canvas under an annulus slightly magnified, so the floor visibly bends
  lens(ctx, x, y, r, str) {
    const m = ctx.getTransform(), cv = ctx.canvas;
    const cx = m.a * x + m.c * y + m.e, cy = m.b * x + m.d * y + m.f, sc = Math.hypot(m.a, m.b);
    const R = r * sc * 0.5, Ry = R * 0.6; if (R < 8 || R > 2000) return;
    const sx = Math.max(0, cx - R * 1.3), sy = Math.max(0, cy - Ry * 1.3), sw = Math.min(cv.width, cx + R * 1.3) - sx, sh = Math.min(cv.height, cy + Ry * 1.3) - sy;
    if (sw < 4 || sh < 4) return;
    const z = 1 + 0.07 * str;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.12, Ry * 1.12, 0, 0, TAU); ctx.ellipse(cx, cy, R * 0.78, Ry * 0.78, 0, 0, TAU); ctx.clip('evenodd');
    ctx.globalAlpha = 0.9 * str;
    try { ctx.drawImage(cv, sx, sy, sw, sh, cx - (cx - sx) * z, cy - (cy - sy) * z, sw * z, sh * z); } catch (e) { /* tainted or zero-size: skip */ }
    ctx.restore();
  }
  drawFalls(ctx, theme) {
    for (const f of this.falls) {
      if (f.t < 0) continue;
      const k = f.t / f.life, e = k * k;
      ctx.save();
      ctx.globalAlpha = 1 - e;
      ctx.translate(f.x + 0.5, f.y + 0.5 + e * 2.2); ctx.rotate(f.rot * e); ctx.scale(1 - e * 0.6, 1 - e * 0.6);
      ctx.fillStyle = f.color; ctx.fillRect(-0.5, -0.5, 1, 1);
      ctx.fillStyle = 'rgba(255,90,40,' + (0.6 * (1 - k)) + ')'; ctx.fillRect(-0.5, 0.42, 1, 0.08);
      ctx.restore();
    }
    void theme;
  }

  // ---------- drawing: above pieces ----------
  drawSprite(ctx, img, x, y, sc = 1, rot = 0, alpha = 1, add = false) {
    ctx.save(); ctx.globalAlpha = alpha; if (add) ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale(sc / SPR, sc / SPR); ctx.drawImage(img, -48, -112); ctx.restore();
  }
  drawAbove(ctx) {
    const T = this.time, lowQ = this.lowQ;
    // spikes (rock / ice / thorns) rising from the floor
    for (const s of this.spikes) {
      if (s.t < 0) continue;
      const k = s.t / s.life, up = k < 0.15 ? 1 - Math.pow(1 - k / 0.15, 3) : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1, h = s.h * up;
      ctx.globalAlpha = Math.min(1, up * 1.5);
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.moveTo(s.x - s.w / 2, s.y); ctx.lineTo(s.x + s.lean * h, s.y - h); ctx.lineTo(s.x + s.w / 2, s.y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = s.tip; ctx.globalAlpha *= 0.7; ctx.beginPath(); ctx.moveTo(s.x - s.w * 0.1, s.y - h * 0.1); ctx.lineTo(s.x + s.lean * h, s.y - h); ctx.lineTo(s.x + s.w * 0.3, s.y - h * 0.15); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // funnels: tornado / whirlpool / accretion disk
    for (const f of this.funnels) {
      const k = f.t / f.life, a = Math.min(1, k * 5) * (k > 0.75 ? (1 - k) / 0.25 : 1);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = f.color; ctx.lineCap = 'round';
      if (f.disk) { for (let i = 0; i < 3; i++) { const r = (1.4 - k * 1.2) * (1 - i * 0.22); ctx.globalAlpha = a * (0.6 - i * 0.15); ctx.lineWidth = 0.06; ctx.beginPath(); ctx.ellipse(f.x, f.y, r, r * 0.3, -0.25, T * (8 + i * 3), T * (8 + i * 3) + 4.2); ctx.stroke(); } }
      else {
        const H = f.water ? 1.6 : 3.4, rings = lowQ ? 6 : 11;
        for (let i = 0; i < rings; i++) { const q = i / (rings - 1), yy = f.y - q * H * Math.min(1, k * 3), r = f.water ? 0.7 * (1 - q * 0.6) : 0.18 + q * q * 1.1; ctx.globalAlpha = a * (f.water ? 0.5 : 0.35) * (1 - q * 0.4); ctx.lineWidth = f.water ? 0.07 : 0.05; const sp = T * (f.water ? -9 : 12) + i * 0.7; ctx.beginPath(); ctx.ellipse(f.x + Math.sin(T * 3 + q * 4) * 0.12 * q, yy, r, r * 0.3, 0, sp, sp + 4.4); ctx.stroke(); }
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pillars) {
      const a = Math.sin((p.t / p.life) * Math.PI), fl = 0.85 + 0.15 * Math.sin(T * 40 + p.x * 7);
      ctx.globalAlpha = a * fl; ctx.drawImage(pillarSprite(p.color), p.x - p.w * 0.6 * a, p.y - p.h, p.w * 1.2 * a, p.h + 0.3);
      ctx.globalAlpha = a * 0.8; ctx.drawImage(pillarSprite('#ffffff'), p.x - p.w * 0.16 * a, p.y - p.h, p.w * 0.32 * a, p.h + 0.3);
      if (!lowQ) { ctx.globalAlpha = a * 0.6; ctx.drawImage(glowSprite(p.color), p.x - p.w * 1.3, p.y - p.w * 0.5, p.w * 2.6, p.w); }
    }
    for (const b of this.beams) {
      const k = b.t / b.life, a = 1 - k, grow = Math.min(1, b.t / 0.06), fl = 0.8 + 0.2 * Math.sin(T * 50 + b.ph);
      const ex = b.a.x + (b.b.x - b.a.x) * grow, ey = b.a.y + (b.b.y - b.a.y) * grow;
      ctx.lineCap = 'round'; ctx.strokeStyle = b.color;
      ctx.beginPath(); ctx.moveTo(b.a.x, b.a.y); ctx.lineTo(ex, ey);
      if (!lowQ) { ctx.globalAlpha = a * 0.25 * fl; ctx.lineWidth = b.w * 3.2 * a; ctx.stroke(); }
      ctx.globalAlpha = a * 0.55 * fl; ctx.lineWidth = b.w * 1.6 * a; ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = b.w * 0.7 * a; ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = b.w * 0.25 * a; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt';
    // sprite-based finisher actors
    for (const im of this.implodes) {
      const k = im.t / im.life;
      if (im.dissolve) { // erode from the top down
        const cut = 112 - 112 * (1 - k) - 4; ctx.save(); ctx.translate(im.x, im.y); ctx.scale(1 / SPR, 1 / SPR); ctx.beginPath(); ctx.rect(-48, cut - 112 + 0, 96, 120); ctx.clip(); ctx.drawImage(im.img, -48, -112); ctx.restore(); continue; }
      if (im.sweep) { // tint sweeps up (or down) over the original sprite
        const kk = Math.min(1, k * 1.6), line = im.up ? 112 * (1 - kk) : 112 * kk;
        this.drawSprite(ctx, im.sweep, im.x, im.y);
        ctx.save(); ctx.translate(im.x, im.y); ctx.scale(1 / SPR, 1 / SPR); ctx.beginPath(); if (im.up) ctx.rect(-48, line - 112, 96, 120); else ctx.rect(-48, -112, 96, line); ctx.clip(); ctx.drawImage(im.img, -48, -112); ctx.restore();
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.8 * (1 - kk * 0.5); ctx.fillStyle = '#ffffff'; ctx.fillRect(im.x - 0.4, im.y - 1.4 + (line / SPR), 0.8, 0.03); ctx.restore();
        continue;
      }
      if (im.launch) { const e = k * k; this.drawSprite(ctx, im.img, im.x + Math.sin(k * 30) * 0.03, im.y - e * 4.5, 1 - k * 0.3, Math.sin(k * 20) * 0.1, 1); continue; }
      if (im.spin) { const e = k * k; ctx.save(); ctx.translate(im.x + e * 1.6, im.y - e * 3.2 - Math.min(1, k * 4) * 0.3); ctx.rotate(e * 1.4); ctx.scale(Math.cos(T * 18) / SPR * (1 - e * 0.4), (1 - e * 0.4) / SPR); ctx.globalAlpha = 1 - Math.max(0, (k - 0.8) / 0.2); ctx.drawImage(im.img, -48, -70); ctx.restore(); continue; }
      if (im.sink) { const e = Math.min(1, k * 1.1); ctx.save(); ctx.translate(im.x, im.y); ctx.beginPath(); ctx.rect(-0.8, -2, 1.6, 2); ctx.clip(); ctx.translate(0, e * 1.2); ctx.rotate(Math.sin(k * 25) * 0.15 * k); ctx.scale(1 / SPR, 1 / SPR); ctx.globalAlpha = 1 - e * 0.3; ctx.drawImage(im.img, -48, -112); ctx.restore(); continue; }
      if (im.swell) { const p = 1 + k * 0.25 + Math.sin(k * 40) * 0.04 * k; this.drawSprite(ctx, im.img, im.x, im.y + (p - 1) * 0.3, p, 0, 0.6 + 0.4 * k, true); continue; }
      if (im.wobble) { const s = 1 + Math.sin(k * 30) * 0.08 * (1 + k); ctx.save(); ctx.translate(im.x, im.y); ctx.scale(s / SPR, (2 - s) / SPR); ctx.drawImage(im.img, -48, -112); ctx.restore(); continue; }
      const sc = im.hold ? 1 : im.rise ? 1 - k * 0.3 : 1 - k * k;
      const wx = im.wave ? Math.sin(k * 14) * 0.12 * k : 0;
      ctx.save(); ctx.globalAlpha = im.hold ? 1 : im.rise ? 1 - k : 1 - k * 0.3; if (im.add) ctx.globalCompositeOperation = 'lighter';
      ctx.translate(im.x + wx, im.y - (im.hold ? 0 : im.rise ? k * k * 3 : k * 0.4)); ctx.rotate(im.hold || im.rise ? 0 : k * k * 6); ctx.scale(sc / SPR, sc / SPR);
      ctx.drawImage(im.img, -48, -112);
      ctx.restore();
    }
    for (const h of this.halves) {
      const k = h.t / h.life, slide = Math.min(1, k * 2.5), e = 1 - Math.pow(1 - slide, 2), fall = Math.max(0, k - 0.25);
      ctx.save(); ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.translate(h.x + h.dir * e * 0.32, h.y + fall * fall * 0.6); ctx.rotate(h.dir * e * 0.5); ctx.scale(1 / SPR, 1 / SPR); ctx.drawImage(h.img, -48, -112); ctx.restore();
      if (k < 0.3 && !lowQ) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k / 0.3; ctx.strokeStyle = '#fff1c4'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(h.x + 0.05, h.y - 1.3); ctx.lineTo(h.x - 0.05, h.y); ctx.stroke(); ctx.restore(); }
    }
    for (const tp of this.topples) {
      const k = tp.t / tp.life, q = Math.min(1, k / 0.38), fallA = q < 1 ? q * q * (Math.PI / 2) : Math.PI / 2 - Math.abs(Math.sin((k - 0.38) * 14)) * 0.18 * Math.max(0, 1 - (k - 0.38) * 3);
      const roll = k > 0.38 ? Math.sin((k - 0.38) * 8) * 0.05 : 0, alpha = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(tp.x + tp.dir * 0.22 + roll, tp.y); ctx.rotate(tp.dir * fallA); ctx.scale(1 / SPR, 1 / SPR); ctx.drawImage(tp.img, -48 - tp.dir * 18, -112); ctx.restore();
    }
    for (const g of this.glitches) {
      const k = g.t / g.life, rows = lowQ ? 6 : 12, rh = 120 / rows, jit = 0.6 + k * 2.5;
      ctx.save(); ctx.translate(g.x, g.y); ctx.scale(1 / SPR, 1 / SPR);
      for (let i = 0; i < rows; i++) { const tear = Math.random() < 0.35 * jit ? rnd(-14, 14) * jit : 0, keep = Math.random() > k * k * 0.9; if (!keep) continue; ctx.globalAlpha = 1; ctx.drawImage(g.img, 0, i * rh, 96, rh, -48 + tear, -112 + i * rh, 96, rh); }
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 + k * 0.4; const off = 3 + k * 10;
      ctx.drawImage(g.c, -48 - off, -112); ctx.drawImage(g.m, -48 + off, -112);
      ctx.restore();
      if (Math.random() < 0.5) { ctx.globalAlpha = 0.6; ctx.fillStyle = pick(['#00f0ff', '#ff3df2', '#ffffff']); ctx.fillRect(g.x - 0.6, g.y - rnd(0, 1.1), rnd(0.3, 1.2), 0.03); ctx.globalAlpha = 1; }
    }
    for (const g of this.giants) {
      const k = g.t / g.life, q = Math.min(1, g.t / g.fall), ang = q * q * (Math.PI / 2) - (q >= 1 ? Math.abs(Math.sin((g.t - g.fall) * 16)) * 0.06 * Math.max(0, 1 - (g.t - g.fall) * 3) : 0);
      const a = Math.min(1, k * 8) * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.dir * ang); ctx.scale(g.sc / SPR, g.sc / SPR);
      ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(g.img, -48, -112);
      if (!lowQ) { ctx.globalAlpha = a * 0.5; ctx.drawImage(glowSprite('#ff4d8d'), -70, -130, 140, 150); }
      ctx.restore();
    }
    for (const s of this.swords) {
      const fall = Math.min(1, s.t / s.fall), e = fall * fall, k = s.t / s.life, by = s.y - 9 * (1 - e) + 0.15, a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      ctx.save(); ctx.translate(s.x, by); ctx.globalAlpha = a;
      if (fall < 1 && !lowQ) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4; ctx.fillStyle = s.color; ctx.fillRect(-0.08, -4.5, 0.16, 3); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a; }
      const L = 1.9; // blade tip at 0, hilt above
      ctx.fillStyle = '#e8ecf4'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.13, -0.3); ctx.lineTo(0.11, -L); ctx.lineTo(-0.11, -L); ctx.lineTo(-0.13, -0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9aa4b8'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.13, -0.3); ctx.lineTo(0.11, -L); ctx.lineTo(0, -L); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd24d'; ctx.fillRect(-0.4, -L - 0.09, 0.8, 0.11); ctx.fillStyle = '#7a5208'; ctx.fillRect(-0.05, -L - 0.55, 0.1, 0.46); ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(0, -L - 0.6, 0.09, 0, TAU); ctx.fill();
      if (fall >= 1) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * (0.5 + 0.3 * Math.sin(T * 12)); ctx.drawImage(glowSprite('#ffd24d'), -0.5, -L - 0.4, 1, 1.4 + L * 0.3); }
      ctx.restore();
    }
    // shards
    for (const s of this.shards) {
      if (s.t < 0) continue;
      const a = Math.min(1, (s.life - s.t) / 0.35);
      ctx.save(); ctx.globalAlpha = a; if (s.add) ctx.globalCompositeOperation = 'lighter';
      ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.scale(s.scale, s.scale);
      ctx.drawImage(s.img, -s.sw / 2, -s.sh / 2);
      ctx.restore();
    }
    // normal-blend particles: debris, coins, smoke, petals, confetti, bubbles
    const P = this.parts;
    for (const p of P) {
      if (p.t < 0) continue;
      const k = p.t / p.life, a = 1 - k, kind = p.kind;
      if (!NORMAL.has(kind) && !(kind === 'fire' && k > 0.62)) continue;
      if (kind === 'dust' || kind === 'smoke' || kind === 'fire') {
        const sz = p.size * (kind === 'smoke' ? 1.4 + k * 2 : kind === 'fire' ? 1.6 + k * 2 : 1.2 + k * 2.5);
        ctx.globalAlpha = kind === 'smoke' ? Math.sin(k * Math.PI) * 0.6 : kind === 'fire' ? (1 - k) * 1.1 : a * a * 0.5;
        ctx.drawImage(softSprite(kind === 'fire' ? (p.c1 || '#3a1a0c') : p.color), p.x - sz, p.y - sz, sz * 2, sz * 2); continue;
      }
      ctx.globalAlpha = Math.min(1, a * 2.5) * (p.al ?? 1); ctx.fillStyle = p.color;
      if (kind === 'chunk') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.18); ctx.restore(); }
      else if (kind === 'tile') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore(); }
      else if (kind === 'confetti') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * 0.3); ctx.scale(Math.cos(p.rot), 1); ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6); ctx.restore(); }
      else if (kind === 'coin') { ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.abs(Math.cos(p.rot)) + 0.15, 1); ctx.beginPath(); ctx.arc(0, 0, p.size, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(-p.size * 0.3, -p.size * 0.3, p.size * 0.35, 0, TAU); ctx.fill(); ctx.restore(); }
      else if (kind === 'petal') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, 0.4 + Math.abs(Math.sin(p.rot * 1.3)) * 0.6); ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, TAU); ctx.fill(); ctx.restore(); }
      else if (kind === 'shard') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.5, p.size * 0.6); ctx.lineTo(-p.size * 0.5, p.size * 0.4); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.01; ctx.stroke(); ctx.restore(); }
      else if (kind === 'bubble') { ctx.strokeStyle = p.color; ctx.lineWidth = 0.015; ctx.beginPath(); ctx.arc(p.x + Math.sin(p.t * 9 + p.ph) * 0.05, p.y, p.size * 0.8, 0, TAU); ctx.stroke(); }
    }
    // additive layer
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (const r of this.ribbons) { // tapered filled strip: wide soft pass + bright core pass
      const pts = r.pts, n = pts.length; if (n < 2) continue;
      if (!r.add) ctx.globalCompositeOperation = 'source-over';
      const fade = r.t > r.life ? 0.7 : 1;
      for (const [wm, al, col] of lowQ || !r.add ? [[1, 0.9, r.color]] : [[1.8, 0.35, r.color], [0.8, 0.95, r.color], [0.3, 0.9, '#ffffff']]) {
        ctx.beginPath();
        for (let side = 0; side < 2; side++) for (let ii = 0; ii < n; ii++) {
          const i = side ? n - 1 - ii : ii, a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
          let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
          const w = r.w * wm * 0.5 * (i / (n - 1)) * (side ? -1 : 1), x = pts[i].x - dy * w, y = pts[i].y + dx * w;
          if (side === 0 && ii === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.globalAlpha = al * fade; ctx.fillStyle = col; ctx.fill();
      }
      if (r.add && !lowQ) { const h = pts[n - 1]; ctx.globalAlpha = fade * 0.8; const s = r.w * 2.5; ctx.drawImage(glowSprite(r.color), h.x - s, h.y - s, s * 2, s * 2); }
      if (!r.add) ctx.globalCompositeOperation = 'lighter';
    }
    for (const s of this.slashes) { // filled crescent: thick in the middle of the sweep, sharp tips
      const k = s.t / s.life, a = 1 - k, sweep = Math.min(1, k * 4) * 2.4, a0 = s.ang, a1 = s.ang + sweep, th = 0.12 * s.w * (1 - k * 0.5);
      ctx.globalAlpha = a; ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, a0, a1); ctx.arc(s.x + Math.cos((a0 + a1) / 2) * th, s.y + Math.sin((a0 + a1) / 2) * th, s.r - th * 0.2, a1, a0, true); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.025 * s.w * a; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, a0 + sweep * 0.1, a1); ctx.stroke();
      if (!lowQ) { const m = (a0 + a1) / 2; ctx.globalAlpha = a * 0.5; const gs = s.r * 0.9; ctx.drawImage(glowSprite(s.color), s.x + Math.cos(m) * s.r - gs / 2, s.y + Math.sin(m) * s.r - gs / 2, gs, gs); }
    }
    for (const th of this.thrusts) {
      const k = th.t / th.life, out = Math.min(1, th.t / 0.07), a = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
      const dx = th.b.x - th.a.x, dy = th.b.y - th.a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      const tx = th.a.x + dx * out, ty = th.a.y + dy * out, tail = Math.max(0, out - 0.75 - k * 0.4);
      const sx = th.a.x + dx * tail, sy = th.a.y + dy * tail, w = th.w * (1 - k * 0.5);
      ctx.globalAlpha = a * 0.45; ctx.fillStyle = th.color;
      ctx.beginPath(); ctx.moveTo(sx + nx * w * 1.6, sy + ny * w * 1.6); ctx.lineTo(tx + dx / l * 0.25, ty + dy / l * 0.25); ctx.lineTo(sx - nx * w * 1.6, sy - ny * w * 1.6); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = a; ctx.beginPath(); ctx.moveTo(sx + nx * w * 0.6, sy + ny * w * 0.6); ctx.lineTo(tx + dx / l * 0.18, ty + dy / l * 0.18); ctx.lineTo(sx - nx * w * 0.6, sy - ny * w * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(sx + nx * w * 0.2, sy + ny * w * 0.2); ctx.lineTo(tx + dx / l * 0.14, ty + dy / l * 0.14); ctx.lineTo(sx - nx * w * 0.2, sy - ny * w * 0.2); ctx.closePath(); ctx.fill();
    }
    for (const p of this.projs) {
      const k = p.t / p.life, x = p.a.x + (p.b.x - p.a.x) * k, y = p.a.y + (p.b.y - p.a.y) * k - Math.sin(k * Math.PI) * p.arc, s = p.size;
      ctx.globalAlpha = 1; ctx.drawImage(glowSprite(p.color), x - s * 3, y - s * 3, s * 6, s * 6);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, TAU); ctx.fill();
      if (Math.random() < 0.7) this.spawn({ x, y, vx: rnd(-0.5, 0.5), vy: rnd(-0.5, 0.5), g: 2, life: 0.3, color: p.color, size: 0.035, kind: 'ember', ph: Math.random() * 6 });
    }
    for (const b of this.bolts) {
      const k = b.t / b.life, a = (1 - k) * (0.7 + 0.3 * Math.sin(T * 60)); ctx.strokeStyle = b.color; ctx.lineJoin = 'round';
      const pass = (pts, wmul) => { for (const [w, al] of lowQ ? [[0.1, 1]] : [[0.42, 0.22], [0.16, 0.6], [0.06, 1]]) { ctx.lineWidth = w * wmul; ctx.globalAlpha = a * al; ctx.strokeStyle = al === 1 ? '#ffffff' : b.color; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); } };
      pass(b.pts, 1); for (const f of b.forks || []) pass(f, 0.5);
    }
    for (const r of this.rings) {
      if (r.t < 0) continue;
      const k = r.t / r.life, e = 1 - Math.pow(1 - k, 3), rad = (r.inward ? 1 - e : e) * r.r * 0.5;
      ctx.globalAlpha = r.inward ? Math.min(1, k * 4) * (1 - k * 0.5) : 1 - k; ctx.strokeStyle = r.color; ctx.lineWidth = r.w * (1 - k) + 0.01;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, Math.max(0.01, rad), Math.max(0.01, rad * 0.55), 0, 0, TAU); ctx.stroke();
      if (!lowQ && r.w >= 0.08) { ctx.globalAlpha *= 0.5; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = r.w * 0.3 * (1 - k); ctx.beginPath(); ctx.ellipse(r.x, r.y, Math.max(0.01, rad * 0.94), Math.max(0.01, rad * 0.517), 0, 0, TAU); ctx.stroke(); }
    }
    // additive particles
    for (const p of P) {
      if (p.t < 0) continue;
      const kind = p.kind; if (NORMAL.has(kind)) continue;
      const k = p.t / p.life, a = 1 - k;
      if (kind === 'fire') { if (k > 0.62) continue; const c = k < 0.22 ? p.c0 || '#fff2a8' : p.color, sz = p.size * (1.5 + k * 1.8); ctx.globalAlpha = Math.min(1, (1 - k / 0.62) * 1.4); ctx.drawImage(glowSprite(c), p.x - sz, p.y - sz, sz * 2, sz * 2); continue; }
      if (kind === 'glow') { const sz = p.size * (1 + k * 0.6); ctx.globalAlpha = Math.sin(k * Math.PI) * 0.35; ctx.drawImage(glowSprite(p.color), p.x - sz, p.y - sz, sz * 2, sz * 2); continue; }
      if (kind === 'star') { const sz = p.size * Math.sin(k * Math.PI) * 4; ctx.globalAlpha = 1; ctx.drawImage(flareSprite(p.color), p.x - sz, p.y - sz, sz * 2, sz * 2); continue; }
      let al = kind === 'seek' || kind === 'spiral' || kind === 'orbit' ? Math.min(1, a * 2.5) : a;
      if (kind === 'ember') al *= 0.55 + 0.45 * Math.sin(p.t * 28 + (p.ph || 0));
      ctx.globalAlpha = Math.max(0, al);
      const s = p.size * (kind === 'spark' || kind === 'ember' ? 0.5 + 0.5 * a : 1);
      if (kind === 'spark' || kind === 'ember') {
        const sp = Math.abs(p.vx) + Math.abs(p.vy);
        if (sp > 1.2) { ctx.strokeStyle = p.color; ctx.lineWidth = s * 0.9; ctx.beginPath(); ctx.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.lineTo(p.x, p.y); ctx.stroke(); }
      } else if (p.px != null && !lowQ) { ctx.strokeStyle = p.color; ctx.lineWidth = s * 0.9; ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke(); }
      const gs = s * (lowQ ? 2.2 : 3.6); ctx.drawImage(glowSprite(p.color), p.x - gs, p.y - gs, gs * 2, gs * 2);
    }
    for (const f of this.flares) {
      if (f.t < 0) continue;
      const k = f.t / f.life, sz = f.size * (f.grow ? 0.2 + k * 1.2 : (0.6 + 0.4 * Math.min(1, k * 6)) * (1 - k * 0.4));
      ctx.globalAlpha = f.grow ? Math.min(1, 0.3 + k) : 1 - k * k;
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot + (f.grow ? T * 2 : 0)); ctx.drawImage(flareSprite(f.color), -sz, -sz, sz * 2, sz * 2); ctx.restore();
    }
    for (const b of this.birds) {
      const q = this.birdPos(b), nx = this.birdPos({ ...b, t: Math.min(b.life, b.t + 0.02) }), dir = Math.atan2(nx.y - q.y, nx.x - q.x || 0.0001), flap = Math.sin(b.t * (b.rise ? 14 : 22)), s = b.s, a = q.k > 0.85 ? (1 - q.k) / 0.15 : 1;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(dir); ctx.globalAlpha = a;
      for (const side of [-1, 1]) { ctx.fillStyle = side < 0 ? '#ffd27a' : b.color; ctx.beginPath(); ctx.moveTo(0.1 * s, 0); ctx.quadraticCurveTo(-0.15 * s, side * (0.5 + flap * 0.3) * s, -0.55 * s, side * (0.75 + flap * 0.45) * s); ctx.quadraticCurveTo(-0.25 * s, side * 0.25 * s, -0.3 * s, 0); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#fff2a8'; ctx.beginPath(); ctx.ellipse(0, 0, 0.32 * s, 0.09 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.moveTo(-0.3 * s, 0); ctx.lineTo(-0.85 * s, -0.12 * s); ctx.lineTo(-0.75 * s, 0); ctx.lineTo(-0.85 * s, 0.12 * s); ctx.closePath(); ctx.fill();
      const gs = 0.6 * s; ctx.drawImage(glowSprite('#ff8a3d'), -gs, -gs, gs * 2, gs * 2);
      ctx.restore();
    }
    for (const m of this.meteors) {
      if (m.t < 0) continue;
      const k = Math.min(1, m.t / m.life), sx = m.x - 5 * (1 - k), sy = m.y - 9 * (1 - k);
      ctx.globalAlpha = 1; ctx.drawImage(glowSprite(m.color), sx - 0.6, sy - 0.6, 1.2, 1.2);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 0.14, 0, TAU); ctx.fill();
      if (lowQ) { ctx.strokeStyle = m.color; ctx.lineWidth = 0.25; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(sx - 1.6, sy - 2.9); ctx.lineTo(sx, sy); ctx.stroke(); }
      if (Math.random() < 0.8) this.spawn({ x: sx, y: sy, vx: (Math.random() - 0.5), vy: -Math.random(), g: 0, life: 0.4, color: m.color, size: 0.06, kind: 'ember', ph: Math.random() * 6 });
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    for (const g of this.glyphs) {
      const k = g.t / g.life, a = Math.sin(k * Math.PI);
      ctx.save(); ctx.translate(g.x, g.y - k * 0.6);
      if (!lowQ) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.5; ctx.drawImage(glowSprite(g.color), -0.6, -0.6, 1.2, 1.2); ctx.globalCompositeOperation = 'source-over'; }
      ctx.globalAlpha = a; ctx.strokeStyle = g.color; ctx.fillStyle = g.color; ctx.lineWidth = 0.05;
      if (g.kind === 'shield') { ctx.beginPath(); for (let i = 0; i < 6; i++) { const an = i / 6 * TAU + Math.PI / 6; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(an) * 0.42, Math.sin(an) * 0.42); } ctx.closePath(); ctx.stroke(); ctx.globalAlpha = a * 0.2; ctx.fill(); }
      else if (g.kind === 'heal') { ctx.fillRect(-0.06, -0.24, 0.12, 0.48); ctx.fillRect(-0.24, -0.06, 0.48, 0.12); }
      else if (g.kind === 'speed') { for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-0.35 + k * 0.2, i * 0.15); ctx.lineTo(0.35 + k * 0.2, i * 0.15); ctx.stroke(); } }
      else if (g.kind === 'holy') { ctx.lineWidth = 0.07; ctx.beginPath(); ctx.moveTo(0, -0.34); ctx.lineTo(0, 0.34); ctx.moveTo(-0.2, -0.12); ctx.lineTo(0.2, -0.12); ctx.stroke(); }
      else if (g.kind === 'sword') { ctx.beginPath(); ctx.moveTo(0, -0.42); ctx.lineTo(0.06, -0.3); ctx.lineTo(0.06, 0.12); ctx.lineTo(-0.06, 0.12); ctx.lineTo(-0.06, -0.3); ctx.closePath(); ctx.fill(); ctx.fillRect(-0.2, 0.12, 0.4, 0.06); ctx.fillRect(-0.03, 0.18, 0.06, 0.16); }
      else if (g.kind === 'swap') { ctx.rotate(T * 3); ctx.beginPath(); ctx.arc(0, 0, 0.35, 0, Math.PI * 1.4); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 0.22, Math.PI, Math.PI * 2.4); ctx.stroke(); }
      ctx.restore();
    }
    for (const c of this.crowns) {
      const k = Math.min(1, c.t / c.life), yy = c.y - (1 - k * k) * 6;
      const fade = c.hold && c.t > c.life ? Math.max(0, 1 - (c.t - c.life) / c.hold) : 1, bob = c.hold && c.t > c.life ? Math.sin((c.t - c.life) * 6) * 0.04 : 0;
      ctx.save(); ctx.translate(c.x, yy + bob); ctx.scale(0.9, 0.9); ctx.globalAlpha = fade;
      if (!lowQ) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7 * fade; ctx.drawImage(glowSprite('#ffd24d'), -0.7, -0.7, 1.4, 1.2); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = fade; }
      ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#7a5208'; ctx.lineWidth = 0.03;
      ctx.beginPath(); ctx.moveTo(-0.32, 0.16); ctx.lineTo(-0.36, -0.2); ctx.lineTo(-0.16, -0.03); ctx.lineTo(0, -0.28); ctx.lineTo(0.16, -0.03); ctx.lineTo(0.36, -0.2); ctx.lineTo(0.32, 0.16); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff6d0'; ctx.fillRect(-0.3, 0.06, 0.6, 0.04); ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(0, 0.02, 0.045, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // screen-space impact frames, drawn in world units over the whole visible area
    if (this.frames.length) {
      const inv = ctx.getTransform().inverse(), W = ctx.canvas.width, H = ctx.canvas.height;
      const cs = [[0, 0], [W, 0], [0, H], [W, H]].map(([px, py]) => [inv.a * px + inv.c * py + inv.e, inv.b * px + inv.d * py + inv.f]);
      const x0 = Math.min(...cs.map((q) => q[0])), x1 = Math.max(...cs.map((q) => q[0])), y0 = Math.min(...cs.map((q) => q[1])), y1 = Math.max(...cs.map((q) => q[1]));
      for (const f of this.frames) {
        const k = f.t / f.life, R = Math.hypot(x1 - x0, y1 - y0);
        if (k < 0.4) { ctx.globalAlpha = 0.22 * (1 - k / 0.4); ctx.fillStyle = '#000000'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
        ctx.globalAlpha = 0.55 * (1 - k); ctx.fillStyle = f.color;
        for (const [an, w, l] of f.ang) { const r0 = 0.9 + k * 1.5, r1 = R * l, c = Math.cos(an), s = Math.sin(an), ww = w * R; ctx.beginPath(); ctx.moveTo(f.x + c * r0, f.y + s * r0); ctx.lineTo(f.x + c * r1 - s * ww, f.y + s * r1 + c * ww); ctx.lineTo(f.x + c * r1 + s * ww, f.y + s * r1 - c * ww); ctx.closePath(); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}
export { skinOf };

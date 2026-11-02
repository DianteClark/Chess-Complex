// 10.0 world renderer helpers (A5): tile materials, baked board art, 2D lighting, storm void,
// weather/atmosphere, unit shadows/status icons/shields, overlays. All heavy art is cached on
// offscreen canvases; per-frame work is blits and batched paths. lowQ skips the light map,
// halves weather and drops secondary layers.
import { SIZE } from './data.js';
import { ringOf, unitById, HILL } from './engine.js';
import { hiSprite } from './fx.js';
import * as HZ from './hazards10.js'; // B4 10.1: baked hazard tile art + hazard lights

export const FPAD = 0.7;
const TAU = Math.PI * 2;

// ---------- colour helpers ----------
const RGB = new Map();
export function rgb(c) {
  let v = RGB.get(c); if (v) return v;
  if (c[0] === '#') { let h = c.slice(1); if (h.length === 3) h = h.split('').map((q) => q + q).join(''); const n = parseInt(h.slice(0, 6), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  else { const m = c.match(/[\d.]+/g) || [0, 0, 0]; v = [+m[0], +m[1], +m[2]]; }
  RGB.set(c, v); return v;
}
export function shade(c, f) { const [r, g, b] = rgb(c); const t = f < 0 ? 0 : 255, k = Math.abs(f); return `rgb(${Math.round(r + (t - r) * k)},${Math.round(g + (t - g) * k)},${Math.round(b + (t - b) * k)})`; }
export const rgba = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; };
const lum = (c) => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const mkC = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const rng = (seed) => { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

// ---------- theme look (visual fields on BOARDS, with defaults for the built-in boards) ----------
const BY_ID = {
  hall: { mat: 'obsidian' }, marble: { mat: 'marble' }, neon: { mat: 'neon', weather2: 'rain' }, forge: { mat: 'metal', weather2: 'ash' },
  garden: { mat: 'grass', fog: 'rgba(150,230,190,0.10)' }, astral: { mat: 'crystal', weather2: 'aurora' }, throne: { mat: 'stone', light2: '#ffb347' },
  riftgate: { mat: 'crystal', weather2: 'void' }, sakura: { mat: 'wood' }, tundra: { mat: 'ice', weather2: 'fog' }, abyss: { mat: 'coral', fog: 'rgba(60,200,230,0.09)' },
};
const AMB = { obsidian: 0.36, marble: 0.12, neon: 0.48, metal: 0.4, grass: 0.44, crystal: 0.42, stone: 0.34, wood: 0.3, ice: 0.1, coral: 0.48, sand: 0.16 };
export function lookOf(id, th) {
  const d = BY_ID[id] || {};
  const mat = th.mat || d.mat || (th.glowGrid ? 'neon' : lum(th.light) > 0.55 ? 'marble' : 'stone');
  return {
    id, mat, amb: th.amb ?? d.amb ?? AMB[mat] ?? 0.34, light2: th.light2 || d.light2 || th.frame,
    fog: th.fog !== undefined ? th.fog : d.fog || null, tint: th.tint || null,
    weather: th.weather || 'dust', weather2: th.weather2 !== undefined ? th.weather2 : d.weather2 || null,
    ambC: th.bg ? th.bg[1] : '#05030a',
  };
}

// ---------- soft sprites ----------
const SOFT = new Map();
export function softSprite(color = '#ffffff', hard = 0.45) {
  const key = color + hard; let c = SOFT.get(key); if (c) return c;
  c = mkC(64, 64); const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, rgba(color, 1)); g.addColorStop(hard, rgba(color, 0.42)); g.addColorStop(1, rgba(color, 0));
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); SOFT.set(key, c); return c;
}
let SHADOW = null;
function shadowSprite() {
  if (SHADOW) return SHADOW;
  const c = mkC(96, 48), x = c.getContext('2d'); x.translate(48, 24); x.scale(1, 0.5);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 46); g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.45, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, 46, 0, TAU); x.fill(); SHADOW = c; return c;
}
let SOFTRECT = null;
function softRect() { // blurred square used for baked wall / crate shadows
  if (SOFTRECT) return SOFTRECT;
  const c = mkC(96, 96), x = c.getContext('2d'); x.filter = 'blur(10px)'; x.fillStyle = '#000'; x.fillRect(22, 22, 52, 52); SOFTRECT = c; return c;
}

// ---------- tile materials ----------
const TILE = new Map();
function tileTexture(L, th, par, v) {
  const key = L.id + '|' + th.light + th.dark + '|' + L.mat + par + v; let c = TILE.get(key); if (c) return c;
  const N = 96; c = mkC(N, N); const g = c.getContext('2d'); const r = rng(v * 97 + par * 13 + 7);
  const base = par ? th.dark : th.light; g.fillStyle = base; g.fillRect(0, 0, N, N);
  const L0 = lum(base) > 0.5;
  const noise = (n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.6})`; const s = 1 + r() * 2.2; g.fillRect(r() * N, r() * N, s, s); } };
  const crack = (col, w, n = 4, len = 20) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let px = r() * N, py = r() * N; g.moveTo(px, py); for (let k = 0; k < n; k++) { px += (r() - 0.5) * len; py += (r() - 0.5) * len; g.lineTo(px, py); } g.stroke(); };
  const blob = (x0, y0, rad, col) => { const gr = g.createRadialGradient(x0, y0, 0, x0, y0, rad); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x0 - rad, y0 - rad, rad * 2, rad * 2); };
  const vein = th.vein || 'rgba(255,255,255,0.05)';
  switch (L.mat) {
    case 'marble': {
      for (let i = 0; i < 5; i++) blob(r() * N, r() * N, 18 + r() * 26, r() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)');
      g.lineCap = 'round';
      for (let i = 0; i < 2 + (v % 2); i++) {
        const y0 = r() * N; g.strokeStyle = vein; g.lineWidth = 1.6 + r();
        g.beginPath(); g.moveTo(-4, y0); g.bezierCurveTo(N * 0.3, y0 + (r() - 0.5) * 50, N * 0.6, y0 + (r() - 0.5) * 50, N + 4, y0 + (r() - 0.5) * 40); g.stroke();
        g.lineWidth = 0.7; g.beginPath(); g.moveTo(N * r(), y0); g.quadraticCurveTo(N * r(), N * r(), N * r(), N * r()); g.stroke();
      }
      noise(60, 0.025);
      const sh = g.createLinearGradient(0, 0, N, N); sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.05)'); g.fillStyle = sh; g.fillRect(0, 0, N, N);
      break;
    }
    case 'metal': {
      for (let y = 0; y < N; y += 2) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.015 + r() * 0.035})`; g.fillRect(0, y, N, 1); }
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2; g.strokeRect(7, 7, N - 14, N - 14);
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.strokeRect(9, 9, N - 18, N - 18);
      if ((v + par) % 3 === 0) { g.fillStyle = 'rgba(0,0,0,0.22)'; for (let yy = 16; yy < N - 14; yy += 10) for (let xx = 16 + ((yy / 10) % 2) * 5; xx < N - 14; xx += 10) { g.save(); g.translate(xx, yy); g.rotate(0.8); g.fillRect(-3.5, -1, 7, 2); g.restore(); } }
      for (const [rx, ry] of [[12, 12], [N - 12, 12], [12, N - 12], [N - 12, N - 12]]) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(rx + 0.8, ry + 0.8, 3, 0, TAU); g.fill(); g.fillStyle = shade(base, 0.35); g.beginPath(); g.arc(rx, ry, 2.6, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(rx - 1.4, ry - 1.4, 1.2, 1.2); }
      if (r() < 0.4) blob(r() * N, r() * N, 16, 'rgba(255,120,40,0.08)'); // heat tint
      break;
    }
    case 'crystal': {
      const cx = N * (0.35 + r() * 0.3), cy = N * (0.35 + r() * 0.3);
      const pts = [[0, 0], [N / 2, 0], [N, 0], [N, N / 2], [N, N], [N / 2, N], [0, N], [0, N / 2]];
      for (let i = 0; i < 8; i++) { const a = pts[i], b = pts[(i + 1) % 8]; g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.02 + r() * 0.07})` : `rgba(0,0,0,${0.04 + r() * 0.1})`; g.beginPath(); g.moveTo(cx, cy); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.closePath(); g.fill(); }
      g.strokeStyle = rgba(th.frame || '#9df3ff', 0.12); g.lineWidth = 1; g.beginPath(); for (const p of pts) { g.moveTo(cx, cy); g.lineTo(p[0], p[1]); } g.stroke();
      for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(230,245,255,${0.2 + r() * 0.5})`; const s = r() < 0.2 ? 2 : 1; g.fillRect(r() * N, r() * N, s, s); }
      blob(cx, cy, 30, rgba(th.frame || '#9df3ff', 0.06));
      break;
    }
    case 'wood': {
      const planks = 3, w = N / planks;
      for (let i = 0; i < planks; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.06})`; g.fillRect(i * w, 0, w, N);
        g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 0.8;
        for (let k = 0; k < 5; k++) { const gx = i * w + 3 + r() * (w - 6); g.beginPath(); g.moveTo(gx, 0); g.bezierCurveTo(gx + (r() - 0.5) * 6, N * 0.33, gx + (r() - 0.5) * 6, N * 0.66, gx + (r() - 0.5) * 4, N); g.stroke(); }
        if (r() < 0.35) { const ky = r() * N, kx = i * w + w / 2; g.strokeStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(kx, ky, 3, 5, 0, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(kx, ky, 1.2, 2.2, 0, 0, TAU); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(i * w - 1, 0, 2, N);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(i * w + 1, 0, 1, N);
        const cut = r() * N; g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(i * w, cut, w, 1.5);
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(i * w + w / 2 - 1, cut - 5, 2, 2); g.fillRect(i * w + w / 2 - 1, cut + 4, 2, 2);
      }
      break;
    }
    case 'grass': { // mossy cobbles
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, N, N);
      const cells = 3, cw = N / cells;
      for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
        const x0 = i * cw + cw / 2 + (r() - 0.5) * 6, y0 = j * cw + cw / 2 + (r() - 0.5) * 6, rx = cw * (0.42 + r() * 0.08), ry = cw * (0.4 + r() * 0.08);
        g.fillStyle = shade(base, (r() - 0.4) * 0.12); g.beginPath(); g.ellipse(x0, y0, rx, ry, r(), 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.ellipse(x0 - 2, y0 - 2, rx * 0.7, ry * 0.6, 0, 0, TAU); g.fill();
      }
      for (let i = 0; i < 5; i++) blob(r() * N, r() * N, 10 + r() * 14, 'rgba(110,200,120,0.16)');
      g.strokeStyle = 'rgba(120,210,130,0.35)'; g.lineWidth = 1;
      g.beginPath(); for (let i = 0; i < 26; i++) { const bx = r() * N, by = r() * N; g.moveTo(bx, by); g.lineTo(bx + (r() - 0.5) * 3, by - 3 - r() * 3); } g.stroke();
      if (r() < 0.4) { g.fillStyle = r() < 0.5 ? 'rgba(255,240,180,0.7)' : 'rgba(220,190,255,0.7)'; const fx = r() * N, fy = r() * N; for (let k = 0; k < 4; k++) g.fillRect(fx + Math.cos(k * 1.57) * 1.6 - 0.8, fy + Math.sin(k * 1.57) * 1.6 - 0.8, 1.6, 1.6); }
      break;
    }
    case 'ice': {
      const gr = g.createLinearGradient(0, 0, N, N); gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(40,80,120,0.12)'); g.fillStyle = gr; g.fillRect(0, 0, N, N);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(0, N * 0.3); g.lineTo(N * 0.3, 0); g.lineTo(N * 0.42, 0); g.lineTo(0, N * 0.42); g.closePath(); g.fill();
      for (let i = 0; i < 2; i++) crack('rgba(255,255,255,0.55)', 0.9, 3, 26);
      crack('rgba(40,80,120,0.25)', 0.8, 2, 20);
      for (let i = 0; i < 5; i++) { g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 0.7; g.beginPath(); g.arc(r() * N, r() * N, 0.8 + r() * 1.6, 0, TAU); g.stroke(); }
      break;
    }
    case 'coral': {
      for (let i = 0; i < 6; i++) blob(r() * N, r() * N, 10 + r() * 20, r() < 0.5 ? 'rgba(120,255,240,0.06)' : 'rgba(0,0,0,0.12)');
      for (let i = 0; i < 4; i++) { const bx = r() * N, by = r() * N, br = 1.5 + r() * 2.5; g.strokeStyle = 'rgba(200,255,250,0.18)'; g.lineWidth = 1; g.beginPath(); g.arc(bx, by, br, 0, TAU); g.stroke(); g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(bx, by, br * 0.45, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(160,255,245,0.07)'; g.lineWidth = 1.2; for (let i = 0; i < 3; i++) { g.beginPath(); const y0 = r() * N; g.moveTo(0, y0); for (let k = 1; k <= 6; k++) g.lineTo(k * N / 6, y0 + Math.sin(k * 1.7 + v) * 6); g.stroke(); }
      noise(80, 0.03);
      break;
    }
    case 'sand': {
      g.lineWidth = 1.2; for (let i = 0; i < 7; i++) { const y0 = (i + 0.5) * N / 7 + (r() - 0.5) * 4; g.strokeStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; g.beginPath(); g.moveTo(0, y0); for (let k = 1; k <= 8; k++) g.lineTo(k * N / 8, y0 + Math.sin(k * 0.9 + i + v) * 2.5); g.stroke(); }
      noise(220, 0.05);
      break;
    }
    case 'neon': {
      g.strokeStyle = rgba(th.frame || '#ff3df2', 0.16); g.lineWidth = 1; g.strokeRect(5.5, 5.5, N - 11, N - 11);
      g.strokeStyle = th.grid || 'rgba(0,240,255,0.2)'; g.lineWidth = 1.2; g.beginPath();
      for (let i = 0; i < 3; i++) { let px = 10 + r() * (N - 20), py = 10 + r() * (N - 20); g.moveTo(px, py); const hz = r() < 0.5; px += hz ? (r() - 0.5) * 50 : 0; py += hz ? 0 : (r() - 0.5) * 50; g.lineTo(px, py); g.lineTo(px + (r() - 0.5) * 20, py + (r() - 0.5) * 20); }
      g.stroke(); g.fillStyle = rgba(th.mote || '#00f0ff', 0.4); for (let i = 0; i < 3; i++) g.fillRect(10 + r() * (N - 20), 10 + r() * (N - 20), 2, 2);
      break;
    }
    case 'obsidian': {
      noise(40, 0.02);
      const sh = g.createLinearGradient(0, 0, N, N); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.42, 'rgba(255,255,255,0.03)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.075)'); sh.addColorStop(0.58, 'rgba(255,255,255,0.03)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(0, 0, N, N);
      if (v % 2 === 0) crack(vein.replace(/[\d.]+\)$/, '0.16)'), 0.8, 4, 22);
      if (r() < 0.5) crack(rgba(th.frame || '#d6b05c', 0.12), 0.7, 3, 18);
      break;
    }
    default: { // stone flagstones
      noise(120, 0.035);
      const split = v % 3;
      g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 1.6; g.beginPath();
      if (split === 1) { const sy = N * (0.4 + r() * 0.2); g.moveTo(0, sy); g.lineTo(N, sy + (r() - 0.5) * 4); }
      else if (split === 2) { const sx = N * (0.4 + r() * 0.2); g.moveTo(sx, 0); g.lineTo(sx + (r() - 0.5) * 4, N); }
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 0.8; g.stroke();
      if (r() < 0.6) crack('rgba(0,0,0,0.28)', 0.8, 3, 18);
      for (let i = 0; i < 3; i++) blob(r() * N, r() * N, 12 + r() * 14, r() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)');
      if (th.vein && v === 0) { g.strokeStyle = vein; g.lineWidth = 1; g.beginPath(); g.moveTo(N * 0.1, N * 0.3); g.quadraticCurveTo(N * 0.5, N * 0.6, N * 0.9, N * 0.45); g.stroke(); }
    }
  }
  // bevel: light top-left, shadow bottom-right, worn centre
  const hi = L0 ? 0.32 : 0.09, lo = L0 ? 0.16 : 0.32;
  g.fillStyle = `rgba(255,255,255,${hi})`; g.fillRect(0, 0, N, 2); g.fillRect(0, 0, 2, N);
  g.fillStyle = `rgba(255,255,255,${hi * 0.4})`; g.fillRect(2, 2, N - 4, 1.5); g.fillRect(2, 2, 1.5, N - 4);
  g.fillStyle = `rgba(0,0,0,${lo})`; g.fillRect(0, N - 3, N, 3); g.fillRect(N - 3, 0, 3, N);
  const wc = g.createRadialGradient(N / 2, N / 2, 4, N / 2, N / 2, N * 0.72); wc.addColorStop(0, 'rgba(255,255,255,0.035)'); wc.addColorStop(1, 'rgba(0,0,0,0.08)'); g.fillStyle = wc; g.fillRect(0, 0, N, N);
  if (TILE.size > 120) TILE.clear();
  TILE.set(key, c); return c;
}

// ---------- static board (cached by Renderer.floorCache) ----------
export const isSolidT = (t) => t === 'wall' || t === 'rubble' || t === 'crate' || t === 'chest';
export function solidsKey(s) { let h = 0; for (let i = 0; i < s.tiles.length; i++) { const t = s.tiles[i].t; if (isSolidT(t) || (t === 'shrine' && s.tiles[i].cd === 0)) h = (Math.imul(h, 31) + i * 7 + t.length) | 0; else if (t === 'pit' || t === 'crumble') h = (Math.imul(h, 31) + HZ.bakeKey(s.tiles[i], i)) | 0; else if (t === 'lava' || t === 'ice' || t === 'poison') h = (Math.imul(h, 31) + i * 3 + t.length) | 0; } return h; } // R 15.0: + tiles a location event can create mid-match (their light cuts are baked)
export function paintBoard(r, ctx, live) {
  const s = r.state, th = r.theme, L = r.lookOf();
  const FB = r.bounds || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
  const fw = FB.x1 - FB.x0 + 1, fh = FB.y1 - FB.y0 + 1;
  const a0 = live ? Math.min(1, r.intro.t * 1.5) : 1;
  const ring = s.storm.ring;
  // plinth: the board is a thick slab floating over the backdrop
  ctx.globalAlpha = a0;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(FB.x0 - 0.5, FB.y0 - 0.2, fw + 1, fh + 0.95);
  const slabTop = FB.y1 + 1 + 0.35, slabH = 0.3;
  const sg = ctx.createLinearGradient(0, slabTop, 0, slabTop + slabH); sg.addColorStop(0, shade(th.wallFront || '#272335', -0.1)); sg.addColorStop(1, '#040306');
  ctx.fillStyle = sg; ctx.fillRect(FB.x0 - 0.35, slabTop, fw + 0.7, slabH);
  ctx.fillStyle = '#0d0b13'; ctx.fillRect(FB.x0 - 0.35, FB.y0 - 0.35, fw + 0.7, fh + 0.7);
  const rg = ctx.createLinearGradient(0, FB.y0 - 0.35, 0, FB.y1 + 1.35); rg.addColorStop(0, rgba(th.frame, 0.16)); rg.addColorStop(1, rgba(th.frame, 0.04));
  ctx.fillStyle = rg; ctx.fillRect(FB.x0 - 0.35, FB.y0 - 0.35, fw + 0.7, fh + 0.7);
  ctx.strokeStyle = th.frame; ctx.globalAlpha = a0 * 0.75; ctx.lineWidth = 0.05; ctx.strokeRect(FB.x0 - 0.3, FB.y0 - 0.3, fw + 0.6, fh + 0.6);
  ctx.globalAlpha = a0 * 0.3; ctx.lineWidth = 0.02; ctx.strokeRect(FB.x0 - 0.17, FB.y0 - 0.17, fw + 0.34, fh + 0.34);
  ctx.globalAlpha = a0 * 0.5; ctx.fillStyle = th.frame; ctx.fillRect(FB.x0 - 0.35, slabTop, fw + 0.7, 0.025);
  ctx.globalAlpha = a0;
  for (const [cx, cy] of [[FB.x0 - 0.3, FB.y0 - 0.3], [FB.x1 + 1.3, FB.y0 - 0.3], [FB.x0 - 0.3, FB.y1 + 1.3], [FB.x1 + 1.3, FB.y1 + 1.3]]) {
    ctx.fillStyle = '#0d0b13'; ctx.beginPath(); ctx.moveTo(cx, cy - 0.17); ctx.lineTo(cx + 0.17, cy); ctx.lineTo(cx, cy + 0.17); ctx.lineTo(cx - 0.17, cy); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = th.frame; ctx.lineWidth = 0.03; ctx.stroke(); ctx.fillStyle = th.frame; ctx.fillRect(cx - 0.04, cy - 0.04, 0.08, 0.08);
  }
  ctx.globalAlpha = 1;
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && s.tiles[y * SIZE + x].t !== 'out' && ringOf(x, y) >= ring;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (s.tiles[y * SIZE + x].t === 'out') continue;
    const vis = live ? r.tileVisible(x, y) : 1; if (vis <= 0) continue;
    if (ringOf(x, y) < ring) {
      ctx.globalAlpha = 1; ctx.fillStyle = '#030206'; ctx.fillRect(x, y, 1, 1);
      if (!live) { ctx.globalAlpha = 0.75; ctx.drawImage(nebula(), ((x * 64) % 256), ((y * 64) % 256), 64, 64, x, y, 1, 1); ctx.globalAlpha = 1; } // baked nebula; only glows animate per frame
      if (isFloor(x, y - 1)) { // cliff face: the south edge of the surviving floor drops into the void
        const cg = ctx.createLinearGradient(0, y, 0, y + 0.7); cg.addColorStop(0, shade(th.wallFront || '#272335', 0.05)); cg.addColorStop(0.35, shade(th.wallFront || '#272335', -0.45)); cg.addColorStop(1, 'rgba(3,2,6,0)');
        ctx.fillStyle = cg; ctx.fillRect(x, y, 1, 0.7);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; for (let k = 0; k < 3; k++) ctx.fillRect(x + 0.15 + k * 0.3 + ((x * 7) % 3) * 0.03, y + 0.06, 0.02, 0.24 + ((x + k) % 3) * 0.08);
      }
      if (isFloor(x - 1, y)) { const cg = ctx.createLinearGradient(x, 0, x + 0.4, 0); cg.addColorStop(0, 'rgba(0,0,0,0.0)'); cg.addColorStop(0, shade(th.wallFront || '#272335', -0.55)); cg.addColorStop(1, 'rgba(3,2,6,0)'); ctx.fillStyle = cg; ctx.fillRect(x, y, 0.4, 1); }
      if (isFloor(x + 1, y)) { const cg = ctx.createLinearGradient(x + 1, 0, x + 0.6, 0); cg.addColorStop(0, shade(th.wallFront || '#272335', -0.55)); cg.addColorStop(1, 'rgba(3,2,6,0)'); ctx.fillStyle = cg; ctx.fillRect(x + 0.6, y, 0.4, 1); }
      continue;
    }
    ctx.globalAlpha = vis;
    const inset = (1 - vis) * 0.5, par = (x + y) % 2, v = ((x * 73 + y * 151) >>> 0) % 4;
    ctx.drawImage(tileTexture(L, th, par, v), x + inset, y + inset, 1 - inset * 2, 1 - inset * 2);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.grid; ctx.lineWidth = th.glowGrid ? 0.025 : 0.012;
  ctx.beginPath(); for (let i = FB.x0; i <= FB.x1 + 1; i++) { ctx.moveTo(i, FB.y0); ctx.lineTo(i, FB.y1 + 1); } for (let i = FB.y0; i <= FB.y1 + 1; i++) { ctx.moveTo(FB.x0, i); ctx.lineTo(FB.x1 + 1, i); } ctx.stroke();
  HZ.bake(r, ctx, live); // B4 10.1: throne dais, geyser vents, conveyor belts, cracks and pits
  if (live) return;
  // baked contact shadows: walls and props shade the floor to their south-east (key light from the north-west)
  const sr = softRect();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = s.tiles[y * SIZE + x].t; if (!isSolidT(t) || ringOf(x, y) < ring) continue;
    if (t === 'wall') { ctx.globalAlpha = 0.6; ctx.drawImage(sr, x - 0.2, y + 0.15, 1.75, 1.6); }
    else if (t === 'crate' || t === 'chest') { ctx.globalAlpha = 0.45; ctx.drawImage(sr, x - 0.1, y + 0.2, 1.4, 1.2); }
    else { ctx.globalAlpha = 0.3; ctx.drawImage(sr, x - 0.15, y + 0.1, 1.35, 1.2); }
  }
  ctx.globalAlpha = 1;
  bakeLight(r, ctx);
  // edge occlusion along the inner frame and the storm rim
  ctx.globalAlpha = 1;
  const eo = (x0, y0, x1, y1, w, h) => { const gr = ctx.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; return [w, h]; };
  const X0 = Math.max(FB.x0, ring), Y0 = Math.max(FB.y0, ring), X1 = Math.min(FB.x1 + 1, SIZE - ring), Y1 = Math.min(FB.y1 + 1, SIZE - ring);
  if (X1 > X0 && Y1 > Y0) {
    eo(0, Y0, 0, Y0 + 0.35); ctx.fillRect(X0, Y0, X1 - X0, 0.35);
    eo(X0, 0, X0 + 0.25, 0); ctx.fillRect(X0, Y0, 0.25, Y1 - Y0);
    eo(X1, 0, X1 - 0.18, 0); ctx.fillRect(X1 - 0.18, Y0, 0.18, Y1 - Y0);
    if (ring > 0) { ctx.fillStyle = rgba(th.frame, 0.35); ctx.fillRect(X0, Y1 - 0.025, X1 - X0, 0.025); } // lit lip above the cliff
  }
}

// ---------- props (cached sprites) ----------
const PROP = new Map();
const PPX = 112;
function propCanvas(key, w, h, ox, oy, paint) {
  let p = PROP.get(key); if (p) return p;
  const c = mkC(w * PPX, h * PPX), g = c.getContext('2d'); g.setTransform(PPX, 0, 0, PPX, ox * PPX, oy * PPX); paint(g);
  if (PROP.size > 90) PROP.clear();
  p = { c, w, h, ox, oy }; PROP.set(key, p); return p;
}
export function blitProp(ctx, p, x, y) { ctx.drawImage(p.c, x - p.ox, y - p.oy, p.w, p.h); }
export const WALL_H = 0.46;
export function wallProp(r, v) {
  const th = r.theme, L = r.lookOf();
  return propCanvas('wall|' + L.id + th.wallFront + th.wallTop + L.mat + v, 1.1, 1.62, 0.02, WALL_H + 0.08, (g) => paintWall(g, th, L, v, 1));
}
export function paintWall(g, th, L, v, vis) {
  const h = WALL_H * vis, rr = rng(v * 31 + 5), mat = L.mat, top = th.wallTop || ['#4b4560', '#353047'], front = th.wallFront || '#272335';
  // front face
  const fg = g.createLinearGradient(0, 1 - h, 0, 1); fg.addColorStop(0, shade(front, 0.08)); fg.addColorStop(1, shade(front, -0.35));
  g.fillStyle = fg; g.fillRect(0, 1 - h, 1, h);
  g.lineWidth = 0.014;
  if (mat === 'metal' || mat === 'neon') {
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.strokeRect(0.06, 1 - h + 0.06, 0.88, h - 0.12);
    g.fillStyle = 'rgba(255,255,255,0.18)'; for (const px of [0.1, 0.9]) for (const py of [1 - h + 0.1, 0.9]) g.fillRect(px - 0.012, py - 0.012, 0.024, 0.024);
    if (mat === 'neon') { g.strokeStyle = rgba(th.frame, 0.85); g.lineWidth = 0.02; g.beginPath(); g.moveTo(0.04, 1 - h * 0.45); g.lineTo(0.96, 1 - h * 0.45); g.stroke(); }
    else { g.fillStyle = 'rgba(255,120,40,0.18)'; g.fillRect(0.1, 1 - h * 0.5, 0.8, 0.03); }
  } else if (mat === 'wood') {
    g.strokeStyle = 'rgba(0,0,0,0.4)'; for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(0, 1 - h + i * h / 3); g.lineTo(1, 1 - h + i * h / 3); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.5)'; for (const px of [0.12, 0.88]) for (let i = 0; i < 3; i++) g.fillRect(px - 0.012, 1 - h + (i + 0.5) * h / 3 - 0.012, 0.024, 0.024);
  } else if (mat === 'crystal') {
    for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},${0.04 + rr() * 0.05})`; g.fillRect(i * 0.25, 1 - h, 0.25, h); }
    g.strokeStyle = rgba(th.frame, 0.25); g.lineWidth = 0.01; g.beginPath(); for (let i = 1; i < 4; i++) { g.moveTo(i * 0.25, 1 - h); g.lineTo(i * 0.25, 1); } g.stroke();
    g.fillStyle = rgba(th.frame, 0.35); g.fillRect(0, 1 - h, 1, 0.012);
  } else if (mat === 'ice') {
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0.05, 1 - h + 0.04, 0.9, 0.05);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(0.2, 1 - h + 0.1); g.lineTo(0.32, 1 - h * 0.4); g.lineTo(0.28, 0.98); g.stroke();
  } else { // masonry courses (stone, marble, obsidian, grass, coral, sand)
    const rows = 2, rh = h / rows; g.strokeStyle = 'rgba(0,0,0,0.42)';
    g.beginPath();
    for (let i = 1; i < rows; i++) { g.moveTo(0, 1 - h + i * rh); g.lineTo(1, 1 - h + i * rh); }
    for (let i = 0; i < rows; i++) { const off = (i + v) % 2 ? 0.5 : 0.25; for (let bx = off; bx < 1; bx += 0.5) { g.moveTo(bx, 1 - h + i * rh); g.lineTo(bx, 1 - h + (i + 1) * rh); } }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < rows; i++) g.fillRect(0, 1 - h + i * rh + 0.012, 1, 0.012);
    if (mat === 'marble') { g.fillStyle = rgba(th.frame, 0.6); g.fillRect(0, 1 - h + 0.03, 1, 0.02); }
  }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 1 - 0.05, 1, 0.05); // ground contact
  // top face
  const tg = g.createLinearGradient(0, -h, 1, 1 - h); tg.addColorStop(0, top[0]); tg.addColorStop(1, top[1]);
  g.fillStyle = tg; g.fillRect(0, -h, 1, 1);
  const tx = 0, ty = -h;
  if (mat === 'metal') {
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.018; g.strokeRect(tx + 0.1, ty + 0.1, 0.8, 0.8);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.012; g.beginPath(); for (let i = 0; i < 5; i++) { g.moveTo(tx + 0.25, ty + 0.3 + i * 0.1); g.lineTo(tx + 0.75, ty + 0.3 + i * 0.1); } g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.25)'; for (const [px, py] of [[0.16, 0.16], [0.84, 0.16], [0.16, 0.84], [0.84, 0.84]]) { g.beginPath(); g.arc(tx + px, ty + py, 0.025, 0, TAU); g.fill(); }
  } else if (mat === 'neon') {
    g.strokeStyle = rgba(th.frame, 0.9); g.lineWidth = 0.03; g.strokeRect(tx + 0.05, ty + 0.05, 0.9, 0.9);
    g.strokeStyle = rgba(th.mote || '#00f0ff', 0.35); g.lineWidth = 0.015; g.strokeRect(tx + 0.18, ty + 0.18, 0.64, 0.64);
  } else if (mat === 'crystal') {
    const cx = tx + 0.3 + rr() * 0.4, cy = ty + 0.3 + rr() * 0.4;
    for (const [ax, ay, bx, by] of [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0]]) { g.fillStyle = `rgba(${rr() < 0.5 ? '255,255,255' : '0,0,0'},${0.06 + rr() * 0.12})`; g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx + ax, ty + ay); g.lineTo(tx + bx, ty + by); g.closePath(); g.fill(); }
    g.fillStyle = rgba(th.frame, 0.5); g.beginPath(); g.arc(cx, cy, 0.03, 0, TAU); g.fill();
  } else if (mat === 'wood') {
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.014; g.beginPath(); for (let i = 1; i < 4; i++) { g.moveTo(tx + i * 0.25, ty); g.lineTo(tx + i * 0.25, ty + 1); } g.stroke();
  } else if (mat === 'grass') {
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.016; g.strokeRect(tx + 0.08, ty + 0.08, 0.84, 0.84);
    for (let i = 0; i < 4; i++) { const gr = g.createRadialGradient(tx + rr(), ty + rr(), 0, tx + 0.5, ty + 0.5, 0.35); gr.addColorStop(0, 'rgba(110,200,110,0.32)'); gr.addColorStop(1, 'rgba(110,200,110,0)'); g.fillStyle = gr; g.fillRect(tx, ty, 1, 1); }
    g.fillStyle = 'rgba(90,170,90,0.7)'; for (let i = 0; i < 4; i++) { const vx = tx + 0.1 + rr() * 0.8; g.fillRect(vx, 1 - h, 0.025, 0.06 + rr() * 0.14); } // ivy drips
  } else if (mat === 'ice') {
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(tx, ty + 0.3); g.lineTo(tx + 0.3, ty); g.lineTo(tx + 0.45, ty); g.lineTo(tx, ty + 0.45); g.closePath(); g.fill();
  } else {
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 0.016; g.strokeRect(tx + 0.09, ty + 0.09, 0.82, 0.82);
    if (mat === 'marble') { g.strokeStyle = rgba(th.frame, 0.45); g.lineWidth = 0.014; g.strokeRect(tx + 0.2, ty + 0.2, 0.6, 0.6); }
    if (v === 1) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(tx + 0.3, ty + 0.15); g.lineTo(tx + 0.42, ty + 0.4); g.lineTo(tx + 0.36, ty + 0.62); g.stroke(); }
    if (v === 2) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.moveTo(tx + 1, ty + 0.7); g.lineTo(tx + 0.82, ty + 1); g.lineTo(tx + 1, ty + 1); g.fill(); }
  }
  // bevel highlights
  g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(tx, ty, 1, 0.025); g.fillRect(tx, ty, 0.025, 1);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(tx + 0.975, ty, 0.025, 1);
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(tx, 1 - h - 0.012, 1, 0.024); // lit front lip
  g.strokeStyle = rgba(th.frame, 0.2); g.lineWidth = 0.012; g.beginPath(); g.moveTo(0, 1 - h + 0.012); g.lineTo(1, 1 - h + 0.012); g.stroke();
}
export function crateProp() {
  return propCanvas('crate', 1, 1.3, 0, 0.3, (g) => {
    const b = 0.12, w = 1 - b * 2, h = 0.26, top = b - h + 0.1;
    g.fillStyle = '#4a2e16'; g.fillRect(b, 1 - b - h, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.014; g.beginPath(); g.moveTo(b, 1 - b - h / 2); g.lineTo(1 - b, 1 - b - h / 2); g.stroke();
    const lg = g.createLinearGradient(0, top, 0, top + w); lg.addColorStop(0, '#a06a36'); lg.addColorStop(1, '#7a4c24');
    g.fillStyle = lg; g.fillRect(b, top, w, w - 0.1);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.012; g.beginPath(); for (let i = 1; i < 4; i++) { g.moveTo(b + i * w / 4, top); g.lineTo(b + i * w / 4, top + w - 0.1); } g.stroke();
    g.strokeStyle = '#d6b05c'; g.lineWidth = 0.04; g.strokeRect(b + 0.03, top + 0.03, w - 0.06, w - 0.16);
    g.beginPath(); g.moveTo(b + 0.03, top + 0.03); g.lineTo(1 - b - 0.03, top + w - 0.13); g.moveTo(1 - b - 0.03, top + 0.03); g.lineTo(b + 0.03, top + w - 0.13); g.stroke();
    g.fillStyle = '#5b5a66'; for (const [px, py] of [[b, top], [1 - b - 0.1, top], [b, top + w - 0.2], [1 - b - 0.1, top + w - 0.2]]) g.fillRect(px, py, 0.1, 0.1);
    g.fillStyle = 'rgba(255,255,255,0.4)'; for (const [px, py] of [[b, top], [1 - b - 0.1, top], [b, top + w - 0.2], [1 - b - 0.1, top + w - 0.2]]) g.fillRect(px + 0.035, py + 0.035, 0.025, 0.025);
    g.fillStyle = '#d6b05c'; g.fillRect(0.46, 1 - b - h, 0.08, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(b, top, w, 0.02);
  });
}
export function rubbleProp(built, cracked, v) {
  return propCanvas('rub' + built + cracked + v, 1, 1.2, 0, 0.2, (g) => {
    const r = rng(v + 3);
    const stones = built ? [[0.5, 0.55, 0.36]] : [[0.3, 0.64, 0.2], [0.68, 0.62, 0.22], [0.5, 0.4, 0.19], [0.18 + r() * 0.1, 0.82, 0.08], [0.8, 0.84, 0.07]];
    for (const [sx, sy, rr] of stones) {
      const pts = []; for (let k = 0; k < 7; k++) { const a = k / 7 * TAU + r() * 0.4, q = rr * (0.75 + r() * 0.35); pts.push([sx + Math.cos(a) * q, sy + Math.sin(a) * q * 0.75]); }
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(sx + 0.03, sy + rr * 0.55, rr, rr * 0.35, 0, 0, TAU); g.fill();
      const gr = g.createLinearGradient(sx - rr, sy - rr, sx + rr, sy + rr); gr.addColorStop(0, built ? '#7a7494' : '#6a6680'); gr.addColorStop(1, built ? '#3e3a52' : '#2e2b3c');
      g.fillStyle = gr; g.beginPath(); pts.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](p[0], p[1])); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.012; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.moveTo(pts[3][0], pts[3][1]); g.lineTo(pts[4][0], pts[4][1]); g.lineTo(pts[5][0], pts[5][1]); g.lineTo(sx, sy); g.closePath(); g.fill();
    }
    if (built) { g.strokeStyle = 'rgba(214,176,92,0.55)'; g.lineWidth = 0.025; g.strokeRect(0.24, 0.36, 0.52, 0.36); g.beginPath(); g.moveTo(0.24, 0.54); g.lineTo(0.76, 0.54); g.moveTo(0.5, 0.36); g.lineTo(0.5, 0.54); g.stroke(); }
    if (cracked) { g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 0.022; g.beginPath(); g.moveTo(0.42, 0.28); g.lineTo(0.5, 0.45); g.lineTo(0.45, 0.6); g.lineTo(0.55, 0.7); g.stroke(); }
  });
}
export function chestProp() {
  return propCanvas('chest', 1, 1.2, 0, 0.2, (g) => {
    const b = 0.1, w = 0.8;
    const bg = g.createLinearGradient(0, 0.55, 0, 0.93); bg.addColorStop(0, '#4a3486'); bg.addColorStop(1, '#2a1c52');
    g.fillStyle = bg; g.fillRect(b, 0.55, w, 0.38);
    const lg = g.createLinearGradient(0, 0.15, 0, 0.55); lg.addColorStop(0, '#7a5ad0'); lg.addColorStop(1, '#4a3290');
    g.fillStyle = lg; g.beginPath(); g.moveTo(b, 0.55); g.quadraticCurveTo(0.5, 0.08, 1 - b, 0.55); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.moveTo(b + 0.06, 0.5); g.quadraticCurveTo(0.4, 0.18, 0.6, 0.24); g.quadraticCurveTo(0.4, 0.26, b + 0.12, 0.52); g.fill();
    g.strokeStyle = '#ffd24d'; g.lineWidth = 0.045; g.strokeRect(b, 0.55, w, 0.38);
    g.beginPath(); g.moveTo(b + 0.2, 0.3); g.lineTo(b + 0.2, 0.93); g.moveTo(1 - b - 0.2, 0.3); g.lineTo(1 - b - 0.2, 0.93); g.stroke();
    g.strokeStyle = '#a07a1a'; g.lineWidth = 0.015; g.beginPath(); g.moveTo(b, 0.56); g.lineTo(1 - b, 0.56); g.stroke();
    g.fillStyle = '#ffd24d'; g.beginPath(); g.moveTo(0.5, 0.56); g.lineTo(0.58, 0.64); g.lineTo(0.5, 0.74); g.lineTo(0.42, 0.64); g.closePath(); g.fill();
    g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(0.5, 0.645, 0.035, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(0.485, 0.625, 0.015, 0.015);
  });
}
export function brambleProp(v) {
  return propCanvas('bram' + v, 1, 1, 0, 0, (g) => {
    const r = rng(v * 11 + 1);
    const gr = g.createRadialGradient(0.5, 0.55, 0.1, 0.5, 0.55, 0.62); gr.addColorStop(0, 'rgba(50,14,60,0.75)'); gr.addColorStop(1, 'rgba(50,14,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 1, 1);
    g.lineCap = 'round';
    const vines = [];
    for (let i = 0; i < 6; i++) { const a = r() * TAU; vines.push([0.5 + Math.cos(a) * 0.42, 0.5 + Math.sin(a) * 0.42, 0.5 + (r() - 0.5) * 0.5, 0.5 + (r() - 0.5) * 0.5, 0.5 - Math.cos(a) * 0.4, 0.5 - Math.sin(a) * 0.4]); }
    for (const [w, c] of [[0.06, '#1c0a22'], [0.035, '#5a2a66'], [0.014, '#9a5aa8']]) { g.strokeStyle = c; g.lineWidth = w; for (const q of vines) { g.beginPath(); g.moveTo(q[0], q[1]); g.quadraticCurveTo(q[2], q[3], q[4], q[5]); g.stroke(); } }
    g.fillStyle = '#e0b8ee';
    for (const q of vines) for (let k = 1; k < 4; k++) { const t = k / 4, x = (1 - t) * (1 - t) * q[0] + 2 * (1 - t) * t * q[2] + t * t * q[4], y = (1 - t) * (1 - t) * q[1] + 2 * (1 - t) * t * q[3] + t * t * q[5], s = r() < 0.5 ? 1 : -1; g.beginPath(); g.moveTo(x, y - 0.012); g.lineTo(x + 0.05 * s, y - 0.04); g.lineTo(x, y + 0.014); g.fill(); }
    for (let i = 0; i < 5; i++) { const x = 0.15 + r() * 0.7, y = 0.15 + r() * 0.7; g.fillStyle = '#3d6a3a'; g.beginPath(); g.ellipse(x, y, 0.06, 0.03, r() * 3, 0, TAU); g.fill(); g.fillStyle = 'rgba(160,220,140,0.4)'; g.beginPath(); g.ellipse(x - 0.01, y - 0.005, 0.03, 0.012, r() * 3, 0, TAU); g.fill(); }
    for (let i = 0; i < 3; i++) { const x = 0.2 + r() * 0.6, y = 0.2 + r() * 0.6; g.fillStyle = '#c63a8a'; g.beginPath(); g.arc(x, y, 0.035, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x - 0.015, y - 0.018, 0.012, 0.012); }
  });
}
export function shrineBase(on) {
  return propCanvas('shrine' + on, 1, 1, 0, 0, (g) => {
    const gr = g.createRadialGradient(0.5, 0.52, 0.05, 0.5, 0.52, 0.46); gr.addColorStop(0, '#4a4f66'); gr.addColorStop(0.85, '#2a2c3c'); gr.addColorStop(1, 'rgba(10,10,16,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(0.5, 0.52, 0.44, 0.4, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.02; g.beginPath(); g.ellipse(0.5, 0.52, 0.36, 0.32, 0, 0, TAU); g.stroke();
    g.strokeStyle = on ? 'rgba(160,236,255,0.7)' : 'rgba(140,140,170,0.35)'; g.lineWidth = 0.014;
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, x = 0.5 + Math.cos(a) * 0.36, y = 0.52 + Math.sin(a) * 0.32; g.beginPath(); g.moveTo(x - 0.025, y - 0.02); g.lineTo(x + 0.025, y + 0.02); g.moveTo(x + 0.025, y - 0.02); g.lineTo(x, y + 0.03); g.stroke(); }
    g.fillStyle = '#1a1c28'; g.beginPath(); g.ellipse(0.5, 0.55, 0.13, 0.08, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.ellipse(0.42, 0.42, 0.18, 0.08, -0.4, 0, TAU); g.fill();
  });
}

// ---------- storm void ----------
let NEB = null;
function nebula() {
  if (NEB) return NEB;
  const N = 256, c = mkC(N, N), g = c.getContext('2d'), r = rng(42);
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  const cols = ['rgba(150,40,255,', 'rgba(255,50,90,', 'rgba(80,20,160,', 'rgba(255,120,60,'];
  for (let i = 0; i < 26; i++) {
    const x = r() * N, y = r() * N, rad = 20 + r() * 60, col = cols[i % 4], a = 0.12 + r() * 0.22;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { if (x + ox + rad < 0 || x + ox - rad > N || y + oy + rad < 0 || y + oy - rad > N) continue; const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); gr.addColorStop(0, col + a + ')'); gr.addColorStop(1, col + '0)'); g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2); }
  }
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,${180 + r() * 75 | 0},${200 + r() * 55 | 0},${0.2 + r() * 0.6})`; g.fillRect(r() * N, r() * N, 1, 1); }
  NEB = c; return c;
}
export function drawStormVoid(r, ctx, T) {
  if (r.skip && r.skip.void) return;
  const s = r.state, ring = s.storm.ring; if (ring <= 0) return;
  const FB = r.bounds || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
  const X0 = Math.max(FB.x0, ring), Y0 = Math.max(FB.y0, ring), X1 = Math.min(FB.x1 + 1, SIZE - ring), Y1 = Math.min(FB.y1 + 1, SIZE - ring);
  const fw = FB.x1 - FB.x0 + 1, fh = FB.y1 - FB.y0 + 1;
  if (X0 <= FB.x0 && Y0 <= FB.y0 && X1 >= FB.x1 + 1 && Y1 >= FB.y1 + 1) return;
  // the void is the frame between the arena bounds and the surviving square: four band rects, no clip mask
  const bands = [];
  if (X1 > X0 && Y1 > Y0) {
    if (Y0 > FB.y0) bands.push([FB.x0, FB.y0, fw, Y0 - FB.y0]);
    if (Y1 < FB.y1 + 1) bands.push([FB.x0, Y1, fw, FB.y1 + 1 - Y1]);
    if (X0 > FB.x0) bands.push([FB.x0, Y0, X0 - FB.x0, Y1 - Y0]);
    if (X1 < FB.x1 + 1) bands.push([X1, Y0, FB.x1 + 1 - X1, Y1 - Y0]);
  } else bands.push([FB.x0, FB.y0, fw, fh]);
  ctx.globalCompositeOperation = 'lighter';
  if (!r.lowQ) { // slow swirling energy: a few soft glows orbiting along each band
    const g1 = softSprite('#8a2cff'), g2 = softSprite('#ff3a5a');
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi], len = Math.max(b[2], b[3]), n = Math.min(2, Math.ceil(len / 8)), hz = b[2] >= b[3];
      for (let i = 0; i < n; i++) {
        const ph = T * 0.12 * (i % 2 ? 1 : -1) + i / n + bi * 0.3, f = ((ph % 1) + 1) % 1, rad = 0.7 + Math.min(b[2], b[3]) * 0.35 + Math.sin(T + i) * 0.2;
        const x = hz ? b[0] + f * b[2] : b[0] + b[2] / 2 + Math.sin(T * 0.7 + i) * b[2] * 0.3, y = hz ? b[1] + b[3] / 2 + Math.sin(T * 0.7 + i) * b[3] * 0.3 : b[1] + f * b[3];
        ctx.globalAlpha = 0.22 + 0.1 * Math.sin(T * 1.3 + i * 2); ctx.drawImage(i % 2 ? g2 : g1, x - rad, y - rad, rad * 2, rad * 2);
      }
    }
  }
  // drifting embers sucked down into the void (only inside the bands)
  if (!r.lowQ) {
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,140,90,0.8)'; ctx.beginPath();
    for (let bi = 0; bi < bands.length; bi++) { const b = bands[bi]; for (let i = 0; i < 10; i++) { const sx = b[0] + ((i * 7.31 + bi) % b[2]), sy = b[1] + ((i * 3.17 + bi * 2 + T * (0.25 + (i % 5) * 0.06)) % b[3]); const a = (i * 13) % 3 ? 0.03 : 0.05; ctx.rect(sx, sy, a, a); } }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  // storm wall: a glowing seam around the surviving square
  if (X1 > X0 && Y1 > Y0) {
    const p = 0.5 + 0.5 * Math.sin(T * 2.4);
    ctx.globalCompositeOperation = 'lighter';
    if (!r.lowQ) { ctx.strokeStyle = `rgba(255,60,50,${0.1 + p * 0.08})`; ctx.lineWidth = 0.3; ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0); }
    ctx.strokeStyle = `rgba(255,110,80,${0.35 + p * 0.3})`; ctx.lineWidth = 0.04; ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------- lighting ----------
export function addLight(r, x, y, col, rad = 2, life = 0.45, a = 1) {
  if (r.lowQ && r.lights.length > 6) return;
  r.lights.push({ x, y, col, rad, life, a, t: 0 }); if (r.lights.length > 24) r.lights.shift();
}
export function drawLighting(r, ctx, T) {
  if (r.skip && r.skip.light) return;
  const s = r.state;
  r.litVg = false;
  // per-frame lights are additive glows on the floor (static lights are baked into the floor cache)
  ctx.globalCompositeOperation = 'lighter';
  for (const l of r.lights) { const k = 1 - l.t / l.life; if (k > 0) { ctx.globalAlpha = k * k * l.a * 0.55; ctx.drawImage(softSprite(l.col), l.x - l.rad, l.y - l.rad, l.rad * 2, l.rad * 2); } }
  if (!r.lowQ) {
    const glow = (x, y, rad, col, a) => { ctx.globalAlpha = a; ctx.drawImage(softSprite(col, 0.3), x - rad, y - rad, rad * 2, rad * 2); };
    for (const u of s.units) {
      if (!u.alive) continue; const d = r.disp.get(u.id); if (!d || (d.drop && r.time < d.drop.t0)) continue;
      const x = d.x + 0.5, y = d.y + 0.7;
      if (s.active === u.id && !s.over) glow(x, y, 1.6, '#ffe2b0', 0.16 + 0.04 * Math.sin(T * 3));
      else if (u.id === r.myId) glow(x, y, 1.1, u.color || '#ffffff', 0.1);
      if (u.piece === 'king') glow(x, y, 1.6, '#ffd24d', 0.16);
      if (u.boss) glow(x, y, 1.8, '#7a2cff', 0.2);
    }
    for (const it of s.items) if (it.k === 'crown') glow(it.x + 0.5, it.y + 0.6, 2.2, '#ffd24d', 0.22);
    for (const m of s.meteors || []) glow(m.x + 0.5, m.y + 0.5, 1.6, '#ff6a2a', 0.18 + 0.12 * Math.sin(T * 8));
  }
  HZ.lights(r, ctx, T); // B4 10.1: throne owner glow, braziers, pressurised geysers (cheap: a few blits)
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
// baked light map: ambient darkness with holes for the static light sources, composited into the floor cache
export function bakeLight(r, g) {
  const s = r.state, L = r.lookOf(); if (L.amb <= 0.01) return;
  const LR = 8, span = SIZE + FPAD * 2, n = Math.ceil(span * LR);
  const lc = mkC(n, n), q = lc.getContext('2d');
  q.setTransform(LR, 0, 0, LR, FPAD * LR, FPAD * LR);
  q.fillStyle = rgba(L.ambC, L.amb); q.fillRect(-FPAD, -FPAD, span, span);
  const ring = s.storm.ring;
  if (ring > 0 && SIZE - ring * 2 > 2) { q.fillStyle = 'rgba(0,0,0,0.2)'; q.beginPath(); q.rect(ring, ring, SIZE - ring * 2, SIZE - ring * 2); q.rect(ring + 1, ring + 1, SIZE - ring * 2 - 2, SIZE - ring * 2 - 2); q.fill('evenodd'); }
  q.globalCompositeOperation = 'destination-out';
  const W = softSprite('#ffffff', 0.3);
  const cut = (x, y, rad, a) => { q.globalAlpha = Math.min(1, a); q.drawImage(W, x - rad, y - rad, rad * 2, rad * 2); };
  cut(SIZE / 2, SIZE / 2, SIZE * 0.62, 0.55); // key light over the centre of the arena
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = s.tiles[y * SIZE + x], k = t.t;
    if (k === 'floor' || k === 'wall' || k === 'out' || k === 'rubble' || k === 'crate' || k === 'bramble' || ringOf(x, y) < ring) continue;
    if (k === 'shrine') cut(x + 0.5, y + 0.5, t.cd === 0 ? 2.2 : 1, t.cd === 0 ? 0.9 : 0.3);
    else if (k === 'lava') cut(x + 0.5, y + 0.5, 1.7, 0.7);
    else if (k === 'portal') cut(x + 0.5, y + 0.5, 1.8, 0.85);
    else if (k === 'chest') cut(x + 0.5, y + 0.5, 1.6, 0.75);
    else if (k === 'ice') cut(x + 0.5, y + 0.5, 0.9, 0.25);
    else if (k === 'geyser') cut(x + 0.5, y + 0.5, 1.2, 0.4);
    else if (k === 'conveyor') cut(x + 0.5, y + 0.5, 0.8, 0.15);
    else if (k === 'poison') cut(x + 0.5, y + 0.5, 1.1, 0.4); // R 15.0: bog pools glow faintly
  }
  if (s.hill && s.tiles[(HILL.y0 + 1) * SIZE + HILL.x0 + 1].t === 'throne') { cut(HILL.x0 + 2, HILL.y0 + 2, 3.6, 0.75); for (const [px, py] of [[0, 0], [4, 0], [0, 4], [4, 4]]) cut(HILL.x0 + px, HILL.y0 + py - 0.4, 1.4, 0.7); } // B4: throne + braziers
  q.globalAlpha = 1; q.globalCompositeOperation = 'source-over';
  g.drawImage(lc, -FPAD, -FPAD, span, span);
}

// ---------- ground fog (under units) ----------
let CLOUD = new Map();
function cloudSprite(col) {
  let c = CLOUD.get(col); if (c) return c;
  c = mkC(128, 96); const g = c.getContext('2d'), r = rng(9);
  for (let i = 0; i < 9; i++) { const x = 30 + r() * 68, y = 30 + r() * 36, rad = 18 + r() * 22; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba(col, 0.5)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, 128, 96); }
  CLOUD.set(col, c); return c;
}
export function drawGroundFog(r, ctx, T) {
  const L = r.lookOf(); if (!L.fog) return;
  const m = L.fog.match(/[\d.]+/g); const a = m && m[3] != null ? +m[3] : 0.1;
  const col = `rgb(${m[0]},${m[1]},${m[2]})`, sp = cloudSprite(col);
  const n = r.lowQ ? 4 : 8;
  for (let i = 0; i < n; i++) {
    const w = 5 + (i % 3) * 1.5, x = ((i * 4.7 + T * (0.12 + (i % 3) * 0.04)) % (SIZE + w + 2)) - w - 1, y = (i * 5.3) % SIZE - 0.5 + Math.sin(T * 0.2 + i) * 0.5;
    ctx.globalAlpha = Math.min(0.6, a * 2.2); ctx.drawImage(sp, x, y, w, w * 0.6);
  }
  ctx.globalAlpha = 1;
}

// ---------- weather ----------
const WN = { dust: 40, petals: 36, pixels: 40, embers: 46, fireflies: 26, snow: 90, bubbles: 30, stars: 30, rain: 110, ash: 60, aurora: 0, sand: 80, leaves: 30, void: 40, fog: 7 };
export class Weather {
  constructor() { this.pools = new Map(); this.splash = []; this.view = [0, 0, SIZE, SIZE]; }
  pool(kind, n) {
    let p = this.pools.get(kind);
    if (!p || p.length !== n) { p = Array.from({ length: n }, (_, i) => this.spawn(kind, { i }, true)); this.pools.set(kind, p); }
    return p;
  }
  spawn(kind, m, any) {
    const [x0, y0, x1, y1] = this.view, w = x1 - x0, h = y1 - y0, R = Math.random;
    m.x = x0 + R() * w; m.y = any ? y0 + R() * h : y0 - 0.5; m.p = R() * 10; m.s = R(); m.l = R() < 0.4 ? 0 : 1;
    if (kind === 'rain') { m.vy = 11 + R() * 5; m.vx = -2.4; m.gy = y0 + R() * h; if (!any) m.y = y0 - 1 - R() * 2; }
    else if (kind === 'snow') { m.vy = m.l ? 0.7 + R() * 0.5 : 0.35 + R() * 0.25; m.vx = -0.15; }
    else if (kind === 'ash') { m.vy = 0.35 + R() * 0.35; m.vx = 0.2; }
    else if (kind === 'sand') { m.vx = 6 + R() * 5; m.vy = 0.4 * (R() - 0.3); if (!any) { m.x = x0 - 0.5; m.y = y0 + R() * h; } }
    else if (kind === 'leaves' || kind === 'petals') { m.vy = 0.45 + R() * 0.35; m.vx = 0.35 + R() * 0.3; if (!any && R() < 0.5) { m.x = x0 - 0.5; m.y = y0 + R() * h; } }
    else if (kind === 'embers' || kind === 'void' || kind === 'bubbles' || kind === 'dust') { m.vy = -(0.12 + R() * (kind === 'embers' ? 0.7 : 0.25)); m.vx = 0; if (!any) m.y = y1 + 0.5; }
    else if (kind === 'fog') { m.vx = 0.15 + R() * 0.15; m.vy = 0; m.w = 4 + R() * 3; if (!any) { m.x = x0 - m.w - 0.5; m.y = y0 + R() * h; } }
    else { m.vx = 0; m.vy = 0; }
    return m;
  }
  draw(r, ctx, T, dt) {
    if (r.skip && r.skip.weather) return;
    const L = r.lookOf();
    const [ax, ay] = r.toWorld(0, 0), [bx, by] = r.toWorld(r.W, r.H);
    const FB = r.bounds || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
    this.view = [Math.max(FB.x0 - 1, ax - 0.5), Math.max(FB.y0 - 1, ay - 0.5), Math.min(FB.x1 + 2, bx + 0.5), Math.min(FB.y1 + 2, by + 0.5)];
    const k = (r.lowQ ? 0.45 : 1) * (r.reduced ? 0.5 : 1);
    this.layer(r, ctx, T, dt, L.weather, k);
    if (L.weather2 && L.weather2 !== L.weather) this.layer(r, ctx, T, dt, L.weather2, k * (r.lowQ ? 0.6 : 0.8));
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  layer(r, ctx, T, dt, kind, k) {
    if (kind === 'aurora') { if (!r.lowQ) drawAurora(r, ctx, T); return; }
    const base = WN[kind] ?? 40, n = Math.max(kind === 'fog' ? 3 : 6, Math.round(base * k));
    const P = this.pool(kind, n), [x0, y0, x1, y1] = this.view;
    const sp = r.reduced ? 0.5 : 1;
    for (const m of P) {
      m.p += dt; m.x += (m.vx || 0) * dt * sp; m.y += (m.vy || 0) * dt * sp;
      if (kind === 'rain' && m.y >= m.gy) { if (this.splash.length < 50 && !r.lowQ) this.splash.push({ x: m.x, y: m.gy, t: 0 }); this.spawn(kind, m, false); continue; }
      const top = (m.vy || 0) < 0 ? y0 - 0.6 : y0 - 3.2, mw = (m.w || 0.6);
      if (m.y > y1 + 0.6 || m.y < top || m.x > x1 + mw + 0.6 || m.x < x0 - mw - 1) this.spawn(kind, m, false);
    }
    switch (kind) {
      case 'rain': {
        ctx.strokeStyle = 'rgba(190,215,255,0.32)'; ctx.lineWidth = 0.018; ctx.beginPath();
        for (const m of P) { ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + m.vx * 0.045, m.y - m.vy * 0.045); } ctx.stroke();
        if (this.splash.length) {
          ctx.strokeStyle = 'rgba(200,225,255,0.45)'; ctx.lineWidth = 0.014; ctx.beginPath();
          this.splash = this.splash.filter((s) => (s.t += dt) < 0.28);
          for (const s of this.splash) { const q = s.t / 0.28, rr = 0.04 + q * 0.14; ctx.moveTo(s.x + rr, s.y); ctx.ellipse(s.x, s.y, rr, rr * 0.4, 0, 0, TAU); }
          ctx.stroke();
        }
        break;
      }
      case 'snow': {
        for (const lay of [0, 1]) {
          ctx.globalAlpha = lay ? 0.9 : 0.5; ctx.fillStyle = '#ffffff'; ctx.beginPath();
          for (const m of P) if (m.l === lay) { const x = m.x + Math.sin(m.p * 0.9 + m.s * 6) * 0.25, rr = lay ? 0.035 + m.s * 0.03 : 0.018 + m.s * 0.012; ctx.moveTo(x + rr, m.y); ctx.arc(x, m.y, rr, 0, TAU); }
          ctx.fill();
        }
        break;
      }
      case 'ash': {
        ctx.fillStyle = 'rgba(170,160,160,0.7)'; ctx.beginPath();
        for (const m of P) { const w = 0.05 * Math.abs(Math.cos(m.p * 2 + m.s * 5)) + 0.01; ctx.rect(m.x + Math.sin(m.p + m.s * 9) * 0.3, m.y, w, 0.035); }
        ctx.fill();
        ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,130,50,0.9)'; ctx.beginPath();
        for (const m of P) if (m.s < 0.18) { const fl = Math.sin(m.p * 7) > 0 ? 0.03 : 0.018; ctx.rect(m.x, m.y + 0.5, fl, fl); }
        ctx.fill(); ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'sand': {
        const gust = 0.5 + 0.5 * Math.sin(T * 0.7);
        ctx.strokeStyle = `rgba(235,205,150,${0.18 + gust * 0.2})`; ctx.lineWidth = 0.015; ctx.beginPath();
        for (const m of P) { ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - 0.25 - m.s * 0.3, m.y - m.vy * 0.05); } ctx.stroke();
        ctx.globalAlpha = 0.08 + gust * 0.1; ctx.drawImage(cloudSprite('#d9b980'), x0 + ((T * 3) % (x1 - x0 + 8)) - 6, y0 + (y1 - y0) * 0.3 + Math.sin(T * 0.4) * 2, 7, 4);
        break;
      }
      case 'leaves': case 'petals': {
        const cols = kind === 'leaves' ? ['#d9822b', '#b5541c', '#8fae3a', '#e0b23c'] : ['#ffd1dc', '#fff6f0', '#ff9ec0'];
        for (const m of P) {
          const x = m.x + Math.sin(m.p * 0.8 + m.s * 7) * 0.5, y = m.y, a = m.p * (1.5 + m.s), sz = kind === 'leaves' ? 0.07 + m.s * 0.04 : 0.045 + m.s * 0.03;
          ctx.globalAlpha = kind === 'leaves' ? 0.9 : 0.75; ctx.fillStyle = cols[(m.s * cols.length) | 0];
          ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(1, Math.abs(Math.cos(m.p * 2.3)) * 0.8 + 0.2);
          ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.5, 0, 0, TAU); ctx.fill();
          if (kind === 'leaves') { ctx.strokeStyle = 'rgba(60,30,10,0.5)'; ctx.lineWidth = 0.008; ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.lineTo(sz, 0); ctx.stroke(); }
          ctx.restore();
        }
        break;
      }
      case 'embers': {
        ctx.globalCompositeOperation = 'lighter';
        const sp1 = softSprite('#ff7a2a');
        for (const m of P) { const x = m.x + Math.sin(m.p * 1.7 + m.s * 5) * 0.35, fl = 0.5 + 0.5 * Math.sin(m.p * 6 + m.s * 20); ctx.globalAlpha = 0.35 + fl * 0.5; if (!r.lowQ) ctx.drawImage(sp1, x - 0.1, m.y - 0.1, 0.2, 0.2); }
        ctx.globalAlpha = 1; ctx.fillStyle = '#ffd890'; ctx.beginPath();
        for (const m of P) { const x = m.x + Math.sin(m.p * 1.7 + m.s * 5) * 0.35, s = 0.02 + m.s * 0.025; ctx.rect(x - s / 2, m.y - s / 2, s, s); } ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'void': {
        const sp1 = softSprite('#7a2cff');
        ctx.globalCompositeOperation = 'lighter';
        for (const m of P) { const x = m.x + Math.sin(m.p * 0.9 + m.s * 5) * 0.3, a = 0.5 + 0.5 * Math.sin(m.p * 2 + m.s * 9); ctx.globalAlpha = 0.25 + a * 0.35; ctx.drawImage(sp1, x - 0.14, m.y - 0.14, 0.28, 0.28); }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.8; ctx.fillStyle = '#12051f'; ctx.beginPath();
        for (const m of P) { const x = m.x + Math.sin(m.p * 0.9 + m.s * 5) * 0.3, s = 0.03 + m.s * 0.03; ctx.rect(x - s / 2, m.y - s / 2, s, s); } ctx.fill();
        break;
      }
      case 'fireflies': {
        ctx.globalCompositeOperation = 'lighter';
        const sp1 = softSprite('#d8ff8a');
        for (const m of P) { const x = m.x + Math.sin(m.p * 0.5 + m.s * 7) * 0.9, y = m.y + Math.cos(m.p * 0.4 + m.s * 3) * 0.9, b = Math.max(0, Math.sin(m.p * 2.2 + m.s * 11)); if (b < 0.05) continue; ctx.globalAlpha = b * 0.8; ctx.drawImage(sp1, x - 0.2, y - 0.2, 0.4, 0.4); ctx.fillStyle = '#f4ffd0'; ctx.fillRect(x - 0.025, y - 0.025, 0.05, 0.05); }
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'bubbles': {
        ctx.strokeStyle = 'rgba(157,255,246,0.5)'; ctx.lineWidth = 0.012; ctx.beginPath();
        for (const m of P) { const x = m.x + Math.sin(m.p * 1.3 + m.s * 6) * 0.2, rr = 0.03 + m.s * 0.06; ctx.moveTo(x + rr, m.y); ctx.arc(x, m.y, rr, 0, TAU); } ctx.stroke();
        ctx.fillStyle = 'rgba(230,255,255,0.7)'; ctx.beginPath();
        for (const m of P) { const x = m.x + Math.sin(m.p * 1.3 + m.s * 6) * 0.2, rr = 0.03 + m.s * 0.06; ctx.rect(x - rr * 0.5, m.y - rr * 0.55, rr * 0.3, rr * 0.3); } ctx.fill();
        break;
      }
      case 'pixels': {
        for (const c of ['#ff3df2', '#00f0ff']) { ctx.fillStyle = c; ctx.beginPath(); for (const m of P) if ((m.s > 0.5) === (c === '#ff3df2')) { const a = Math.sin(m.p * 2 + m.s * 9); if (a > -0.2) ctx.rect(m.x, m.y + Math.sin(m.p * 0.3) * 0.2, 0.05, 0.05); } ctx.globalAlpha = 0.6; ctx.fill(); }
        if (Math.sin(T * 1.3) > 0.97 && !r.lowQ) { ctx.globalAlpha = 0.12; ctx.fillStyle = '#00f0ff'; ctx.fillRect(x0, y0 + ((T * 37) % (y1 - y0)), x1 - x0, 0.12); }
        break;
      }
      case 'stars': {
        ctx.fillStyle = '#e8f6ff'; ctx.beginPath();
        for (const m of P) { const a = 0.5 + 0.5 * Math.sin(m.p * 1.6 + m.s * 12); if (a < 0.4) continue; const s = 0.02 + a * 0.03; ctx.rect(m.x - s / 2, m.y - s / 2, s, s); if (a > 0.95) { ctx.rect(m.x - 0.09, m.y - 0.006, 0.18, 0.012); ctx.rect(m.x - 0.006, m.y - 0.09, 0.012, 0.18); } }
        ctx.globalAlpha = 0.75; ctx.fill();
        if (Math.random() < (r.lowQ ? 0.003 : 0.008)) r.fx.beam({ x: x0 + Math.random() * (x1 - x0), y: y0 + Math.random() * 3 }, { x: x0 + Math.random() * (x1 - x0), y: y0 + 3 + Math.random() * 5 }, '#d8f6ff', 0.05, 0.6);
        break;
      }
      case 'fog': {
        const sp1 = cloudSprite('#dfe8f2');
        for (const m of P) { ctx.globalAlpha = 0.16 + 0.06 * Math.sin(m.p * 0.3 + m.s * 5); ctx.drawImage(sp1, m.x, m.y - m.w * 0.3, m.w, m.w * 0.6); }
        break;
      }
      default: { // dust motes
        const th = r.theme, col = th.mote || '#ffe7a8';
        ctx.fillStyle = col; ctx.globalAlpha = 0.35; ctx.beginPath();
        for (const m of P) { const x = m.x + Math.sin(m.p + m.s * 6) * 0.3, rr = 0.012 + m.s * 0.02; ctx.moveTo(x + rr, m.y); ctx.arc(x, m.y, rr, 0, TAU); } ctx.fill();
        if (!r.lowQ) { ctx.globalCompositeOperation = 'lighter'; const sp1 = softSprite(col); for (const m of P) if (m.s > 0.8) { ctx.globalAlpha = 0.25 * (0.5 + 0.5 * Math.sin(m.p * 2)); ctx.drawImage(sp1, m.x - 0.12, m.y - 0.12, 0.24, 0.24); } ctx.globalCompositeOperation = 'source-over'; }
      }
    }
    ctx.globalAlpha = 1;
  }
}
let AUR = null;
function auroraStrip() {
  if (AUR) return AUR;
  const c = mkC(8, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(120,80,255,0)'); gr.addColorStop(0.35, 'rgba(110,120,255,0.5)'); gr.addColorStop(0.7, 'rgba(80,255,190,0.85)'); gr.addColorStop(1, 'rgba(80,255,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 128); AUR = c; return c;
}
function drawAurora(r, ctx, T) {
  const sp = auroraStrip(), [x0, y0, x1] = [r.weather.view[0], r.weather.view[1], r.weather.view[2]];
  ctx.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 2; band++) {
    const yb = y0 + 1.2 + band * 2.4, n = 36, w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * w, ph = x * 0.45 + T * (0.35 + band * 0.15) + band * 2;
      const y = yb + Math.sin(ph) * 0.9 + Math.sin(ph * 2.3) * 0.3, h = 2.4 + Math.sin(ph * 1.7 + T) * 0.8;
      ctx.globalAlpha = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(ph * 3 + T * 2));
      ctx.drawImage(sp, x, y - h, w + 0.02, h);
    }
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

// ---------- unit helpers ----------
export function drawShadow(ctx, cx, base, w, a) { const s = shadowSprite(); ctx.globalAlpha = a; ctx.drawImage(s, cx - w + w * 0.08, base - w * 0.32, w * 2, w * 0.7); ctx.globalAlpha = 1; }
let DOME = null;
export function shieldDome() {
  if (DOME) return DOME;
  const c = mkC(128, 160), g = c.getContext('2d');
  g.translate(64, 84); const gr = g.createRadialGradient(0, 0, 20, 0, 0, 60); gr.addColorStop(0, 'rgba(127,182,255,0)'); gr.addColorStop(0.75, 'rgba(127,182,255,0.18)'); gr.addColorStop(1, 'rgba(200,230,255,0.85)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 58, 74, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(200,230,255,0.35)'; g.lineWidth = 1.2; g.save(); g.beginPath(); g.ellipse(0, 0, 57, 73, 0, 0, TAU); g.clip();
  for (let y = -80; y < 80; y += 16) for (let x = -70 + ((y / 16) & 1) * 9; x < 70; x += 18) { g.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 8, y + Math.sin(a) * 8); } g.closePath(); g.stroke(); }
  g.restore(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-20, -36, 14, 7, -0.6, 0, TAU); g.fill();
  DOME = c; return c;
}
const ICON = new Map();
export const STATUS_COL = { def: '#7fb6ff', atk: '#ff5a3a', spd: '#ffe04d', slow: '#c9a6ff', bond: '#ff9ad5', root: '#d6a15c' };
export function statusIcon(kind) {
  let c = ICON.get(kind); if (c) return c;
  c = mkC(48, 48); const g = c.getContext('2d'), col = STATUS_COL[kind] || '#ffffff';
  g.fillStyle = '#0d0b13'; g.beginPath(); g.arc(24, 24, 22, 0, TAU); g.fill(); g.strokeStyle = col; g.lineWidth = 3; g.stroke();
  g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'def') { g.moveTo(24, 10); g.lineTo(36, 15); g.quadraticCurveTo(36, 31, 24, 38); g.quadraticCurveTo(12, 31, 12, 15); g.closePath(); g.fill(); }
  else if (kind === 'atk') { g.moveTo(14, 34); g.lineTo(33, 15); g.stroke(); g.beginPath(); g.moveTo(29, 11); g.lineTo(37, 11); g.lineTo(37, 19); g.fill(); g.beginPath(); g.moveTo(13, 27); g.lineTo(21, 35); g.stroke(); }
  else if (kind === 'spd') { g.moveTo(14, 24); g.lineTo(24, 14); g.lineTo(34, 24); g.moveTo(14, 34); g.lineTo(24, 24); g.lineTo(34, 34); g.stroke(); }
  else if (kind === 'slow') { g.moveTo(14, 14); g.lineTo(24, 24); g.lineTo(34, 14); g.moveTo(14, 24); g.lineTo(24, 34); g.lineTo(34, 24); g.stroke(); }
  else if (kind === 'bond') { g.lineWidth = 3.5; g.arc(19, 24, 7, 0, TAU); g.moveTo(36, 24); g.arc(29, 24, 7, 0, TAU); g.stroke(); }
  else if (kind === 'root') { g.lineWidth = 3.5; g.moveTo(24, 10); g.lineTo(24, 30); g.moveTo(24, 30); g.lineTo(14, 37); g.moveTo(24, 30); g.lineTo(34, 37); g.moveTo(24, 22); g.lineTo(16, 18); g.moveTo(24, 26); g.lineTo(32, 21); g.stroke(); }
  else { g.font = '700 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(kind)[0].toUpperCase(), 24, 25); }
  ICON.set(kind, c); return c;
}
// R 15.0: pips for C's statuses (u.status [{k, t, n}]) next to the HP bar: dark disc, coloured rim, glyph; stacks
// (poison, Exposed) print their count. Cached per kind + count.
export const PIP_COL = { burn: '#ff7a2a', poison: '#7dff4a', freeze: '#9fe6ff', stun: '#ffe14d', slow: '#b49cff', shield: '#6fb4ff', haste: '#4dffe1', exposed: '#ff4d4d', enrage: '#ff2a3a' };
const PIP = new Map();
export function statusPip(k, n) {
  const col = PIP_COL[k]; if (!col) return null;
  const cnt = (k === 'poison' || k === 'exposed') && n > 1 ? Math.min(9, n | 0) : 0, key = k + cnt; let c = PIP.get(key); if (c) return c;
  c = mkC(48, 48); const g = c.getContext('2d');
  g.fillStyle = '#0d0b13'; g.beginPath(); g.arc(24, 24, 22, 0, TAU); g.fill(); g.strokeStyle = col; g.lineWidth = 3; g.stroke();
  g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
  if (k === 'burn') { g.moveTo(24, 9); g.bezierCurveTo(34, 19, 35, 26, 33, 31); g.bezierCurveTo(31, 38, 17, 38, 15, 31); g.bezierCurveTo(13, 25, 17, 21, 19, 18); g.bezierCurveTo(20, 23, 22, 24, 24, 24); g.bezierCurveTo(23, 18, 22, 14, 24, 9); g.fill(); }
  else if (k === 'poison') { g.moveTo(24, 9); g.quadraticCurveTo(36, 24, 34, 30); g.arc(24, 29, 10, 0, Math.PI); g.quadraticCurveTo(12, 24, 24, 9); g.fill(); }
  else if (k === 'freeze') { for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.moveTo(24 + Math.cos(a) * 14, 24 + Math.sin(a) * 14); g.lineTo(24 - Math.cos(a) * 14, 24 - Math.sin(a) * 14); } g.stroke(); }
  else if (k === 'stun') { for (let j = 0; j < 10; j++) { const r = j % 2 ? 6 : 15, a = j * Math.PI / 5 - Math.PI / 2; g[j ? 'lineTo' : 'moveTo'](24 + Math.cos(a) * r, 24 + Math.sin(a) * r); } g.closePath(); g.fill(); }
  else if (k === 'slow') { g.moveTo(14, 15); g.lineTo(24, 24); g.lineTo(34, 15); g.moveTo(14, 25); g.lineTo(24, 34); g.lineTo(34, 25); g.stroke(); }
  else if (k === 'shield') { for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; g[i ? 'lineTo' : 'moveTo'](24 + Math.cos(a) * 14, 24 + Math.sin(a) * 15); } g.closePath(); g.lineWidth = 3.5; g.stroke(); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1; }
  else if (k === 'haste') { g.moveTo(27, 8); g.lineTo(15, 26); g.lineTo(24, 26); g.lineTo(21, 40); g.lineTo(33, 21); g.lineTo(24, 21); g.closePath(); g.fill(); }
  else if (k === 'exposed') { g.moveTo(24, 10); g.lineTo(36, 15); g.quadraticCurveTo(36, 31, 24, 38); g.quadraticCurveTo(12, 31, 12, 15); g.closePath(); g.lineWidth = 3; g.stroke(); g.lineWidth = 2.5; g.beginPath(); g.moveTo(26, 12); g.lineTo(21, 22); g.lineTo(27, 26); g.lineTo(22, 36); g.stroke(); }
  else if (k === 'enrage') { g.moveTo(12, 34); g.lineTo(16, 14); g.lineTo(21, 24); g.lineTo(24, 10); g.lineTo(27, 24); g.lineTo(32, 14); g.lineTo(36, 34); g.closePath(); g.fill(); }
  if (cnt) { g.fillStyle = '#0d0b13'; g.beginPath(); g.arc(36, 36, 11, 0, TAU); g.fill(); g.fillStyle = '#ffffff'; g.font = '800 17px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(cnt), 36, 37); }
  PIP.set(key, c); return c;
}
export function statusesOf(s, u) {
  const out = [];
  for (const b of u.buffs || []) {
    let k = b.k;
    if (k === 'def') k = b.bond ? 'bond' : b.v < 1 ? 'slow' : 'def';
    else if (k === 'atk') k = b.v < 1 ? 'slow' : 'atk';
    else if (k === 'spd' || k === 'move') k = b.v < 0 ? 'slow' : 'spd';
    else if (k === 'heal') continue;
    if (!out.includes(k)) out.push(k);
  }
  if (s.active === u.id && s.turn && s.turn.rooted) out.push('root');
  return out;
}

// ---------- overlays ----------
let HATCH = null;
function hatch(ctx) {
  if (HATCH) return HATCH;
  const c = mkC(16, 16), g = c.getContext('2d'); g.strokeStyle = 'rgba(255,90,100,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-4, 20); g.lineTo(20, -4); g.moveTo(-4, 4); g.lineTo(4, -4); g.moveTo(12, 20); g.lineTo(20, 12); g.stroke();
  HATCH = ctx.createPattern(c, 'repeat'); if (HATCH.setTransform) HATCH.setTransform(new DOMMatrix().scaleSelf(1 / 48)); return HATCH;
}
function rrect(ctx, x, y, w, h, q) { ctx.moveTo(x + q, y); ctx.arcTo(x + w, y, x + w, y + h, q); ctx.arcTo(x + w, y + h, x, y + h, q); ctx.arcTo(x, y + h, x, y, q); ctx.arcTo(x, y, x + w, y, q); ctx.closePath(); }
export function drawOverlays(r, T) {
  if (r.skip && r.skip.ov) return;
  const ov = r.overlay ? { ...r.overlay } : (r.danger ? {} : null); if (!ov) return;
  if (r.danger) ov.danger = r.danger;
  const ctx = r.x, s = r.state;
  const pulse = 0.5 + 0.5 * Math.sin(T * 5);
  // threat zones: hatched, with one merged outline
  if (ov.danger && ov.danger.length) {
    const set = new Set(ov.danger.map((t) => t.y * SIZE + t.x));
    ctx.fillStyle = 'rgba(255,40,60,0.12)'; ctx.beginPath(); for (const t of ov.danger) ctx.rect(t.x, t.y, 1, 1); ctx.fill();
    ctx.fillStyle = hatch(ctx); ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(255,90,100,${0.5 + pulse * 0.35})`; ctx.lineWidth = 0.04; ctx.beginPath();
    for (const t of ov.danger) {
      if (!set.has((t.y - 1) * SIZE + t.x) || t.y === 0) { ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + 1, t.y); }
      if (!set.has((t.y + 1) * SIZE + t.x)) { ctx.moveTo(t.x, t.y + 1); ctx.lineTo(t.x + 1, t.y + 1); }
      if (!set.has(t.y * SIZE + t.x - 1) || t.x === 0) { ctx.moveTo(t.x, t.y); ctx.lineTo(t.x, t.y + 1); }
      if (!set.has(t.y * SIZE + t.x + 1) || t.x === SIZE - 1) { ctx.moveTo(t.x + 1, t.y); ctx.lineTo(t.x + 1, t.y + 1); }
    }
    ctx.stroke();
  }
  if (ov.moves) {
    const fx = ov.from ? ov.from.x : 0, fy = ov.from ? ov.from.y : 0;
    ctx.beginPath(); for (const m of ov.moves) rrect(ctx, m.x + 0.07, m.y + 0.07, 0.86, 0.86, 0.14);
    ctx.fillStyle = 'rgba(70,180,255,0.13)'; ctx.fill();
    ctx.strokeStyle = 'rgba(127,224,255,0.55)'; ctx.lineWidth = 0.025; ctx.stroke();
    for (const m of ov.moves) {
      const wave = 0.5 + 0.5 * Math.sin(T * 4 - (Math.abs(m.x - fx) + Math.abs(m.y - fy)) * 0.8);
      if (ringOf(m.x, m.y) < s.storm.ring) { // G 10.2: legal moves in the storm void, tinted red as a burn warning
        ctx.beginPath(); rrect(ctx, m.x + 0.07, m.y + 0.07, 0.86, 0.86, 0.14);
        ctx.fillStyle = `rgba(255,70,70,${0.2 + wave * 0.16})`; ctx.fill(); ctx.strokeStyle = 'rgba(255,140,130,0.9)'; ctx.lineWidth = 0.03; ctx.stroke();
        ctx.fillStyle = 'rgba(255,225,215,0.95)'; ctx.beginPath(); ctx.arc(m.x + 0.5, m.y + 0.5, 0.055 + wave * 0.03, 0, TAU); ctx.fill();
        continue;
      }
      ctx.fillStyle = `rgba(120,215,255,${0.06 + wave * 0.14})`; ctx.fillRect(m.x + 0.12, m.y + 0.12, 0.76, 0.76);
      ctx.fillStyle = 'rgba(210,245,255,0.9)'; ctx.beginPath(); ctx.arc(m.x + 0.5, m.y + 0.5, 0.055 + wave * 0.03, 0, TAU); ctx.fill();
      if (m.jump) { ctx.strokeStyle = 'rgba(210,245,255,0.6)'; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.arc(m.x + 0.5, m.y + 0.5, 0.15, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    }
    if (ov.hover && ov.from) { // path preview + ghost piece
      const h = ov.hover, ax = fx + 0.5, ay = fy + 0.62, bx = h.x + 0.5, by = h.y + 0.62;
      const me = r.myId != null ? unitById(s, r.myId) : null;
      const arc = h.jump || (me && me.piece === 'knight');
      const mx = (ax + bx) / 2, my = (ay + by) / 2 - (arc ? 1.1 : 0);
      ctx.lineCap = 'round';
      for (const [w, c] of [[0.12, 'rgba(8,6,14,0.55)'], [0.055, 'rgba(160,232,255,0.95)']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w; ctx.setLineDash(c[5] === '1' ? [0.14, 0.1] : []); ctx.lineDashOffset = -T * 0.9;
        ctx.beginPath(); ctx.moveTo(ax, ay); if (arc) ctx.quadraticCurveTo(mx, my, bx, by); else ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.lineCap = 'butt';
      const ang = arc ? Math.atan2(by - my, bx - mx) : Math.atan2(by - ay, bx - ax);
      ctx.fillStyle = '#c8f2ff'; ctx.beginPath(); ctx.moveTo(bx + Math.cos(ang) * 0.06, by + Math.sin(ang) * 0.06); ctx.lineTo(bx - Math.cos(ang - 0.6) * 0.2, by - Math.sin(ang - 0.6) * 0.2); ctx.lineTo(bx - Math.cos(ang + 0.6) * 0.2, by - Math.sin(ang + 0.6) * 0.2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.05; corners(ctx, h.x + 0.05, h.y + 0.05, 0.9);
      if (me) { const S = 1 / 160 * 0.92; ctx.globalAlpha = 0.38 + pulse * 0.12; ctx.drawImage(hiSprite(me.piece, me.skin), bx - 96 * S, h.y + 0.86 - 224 * S, 192 * S, 240 * S); ctx.globalAlpha = 1; }
    } else if (ov.hover) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.05; corners(ctx, ov.hover.x + 0.05, ov.hover.y + 0.05, 0.9); }
  } else if (ov.hover) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.05; corners(ctx, ov.hover.x + 0.05, ov.hover.y + 0.05, 0.9); }
  if (ov.opts) {
    for (const o of ov.opts) {
      const sel = ov.preview === o, hurt = o.mult > 0;
      if (!sel) { ctx.fillStyle = hurt ? 'rgba(255,93,93,0.08)' : 'rgba(180,140,255,0.08)'; ctx.beginPath(); for (const t of o.tiles) ctx.rect(t.x + 0.06, t.y + 0.06, 0.88, 0.88); ctx.fill(); }
      const a = o.anchor;
      ctx.strokeStyle = hurt ? `rgba(255,120,100,${0.6 + pulse * 0.4})` : `rgba(201,166,255,${0.6 + pulse * 0.4})`; ctx.lineWidth = 0.05;
      const inset = 0.08 + pulse * 0.04; corners(ctx, a.x + inset, a.y + inset, 1 - inset * 2);
      if (o.hits && o.hits.length) { ctx.fillStyle = 'rgba(255,80,80,0.95)'; ctx.beginPath(); ctx.arc(a.x + 0.5, a.y + 0.5, 0.06, 0, TAU); ctx.fill(); }
    }
    if (ov.preview) {
      const o = ov.preview, hurt = o.mult > 0, c = hurt ? '255,70,70' : '180,140,255';
      ctx.fillStyle = `rgba(${c},${0.26 + pulse * 0.16})`; ctx.beginPath(); for (const t of o.tiles) rrect(ctx, t.x + 0.05, t.y + 0.05, 0.9, 0.9, 0.1); ctx.fill();
      ctx.strokeStyle = hurt ? '#ff9a8a' : '#d9c6ff'; ctx.lineWidth = 0.035; ctx.stroke();
      // sweep line across the struck tiles
      const sw = (T * 1.6) % 1;
      ctx.fillStyle = `rgba(255,255,255,${0.12 * Math.sin(sw * Math.PI)})`; ctx.beginPath(); for (const t of o.tiles) ctx.rect(t.x + 0.05, t.y + 0.05 + sw * 0.8, 0.9, 0.1); ctx.fill();
      for (const id of o.hits || []) { // reticle on every victim
        const d = r.disp.get(id); if (!d) continue;
        const cx = d.x + 0.5, cy = d.y + 0.5, rr = 0.5 + pulse * 0.06;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(T * 1.2);
        ctx.strokeStyle = hurt ? '#ff4d5d' : '#c9a6ff'; ctx.lineWidth = 0.045;
        for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.arc(0, 0, rr, -0.45, 0.45); ctx.stroke(); ctx.beginPath(); ctx.moveTo(rr - 0.08, 0); ctx.lineTo(rr + 0.08, 0); ctx.stroke(); }
        ctx.restore();
      }
    }
  }
}
export function corners(ctx, x, y, w) {
  const l = w * 0.28; ctx.beginPath();
  ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
  ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
  ctx.moveTo(x + w, y + w - l); ctx.lineTo(x + w, y + w); ctx.lineTo(x + w - l, y + w);
  ctx.moveTo(x + l, y + w); ctx.lineTo(x, y + w); ctx.lineTo(x, y + w - l);
  ctx.stroke();
}

// ---------- camera ----------
// critically damped spring (smooth follow without the snap of a plain lerp)
export function spring(cam, key, vkey, target, smooth, dt) {
  const w = 2 / smooth, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const ch = cam[key] - target, tmp = ((cam[vkey] || 0) + w * ch) * dt;
  cam[vkey] = ((cam[vkey] || 0) - w * tmp) * e; cam[key] = target + (ch + tmp) * e;
}

// E1 15.0: World Tour location backdrops. The scene behind and around the board: sky, distant silhouettes, mid-ground
// props, a rim of scenery hugging the board's edges, ambient animation and a light colour that tints the board.
//
// ---------------------------------------------------------------------------------------------------------------------
// CONTRACT for js/backdrops/<id>.js (E1 owns citadel/forge/temple/gardens, E2 ruins/works/rift/bog):
//
//   export default {
//     id: 'citadel',
//     base: '#0b1222',                       // fallback fill (also the colour under every layer)
//     light: { tint: '#dfe9ff' | ['#top', '#bottom'],   // multiplied over the board rect: keep it near white (slight)
//              glow: ['t'|'b'|'l'|'r', '#hex', alpha],    // optional additive glow creeping in from one edge
//              caustic: '#hex' },                          // optional drifting soft light pools (water, leaf dapple)
//     layers: [                              // back to front
//       { p: 0.1, res: 0.7, paint(g, K) {...}, anim(ctx, K) {...} },
//       { p: 0.45, paint, anim },
//       { p: 1, r: 4, paint, anim },          // p = 1: locked to the board (the rim), r = tiles it reaches past the edge
//     ],
//     front?(ctx, K)                         // optional, every frame after the units, board tile units: ONLY in the
//   };                                       // left/right/bottom margin outside the tiles (never over tiles or the top)
//
// Units: board tiles. The board covers x,y 0..16 (or the arena bounds); the store board's frame reaches 0.7 outside.
// Top of the screen is "far" (pieces are drawn in a 3/4 view), so: sky and hero silhouettes above the board (y < -0.7),
// side props at x < -0.7 and x > 16.7, a foreground ledge below y 16.7.
// p is the parallax depth: 0 = fixed sky, 1 = moves exactly with the board. At the overview zoom with the camera centred
// every layer lines up in tile units, so author everything as if p were 1; as the camera pans/zooms, deeper layers move
// and scale less. paint(g, K) runs once per screen size into a cached canvas (g is in tile units). Fill K.x0..K.x1 by
// K.y0..K.y1: the area that layer can ever show for this screen; it differs per shape, so anchor things to the board and
// spread wide things (sky, ground, ridges) over the bounds. The board rect hides whatever is under it.
// anim(ctx, K) runs every frame right after its layer, ctx already in that layer's tile units. Budget: a few dozen
// draw calls, cached sprites only (K.sprite), counts through K.n(), skip what K.hidden() says is under the board.
// K.T is time in seconds (slowed under reduced motion: then no flashes or flicker, only slow drifts). K.lowQ: draw less.
//
// K (paint and anim): x0 y0 x1 y1 (paint: bake bounds; anim: what is on screen now), b {x0,y0,x1,y1} board rect in tiles,
//   W H (css px), wide (landscape/desktop), hz (suggested horizon y: just above the board in portrait, about a third
//   down the board when wide so the open sides show sky, peaks and land; use it for every layer of the scene), lowQ, reduced, T, p, k (paint: canvas px per tile),
//   rng(seed) -> () => [0,1), mix(a, b, t) -> css colour, rgba(hex, a), shade(hex, k -1..1),
//   lin(g, x0, y0, x1, y1, [[stop, col], ...]), rad(g, x, y, r0, r1, stops), ridge({ x0, x1, y, amp, seed, step, rough })
//   -> [[x,y],...] (fill it with K.fillRidge(g, pts, bottom)), glow(col) soft radial sprite (64 px), n(count),
//   sprite(key, w, h, fn(g, w, h)) memoised canvas (px), hidden(x0, y0, x1, y1) true if that rect is behind the board,
//   anim only: soft(key, res, y0, y1, fn(g, K)) -> { c, x, y, w, h }: a low-res (res px per tile) bake across the layer's
//   width, for big soft moving things (aurora, light shafts): draw it with 1-2 blits instead of dozens of sprites;
//   K.blitOut(o, dx, dy) draws it skipping the part behind the board and off screen (use it rather than drawImage).
// Perf: static layers cost about one full-screen blit together; anim fill-rate is the real cost, so keep big additive
// things in soft() bakes and small sprites few.
//
// Hook (render.js draw()): drawBackdrop(ctx, id, viewOf(r, ox, oy), T) in screen space instead of the plain gradient
// (returns false when there is nothing to draw yet: no location, module still loading); drawBackdropFront(ctx, id, r, T)
// after the units, in world transform: light tint + optional front(). Test any location with ?bd=<id> (or
// localStorage cc_bd). prepareBackdrop(id, view) bakes synchronously (otherwise one layer bakes per frame, then fades in).
// ---------------------------------------------------------------------------------------------------------------------

import { blitExact } from './world.js'; // R2 15.0.1: 1:1 copies of the big caustic glows

export const BACKDROP_IDS = ['citadel', 'forge', 'temple', 'gardens', 'ruins', 'works', 'rift', 'bog'];
const MODS = new Map(); // id -> module default | null (missing) | 'loading'
let FORCE = null;
try { FORCE = new URLSearchParams(location.search).get('bd') || localStorage.getItem('cc_bd') || null; } catch {}
export function setBackdropOverride(id) { FORCE = id || null; }
export function backdropId(s) { return FORCE || (s && s.location) || null; }

function mod(id) {
  if (!id) return null;
  const m = MODS.get(id);
  if (m !== undefined) return m === 'loading' ? null : m;
  if (!BACKDROP_IDS.includes(id) && !/^[a-z0-9_-]+$/.test(id)) { MODS.set(id, null); return null; }
  MODS.set(id, 'loading');
  import(`./backdrops/${id}.js`).then((x) => MODS.set(id, x.default || null)).catch((e) => { MODS.set(id, null); console.warn('backdrop', id, e && e.message); });
  return null;
}
export function loadBackdrop(id) { mod(id); }

// ---------- helpers handed to the scenes ----------
const mkC = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
export const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
export const shade = (h, k) => { const A = hex(h); return `rgb(${A.map((v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))).join(',')})`; };
export function rng(seed) { let a = (seed * 2654435761) >>> 0 || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lin = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) gr.addColorStop(o, c); return gr; };
const rad = (g, x, y, r0, r1, stops) => { const gr = g.createRadialGradient(x, y, r0, x, y, r1); for (const [o, c] of stops) gr.addColorStop(o, c); return gr; };
// a jagged ridge line from x0 to x1 around height y (midpoint displacement, deterministic)
export function ridge({ x0, x1, y, amp = 2, seed = 1, step = 0.25, rough = 0.55, peaks = null }) {
  const R = rng(seed), n = Math.max(2, Math.ceil((x1 - x0) / step)), N = 1 << Math.ceil(Math.log2(n)), h = new Float32Array(N + 1);
  h[0] = R() - 0.5; h[N] = R() - 0.5;
  for (let s = N, a = 1; s > 1; s >>= 1, a *= rough) for (let i = s >> 1; i < N; i += s) h[i] = (h[i - (s >> 1)] + h[i + (s >> 1)]) / 2 + (R() - 0.5) * a;
  const pts = [];
  for (let i = 0; i <= N; i++) { const x = x0 + ((x1 - x0) * i) / N; let yy = y - h[i] * amp; if (peaks) for (const [px, ph, pw] of peaks) { const d = Math.abs(x - px) / pw; if (d < 1) yy -= ph * (1 - d) * (1 - d * 0.35); } pts.push([x, yy]); }
  return pts;
}
function fillRidge(g, pts, bottom) { g.beginPath(); g.moveTo(pts[0][0], bottom); for (const [x, y] of pts) g.lineTo(x, y); g.lineTo(pts[pts.length - 1][0], bottom); g.closePath(); g.fill(); }
const GLOWS = new Map();
export function glow(col) {
  let c = GLOWS.get(col); if (c) return c;
  c = mkC(64, 64); const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.4, rgba(col, 0.38)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  GLOWS.set(col, c); return c;
}
const SPR = new Map();
function sprite(key, w, h, fn) { let c = SPR.get(key); if (c) return c; c = mkC(w, h); fn(c.getContext('2d'), c.width, c.height); if (SPR.size > 160) SPR.clear(); SPR.set(key, c); return c; }
const KIT = { rng, mix, rgba, shade, lin, rad, ridge, fillRidge, glow, sprite, blitExact }; // R2 15.0.1: K.blitExact(ctx, img, x, y, w, h) = drawImage, 1:1 copy at rest (static images only)

// ---------- view ----------
// Everything the backdrop needs from the renderer for one frame (ox/oy = this frame's screen shake).
export function viewOf(r, ox = 0, oy = 0) {
  const b = r.bounds || { x0: 0, y0: 0, x1: 15, y1: 15 };
  return { W: r.W, H: r.H, dpr: r.dpr, cx: r.CX ?? r.W / 2, cy: r.CY, z: r.z, x: r.cam.x, y: r.cam.y, fit: r.fitZoom || 20, zd: r.defaultZoom ? r.defaultZoom() : r.fitZoom,
    b, lowQ: !!r.lowQ, reduced: !!r.reduced, intro: !!(r.intro && r.intro.t < 1.6), ox, oy, pw: r.c ? r.c.width : Math.round(r.W * r.dpr), ph: r.c ? r.c.height : Math.round(r.H * r.dpr) };
}

// ---------- caches ----------
const CACHE = new Map(); // key -> { id, layers: [{ c, x0, y0, k }], t0 }
const MAXPX = 5.5e6;
function keyOf(id, v) { const b = v.b; return [id, v.W, v.H, v.dpr, v.lowQ ? 1 : 0, Math.round(v.fit * 2), Math.round(v.zd), b.x0, b.y0, b.x1, b.y1].join('|'); }
// tile-unit rect a layer of depth p can show on this screen (any camera position, zoom down to 0.9 x overview)
function layerBounds(L, v) {
  const b = v.b, bx0 = b.x0, by0 = b.y0, bx1 = b.x1 + 1, by1 = b.y1 + 1, p = L.p;
  if (p >= 1) { const R = L.r ?? 4; return [bx0 - R, by0 - R, bx1 + R, by1 + R]; }
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, zmin = v.fit * (1 - 0.1 * p);
  const hx = Math.max(v.cx, v.W - v.cx) / zmin, hy = Math.max(v.cy, v.H - v.cy) / zmin;
  const ex = (bx1 - bx0) / 2 + 1.5, ey = (by1 - by0) / 2 + 1.5;
  return [cx - ex * p - hx - 0.6, cy - ey * p - hy - 0.6, cx + ex * p + hx + 0.6, cy + ey * p + hy + 0.6];
}
// suggested horizon (tile y): just above the board in portrait (only ~5 tiles of sky show there), a third of the way
// down the board on wide screens, so the open sides show sky, peaks and the land below
const horizon = (v) => (v.W > v.H * 1.15 ? v.b.y0 + 4.5 : v.b.y0 - 2.4);
function bakeLayer(M, L, v) {
  const [x0, y0, x1, y1] = layerBounds(L, v), w = x1 - x0, h = y1 - y0;
  let k = L.p >= 1 ? Math.min(96, v.dpr * Math.max(v.fit, v.zd)) * (L.res ?? 1) : v.dpr * v.fit * (L.res ?? (L.p < 0.3 ? 0.75 : 1));
  if (v.lowQ) k = Math.min(k, v.fit * (L.p >= 1 ? 1.4 : 0.9));
  k = Math.min(k, 4096 / w, 4096 / h, Math.sqrt(MAXPX / (w * h)));
  const c = mkC(w * k, h * k), g = c.getContext('2d');
  g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  const K = { ...KIT, x0, y0, x1, y1, k, b: { x0: v.b.x0, y0: v.b.y0, x1: v.b.x1 + 1, y1: v.b.y1 + 1 }, W: v.W, H: v.H, wide: v.W > v.H * 1.15, hz: horizon(v), lowQ: v.lowQ, reduced: v.reduced, p: L.p, T: 0 };
  if (L === M.layers[0]) { g.fillStyle = M.base || '#0a0a12'; g.fillRect(x0, y0, w, h); }
  try { L.paint && L.paint(g, K); } catch (e) { console.warn('backdrop paint', M.id, e); }
  return { c, x0, y0, k };
}
function entry(id, M, v, all) {
  const key = keyOf(id, v);
  let E = CACHE.get(key);
  if (!E) { E = { key, id, layers: [], t0: -1 }; CACHE.set(key, E); while (CACHE.size > 2) CACHE.delete(CACHE.keys().next().value); }
  const n = M.layers.length;
  while (E.layers.length < n) { E.layers.push(bakeLayer(M, M.layers[E.layers.length], v)); if (!all) break; }
  return E;
}
// R 15.0 (menu slowdown): Renderer.sleep() calls this when the game screen is left; layers rebake on the next match
export function releaseBackdrops() { CACHE.clear(); }
export function prepareBackdrop(id, v) { const M = mod(id); if (!M || !v) return false; entry(id, M, v, true); return true; }

// ---------- per frame ----------
const T0 = { t: 0, last: 0 };
function layerXf(L, v) {
  const p = Math.min(1, L.p), b = v.b, cx = (b.x0 + b.x1 + 1) / 2, cy = (b.y0 + b.y1 + 1) / 2;
  if (p >= 1) return { zL: v.z, ax: v.x, ay: v.y, sx: v.cx + v.ox, sy: v.cy + v.oy };
  const zc = Math.max(v.z, v.fit * 0.9);
  const camx = Math.max(b.x0 - 1.5, Math.min(b.x1 + 2.5, v.x)), camy = Math.max(b.y0 - 1.5, Math.min(b.y1 + 2.5, v.y));
  return { zL: v.fit + (zc - v.fit) * p, ax: cx + (camx - cx) * p, ay: cy + (camy - cy) * p, sx: v.cx + v.ox * p, sy: v.cy + v.oy * p };
}
// draw canvas c (dest rect in device px dx,dy, scale s) except the hole rect
function blit(ctx, c, dx, dy, s, hole, PW, PH) {
  const dw = c.width * s, dh = c.height * s;
  const R = hole ? [[0, 0, PW, hole[1]], [0, hole[3], PW, PH], [0, hole[1], hole[0], hole[3]], [hole[2], hole[1], PW, hole[3]]] : [[0, 0, PW, PH]];
  for (const [rx0, ry0, rx1, ry1] of R) {
    const ix0 = Math.max(rx0, dx, 0), iy0 = Math.max(ry0, dy, 0), ix1 = Math.min(rx1, dx + dw, PW), iy1 = Math.min(ry1, dy + dh, PH);
    if (ix1 - ix0 < 0.5 || iy1 - iy0 < 0.5) continue;
    const sx = (ix0 - dx) / s, sy = (iy0 - dy) / s, sw = (ix1 - ix0) / s, sh = (iy1 - iy0) / s;
    ctx.drawImage(c, sx, sy, Math.min(sw, c.width - sx), Math.min(sh, c.height - sy), ix0, iy0, ix1 - ix0, iy1 - iy0);
  }
}
// a soft, low-res bake spanning the layer's full width between y0 and y1 (tile units), cached with that layer's bake:
// for big soft animated things (aurora curtains, light shafts) that anim() then moves/fades with one or two blits
function softLayer(C, K, key, res, y0, y1, fn) {
  const S = C.soft || (C.soft = {}); let o = S[key];
  if (!o) {
    const x0 = C.x0, x1 = C.x0 + C.c.width / C.k, c = mkC((x1 - x0) * res, (y1 - y0) * res), g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
    try { fn(g, { ...K, x0, x1, y0, y1 }); } catch (e) { console.warn('backdrop soft', key, e); }
    o = S[key] = { c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return o;
}
// draw a soft() bake at (x, y) in layer tile units, skipping the part behind the board (fill-rate is the cost)
function blitOut(ctx, o, x, y, hb, K) {
  const c = o.c, sx = c.width / o.w, sy = c.height / o.h, X1 = x + o.w, Y1 = y + o.h;
  const vx0 = Math.max(x, K.x0), vy0 = Math.max(y, K.y0), vx1 = Math.min(X1, K.x1), vy1 = Math.min(Y1, K.y1);
  if (vx1 <= vx0 || vy1 <= vy0) return;
  const R = hb ? [[vx0, vy0, vx1, Math.min(vy1, hb.y0)], [vx0, Math.max(vy0, hb.y1), vx1, vy1], [vx0, Math.max(vy0, hb.y0), Math.min(vx1, hb.x0), Math.min(vy1, hb.y1)], [Math.max(vx0, hb.x1), Math.max(vy0, hb.y0), vx1, Math.min(vy1, hb.y1)]] : [[vx0, vy0, vx1, vy1]];
  for (const [a, b, e, f] of R) { if (e - a < 0.02 || f - b < 0.02) continue; ctx.drawImage(c, (a - x) * sx, (b - y) * sy, (e - a) * sx, (f - b) * sy, a, b, e - a, f - b); }
}
export const stats = { ms: 0, n: 0, snap: 0, built: 0 };
// R2 15.0.1 (perf): the layer bakes are drawn scaled every frame (resampling costs 5-10x a 1:1 copy), so while the camera
// holds still (most of a match: waiting for a move) each run of layers up to the next anim is copied once, at screen
// resolution, into "snap" canvases covering only what shows outside the board, and later frames blit those 1:1 (same
// pixels, same back-to-front order with the anims in between). Any camera move, shake, zoom or fade uses the live path.
const SNAP_STILL = 3, SNAP_MAXPX = 4.5e6;
function visRects(hole, PW, PH) {
  const R = hole ? [[0, 0, PW, hole[1]], [0, hole[3], PW, PH], [0, hole[1], hole[0], hole[3]], [hole[2], hole[1], PW, hole[3]]] : [[0, 0, PW, PH]];
  const out = [];
  for (const [a, b, c, d] of R) { const x0 = Math.max(0, a), y0 = Math.max(0, b), x1 = Math.min(PW, c), y1 = Math.min(PH, d); if (x1 - x0 >= 1 && y1 - y0 >= 1) out.push([x0, y0, x1, y1]); }
  return out;
}
function groupsOf(M) { // runs of layers that end at a layer with an anim (or the last layer)
  if (M._groups) return M._groups;
  const G = []; let cur = [];
  M.layers.forEach((L, i) => { cur.push(i); if (L.anim || i === M.layers.length - 1) { G.push(cur); cur = []; } });
  return (M._groups = G);
}
function snapBuild(E, M, xf, rects) {
  const S = E.snap || (E.snap = { canv: [] }), G = groupsOf(M);
  G.forEach((grp, gi) => {
    const row = S.canv[gi] || (S.canv[gi] = []);
    rects.forEach(([x0, y0, x1, y1], ri) => {
      let c = row[ri]; const w = x1 - x0, h = y1 - y0;
      if (!c) c = row[ri] = mkC(w, h);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else c.getContext('2d').clearRect(0, 0, w, h);
      const g = c.getContext('2d');
      for (const i of grp) { const [dx, dy, s] = xf[i]; blit(g, E.layers[i].c, dx - x0, dy - y0, s, null, w, h); }
    });
    row.length = rects.length;
  });
  S.canv.length = G.length; S.rects = rects; stats.built++;
}
export function drawBackdrop(ctx, id, v, T) {
  const M = mod(id); if (!M || !v || !M.layers || !M.layers.length) return false;
  const t0 = performance.now();
  const E = entry(id, M, v, false);
  if (E.layers.length < M.layers.length) return false; // still baking (one layer per frame)
  if (E.t0 < 0) E.t0 = T;
  const fade = v.reduced ? 1 : Math.min(1, Math.max(0, (T - E.t0) / 0.45));
  const dpr = v.dpr, PW = v.pw, PH = v.ph, b = v.b;
  // board rect in device px (p = 1 transform): layers are not drawn under it (the floor cache is opaque there)
  let hole = null;
  if (!v.intro) {
    const X = (wx) => dpr * (v.cx + v.ox + (wx - v.x) * v.z), Y = (wy) => dpr * (v.cy + v.oy + (wy - v.y) * v.z);
    hole = [Math.ceil(X(b.x0)) + 1, Math.ceil(Y(b.y0)) + 1, Math.floor(X(b.x1 + 1)) - 1, Math.floor(Y(b.y1 + 1)) - 1];
    if (hole[2] <= hole[0] || hole[3] <= hole[1]) hole = null;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = M.base || '#0a0a12';
  if (fade < 1 || !hole) ctx.fillRect(0, 0, PW, PH);
  const Tm = v.reduced ? T * 0.3 : T;
  const K = { ...KIT, b: { x0: b.x0, y0: b.y0, x1: b.x1 + 1, y1: b.y1 + 1 }, W: v.W, H: v.H, wide: v.W > v.H * 1.15, hz: horizon(v), lowQ: v.lowQ, reduced: v.reduced, T: Tm,
    n: (c) => Math.max(1, Math.round(c * (v.lowQ ? 0.5 : 1) * (v.reduced ? 0.6 : 1))) };
  // per-layer device transform (dx, dy, s) and the snap key of this frame (1/8 px)
  const XF = E.xf || (E.xf = []); let key = PW + ',' + PH + ',' + (hole ? hole.join(',') : '-');
  for (let i = 0; i < M.layers.length; i++) {
    const C = E.layers[i], X = layerXf(M.layers[i], v), s = (dpr * X.zL) / C.k;
    const xf = XF[i] || (XF[i] = [0, 0, 0, null]);
    xf[0] = dpr * (X.sx + (C.x0 - X.ax) * X.zL); xf[1] = dpr * (X.sy + (C.y0 - X.ay) * X.zL); xf[2] = s; xf[3] = X;
    key += '|' + Math.round(xf[0] * 8) + ',' + Math.round(xf[1] * 8) + ',' + Math.round(s * 1e5);
  }
  E.still = key === E.lastKey ? (E.still || 0) + 1 : 0; E.lastKey = key;
  let snap = null;
  if (fade >= 1 && E.still >= SNAP_STILL) {
    if (E.snap && E.snap.key === key) snap = E.snap;
    else if (!E.snap || E.snap.key !== key) {
      const rects = visRects(hole, PW, PH); let px = 0; for (const [a, b, c, d] of rects) px += (c - a) * (d - b);
      if (px * groupsOf(M).length <= SNAP_MAXPX) { snapBuild(E, M, XF, rects); E.snap.key = key; snap = E.snap; }
    }
  }
  if (snap) stats.snap++;
  const G = snap && groupsOf(M);
  for (let i = 0; i < M.layers.length; i++) {
    const L = M.layers[i], C = E.layers[i], X = XF[i][3];
    ctx.globalAlpha = fade;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!snap) blit(ctx, C.c, XF[i][0], XF[i][1], XF[i][2], hole, PW, PH);
    else { const gi = G.findIndex((g) => g[g.length - 1] === i); if (gi >= 0) snap.rects.forEach(([x0, y0], ri) => ctx.drawImage(snap.canv[gi][ri], x0, y0)); }
    if (L.anim) {
      const zz = dpr * X.zL;
      ctx.setTransform(zz, 0, 0, zz, dpr * (X.sx - X.ax * X.zL), dpr * (X.sy - X.ay * X.zL));
      K.p = L.p; K.x0 = X.ax - X.sx / X.zL; K.y0 = X.ay - X.sy / X.zL; K.x1 = X.ax + (v.W - X.sx) / X.zL; K.y1 = X.ay + (v.H - X.sy) / X.zL;
      // the board rect seen from this layer's depth (things fully inside it are hidden)
      const hb = hole && { x0: X.ax + ((hole[0] / dpr) - X.sx) / X.zL, y0: X.ay + ((hole[1] / dpr) - X.sy) / X.zL, x1: X.ax + ((hole[2] / dpr) - X.sx) / X.zL, y1: X.ay + ((hole[3] / dpr) - X.sy) / X.zL };
      K.hidden = hb ? (a, c, e, f) => a >= hb.x0 && e <= hb.x1 && c >= hb.y0 && f <= hb.y1 || e < K.x0 || a > K.x1 || f < K.y0 || c > K.y1 : (a, c, e, f) => e < K.x0 || a > K.x1 || f < K.y0 || c > K.y1;
      K.soft = (key, res, y0, y1, fn) => softLayer(C, K, key, res, y0, y1, fn);
      K.blitOut = (o, dx = 0, dy = 0) => blitOut(ctx, o, o.x + dx, o.y + dy, hb, K);
      try { L.anim(ctx, K); } catch (e) { if (!L._warned) { L._warned = 1; console.warn('backdrop anim', M.id, e); } }
      ctx.globalAlpha = fade; ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.restore();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ms = performance.now() - t0; stats.ms = stats.ms * 0.95 + ms * 0.05; stats.n++;
  return true;
}

// light over the board (world transform active): multiply tint + optional edge glow, then the scene's front() margin props
const LG = new WeakMap();
export function drawBackdropFront(ctx, id, r, T) {
  const M = mod(id); if (!M) return;
  let E = null; for (const e of CACHE.values()) if (e.id === id && e.t0 >= 0) E = e;
  if (!E) return;
  const fade = r.reduced ? 1 : Math.min(1, Math.max(0, (T - E.t0) / 0.45));
  const b = r.bounds || { x0: 0, y0: 0, x1: 15, y1: 15 }, x0 = b.x0 - 0.7, y0 = b.y0 - 0.7, x1 = b.x1 + 1.7, y1 = b.y1 + 1.7;
  let G = LG.get(ctx); if (!G) LG.set(ctx, (G = {}));
  const gk = id + '|' + x0 + y0 + x1 + y1;
  if (G.k !== gk) {
    const L = M.light || {}, tc = L.tint ? (Array.isArray(L.tint) ? L.tint : [L.tint, L.tint]) : null;
    G.k = gk; G.tint = null; G.glow = null;
    if (tc) { // band colours, built once (steps under 1/2 colour level)
      const A = hex(tc[0]), B = hex(tc[1]), diff = Math.max(1, ...A.map((v, i) => Math.abs(B[i] - v))), n = Math.min(160, Math.max(1, Math.ceil(diff * 2.5)));
      G.tint = Array.from({ length: n }, (_, k) => { const t = (k + 0.5) / n; return `rgb(${A[0] + (B[0] - A[0]) * t},${A[1] + (B[1] - A[1]) * t},${A[2] + (B[2] - A[2]) * t})`; });
    }
    if (L.glow) { // alpha a at the edge, a/4 half way, 0 at 7 tiles in (the 15.0 gradient's stops), 56 bands
      const [side, col, a] = L.glow, rgb = hex(col).join(',');
      G.glow = { side, n: 56, st: Array.from({ length: 56 }, (_, k) => { const t = (k + 0.5) / 56; return `rgba(${rgb},${t < 0.5 ? a * (1 - 1.5 * t) : a * 0.5 * (1 - t)})`; }) };
    }
  }
  // R2 15.0.1 (perf): gradient fills under multiply / lighter cost 3-6x a solid fill, and the rect used to cover the whole
  // board even off screen. Same light, drawn as solid bands in device pixels (steps under 1/2 colour level), visible part only.
  const m = ctx.getTransform(), PW = ctx.canvas.width, PH = ctx.canvas.height;
  const X0 = m.a * x0 + m.e, X1 = m.a * x1 + m.e, Y0 = m.d * y0 + m.f, Y1 = m.d * y1 + m.f;
  const vx0 = Math.max(0, X0), vx1 = Math.min(PW, X1), vy0 = Math.max(0, Y0), vy1 = Math.min(PH, Y1);
  ctx.save();
  ctx.globalAlpha = fade;
  if (vx1 > vx0 && vy1 > vy0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (G.tint) {
      ctx.globalCompositeOperation = 'multiply';
      const n = G.tint.length, bh = (Y1 - Y0) / n;
      for (let k = Math.max(0, Math.floor((vy0 - Y0) / bh)); k < n; k++) {
        const ya = Math.max(vy0, k ? Math.round(Y0 + k * bh) : Y0), yb = Math.min(vy1, k < n - 1 ? Math.round(Y0 + (k + 1) * bh) : Y1); if (ya >= vy1) break; if (yb <= ya) continue;
        ctx.fillStyle = G.tint[k]; ctx.fillRect(vx0, ya, vx1 - vx0, yb - ya);
      }
    }
    if (G.glow && !r.lowQ) {
      ctx.globalCompositeOperation = 'lighter';
      const { side, n, st } = G.glow, vert = side === 't' || side === 'b', sc = vert ? m.d : m.a, d = 7 * sc;
      const S = side === 't' ? Y0 : side === 'b' ? Y1 : side === 'l' ? X0 : X1, dir = side === 't' || side === 'l' ? 1 : -1;
      const lo = vert ? vy0 : vx0, hi = vert ? vy1 : vx1;
      for (let k = 0; k < n; k++) {
        let p0 = k ? Math.round(S + dir * d * k / n) : S, p1 = Math.round(S + dir * d * (k + 1) / n); if (dir < 0) [p0, p1] = [p1, p0];
        p0 = Math.max(lo, p0); p1 = Math.min(hi, p1); if (p1 <= p0) continue;
        ctx.fillStyle = st[k];
        if (vert) ctx.fillRect(vx0, p0, vx1 - vx0, p1 - p0); else ctx.fillRect(p0, vy0, p1 - p0, vy1 - vy0);
      }
    }
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  }
  const cc = M.light && M.light.caustic;
  if (cc && !r.lowQ) { // drifting pools of light (water caustics, leaf dapple): a handful of soft additive blits
    ctx.globalCompositeOperation = 'lighter'; const sp = glow(cc), Tm = r.reduced ? T * 0.3 : T, w = x1 - x0, h = y1 - y0;
    for (let i = 0; i < 9; i++) { const u = (Math.sin(Tm * 0.07 + i * 2.4) * 0.5 + 0.5), q = ((Tm * 0.025 + i * 0.137) % 1), s = 2.2 + (i % 3); ctx.globalAlpha = fade * (0.07 + 0.04 * Math.sin(Tm * 0.9 + i)); blitExact(ctx, sp, x0 + u * w - s / 2, y0 + q * (h + s) - s, s, s * 0.7); }
  }
  ctx.restore();
  if (M.front) { ctx.save(); try { M.front(ctx, { ...KIT, b: { x0: b.x0, y0: b.y0, x1: b.x1 + 1, y1: b.y1 + 1 }, T: r.reduced ? T * 0.3 : T, lowQ: !!r.lowQ, reduced: !!r.reduced, n: (c) => Math.max(1, Math.round(c * (r.lowQ ? 0.5 : 1))) }); } catch {} ctx.restore(); }
}

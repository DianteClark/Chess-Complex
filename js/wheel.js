// E2 15.0: the World Tour location wheel (match intro). A ring of eight location cards, each a live miniature of that
// location's backdrop with its emblem, spins, slows to a crawl and lands on the host-chosen location with a flourish.
//
//   spinWheel(container, targetId, { reduced, duration, locations, onDone, sfx }) -> Promise<id>  (+ .skip(), .stop())
//   spinWheel(container, { target, reduced, duration, locations, onDone })                         (F's call shape)
//
// Deterministic: it always lands on `target` (LOCATION_IDS order, the same order engine/locations.js uses). The container
// gets a canvas filling it; F owns placement, the skip tap and closing. onDone fires once on landing (or on skip());
// without an onDone it dispatches 'cc:wheel-landed' {id} itself. Ticks call sfx['wheel:tick'](speed 0..1) per card pass
// (AU's ratchet then stands down); AU plays the stop thunk and reveal stinger on 'cc:wheel-landed'.
import { LOCATIONS, LOCATION_IDS } from './locations.js';
import { sfx as SFX } from './audio.js';
import { statue } from './backdrops/e2kit.js';

const TAU = Math.PI * 2;
const hex = (h) => { h = String(h || '#888').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
const shade = (h, k) => `rgb(${hex(h).map((v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))).join(',')})`;
const mkC = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT_D = "'Cinzel', 'Trajan Pro', Georgia, serif", FONT_U = "'Chakra Petch', system-ui, sans-serif";
const MOODS = { citadel: '#7fe0ff', forge: '#ff5a1f', temple: '#3ddcff', gardens: '#9be3b4', ruins: '#e8b04a', works: '#ff9a3d', rift: '#b04dff', bog: '#8cff5a', spire: '#f5c76a' }; // 16.0 (L): + spire

// ---------- location previews: the real backdrop layers painted small, with a miniature board ----------
const PREV = new Map(); // `${id}|${w}x${h}` -> canvas | Promise
// Preview canvases (~7 MB) are only needed during the intro; the game calls this when it leaves the match screen.
export function releaseWheel() { PREV.clear(); }
function rng(seed) { let a = (seed * 2654435761) >>> 0 || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function ridge({ x0, x1, y, amp = 2, seed = 1, step = 0.25, rough = 0.55, peaks = null }) {
  const R = rng(seed), n = Math.max(2, Math.ceil((x1 - x0) / step)), N = 1 << Math.ceil(Math.log2(n)), h = new Float32Array(N + 1);
  h[0] = R() - 0.5; h[N] = R() - 0.5;
  for (let s = N, a = 1; s > 1; s >>= 1, a *= rough) for (let i = s >> 1; i < N; i += s) h[i] = (h[i - (s >> 1)] + h[i + (s >> 1)]) / 2 + (R() - 0.5) * a;
  const pts = [];
  for (let i = 0; i <= N; i++) { const x = x0 + ((x1 - x0) * i) / N; let yy = y - h[i] * amp; if (peaks) for (const [px, ph, pw] of peaks) { const d = Math.abs(x - px) / pw; if (d < 1) yy -= ph * (1 - d) * (1 - d * 0.35); } pts.push([x, yy]); }
  return pts;
}
const GL = new Map();
function glow(col) { let c = GL.get(col); if (c) return c; c = mkC(64, 64); const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.4, rgba(col, 0.38)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); GL.set(col, c); return c; }
const SPR = new Map();
const KIT = {
  rng, mix, rgba, shade, ridge, glow,
  lin: (g, x0, y0, x1, y1, st) => { const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of st) gr.addColorStop(o, c); return gr; },
  rad: (g, x, y, r0, r1, st) => { const gr = g.createRadialGradient(x, y, r0, x, y, r1); for (const [o, c] of st) gr.addColorStop(o, c); return gr; },
  fillRidge: (g, pts, bottom) => { g.beginPath(); g.moveTo(pts[0][0], bottom); for (const [x, y] of pts) g.lineTo(x, y); g.lineTo(pts[pts.length - 1][0], bottom); g.closePath(); g.fill(); },
  sprite: (key, w, h, fn) => { let c = SPR.get(key); if (c) return c; c = mkC(w, h); fn(c.getContext('2d'), c.width, c.height); SPR.set(key, c); return c; },
};
// the window of the scene a card shows (tiles): the hero skyline above the board and its top rows
const VIEW = { x0: 2.4, x1: 13.6, y0: -8.2 };
function paintPreview(M, id, w, h, look) {
  const c = mkC(w, h), g = c.getContext('2d'), k = w / (VIEW.x1 - VIEW.x0), y1 = VIEW.y0 + h / k;
  const b = { x0: 0, y0: 0, x1: 16, y1: 16 };
  const K = { ...KIT, x0: VIEW.x0 - 0.5, y0: VIEW.y0 - 0.5, x1: VIEW.x1 + 0.5, y1: y1 + 0.5, k, b, W: w, H: h, wide: false, hz: b.y0 - 2.4, lowQ: false, reduced: true, preview: true, T: 7.3, p: 1,
    n: (n) => n, hidden: (a, c2, e, f) => a >= b.x0 && e <= b.x1 && c2 >= b.y0 && f <= b.y1 };
  g.setTransform(k, 0, 0, k, -VIEW.x0 * k, -VIEW.y0 * k);
  g.fillStyle = M.base || '#0a0a12'; g.fillRect(K.x0, K.y0, K.x1 - K.x0, K.y1 - K.y0);
  for (const L of M.layers || []) {
    g.save(); try { K.p = L.p; L.paint && L.paint(g, K); } catch (e) { /* a scene that fails to paint small just shows what it got */ } g.restore();
    g.save(); try { L.anim && L.anim(g, K); } catch (e) {} g.restore(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  miniBoard(g, b, y1, look);
  return c;
}
function miniBoard(g, b, y1, look) { // the store board stand-in: dark checker with a gilt frame, catching the location light
  g.fillStyle = '#0d0b10'; g.fillRect(b.x0 - 0.7, b.y0 - 0.7, b.x1 - b.x0 + 1.4, y1 - b.y0 + 1);
  for (let y = b.y0; y < Math.min(b.y1, y1 + 1); y++) for (let x = b.x0; x < b.x1; x++) { g.fillStyle = (x + y) % 2 ? '#2a2632' : '#3a3542'; g.fillRect(x + 0.02, y + 0.02, 0.96, 0.96); }
  const gr = g.createLinearGradient(0, b.y0, 0, b.y0 + 5); gr.addColorStop(0, rgba(look, 0.35)); gr.addColorStop(1, rgba(look, 0)); g.fillStyle = gr; g.fillRect(b.x0, b.y0, b.x1 - b.x0, 5);
  g.strokeStyle = '#b89448'; g.lineWidth = 0.14; g.strokeRect(b.x0 - 0.4, b.y0 - 0.4, b.x1 - b.x0 + 0.8, y1 - b.y0 + 2);
  g.strokeStyle = 'rgba(255,230,160,0.5)'; g.lineWidth = 0.04; g.strokeRect(b.x0 - 0.52, b.y0 - 0.52, b.x1 - b.x0 + 1.04, y1 - b.y0 + 2);
  // a few pieces standing on it, lit by the location
  const pc = { dark: '#16141c', mid: '#5a5468', lite: '#d8d0e8', rim: rgba(look, 0.9), cracks: false };
  for (const [x, t] of [[3.5, 'rook'], [7.5, 'king']]) { statue(g, { x, base: b.y0 + 1.85, h: 1.45, type: t, seed: 3, light: 1, ...pc }); }
  statue(g, { x: 11.5, base: b.y0 + 3.85, h: 1.1, type: 'pawn', seed: 5, light: 1, ...pc });
}
export function preloadWheel(w = 240, h = 340, ids = LOCATION_IDS) { for (const id of ids) previewOf(id, w, h); }
function previewOf(id, w, h) {
  const key = `${id}|${w}x${h}`, have = PREV.get(key);
  if (have) return have instanceof Promise ? null : have;
  PREV.set(key, import(`./backdrops/${id}.js`).then((m) => new Promise((res) => {
    // one card per frame so the spin never hitches
    const go = () => { let c = null; try { c = paintPreview(m.default, id, w, h, (LOCATIONS[id] && LOCATIONS[id].mood && LOCATIONS[id].mood.light) || '#ffffff'); } catch (e) { c = null; } PREV.set(key, c || false); res(c); };
    (typeof requestIdleCallback === 'function' ? requestIdleCallback : requestAnimationFrame)(go, { timeout: 120 });
  })).catch(() => { PREV.set(key, false); return null; }));
  return null;
}

// ---------- emblems: one per location, drawn in a unit circle ----------
const EMBLEM = {
  citadel(g) { g.lineCap = 'round'; for (let i = 0; i < 6; i++) { g.save(); g.rotate((i / 6) * TAU); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -0.78); for (const [d, l] of [[-0.32, 0.22], [-0.55, 0.16]]) { g.moveTo(0, d); g.lineTo(l, d - l); g.moveTo(0, d); g.lineTo(-l, d - l); } g.stroke(); g.restore(); } g.beginPath(); g.arc(0, 0, 0.12, 0, TAU); g.fill(); },
  forge(g) { const flame = (s, oy) => { g.beginPath(); g.moveTo(0, 0.7 * s + oy); g.bezierCurveTo(-0.62 * s, 0.6 * s + oy, -0.55 * s, -0.1 * s + oy, -0.1 * s, -0.78 * s + oy); g.bezierCurveTo(-0.05 * s, -0.35 * s + oy, 0.25 * s, -0.3 * s + oy, 0.22 * s, -0.55 * s + oy); g.bezierCurveTo(0.6 * s, -0.15 * s + oy, 0.62 * s, 0.6 * s + oy, 0, 0.7 * s + oy); g.closePath(); }; flame(1, 0); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; flame(0.5, 0.25); g.fill(); g.restore(); },
  temple(g) { g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 0.8); g.lineTo(0, -0.75); g.moveTo(-0.45, -0.75); g.lineTo(-0.45, -0.25); g.quadraticCurveTo(-0.45, 0.05, 0, 0.05); g.quadraticCurveTo(0.45, 0.05, 0.45, -0.25); g.lineTo(0.45, -0.75); g.stroke(); for (const x of [-0.45, 0, 0.45]) { g.beginPath(); g.moveTo(x - 0.1, -0.62); g.lineTo(x, -0.86); g.lineTo(x + 0.1, -0.62); g.fill(); } g.beginPath(); g.moveTo(-0.75, 0.55); g.quadraticCurveTo(-0.4, 0.35, 0, 0.55); g.quadraticCurveTo(0.4, 0.75, 0.75, 0.55); g.stroke(); },
  gardens(g) { for (let i = 0; i < 5; i++) { g.save(); g.rotate((i / 5) * TAU); g.beginPath(); g.ellipse(0, -0.42, 0.26, 0.38, 0, 0, TAU); g.fill(); g.restore(); } g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0, 0.2, 0, TAU); g.fill(); g.restore(); g.beginPath(); g.arc(0, 0, 0.11, 0, TAU); g.fill(); },
  ruins(g) { g.beginPath(); g.arc(0, -0.15, 0.32, Math.PI, 0); g.fill(); g.lineCap = 'round'; for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI; g.beginPath(); g.moveTo(Math.cos(a) * 0.45, -0.15 + Math.sin(a) * 0.45); g.lineTo(Math.cos(a) * 0.72, -0.15 + Math.sin(a) * 0.72); g.stroke(); } g.fillRect(-0.85, -0.08, 1.7, 0.1); g.beginPath(); g.moveTo(-0.28, 0.02); g.lineTo(-0.24, 0.62); g.lineTo(0.24, 0.62); g.lineTo(0.26, 0.2); g.lineTo(0.05, 0.12); g.lineTo(0.28, 0.02); g.fill(); g.fillRect(-0.42, 0.62, 0.84, 0.14); },
  works(g) { g.beginPath(); const n = 10; for (let i = 0; i < n * 2; i++) { const a0 = (i / (n * 2)) * TAU, r = i % 2 ? 0.62 : 0.8; g.arc(0, 0, r, a0, a0 + TAU / (n * 2)); } g.closePath(); g.fill(); g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0, 0.3, 0, TAU); g.fill(); g.restore(); },
  rift(g) { g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU - Math.PI / 2, r = i % 2 ? 0.2 : 0.82; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.beginPath(); g.ellipse(0, 0, 0.9, 0.34, -0.5, 0, TAU); g.stroke(); },
  spire(g) { // 16.0 (L): a clock face with hands at ten to two inside a cog ring
    g.beginPath(); const n = 12; for (let i = 0; i < n * 2; i++) { const a0 = (i / (n * 2)) * TAU, r = i % 2 ? 0.7 : 0.84; g.arc(0, 0, r, a0, a0 + TAU / (n * 2)); } g.closePath(); g.fill();
    g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0, 0.58, 0, TAU); g.fill(); g.restore();
    g.lineCap = 'round'; for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, r0 = i % 3 ? 0.46 : 0.38; g.lineWidth = i % 3 ? 0.06 : 0.1; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * 0.53, Math.sin(a) * 0.53); g.stroke(); }
    g.lineWidth = 0.12; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(-1.05) * 0.3, -Math.cos(-1.05) * 0.3); g.moveTo(0, 0); g.lineTo(Math.sin(1.05) * 0.42, -Math.cos(1.05) * 0.42); g.stroke();
    g.beginPath(); g.arc(0, 0, 0.08, 0, TAU); g.fill();
  },
  bog(g) { g.beginPath(); g.arc(0, -0.05, 0.62, 0, TAU); g.arc(0.26, -0.2, 0.52, 0, TAU, true); g.fill('evenodd'); g.beginPath(); g.arc(0.38, 0.42, 0.13, 0, TAU); g.fill(); g.globalAlpha *= 0.5; g.beginPath(); g.arc(0.38, 0.42, 0.24, 0, TAU); g.fill(); },
};
function drawEmblem(g, id, x, y, r, col, plate = true) {
  g.save(); g.translate(x, y);
  if (plate) {
    const gr = g.createRadialGradient(-r * 0.3, -r * 0.4, 0, 0, 0, r * 1.05); gr.addColorStop(0, '#2a2433'); gr.addColorStop(1, '#0c0a12');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.lineWidth = r * 0.12; g.strokeStyle = '#c9a256'; g.stroke(); g.lineWidth = r * 0.04; g.strokeStyle = 'rgba(255,236,180,0.85)'; g.beginPath(); g.arc(0, 0, r * 0.84, 0, TAU); g.stroke();
  }
  g.scale(r * 0.62, r * 0.62); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 0.13;
  g.shadowColor = col; g.shadowBlur = r * 0.5;
  (EMBLEM[id] || EMBLEM.rift)(g);
  g.restore();
}

// ---------- the cards ----------
function rr(g, x, y, w, h, q) { g.beginPath(); g.moveTo(x + q, y); g.arcTo(x + w, y, x + w, y + h, q); g.arcTo(x + w, y + h, x, y + h, q); g.arcTo(x, y + h, x, y, q); g.arcTo(x, y, x + w, y, q); g.closePath(); }
function cardFace(id, L, w, h, img) {
  const c = mkC(w, h), g = c.getContext('2d'), q = w * 0.07, mood = (L && L.mood) || {}, acc = mood.accent || MOODS[id] || '#f0c25e';
  g.save(); rr(g, 0, 0, w, h, q); g.clip();
  if (img) g.drawImage(img, 0, 0, w, h);
  else { const sky = mood.sky || ['#222', '#000']; const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]); g.fillStyle = gr; g.fillRect(0, 0, w, h); drawEmblem(g, id, w / 2, h * 0.38, w * 0.28, rgba(acc, 0.35), false); }
  // name banner
  const by = h * 0.7, gb = g.createLinearGradient(0, by - h * 0.12, 0, h); gb.addColorStop(0, 'rgba(6,5,10,0)'); gb.addColorStop(0.35, 'rgba(6,5,10,0.82)'); gb.addColorStop(1, 'rgba(6,5,10,0.96)');
  g.fillStyle = gb; g.fillRect(0, by - h * 0.12, w, h);
  g.fillStyle = rgba(acc, 0.9); g.fillRect(w * 0.18, by + h * 0.075, w * 0.64, Math.max(1, h * 0.004));
  const name = (L && L.name) || id, words = name.split(' ');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f6ecd6';
  let fs = w * 0.13; g.font = `700 ${fs}px ${FONT_D}`;
  const fit = (s) => { while (g.measureText(s).width > w * 0.86 && fs > 6) { fs *= 0.92; g.font = `700 ${fs}px ${FONT_D}`; } };
  if (words.length > 1) { fit(words[0]); fit(words.slice(1).join(' ')); g.fillText(words[0].toUpperCase(), w / 2, by + h * 0.135); g.fillText(words.slice(1).join(' ').toUpperCase(), w / 2, by + h * 0.135 + fs * 1.1); }
  else { fit(name); g.fillText(name.toUpperCase(), w / 2, by + h * 0.16); }
  // glass sheen
  const sh = g.createLinearGradient(0, 0, w, h * 0.6); sh.addColorStop(0, 'rgba(255,255,255,0.16)'); sh.addColorStop(0.35, 'rgba(255,255,255,0.03)'); sh.addColorStop(0.36, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fillRect(0, 0, w, h);
  g.restore();
  // emblem medallion riding the banner edge
  drawEmblem(g, id, w / 2, by + h * 0.005, w * 0.115, acc);
  // gilt frame
  rr(g, 1, 1, w - 2, h - 2, q); g.lineWidth = Math.max(2, w * 0.022); g.strokeStyle = '#c9a256'; g.stroke();
  rr(g, w * 0.03, w * 0.03, w - w * 0.06, h - w * 0.06, q * 0.7); g.lineWidth = Math.max(1, w * 0.006); g.strokeStyle = rgba(acc, 0.8); g.stroke();
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) { g.fillStyle = '#e6c477'; g.beginPath(); g.moveTo(x + (x ? -1 : 1) * w * 0.02, y + (y ? -1 : 1) * w * 0.1); g.lineTo(x + (x ? -1 : 1) * w * 0.1, y + (y ? -1 : 1) * w * 0.02); g.lineTo(x + (x ? -1 : 1) * w * 0.035, y + (y ? -1 : 1) * w * 0.035); g.fill(); }
  return c;
}
let BACK = null;
function cardBack(w, h) {
  if (BACK && BACK.width === w && BACK.height === h) return BACK;
  const c = mkC(w, h), g = c.getContext('2d'), q = w * 0.07;
  g.save(); rr(g, 0, 0, w, h, q); g.clip();
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1c1630'); gr.addColorStop(1, '#0a0812'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(201,162,86,0.18)'; g.lineWidth = Math.max(1, w * 0.006); const s = w * 0.12;
  for (let x = -h; x < w + h; x += s) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); }
  g.translate(w / 2, h / 2); for (let i = 0; i < 16; i++) { g.rotate(TAU / 16); g.fillStyle = i % 2 ? 'rgba(201,162,86,0.25)' : 'rgba(201,162,86,0.5)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.04, -w * (i % 2 ? 0.22 : 0.34)); g.lineTo(-w * 0.04, -w * (i % 2 ? 0.22 : 0.34)); g.fill(); }
  g.fillStyle = '#c9a256'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, r = i % 2 ? w * 0.05 : w * 0.13; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
  g.restore();
  rr(g, 1, 1, w - 2, h - 2, q); g.lineWidth = Math.max(2, w * 0.022); g.strokeStyle = '#8a6d36'; g.stroke();
  BACK = c; return c;
}

// ---------- spin ----------
const EASE_P = 2.3, easeSpin = (t) => 1 - Math.pow(1 - t, EASE_P); // the last card change lands at about 82% of the spin
export function spinWheel(container, target, opts) {
  if (target && typeof target === 'object') { opts = target; target = opts.target; }
  opts = opts || {};
  const Ls = opts.locations && Object.keys(opts.locations).length ? opts.locations : LOCATIONS;
  const ids = LOCATION_IDS.filter((k) => Ls[k] || LOCATIONS[k]);
  const n = ids.length || 1, ti = Math.max(0, ids.indexOf(target)), tid = ids[ti] || target;
  const reduced = !!opts.reduced, dur = clamp(+opts.duration || (reduced ? 1300 : 3100), 600, 9000), sfx = opts.sfx || SFX;
  const L = (k) => Ls[k] || LOCATIONS[k] || { name: k };

  // canvas filling the container
  const cs = getComputedStyle(container);
  if (cs.position === 'static') container.style.position = 'relative';
  if (container.clientHeight < 120) { container.style.position = 'absolute'; container.style.inset = '0'; }
  const cv = document.createElement('canvas'); cv.className = 'lw-canvas'; cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
  container.appendChild(cv);
  const g = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, cw = 0, ch = 0, faces = new Map(), facesKey = '';
  const size = () => {
    const r = container.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(200, r.width || innerWidth); H = Math.max(200, r.height || innerHeight);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cw = Math.round(Math.min(W * 0.44, H * 0.3, 250)); ch = Math.round(cw * 1.42);
    const k = `${cw}x${ch}`; if (k !== facesKey) { facesKey = k; faces = new Map(); }
  };
  size();
  const face = (id) => {
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr); let f = faces.get(id);
    const img = previewOf(id, pw, ph);
    if (!f || (img && !f.img)) { f = { c: cardFace(id, L(id), pw, ph, img), img: !!img }; faces.set(id, f); }
    return f.c;
  };
  for (const id of [tid, ...ids]) previewOf(id, Math.round(cw * dpr), Math.round(ch * dpr)); // target first

  // motion: pos is the card index under the pointer (fractional). Lands exactly on ti.
  const D = reduced ? 0 : 3 * n + 2.6, start = ti - D, over = reduced ? 0 : 0.14;
  const tSpin = reduced ? 0 : dur - 420, tLand = reduced ? Math.min(450, dur * 0.4) : tSpin + 260;
  const clock = typeof opts.clock === 'function' ? opts.clock : () => performance.now(); // opts.clock: test hook for frame captures
  const t0 = clock();
  let raf = 0, landed = false, landT = 0, lastCard = Math.round(start), done = null, stopped = false, skipped = false;
  const P = new Promise((res) => { done = res; });
  const posAt = (ms) => {
    if (reduced) return ti;
    if (ms < tSpin) return start + (D + over) * easeSpin(ms / tSpin);
    const k = Math.min(1, (ms - tSpin) / 260); return ti + over * (1 - k) * Math.cos(k * Math.PI * 1.5) * (1 - k * 0.3) * (1 - k); // spring back onto the target
  };
  const land = () => {
    if (landed) return; landed = true; landT = clock();
    try { if (opts.onDone) opts.onDone(tid); else dispatchEvent(new CustomEvent('cc:wheel-landed', { detail: { id: tid } })); } catch (e) { console.warn('wheel onDone', e); }
    done(tid);
  };
  const acc = (id) => ((L(id).mood && L(id).mood.accent) || MOODS[id] || '#f0c25e');
  const parts = Array.from({ length: 46 }, (_, i) => { const R = rng(i + 3); return { a: R() * TAU, v: 0.6 + R() * 1.2, s: 1 + R() * 2.2, l: 0.5 + R() * 0.6, w: R() < 0.3 }; });

  const frame = () => {
    if (stopped) return;
    const now = clock();
    if (!cv.isConnected) { stopped = true; if (!landed) land(); return; }
    const ms = skipped ? Math.max(dur, now - t0) : now - t0;
    const pos = skipped ? ti : posAt(ms);
    if (!landed && ms >= tLand) land();
    if (cv.width !== Math.round(W * dpr) || Math.abs(container.getBoundingClientRect().width - W) > 2) size();
    // ticks as each card passes the pointer
    const cur = Math.round(pos);
    if (cur !== lastCard && !reduced && !skipped && ms < tSpin + 60) { lastCard = cur; const sp = clamp(((D + over) * EASE_P * Math.pow(1 - Math.min(1, ms / tSpin), EASE_P - 1)) / (tSpin / 1000) / 14, 0, 1); try { sfx['wheel:tick'] && sfx['wheel:tick'](sp); } catch {} }
    draw(pos, ms, now);
    raf = requestAnimationFrame(frame);
  };
  const draw = (pos, ms, now) => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    // vertical layout: the ring plus a caption block (name + two blurb lines) must fit, landscape phones included
    const capFs = Math.round(clamp(Math.min(W * 0.085, H * 0.09), 22, 52)), capLh = Math.round(clamp(W * 0.032, 12, 16)) * 1.35, capH = capFs * 1.25 + capLh * 2.2;
    const cy = Math.max(ch * 0.5 + 34, Math.min(H * 0.46, H - 10 - capH - ch * 0.17 - 14 - ch * 0.62)), cx = W / 2, Rx = Math.min(W * 0.46, cw * 1.7), lt = landed ? (now - landT) / 1000 : 0, lk = clamp(lt / 0.5, 0, 1);
    const front = ((Math.round(pos) % n) + n) % n, fa = acc(ids[front]);
    // backdrop: dim the arena; after landing, wash it in the location's colour
    const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75); bg.addColorStop(0, 'rgba(14,10,24,0.74)'); bg.addColorStop(1, 'rgba(3,2,8,0.94)');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (landed) { const wg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6); wg.addColorStop(0, rgba(acc(tid), 0.28 * lk)); wg.addColorStop(1, rgba(acc(tid), 0)); g.fillStyle = wg; g.fillRect(0, 0, W, H); }
    // light rays behind the front card on landing
    if (landed) {
      g.save(); g.translate(cx, cy); g.rotate(reduced ? 0 : lt * 0.35); g.globalCompositeOperation = 'lighter';
      const rl = Math.max(W, H) * 0.7, rays = 14;
      for (let i = 0; i < rays; i++) { g.rotate(TAU / rays); const gr = g.createLinearGradient(0, 0, 0, -rl); gr.addColorStop(0, rgba(acc(tid), 0.26 * lk)); gr.addColorStop(1, rgba(acc(tid), 0)); g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(rl * 0.09, -rl); g.lineTo(-rl * 0.09, -rl); g.fill(); }
      g.restore();
    }
    // the floor ring the cards ride on
    const fy = cy + ch * 0.62, frx = Rx * 1.22, fry = ch * 0.17;
    g.save(); g.globalCompositeOperation = 'lighter';
    g.strokeStyle = rgba(landed ? acc(tid) : '#e6c477', 0.55); g.lineWidth = 2; g.beginPath(); g.ellipse(cx, fy, frx, fry, 0, 0, TAU); g.stroke();
    g.strokeStyle = rgba('#e6c477', 0.18); g.lineWidth = 8; g.stroke();
    for (let i = 0; i < n * 3; i++) { const a = ((i / (n * 3)) - pos / n) * TAU, x = cx + Math.sin(a) * frx, y = fy + Math.cos(a) * fry, z = (Math.cos(a) + 1) / 2; g.fillStyle = rgba(i % 3 ? '#e6c477' : '#fff2c8', 0.2 + z * 0.7); g.beginPath(); g.arc(x, y, i % 3 ? 1.5 : 2.6 + z * 1.5, 0, TAU); g.fill(); }
    g.restore();
    // cards, back to front
    const order = ids.map((id, i) => { const a = ((i - pos) / n) * TAU; return { id, i, a, z: Math.cos(a) }; }).sort((p, q) => p.z - q.z);
    const vel = !reduced && !landed && ms < tSpin ? (D + over) * EASE_P * Math.pow(1 - ms / tSpin, EASE_P - 1) / (tSpin / 1000) : 0;
    for (const o of order) {
      const s = 0.56 + 0.44 * ((o.z + 1) / 2), x = cx + Math.sin(o.a) * Rx, y = cy - (1 - o.z) * ch * 0.16, fsx = Math.cos(o.a);
      const isT = landed && o.id === tid, pop = isT ? 1 + 0.14 * Math.sin(Math.min(1, lt / 0.35) * Math.PI * 0.5) - (reduced ? 0.06 : 0.04 * Math.min(1, Math.max(0, lt - 0.35) / 0.3)) : 1;
      const sx = s * pop * Math.max(0.06, Math.abs(fsx) * 0.82 + 0.18) * Math.sign(fsx || 1), sy = s * pop, skew = -Math.sin(o.a) * 0.1 * s;
      const dim = landed && !isT ? 1 - 0.75 * lk : 1, A = (0.35 + 0.65 * ((o.z + 1) / 2)) * dim;
      // shadow on the floor
      g.globalAlpha = 0.35 * A; g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, fy + (y - cy) * 0.15, cw * 0.5 * Math.abs(sx) + 4, fry * 0.35 * s, 0, 0, TAU); g.fill();
      const img = fsx >= 0 ? face(o.id) : cardBack(Math.round(cw * dpr), Math.round(ch * dpr));
      const put = (alpha, dx) => { g.globalAlpha = alpha; g.setTransform(dpr * sx, dpr * skew, 0, dpr * sy, dpr * (x + dx), dpr * y); g.drawImage(img, -cw / 2, -ch / 2, cw, ch); g.setTransform(dpr, 0, 0, dpr, 0, 0); };
      if (vel > 4 && o.z > 0.3) { const blur = Math.min(26, vel * 1.2) * o.z; put(A * 0.22, -blur); put(A * 0.22, blur * 0.5); } // motion smear while fast
      put(A, 0);
      // the card at the pointer catches a moving gleam
      if (o.z > 0.92 && fsx > 0) {
        g.save(); g.setTransform(dpr * sx, dpr * skew, 0, dpr * sy, dpr * x, dpr * y); rr(g, -cw / 2, -ch / 2, cw, ch, cw * 0.07); g.clip(); g.globalCompositeOperation = 'lighter';
        const gx = ((pos % 1) + 1) % 1, sw = g.createLinearGradient(-cw + gx * cw * 2.2, -ch / 2, -cw * 0.6 + gx * cw * 2.2, ch / 2); sw.addColorStop(0, 'rgba(255,255,255,0)'); sw.addColorStop(0.5, `rgba(255,246,220,${isT ? 0.1 + 0.25 * (1 - lk) : 0.16})`); sw.addColorStop(1, 'rgba(255,255,255,0)'); g.globalAlpha = A; g.fillStyle = sw; g.fillRect(-cw, -ch, cw * 2, ch * 2);
        if (isT) { g.globalAlpha = 1; g.lineWidth = 4 + 6 * (1 - lk); g.strokeStyle = rgba(acc(tid), 0.9); rr(g, -cw / 2 + 2, -ch / 2 + 2, cw - 4, ch - 4, cw * 0.07); g.stroke(); }
        g.restore();
      }
    }
    g.globalAlpha = 1; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // pointer: a gilt chevron above the front slot, flaring on each tick
    const top = cy - ch * 0.5 - 16, flick = reduced ? 0 : Math.max(0, 1 - Math.abs((pos % 1 + 1) % 1 - 0.5) * 2.2) * Math.min(1, vel / 6);
    g.save(); g.translate(cx, top - flick * 4); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.6; g.drawImage(glow(landed ? acc(tid) : '#ffd27a'), -26, -30, 52, 52); g.restore();
    g.save(); g.translate(cx, top - flick * 4); g.fillStyle = '#e6c477'; g.strokeStyle = '#5a4420'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-13, -14); g.lineTo(13, -14); g.lineTo(0, 6); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#fff4d0'; g.beginPath(); g.moveTo(-6, -11); g.lineTo(2, -11); g.lineTo(-1, -3); g.fill(); g.restore();
    // landing: shockwave ring and a burst of sparks in the location colour
    if (landed && !reduced && lt < 1.2) {
      const k = lt / 0.8, ac = acc(tid);
      g.save(); g.globalCompositeOperation = 'lighter';
      if (k < 1) { g.globalAlpha = 1 - k; g.strokeStyle = ac; g.lineWidth = 3 + 8 * (1 - k); g.beginPath(); g.ellipse(cx, cy, cw * (0.5 + k * 1.6), ch * (0.4 + k * 0.9), 0, 0, TAU); g.stroke(); }
      for (const p of parts) { const d = (cw * 0.4 + p.v * cw * 1.4 * Math.min(1, lt / p.l)) , f = Math.min(1, lt / (p.l * 1.4)); if (f >= 1) continue; const px = cx + Math.cos(p.a) * d, py = cy + Math.sin(p.a) * d * 0.8 + lt * lt * 60; g.globalAlpha = 1 - f; g.fillStyle = p.w ? '#ffffff' : ac; g.beginPath(); g.arc(px, py, p.s * (1 - f * 0.5), 0, TAU); g.fill(); }
      if (lt < 0.25) { g.globalAlpha = (1 - lt / 0.25) * 0.28; g.drawImage(glow('#ffffff'), cx - cw, cy - ch * 0.7, cw * 2, ch * 1.4); }
      g.restore();
    }
    // caption: the passing names while spinning, the chosen one large on landing
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const capY = fy + fry + 12;
    if (!landed) {
      const nm = (L(ids[front]).name || ids[front]).toUpperCase(); g.font = `600 ${Math.round(clamp(W * 0.035, 12, 17))}px ${FONT_U}`;
      g.fillStyle = rgba(fa, 0.85); g.globalAlpha = 0.85; spaced(g, nm, cx, capY + 14, 3); g.globalAlpha = 1;
    } else {
      const fs = capFs, e = 1 - Math.pow(1 - Math.min(1, lt / 0.45), 3), name = L(tid).name || tid;
      g.save(); g.globalAlpha = e; g.font = `800 ${fs}px ${FONT_D}`; g.shadowColor = acc(tid); g.shadowBlur = reduced ? 8 : 22 * (1 - lk * 0.5);
      g.fillStyle = '#fff6e0'; spaced(g, name, cx, capY + fs * 0.9 - (1 - e) * 10, (reduced ? 2 : 2 + 6 * (1 - e)));
      g.shadowBlur = 0; const bl = L(tid).blurb; if (bl) { g.font = `500 ${Math.round(clamp(W * 0.032, 12, 16))}px ${FONT_U}`; g.fillStyle = 'rgba(240,232,214,0.85)'; wrap(g, bl, cx, capY + fs * 0.9 + capLh * 1.2, Math.min(W * 0.86, 520), capLh); }
      g.restore();
    }
  };
  raf = requestAnimationFrame(frame);
  const ctl = P;
  ctl.skip = () => { if (stopped) return; skipped = true; if (!landed) land(); };
  ctl.stop = () => { stopped = true; cancelAnimationFrame(raf); if (!landed) land(); cv.remove(); };
  ctl.target = tid;
  return ctl;
}
function spaced(g, s, x, y, sp) { // letter-spaced centred text
  const ws = [...s].map((ch) => g.measureText(ch).width), tot = ws.reduce((a, b) => a + b, 0) + sp * (s.length - 1);
  let px = x - tot / 2; g.textAlign = 'left';
  [...s].forEach((ch, i) => { g.fillText(ch, px, y); px += ws[i] + sp; });
  g.textAlign = 'center';
}
function wrap(g, s, x, y, maxW, lh) {
  const words = s.split(' '); let line = '', yy = y;
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, yy); line = w; yy += lh; } else line = t; }
  if (line) g.fillText(line, x, yy);
}
export default spinWheel;

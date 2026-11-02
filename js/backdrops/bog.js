// E2 15.0: Witchwood Bog. A drowned wood under a sick green moon: twisted trees hung with moss, a witch's hut on stilts,
// poison pools glowing in black water, pawn-shaped gravestones sinking into the mud, will-o-wisps and drifting fog.
// Contract: js/backdrop.js (E1). Units are board tiles; the board covers K.b.
import { ramp, statue, rnd, mixH, shadeH, rgbaH, TAU_ as TAU } from './e2kit.js';

const SKY = ramp([[-16, '#030504'], [-9, '#0a130d'], [-5, '#1a2a1c'], [-3.4, '#34482e'], [-3.05, '#1a2618'], [0, '#0c140e'], [30, '#060a07']]);
const BARK = '#161c14', BARKLITE = '#7a9a5a', MOSS = '#4a6a2a', TOXIC = '#8cff5a', WATER = '#0a120d';
const MUD = { lite: '#4a4630', mid: '#2e2c1e', dark: '#161610' };
// E1's suggested horizon: dy 0 in portrait (the authored layout), wide screens drop sky + far + mid so the sides show sky
const DY = (K) => (K.hz == null ? 0 : K.hz + 2.4);
const MOON = (b) => ({ x: (b.x0 + b.x1) / 2 - 3.4, y: -7.2, r: 1.5 });

function sky(g, K) {
  const dy = DY(K); g.save(); g.translate(0, dy); K = { ...K, y0: K.y0 - dy, y1: K.y1 - dy };
  g.fillStyle = SKY.grad(g, K.y0, K.y1); g.fillRect(K.x0, K.y0, K.x1 - K.x0, K.y1 - K.y0);
  const m = MOON(K.b);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = K.rad(g, m.x, m.y, 0, 9, [[0, 'rgba(200,240,170,0.3)'], [0.25, 'rgba(120,180,90,0.12)'], [1, 'rgba(60,100,40,0)']]); g.fillRect(m.x - 9, m.y - 9, 18, 18);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = K.rad(g, m.x - 0.3, m.y - 0.3, 0, m.r, [[0, '#f4ffe4'], [0.7, '#d8ecbc'], [1, '#a8c890']]); g.beginPath(); g.arc(m.x, m.y, m.r, 0, TAU); g.fill();
  const R = rnd(4); g.fillStyle = 'rgba(120,150,100,0.35)';
  for (let i = 0; i < 7; i++) { const a = R() * TAU, d = R() * m.r * 0.7, r = 0.12 + R() * 0.3; g.beginPath(); g.arc(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, r, 0, TAU); g.fill(); }
  // ragged clouds crossing the moon
  for (let i = 0; i < 22; i++) { const x = K.x0 + R() * (K.x1 - K.x0), y = -13 + R() * 8, w = 1.5 + R() * 4; g.fillStyle = rgbaH(R() < 0.4 ? '#2a3a26' : '#101a12', 0.35 + R() * 0.3); g.beginPath(); g.ellipse(x, y, w, 0.12 + R() * 0.25, 0, 0, TAU); g.fill(); }
  // a few cold stars
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(210,240,200,${0.2 + R() * 0.5})`; g.fillRect(K.x0 + R() * (K.x1 - K.x0), K.y0 + R() * (-5 - K.y0), 0.035, 0.035); }
  g.restore();
}

// recursive twisted branch; returns nothing, draws bark with a moonlit edge, records tips for moss
function branch(g, x, y, ang, len, w, depth, R, tips, lit = true) {
  const segs = 3; let cx = x, cy = y, a = ang;
  for (let s = 0; s < segs; s++) {
    a += (R() - 0.5) * 0.7; const l = len / segs, nx = cx + Math.cos(a) * l, ny = cy + Math.sin(a) * l, ww = w * (1 - (s / segs) * 0.45);
    g.strokeStyle = BARK; g.lineWidth = ww; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
    if (lit && ww > 0.05) { g.strokeStyle = rgbaH(BARKLITE, 0.6); g.lineWidth = ww * 0.2; g.beginPath(); g.moveTo(cx - ww * 0.3, cy - ww * 0.15); g.lineTo(nx - ww * 0.3, ny - ww * 0.15); g.stroke(); }
    cx = nx; cy = ny;
  }
  if (depth <= 0 || w < 0.03) { tips && tips.push([cx, cy]); return; }
  const k = 2 + (R() < 0.35 ? 1 : 0);
  for (let i = 0; i < k; i++) branch(g, cx, cy, a + (i - (k - 1) / 2) * (0.6 + R() * 0.5) + (R() - 0.5) * 0.3, len * (0.6 + R() * 0.2), w * 0.62, depth - 1, R, tips, lit);
}
function tree(g, x, y, ang, len, w, depth, seed, moss = true) {
  const R = rnd(seed), tips = [];
  // flared roots
  g.fillStyle = BARK; g.beginPath(); g.moveTo(x - w * 1.6, y + 0.1); g.quadraticCurveTo(x - w * 0.4, y - w * 0.2, x - w * 0.45, y - w * 1.2); g.lineTo(x + w * 0.45, y - w * 1.2); g.quadraticCurveTo(x + w * 0.4, y - w * 0.2, x + w * 1.7, y + 0.12); g.closePath(); g.fill();
  branch(g, x, y - w * 0.5, ang, len, w, depth, R, tips);
  if (moss) { // hanging moss strands from the outer twigs
    g.lineCap = 'round';
    for (const [tx, ty] of tips) { if (R() < 0.45) continue; const l = 0.4 + R() * 1.3; g.strokeStyle = rgbaH(MOSS, 0.55 + R() * 0.3); g.lineWidth = 0.035 + R() * 0.04; g.beginPath(); g.moveTo(tx, ty); g.bezierCurveTo(tx + 0.1, ty + l * 0.3, tx - 0.1, ty + l * 0.6, tx + (R() - 0.5) * 0.15, ty + l); g.stroke(); }
  }
}

function far(g, K) {
  const dy = DY(K); g.save(); g.translate(0, dy); K = { ...K, y0: K.y0 - dy, y1: K.y1 - dy };
  const b = K.b, cx = (b.x0 + b.x1) / 2, R = rnd(13), hz = -3.05, bottom = K.y1;
  // mist band on the horizon
  g.fillStyle = K.lin(g, 0, hz - 1.4, 0, hz + 0.4, [[0, 'rgba(90,120,80,0)'], [0.7, 'rgba(110,140,90,0.35)'], [1, 'rgba(60,80,50,0)']]); g.fillRect(K.x0, hz - 1.4, K.x1 - K.x0, 1.8);
  // the far treeline: a spiky ridge of dead pines and bare crowns
  const line = K.ridge({ x0: K.x0, x1: K.x1, y: hz - 0.25, amp: 0.4, seed: 2, step: 0.5, rough: 0.5 });
  g.fillStyle = '#18241a'; K.fillRidge(g, line, hz + 0.05);
  for (let x = K.x0; x < K.x1; x += 0.35 + R() * 0.8) { const h = 0.5 + R() * 1.5; g.fillStyle = R() < 0.5 ? '#16221a' : '#1c2a1e'; g.beginPath(); g.moveTo(x - 0.18, hz); g.lineTo(x, hz - h); g.lineTo(x + 0.18, hz); g.fill(); if (R() < 0.3) { g.strokeStyle = '#16221a'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(x, hz - h * 0.6); g.lineTo(x + 0.3, hz - h * 0.8); g.stroke(); } }
  // the witch's hut on stilts, window aglow
  const hx = cx + 6.4, hy = hz - 0.55;
  g.strokeStyle = '#121a12'; g.lineWidth = 0.07; for (const dx of [-0.55, -0.15, 0.3, 0.6]) { g.beginPath(); g.moveTo(hx + dx, hy); g.lineTo(hx + dx * 1.15, hz + 0.1); g.stroke(); }
  g.fillStyle = '#121a12'; g.save(); g.translate(hx, hy); g.rotate(-0.06); g.fillRect(-0.75, -0.75, 1.5, 0.75); g.beginPath(); g.moveTo(-0.95, -0.7); g.lineTo(-0.1, -1.6); g.lineTo(0.15, -1.75); g.lineTo(0.95, -0.7); g.fill();
  g.fillRect(0.35, -1.55, 0.14, 0.45); g.fillStyle = '#ffc860'; g.fillRect(-0.4, -0.55, 0.22, 0.22); g.fillStyle = '#c86a20'; g.fillRect(-0.4, -0.44, 0.22, 0.02); g.fillRect(-0.3, -0.55, 0.02, 0.22); g.restore();
  g.globalCompositeOperation = 'lighter'; g.fillStyle = K.rad(g, hx - 0.3, hy - 0.45, 0, 1, [[0, 'rgba(255,190,90,0.3)'], [1, 'rgba(255,150,60,0)']]); g.fillRect(hx - 1.3, hy - 1.45, 2, 2); g.globalCompositeOperation = 'source-over';
  // black water from the horizon down, with the moon's broken reflection
  g.fillStyle = K.lin(g, 0, hz, 0, hz + 6, [[0, '#1c2a1e'], [0.25, '#0e1810'], [1, WATER]]); g.fillRect(K.x0, hz + 0.05, K.x1 - K.x0, bottom - hz);
  const m = MOON(b);
  for (let i = 0; i < 14; i++) { const y = hz + 0.25 + i * 0.22, w = 0.9 - i * 0.04 + R() * 0.3; g.fillStyle = `rgba(210,240,180,${0.3 - i * 0.018})`; g.fillRect(m.x - w / 2 + (R() - 0.5) * 0.3, y, w, 0.05); }
  // a dead tree silhouette or two on the far bank
  tree(g, cx - 10.5, hz + 0.02, -Math.PI / 2 - 0.1, 1.6, 0.18, 3, 71, false);
  tree(g, cx + 12, hz + 0.02, -Math.PI / 2 + 0.15, 1.3, 0.15, 3, 73, false);
  g.restore();
}

const POOLS = (b) => { const cx = (b.x0 + b.x1) / 2; return [[cx - 1.5, -1.25, 1.4], [b.x0 - 3.4, 6.5, 1.6], [b.x1 + 3.8, 11, 1.4], [b.x1 + 3, 1.5, 1], [b.x0 - 3.6, 15.5, 1.1]]; };
function pool(g, K, x, y, r) {
  g.fillStyle = K.rad(g, x, y, 0, r * 1.6, [[0, 'rgba(140,255,90,0.35)'], [1, 'rgba(80,200,60,0)']]); g.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
  g.fillStyle = K.rad(g, x, y, 0, r, [[0, '#9cff6a'], [0.45, '#3aa82a'], [1, '#12301a']]); g.beginPath(); g.ellipse(x, y, r, r * 0.38, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(200,255,160,0.5)'; g.lineWidth = 0.03; g.beginPath(); g.ellipse(x, y, r * 0.98, r * 0.37, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
}
function mid(g, K) {
  const dy = DY(K); g.save(); g.translate(0, dy); K = { ...K, y0: K.y0 - dy, y1: K.y1 - dy };
  const b = K.b, cx = (b.x0 + b.x1) / 2, R = rnd(37), bottom = K.y1;
  // near water (overpaints the far layer's lower half at this depth)
  g.fillStyle = K.lin(g, 0, -1.8, 0, bottom, [[0, '#0e1a10'], [1, WATER]]); g.fillRect(K.x0, -1.8, K.x1 - K.x0, bottom + 1.8);
  // reflections of the trees in the water
  g.globalAlpha = 0.18; g.save(); g.translate(0, -1.6); g.scale(1, -0.5);
  tree(g, b.x0 - 0.4, 0, -Math.PI / 2 + 0.35, 2.4, 0.5, 4, 5, false);
  g.restore(); g.globalAlpha = 1;
  // mudbanks and roots on the far side above the board
  g.fillStyle = MUD.mid; for (const [x, w] of [[cx - 5.5, 3.2], [cx + 3, 2.6], [cx + 8.8, 2.2]]) { g.beginPath(); g.ellipse(x, -1.3, w, 0.45, 0, Math.PI, TAU); g.fill(); }
  // poison pools
  for (const [x, y, r] of POOLS(b)) pool(g, K, x, y, r);
  // lily pads
  for (let i = 0; i < 40; i++) { const side = i % 3, x = side === 0 ? K.x0 + R() * (K.x1 - K.x0) : side === 1 ? b.x0 - 1.5 - R() * 5 : b.x1 + 1.5 + R() * 5, y = side === 0 ? -1.7 + R() * 0.8 : R() * (b.y1 + 3), r = 0.12 + R() * 0.18; g.fillStyle = mixH('#2a4a20', '#3a5a2a', R()); g.beginPath(); g.ellipse(x, y, r, r * 0.4, 0, 0.3, TAU - 0.1); g.lineTo(x, y); g.fill(); }
  // the great trees: one leaning in from each side above the board, more trunks standing in the flanks
  tree(g, b.x0 - 0.4, -0.95, -Math.PI / 2 + 0.38, 2.5, 0.55, 4, 5);
  tree(g, b.x1 + 0.7, -1.05, -Math.PI / 2 - 0.42, 2.3, 0.5, 4, 9);
  tree(g, cx + 1.8, -1.4, -Math.PI / 2 + 0.05, 1.6, 0.3, 4, 15);
  for (const [x, y, a, s, sd] of [[b.x0 - 3.2, 2.8, -0.15, 1.2, 21], [b.x0 - 4.6, 10, 0.12, 1.4, 23], [b.x1 + 3.6, 4.4, 0.1, 1.3, 25], [b.x1 + 4.8, 14, -0.1, 1.1, 27], [b.x0 - 2.6, 17.5, 0.2, 0.9, 29], [b.x1 + 2.4, 18.2, -0.2, 0.9, 31]])
    tree(g, x, y, -Math.PI / 2 + a, 2.2 * s, 0.38 * s, 4, sd);
  g.restore();
}

// ---------- rim: the mudbank the board sits on ----------
function rim(g, K) {
  const b = K.b, R = rnd(53), F = 0.7, ox0 = b.x0 - F, oy0 = b.y0 - F, ox1 = b.x1 + F, oy1 = b.y1 + F, hz = K.hz == null ? -99 : K.hz;
  rimBody(g, K, b, R, ox0, oy0, ox1, oy1);
  if (hz > oy0 - 2.5) { // wide: the bank only exists below the horizon; fade it in so it does not float in the sky
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.fillRect(K.x0, K.y0, K.x1 - K.x0, hz - 0.3 - K.y0);
    const fe = g.createLinearGradient(0, hz - 0.3, 0, hz + 1.2); fe.addColorStop(0, 'rgba(0,0,0,1)'); fe.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fe; g.fillRect(K.x0, hz - 0.3, K.x1 - K.x0, 1.5);
    g.globalCompositeOperation = 'source-over';
  }
}
function rimBody(g, K, b, R, ox0, oy0, ox1, oy1) {
  // an irregular bank of mud hugging the frame, its edge lapped by water
  const pts = [], n = 64, cx = (ox0 + ox1) / 2, cy = (oy0 + oy1) / 2, hw = (ox1 - ox0) / 2, hh = (oy1 - oy0) / 2;
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, c = Math.cos(a), s = Math.sin(a), k = 1 / Math.max(Math.abs(c) / hw, Math.abs(s) / hh), ext = 1.1 + R() * 0.9 + (s > 0.5 ? 0.6 : 0); pts.push([cx + c * (k + ext), cy + s * (k + ext)]); }
  const bank = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  g.fillStyle = 'rgba(120,160,100,0.18)'; g.save(); g.translate(0, 0.08); g.scale(1, 1); bank(); g.lineWidth = 0.3; g.strokeStyle = 'rgba(150,200,120,0.12)'; g.stroke(); g.restore(); // wet edge
  bank(); g.fillStyle = K.rad(g, cx, cy, hw * 0.9, hw + 2.6, [[0, MUD.mid], [0.6, MUD.mid], [1, MUD.dark]]); g.fill();
  g.save(); bank(); g.clip();
  for (let i = 0; i < 90; i++) { const x = ox0 - 2.5 + R() * (ox1 - ox0 + 5), y = oy0 - 2.5 + R() * (oy1 - oy0 + 5), r = 0.15 + R() * 0.45; g.fillStyle = rgbaH(R() < 0.5 ? MUD.lite : MUD.dark, 0.25); g.beginPath(); g.ellipse(x, y, r, r * 0.5, 0, 0, TAU); g.fill(); }
  for (let i = 0; i < 70; i++) { const x = ox0 - 2.5 + R() * (ox1 - ox0 + 5), y = oy0 - 2.5 + R() * (oy1 - oy0 + 5); g.fillStyle = rgbaH(MOSS, 0.3 + R() * 0.3); g.beginPath(); g.ellipse(x, y, 0.2 + R() * 0.4, 0.08 + R() * 0.1, 0, 0, TAU); g.fill(); }
  g.restore();
  // roots crawling from the bank onto the frame edge
  g.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const s = i % 4, t = 0.08 + R() * 0.84, x = s === 0 || s === 1 ? ox0 + t * (ox1 - ox0) : s === 2 ? ox0 - 1.4 : ox1 + 1.4, y = s === 0 ? oy0 - 1.4 : s === 1 ? oy1 + 1.4 : oy0 + t * (oy1 - oy0);
    const tx = s === 2 ? ox0 + 0.25 : s === 3 ? ox1 - 0.25 : x + (R() - 0.5), ty = s === 0 ? oy0 + 0.25 : s === 1 ? oy1 - 0.25 : y + (R() - 0.5);
    g.strokeStyle = BARK; g.lineWidth = 0.12 + R() * 0.08; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + tx) / 2 + (R() - 0.5) * 0.8, (y + ty) / 2 + (R() - 0.5) * 0.8, tx, ty); g.stroke();
    g.strokeStyle = rgbaH(BARKLITE, 0.5); g.lineWidth = 0.03; g.stroke();
  }
  // pawn gravestones sinking crooked into the mud
  const stone = { dark: '#1a1e1a', mid: '#4a5248', lite: '#8a9a84', rim: 'rgba(200,240,170,0.5)' };
  for (const [x, y, h, lean, t] of [[ox0 - 1.2, oy0 + 2.2, 1.0, -0.2, 'pawn'], [ox0 - 1.3, oy1 - 3, 1.2, 0.15, 'rook'], [ox1 + 1.2, oy0 + 5.5, 1.1, 0.22, 'pawn'], [ox1 + 1.3, oy1 - 1.5, 0.9, -0.12, 'bishop'], [ox0 + 3.5, oy0 - 1.2, 0.9, 0.1, 'pawn'], [ox1 - 4, oy0 - 1.25, 1.1, -0.15, 'king']]) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x - 0.2, y + 0.05, h * 0.45, 0.12, 0, 0, TAU); g.fill();
    statue(g, { x, base: y + h * 0.18, h, type: t, seed: Math.round(x * 7 + y), broken: t === 'king' ? 0.2 : 0, lean, light: -1, ...stone });
    g.fillStyle = MUD.mid; g.beginPath(); g.ellipse(x, y + 0.04, h * 0.42, 0.14, 0, 0, TAU); g.fill();
  }
  // reeds and cattails
  for (let i = 0; i < 26; i++) {
    const s = i % 3, x = s === 0 ? ox0 - 1.8 - R() * 1.2 : s === 1 ? ox1 + 1.8 + R() * 1.2 : ox0 + R() * (ox1 - ox0), y = s === 2 ? oy1 + 1.9 + R() * 0.8 : oy0 + R() * (oy1 - oy0);
    for (let k = 0; k < 5; k++) { const h = 0.6 + R() * 0.9, bend = (R() - 0.5) * 0.4, x0 = x + (k - 2) * 0.08; g.strokeStyle = mixH('#3a4a22', '#5a6a32', R()); g.lineWidth = 0.035; g.beginPath(); g.moveTo(x0, y); g.quadraticCurveTo(x0 + bend * 0.3, y - h * 0.5, x0 + bend, y - h); g.stroke(); if (k % 2 === 0 && R() < 0.6) { g.fillStyle = '#3a2416'; g.beginPath(); g.ellipse(x0 + bend * 0.9, y - h * 0.85, 0.045, 0.14, bend, 0, TAU); g.fill(); } }
  }
  // glowing toadstools
  for (let i = 0; i < 14; i++) {
    const s = i % 4, t = R(), x = s < 2 ? ox0 + t * (ox1 - ox0) : s === 2 ? ox0 - 0.5 - R() * 0.6 : ox1 + 0.5 + R() * 0.6, y = s === 0 ? oy0 - 0.5 - R() * 0.5 : s === 1 ? oy1 + 0.5 + R() * 0.7 : oy0 + t * (oy1 - oy0);
    for (let k = 0; k < 3; k++) { const mx = x + (k - 1) * 0.3 + (R() - 0.5) * 0.08, h = 0.14 + R() * 0.2, r = 0.15 + R() * 0.1; g.fillStyle = '#b8c8a0'; g.beginPath(); g.moveTo(mx - 0.035, y); g.lineTo(mx - 0.025, y - h); g.lineTo(mx + 0.025, y - h); g.lineTo(mx + 0.04, y); g.fill();
      const cap = g.createRadialGradient(mx - r * 0.3, y - h - r * 0.4, 0, mx, y - h, r * 1.1); cap.addColorStop(0, '#e8ffc8'); cap.addColorStop(0.5, '#8cff5a'); cap.addColorStop(1, '#3a8a2a'); g.fillStyle = cap;
      g.beginPath(); g.moveTo(mx - r, y - h + 0.02); g.bezierCurveTo(mx - r, y - h - r * 0.9, mx + r, y - h - r * 0.9, mx + r, y - h + 0.02); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,230,0.7)'; g.beginPath(); g.arc(mx - r * 0.35, y - h - r * 0.35, r * 0.12, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'lighter'; g.fillStyle = K.rad(g, x, y - 0.15, 0, 0.6, [[0, 'rgba(140,255,90,0.3)'], [1, 'rgba(140,255,90,0)']]); g.fillRect(x - 0.6, y - 0.75, 1.2, 1.2); g.globalCompositeOperation = 'source-over';
  }
  // a poison pool in the foreground bank
  pool(g, K, ox0 + 4.2, oy1 + 2.1, 1.1);
}

// ---------- animation ----------
const FOG = (K) => K.sprite('bog-fog', 512, 96, (g, w, h) => {
  const R = rnd(9);
  for (let i = 0; i < 60; i++) { const x = 40 + R() * (w - 80), y = h * 0.5 + (R() - 0.5) * h * 0.4, r = 18 + R() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(190,220,170,0.22)'); gr.addColorStop(1, 'rgba(190,220,170,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
});
function fogBands(ctx, K, bands, alpha) {
  const f = FOG(K), w = K.x1 - K.x0;
  for (const [y, h, sp, len, ph] of bands) {
    const span = w + len, x = K.x0 - len + ((((K.T * sp + ph) % span) + span) % span);
    ctx.globalAlpha = alpha; K.blitExact(ctx, f, x, y - h / 2, len, h); K.blitExact(ctx, f, x - span, y - h / 2, len, h); // R2 15.0.1: 1:1 at rest
  }
  ctx.globalAlpha = 1;
}
function farAnim(ctx, K) {
  const dy = DY(K);
  if (!K.lowQ) fogBands(ctx, K, [[-3.3 + dy, 1.2, 0.15, 14, 0], [-2.4 + dy, 1, -0.1, 11, 7]], 0.8);
  // hut window flicker (steady when reduced)
  const b = K.b, hx = (b.x0 + b.x1) / 2 + 6.4 - 0.3, hy = -3.05 - 0.55 - 0.45 + dy, f = K.reduced ? 0.6 : 0.5 + 0.3 * Math.sin(K.T * 7) * Math.sin(K.T * 3.1);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = f * 0.6; ctx.drawImage(K.glow('#ffb050'), hx - 0.5, hy - 0.5, 1, 1); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function bubbles(ctx, K, x, y, r, seed) {
  const T = K.T, R = rnd(seed);
  ctx.strokeStyle = 'rgba(200,255,160,0.8)'; ctx.lineWidth = 0.025; ctx.fillStyle = 'rgba(160,255,110,0.5)';
  for (let i = 0, n = K.n(4); i < n; i++) {
    const cyc = 1.6 + R() * 1.4, t = (T + R() * cyc) % cyc, k = t / cyc, bx = x + (R() - 0.5) * r * 1.4, by = y + (R() - 0.5) * r * 0.5;
    if (k < 0.8) { const s = 0.03 + k * 0.1; ctx.beginPath(); ctx.arc(bx, by - s * 0.6, s, Math.PI, TAU); ctx.fill(); ctx.stroke(); }
    else { const q = (k - 0.8) / 0.2; ctx.globalAlpha = 1 - q; ctx.beginPath(); ctx.ellipse(bx, by, 0.1 + q * 0.25, (0.1 + q * 0.25) * 0.35, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
  }
}
function wisps(ctx, K, list) {
  const T = K.T, gl = K.glow('#b8ff8a'), core = K.glow('#f0ffe0');
  ctx.globalCompositeOperation = 'lighter';
  for (const [i, [x0, y0, rx, ry, sp]] of list.entries()) {
    const a = T * sp + i * 2.1, x = x0 + Math.sin(a) * rx + Math.sin(a * 2.3) * 0.3, y = y0 + Math.cos(a * 0.8) * ry + Math.sin(T * 2 + i) * 0.12;
    if (K.hidden(x - 1, y - 1, x + 1, y + 1)) continue;
    const pul = K.reduced ? 0.8 : 0.7 + 0.3 * Math.sin(T * 3.3 + i);
    for (let k = 3; k >= 1; k--) { const ta = a - k * 0.12 * Math.sign(sp), tx = x0 + Math.sin(ta) * rx + Math.sin(ta * 2.3) * 0.3, ty = y0 + Math.cos(ta * 0.8) * ry; ctx.globalAlpha = 0.12 * (4 - k) * pul; ctx.drawImage(gl, tx - 0.25, ty - 0.25, 0.5, 0.5); }
    ctx.globalAlpha = 0.55 * pul; ctx.drawImage(gl, x - 0.7, y - 0.7, 1.4, 1.4); ctx.globalAlpha = pul; ctx.drawImage(core, x - 0.14, y - 0.14, 0.28, 0.28);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function midAnim(ctx, K) {
  const b = K.b, T = K.T, cx = (b.x0 + b.x1) / 2, dy = DY(K);
  // pools breathe their poison glow and bubble
  const gl = K.glow(TOXIC);
  for (const [i, [x, y0, r]] of POOLS(b).entries()) {
    const y = y0 + dy;
    if (K.hidden(x - r * 1.6, y - r, x + r * 1.6, y + r)) continue;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (K.reduced ? 0.25 : 0.2 + 0.15 * Math.sin(T * 1.4 + i)); ctx.drawImage(gl, x - r * 1.5, y - r * 1.1, r * 3, r * 2.2); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    bubbles(ctx, K, x, y, r, 11 + i);
  }
  wisps(ctx, K, [[cx - 4, -2.4 + dy, 2.2, 0.6, 0.35], [cx + 5, -3 + dy, 1.5, 0.5, -0.28], [b.x0 - 3.5, 5 + dy, 1.2, 2.5, 0.22], [b.x1 + 3.8, 9 + dy, 1.2, 2.8, -0.25]].slice(0, K.lowQ ? 2 : 4));
  if (!K.lowQ) fogBands(ctx, K, [[-1.2 + dy, 1.4, 0.22, 12, 3], [6 + dy, 2.2, -0.12, 16, 5], [13 + dy, 2, 0.16, 14, 9]], 0.75);
}
function rimAnim(ctx, K) {
  const b = K.b, T = K.T, ox0 = b.x0 - 0.7, oy1 = b.y1 + 0.7;
  const x = ox0 + 4.2, y = oy1 + 2.1;
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = K.reduced ? 0.3 : 0.25 + 0.15 * Math.sin(T * 1.2); ctx.drawImage(K.glow(TOXIC), x - 1.8, y - 1.2, 3.6, 2.4); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  bubbles(ctx, K, x, y, 1.1, 41);
  wisps(ctx, K, [[b.x1 - 2, oy1 + 2.2, 2, 0.4, 0.3]]);
  // low fog creeping along the foreground bank
  if (!K.lowQ) fogBands(ctx, K, [[oy1 + 2.4, 1.6, 0.2, 10, 1]], 0.7);
}

export default {
  id: 'bog',
  base: '#0a120d',
  light: { tint: ['#e4f0da', '#dcead6'], glow: ['b', TOXIC, 0.1] },
  layers: [
    { p: 0.04, res: 0.5, paint: sky },
    { p: 0.2, res: 0.7, paint: far, anim: farAnim },
    { p: 0.5, res: 0.85, paint: mid, anim: midAnim },
    { p: 1, r: 5, res: 0.85, paint: rim, anim: rimAnim },
  ],
};

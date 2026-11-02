// E2 15.0: Astral Rift. The board is an island of stone adrift among the stars: nebula, a ringed planet, a tear in space
// pulling at broken fragments of other boards, and a ring of runes orbiting the arena.
// Contract: js/backdrop.js (E1). Units are board tiles; the board covers K.b.
import { rnd, mixH, shadeH, rgbaH, TAU_ as TAU } from './e2kit.js';

const VIOLET = '#b04dff', CYAN = '#5ae0ff', PINK = '#ff5ad0';
const ROCK = { lite: '#5a4a7a', mid: '#2e2448', dark: '#120c22' };
const C = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const RIFT = (b) => ({ x: C(b).x - 1.2, y: -3.6 });

function space(g, K) {
  const R = rnd(3);
  g.fillStyle = K.lin(g, 0, K.y0, 0, K.y1, [[0, '#04020c'], [0.35, '#0c0626'], [0.6, '#120a34'], [1, '#05030e']]); g.fillRect(K.x0, K.y0, K.x1 - K.x0, K.y1 - K.y0);
  const w = K.x1 - K.x0, h = K.y1 - K.y0, cols = ['#6a2cd0', '#c0309a', '#2a5ad0', '#8a3aff', '#1a8ab0'];
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 34; i++) { // layered nebula, strongest in a diagonal band behind the rift
    const t = R(), x = K.x0 + t * w, y = K.y0 + h * (0.15 + t * 0.5) + (R() - 0.5) * h * 0.45, r = 2 + R() * 7, a = 0.05 + R() * 0.1;
    g.fillStyle = K.rad(g, x, y, 0, r, [[0, rgbaH(cols[i % cols.length], a)], [1, rgbaH(cols[i % cols.length], 0)]]); g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = 'source-over';
  // dark dust lanes
  for (let i = 0; i < 10; i++) { const x = K.x0 + R() * w, y = K.y0 + R() * h, r = 1.5 + R() * 3; g.fillStyle = K.rad(g, x, y, 0, r, [[0, 'rgba(2,1,8,0.35)'], [1, 'rgba(2,1,8,0)']]); g.fillRect(x - r, y - r, r * 2, r * 2); }
  // fine starfield
  const n = Math.round(w * h * (K.lowQ ? 0.6 : 1.2));
  for (let i = 0; i < n; i++) { const s = R() < 0.92 ? 0.03 : 0.06; g.fillStyle = `rgba(${200 + R() * 55 | 0},${200 + R() * 55 | 0},255,${0.25 + R() * 0.6})`; g.fillRect(K.x0 + R() * w, K.y0 + R() * h, s, s); }
}

function far(g, K) {
  const b = K.b, cx = C(b).x, R = rnd(19);
  // a ringed planet low on the left, lit from the rift
  const px = K.wide ? b.x0 - 6.8 : cx - 7.5, py = K.wide ? 3.2 : -6.2, pr = 2.6; // wide screens: out on the open left side
  ringHalf(g, px, py, pr, true);
  g.fillStyle = K.rad(g, px + pr * 0.45, py - pr * 0.4, pr * 0.1, pr * 1.1, [[0, '#9a7ae0'], [0.45, '#4a2a8a'], [1, '#0a0618']]); g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
  g.save(); g.beginPath(); g.arc(px, py, pr, 0, TAU); g.clip(); g.strokeStyle = 'rgba(200,170,255,0.12)'; g.lineWidth = 0.18;
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.ellipse(px, py + i * 0.6, pr * 1.2, 0.15, -0.25, 0, TAU); g.stroke(); } g.restore();
  g.strokeStyle = 'rgba(220,200,255,0.55)'; g.lineWidth = 0.05; g.beginPath(); g.arc(px, py, pr, -1.6, 0.2); g.stroke();
  ringHalf(g, px, py, pr, false);
  // a small moon
  const mx = K.wide ? b.x1 + 5.5 : cx + 9, my = K.wide ? 1.2 : -8.4; g.fillStyle = K.rad(g, mx + 0.2, my - 0.2, 0, 0.7, [[0, '#d8d0ff'], [0.7, '#6a5aa0'], [1, '#2a2050']]); g.beginPath(); g.arc(mx, my, 0.7, 0, TAU); g.fill();
  // distant drifting islands (flat silhouettes with a rim of light)
  for (const [d, y, s] of [[-14, -2.5, 1.4], [12.5, -3.4, 1.1], [-20, 6, 1.8], [21, 3, 1.5], [-18, 15, 1.2], [20, 17, 1.6], [3.5, -7.5, 0.7]]) island(g, cx + d, y, s, R, 0.55);
  // a spiral galaxy smudge
  g.globalCompositeOperation = 'lighter';
  const gx = K.wide ? b.x1 + 8.5 : cx + 13, gy = K.wide ? 11 : -9;
  for (let i = 0; i < 60; i++) { const a = i * 0.32, r = 0.1 + i * 0.035; g.fillStyle = `rgba(255,220,255,${0.12 - i * 0.0015})`; g.beginPath(); g.ellipse(gx + Math.cos(a) * r * 1.6, gy + Math.sin(a) * r * 0.6, 0.18, 0.08, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(gx - Math.cos(a) * r * 1.6, gy - Math.sin(a) * r * 0.6, 0.18, 0.08, 0, 0, TAU); g.fill(); }
  g.globalCompositeOperation = 'source-over';
}
function ringHalf(g, x, y, r, back) {
  g.save(); g.beginPath(); if (back) g.rect(x - r * 3, y - r * 2, r * 6, r * 2 - 0.0); else g.rect(x - r * 3, y, r * 6, r * 2); g.clip();
  g.translate(x, y); g.rotate(-0.25);
  for (const [k, a, wd] of [[1.55, 0.35, 0.16], [1.8, 0.5, 0.22], [2.1, 0.25, 0.1]]) { g.strokeStyle = `rgba(210,180,255,${back ? a * 0.6 : a})`; g.lineWidth = wd; g.beginPath(); g.ellipse(0, 0, r * k, r * k * 0.28, 0, 0, TAU); g.stroke(); }
  g.restore();
}
// a floating rock island with a sliver of checker board on top; o = opacity of the light rim
function island(g, x, y, s, R, rimA = 1, board = true) {
  const w = 1.6 * s, P = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; P.push([x - w + t * w * 2, y + Math.sin(t * Math.PI) * s * (1.2 + R() * 0.4) + (R() - 0.5) * 0.15 * s]); }
  g.beginPath(); g.moveTo(x - w, y); P.forEach(([a, c]) => g.lineTo(a, c)); g.lineTo(x + w, y); g.closePath();
  g.fillStyle = K_lin(g, y, y + s * 1.5); g.fill();
  if (board) { // checker top
    // two rows of squares seen from above at a slant, the far edge broken off unevenly
    const n = Math.max(3, Math.round((w * 2) / 0.55)), cw = (w * 2) / n, rh = 0.32 * s;
    g.fillStyle = '#3a2e5a'; g.fillRect(x - w, y, w * 2, 0.12 * s); // slab thickness
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) {
      if (r === 1 && (i === 0 || i === n - 1 || R() < 0.25)) continue;
      const y0 = y - r * rh, sk = cw * 0.18, xa = x - w + i * cw - r * sk;
      g.fillStyle = (i + r) % 2 ? '#2a2246' : '#c4b6ea'; g.beginPath(); g.moveTo(xa, y0); g.lineTo(xa + cw, y0); g.lineTo(xa + cw - sk, y0 - rh); g.lineTo(xa - sk, y0 - rh); g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x - w, y - 0.02, w * 2, 0.02);
  }
  g.strokeStyle = `rgba(190,140,255,${0.7 * rimA})`; g.lineWidth = 0.05; g.beginPath(); g.moveTo(x - w, y); g.lineTo(x + w, y); g.stroke();
  // crystal vein
  g.strokeStyle = `rgba(90,224,255,${0.6 * rimA})`; g.lineWidth = 0.035; g.beginPath(); g.moveTo(x - w * 0.3, y + 0.1); g.lineTo(x - w * 0.1, y + s * 0.6); g.lineTo(x + w * 0.05, y + s * 1.0); g.stroke();
}
const K_lin = (g, y0, y1) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, ROCK.lite); gr.addColorStop(0.35, ROCK.mid); gr.addColorStop(1, ROCK.dark); return gr; };

// ---------- mid: the rift itself + fragments (fragments bob in the anim) ----------
const FRAGS = (b) => { const { x } = C(b); return [[x - 6.2, -2.2, 0.9], [x + 3.4, -1.9, 0.75], [x + 6.8, -4.6, 0.6], [x - 3.6, -5.6, 0.5], [b.x0 - 3.6, 2.5, 1.1], [b.x0 - 3.2, 11, 0.85], [b.x1 + 3.6, 5.5, 1.0], [b.x1 + 3.3, 13.5, 0.8], [b.x0 - 2.5, 18.6, 0.7], [b.x1 + 2.6, 18.2, 0.6]]; };
function fragSprite(K, i, s) {
  return K.sprite('rift-frag' + i, 160, 140, (g, w, h) => { const k = w / 4; g.scale(k, k); island(g, 2, 1.0, s * 1.05, rnd(70 + i), 1); });
}
function mid(g, K) {
  const b = K.b, rf = RIFT(b);
  // the tear: a jagged vertical wound in space with a white-hot core
  const pts = [], R = rnd(41), L = 4.6;
  for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([rf.x + Math.sin(t * 5.3) * 0.35 + (R() - 0.5) * 0.3, rf.y - L / 2 + t * L, Math.sin(t * Math.PI) * (0.55 + R() * 0.25)]); }
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = K.rad(g, rf.x, rf.y, 0, 4.2, [[0, 'rgba(176,77,255,0.45)'], [0.4, 'rgba(255,90,208,0.15)'], [1, 'rgba(120,40,255,0)']]); g.fillRect(rf.x - 4.2, rf.y - 4.2, 8.4, 8.4);
  g.globalCompositeOperation = 'source-over';
  const wound = (k, col) => { g.fillStyle = col; g.beginPath(); pts.forEach(([x, y, w], i) => (i ? g.lineTo(x - w * k, y) : g.moveTo(x - w * k, y))); for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0] + pts[i][2] * k, pts[i][1]); g.closePath(); g.fill(); };
  wound(1.0, 'rgba(120,40,220,0.9)'); wound(0.65, '#ff5ad0'); wound(0.35, '#ffd8ff'); wound(0.12, '#ffffff');
  // shards torn loose around it
  g.fillStyle = 'rgba(255,180,255,0.7)';
  for (let i = 0; i < 14; i++) { const a = R() * TAU, d = 0.8 + R() * 1.6, x = rf.x + Math.cos(a) * d * 0.8, y = rf.y + Math.sin(a) * d * 1.2, s = 0.05 + R() * 0.1; g.beginPath(); g.moveTo(x, y - s * 2); g.lineTo(x + s, y); g.lineTo(x, y + s * 2); g.lineTo(x - s, y); g.fill(); }
}

// ---------- rim: the board island's own rock ----------
function rim(g, K) {
  const b = K.b, R = rnd(83), F = 0.7, ox0 = b.x0 - F, oy0 = b.y0 - F, ox1 = b.x1 + F, oy1 = b.y1 + F;
  // the underside: a great inverted cliff hanging below the board, narrowing into the void
  const P = [[ox0 - 0.5, oy0 + 1]];
  for (let i = 0; i <= 24; i++) { const t = i / 24, x = ox0 - 0.5 + t * (ox1 - ox0 + 1), d = Math.pow(Math.sin(t * Math.PI), 0.7); P.push([x, oy1 + 0.2 + d * (3.2 + R() * 0.9) + (R() - 0.5) * 0.3]); }
  P.push([ox1 + 0.5, oy0 + 1]);
  g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  g.fillStyle = K.lin(g, 0, oy1, 0, oy1 + 4.2, [[0, ROCK.lite], [0.25, ROCK.mid], [1, ROCK.dark]]); g.fill();
  g.save(); g.clip();
  // strata and glowing crystal veins
  g.strokeStyle = 'rgba(10,6,24,0.45)'; g.lineWidth = 0.05;
  for (let i = 0; i < 9; i++) { const y = oy1 + 0.4 + i * 0.42; g.beginPath(); g.moveTo(ox0 - 1, y); for (let x = ox0 - 1; x < ox1 + 1; x += 0.8) g.lineTo(x, y + (R() - 0.5) * 0.18); g.stroke(); }
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) { let x = ox0 + 1 + R() * (ox1 - ox0 - 2), y = oy1 + 0.3; g.strokeStyle = 'rgba(90,224,255,0.75)'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 0.7; y += 0.25 + R() * 0.4; g.lineTo(x, y); } g.stroke(); g.strokeStyle = 'rgba(90,224,255,0.18)'; g.lineWidth = 0.2; g.stroke(); }
  g.restore();
  // crystal clusters jutting from the underside
  for (const [x, y, s] of [[ox0 + 2.2, oy1 + 1.4, 0.7], [ox1 - 3, oy1 + 1.8, 0.9], [(ox0 + ox1) / 2 + 1, oy1 + 3.2, 0.6], [ox0 + 5.5, oy1 + 2.6, 0.45]]) crystals(g, x, y, s, R);
  // the island's lip around the other three sides: a thin broken rock edge just outside the frame
  const lip = (x, y, w, h) => { g.fillStyle = K.lin(g, x, y, x + w, y + h, [[0, ROCK.mid], [1, ROCK.dark]]); g.beginPath(); g.rect(x, y, w, h); g.fill(); };
  lip(ox0 - 0.45, oy0 - 0.45, ox1 - ox0 + 0.9, 0.5); lip(ox0 - 0.45, oy0, 0.5, oy1 - oy0 + 0.3); lip(ox1 - 0.05, oy0, 0.5, oy1 - oy0 + 0.3);
  g.fillStyle = 'rgba(190,140,255,0.6)'; g.fillRect(ox0 - 0.45, oy0 - 0.45, ox1 - ox0 + 0.9, 0.04);
  // jagged chips missing from the lip
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 18; i++) { const s = i % 3, t = R(), x = s === 0 ? ox0 + t * (ox1 - ox0) : s === 1 ? ox0 - 0.45 : ox1 + 0.45, y = s === 0 ? oy0 - 0.45 : oy0 + t * (oy1 - oy0); const r = 0.1 + R() * 0.2; g.beginPath(); g.moveTo(x - r, y); g.lineTo(x, y + (s ? 0 : r)); g.lineTo(x + (s === 1 ? r : s === 2 ? -r : r), y); g.fill(); }
  g.globalCompositeOperation = 'source-over';
  // pebbles drifting off the edges
  for (let i = 0; i < 26; i++) { const s = i % 3, x = s === 0 ? ox0 - 1 - R() * 3 : s === 1 ? ox1 + 1 + R() * 3 : ox0 + R() * (ox1 - ox0), y = s === 2 ? oy0 - 1 - R() * 2 : oy0 + R() * (oy1 - oy0 + 2), r = 0.05 + R() * 0.14; g.fillStyle = mixH(ROCK.lite, ROCK.dark, R()); g.beginPath(); g.ellipse(x, y, r * 1.3, r, R() * 3, 0, TAU); g.fill(); g.fillStyle = 'rgba(190,140,255,0.5)'; g.fillRect(x - r, y - r, r, 0.02); }
}
function crystals(g, x, y, s, R) {
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (R() - 0.5) * 1.2, l = s * (0.5 + R() * 0.8), w = s * 0.12;
    const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l, nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
    const gr = g.createLinearGradient(x, y, ex, ey); gr.addColorStop(0, '#3a8ad0'); gr.addColorStop(1, '#c8f6ff'); g.fillStyle = gr;
    g.beginPath(); g.moveTo(x + nx, y + ny); g.lineTo(ex, ey); g.lineTo(x - nx, y - ny); g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'lighter'; g.fillStyle = g.createRadialGradient(x, y + s * 0.5, 0, x, y + s * 0.5, s * 1.4); g.fillStyle.addColorStop(0, 'rgba(90,224,255,0.35)'); g.fillStyle.addColorStop(1, 'rgba(90,224,255,0)'); g.fillRect(x - s * 1.4, y - s, s * 2.8, s * 3); g.globalCompositeOperation = 'source-over';
}

// ---------- animation ----------
function farAnim(ctx, K) {
  // twinkling bright stars (steady under reduced motion) and the odd shooting star
  const T = K.T, R = rnd(7), w = K.x1 - K.x0, h = K.y1 - K.y0, st = K.glow('#e8e0ff');
  for (let i = 0, n = K.n(26); i < n; i++) {
    const x = K.x0 + R() * w, y = K.y0 + R() * h * 0.75, ph = R() * TAU, s = 0.25 + R() * 0.35;
    const a = K.reduced ? 0.55 : 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(T * (1 + R() * 2) + ph), 3);
    ctx.globalAlpha = a; ctx.drawImage(st, x - s / 2, y - s / 2, s, s);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 0.02, y - 0.02, 0.04, 0.04);
  }
  if (!K.reduced && !K.lowQ) {
    const cyc = 7, t = T % cyc, k = t / 0.9;
    if (k < 1) { const i = Math.floor(T / cyc), r2 = rnd(i + 5), x = K.x0 + r2() * w * 0.7, y = K.y0 + r2() * h * 0.35, len = 3; ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9; const gr = ctx.createLinearGradient(x + k * 6, y + k * 2.4, x + k * 6 - len, y + k * 2.4 - len * 0.4); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, 'rgba(180,160,255,0)'); ctx.strokeStyle = gr; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(x + k * 6, y + k * 2.4); ctx.lineTo(x + k * 6 - len, y + k * 2.4 - len * 0.4); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}
function midAnim(ctx, K) {
  const T = K.T, b = K.b, rf = RIFT(b);
  // the rift breathes and drinks motes from the void
  ctx.globalCompositeOperation = 'lighter';
  const br = K.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(T * 1.6);
  ctx.globalAlpha = 0.25 + br * 0.3; ctx.drawImage(K.glow(PINK), rf.x - 1.6, rf.y - 2.8, 3.2, 5.6);
  ctx.globalAlpha = 0.2 + br * 0.15; ctx.drawImage(K.glow(VIOLET), rf.x - 3.5, rf.y - 3.5, 7, 7);
  const R = rnd(13);
  ctx.fillStyle = '#ffd8ff';
  for (let i = 0, n = K.n(22); i < n; i++) { const a = R() * TAU, spd = 0.12 + R() * 0.15, f = 1 - ((T * spd + R()) % 1), d = 0.4 + f * 4.5, sw = a + f * 1.2; const x = rf.x + Math.cos(sw) * d * 0.8, y = rf.y + Math.sin(sw) * d * 0.9; ctx.globalAlpha = (1 - f) * 0.9; const s = 0.03 + (1 - f) * 0.05; ctx.fillRect(x - s / 2, y - s / 2, s, s); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // broken board fragments bobbing and slowly turning, each circled by a rune
  for (const [i, [x, y, s]] of FRAGS(b).entries()) {
    const bob = Math.sin(T * 0.6 + i * 1.9) * 0.18, rot = K.reduced ? 0 : Math.sin(T * 0.25 + i) * 0.05, w = 4 * s * 0.95, h = 3.5 * s * 0.95;
    if (K.hidden(x - w / 2, y - h / 2 + bob, x + w / 2, y + h / 2 + bob)) continue;
    ctx.save(); ctx.translate(x, y + bob); ctx.rotate(rot); ctx.drawImage(fragSprite(K, i % 5, 1), -w / 2, -h * 0.29, w, h); ctx.restore();
    if (!K.lowQ) { const a = T * 0.5 + i, rx = w * 0.42; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85; ctx.drawImage(runeSprite(K, i % 8), x + Math.cos(a) * rx - 0.2, y + bob + 0.2 + Math.sin(a) * rx * 0.3 - 0.2, 0.4, 0.4); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  }
}
// eight glowing glyphs drawn from strokes on a 3x3 grid
function runeSprite(K, i) {
  return K.sprite('rift-rune' + i, 48, 48, (g, w) => {
    const P = (k) => [8 + (k % 3) * 16, 8 + Math.floor(k / 3) * 16], col = i % 2 ? CYAN : '#d6a8ff';
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [lw, c] of [[7, rgbaH(col, 0.25)], [2.6, col], [1, '#ffffff']]) {
      const R = rnd(200 + i); g.strokeStyle = c; g.lineWidth = lw;
      g.beginPath(); let k = Math.floor(R() * 9); g.moveTo(...P(k)); for (let s = 0; s < 4; s++) { k = Math.floor(R() * 9); g.lineTo(...P(k)); } g.stroke();
      g.beginPath(); g.arc(w / 2, w / 2, 21, 0, TAU); g.lineWidth = lw * 0.5; g.stroke();
    }
  });
}
function rimAnim(ctx, K) {
  // a ring of runes orbiting the island just beyond its corners
  const T = K.T, b = K.b, { x, y } = C(b), rad = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + 1.6, n = 24;
  ctx.globalCompositeOperation = 'lighter';
  if (!K.lowQ) { ctx.strokeStyle = 'rgba(176,77,255,0.18)'; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.stroke(); ctx.strokeStyle = 'rgba(90,224,255,0.1)'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.arc(x, y, rad + 0.4, 0, TAU); ctx.stroke(); }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + T * 0.06, rx = x + Math.cos(a) * rad, ry = y + Math.sin(a) * rad;
    if (K.hidden(rx - 0.3, ry - 0.3, rx + 0.3, ry + 0.3)) continue;
    ctx.globalAlpha = K.reduced ? 0.7 : 0.55 + 0.35 * Math.sin(T * 1.5 + i * 0.8); ctx.drawImage(runeSprite(K, i % 8), rx - 0.32, ry - 0.32, 0.64, 0.64);
  }
  // crystal veins pulsing under the island
  const oy1 = b.y1 + 0.7, p = K.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(T * 1.1);
  ctx.globalAlpha = 0.15 + p * 0.2; ctx.drawImage(K.glow(CYAN), b.x0 + 1, oy1, b.x1 - b.x0 - 2, 4);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

export default {
  id: 'rift',
  base: '#07041a',
  light: { tint: ['#ece4ff', '#e8e4ff'], glow: ['t', VIOLET, 0.14] },
  layers: [
    { p: 0.03, res: 0.5, paint: space },
    { p: 0.15, res: 0.7, paint: far, anim: farAnim },
    { p: 0.45, res: 0.85, paint: mid, anim: midAnim },
    { p: 1, r: 5, res: 0.85, paint: rim, anim: rimAnim },
  ],
};

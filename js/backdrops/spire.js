// 16.0 (L): Clockwork Spire. Inside the great chamber of a colossal clock tower: a backlit glass clock face with
// turning hands above the board, brass pendulums swinging beside it, a wall of slowly turning gear trains, light shafts
// falling from a high window through drifting brass dust, and a parquet gallery with a brass balustrade and a floor gear
// around the board. Contract: js/backdrop.js (E1). Units are board tiles; the board covers K.b.
// Perf (15.1 rules): every static thing is painted once into the cached layers (backdrop.js copies them 1:1 while the
// camera holds); anims draw cached sprites only (gears, bobs, the soft shaft bake), culled with K.hidden, counts via K.n.
import { ramp, rnd, mixH, rgbaH, TAU_ as TAU } from './e2kit.js';

const BR = { hi: '#ffe8a8', lite: '#e2b55c', mid: '#a8742a', dark: '#4a2e10', deep: '#20140a' };
const WALL = ramp([[-22, '#07050a'], [-11, '#140d09'], [-6, '#2a1c11'], [-2, '#33231a'], [4, '#1e150e'], [24, '#0b0806']]);
const AMBER = '#ffb04a', WARM = '#ffd690';

// ---------- layout (shared by paint and anim; portrait keeps the hero clock above the board, wide adds side towers) ----------
function lay(K) {
  if (K._spire) return K._spire;
  const b = K.b, cx = (b.x0 + b.x1) / 2, wide = !!K.wide, hz = K.hz == null ? -2.4 : K.hz;
  const o = {
    cx, wide, hz,
    clock: { x: cx, y: -3.7, r: 2.65 },
    pend: [{ x: cx - 4.35, y: -7.6, len: 5.2, amp: 0.2, ph: 0, bob: 0.5 }, { x: cx + 4.35, y: -7.6, len: 5.2, amp: 0.2, ph: Math.PI, bob: 0.5 }],
    far: [{ x: cx - 6.7, y: -3.0, r: 2.7, sp: 0.05, t: 18 }, { x: cx + 6.9, y: -3.9, r: 2.3, sp: -0.06, t: 16 }, { x: cx - 2.5, y: -7.0, r: 1.5, sp: -0.09, t: 12 }, { x: cx + 2.7, y: -7.3, r: 1.3, sp: 0.1, t: 12 },
      { x: cx - 10.6, y: -6.4, r: 1.9, sp: -0.07, t: 14 }, { x: cx + 10.8, y: -6.9, r: 1.7, sp: 0.08, t: 14 }],
    floor: { x: cx, y: b.y1 + 3.5, r: 2.5 },
  };
  if (wide) { // landscape / desktop: the open sides get a second clock tower on the left and a long pendulum on the right
    o.side = { x: b.x0 - 4.9, y: hz - 0.2, r: 3.0 };
    o.pend.push({ x: b.x1 + 4.6, y: -1.6, len: 9.4, amp: 0.13, ph: 1.1, bob: 0.85 });
    o.far.push({ x: b.x0 - 8.2, y: hz - 4.2, r: 2.3, sp: -0.06, t: 16 }, { x: b.x0 - 2.6, y: hz + 6.2, r: 1.9, sp: 0.08, t: 14 }, { x: b.x0 - 6.6, y: hz + 9.4, r: 2.6, sp: -0.05, t: 18 },
      { x: b.x1 + 2.6, y: hz - 1.8, r: 2.0, sp: 0.07, t: 14 }, { x: b.x1 + 7.2, y: hz + 3.6, r: 2.6, sp: -0.05, t: 18 }, { x: b.x1 + 3.4, y: hz + 10.6, r: 1.8, sp: 0.09, t: 12 });
  }
  return (K._spire = o);
}

// ---------- gears ----------
function gearPath(g, R, teeth, depth = 0.12, tw = 0.45) {
  const Rr = R * (1 - depth); g.beginPath();
  for (let k = 0; k < teeth; k++) {
    const a = (k / teeth) * TAU, p = TAU / teeth, a1 = a - p * tw * 0.5, a2 = a + p * tw * 0.5;
    g.arc(0, 0, Rr, a - p * 0.5, a1 - p * 0.05); g.arc(0, 0, R, a1, a2); g.arc(0, 0, Rr, a2 + p * 0.05, a + p * 0.5);
  }
  g.closePath();
}
// paints a gear centred at the origin with radius R (canvas units). o: { teeth, spokes, body:[lite, mid, dark], edge, rim, flat }
function paintGear(g, R, o) {
  const teeth = o.teeth || 16, spokes = o.spokes || 5;
  gearPath(g, R, teeth);
  if (o.flat) g.fillStyle = o.flat;
  else { const gr = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.05, 0, 0, R); gr.addColorStop(0, o.body[0]); gr.addColorStop(0.5, o.body[1]); gr.addColorStop(1, o.body[2]); g.fillStyle = gr; }
  g.fill();
  if (o.edge) { g.strokeStyle = o.edge; g.lineWidth = R * 0.025; g.stroke(); }
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < spokes; k++) { const a = (k / spokes) * TAU + 0.25, w = TAU / spokes - 0.42; g.beginPath(); g.arc(0, 0, R * 0.7, a, a + w); g.arc(0, 0, R * 0.32, a + w - 0.1, a + 0.12, true); g.closePath(); g.fill(); }
  g.beginPath(); g.arc(0, 0, R * 0.07, 0, TAU); g.fill();
  g.restore();
  if (!o.flat) {
    g.strokeStyle = rgbaH(o.body[2], 0.9); g.lineWidth = R * 0.03; g.beginPath(); g.arc(0, 0, R * 0.78, 0, TAU); g.stroke();
    g.strokeStyle = rgbaH(o.body[0], 0.5); g.lineWidth = R * 0.012; g.beginPath(); g.arc(0, 0, R * 0.8, 0, TAU); g.stroke();
    const hb = g.createRadialGradient(-R * 0.05, -R * 0.07, 0, 0, 0, R * 0.24); hb.addColorStop(0, o.body[0]); hb.addColorStop(1, o.body[2]);
    g.fillStyle = hb; g.beginPath(); g.arc(0, 0, R * 0.22, 0, TAU); g.arc(0, 0, R * 0.07, 0, TAU, true); g.fill('evenodd');
  }
  if (o.rim) { g.strokeStyle = o.rim; g.lineWidth = R * 0.03; g.beginPath(); g.arc(0, 0, R * 0.985, -2.5, -0.9); g.stroke(); }
}
const FAR_G = { body: ['#6a4a26', '#3a2814', '#1a1008'], edge: 'rgba(10,6,2,0.8)', rim: 'rgba(255,190,110,0.35)' };
const MID_G = { body: [BR.hi, BR.mid, BR.dark], edge: 'rgba(40,22,6,0.9)', rim: 'rgba(255,236,180,0.7)' };
function gearSpr(K, kind, teeth) {
  return K.sprite('spire-g-' + kind + teeth, 256, 256, (g, w) => { g.translate(w / 2, w / 2); paintGear(g, w * 0.48, { teeth, spokes: teeth > 14 ? 6 : 5, ...(kind === 'far' ? FAR_G : MID_G) }); });
}
function drawGearAt(ctx, spr, x, y, r, a) { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.drawImage(spr, -r / 0.96, -r / 0.96, (2 * r) / 0.96, (2 * r) / 0.96); ctx.restore(); }

// ---------- layer 0: the chamber wall ----------
function wall(g, K) {
  const L = lay(K), R = rnd(7);
  g.fillStyle = WALL.grad(g, K.y0, K.y1); g.fillRect(K.x0, K.y0, K.x1 - K.x0, K.y1 - K.y0);
  // tall timber panelling with brass seams
  for (let x = Math.floor(K.x0 / 2.6) * 2.6; x < K.x1; x += 2.6) {
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, K.y0, 0.16, K.y1 - K.y0);
    g.fillStyle = 'rgba(255,190,110,0.06)'; g.fillRect(x + 0.16, K.y0, 0.05, K.y1 - K.y0);
    for (let y = Math.floor(K.y0 / 3.4) * 3.4 + (R() < 0.5 ? 0 : 1.7); y < K.y1; y += 3.4) { g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 0.05; g.strokeRect(x + 0.4, y + 0.3, 1.8, 2.8); }
  }
  // the high window the light comes from (top left), with its tracery
  const wx = L.cx - 8.5, wy = -13.5;
  g.fillStyle = K.rad(g, wx, wy, 0, 9, [[0, 'rgba(255,214,150,0.55)'], [0.3, 'rgba(255,170,90,0.18)'], [1, 'rgba(255,140,60,0)']]); g.fillRect(wx - 9, wy - 9, 18, 18);
  g.fillStyle = 'rgba(255,230,180,0.6)'; g.beginPath(); g.arc(wx, wy, 1.6, 0, TAU); g.fill();
  g.strokeStyle = '#1a110a'; g.lineWidth = 0.14; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + Math.cos(a) * 1.6, wy + Math.sin(a) * 1.6); g.stroke(); }
  g.beginPath(); g.arc(wx, wy, 0.7, 0, TAU); g.stroke(); g.beginPath(); g.arc(wx, wy, 1.6, 0, TAU); g.stroke();
  // enormous gears sunk into the wall, barely lit (static: the wall itself)
  for (const [dx, y, r, t] of [[-3, -12, 6.5, 30], [9, -15, 5.2, 26], [-16, -4, 5.8, 28], [17, -2, 6.2, 30], [-22, 9, 5, 24], [23, 12, 5.4, 26]]) {
    g.save(); g.translate(L.cx + dx, y); g.globalAlpha = 0.5; paintGear(g, r, { teeth: t, spokes: 8, flat: '#140d08', rim: 'rgba(255,170,90,0.12)' }); g.restore();
  }
  // a far upper gallery: a rail of brass catching the window light
  for (const y of [-10.2, L.wide ? L.hz - 5.6 : -9]) { g.fillStyle = 'rgba(10,6,4,0.7)'; g.fillRect(K.x0, y, K.x1 - K.x0, 0.35); g.fillStyle = 'rgba(255,190,110,0.22)'; g.fillRect(K.x0, y, K.x1 - K.x0, 0.04); }
}

// ---------- layer 1: gear trains on iron beams ----------
function far(g, K) {
  const L = lay(K);
  // iron beams and columns the gears hang from
  const beam = (x0, y0, x1, y1) => { g.fillStyle = '#120c07'; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.fillStyle = 'rgba(255,180,100,0.16)'; g.fillRect(x0, y0, x1 - x0, 0.05); g.fillStyle = 'rgba(200,150,90,0.25)'; for (let x = x0 + 0.2; x < x1; x += 0.6) g.fillRect(x, y0 + (y1 - y0) / 2 - 0.03, 0.06, 0.06); };
  beam(K.x0, -9.4, K.x1, -8.95); beam(K.x0, -1.9, K.x1, -1.5);
  for (const x of [L.cx - 8.8, L.cx + 8.8, L.cx - 13.5, L.cx + 13.5]) { g.fillStyle = '#100a06'; g.fillRect(x - 0.35, -9, 0.7, K.y1 + 9); g.fillStyle = 'rgba(255,180,100,0.1)'; g.fillRect(x - 0.35, -9, 0.06, K.y1 + 9); }
  // axle brackets behind every turning gear
  for (const q of L.far) { g.fillStyle = '#0e0905'; g.beginPath(); g.moveTo(q.x - 0.3, q.y); g.lineTo(q.x - 0.5, q.y - q.r - 0.4); g.lineTo(q.x + 0.5, q.y - q.r - 0.4); g.lineTo(q.x + 0.3, q.y); g.closePath(); g.fill(); }
  // a haze band so the far machinery sits back
  g.fillStyle = K.lin(g, 0, -6, 0, 0, [[0, 'rgba(60,36,18,0)'], [1, 'rgba(60,36,18,0.35)']]); g.fillRect(K.x0, -6, K.x1 - K.x0, 6);
}
function shaftBake(g, S) { // diagonal beams from the high window, low-res soft bake (2 blits a frame)
  g.globalCompositeOperation = 'lighter';
  const ox = S.cx - 8.5, oy = -13.5;
  for (let i = 0; i < 5; i++) {
    const a = 0.5 + i * 0.13, len = 30, w0 = 0.6 + i * 0.25, w1 = 2.2 + i * 0.7;
    g.save(); g.translate(ox, oy); g.rotate(a - 0.05);
    const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, `rgba(255,214,150,${0.22 - i * 0.02})`); gr.addColorStop(0.6, 'rgba(255,190,110,0.06)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, -w0 / 2); g.lineTo(len, -w1 / 2); g.lineTo(len, w1 / 2); g.lineTo(0, w0 / 2); g.closePath(); g.fill();
    g.restore();
  }
}
function farAnim(ctx, K) {
  const L = lay(K), T = K.T;
  for (const q of L.far) {
    if (K.hidden(q.x - q.r, q.y - q.r, q.x + q.r, q.y + q.r)) continue;
    drawGearAt(ctx, gearSpr(K, 'far', q.t), q.x, q.y, q.r, T * q.sp + q.x);
  }
  if (K.lowQ || !K.soft) return;
  const o = K.soft('shafts', 3, -14, 18, (g, S) => shaftBake(g, { ...S, cx: L.cx }));
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55 + 0.2 * Math.sin(T * 0.23); K.blitOut(o, 0, 0);
  ctx.globalAlpha = 0.25 + 0.15 * Math.sin(T * 0.31 + 2); K.blitOut(o, Math.sin(T * 0.07) * 0.8, 0);
  // brass dust turning in the beams
  const gl = K.glow(WARM), n = K.n(16), R = rnd(23);
  for (let i = 0; i < n; i++) {
    const sx = R(), sy = R(), sp = 0.05 + R() * 0.08, f = (sy + T * sp) % 1;
    const x = L.cx - 7 + sx * 14 + f * 6 + Math.sin(T * 0.4 + i) * 0.4, y = -11 + f * 12;
    if (K.hidden(x, y, x + 0.1, y + 0.1)) continue;
    const tw = Math.pow(Math.abs(Math.sin(T * (0.8 + R()) + i * 2.1)), 3);
    ctx.globalAlpha = (0.25 + 0.6 * tw) * Math.sin(f * Math.PI); ctx.drawImage(gl, x - 0.09, y - 0.09, 0.18, 0.18);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ---------- layer 2: the great clock face, pendulums, side tower ----------
function dial(g, K, c, roman) {
  const { x, y, r } = c;
  // backlight through the glass and the masonry surround
  g.fillStyle = K.rad(g, x, y, r * 0.4, r * 2.1, [[0, 'rgba(255,200,120,0.55)'], [0.45, 'rgba(255,150,70,0.2)'], [1, 'rgba(255,120,50,0)']]); g.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
  g.fillStyle = '#1c130b'; g.beginPath(); g.arc(x, y, r * 1.16, 0, TAU); g.fill();
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; g.fillStyle = k % 2 ? '#2a1c10' : '#33220f'; g.beginPath(); g.arc(x, y, r * 1.16, a, a + TAU / 24); g.arc(x, y, r * 1.05, a + TAU / 24, a, true); g.closePath(); g.fill(); }
  // brass bezel
  const bz = g.createLinearGradient(x - r, y - r, x + r, y + r); bz.addColorStop(0, BR.hi); bz.addColorStop(0.4, BR.lite); bz.addColorStop(0.7, BR.mid); bz.addColorStop(1, BR.dark);
  g.fillStyle = bz; g.beginPath(); g.arc(x, y, r * 1.05, 0, TAU); g.arc(x, y, r * 0.95, 0, TAU, true); g.fill('evenodd');
  g.strokeStyle = 'rgba(40,22,6,0.8)'; g.lineWidth = r * 0.012; g.beginPath(); g.arc(x, y, r * 0.95, 0, TAU); g.stroke();
  // backlit glass dial, amber at the centre
  g.fillStyle = K.rad(g, x - r * 0.15, y - r * 0.2, r * 0.05, r, [[0, '#fff2cc'], [0.55, '#f2c87a'], [1, '#b77a34']]); g.beginPath(); g.arc(x, y, r * 0.95, 0, TAU); g.fill();
  // glazing bars
  g.strokeStyle = 'rgba(60,34,10,0.55)'; g.lineWidth = r * 0.018;
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3); g.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); g.stroke(); }
  for (const f of [0.3, 0.62]) { g.beginPath(); g.arc(x, y, r * f, 0, TAU); g.stroke(); }
  // chapter ring with minute ticks and roman hours
  g.strokeStyle = 'rgba(50,28,8,0.9)'; g.lineWidth = r * 0.02; g.beginPath(); g.arc(x, y, r * 0.9, 0, TAU); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.7, 0, TAU); g.stroke();
  for (let k = 0; k < 60; k++) { const a = (k / 60) * TAU, big = k % 5 === 0, r0 = r * (big ? 0.83 : 0.865); g.lineWidth = r * (big ? 0.03 : 0.012); g.beginPath(); g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); g.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9); g.stroke(); }
  if (roman) {
    const N = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.fillStyle = 'rgba(46,24,6,0.92)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 ${(r * 0.17).toFixed(3)}px Georgia, 'Times New Roman', serif`;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU - Math.PI / 2; g.save(); g.translate(x + Math.cos(a) * r * 0.765, y + Math.sin(a) * r * 0.765); g.rotate(a + Math.PI / 2); g.fillText(N[k], 0, 0); g.restore(); }
  }
  // filigree rose in the centre
  g.strokeStyle = 'rgba(90,50,14,0.6)'; g.lineWidth = r * 0.015;
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.18, y + Math.sin(a) * r * 0.18, r * 0.16, r * 0.06, a, 0, TAU); g.stroke(); }
  // a soft reflection across the glass
  g.fillStyle = K.lin(g, x - r, y - r, x + r * 0.2, y + r * 0.2, [[0, 'rgba(255,255,240,0.18)'], [0.5, 'rgba(255,255,240,0.04)'], [1, 'rgba(255,255,240,0)']]); g.beginPath(); g.arc(x, y, r * 0.95, 0, TAU); g.fill();
}
function mid(g, K) {
  const L = lay(K);
  // pendulum frames: a dark case around each swing, with a brass pivot block
  for (const p of L.pend) {
    g.fillStyle = 'rgba(14,9,5,0.85)'; g.fillRect(p.x - 1.25, p.y - 0.5, 2.5, 0.42);
    g.fillStyle = BR.mid; g.fillRect(p.x - 0.28, p.y - 0.35, 0.56, 0.42); g.fillStyle = 'rgba(255,230,170,0.5)'; g.fillRect(p.x - 0.28, p.y - 0.35, 0.56, 0.05);
    const by = p.y + p.len; g.fillStyle = K.rad(g, p.x, by, 0, 1.6, [[0, 'rgba(255,170,90,0.14)'], [1, 'rgba(255,140,60,0)']]); g.fillRect(p.x - 1.6, by - 1.6, 3.2, 3.2);
  }
  dial(g, K, L.clock, true);
  if (L.side) {
    const c = L.side; // the side tower: a stone shaft with the second dial and a brass gallery
    g.fillStyle = '#1a120b'; g.fillRect(c.x - c.r * 1.35, c.y - c.r * 1.6, c.r * 2.7, K.y1 - c.y + c.r * 1.6);
    g.fillStyle = 'rgba(255,190,110,0.1)'; g.fillRect(c.x + c.r * 1.3, c.y - c.r * 1.6, 0.06, K.y1 - c.y + c.r * 1.6);
    for (let y = c.y + c.r * 1.4; y < K.y1; y += 1.1) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(c.x - c.r * 1.35, y, c.r * 2.7, 0.05); }
    dial(g, K, c, true);
    g.fillStyle = BR.dark; g.fillRect(c.x - c.r * 1.5, c.y + c.r * 1.3, c.r * 3, 0.2); g.fillStyle = 'rgba(255,220,150,0.4)'; g.fillRect(c.x - c.r * 1.5, c.y + c.r * 1.3, c.r * 3, 0.04);
  }
}
function bobSpr(K) {
  return K.sprite('spire-bob', 96, 96, (g, w) => {
    const c = w / 2, r = w * 0.46;
    const gr = g.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.05, c, c, r); gr.addColorStop(0, '#fff3c4'); gr.addColorStop(0.35, BR.lite); gr.addColorStop(0.8, BR.mid); gr.addColorStop(1, BR.dark);
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(60,32,8,0.7)'; g.lineWidth = w * 0.03; g.beginPath(); g.arc(c, c, r * 0.72, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(70,40,10,0.8)'; g.beginPath(); g.arc(c, c, r * 0.16, 0, TAU); g.fill();
  });
}
function hands(ctx, c, T) {
  const { x, y, r } = c, hr = T * 0.004 + 1.9, mn = T * 0.05 + 0.6; // minute hand visibly creeps; hour hand all but still
  ctx.lineCap = 'round';
  for (const [a, len, w, col] of [[hr, 0.5, 0.075, '#2a1606'], [mn, 0.78, 0.045, '#2a1606']]) {
    const ex = x + Math.sin(a) * r * len, ey = y - Math.cos(a) * r * len;
    ctx.strokeStyle = 'rgba(40,20,6,0.35)'; ctx.lineWidth = r * w * 1.6; ctx.beginPath(); ctx.moveTo(x + 0.04, y + 0.06); ctx.lineTo(ex + 0.04, ey + 0.06); ctx.stroke(); // shadow on the glass
    ctx.strokeStyle = col; ctx.lineWidth = r * w; ctx.beginPath(); ctx.moveTo(x - Math.sin(a) * r * 0.12, y + Math.cos(a) * r * 0.12); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + Math.sin(a) * r * len * 0.8, y - Math.cos(a) * r * len * 0.8, r * w * 0.9, 0, TAU); ctx.fill(); // spade tip
  }
  ctx.fillStyle = BR.lite; ctx.beginPath(); ctx.arc(x, y, r * 0.06, 0, TAU); ctx.fill();
  ctx.lineCap = 'butt';
}
function midAnim(ctx, K) {
  const L = lay(K), T = K.T;
  for (const c of [L.clock, L.side]) if (c && !K.hidden(c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r)) hands(ctx, c, T + c.x * 40);
  // pendulums: a tick-tock period of 2 s (one swing per second), slowed under reduced motion by K.T itself
  const bob = bobSpr(K);
  for (const p of L.pend) {
    if (K.hidden(p.x - 2, p.y, p.x + 2, p.y + p.len + p.bob)) continue;
    const a = Math.sin(T * Math.PI + p.ph) * p.amp, ex = p.x + Math.sin(a) * p.len, ey = p.y + Math.cos(a) * p.len;
    ctx.strokeStyle = '#3a2410'; ctx.lineWidth = 0.13; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,214,150,0.5)'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(p.x - 0.04, p.y); ctx.lineTo(ex - 0.04, ey); ctx.stroke();
    ctx.drawImage(bob, ex - p.bob, ey - p.bob, p.bob * 2, p.bob * 2);
    if (!K.lowQ) { const sw = Math.abs(Math.cos(T * Math.PI + p.ph)); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.12 + 0.18 * (1 - sw); ctx.drawImage(K.glow(AMBER), ex - p.bob * 1.6, ey - p.bob * 1.6, p.bob * 3.2, p.bob * 3.2); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  }
}

// ---------- layer 3: the gallery floor around the board ----------
function rim(g, K) {
  const b = K.b, L = lay(K), R = rnd(41), F = 0.7, ox0 = b.x0 - F, oy0 = b.y0 - F, ox1 = b.x1 + F, oy1 = b.y1 + F;
  // herringbone parquet in dark oak, framing the board
  const parquet = (x0, y0, x1, y1) => {
    g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
    g.fillStyle = '#24160c'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let y = Math.floor(y0) - 1; y < y1 + 1; y += 0.5) for (let x = Math.floor(x0) - 1; x < x1 + 1; x += 1) {
      const odd = ((Math.round(y * 2) % 2) + 2) % 2, c = mixH('#3a2414', '#2a190d', R()), px = x + (odd ? 0.5 : 0);
      g.fillStyle = c; g.save(); g.translate(px, y); g.rotate(odd ? 0.785 : -0.785); g.fillRect(-0.34, -0.11, 0.68, 0.22); g.restore();
    }
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.restore();
  };
  parquet(ox0 - 2.2, oy0 - 1.8, ox1 + 2.2, oy0);
  parquet(ox0 - 2.2, oy0, ox0, oy1); parquet(ox1, oy0, ox1 + 2.2, oy1);
  parquet(K.x0 + 2, oy1, K.x1 - 2, K.y1);
  // feather the parquet's outer edges into the dark
  g.globalCompositeOperation = 'destination-out';
  const fe = (x0, y0, x1, y1, rx, ry, rw, rh) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = gr; g.fillRect(rx, ry, rw, rh); };
  fe(0, oy0 - 1, 0, oy0 - 1.85, K.x0, oy0 - 1.9, K.x1 - K.x0, 0.95);
  fe(ox0 - 1.3, 0, ox0 - 2.25, 0, K.x0, oy0 - 1.9, ox0 - 1.3 - K.x0, K.y1 - oy0 + 2);
  fe(ox1 + 1.3, 0, ox1 + 2.25, 0, ox1 + 1.3, oy0 - 1.9, K.x1 - ox1, K.y1 - oy0 + 2);
  g.globalCompositeOperation = 'source-over';
  // brass inlay rails right outside the frame, with rivets
  const rail = (x, y, w, h) => { g.fillStyle = K.lin(g, x, y, x + (w > h ? 0 : w), y + (w > h ? h : 0), [[0, BR.hi], [0.5, BR.mid], [1, BR.dark]]); g.fillRect(x, y, w, h); g.fillStyle = 'rgba(40,20,4,0.7)'; const st = 0.9; if (w > h) for (let q = x + 0.3; q < x + w; q += st) g.fillRect(q, y + h / 2 - 0.025, 0.05, 0.05); else for (let q = y + 0.3; q < y + h; q += st) g.fillRect(x + w / 2 - 0.025, q, 0.05, 0.05); };
  rail(ox0 - 0.3, oy0 - 0.3, ox1 - ox0 + 0.6, 0.16); rail(ox0 - 0.3, oy1 + 0.14, ox1 - ox0 + 0.6, 0.16);
  rail(ox0 - 0.3, oy0 - 0.14, 0.16, oy1 - oy0 + 0.28); rail(ox1 + 0.14, oy0 - 0.14, 0.16, oy1 - oy0 + 0.28);
  // the floor gear's pit below the board (the gear itself turns in rimAnim)
  const fg = L.floor;
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(fg.x, fg.y, fg.r * 1.08, 0, TAU); g.fill();
  g.fillStyle = K.rad(g, fg.x, fg.y, 0, fg.r * 1.05, [[0, '#120a04'], [1, '#2a1a0c']]); g.beginPath(); g.arc(fg.x, fg.y, fg.r * 1.03, 0, TAU); g.fill();
  g.strokeStyle = BR.mid; g.lineWidth = 0.08; g.beginPath(); g.arc(fg.x, fg.y, fg.r * 1.05, 0, TAU); g.stroke();
  // balustrade along the gallery's front edge, below the floor gear (portrait shows its top, desktop all of it)
  const by = fg.y + fg.r + 0.7;
  g.fillStyle = '#1a0f07'; g.fillRect(K.x0, by, K.x1 - K.x0, K.y1 - by);
  g.fillStyle = K.lin(g, 0, by - 0.25, 0, by + 0.05, [[0, BR.hi], [0.5, BR.lite], [1, BR.dark]]); g.fillRect(K.x0, by - 0.25, K.x1 - K.x0, 0.3);
  for (let x = Math.floor(K.x0 * 2) / 2; x < K.x1; x += 0.5) { g.fillStyle = K.lin(g, x - 0.08, 0, x + 0.08, 0, [[0, BR.dark], [0.4, BR.lite], [1, BR.dark]]); g.fillRect(x - 0.07, by + 0.05, 0.14, 1.1); g.beginPath(); g.ellipse(x, by + 0.6, 0.11, 0.17, 0, 0, TAU); g.fill(); }
  g.fillStyle = BR.dark; g.fillRect(K.x0, by + 1.15, K.x1 - K.x0, 0.14);
  // brass gas lamps on posts at the four corners of the gallery (their glow breathes in rimAnim)
  for (const [x, y] of LAMPS(b)) {
    g.fillStyle = '#1a0f07'; g.fillRect(x - 0.06, y, 0.12, 1.1);
    g.fillStyle = BR.mid; g.fillRect(x - 0.2, y - 0.38, 0.4, 0.42); g.fillStyle = '#ffe2a0'; g.fillRect(x - 0.13, y - 0.31, 0.26, 0.28);
    g.fillStyle = BR.dark; g.beginPath(); g.moveTo(x - 0.26, y - 0.38); g.lineTo(x, y - 0.6); g.lineTo(x + 0.26, y - 0.38); g.closePath(); g.fill();
  }
  // spare cogs and a toolbox stacked by the frame
  for (const [x, y, r, t] of [[ox0 - 1.2, oy0 - 1.0, 0.45, 10], [ox0 - 0.7, oy0 - 1.25, 0.3, 8], [ox1 + 1.1, oy1 - 1.1, 0.5, 12], [ox1 + 1.4, oy0 + 2.6, 0.32, 8]]) {
    g.save(); g.translate(x, y); paintGear(g, r, { teeth: t, spokes: 4, body: [BR.lite, BR.mid, BR.dark], edge: 'rgba(30,16,4,0.9)' }); g.restore();
  }
}
const LAMPS = (b) => [[b.x0 - 1.6, b.y0 - 1.2], [b.x1 + 1.6, b.y0 - 1.2], [b.x0 - 1.6, b.y1 + 1.6], [b.x1 + 1.6, b.y1 + 1.6]];
function rimAnim(ctx, K) {
  const L = lay(K), T = K.T, fg = L.floor;
  if (!K.hidden(fg.x - fg.r, fg.y - fg.r, fg.x + fg.r, fg.y + fg.r)) {
    // the floor gear advances one tooth per second with a small settle: the escapement's tick
    const tick = K.reduced ? T * 0.25 : Math.floor(T) + Math.min(1, (T % 1) / 0.18) ** 0.5, a = tick * (TAU / 20);
    drawGearAt(ctx, gearSpr(K, 'mid', 20), fg.x, fg.y, fg.r, a);
    // sparks where it bites a pinion off to the side
    if (!K.lowQ && !K.reduced && (T % 1) < 0.2) {
      const px = fg.x + fg.r * 0.92, py = fg.y - fg.r * 0.38, k = (T % 1) / 0.2;
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = WARM; ctx.lineWidth = 0.035; ctx.lineCap = 'round';
      for (let i = 0; i < K.n(5); i++) { const ang = -0.6 + i * 0.32, d = 0.15 + k * 0.6; ctx.globalAlpha = (1 - k) * 0.9; ctx.beginPath(); ctx.moveTo(px + Math.cos(ang) * d * 0.5, py + Math.sin(ang) * d * 0.5 + k * k * 0.2); ctx.lineTo(px + Math.cos(ang) * d, py + Math.sin(ang) * d + k * k * 0.4); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt';
    }
  }
  if (K.lowQ) return;
  const gl = K.glow(AMBER);
  ctx.globalCompositeOperation = 'lighter';
  LAMPS(K.b).forEach(([x, y], i) => { if (K.hidden(x - 1, y - 1.2, x + 1, y + 0.6)) return; const fl = K.reduced ? 0.8 : 0.8 + 0.12 * Math.sin(T * 7 + i * 2) + 0.08 * Math.sin(T * 13 + i); ctx.globalAlpha = 0.35 * fl; ctx.drawImage(gl, x - 1.1, y - 1.25, 2.2, 2.2); });
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

export default {
  id: 'spire',
  base: '#140d09',
  light: { tint: ['#fff2dc', '#ffe8cc'], glow: ['t', '#ffb860', 0.12] },
  layers: [
    { p: 0.05, res: 0.5, paint: wall },
    { p: 0.22, res: 0.7, paint: far, anim: farAnim },
    { p: 0.5, res: 0.85, paint: mid, anim: midAnim },
    { p: 1, r: 5, res: 0.85, paint: rim, anim: rimAnim },
  ],
};

// E2 15.0: Iron Works. A night foundry: a smog-orange sky over smokestacks, a gantry crane carrying a cast-iron rook,
// a turning flywheel gear, pumping pistons, a conveyor of fresh iron pawns and showers of sparks.
// Contract: js/backdrop.js (E1). Units are board tiles; the board covers K.b.
import { ramp, statue, rnd, mixH, shadeH, rgbaH, TAU_ as TAU } from './e2kit.js';

const SKY = ramp([[-18, '#0c0c10'], [-10, '#1a1719'], [-6, '#3a2620'], [-4, '#7a4224'], [-3.2, '#a85a2a'], [-2.8, '#3a2a22'], [4, '#1a1716'], [30, '#0e0d0d']]);
const IRON = { lite: '#8a8a92', mid: '#4a4a52', dark: '#1e1e24', edge: '#b8b8c0' };
const HOT = '#ff8a2a', HOTLITE = '#ffd27a';
// E1's suggested horizon: portrait keeps the authored layout; wide screens drop the skyline by dy so it shows above the
// side walls, whose top (WY) sits just above the horizon
const DY = (K) => (K.hz == null ? 0 : K.hz + 2.4);
const WY = (K) => (K.hz == null || !K.wide ? -1.6 : K.hz - 1);

function sky(g, K) {
  const dy = DY(K); g.save(); g.translate(0, dy); K = { ...K, y0: K.y0 - dy, y1: K.y1 - dy };
  g.fillStyle = SKY.grad(g, K.y0, K.y1); g.fillRect(K.x0, K.y0, K.x1 - K.x0, K.y1 - K.y0);
  const R = rnd(5);
  for (let i = 0; i < 40; i++) { // heavy smog banks lit from below by the furnaces
    const x = K.x0 + R() * (K.x1 - K.x0), y = -13 + R() * 10, r = 1.5 + R() * 3.5, warm = (y + 13) / 10;
    g.fillStyle = K.rad(g, x, y, 0, r, [[0, rgbaH(mixH('#2a2428', '#8a4a2a', warm * 0.8), 0.25 + R() * 0.2)], [1, 'rgba(40,30,30,0)']]);
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
}

function far(g, K) {
  const dy = DY(K); g.save(); g.translate(0, dy); K = { ...K, y0: K.y0 - dy, y1: K.y1 - dy };
  const b = K.b, cx = (b.x0 + b.x1) / 2, R = rnd(17), base = -2.75, sil = '#1d1a1c', sil2 = '#282325';
  // sawtooth factory halls with lit windows
  for (let x = K.x0 - 1; x < K.x1 + 1;) {
    const w = 3 + R() * 4, h = 0.8 + R() * 1.2, teeth = Math.max(2, Math.round(w / 0.9));
    g.fillStyle = R() < 0.5 ? sil : sil2;
    g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - h);
    for (let i = 0; i < teeth; i++) { const tx = x + (i / teeth) * w; g.lineTo(tx + w / teeth * 0.75, base - h - 0.35); g.lineTo(tx + w / teeth * 0.75, base - h); g.lineTo(tx + w / teeth, base - h); }
    g.lineTo(x + w, base); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,170,80,0.55)';
    for (let wy = base - h + 0.25; wy < base - 0.15; wy += 0.28) for (let wx = x + 0.2; wx < x + w - 0.2; wx += 0.3) if (R() < 0.35) g.fillRect(wx, wy, 0.12, 0.1);
    x += w + R() * 1.5;
  }
  // smokestacks (positions shared with the anim for smoke + beacons)
  for (const s of STACKS(b)) {
    const gr = g.createLinearGradient(s.x - s.w, 0, s.x + s.w, 0); gr.addColorStop(0, '#141214'); gr.addColorStop(0.7, '#3a3032'); gr.addColorStop(1, '#201c1e');
    g.fillStyle = gr; g.beginPath(); g.moveTo(s.x - s.w * 1.25, base); g.lineTo(s.x - s.w, s.top); g.lineTo(s.x + s.w, s.top); g.lineTo(s.x + s.w * 1.25, base); g.closePath(); g.fill();
    g.fillStyle = '#4a3c3a'; g.fillRect(s.x - s.w * 1.15, s.top - 0.08, s.w * 2.3, 0.14);
    g.fillStyle = 'rgba(200,60,40,0.45)'; for (let k = 1; k < 4; k++) g.fillRect(s.x - s.w * 1.02, s.top + k * (base - s.top) / 4.5, s.w * 2.04, 0.06); // red bands
    g.fillStyle = K.rad(g, s.x, s.top, 0, 0.9, [[0, 'rgba(255,140,60,0.35)'], [1, 'rgba(255,100,40,0)']]); g.fillRect(s.x - 0.9, s.top - 0.9, 1.8, 1.8);
  }
  // a cooling tower and a water tower for silhouette variety
  const ct = cx - 9.5; g.fillStyle = sil2; g.beginPath(); g.moveTo(ct - 1.5, base); g.quadraticCurveTo(ct - 0.7, base - 1.4, ct - 1.0, base - 2.6); g.lineTo(ct + 1.0, base - 2.6); g.quadraticCurveTo(ct + 0.7, base - 1.4, ct + 1.5, base); g.closePath(); g.fill();
  const wt = cx + 10.5; g.fillStyle = sil; g.fillRect(wt - 0.05 - 0.5, base - 1.6, 0.08, 1.6); g.fillRect(wt + 0.47, base - 1.6, 0.08, 1.6); g.beginPath(); g.ellipse(wt, base - 2, 0.75, 0.5, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(wt - 0.75, base - 2.2); g.lineTo(wt, base - 2.75); g.lineTo(wt + 0.75, base - 2.2); g.fill();
  // ground beyond the yard
  g.fillStyle = SKY.grad(g, base, K.y1); g.fillRect(K.x0, base, K.x1 - K.x0, K.y1 - base);
  g.fillStyle = 'rgba(255,130,50,0.18)'; g.fillRect(K.x0, base, K.x1 - K.x0, 0.06);
  g.restore();
}
const STACKS = (b) => { const cx = (b.x0 + b.x1) / 2; return [[-6.5, 3.6], [-4.8, 4.4], [5.8, 4.9], [7.4, 3.9], [-15, 4.2], [16, 4.6], [-22, 4], [23, 4.4]].map(([d, h]) => ({ x: cx + d, top: -2.75 - h, w: 0.32 })); };

// ---------- mid: gantry, gear, furnace, pistons, side walls ----------
function truss(g, x0, y0, x1, y1, col, lite) { // a lattice girder box from (x0,y0) to (x1,y1)
  const hz = x1 - x0 > y1 - y0, L = hz ? x1 - x0 : y1 - y0, D = hz ? y1 - y0 : x1 - x0, n = Math.max(1, Math.round(L / D));
  g.strokeStyle = col; g.lineWidth = D * 0.16; g.lineCap = 'square';
  g.beginPath();
  if (hz) { g.moveTo(x0, y0); g.lineTo(x1, y0); g.moveTo(x0, y1); g.lineTo(x1, y1); for (let i = 0; i <= n; i++) { const x = x0 + (L * i) / n; g.moveTo(x, y0); g.lineTo(x, y1); if (i < n) { g.moveTo(x, i % 2 ? y0 : y1); g.lineTo(x + L / n, i % 2 ? y1 : y0); } } }
  else { g.moveTo(x0, y0); g.lineTo(x0, y1); g.moveTo(x1, y0); g.lineTo(x1, y1); for (let i = 0; i <= n; i++) { const y = y0 + (L * i) / n; g.moveTo(x0, y); g.lineTo(x1, y); if (i < n) { g.moveTo(i % 2 ? x0 : x1, y); g.lineTo(i % 2 ? x1 : x0, y + L / n); } } }
  g.stroke();
  if (lite) { g.strokeStyle = lite; g.lineWidth = D * 0.05; g.beginPath(); if (hz) { g.moveTo(x0, y1 + D * 0.05); g.lineTo(x1, y1 + D * 0.05); } else { g.moveTo(x1 + D * 0.05, y0); g.lineTo(x1 + D * 0.05, y1); } g.stroke(); }
}
function riveted(g, x, y, w, h, R, col = IRON.mid) {
  const gr = g.createLinearGradient(x, y, x + w * 0.3, y + h); gr.addColorStop(0, shadeH(col, 0.1)); gr.addColorStop(1, shadeH(col, -0.35)); g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, y + h - 0.04, w, 0.04); g.fillRect(x + w - 0.04, y, 0.04, h);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, w, 0.025);
  g.fillStyle = 'rgba(200,200,210,0.45)'; const st = 0.32;
  for (let rx = x + 0.12; rx < x + w - 0.05; rx += st) { g.fillRect(rx, y + 0.08, 0.04, 0.04); g.fillRect(rx, y + h - 0.13, 0.04, 0.04); }
  if (R && R() < 0.3) { const rx = x + 0.2 + R() * (w - 0.4), ry = y + h * 0.35, gr2 = g.createLinearGradient(0, ry, 0, y + h); gr2.addColorStop(0, 'rgba(140,70,35,0.22)'); gr2.addColorStop(1, 'rgba(140,70,35,0)'); g.fillStyle = gr2; g.fillRect(rx, ry, 0.05 + R() * 0.12, h * 0.6); } // rust streak
}
function pipe(g, x0, y0, x1, y1, r, col) {
  g.lineCap = 'butt'; g.strokeStyle = shadeH(col, -0.4); g.lineWidth = r * 2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = col; g.lineWidth = r * 1.2; g.stroke();
  g.strokeStyle = shadeH(col, 0.45); g.lineWidth = r * 0.3; g.beginPath(); const dx = y1 - y0 ? r * 0.35 : 0, dy = y1 - y0 ? 0 : -r * 0.35; g.moveTo(x0 + dx, y0 + dy); g.lineTo(x1 + dx, y1 + dy); g.stroke();
}
function mid(g, K) {
  const b = K.b, cx = (b.x0 + b.x1) / 2, R = rnd(29), bottom = K.y1;
  // the factory floor beyond the yard (dark, with a warm wash under the furnace)
  const wy = WY(K);
  g.fillStyle = '#1b1919'; g.fillRect(K.x0, wy, K.x1 - K.x0, bottom - wy);
  // side walls of riveted plates (landscape / desktop)
  for (const side of [-1, 1]) {
    const xa = side < 0 ? K.x0 : b.x1 + 2.2, xb = side < 0 ? b.x0 - 2.2 : K.x1;
    for (let y = wy; y < bottom; y += 3.2) for (let x = xa; x < xb; x += 2.4) riveted(g, x, y, 2.38, 3.18, R, mixH('#34343a', '#2e2a2a', R() * 0.6));
    // boilers: big riveted tanks lying on their sides with a pressure gauge
    for (const by of [wy + 2.8, wy + 11]) {
      const bx0 = side < 0 ? xb - 6.5 : xa + 0.6, bw = 5.8, br = 1.05, bc = by + br;
      const gr = g.createLinearGradient(0, bc - br, 0, bc + br); gr.addColorStop(0, '#6a6a72'); gr.addColorStop(0.3, '#4a4a52'); gr.addColorStop(1, '#16161a');
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(bx0 + bw / 2, bc + br + 0.1, bw * 0.55, 0.25, 0, 0, TAU); g.fill();
      g.fillStyle = gr; g.beginPath(); g.moveTo(bx0, bc - br); g.lineTo(bx0 + bw, bc - br); g.arc(bx0 + bw, bc, br, -Math.PI / 2, Math.PI / 2); g.lineTo(bx0, bc + br); g.arc(bx0, bc, br, Math.PI / 2, -Math.PI / 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.04; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(bx0 + (bw * k) / 4, bc - br); g.lineTo(bx0 + (bw * k) / 4, bc + br); g.stroke(); }
      g.fillStyle = 'rgba(255,170,90,0.25)'; g.fillRect(bx0, bc - br * 0.82, bw, 0.05);
      const gx = bx0 + bw * (side < 0 ? 0.75 : 0.25), gy = bc - br - 0.35; pipe(g, gx, gy, gx, bc - br, 0.06, '#7a6a5a');
      g.fillStyle = '#2a2a2e'; g.beginPath(); g.arc(gx, gy, 0.3, 0, TAU); g.fill(); g.fillStyle = '#e8e0cc'; g.beginPath(); g.arc(gx, gy, 0.23, 0, TAU); g.fill();
      g.strokeStyle = '#c0341a'; g.lineWidth = 0.03; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + 0.15, gy - 0.1); g.stroke();
    }
    // darker the further from the board, with warm pools of furnace light
    const dg = g.createLinearGradient(side < 0 ? xb : xa, 0, side < 0 ? xa : xb, 0); dg.addColorStop(0, 'rgba(8,6,6,0)'); dg.addColorStop(1, 'rgba(8,6,6,0.6)');
    g.fillStyle = dg; g.fillRect(xa, wy, xb - xa, bottom - wy);
    // parapet rail along the wall top, catching the furnace light
    g.fillStyle = '#2a2a30'; g.fillRect(xa, wy - 0.55, xb - xa, 0.1); for (let x = xa + 0.3; x < xb; x += 0.9) g.fillRect(x, wy - 0.55, 0.07, 0.55);
    g.fillStyle = 'rgba(255,160,80,0.35)'; g.fillRect(xa, wy - 0.55, xb - xa, 0.025); g.fillStyle = '#3a3a42'; g.fillRect(xa, wy - 0.05, xb - xa, 0.12);
    g.globalCompositeOperation = 'lighter';
    for (const py of [wy + 7.1, wy + 15.6]) { const px = side < 0 ? xb - 3 : xa + 3; g.fillStyle = K.rad(g, px, py, 0, 3.2, [[0, 'rgba(255,130,50,0.16)'], [1, 'rgba(255,90,30,0)']]); g.fillRect(px - 3.2, py - 3.2, 6.4, 6.4); }
    g.globalCompositeOperation = 'source-over';
    // vertical pipes with valves
    for (let i = 0; i < 3; i++) { const px = side < 0 ? b.x0 - 2.6 - i * 1.1 : b.x1 + 2.6 + i * 1.1, col = ['#6a5a4a', '#5a6066', '#7a4a32'][i]; pipe(g, px, wy - 0.4, px, bottom, 0.14 + i * 0.03, col); for (let y = wy + 2.6 + i * 2; y < bottom; y += 5) { g.fillStyle = '#a0362a'; g.beginPath(); g.arc(px, y, 0.22, 0, TAU); g.fill(); g.fillStyle = '#2a1a18'; g.beginPath(); g.arc(px, y, 0.08, 0, TAU); g.fill(); } }
  }
  // piston housings on each flank (rods are animated)
  for (const p of PISTONS(b, wy)) {
    riveted(g, p.x - 0.55, p.y, 1.1, 1.6, null, '#3c3c44');
    g.fillStyle = '#26262c'; g.fillRect(p.x - 0.32, p.y - 0.22, 0.64, 0.22);
    g.fillStyle = 'rgba(255,200,60,0.85)'; for (let k = 0; k < 5; k++) { g.save(); g.beginPath(); g.rect(p.x - 0.55, p.y + 1.35, 1.1, 0.25); g.clip(); g.fillStyle = k % 2 ? '#1a1a1a' : '#f0b828'; g.beginPath(); g.moveTo(p.x - 0.55 + k * 0.3, p.y + 1.6); g.lineTo(p.x - 0.4 + k * 0.3, p.y + 1.35); g.lineTo(p.x - 0.25 + k * 0.3, p.y + 1.35); g.lineTo(p.x - 0.4 + k * 0.3, p.y + 1.6); g.fill(); g.restore(); }
  }
  // furnace mouth above the board on the right: a glowing arch in a brick hood
  const fx = cx + 4.6, fy = -1.25;
  g.fillStyle = '#2a201e'; g.beginPath(); g.moveTo(fx - 2.2, fy); g.lineTo(fx - 1.7, fy - 3.2); g.lineTo(fx + 1.7, fy - 3.2); g.lineTo(fx + 2.2, fy); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.03; for (let y = fy - 0.25; y > fy - 3.2; y -= 0.25) { g.beginPath(); g.moveTo(fx - 2.2, y); g.lineTo(fx + 2.2, y); g.stroke(); }
  g.fillStyle = K.rad(g, fx, fy, 0, 2.6, [[0, 'rgba(255,190,90,0.9)'], [0.35, 'rgba(255,110,30,0.55)'], [1, 'rgba(255,60,20,0)']]); g.fillRect(fx - 3, fy - 3.4, 6, 4);
  g.fillStyle = K.lin(g, 0, fy - 1.6, 0, fy, [[0, '#ffb040'], [0.6, '#ff6a1a'], [1, '#c02a0a']]); g.beginPath(); g.moveTo(fx - 0.9, fy); g.lineTo(fx - 0.9, fy - 1.1); g.arc(fx, fy - 1.1, 0.9, Math.PI, 0); g.lineTo(fx + 0.9, fy); g.closePath(); g.fill();
  g.fillStyle = '#ffe2a0'; g.globalAlpha = 0.7; g.beginPath(); g.ellipse(fx, fy - 0.4, 0.55, 0.25, 0, 0, TAU); g.fill(); g.globalAlpha = 1;
  // a crucible pouring a molten stream (stream is animated)
  g.fillStyle = '#3a3438'; g.beginPath(); g.moveTo(cx - 0.6, -3.6); g.lineTo(cx + 0.5, -3.6); g.lineTo(cx + 0.35, -2.9); g.lineTo(cx - 0.45, -2.9); g.closePath(); g.fill();
  g.fillStyle = '#ff8a2a'; g.fillRect(cx - 0.5, -3.62, 0.95, 0.07);
  // the gantry crane spanning the yard
  const gy = -4.4;
  for (const x of [b.x0 - 1.6, b.x1 + 1.2]) truss(g, x, gy, x + 0.45, bottom, '#2c2c34', 'rgba(255,150,70,0.25)');
  truss(g, K.x0, gy, K.x1, gy + 0.55, '#33333c', 'rgba(255,150,70,0.35)');
  g.fillStyle = '#4a4a52'; g.fillRect(cx - 4.6, gy + 0.55, 1.3, 0.45); g.fillStyle = '#f0b828'; g.fillRect(cx - 4.6, gy + 0.55, 1.3, 0.08);
  // the flywheel's axle housing (wheel itself is animated)
  const gw = GEAR(b); g.fillStyle = '#26262c'; g.beginPath(); g.moveTo(gw.x - 0.6, gw.y + gw.r + 0.6); g.lineTo(gw.x - 0.25, gw.y); g.lineTo(gw.x + 0.25, gw.y); g.lineTo(gw.x + 0.6, gw.y + gw.r + 0.6); g.closePath(); g.fill();
  // hanging chains
  g.strokeStyle = '#55555c'; g.lineWidth = 0.05; g.setLineDash([0.09, 0.05]);
  for (const [x, l] of [[cx - 7.2, 2.4], [cx - 6.6, 1.6], [cx + 1.6, 2.1], [b.x1 + 0.4, 3]]) { g.beginPath(); g.moveTo(x, gy + 0.55); g.lineTo(x, gy + 0.55 + l); g.stroke(); }
  g.setLineDash([]);
}
const PISTONS = (b, wy = -1.6) => [{ x: b.x0 - 3.7, y: wy + 4.8 }, { x: b.x0 - 3.7, y: wy + 12.1 }, { x: b.x1 + 3.7, y: wy + 7.8 }, { x: b.x1 + 3.7, y: wy + 15 }];
const GEAR = (b) => ({ x: (b.x0 + b.x1) / 2 - 5.2, y: -2.6, r: 1.9 });

// ---------- rim: steel deck, hazard stripes, grates, conveyor ----------
function rim(g, K) {
  const b = K.b, R = rnd(61), F = 0.7, ox0 = b.x0 - F, oy0 = b.y0 - F, ox1 = b.x1 + F, oy1 = b.y1 + F;
  // diamond-plate deck: a frame of plates around the board, fading into the hall at the outer edge
  const deck = (x, y, w, h) => { for (let yy = y; yy < y + h - 0.01; yy += 1) for (let xx = x; xx < x + w - 0.01; xx += 1) plate(g, xx, yy, Math.min(1, x + w - xx), Math.min(1, y + h - yy), R); };
  deck(ox0 - 2, oy0 - 1.6, ox1 - ox0 + 4, 1.6);
  deck(ox0 - 2, oy0, 2, oy1 - oy0);
  deck(ox1, oy0, 2, oy1 - oy0);
  deck(K.x0 + 3, oy1, K.x1 - K.x0 - 6, K.y1 - oy1);
  // feather the deck's outer edges into the hall
  g.globalCompositeOperation = 'destination-out';
  const fe = (x0, y0, x1, y1, rx, ry, rw, rh) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = gr; g.fillRect(rx, ry, rw, rh); };
  fe(0, oy0 - 0.8, 0, oy0 - 1.65, K.x0, oy0 - 1.7, K.x1 - K.x0, 0.9);
  fe(ox0 - 1.2, 0, ox0 - 2.05, 0, K.x0, oy0 - 1.7, ox0 - 1.2 - K.x0, K.y1 - oy0 + 2);
  fe(ox1 + 1.2, 0, ox1 + 2.05, 0, ox1 + 1.2, oy0 - 1.7, K.x1 - ox1, K.y1 - oy0 + 2);
  g.globalCompositeOperation = 'source-over';
  // hazard stripes right outside the board frame
  stripes(g, ox0 - 0.32, oy0 - 0.32, ox1 - ox0 + 0.64, 0.26); stripes(g, ox0 - 0.32, oy1 + 0.06, ox1 - ox0 + 0.64, 0.26);
  stripes(g, ox0 - 0.32, oy0 - 0.06, 0.26, oy1 - oy0 + 0.12); stripes(g, ox1 + 0.06, oy0 - 0.06, 0.26, oy1 - oy0 + 0.12);
  // floor grates glowing from the furnace below
  for (const [x, y] of [[ox0 - 1.55, 3], [ox0 - 1.55, 11.5], [ox1 + 0.55, 7.5], [ox1 + 0.55, 14.2], [3, oy0 - 1.35], [11.5, oy0 - 1.35]]) grate(g, K, x, y);
  // conveyor below the board, running the full width
  const cy = oy1 + 1.05, ch = 0.9;
  g.fillStyle = '#121214'; g.fillRect(K.x0, cy - 0.12, K.x1 - K.x0, ch + 0.3);
  g.fillStyle = K.lin(g, 0, cy, 0, cy + ch, [[0, '#3a3a40'], [0.15, '#2a2a2e'], [0.85, '#1c1c20'], [1, '#0e0e10']]); g.fillRect(K.x0, cy, K.x1 - K.x0, ch);
  g.fillStyle = '#5a5a62'; g.fillRect(K.x0, cy - 0.12, K.x1 - K.x0, 0.1); g.fillRect(K.x0, cy + ch, K.x1 - K.x0, 0.12);
  g.fillStyle = 'rgba(255,200,140,0.25)'; g.fillRect(K.x0, cy - 0.12, K.x1 - K.x0, 0.025);
  for (let x = K.x0 + 0.5; x < K.x1; x += 2.4) { g.fillStyle = '#2a2a30'; g.fillRect(x, cy + ch + 0.12, 0.25, 1.4); } // legs
  // second belt further down (desktop shows it), plus a tool bench
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(K.x0, cy + ch + 1.6, K.x1 - K.x0, 0.12);
  // light pooling from the conveyor's work lamps
  g.globalCompositeOperation = 'lighter';
  for (let x = b.x0 + 2; x < b.x1; x += 6) { g.fillStyle = K.rad(g, x, cy - 0.3, 0, 2.2, [[0, 'rgba(255,170,90,0.22)'], [1, 'rgba(255,120,50,0)']]); g.fillRect(x - 2.2, cy - 2.5, 4.4, 4.4); }
  g.globalCompositeOperation = 'source-over';
  // welding rig at the bottom right corner (sparks animated)
  const wx = ox1 + 1.2, wy = oy1 + 0.2; g.fillStyle = '#2c2c32'; g.fillRect(wx - 0.2, wy - 0.1, 0.4, 0.9); g.fillStyle = '#f0b828'; g.fillRect(wx - 0.2, wy - 0.1, 0.4, 0.08);
  g.strokeStyle = '#3a3a42'; g.lineWidth = 0.12; g.lineCap = 'round'; g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx - 0.6, wy - 0.5); g.lineTo(wx - 1.05, wy - 0.15); g.stroke();
  // crates of cast pieces in the corners
  for (const [x, y] of [[ox0 - 1.65, oy0 - 1.4], [ox1 + 0.45, oy0 - 1.35]]) { riveted(g, x, y, 1.2, 1.05, null, '#5a4632'); }
}
function plate(g, x, y, w, h, R) {
  const c = mixH('#34343a', '#2a2a2e', R()); g.fillStyle = c; g.fillRect(x + 0.02, y + 0.02, w - 0.04, h - 0.04);
  g.fillStyle = 'rgba(255,255,255,0.07)'; // diamond tread
  for (let yy = y + 0.12; yy < y + h - 0.08; yy += 0.2) for (let xx = x + 0.1 + ((yy - y) * 5 % 2 < 1 ? 0 : 0.1); xx < x + w - 0.08; xx += 0.2) { g.save(); g.translate(xx, yy); g.rotate(0.6); g.fillRect(-0.05, -0.012, 0.1, 0.024); g.restore(); }
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, y + h - 0.03, w, 0.03); g.fillRect(x + w - 0.03, y, 0.03, h);
  g.fillStyle = 'rgba(190,190,200,0.35)'; for (const [a, c2] of [[0.08, 0.08], [w - 0.12, 0.08], [0.08, h - 0.12], [w - 0.12, h - 0.12]]) g.fillRect(x + a, y + c2, 0.04, 0.04);
  if (R() < 0.25) { g.fillStyle = 'rgba(120,70,40,0.2)'; g.beginPath(); g.ellipse(x + R() * w, y + R() * h, 0.3, 0.15, 0, 0, TAU); g.fill(); }
}
function stripes(g, x, y, w, h) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#1a1a1a'; g.fillRect(x, y, w, h); g.fillStyle = '#e8b224';
  const s = 0.36;
  g.beginPath();
  for (let t = -h - s; t < w + s; t += s) { g.moveTo(x + t, y + h); g.lineTo(x + t + h, y); g.lineTo(x + t + h + s / 2, y); g.lineTo(x + t + s / 2, y + h); g.closePath(); }
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + h - 0.04, w, 0.04);
  g.restore();
}
function grate(g, K, x, y) {
  g.fillStyle = K.rad(g, x + 0.5, y + 0.4, 0, 0.8, [[0, '#ffb050'], [0.5, '#c0441a'], [1, '#2a1410']]); g.fillRect(x, y, 1, 0.8);
  g.fillStyle = '#26262c'; for (let i = 0; i <= 5; i++) g.fillRect(x + i * 0.19, y, 0.06, 0.8); g.fillRect(x, y, 1, 0.06); g.fillRect(x, y + 0.74, 1, 0.06);
}

// ---------- animation ----------
function farAnim(ctx, K) {
  const T = K.T, b = K.b, puff = K.glow('#5a504c'), dy = DY(K);
  for (const s0 of STACKS(b)) {
    const s = { ...s0, top: s0.top + dy };
    if (s.x < K.x0 - 3 || s.x > K.x1 + 1) continue;
    for (let i = 0, n = K.n(5); i < n; i++) { // smoke billowing up and drifting right
      const f = (T * 0.09 + i / n + s.x * 0.37) % 1, r = 0.35 + f * 1.6;
      ctx.globalAlpha = (1 - f) * 0.55; ctx.drawImage(puff, s.x + f * f * 2.6 - r, s.top - f * 3.4 - r, r * 2, r * 2);
    }
    // aircraft beacon: steady glow under reduced motion, a slow blink otherwise
    const on = K.reduced ? 0.6 : Math.max(0, Math.sin(T * 2.2 + s.x)) ** 4;
    ctx.globalAlpha = 0.25 + on * 0.75; ctx.fillStyle = '#ff3a2a'; ctx.fillRect(s.x - 0.05, s.top - 0.18, 0.1, 0.1);
    if (on > 0.2 && !K.lowQ) { ctx.globalAlpha = on * 0.5; ctx.drawImage(K.glow('#ff3a2a'), s.x - 0.5, s.top - 0.63, 1, 1); }
  }
  ctx.globalAlpha = 1;
}
function gearSprite(K) {
  return K.sprite('works-gear', 256, 256, (g, w) => {
    const c = w / 2, R = c * 0.86, teeth = 16;
    g.translate(c, c); g.fillStyle = '#3c3c44'; g.beginPath();
    for (let i = 0; i < teeth * 2; i++) { const a0 = (i / (teeth * 2)) * TAU, r = i % 2 ? R * 0.86 : R; g.arc(0, 0, r, a0, a0 + TAU / (teeth * 2)); }
    g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.beginPath(); g.ellipse(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, R * 0.16, R * 0.12, a, 0, TAU); g.fill(); } g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#6a6a74'; g.lineWidth = w * 0.02; g.beginPath(); g.arc(0, 0, R * 0.78, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, R * 0.25, 0, TAU); g.stroke();
    g.fillStyle = '#26262c'; g.beginPath(); g.arc(0, 0, R * 0.18, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,170,90,0.5)'; g.lineWidth = w * 0.012; g.beginPath(); g.arc(0, 0, R * 0.97, -2.2, -0.6); g.stroke(); // furnace rim light
  });
}
function midAnim(ctx, K) {
  const T = K.T, b = K.b, cx = (b.x0 + b.x1) / 2;
  // flywheel
  const gw = GEAR(b);
  if (!K.hidden(gw.x - gw.r, gw.y - gw.r, gw.x + gw.r, gw.y + gw.r)) { ctx.save(); ctx.translate(gw.x, gw.y); ctx.rotate(T * 0.35); ctx.drawImage(gearSprite(K), -gw.r, -gw.r, gw.r * 2, gw.r * 2); ctx.restore(); }
  // pistons pumping out of their housings
  for (const [i, p] of PISTONS(b, WY(K)).entries()) {
    if (K.hidden(p.x - 0.6, p.y - 2.5, p.x + 0.6, p.y + 1.6)) continue;
    const s = 0.5 + 0.5 * Math.sin(T * 2.6 + i * 1.7), top = p.y - 0.22 - 0.4 - s * 1.5;
    ctx.fillStyle = '#8a8a94'; ctx.fillRect(p.x - 0.1, top, 0.2, p.y - 0.22 - top);
    ctx.fillStyle = '#c8c8d0'; ctx.fillRect(p.x - 0.04, top, 0.05, p.y - 0.22 - top);
    ctx.fillStyle = '#4a4a54'; ctx.fillRect(p.x - 0.42, top - 0.3, 0.84, 0.32); ctx.fillStyle = '#f0b828'; ctx.fillRect(p.x - 0.42, top - 0.3, 0.84, 0.06);
    if (s < 0.12 && !K.lowQ) { ctx.globalAlpha = (0.12 - s) * 4; ctx.drawImage(K.glow('#cfc8c0'), p.x - 0.8, p.y - 0.9, 1.6, 1.2); ctx.globalAlpha = 1; } // steam vent at the bottom of the stroke
  }
  // molten pour from the crucible
  const fl = K.reduced ? 0.8 : 0.85 + 0.15 * Math.sin(T * 9);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(255,${150 + 60 * fl | 0},60,0.9)`; ctx.fillRect(cx + 0.24, -2.95, 0.09 * fl, 1.85);
  ctx.globalAlpha = 0.5; ctx.drawImage(K.glow(HOT), cx - 0.6, -1.7, 1.7, 1.2); ctx.globalAlpha = 1;
  // furnace breathing
  const fx = cx + 4.6, br = K.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(T * 1.3);
  ctx.globalAlpha = 0.18 + br * 0.15; ctx.drawImage(K.glow(HOT), fx - 2.4, -3.8, 4.8, 4.2); ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // the crane trolley carrying a cast-iron rook back and forth over the yard
  const tx = cx - 4 + Math.sin(T * 0.18) * 6, gy = -4.4;
  ctx.fillStyle = '#4a4a52'; ctx.fillRect(tx - 0.65, gy + 0.55, 1.3, 0.42); ctx.fillStyle = '#f0b828'; ctx.fillRect(tx - 0.65, gy + 0.55, 1.3, 0.07);
  const sw = K.reduced ? 0 : Math.cos(T * 0.18) * 0.08;
  ctx.save(); ctx.translate(tx, gy + 0.97); ctx.rotate(sw);
  ctx.strokeStyle = '#6a6a72'; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.moveTo(-0.15, 0); ctx.lineTo(-0.15, 1.3); ctx.moveTo(0.15, 0); ctx.lineTo(0.15, 1.3); ctx.stroke();
  ctx.drawImage(rookSprite(K), -0.7, 1.15, 1.4, 1.75);
  ctx.restore();
  // sparks falling from the crucible lip
  sparks(ctx, K, cx + 0.3, -2.95, 10, 1.1, 0.4, 61);
}
function rookSprite(K) {
  return K.sprite('works-rook', 96, 120, (g, w, h) => {
    g.scale(w / 1.4, h / 1.75); g.translate(0.7, 0);
    statue(g, { x: 0, base: 1.72, h: 1.6, type: 'rook', seed: 9, light: 1, dark: '#141418', mid: '#3a3a44', lite: '#9a9aa6', rim: 'rgba(255,160,80,0.8)', cracks: false });
  });
}
function pawnSprite(K, hot) {
  return K.sprite('works-pawn' + (hot ? 'h' : ''), 64, 80, (g, w, h) => {
    g.scale(w / 0.8, h / 1); g.translate(0.4, 0);
    statue(g, hot ? { x: 0, base: 0.98, h: 0.9, type: 'pawn', seed: 3, light: 1, dark: '#7a1a08', mid: '#e0541a', lite: '#ffd27a', cracks: false }
      : { x: 0, base: 0.98, h: 0.9, type: 'pawn', seed: 3, light: 1, dark: '#141418', mid: '#3c3c46', lite: '#a8a8b4', rim: 'rgba(255,170,90,0.7)', cracks: false });
  });
}
// deterministic spark shower: n sparks from (x, y), spread sp, lifetime life seconds
function sparks(ctx, K, x, y, n, life, sp, seed) {
  if (K.hidden(x - 2, y - 1, x + 2, y + 3)) return;
  const T = K.T, R = rnd(seed); n = K.n(n);
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineWidth = 0.04;
  for (let i = 0; i < n; i++) {
    const ph = R(), vx = (R() - 0.5) * sp * 3, vy = -R() * 1.6, cyc = life * (0.7 + R() * 0.6);
    const t = ((T + ph * cyc) % cyc), k = t / cyc, px = x + vx * t, py = y + vy * t + 4.5 * t * t;
    ctx.strokeStyle = k < 0.4 ? HOTLITE : HOT; ctx.globalAlpha = 1 - k;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - vx * 0.04, py - (vy + 9 * t) * 0.04); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function rimAnim(ctx, K) {
  const T = K.T, b = K.b, oy1 = b.y1 + 0.7, cy = oy1 + 1.05, ch = 0.9, v = K.reduced ? 0.25 : 0.7;
  if (!K.hidden(K.x0, cy, K.x1, cy + ch)) {
    // belt cleats sliding right
    ctx.fillStyle = 'rgba(90,90,100,0.9)'; ctx.beginPath();
    const off = (T * v) % 0.5; for (let x = Math.floor(K.x0 * 2) / 2 + off; x < K.x1; x += 0.5) ctx.rect(x, cy + 0.04, 0.05, ch - 0.08);
    ctx.fill();
    // fresh pawns riding the belt (every fourth one still glowing from the mould)
    const sp = 2.2, ph = (T * v) % sp;
    for (let x = Math.floor(K.x0 / sp) * sp + ph - sp, i = Math.floor(K.x0 / sp) - 1; x < K.x1 + 1; x += sp, i++) ctx.drawImage(pawnSprite(K, ((i % 4) + 4) % 4 === 0), x - 0.42, cy - 0.62, 0.84, 1.05);
  }
  // welding sparks at the corner rig
  sparks(ctx, K, b.x1 + 0.7 + 0.15, oy1 + 0.05, 14, 0.8, 0.8, 7);
  if (!K.lowQ && !K.reduced) { const f = Math.max(0, Math.sin(T * 23) * Math.sin(T * 7.3)); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 + f * 0.5; ctx.drawImage(K.glow('#bfe4ff'), b.x1 + 0.35, oy1 - 0.35, 1, 0.8); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  // grates pulsing with the furnace below
  const pul = K.reduced ? 0.4 : 0.4 + 0.3 * Math.sin(T * 1.3);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pul * 0.5;
  const gl = K.glow(HOT);
  for (const [x, y] of [[b.x0 - 2.25, 3], [b.x0 - 2.25, 11.5], [b.x1 + 1.25, 7.5], [b.x1 + 1.25, 14.2], [3, b.y0 - 2.05], [11.5, b.y0 - 2.05]]) ctx.drawImage(gl, x - 0.4, y - 0.5, 1.8, 1.8);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

export default {
  id: 'works',
  base: '#1a1716',
  light: { tint: ['#fff0dc', '#ffe6cc'], glow: ['b', '#ff8a30', 0.12] },
  layers: [
    { p: 0.04, res: 0.5, paint: sky },
    { p: 0.2, res: 0.7, paint: far, anim: farAnim },
    { p: 0.5, res: 0.85, paint: mid, anim: midAnim },
    { p: 1, r: 5, res: 0.85, paint: rim, anim: rimAnim },
  ],
};

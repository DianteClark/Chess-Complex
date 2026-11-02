// E2 15.0: Desert Ruins. A buried kingdom of giant stone chess pieces under a low, swollen sun; dunes, heat haze, sand gusts.
// Contract: js/backdrop.js (E1). Units are board tiles; the board covers K.b.
import { ramp, statue, dune, rnd, grab, shimmer, streak, mixH, shadeH, rgbaH, TAU_ as TAU } from './e2kit.js';

const SKY = ramp([[-16, '#2a1410'], [-10, '#5e2a18'], [-6.5, '#a8502a'], [-4.4, '#e48a3c'], [-3.3, '#f8c47a'], [-3.1, '#e9a964'], [-2, '#c98a4c'], [8, '#a86a36'], [30, '#6e4222']]);
const SAND = { lite: '#f1c27e', mid: '#d79a58', dark: '#9a6034', deep: '#6e4024' };
const STONE = { lite: '#f6dcae', mid: '#c99a68', dark: '#6e4a32' };
const SUN = (b) => ({ x: (b.x0 + b.x1) / 2 + 3.6, y: -4.35, r: 1.05 });
let FAR = null; // grabbed far layer (heat haze slices)
// E1's suggested horizon: portrait keeps the authored layout (dy 0); wide screens drop sky + far + mid by dy so the open
// sides show sky above the dunes (the authored horizon sits at about y -3, E1's portrait hz is -2.4)
const DY = (K) => (K.hz == null ? 0 : K.hz + 2.4);

function sky(g, K) {
  const dy = DY(K); g.save(); g.translate(0, dy); K = { ...K, y0: K.y0 - dy, y1: K.y1 - dy };
  g.fillStyle = SKY.grad(g, K.y0, K.y1); g.fillRect(K.x0, K.y0, K.x1 - K.x0, K.y1 - K.y0);
  const R = rnd(11), sun = SUN(K.b);
  g.globalCompositeOperation = 'lighter'; // the sun's bloom washes the whole upper sky
  g.fillStyle = K.rad(g, sun.x, sun.y, 0, 16, [[0, 'rgba(255,190,110,0.35)'], [0.35, 'rgba(255,120,60,0.12)'], [1, 'rgba(255,90,40,0)']]); g.fillRect(K.x0, K.y0, K.x1 - K.x0, K.y1 - K.y0);
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 26; i++) { // long thin high cloud streaks catching the sunset
    const x = K.x0 + R() * (K.x1 - K.x0), y = -14 + R() * 9, w = 2 + R() * 6, a = 0.06 + R() * 0.14;
    g.fillStyle = rgbaH(R() < 0.5 ? '#ffd29a' : '#ff9a5a', a); g.beginPath(); g.ellipse(x, y, w, 0.06 + R() * 0.1, (R() - 0.5) * 0.04, 0, TAU); g.fill();
  }
  g.restore();
}

function far(g, K) {
  const dy = DY(K), K0 = K; g.save(); g.translate(0, dy); K = { ...K, y0: K.y0 - dy, y1: K.y1 - dy };
  const b = K.b, cx = (b.x0 + b.x1) / 2, R = rnd(23), sun = SUN(b), bottom = K.y1;
  // opaque sky backing from y -5.6 down so the haze slices can be re-drawn without double alpha (fades in above)
  g.fillStyle = SKY.grad(g, -7, -5.6, 1); g.globalAlpha = 1;
  const fade = g.createLinearGradient(0, -7.2, 0, -5.6); fade.addColorStop(0, rgbaH(SKY.at(-7.2), 0)); fade.addColorStop(1, rgbaH(SKY.at(-5.6), 1));
  g.fillStyle = fade; g.fillRect(K.x0, -7.2, K.x1 - K.x0, 1.6);
  g.fillStyle = SKY.grad(g, -5.6, bottom); g.fillRect(K.x0, -5.6, K.x1 - K.x0, bottom + 5.6);
  // the sun: a hot disc sinking into the haze, with banded atmosphere across it
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = K.rad(g, sun.x, sun.y, 0, 5, [[0, 'rgba(255,230,170,0.65)'], [0.3, 'rgba(255,170,90,0.25)'], [1, 'rgba(255,120,60,0)']]); g.fillRect(sun.x - 5, sun.y - 5, 10, 10);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = K.rad(g, sun.x, sun.y, sun.r * 0.6, sun.r, [[0, '#fff6dc'], [0.8, '#ffe2a2'], [1, 'rgba(255,214,150,0)']]); g.beginPath(); g.arc(sun.x, sun.y, sun.r, 0, TAU); g.fill();
  g.fillStyle = 'rgba(214,110,60,0.22)'; for (let i = 0; i < 4; i++) g.fillRect(sun.x - 1.3, sun.y + 0.15 + i * 0.22, 2.6, 0.05 + i * 0.015);
  // far mesas
  const mesaC = mixH(SKY.at(-3.4), '#7a3a26', 0.32);
  g.fillStyle = mesaC;
  for (let x = K.x0 - 2; x < K.x1 + 2; x += 3 + R() * 5) {
    const w = 1.2 + R() * 3.5, h = 0.3 + R() * 0.9, top = -3.15 - h, sl = 0.25 + R() * 0.3;
    g.beginPath(); g.moveTo(x - sl, -3.05); g.lineTo(x, top + 0.08); g.lineTo(x + 0.15, top); g.lineTo(x + w - 0.1, top); g.lineTo(x + w, top + 0.1); g.lineTo(x + w + sl * 1.4, -3.05); g.closePath(); g.fill();
  }
  g.fillStyle = mixH(SKY.at(-3.2), '#8a4a2c', 0.22); K.fillRidge(g, K.ridge({ x0: K.x0, x1: K.x1, y: -3.12, amp: 0.18, seed: 4, step: 0.5, rough: 0.5 }), bottom);
  // distant buried chess pieces, hazy
  const haze = mixH(SKY.at(-3.6), '#7d4630', 0.45), types = ['rook', 'king', 'pawn', 'bishop', 'rook', 'queen', 'pawn'];
  const spots = [-12, -7.5, 1.2, 6.2, 14.8, 21, 26, 31].map((d) => cx + d);
  spots.forEach((x, i) => { const h = 1.1 + R() * 1.6; statue(g, { x, base: -2.95, h, type: types[i % types.length], seed: 40 + i, broken: R() < 0.6 ? 0.15 + R() * 0.35 : 0, lean: (R() - 0.5) * 0.25, mid: haze, flat: true }); });
  // two rows of near-far dunes
  const d1 = ramp([[-3, '#e7ab66'], [-1, '#c38246']]);
  g.fillStyle = d1.grad(g, -3, bottom); K.fillRidge(g, K.ridge({ x0: K.x0, x1: K.x1, y: -2.62, amp: 0.4, seed: 7, step: 0.45, rough: 0.42 }), bottom);
  g.fillStyle = 'rgba(255,226,170,0.35)'; for (let i = 0; i < 9; i++) { const x = K.x0 + R() * (K.x1 - K.x0); g.beginPath(); g.ellipse(x, -2.48 + R() * 0.2, 1 + R() * 2, 0.04, 0, 0, TAU); g.fill(); }
  g.restore();
  if (!K.preview) FAR = grab(g, K0); // the wheel's card previews paint this layer small: keep the in-game one
}

function mid(g, K) {
  const dy = DY(K); g.save(); g.translate(0, dy); K = { ...K, y0: K.y0 - dy, y1: K.y1 - dy };
  const b = K.b, cx = (b.x0 + b.x1) / 2, R = rnd(31), bottom = K.y1;
  // rolling dunes behind the hero ruins and flanking the board
  const L = SAND.lite, D = SAND.dark;
  dune(g, { x0: K.x0, x1: cx - 3, px: b.x0 - 3, y: -1.2, hgt: 1.1, bottom, lite: L, dark: SAND.mid, crest: 'rgba(255,240,200,0.55)', lee: 'rgba(110,58,60,0.42)' });
  dune(g, { x0: cx - 6, x1: K.x1, px: b.x1 + 2.5, y: -1.1, hgt: 1.4, bottom, lite: L, dark: SAND.mid, crest: 'rgba(255,240,200,0.55)', lee: 'rgba(110,58,60,0.42)' });
  dune(g, { x0: cx - 5, x1: cx + 7, px: cx + 1.5, y: -1.05, hgt: 0.55, bottom, lite: '#eab676', dark: SAND.mid, crest: 'rgba(255,240,200,0.4)', lee: 'rgba(110,58,60,0.35)' });
  // flank dunes (seen in landscape / desktop)
  for (const side of [-1, 1]) {
    const ex = side < 0 ? b.x0 : b.x1;
    for (let i = 0; i < 4; i++) {
      const y = 2 + i * 4.2 + R() * 1.5, px = ex + side * (2.5 + R() * 3);
      dune(g, { x0: px - 3 - R() * 2, x1: px + 3 + R() * 2, px, y, hgt: 0.8 + R() * 0.9, bottom, lite: mixH(L, D, 0.08 * i), dark: mixH(SAND.mid, D, 0.15 * i), crest: 'rgba(255,240,200,0.45)', lee: 'rgba(110,58,60,0.45)' });
    }
  }
  // near ground below the board (matches the rim's foreground so its feathered ends blend)
  { const oy1 = b.y1 + 0.7, fg = g.createLinearGradient(0, oy1, 0, K.y1); fg.addColorStop(0, SAND.mid); fg.addColorStop(0.5, SAND.dark); fg.addColorStop(1, SAND.deep); g.fillStyle = fg; g.fillRect(K.x0, oy1, K.x1 - K.x0, K.y1 - oy1); }
  // long cool shadows thrown away from the low sun (to the left)
  g.fillStyle = 'rgba(96,52,58,0.28)';
  for (const [x, y, h] of [[b.x0 + 2.6, -0.95, 5.2], [b.x1 - 2.7, -0.9, 3.8], [cx + 0.6, -1.05, 2.3], [b.x0 - 3.2, 4.2, 6.5], [b.x1 + 3.6, 6.5, 7.4], [b.x0 - 4.2, 13.5, 3.8], [b.x1 + 3.4, 14.5, 3.1]]) { g.beginPath(); g.ellipse(x - h * 0.45, y + 0.12, h * 0.55, 0.28 + h * 0.03, 0.05, 0, TAU); g.fill(); }
  // the hero ruins above the board: a colossal snapped King, a toppled bishop, a leaning rook with a sand spill
  const stone = (k) => ({ dark: shadeH(STONE.dark, -k), mid: shadeH(STONE.mid, -k), lite: shadeH(STONE.lite, -k * 0.6), rim: 'rgba(255,236,190,0.55)' });
  statue(g, { x: b.x0 + 2.6, base: -0.95, h: 5.2, type: 'king', seed: 3, broken: 0.24, lean: -0.05, light: 1, ...stone(0) });
  statue(g, { x: b.x1 - 2.7, base: -0.9, h: 3.8, type: 'rook', seed: 5, broken: 0.12, lean: 0.07, light: 1, ...stone(0.04) });
  statue(g, { x: cx + 0.6, base: -1.05, h: 2.3, type: 'pawn', seed: 8, broken: 0, lean: 0.03, light: 1, ...stone(0.1) });
  // a colonnade between them: three columns, one with its lintel
  const colC = stone(0.12);
  for (const [x, h] of [[cx - 3.1, 2.6], [cx - 1.9, 2.9], [cx + 3.2, 1.6]]) column(g, x, -1.1, h, 0.32, colC, R);
  g.fillStyle = colC.mid; g.fillRect(cx - 3.55, -1.1 - 2.6 - 0.24, 2.1, 0.26); g.fillStyle = colC.lite; g.fillRect(cx - 3.55, -1.1 - 2.6 - 0.24, 2.1, 0.06);
  // flank towers
  statue(g, { x: b.x0 - 3.2, base: 4.2, h: 6.5, type: 'rook', seed: 13, broken: 0.3, lean: -0.04, ...stone(0.05) });
  statue(g, { x: b.x1 + 3.6, base: 6.5, h: 7.4, type: 'queen', seed: 17, broken: 0.36, lean: 0.06, ...stone(0.02) });
  statue(g, { x: b.x0 - 4.2, base: 13.5, h: 3.8, type: 'bishop', seed: 19, broken: 0.2, lean: 0.1, ...stone(0.08) });
  statue(g, { x: b.x1 + 3.4, base: 14.5, h: 3.1, type: 'pawn', seed: 21, lean: -0.08, ...stone(0.08) });
  // sand piled against every base
  g.fillStyle = SAND.lite;
  for (const [x, y, w] of [[b.x0 + 2.6, -0.95, 2.2], [b.x1 - 2.7, -0.9, 1.8], [cx + 0.6, -1.05, 1.1], [b.x0 - 3.2, 4.2, 2.6], [b.x1 + 3.6, 6.5, 3], [b.x0 - 4.2, 13.5, 1.8], [b.x1 + 3.4, 14.5, 1.5], [cx - 2.5, -1.1, 2]]) {
    const gr = g.createLinearGradient(0, y - 0.4, 0, y + 0.3); gr.addColorStop(0, SAND.lite); gr.addColorStop(1, SAND.mid); g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, y + 0.05, w, 0.38, 0, Math.PI, TAU); g.lineTo(x + w, y + 0.6); g.lineTo(x - w, y + 0.6); g.fill();
  }
  g.restore();
}

function column(g, x, base, h, w, c, R) {
  const gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, c.dark); gr.addColorStop(0.4, c.mid); gr.addColorStop(0.75, c.lite); gr.addColorStop(1, c.mid);
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(x - w, base); g.lineTo(x - w * 0.88, base - h); g.lineTo(x - w * 0.5, base - h - 0.05 - R() * 0.1); g.lineTo(x, base - h + 0.04); g.lineTo(x + w * 0.88, base - h - 0.08); g.lineTo(x + w, base); g.closePath(); g.fill();
  g.strokeStyle = rgbaH(c.dark, 0.4); g.lineWidth = 0.025;
  for (const f of [-0.45, 0, 0.45]) { g.beginPath(); g.moveTo(x + f * w, base); g.lineTo(x + f * w * 0.9, base - h + 0.1); g.stroke(); }
  g.fillStyle = c.mid; g.fillRect(x - w * 1.25, base - 0.16, w * 2.5, 0.16);
}

function rim(g, K) {
  const b = K.b, R = rnd(57), F = 0.7, ox0 = b.x0 - F, oy0 = b.y0 - F, ox1 = b.x1 + F, oy1 = b.y1 + F, cx = (b.x0 + b.x1) / 2;
  // sand apron: solid near the board, fading out into the mid-ground dunes at the sides and top
  const apron = (x, y, w, h, dir) => {
    const gr = dir === 't' ? g.createLinearGradient(0, y + h, 0, y) : dir === 'l' ? g.createLinearGradient(x + w, 0, x, 0) : dir === 'r' ? g.createLinearGradient(x, 0, x + w, 0) : null;
    if (gr) { gr.addColorStop(0, SAND.mid); gr.addColorStop(0.45, rgbaH(SAND.mid, 0.9)); gr.addColorStop(1, rgbaH(SAND.mid, 0)); g.fillStyle = gr; }
    g.fillRect(x, y, w, h);
  };
  const hz = K.hz == null ? -9 : K.hz, top = Math.max(oy0, hz - 0.3);
  if (hz < oy0) apron(ox0 - 4.5, oy0 - 1.4, ox1 - ox0 + 9, 1.4, 't');
  apron(K.x0, top, ox0 - K.x0, oy1 - top, 'l');
  apron(ox1, top, K.x1 - ox1, oy1 - top, 'r');
  if (top > oy0) { // wide: let the side aprons rise softly out of the dunes instead of a hard edge
    g.globalCompositeOperation = 'destination-out';
    const fe = g.createLinearGradient(0, top, 0, top + 1.6); fe.addColorStop(0, 'rgba(0,0,0,1)'); fe.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fe;
    g.fillRect(K.x0, top, ox0 - K.x0, 1.6); g.fillRect(ox1, top, K.x1 - ox1, 1.6);
    g.globalCompositeOperation = 'source-over';
  }
  // foreground ground below the board (near the camera: richer, darker, fully opaque)
  const fg = g.createLinearGradient(0, oy1, 0, K.y1); fg.addColorStop(0, SAND.mid); fg.addColorStop(0.5, SAND.dark); fg.addColorStop(1, SAND.deep);
  g.fillStyle = fg; g.fillRect(K.x0, oy1, K.x1 - K.x0, K.y1 - oy1);
  g.globalCompositeOperation = 'destination-out'; // feather its outer ends into the mid-ground
  for (const [a, z] of [[K.x0, K.x0 + 3], [K.x1, K.x1 - 3]]) { const fe = g.createLinearGradient(a, 0, z, 0); fe.addColorStop(0, 'rgba(0,0,0,1)'); fe.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fe; g.fillRect(Math.min(a, z), oy1, 3, K.y1 - oy1); }
  g.globalCompositeOperation = 'source-over';
  // excavated sandstone paving hugging the board frame, half swallowed by drifts
  slabs(g, R, ox0 - 1.2, oy0 - 1.05, ox1 - ox0 + 2.4, 1.05, 'h');
  slabs(g, R, ox0 - 1.2, oy1, ox1 - ox0 + 2.4, 1.2, 'h');
  slabs(g, R, ox0 - 1.2, oy0, 1.2, oy1 - oy0, 'v');
  slabs(g, R, ox1, oy0, 1.2, oy1 - oy0, 'v');
  // wind ripples over the open sand
  g.lineWidth = 0.035; g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const side = i % 3, x = side === 0 ? K.x0 + R() * (K.x1 - K.x0) : side === 1 ? K.x0 + R() * (ox0 - 1.3 - K.x0) : ox1 + 1.3 + R() * (K.x1 - ox1 - 1.3);
    const y = side === 0 ? oy1 + 1.4 + R() * (K.y1 - oy1 - 1.4) : top + 1 + R() * (oy1 - top - 1), w = 0.6 + R() * 1.3;
    g.strokeStyle = rgbaH(R() < 0.5 ? SAND.lite : SAND.dark, 0.35 + R() * 0.25);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 0.12 - R() * 0.1, x + w, y + (R() - 0.5) * 0.1); g.stroke();
  }
  // drifts spilling over the paving onto the frame edge
  for (let i = 0; i < 22; i++) {
    const t = R(), s = i % 4, x = s < 2 ? ox0 + t * (ox1 - ox0) : s === 2 ? ox0 - 0.5 : ox1 + 0.5, y = s === 0 ? oy0 - 0.5 : s === 1 ? oy1 + 0.5 : oy0 + t * (oy1 - oy0);
    const w = 0.8 + R() * 1.6, h = 0.3 + R() * 0.35, gr = g.createRadialGradient(x, y - h * 0.3, 0, x, y, w);
    gr.addColorStop(0, SAND.lite); gr.addColorStop(0.6, rgbaH(SAND.mid, 0.9)); gr.addColorStop(1, rgbaH(SAND.mid, 0));
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, w, s >= 2 ? w * 0.9 : h * 1.4, 0, 0, TAU); g.fill();
  }
  // broken column stubs at the corners
  for (const [x, y, h] of [[ox0 - 0.65, oy0 - 0.25, 1.5], [ox1 + 0.65, oy0 - 0.3, 2.1], [ox0 - 0.7, oy1 + 0.65, 0.9], [ox1 + 0.7, oy1 + 0.7, 1.2]]) stub(g, x, y, h, R);
  // a toppled giant knight head in the foreground, half buried
  knightHead(g, ox0 + 2.2, oy1 + 2.35, 1.55, R);
  // a fallen column drum and scattered blocks on the right
  drum(g, ox1 - 3.2, oy1 + 1.9, 1.5, 0.42);
  for (let i = 0; i < 18; i++) { const x = K.x0 + R() * (K.x1 - K.x0), y = oy1 + 1 + R() * (K.y1 - oy1 - 1); if (x > ox0 - 0.5 && x < ox1 + 0.5 && y < oy1 + 0.8) continue; rock(g, x, y, 0.08 + R() * 0.2, R); }
  for (let i = 0; i < 14; i++) { const side = i % 2, x = side ? ox1 + 1.6 + R() * 3.5 : ox0 - 1.6 - R() * 3.5, y = top + 1.2 + R() * (oy1 - top - 1.2); rock(g, x, y, 0.08 + R() * 0.18, R); }
  // a pale hint of footprints leading off into the sand
  g.fillStyle = rgbaH(SAND.dark, 0.35);
  for (let i = 0; i < 9; i++) { const x = cx + 4.2 + i * 0.42 + (i % 2) * 0.12, y = oy1 + 1.4 + i * 0.28; g.beginPath(); g.ellipse(x, y, 0.07, 0.11, 0.5, 0, TAU); g.fill(); }
}

function slabs(g, R, x, y, w, h, dir) {
  const n = Math.ceil((dir === 'h' ? w : h) / (0.9 + R() * 0.3));
  for (let i = 0; i < n; i++) {
    if (R() < 0.18) continue; // missing stones
    const t0 = i / n, t1 = (i + 1) / n - 0.02;
    const sx = dir === 'h' ? x + t0 * w : x + 0.06, sy = dir === 'h' ? y + 0.06 : y + t0 * h, sw = dir === 'h' ? (t1 - t0) * w : w - 0.12, sh = dir === 'h' ? h - 0.12 : (t1 - t0) * h;
    const c = mixH(STONE.mid, SAND.mid, 0.25 + R() * 0.3);
    const gr = g.createLinearGradient(sx, sy, sx + sw * 0.4, sy + sh); gr.addColorStop(0, shadeH(c, 0.18)); gr.addColorStop(1, shadeH(c, -0.12)); g.fillStyle = gr;
    g.fillRect(sx, sy, sw, sh);
    g.fillStyle = rgbaH(STONE.dark, 0.5); g.fillRect(sx, sy + sh - 0.05, sw, 0.05); g.fillRect(sx + sw - 0.04, sy, 0.04, sh);
    g.fillStyle = 'rgba(255,240,205,0.35)'; g.fillRect(sx, sy, sw, 0.03);
    if (R() < 0.45) { g.strokeStyle = rgbaH(STONE.dark, 0.6); g.lineWidth = 0.025; g.beginPath(); let px = sx + R() * sw, py = sy; g.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (R() - 0.5) * 0.3; py += sh / 4; g.lineTo(px, py); } g.stroke(); }
  }
}
function stub(g, x, y, h, R) {
  g.fillStyle = 'rgba(60,30,10,0.35)'; g.beginPath(); g.ellipse(x + 0.35, y + 0.08, 0.7, 0.2, 0, 0, TAU); g.fill();
  const w = 0.42, gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, STONE.dark); gr.addColorStop(0.4, STONE.mid); gr.addColorStop(0.78, STONE.lite); gr.addColorStop(1, STONE.mid);
  g.fillStyle = gr; g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w, y - h + 0.1); g.lineTo(x - w * 0.3, y - h - 0.12); g.lineTo(x + w * 0.2, y - h + 0.05); g.lineTo(x + w, y - h - 0.18); g.lineTo(x + w, y); g.ellipse(x, y, w, 0.14, 0, 0, Math.PI); g.closePath(); g.fill();
  g.fillStyle = STONE.lite; g.beginPath(); g.ellipse(x, y - h + 0.02, w * 0.95, 0.12, 0, 0, TAU); g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = rgbaH(STONE.dark, 0.4); g.lineWidth = 0.025; for (const f of [-0.6, -0.2, 0.2, 0.6]) { g.beginPath(); g.moveTo(x + f * w, y + 0.1); g.lineTo(x + f * w, y - h + 0.15); g.stroke(); }
  g.fillStyle = SAND.lite; g.beginPath(); g.ellipse(x - 0.1, y + 0.05, w * 1.6, 0.22, 0, Math.PI, TAU); g.fill();
}
function drum(g, x, y, len, r) {
  g.fillStyle = 'rgba(60,30,10,0.35)'; g.beginPath(); g.ellipse(x + 0.2, y + r * 0.9, len * 0.6, 0.18, 0, 0, TAU); g.fill();
  const gr = g.createLinearGradient(0, y - r, 0, y + r); gr.addColorStop(0, STONE.lite); gr.addColorStop(0.45, STONE.mid); gr.addColorStop(1, STONE.dark);
  g.fillStyle = gr; g.fillRect(x - len / 2, y - r, len, r * 2);
  g.strokeStyle = rgbaH(STONE.dark, 0.35); g.lineWidth = 0.025; for (const f of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(x - len / 2, y + f * r); g.lineTo(x + len / 2, y + f * r); g.stroke(); }
  g.fillStyle = shadeH(STONE.mid, 0.1); g.beginPath(); g.ellipse(x + len / 2, y, r * 0.35, r, 0, 0, TAU); g.fill();
  g.strokeStyle = rgbaH(STONE.dark, 0.5); g.beginPath(); g.ellipse(x + len / 2, y, r * 0.2, r * 0.6, 0, 0, TAU); g.stroke();
  g.fillStyle = SAND.lite; g.beginPath(); g.ellipse(x - len * 0.45, y + r * 0.6, 0.5, 0.25, 0, Math.PI, TAU); g.fill();
}
function rock(g, x, y, r, R) {
  g.fillStyle = 'rgba(70,35,12,0.3)'; g.beginPath(); g.ellipse(x + r * 0.5, y + r * 0.35, r * 1.3, r * 0.45, 0, 0, TAU); g.fill();
  g.fillStyle = mixH(STONE.mid, STONE.dark, R() * 0.5); g.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, rr = r * (0.75 + R() * 0.35); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7); }
  g.closePath(); g.fill(); g.fillStyle = 'rgba(255,236,200,0.35)'; g.beginPath(); g.ellipse(x - r * 0.2, y - r * 0.3, r * 0.45, r * 0.22, 0, 0, TAU); g.fill();
}
// the head of a colossal knight lying on its side, nose in the sand
function knightHead(g, x, y, s, R) {
  g.save(); g.translate(x, y); g.rotate(-0.35);
  g.fillStyle = 'rgba(60,30,10,0.4)'; g.beginPath(); g.ellipse(0.2 * s, 0.45 * s, 1.2 * s, 0.28 * s, 0.3, 0, TAU); g.fill();
  const P = [[-0.55, 0.4], [-0.62, -0.1], [-0.45, -0.55], [-0.2, -0.8], [-0.05, -1.05], [0.1, -0.78], [0.35, -0.7], [0.75, -0.4], [1.05, -0.05], [1.0, 0.2], [0.7, 0.22], [0.45, 0.05], [0.25, 0.35], [0.1, 0.45]];
  g.beginPath(); P.forEach(([a, b2], i) => (i ? g.lineTo(a * s, b2 * s) : g.moveTo(a * s, b2 * s))); g.closePath();
  const gr = g.createLinearGradient(-0.6 * s, -0.8 * s, 0.8 * s, 0.4 * s); gr.addColorStop(0, STONE.lite); gr.addColorStop(0.5, STONE.mid); gr.addColorStop(1, STONE.dark);
  g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(255,240,205,0.5)'; g.lineWidth = 0.03 * s; g.stroke();
  g.fillStyle = STONE.dark; g.beginPath(); g.ellipse(0.32 * s, -0.42 * s, 0.09 * s, 0.05 * s, -0.4, 0, TAU); g.fill(); // eye
  g.strokeStyle = rgbaH(STONE.dark, 0.7); g.lineWidth = 0.035 * s; g.beginPath(); g.moveTo(-0.4 * s, -0.5 * s); g.quadraticCurveTo(-0.1 * s, -0.2 * s, -0.25 * s, 0.25 * s); g.stroke(); // mane groove
  g.beginPath(); g.moveTo(0.75 * s, -0.05 * s); g.lineTo(0.9 * s, 0.05 * s); g.stroke(); // nostril
  g.restore();
  g.fillStyle = SAND.lite; g.beginPath(); g.ellipse(x + 0.5 * s, y + 0.38 * s, 1.1 * s, 0.32 * s, -0.1, Math.PI, TAU); g.fill();
}

// ---------- animation ----------
function hazeAnim(ctx, K) {
  if (K.lowQ || K.preview) return;
  const T = K.T, amp = K.reduced ? 0.02 : 0.05;
  const dy = DY(K);
  shimmer(ctx, FAR, K, -3.55 + dy, -2.15 + dy, K.reduced ? 7 : 12, (y, i) => Math.sin(T * 2.3 + y * 9) * amp * (0.4 + (i % 3) * 0.3));
  // mirage: a sliver of bright sky reflected on the hot sand
  ctx.globalCompositeOperation = 'lighter';
  const g = streak('#ffd9a0');
  for (let i = 0; i < 3; i++) { const x = ((i * 9.7 + T * 0.15) % 30) - 6 + K.x0, y = -2.55 + dy + i * 0.12; ctx.globalAlpha = 0.18 + 0.08 * Math.sin(T * 1.7 + i); ctx.drawImage(g, x, y - 0.05, 8, 0.1); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function midAnim(ctx, K) {
  // thin trickles of sand pouring from the snapped crowns
  const b = K.b, T = K.T, cx = (b.x0 + b.x1) / 2, dy = DY(K);
  ctx.fillStyle = 'rgba(244,206,140,0.75)';
  ctx.beginPath();
  for (const [x, y00, len] of [[b.x0 + 2.85, -4.2, 3.1], [b.x1 - 2.55, -3.55, 2.5], [b.x0 - 3, 0.2, 3.7]]) {
    const y0 = y00 + dy;
    if (K.hidden(x - 0.1, y0, x + 0.1, y0 + len)) continue;
    for (let i = 0; i < K.n(10); i++) { const f = ((T * 0.55 + i / 10) % 1), yy = y0 + f * f * len; ctx.rect(x + Math.sin(i * 7.1) * 0.05 + f * 0.08, yy, 0.03, 0.05); }
  }
  ctx.fill();
  if (!K.lowQ) { const g = K.glow('#ffe2a8'); ctx.globalAlpha = 0.12; ctx.drawImage(g, cx - 3.8, -3.6 + dy, 1.2, 1.2); ctx.globalAlpha = 1; }
}
function gustAnim(ctx, K) {
  const T = K.T, b = K.b, s = streak('#ffe1a8'), w = K.x1 - K.x0, h = K.y1 - K.y0, R = rnd(91);
  // sand gusts: long soft streaks racing right to left in waves, with grains skittering beneath
  const wave = K.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(T * 0.45);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0, n = K.n(16); i < n; i++) {
    const sp = (K.reduced ? 1.2 : 4.5) + R() * 3, len = 2.5 + R() * 4, y = K.y0 + R() * h, ph = R() * (w + 12);
    const x = K.x1 + 4 - ((ph + T * sp) % (w + 12));
    if (K.hidden(x, y - 0.1, x + len, y + 0.1)) continue;
    ctx.globalAlpha = (0.08 + R() * 0.12) * wave; ctx.drawImage(s, x, y - 0.05, len, 0.1 + R() * 0.08);
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,226,170,0.7)'; ctx.beginPath();
  for (let i = 0, n = K.n(46); i < n; i++) {
    const sp = (K.reduced ? 0.8 : 3) + R() * 4, y0 = K.y0 + R() * h, ph = R() * (w + 4);
    const x = K.x1 + 2 - ((ph + T * sp) % (w + 4)), y = y0 + Math.sin(T * 3 + i) * 0.12;
    if (x > b.x0 - 0.7 && x < b.x1 + 0.7 && y > b.y0 - 0.7 && y < b.y1 + 0.7) continue;
    ctx.rect(x, y, 0.045, 0.03);
  }
  ctx.fill();
}

export default {
  id: 'ruins',
  base: '#a86a36',
  light: { tint: ['#fff0d8', '#ffe2bf'], glow: ['t', '#ffb060', 0.16] },
  layers: [
    { p: 0.04, res: 0.5, paint: sky },
    { p: 0.22, res: 0.8, paint: far, anim: hazeAnim },
    { p: 0.55, res: 0.85, paint: mid, anim: midAnim },
    { p: 1, r: 5, res: 0.85, paint: rim, anim: gustAnim },
  ],
};

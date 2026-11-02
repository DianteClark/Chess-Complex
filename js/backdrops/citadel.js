// E1 15.0: Frost Citadel. Aurora sky over ice peaks; the board is the courtyard of an ice fortress: the far wall with
// frozen banners rises behind it, towers stand at the corners, the courtyard's front face drips icicles over a misty
// valley. Contract: see the top of js/backdrop.js.
const STONE = '#34435c', STONE_HI = '#7d93b3', STONE_LO = '#151c2c', SNOW = '#eef7ff', SNOW_LO = '#9db7d6', ICE = '#a8e8ff';

function snowCap(g, K, x, y, w, h, seed) { // a lumpy snow pad sitting on a ledge at y
  const R = K.rng(seed);
  g.fillStyle = K.lin(g, 0, y - h, 0, y + h * 0.6, [[0, SNOW], [1, SNOW_LO]]);
  g.beginPath(); g.moveTo(x - 0.04, y + h * 0.5);
  const n = Math.max(3, Math.round(w / 0.22));
  for (let i = 0; i <= n; i++) { const px = x + (w * i) / n; g.lineTo(px, y - h * (0.55 + R() * 0.45) * (i === 0 || i === n ? 0.5 : 1)); }
  g.lineTo(x + w + 0.04, y + h * 0.5);
  for (let i = n; i >= 0; i--) { const px = x + (w * i) / n; g.lineTo(px, y + h * (0.25 + R() * 0.35)); }
  g.closePath(); g.fill();
}
function icicles(g, K, x0, x1, y, len, seed, dens = 3.2) {
  const R = K.rng(seed);
  for (let x = x0 + R() * 0.2; x < x1; x += 1 / dens + R() * 0.18) {
    const L = len * (0.25 + R() * R() * 1.1), w = 0.05 + R() * 0.07;
    g.fillStyle = K.lin(g, x, y, x + w, y + L, [[0, 'rgba(225,248,255,0.95)'], [0.6, 'rgba(150,215,255,0.75)'], [1, 'rgba(150,215,255,0.1)']]);
    g.beginPath(); g.moveTo(x - w, y - 0.02); g.quadraticCurveTo(x - w * 0.3, y + L * 0.5, x + w * 0.1, y + L); g.quadraticCurveTo(x + w * 0.4, y + L * 0.4, x + w, y - 0.02); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x - w * 0.55, y, w * 0.25, L * 0.45);
  }
}
function blocks(g, K, x0, y0, x1, y1, bw, bh, seed, line = 'rgba(8,12,24,0.45)') { // masonry joints
  const R = K.rng(seed);
  g.strokeStyle = line; g.lineWidth = 0.035; g.beginPath();
  for (let y = y0, r = 0; y < y1 - 0.01; y += bh, r++) {
    g.moveTo(x0, y); g.lineTo(x1, y);
    for (let x = x0 + (r % 2 ? bw / 2 : 0) + R() * 0.1; x < x1; x += bw * (0.8 + R() * 0.4)) { g.moveTo(x, y); g.lineTo(x, Math.min(y1, y + bh)); }
  }
  g.stroke();
}
// a crenellated parapet: top edge at y, merlon height mh
function crenels(g, K, x0, x1, y, mh, mw, col, seed) {
  g.fillStyle = col; g.beginPath();
  for (let x = x0; x < x1; x += mw * 2) g.rect(x, y - mh, Math.min(mw, x1 - x), mh + 0.02);
  g.fill();
  for (let x = x0; x < x1; x += mw * 2) snowCap(g, K, x, y - mh, Math.min(mw, x1 - x), 0.12, seed + x * 7);
}
function banner(g, K, x, y, w, h, seed) {
  const R = K.rng(seed);
  // pole
  g.fillStyle = '#9aa9c0'; g.fillRect(x - w / 2 - 0.12, y - 0.07, w + 0.24, 0.1);
  g.fillStyle = SNOW; g.fillRect(x - w / 2 - 0.12, y - 0.11, w + 0.24, 0.05);
  // cloth: stiff, with a frozen swallowtail
  const body = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#14275e'], [0.45, '#2a4fa8'], [0.55, '#2c55b2'], [1, '#101f4c']]);
  g.fillStyle = body; g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.lineTo(x, y + h - w * 0.45); g.lineTo(x - w / 2, y + h); g.closePath(); g.fill();
  g.strokeStyle = '#c9d9ef'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(x - w / 2 + 0.07, y + 0.05); g.lineTo(x - w / 2 + 0.07, y + h - 0.12); g.lineTo(x, y + h - w * 0.45 - 0.08); g.lineTo(x + w / 2 - 0.07, y + h - 0.12); g.lineTo(x + w / 2 - 0.07, y + 0.05); g.stroke();
  // emblem: a rook in silver
  const cx = x, cy = y + h * 0.42, s = w * 0.32;
  g.fillStyle = '#dbe7f7';
  g.beginPath(); g.rect(cx - s * 0.55, cy + s * 0.55, s * 1.1, s * 0.25); g.rect(cx - s * 0.38, cy - s * 0.35, s * 0.76, s * 0.9);
  g.rect(cx - s * 0.6, cy - s * 0.7, s * 1.2, s * 0.38); g.fill();
  g.fillStyle = '#2a4fa8'; g.fillRect(cx - s * 0.2, cy - s * 0.7, s * 0.14, s * 0.18); g.fillRect(cx + s * 0.06, cy - s * 0.7, s * 0.14, s * 0.18);
  // frost creeping up from the hem
  g.fillStyle = K.lin(g, 0, y + h * 0.55, 0, y + h, [[0, 'rgba(220,240,255,0)'], [1, 'rgba(220,240,255,0.55)']]);
  g.beginPath(); g.moveTo(x - w / 2, y + h * 0.55); g.lineTo(x + w / 2, y + h * 0.55); g.lineTo(x + w / 2, y + h); g.lineTo(x, y + h - w * 0.45); g.lineTo(x - w / 2, y + h); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x - w * 0.1, y + 0.05, w * 0.12, h * 0.75);
  icicles(g, K, x - w / 2 + 0.05, x - 0.05, y + h - 0.02, 0.25, seed + 1, 6);
  icicles(g, K, x + 0.05, x + w / 2 - 0.05, y + h - 0.02, 0.25, seed + 2, 6);
  void R;
}
function tower(g, K, x, base, w, top, seed, opts = {}) { // round tower: body from base up to top, conical snowy roof
  const body = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, STONE_LO], [0.3, opts.lit ? '#5a6f92' : STONE], [0.7, '#283349'], [1, '#0d1220']]);
  g.fillStyle = body; g.fillRect(x - w / 2, top, w, base - top);
  blocks(g, K, x - w / 2, top + 0.3, x + w / 2, base, 0.55, 0.32, seed);
  // corbelled parapet ring
  g.fillStyle = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#1e283b'], [0.35, '#6c82a4'], [1, '#121827']]);
  g.fillRect(x - w / 2 - 0.12, top - 0.1, w + 0.24, 0.32);
  // roof cone
  const rh = w * 1.35;
  g.fillStyle = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#1b2a4c'], [0.4, '#33508a'], [1, '#0d1631']]);
  g.beginPath(); g.moveTo(x - w / 2 - 0.2, top - 0.08); g.lineTo(x, top - rh); g.lineTo(x + w / 2 + 0.2, top - 0.08); g.closePath(); g.fill();
  // snow on the roof
  g.fillStyle = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#a9c2e0'], [0.45, SNOW], [1, '#7f9cc2']]);
  g.beginPath(); g.moveTo(x - w * 0.32, top - rh * 0.42); g.lineTo(x, top - rh - 0.02); g.lineTo(x + w * 0.3, top - rh * 0.45); g.quadraticCurveTo(x + w * 0.1, top - rh * 0.5, x, top - rh * 0.4); g.quadraticCurveTo(x - w * 0.15, top - rh * 0.48, x - w * 0.32, top - rh * 0.42); g.fill();
  icicles(g, K, x - w / 2 - 0.15, x + w / 2 + 0.15, top + 0.2, 0.32, seed + 5, 5);
  // spire + pennant
  g.strokeStyle = '#c9d6ea'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(x, top - rh); g.lineTo(x, top - rh - 0.6); g.stroke();
  g.fillStyle = '#2a55b8'; g.beginPath(); g.moveTo(x, top - rh - 0.6); g.lineTo(x + 0.55, top - rh - 0.5); g.lineTo(x, top - rh - 0.36); g.fill();
  // windows (lit ones glow in anim)
  if (opts.windows) for (const [wx, wy] of opts.windows) { g.fillStyle = '#0a0d16'; g.beginPath(); g.moveTo(x + wx - 0.09, top + wy + 0.28); g.lineTo(x + wx - 0.09, top + wy + 0.06); g.arc(x + wx, top + wy + 0.06, 0.09, Math.PI, 0); g.lineTo(x + wx + 0.09, top + wy + 0.28); g.fill(); g.fillStyle = 'rgba(255,205,130,0.85)'; g.fillRect(x + wx - 0.05, top + wy + 0.06, 0.1, 0.2); }
}

function house(g, K, x, y, w, h, seed, lit) { // a snowed-in house of the lower town, base at y
  const R = K.rng(seed), rh = w * 0.42;
  g.fillStyle = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#2b3b58'], [0.6, '#22304a'], [1, '#141d30']]); g.fillRect(x - w / 2, y - h, w, h);
  g.fillStyle = K.lin(g, 0, y - h - rh, 0, y - h, [[0, SNOW], [1, '#9fb6d4']]);
  g.beginPath(); g.moveTo(x - w / 2 - 0.12, y - h + 0.05); g.lineTo(x, y - h - rh); g.lineTo(x + w / 2 + 0.12, y - h + 0.05); g.closePath(); g.fill();
  if (lit) { g.fillStyle = '#ffcf86'; const n = w > 1.2 ? 2 : 1; for (let i = 0; i < n; i++) g.fillRect(x - w / 2 + (w * (i + 0.5)) / n - 0.08, y - h * 0.62, 0.16, 0.2); }
  if (R() < 0.5) { g.fillStyle = '#1a2438'; g.fillRect(x + w * 0.18, y - h - rh * 0.9, 0.16, rh * 0.6); }
}
function pine(g, x, y, h) {
  g.fillStyle = '#0d1729'; g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + h * 0.3, y); g.lineTo(x - h * 0.3, y); g.fill();
  g.fillStyle = 'rgba(214,232,252,0.7)';
  for (let i = 0; i < 3; i++) { const t = 0.25 + i * 0.25, yy = y - h + h * t; g.beginPath(); g.moveTo(x - h * 0.3 * t, yy); g.lineTo(x, yy - h * 0.12); g.lineTo(x + h * 0.3 * t, yy); g.lineTo(x, yy - h * 0.05); g.fill(); }
}
export default {
  id: 'citadel',
  base: '#060a18',
  light: { tint: ['#cfdcf6', '#e4eeff'], glow: ['t', '#7fc8ff', 0.1] },
  layers: [
    { // sky: deep night with stars; the aurora animates over it
      p: 0.04, res: 0.5,
      paint(g, K) {
        const { x0, y0, x1, y1 } = K, hz = K.hz;
        g.fillStyle = K.lin(g, 0, hz - 14, 0, hz + 1, [[0, '#03050d'], [0.45, '#07112a'], [0.8, '#14335e'], [1, '#2d5f82']]);
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        const R = K.rng(11), sh = Math.max(1, hz - 1 - y0);
        for (let i = 0; i < (x1 - x0) * sh * 0.5; i++) { const x = x0 + R() * (x1 - x0), y = y0 + R() * sh, a = 0.2 + R() * 0.7, s = 0.03 + R() * R() * 0.07; g.fillStyle = `rgba(220,236,255,${a})`; g.fillRect(x, y, s, s); }
        g.globalAlpha = 0.35; g.drawImage(K.glow('#3c8dff'), (K.b.x0 + K.b.x1) / 2 - 10, hz - 7, 20, 9); g.globalAlpha = 1;
      },
      anim(ctx, K) {
        if (K.lowQ) return;
        const T = K.T, hz = K.hz, top = hz - (K.wide ? 6.4 : 8.5) - 2;
        // two aurora curtains baked once (soft, low-res), drifting and breathing: 4 blits a frame
        const band = (i) => K.soft('aur' + i, 6, top, top + 9, (g, S) => {
          const cur = K.sprite('cit-aur', 32, 128, (q, w, h) => { const gr = q.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(160,110,255,0)'); gr.addColorStop(0.35, 'rgba(130,130,255,0.35)'); gr.addColorStop(0.78, 'rgba(90,255,200,0.95)'); gr.addColorStop(1, 'rgba(90,255,200,0)'); q.fillStyle = gr; q.fillRect(0, 0, w, h); });
          g.globalCompositeOperation = 'lighter';
          const span = S.x1 - S.x0, n = Math.ceil(span * 1.5);
          for (let j = 0; j < n; j++) { const u = j / n, x = S.x0 + u * span, y = top + 2 + i * 1.4 + Math.sin(u * span * 0.33 + i * 2) * 1.1 + Math.sin(u * span * 0.9 + i) * 0.35; g.globalAlpha = (0.2 + 0.13 * Math.sin(u * span * 0.6 + i)) * (i ? 0.65 : 1); g.drawImage(cur, x, y, (span / n) * 1.7, 5.5 - i); }
        });
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 2; i++) { const o = band(i), dx = Math.sin(T * 0.05 + i * 2) * 2.5; ctx.globalAlpha = 0.6 + 0.35 * Math.sin(T * (0.5 + i * 0.31) + i * 2); K.blitOut(o, dx, Math.sin(T * 0.3 + i) * 0.2); }
        const R = K.rng(5);
        for (let i = 0; i < K.n(8); i++) { const x = K.x0 + R() * (K.x1 - K.x0), y = K.y0 + R() * Math.max(1, hz - 3 - K.y0), a = Math.sin(T * (0.8 + R()) + i * 3); if (a < 0.3) continue; ctx.globalAlpha = a * 0.8; ctx.drawImage(K.glow('#d8ecff'), x - 0.18, y - 0.18, 0.36, 0.36); }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      },
    },
    { // far: two ranges of ice peaks on the horizon
      p: 0.14, res: 0.7,
      paint(g, K) {
        const { x0, x1, y1 } = K, cx = (K.b.x0 + K.b.x1) / 2, hz = K.hz;
        const far = K.ridge({ x0: x0 - 1, x1: x1 + 1, y: hz - 1.4, amp: 2.2, seed: 3, step: 0.2, peaks: [[cx - 6, 2.4, 3], [cx + 5, 3, 3.5], [cx + 15, 2.6, 4], [cx - 16, 3, 4], [cx + 25, 2.4, 4], [cx - 26, 2.6, 4]] });
        g.fillStyle = K.lin(g, 0, hz - 7, 0, hz + 1, [[0, '#6c93bd'], [1, '#22405f']]); K.fillRidge(g, far, y1);
        g.save(); g.beginPath(); g.moveTo(far[0][0], y1); for (const [x, y] of far) g.lineTo(x, y); g.lineTo(far[far.length - 1][0], y1); g.clip();
        g.fillStyle = 'rgba(230,242,255,0.6)'; g.beginPath(); g.moveTo(far[0][0], far[0][1]); for (const [x, y] of far) g.lineTo(x, y); for (let i = far.length - 1; i >= 0; i--) { const [x, y] = far[i]; g.lineTo(x + 0.15, y + 0.3 + Math.abs(Math.sin(x * 2.1)) * 0.55); } g.fill(); g.restore();
        const near = K.ridge({ x0: x0 - 1, x1: x1 + 1, y: hz, amp: 1.3, seed: 8, step: 0.15, peaks: [[cx - 12, 1.6, 3], [cx + 12, 1.9, 3], [cx - 22, 1.4, 3], [cx + 21, 1.2, 3]] });
        g.fillStyle = K.lin(g, 0, hz - 3, 0, hz + 2, [[0, '#365479'], [1, '#172843']]); K.fillRidge(g, near, y1);
        g.save(); g.beginPath(); g.moveTo(near[0][0], y1); for (const [x, y] of near) g.lineTo(x, y); g.lineTo(near[near.length - 1][0], y1); g.clip();
        g.strokeStyle = 'rgba(210,232,255,0.5)'; g.lineWidth = 0.08; g.beginPath(); near.forEach(([x, y], i) => (i ? g.lineTo(x, y + 0.05) : g.moveTo(x, y + 0.05))); g.stroke();
        g.fillStyle = K.lin(g, 0, hz + 0.5, 0, hz + 3, [[0, 'rgba(150,190,230,0.35)'], [1, 'rgba(150,190,230,0)']]); g.fillRect(x0 - 1, hz - 1, x1 - x0 + 2, 4); g.restore();
      },
    },
    { // mid: snowy terraces of the lower town falling away from the fortress, spires of the keep behind the far wall
      p: 0.42,
      paint(g, K) {
        const { x0, x1, y1 } = K, b = K.b, cx = (b.x0 + b.x1) / 2, hz = K.hz, R = K.rng(21);
        // keep spires (behind the far wall)
        tower(g, K, cx - 4.4, b.y0 - 0.5, 1.3, b.y0 - 4.6, 31, { windows: [[0, 0.5], [0, 1.4]] });
        tower(g, K, cx + 3.8, b.y0 - 0.5, 1.6, b.y0 - 5.2, 32, { windows: [[-0.3, 0.6], [0.3, 0.6], [0, 1.7]], lit: true });
        tower(g, K, cx - 0.2, b.y0 - 0.5, 1.05, b.y0 - 6.1, 33, { windows: [[0, 0.7], [0, 1.6], [0, 2.5]] });
        // terraces from the horizon down: snowy ledges, houses and pines (kept off the board's footprint)
        const out = (x, y, m = 1.5) => x < b.x0 - m || x > b.x1 + m || y > b.y1 + m;
        for (let ty = hz + 1.4, i = 0; ty < y1 + 3; ty += 2.6 + (i % 2) * 0.9, i++) {
          const pts = K.ridge({ x0: x0 - 1, x1: x1 + 1, y: ty, amp: 0.9, seed: 100 + i, step: 0.3, rough: 0.5 });
          const k = Math.min(1, (ty - hz) / 22);
          g.fillStyle = K.lin(g, 0, ty - 0.8, 0, ty + 3, [[0, K.mix('#b9cfe8', '#6f8db3', k)], [0.12, K.mix('#5d7aa0', '#2c4466', k)], [1, K.mix('#1d3050', '#0b1426', k)]]);
          K.fillRidge(g, pts, ty + 3.5);
          const sc = 0.8 + k * 0.9, gap = R() * (x1 - x0), gw = 3 + R() * 5; // nearer terraces: bigger props; an empty stretch per terrace
          for (const [px, py] of pts) {
            if (R() > 0.34 || !out(px, py) || Math.abs(px - x0 - gap) < gw) continue;
            if (R() < 0.3) house(g, K, px, py + 0.25, (0.8 + R() * 0.8) * sc, (0.55 + R() * 0.35) * sc, i * 50 + px | 0, R() < 0.55);
            else { pine(g, px, py + 0.2, (0.7 + R() * 0.8) * sc); if (R() < 0.5) pine(g, px + 0.35 * sc, py + 0.3, (0.5 + R() * 0.6) * sc); }
          }
        }
        g.fillStyle = K.lin(g, 0, hz, 0, hz + 6, [[0, 'rgba(120,165,215,0.35)'], [1, 'rgba(120,165,215,0)']]); g.fillRect(x0, hz, x1 - x0, 6);
      },
      anim(ctx, K) { // window light breathing in the keep
        if (K.lowQ) return;
        const cx = (K.b.x0 + K.b.x1) / 2, y = K.b.y0;
        ctx.globalCompositeOperation = 'lighter';
        const W = [[cx + 3.5, y - 4.4], [cx + 4.1, y - 4.4], [cx + 3.8, y - 3.3], [cx - 0.2, y - 5.2], [cx - 4.4, y - 3.9]];
        W.forEach(([x, yy], i) => { ctx.globalAlpha = 0.25 + 0.12 * Math.sin(K.T * (0.7 + i * 0.3) + i * 2); ctx.drawImage(K.glow('#ffb860'), x - 0.6, yy - 0.6, 1.2, 1.2); });
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      },
    },
    { // rim: the courtyard's walls hugging the board
      p: 1, r: 5, res: 0.85,
      paint(g, K) {
        const b = K.b, top = b.y0 - 0.7, bot = b.y1 + 0.7, L = b.x0 - 0.7, Rr = b.x1 + 0.7, X0 = L - 3.1, X1 = Rr + 3.1;
        // far wall face rising behind the board
        const wt = top - 1.75;
        g.fillStyle = K.lin(g, 0, wt, 0, top + 0.2, [[0, '#4a5d7d'], [0.55, STONE], [1, '#1b2335']]); g.fillRect(X0, wt, X1 - X0, top - wt + 0.3);
        blocks(g, K, X0, wt + 0.15, X1, top + 0.3, 0.9, 0.4, 41);
        g.fillStyle = K.lin(g, 0, top - 0.8, 0, top + 0.2, [[0, 'rgba(160,210,255,0)'], [1, 'rgba(160,210,255,0.2)']]); g.fillRect(X0, top - 0.8, X1 - X0, 1); // cold light off the ice floor
        g.fillStyle = '#26324a'; g.fillRect(X0, wt - 0.12, X1 - X0, 0.2);
        crenels(g, K, X0, X1, wt - 0.08, 0.45, 0.46, '#3c4c68', 42);
        icicles(g, K, X0, X1, wt + 0.08, 0.3, 43, 2.6);
        const span = b.x1 - b.x0, nb = span > 12 ? 4 : 3;
        for (let i = 0; i < nb; i++) banner(g, K, b.x0 + (span * (i + 0.5)) / nb, wt + 0.14, 0.82, 1.3, 50 + i);
        snowCap(g, K, X0, top + 0.05, X1 - X0, 0.16, 44);
        // side walls: wall-walks seen from above, merlons on the outer edge, snow drifted against them
        for (const side of [-1, 1]) {
          const ix = side < 0 ? L : Rr, ox = ix + side * 2.4, xa = Math.min(ix, ox), xb = Math.max(ix, ox), ya = top - 0.2, yb = bot + 1.45;
          g.fillStyle = K.lin(g, ix, 0, ox, 0, [[0, '#2a364d'], [0.2, '#55698b'], [1, '#3a4a66']]); g.fillRect(xa, ya, xb - xa, yb - ya);
          g.strokeStyle = 'rgba(10,14,26,0.28)'; g.lineWidth = 0.03; g.beginPath();
          for (let y = ya + 0.9; y < yb; y += 0.9) { g.moveTo(xa, y); g.lineTo(xb, y); } for (let y = ya, r = 0; y < yb; y += 0.9, r++) { const mx = xa + (xb - xa) * (r % 2 ? 0.35 : 0.65); g.moveTo(mx, y); g.lineTo(mx, Math.min(yb, y + 0.9)); } g.stroke();
          // drift along the outer parapet
          const dx = side < 0 ? xa + 0.45 : xb - 0.45, dw = 0.9 * -side;
          g.fillStyle = K.lin(g, dx, 0, dx + dw, 0, [[0, 'rgba(236,246,255,0.95)'], [1, 'rgba(236,246,255,0)']]);
          g.beginPath(); g.moveTo(dx, ya); for (let y = ya; y <= yb; y += 0.5) g.lineTo(dx + dw * (0.55 + 0.45 * Math.sin(y * 1.7 + side)), y); g.lineTo(dx, yb); g.fill();
          // merlons (top-down)
          const px = side < 0 ? xa : xb - 0.45;
          g.fillStyle = '#26324a'; g.fillRect(px, ya, 0.45, yb - ya);
          for (let y = ya + 0.1; y < yb - 0.3; y += 0.95) { g.fillStyle = K.lin(g, px, 0, px + 0.45, 0, [[0, '#6b80a3'], [1, '#3a4a66']]); g.fillRect(px - 0.04, y, 0.53, 0.5); g.fillStyle = 'rgba(240,248,255,0.85)'; g.fillRect(px - 0.02, y + 0.02, 0.49, 0.14); }
          // shadow cast onto the board frame
          g.fillStyle = K.lin(g, ix, 0, ix - side * 0.5, 0, [[0, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(Math.min(ix, ix - side * 0.5), top, 0.5, bot - top);
          // cold braziers along the walk (lit in anim)
          for (let y = b.y0 + 3; y < b.y1 - 1; y += 5) { const bx = (ix + ox) / 2 + side * 0.15; g.fillStyle = '#1c2537'; g.beginPath(); g.ellipse(bx, y + 0.12, 0.38, 0.16, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = K.lin(g, bx - 0.3, 0, bx + 0.3, 0, [[0, '#8ea3c4'], [1, '#3b4a66']]); g.beginPath(); g.ellipse(bx, y, 0.3, 0.13, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#bff0ff'; g.beginPath(); g.ellipse(bx, y - 0.02, 0.2, 0.07, 0, 0, Math.PI * 2); g.fill(); }
        }
        // corner towers: far ones tall, near ones squat
        tower(g, K, L - 1.5, top + 0.4, 2.2, wt - 0.9, 90, { windows: [[0, 0.5]] });
        tower(g, K, Rr + 1.5, top + 0.4, 2.2, wt - 0.9, 91, { windows: [[0, 0.5]] });
        // front face of the courtyard dropping away, icicles over the valley
        const fb = bot + 1.4;
        g.fillStyle = K.lin(g, 0, bot, 0, fb, [[0, '#56698b'], [0.18, STONE], [1, '#141b2a']]); g.fillRect(X0 + 0.4, bot, X1 - X0 - 0.8, fb - bot);
        blocks(g, K, X0 + 0.4, bot, X1 - 0.4, fb, 1, 0.47, 95);
        g.fillStyle = SNOW; g.fillRect(L, bot - 0.02, Rr - L, 0.07);
        icicles(g, K, X0 + 0.5, X1 - 0.5, fb - 0.02, 0.9, 96, 3.4);
        tower(g, K, L - 1.5, fb + 0.2, 1.9, bot - 0.2, 92, { windows: [[0, 0.7]] });
        tower(g, K, Rr + 1.5, fb + 0.2, 1.9, bot - 0.2, 93, { windows: [[0, 0.7]], lit: true });
      },
      anim(ctx, K) { // cold braziers + glints on the icicles
        const b = K.b, top = b.y0 - 0.7, bot = b.y1 + 0.7, T = K.T;
        ctx.globalCompositeOperation = 'lighter';
        const pts = [];
        for (const side of [-1, 1]) { const ix = side < 0 ? b.x0 - 0.7 : b.x1 + 0.7, bx = ix + side * 1.35; for (let y = b.y0 + 3; y < b.y1 - 1; y += 5) pts.push([bx, y - 0.1]); }
        pts.forEach(([x, y], i) => {
          if (K.hidden(x - 1, y - 1, x + 1, y + 1)) return;
          const f = 0.8 + 0.2 * Math.sin(T * 7 + i * 2.3) * (K.reduced ? 0.2 : 1);
          ctx.globalAlpha = 0.45 * f; ctx.drawImage(K.glow('#5fc8ff'), x - 1.2, y - 1.2, 2.4, 2.4);
          ctx.globalAlpha = 0.85 * f; ctx.drawImage(K.glow('#e2f8ff'), x - 0.2, y - 0.5 - 0.06 * f, 0.4, 0.62);
        });
        if (!K.lowQ && !K.reduced) {
          const R = K.rng(7);
          for (let i = 0; i < 7; i++) { const x = b.x0 - 3 + R() * (b.x1 - b.x0 + 6), ph = (T * 0.3 + R()) % 1; if (ph > 0.12) continue; ctx.globalAlpha = Math.sin((ph / 0.12) * Math.PI) * 0.9; ctx.drawImage(K.glow('#ffffff'), x - 0.25, bot + 1.5, 0.5, 0.5); }
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; void top;
      },
    },
  ],
};

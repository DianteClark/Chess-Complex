// E1 15.0: Volcanic Forge. A foundry cut into a living volcano: an erupting cone on a smoky red horizon, smoke stacks and
// basalt columns, and the board on a basalt slab ringed by a magma river, glowing anvils on its banks and the great
// furnace arch behind it. Contract: see the top of js/backdrop.js.
const BAS = '#1d1514', BAS_HI = '#4a3631', BAS_LO = '#0b0707';

function rubble(g, K, x0, x1, y, seed, n = 1) { // basalt chunks along a line
  const R = K.rng(seed);
  for (let x = x0; x < x1; x += 0.3 + R() * 0.5) {
    const w = (0.25 + R() * 0.45) * n, h = w * (0.5 + R() * 0.3), yy = y + (R() - 0.5) * 0.3;
    g.fillStyle = K.lin(g, 0, yy - h, 0, yy, [[0, BAS_HI], [1, BAS_LO]]);
    g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w * 0.15, yy - h); g.lineTo(x + w * 0.7, yy - h * 1.1); g.lineTo(x + w, yy - h * 0.2); g.lineTo(x + w, yy); g.fill();
  }
}
function crust(g, K, x0, y0, x1, y1, seed, dens = 1.2, stretch = [1, 0.7]) { // cooled plates floating on magma
  const R = K.rng(seed), n = Math.round((x1 - x0) * (y1 - y0) * dens);
  for (let i = 0; i < n; i++) {
    const cx = x0 + R() * (x1 - x0), cy = y0 + R() * (y1 - y0), r = 0.1 + R() * 0.22, m = 5 + ((R() * 3) | 0), ex = stretch[0], ey = stretch[1];
    g.fillStyle = R() < 0.5 ? 'rgba(80,22,8,0.8)' : 'rgba(58,16,6,0.75)'; g.beginPath();
    for (let j = 0; j < m; j++) { const a = (j / m) * 6.283, rr = r * (0.6 + R() * 0.5); j ? g.lineTo(cx + Math.cos(a) * rr * ex, cy + Math.sin(a) * rr * ey) : g.moveTo(cx + Math.cos(a) * rr * ex, cy + Math.sin(a) * rr * ey); }
    g.closePath(); g.fill();
  }
}
function magma(g, K, x, y, w, h, seed, vertical) { // a strip of molten rock with crust
  g.fillStyle = vertical ? K.lin(g, x, 0, x + w, 0, [[0, '#7a1606'], [0.3, '#ff6a12'], [0.5, '#ffd25a'], [0.7, '#ff6a12'], [1, '#7a1606']])
    : K.lin(g, 0, y, 0, y + h, [[0, '#7a1606'], [0.3, '#ff6a12'], [0.5, '#ffd25a'], [0.7, '#ff6a12'], [1, '#7a1606']]);
  g.fillRect(x, y, w, h);
  crust(g, K, x + w * 0.1, y, x + w * 0.9, y + h, seed, 0.9, vertical ? [0.7, 1.6] : [1.6, 0.6]);
}
function anvil(g, K, x, y, s = 1) { // a glowing anvil on a stump, y = ground
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = '#120c0b'; g.beginPath(); g.ellipse(0, 0.05, 0.62, 0.18, 0, 0, 6.283); g.fill();
  g.fillStyle = K.lin(g, -0.3, 0, 0.3, 0, [[0, '#2a1d18'], [0.5, '#5a3d30'], [1, '#1a110e']]); g.fillRect(-0.3, -0.42, 0.6, 0.45); // stump
  g.fillStyle = K.lin(g, 0, -0.85, 0, -0.42, [[0, '#ffe08a'], [0.25, '#ff8a2a'], [1, '#5a1a0a']]); // hot iron
  g.beginPath(); g.moveTo(-0.62, -0.84); g.quadraticCurveTo(-0.4, -0.86, -0.25, -0.82); g.lineTo(0.42, -0.82); g.lineTo(0.42, -0.66); g.lineTo(0.18, -0.6); g.lineTo(0.16, -0.48); g.lineTo(0.3, -0.42); g.lineTo(-0.3, -0.42); g.lineTo(-0.16, -0.48); g.lineTo(-0.18, -0.62); g.quadraticCurveTo(-0.45, -0.66, -0.62, -0.84); g.fill();
  g.fillStyle = 'rgba(255,250,220,0.9)'; g.fillRect(-0.2, -0.84, 0.55, 0.035);
  g.restore();
}
function stack(g, K, x, base, w, top, seed) { // brick smoke stack with a furnace mouth
  const R = K.rng(seed);
  g.fillStyle = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#120b0a'], [0.35, '#3d2620'], [1, '#0d0807']]);
  g.beginPath(); g.moveTo(x - w / 2, base); g.lineTo(x - w * 0.38, top); g.lineTo(x + w * 0.38, top); g.lineTo(x + w / 2, base); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.03; g.beginPath(); for (let y = top + 0.3; y < base; y += 0.3) { g.moveTo(x - w / 2, y); g.lineTo(x + w / 2, y); } g.stroke();
  g.fillStyle = '#241614'; g.fillRect(x - w * 0.46, top - 0.2, w * 0.92, 0.3); // cap
  g.fillStyle = K.lin(g, 0, top + 0.6, 0, top + 2.5, [[0, 'rgba(255,120,40,0.25)'], [1, 'rgba(255,120,40,0)']]); g.fillRect(x - w * 0.4, top + 0.1, w * 0.8, 2.4); // glow on its face
  for (const by of [top + (base - top) * 0.3, top + (base - top) * 0.62]) { g.fillStyle = '#5a2a14'; g.fillRect(x - w * 0.5, by, w, 0.12); }
  const my = base - 0.9; g.fillStyle = '#0a0505'; g.beginPath(); g.moveTo(x - 0.35, base); g.lineTo(x - 0.35, my); g.arc(x, my, 0.35, Math.PI, 0); g.lineTo(x + 0.35, base); g.fill();
  g.fillStyle = K.lin(g, 0, my - 0.3, 0, base, [[0, '#ff7a1c'], [1, '#ffd25a']]); g.beginPath(); g.moveTo(x - 0.25, base); g.lineTo(x - 0.25, my + 0.05); g.arc(x, my + 0.05, 0.25, Math.PI, 0); g.lineTo(x + 0.25, base); g.fill();
  void R;
}
function column(g, K, x, base, w, top) { // hexagonal basalt column
  g.fillStyle = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#0d0808'], [0.3, '#3a2b27'], [0.55, '#241917'], [1, '#080505']]); g.fillRect(x - w / 2, top, w, base - top);
  g.fillStyle = '#4e3a33'; g.beginPath(); g.moveTo(x - w / 2, top); g.lineTo(x - w / 4, top - w * 0.18); g.lineTo(x + w / 4, top - w * 0.18); g.lineTo(x + w / 2, top); g.lineTo(x + w / 4, top + w * 0.18); g.lineTo(x - w / 4, top + w * 0.18); g.fill();
  g.fillStyle = 'rgba(255,110,40,0.18)'; g.fillRect(x - w / 2, base - (base - top) * 0.4, w, (base - top) * 0.4);
}

const puffOf = (K) => K.sprite('forge-puff', 48, 48, (g) => { const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24); gr.addColorStop(0, 'rgba(46,24,20,0.85)'); gr.addColorStop(0.6, 'rgba(36,18,16,0.45)'); gr.addColorStop(1, 'rgba(30,14,12,0)'); g.fillStyle = gr; g.fillRect(0, 0, 48, 48); });

export default {
  id: 'forge',
  base: '#0a0404',
  light: { tint: ['#f2d9cc', '#ffd6b8'], glow: ['b', '#ff6a1e', 0.14] },
  layers: [
    { // sky: smoke and a red glow on the horizon
      p: 0.04, res: 0.5,
      paint(g, K) {
        const { x0, y0, x1, y1 } = K, hz = K.hz, cx = (K.b.x0 + K.b.x1) / 2;
        g.fillStyle = K.lin(g, 0, hz - 14, 0, hz + 1, [[0, '#050202'], [0.45, '#1a0806'], [0.8, '#4a140a'], [1, '#a8380f']]); g.fillRect(x0, y0, x1 - x0, y1 - y0);
        const R = K.rng(4);
        for (let i = 0; i < (x1 - x0) * 0.8; i++) { const x = x0 + R() * (x1 - x0), y = hz - 2 - R() * 10, w = 3 + R() * 6; g.globalAlpha = 0.25 + R() * 0.3; g.drawImage(K.glow(R() < 0.4 ? '#ff5a1a' : '#2a0e0a'), x - w, y - w * 0.3, w * 2, w * 0.6); }
        g.globalAlpha = 0.7; g.drawImage(K.glow('#ff6a1e'), cx - 14, hz - 6, 28, 10); g.globalAlpha = 1;
      },
      anim(ctx, K) { // ash clouds drifting, lit from below
        if (K.lowQ) return;
        const cl = K.sprite('forge-cloud', 96, 48, (g, w, h) => { const R = K.rng(9); for (let i = 0; i < 9; i++) { const x = 20 + R() * 56, y = 16 + R() * 18, r = 10 + R() * 14, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,16,12,0.65)'); gr.addColorStop(1, 'rgba(40,16,12,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } });
        const span = K.x1 - K.x0 + 16;
        for (let i = 0; i < K.n(3); i++) { const w = 6 + (i % 3) * 2, x = K.x0 - 8 + ((i * 9.7 + K.T * (0.15 + (i % 3) * 0.05)) % span), y = K.hz - 9 + (i * 2.3) % 6; ctx.globalAlpha = 0.8; ctx.drawImage(cl, x, y, w, w * 0.5); }
        ctx.globalAlpha = 1;
      },
    },
    { // far: the volcano and jagged black ranges
      p: 0.14, res: 0.7,
      paint(g, K) {
        const { x0, x1, y1 } = K, cx = (K.b.x0 + K.b.x1) / 2, hz = K.hz, vx = cx + (K.wide ? 15 : 3.5), vh = K.wide ? 6 : 5.2;
        const back = K.ridge({ x0: x0 - 1, x1: x1 + 1, y: hz - 0.8, amp: 2, seed: 13, step: 0.2, rough: 0.6, peaks: [[cx - 10, 1.5, 3], [cx - 24, 2, 4], [cx + 26, 1.6, 3]] });
        g.fillStyle = K.lin(g, 0, hz - 5, 0, hz + 1, [[0, '#3a1612'], [1, '#1a0a08']]); K.fillRidge(g, back, y1);
        // the cone
        g.fillStyle = K.lin(g, vx - vh, 0, vx + vh, 0, [[0, '#150908'], [0.45, '#3a1a14'], [1, '#0e0605']]);
        g.beginPath(); g.moveTo(vx - vh * 1.9, hz + 0.6); g.quadraticCurveTo(vx - vh * 0.6, hz - vh * 0.55, vx - vh * 0.22, hz - vh); g.lineTo(vx + vh * 0.24, hz - vh * 1.02); g.quadraticCurveTo(vx + vh * 0.6, hz - vh * 0.5, vx + vh * 2, hz + 0.6); g.closePath(); g.fill();
        // lava streaks down the flanks
        const R = K.rng(17);
        for (let i = 0; i < 5; i++) {
          const sx = vx + (R() - 0.5) * vh * 0.35, sy = hz - vh * 0.97; let x = sx, y = sy; const P = [[x, y]];
          const dir = (R() - 0.5) * 1.2, len = vh * (0.25 + R() * 0.35);
          for (let s = 0; s < 8; s++) { x += dir * len / 8 + (R() - 0.5) * 0.15; y += len / 8; P.push([x, y]); }
          for (const [lw, col] of [[0.45, 'rgba(255,90,20,0.22)'], [0.16, 'rgba(255,140,40,0.85)'], [0.06, 'rgba(255,225,140,0.9)']]) { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); P.forEach(([a, c2], j) => (j ? g.lineTo(a, c2) : g.moveTo(a, c2))); g.stroke(); }
        }
        g.fillStyle = '#ffcf5a'; g.beginPath(); g.ellipse(vx, hz - vh, vh * 0.24, 0.16, 0, 0, 6.283); g.fill();
        const near = K.ridge({ x0: x0 - 1, x1: x1 + 1, y: hz + 0.6, amp: 1.2, seed: 19, step: 0.15, rough: 0.65, peaks: [[cx - 15, 1.3, 2], [cx + 7, 0.8, 2]] });
        g.fillStyle = K.lin(g, 0, hz - 2, 0, hz + 2, [[0, '#24100c'], [1, '#0c0505']]); K.fillRidge(g, near, y1);
        g.strokeStyle = 'rgba(255,90,30,0.35)'; g.lineWidth = 0.06; g.beginPath(); near.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      },
      anim(ctx, K) { // crater glow and the smoke column
        const cx = (K.b.x0 + K.b.x1) / 2, hz = K.hz, vx = cx + (K.wide ? 15 : 3.5), vh = K.wide ? 6 : 5.2, cy = hz - vh, T = K.T;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 + 0.2 * Math.sin(T * 1.3) * (K.reduced ? 0.3 : 1); ctx.drawImage(K.glow('#ff6a1e'), vx - 4, cy - 2.6, 8, 4.4);
        ctx.globalCompositeOperation = 'source-over';
        if (K.lowQ) { ctx.globalAlpha = 1; return; }
        const puff = puffOf(K);
        for (let i = 0; i < K.n(6); i++) { const ph = ((T * 0.06 + i / 6) % 1), s = 1.2 + ph * 4; ctx.globalAlpha = (1 - ph) * 0.85; ctx.drawImage(puff, vx - s / 2 + ph * 4 + Math.sin(i + T * 0.2) * 0.4, cy - 0.5 - ph * 9 - s / 2, s, s); }
        ctx.globalAlpha = 1;
      },
    },
    { // mid: smoke stacks and basalt columns at the sides, the lava lake below
      p: 0.42,
      paint(g, K) {
        const { x0, x1, y1 } = K, b = K.b, hz = K.hz, R = K.rng(23), cx = (b.x0 + b.x1) / 2;
        // ground: dark slag plain falling into a lava lake below the board
        g.fillStyle = K.lin(g, 0, hz + 0.5, 0, y1, [[0, '#1e0d0a'], [0.5, '#120807'], [1, '#080404']]); g.fillRect(x0, hz + 0.5, x1 - x0, y1 - hz);
        for (let i = 0; i < 6; i++) { // glowing fissures across the plain
          let x = x0 + R() * (x1 - x0), y = hz + 2 + R() * (y1 - hz - 2); g.strokeStyle = 'rgba(255,100,30,0.55)'; g.lineWidth = 0.07; g.beginPath(); g.moveTo(x, y);
          for (let s = 0; s < 10; s++) { x += (R() - 0.3) * 1.4; y += (R() - 0.5) * 0.8; g.lineTo(x, y); } g.stroke();
        }
        const ly = b.y1 + 3.2; // lava lake
        g.fillStyle = K.lin(g, 0, ly, 0, y1, [[0, '#ff7a1c'], [0.15, '#d84410'], [1, '#5a1206']]); g.beginPath(); g.moveTo(x0, y1); g.lineTo(x0, ly + 1.5);
        for (let x = x0; x <= x1; x += 0.5) g.lineTo(x, ly + Math.sin(x * 0.7) * 0.4 + Math.sin(x * 0.23) * 0.8); g.lineTo(x1, y1); g.fill();
        crust(g, K, x0, ly + 1, x1, y1, 31, 0.3, [2, 0.6]);
        // basalt columns + stacks on both sides
        for (const side of [-1, 1]) {
          const ex = side < 0 ? b.x0 - 4.5 : b.x1 + 4.5;
          for (let i = 0; i < 9; i++) { const x = ex + side * (i * 0.9 + R() * 0.4), base = hz + 3 + R() * 2 + i * 0.3, h = 2 + R() * 3.5 - i * 0.12; column(g, K, x, base + 3, 0.85, base - h); }
          stack(g, K, side < 0 ? b.x0 - 3.2 : b.x1 + 3.2, hz + 6.5, 1.6, hz - (K.wide ? 3.5 : 1.8), 40 + side);
          stack(g, K, side < 0 ? b.x0 - 7.5 : b.x1 + 7.5, hz + 4.5, 1.2, hz - (K.wide ? 1.5 : 0.5), 50 + side);
        }
        // the foundry hall behind the board: a roofline with a great chimney
        g.fillStyle = K.lin(g, 0, b.y0 - 5, 0, b.y0, [[0, '#1c0f0c'], [1, '#2d1712']]);
        g.beginPath(); g.moveTo(cx - 9, b.y0); g.lineTo(cx - 9, b.y0 - 2.8); g.lineTo(cx - 5, b.y0 - 4.2); g.lineTo(cx - 1, b.y0 - 2.8); g.lineTo(cx + 3, b.y0 - 4.2); g.lineTo(cx + 9, b.y0 - 2.8); g.lineTo(cx + 9, b.y0); g.fill();
        stack(g, K, cx + 5.5, b.y0 - 2, 1.4, b.y0 - 7, 60);
      },
      anim(ctx, K) { // smoke from the stacks, furnace mouths breathing
        const b = K.b, hz = K.hz, T = K.T, cx = (b.x0 + b.x1) / 2;
        const S = [[b.x0 - 3.2, hz - (K.wide ? 3.5 : 1.8), hz + 5.6], [b.x1 + 3.2, hz - (K.wide ? 3.5 : 1.8), hz + 5.6], [b.x0 - 7.5, hz - (K.wide ? 1.5 : 0.5), hz + 3.6], [b.x1 + 7.5, hz - (K.wide ? 1.5 : 0.5), hz + 3.6], [cx + 5.5, b.y0 - 7, b.y0 - 2.9]];
        ctx.globalCompositeOperation = 'lighter';
        S.forEach(([x, , my], i) => { ctx.globalAlpha = 0.35 + 0.15 * Math.sin(T * 2.1 + i * 1.7) * (K.reduced ? 0.3 : 1); ctx.drawImage(K.glow('#ff7a1c'), x - 1, my - 0.8, 2, 1.6); });
        ctx.globalCompositeOperation = 'source-over';
        if (K.lowQ) { ctx.globalAlpha = 1; return; }
        const puff = puffOf(K);
        S.forEach(([x, top], j) => {
          if (K.hidden(x - 3, top - 6, x + 3, top)) return;
          for (let i = 0; i < K.n(5); i++) { const ph = ((T * 0.09 + i / 5 + j * 0.13) % 1), s = 0.6 + ph * 2.6; ctx.globalAlpha = (1 - ph) * 0.8; ctx.drawImage(puff, x - s / 2 + ph * 1.6, top - 0.2 - ph * 4.5 - s / 2, s, s); }
        });
        ctx.globalAlpha = 1;
      },
    },
    { // rim: the basalt slab, the magma river around it, anvils on its banks and the furnace arch behind
      p: 1, r: 4.5, res: 0.85,
      paint(g, K) {
        const b = K.b, L = b.x0 - 0.7, Rr = b.x1 + 0.7, top = b.y0 - 0.7, bot = b.y1 + 0.7, cx = (b.x0 + b.x1) / 2, rw = 1.5;
        // far bank: the furnace wall with its arch
        const wt = top - 2.2;
        g.fillStyle = K.lin(g, 0, wt, 0, top, [[0, '#2b1813'], [1, '#170c0a']]); g.fillRect(L - 4.5, wt, Rr - L + 9, top - wt);
        g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.035; g.beginPath(); for (let y = wt + 0.35; y < top; y += 0.35) { g.moveTo(L - 4.5, y); g.lineTo(Rr + 4.5, y); } g.stroke();
        g.fillStyle = '#0a0404'; g.beginPath(); g.moveTo(cx - 2.2, top); g.lineTo(cx - 2.2, wt + 1.2); g.arc(cx, wt + 1.2, 2.2, Math.PI, 0); g.lineTo(cx + 2.2, top); g.fill();
        g.fillStyle = K.rad(g, cx, top, 0.2, 2.6, [[0, '#ffe28a'], [0.35, '#ff7a1c'], [1, 'rgba(120,20,6,0.2)']]); g.beginPath(); g.moveTo(cx - 1.9, top); g.lineTo(cx - 1.9, wt + 1.3); g.arc(cx, wt + 1.3, 1.9, Math.PI, 0); g.lineTo(cx + 1.9, top); g.fill();
        g.strokeStyle = '#3a2219'; g.lineWidth = 0.12; for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(cx + i * 0.5, top); g.lineTo(cx + i * 0.5, wt + 1.3 - Math.sqrt(Math.max(0, 3.6 - i * i * 0.25)) * 0.9); g.stroke(); } // grate
        g.fillStyle = '#4a2c20'; g.fillRect(L - 4.5, wt - 0.25, Rr - L + 9, 0.3);
        for (const px of [cx - 6.5, cx + 6.5]) { column(g, K, px, top, 1.1, wt - 0.6); }
        // magma river: sides and front (the far side runs under the furnace)
        magma(g, K, L - rw, top - 0.1, rw, bot - top + rw + 0.1, 71, true);
        magma(g, K, Rr, top - 0.1, rw, bot - top + rw + 0.1, 72, true);
        magma(g, K, L - rw, bot + 0.9, Rr - L + rw * 2, rw - 0.2, 73, false);
        // the slab's front face between the board and the river
        g.fillStyle = K.lin(g, 0, bot, 0, bot + 0.9, [[0, '#4a3631'], [0.2, '#2a1c19'], [1, '#100908']]); g.fillRect(L, bot, Rr - L, 0.9);
        g.fillStyle = 'rgba(255,120,40,0.35)'; g.fillRect(L, bot + 0.75, Rr - L, 0.15);
        // outer banks of basalt
        for (const side of [-1, 1]) {
          const bx = side < 0 ? L - rw : Rr + rw, w = 3;
          g.fillStyle = K.lin(g, bx, 0, bx + side * w, 0, [[0, '#3a2620'], [0.15, BAS], [1, '#140c0a']]); g.fillRect(Math.min(bx, bx + side * w), top - 0.2, w, bot - top + 3.2);
          rubble(g, K, Math.min(bx, bx + side * w), Math.max(bx, bx + side * w), bot + 2.8, 80 + side);
          g.fillStyle = K.lin(g, bx, 0, bx + side * 0.8, 0, [[0, 'rgba(255,110,30,0.4)'], [1, 'rgba(255,110,30,0)']]); g.fillRect(Math.min(bx, bx + side * 0.8), top, 0.8, bot - top + 2.5);
          for (let y = b.y0 + 2.5; y < b.y1; y += 5.2) anvil(g, K, bx + side * 1.4, y + 0.6, 1);
          // chains hanging from the furnace wall
          g.strokeStyle = '#2a1a14'; g.lineWidth = 0.06; for (let i = 0; i < 6; i++) { const y = wt + 0.3 + i * 0.28; g.beginPath(); g.ellipse(bx + side * 1.6, y, 0.07, 0.13, 0, 0, 6.283); g.stroke(); }
        }
        g.fillStyle = K.lin(g, 0, bot + 2.3, 0, bot + 3.6, [[0, '#2a1a15'], [1, '#0d0707']]); g.fillRect(L - rw - 3, bot + 2.3, Rr - L + rw * 2 + 6, 1.3);
        rubble(g, K, L - rw - 3, Rr + rw + 3, bot + 2.6, 91, 1.1);
      },
      anim(ctx, K) { // the magma breathes and flows; anvils glow and spit sparks
        const b = K.b, L = b.x0 - 0.7, Rr = b.x1 + 0.7, top = b.y0 - 0.7, bot = b.y1 + 0.7, T = K.T, rw = 1.5, cx = (b.x0 + b.x1) / 2;
        ctx.globalCompositeOperation = 'lighter';
        const gl = K.glow('#ff8a2a'), hot = K.glow('#ffd25a');
        const n = K.n(8), len = bot - top + rw;
        for (let i = 0; i < n; i++) { // bright currents sliding along both side rivers and the front
          const u = ((T * 0.05 + i / n) % 1);
          for (const x of [L - rw / 2, Rr + rw / 2]) { const y = top + u * len; if (K.hidden(x - 1, y - 1, x + 1, y + 1)) continue; ctx.globalAlpha = 0.35 * Math.sin(u * Math.PI); ctx.drawImage(hot, x - 0.5, y - 0.9, 1, 1.8); }
          const fx = L - rw + u * (Rr - L + rw * 2); ctx.globalAlpha = 0.3; ctx.drawImage(hot, fx - 0.9, bot + 1.1, 1.8, 0.9);
        }
        ctx.globalAlpha = 0.25 + 0.1 * Math.sin(T * 1.6) * (K.reduced ? 0.3 : 1); ctx.drawImage(gl, cx - 3, top - 2.4, 6, 3.6); // furnace mouth
        for (const side of [-1, 1]) { const bx = side < 0 ? L - rw : Rr + rw; for (let y = b.y0 + 2.5, i = 0; y < b.y1; y += 5.2, i++) { const x = bx + side * 1.4, yy = y - 0.1; if (K.hidden(x - 1, yy - 1, x + 1, yy + 1)) continue; ctx.globalAlpha = 0.45 + 0.15 * Math.sin(T * 3 + i + side); ctx.drawImage(gl, x - 1, yy - 0.9, 2, 1.4); if (!K.reduced && !K.lowQ) for (let s = 0; s < 4; s++) { const ph = (T * 0.9 + s * 0.25 + i * 0.37) % 1; ctx.globalAlpha = 1 - ph; ctx.drawImage(hot, x - 0.06 + Math.sin(s * 2.1 + i) * ph * 0.9, yy - 0.3 - ph * 1.1 + ph * ph * 0.8, 0.12, 0.12); } } }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      },
    },
  ],
};

// E1 15.0: Sunken Temple. A drowned sanctuary: light shafts falling through green-blue water, a temple facade in the
// haze, toppled and standing columns wrapped in kelp, fish schools and bubbles; the board is the temple floor, with a
// broken colonnade behind it, carved borders and steps sinking into the deep. Contract: see the top of js/backdrop.js.
const STONE = '#5d7f7a', STONE_HI = '#a9c9bd', STONE_LO = '#1d3438';

function colm(g, K, x, base, w, top, opts = {}) { // fluted column; opts.broken: jagged top, opts.cap: capital
  const R = K.rng(opts.seed || 1), fog = opts.fog || 0, col = (c) => (fog ? K.mix(c, '#2a6a70', fog) : c);
  g.fillStyle = K.lin(g, x - w / 2, 0, x + w / 2, 0, [[0, col('#1e3a3c')], [0.3, col(STONE_HI)], [0.55, col(STONE)], [1, col('#14282b')]]);
  g.beginPath(); g.moveTo(x - w / 2, base);
  if (opts.broken) { g.lineTo(x - w / 2, top + R() * 0.4); for (let i = 1; i < 5; i++) g.lineTo(x - w / 2 + (w * i) / 5, top + R() * 0.6 - 0.1); g.lineTo(x + w / 2, top + 0.3 + R() * 0.3); }
  else { g.lineTo(x - w / 2, top); g.lineTo(x + w / 2, top); }
  g.lineTo(x + w / 2, base); g.closePath(); g.fill();
  g.strokeStyle = `rgba(10,30,32,${0.35 * (1 - fog)})`; g.lineWidth = w * 0.04; g.beginPath();
  for (let i = 1; i < 5; i++) { const fx = x - w / 2 + (w * i) / 5; g.moveTo(fx, base); g.lineTo(fx, top + (opts.broken ? 0.7 : 0.05)); } g.stroke();
  if (opts.cap && !opts.broken) { g.fillStyle = col('#8fb3a8'); g.fillRect(x - w * 0.72, top - w * 0.32, w * 1.44, w * 0.32); g.fillStyle = col('#6f948b'); g.fillRect(x - w * 0.62, top - w * 0.06, w * 1.24, w * 0.12); }
  g.fillStyle = col('#7fa398'); g.fillRect(x - w * 0.66, base - w * 0.25, w * 1.32, w * 0.25); // base
  if (!fog) { // algae and moss creeping up
    g.fillStyle = 'rgba(70,140,90,0.45)'; for (let i = 0; i < 6; i++) { const y = base - R() * (base - top) * 0.7; g.beginPath(); g.ellipse(x + (R() - 0.5) * w * 0.8, y, w * 0.18, 0.12 + R() * 0.2, 0, 0, 6.283); g.fill(); }
  }
}
function kelp(g, x, base, h, seed, col = '#2f7a4a') {
  let px = x; g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = 0.12;
  g.beginPath(); g.moveTo(px, base);
  for (let i = 1; i <= 10; i++) { px = x + Math.sin(i * 0.8 + seed) * 0.25; g.lineTo(px, base - (h * i) / 10); } g.stroke();
  g.fillStyle = col; for (let i = 2; i <= 9; i++) { const y = base - (h * i) / 10, xx = x + Math.sin(i * 0.8 + seed) * 0.25, s = i % 2 ? 1 : -1; g.beginPath(); g.ellipse(xx + s * 0.18, y, 0.2, 0.07, s * 0.6, 0, 6.283); g.fill(); }
}
function coral(g, K, x, y, s, seed) {
  const R = K.rng(seed), cols = ['#e0755f', '#f2a65a', '#c65d8e', '#7fd1c1'], c = cols[(R() * 4) | 0];
  g.strokeStyle = c; g.lineCap = 'round';
  const br = (x0, y0, a, l, w, d) => { const x1 = x0 + Math.cos(a) * l, y1 = y0 + Math.sin(a) * l; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); if (d > 0) { br(x1, y1, a - 0.4 - R() * 0.3, l * 0.7, w * 0.75, d - 1); br(x1, y1, a + 0.4 + R() * 0.3, l * 0.7, w * 0.75, d - 1); } };
  br(x, y, -Math.PI / 2 + (R() - 0.5) * 0.4, 0.35 * s, 0.1 * s, 2);
}
const fishSpr = (K, col) => K.sprite('fish' + col, 40, 20, (g) => {
  g.fillStyle = col; g.beginPath(); g.ellipse(17, 10, 13, 6, 0, 0, 6.283); g.fill();
  g.beginPath(); g.moveTo(30, 10); g.lineTo(39, 3); g.lineTo(39, 17); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(15, 8, 9, 2, 0, 0, 6.283); g.fill();
  g.fillStyle = '#081418'; g.beginPath(); g.arc(9, 9, 1.5, 0, 6.283); g.fill();
});
const shaftSpr = (K) => K.sprite('tshaft', 32, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(200,255,240,0.9)'); gr.addColorStop(1, 'rgba(200,255,240,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, w, h); });
const bubbleSpr = (K) => K.sprite('tbub', 16, 16, (g) => { g.strokeStyle = 'rgba(220,255,250,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.arc(8, 8, 6, 0, 6.283); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(6, 6, 1.8, 0, 6.283); g.fill(); });

export default {
  id: 'temple',
  base: '#04161c',
  light: { tint: ['#d2f0ea', '#bfe2e2'], glow: ['t', '#7fffe0', 0.1], caustic: '#9ffff0' },
  layers: [
    { // the water column: bright surface far above, deep green-blue below
      p: 0.04, res: 0.5,
      paint(g, K) {
        const { x0, y0, x1, y1 } = K, hz = K.hz;
        g.fillStyle = K.lin(g, 0, hz - 12, 0, y1, [[0, '#4fc4bc'], [0.18, '#1b7f86'], [0.4, '#0d4f5e'], [0.7, '#082f3c'], [1, '#03141b']]); g.fillRect(x0, y0, x1 - x0, y1 - y0);
        const R = K.rng(6); // the surface ripples, seen from below
        g.strokeStyle = 'rgba(210,255,245,0.25)'; g.lineWidth = 0.08;
        for (let i = 0; i < (x1 - x0) * 1.5; i++) { const x = x0 + R() * (x1 - x0), y = y0 + R() * Math.max(1, hz - 6 - y0); g.beginPath(); g.ellipse(x, y, 0.6 + R(), 0.12, 0, 0, 6.283); g.stroke(); }
      },
    },
    { // far: the temple facade and colonnades in the haze, light shafts and a fish school
      p: 0.14, res: 0.7,
      paint(g, K) {
        const { x0, x1, y1 } = K, cx = (K.b.x0 + K.b.x1) / 2, hz = K.hz;
        // dunes of the seafloor
        const d1 = K.ridge({ x0: x0 - 1, x1: x1 + 1, y: hz + 0.6, amp: 0.8, seed: 5, step: 0.4, rough: 0.4 });
        // facade (behind the board in portrait, off to the side when wide)
        const fx = K.wide ? cx - 15 : cx, fw = 9, ft = hz - 6.2;
        g.fillStyle = 'rgba(52,120,124,0.75)';
        g.beginPath(); g.moveTo(fx - fw / 2 - 0.4, ft + 1.1); g.lineTo(fx, ft - 0.4); g.lineTo(fx + fw / 2 + 0.4, ft + 1.1); g.closePath(); g.fill();
        g.fillRect(fx - fw / 2 - 0.3, ft + 1.1, fw + 0.6, 0.45);
        for (let i = 0; i < 7; i++) { const x = fx - fw / 2 + 0.6 + i * ((fw - 1.2) / 6); if (i === 5) continue; g.fillRect(x - 0.3, ft + 1.55, 0.6, hz - ft - 1); }
        g.fillRect(fx - fw / 2 - 0.6, hz - 0.2, fw + 1.2, 0.7);
        // broken colonnades in deeper haze
        for (const [ox, n, a] of [[-24, 6, 0.55], [-9, 3, 0.6], [12, 5, 0.6], [26, 6, 0.5]]) for (let i = 0; i < n; i++) { const x = cx + ox + i * 1.5, h = 2.5 + ((i * 7) % 5) * 0.5; g.fillStyle = `rgba(40,104,110,${a})`; g.fillRect(x - 0.28, hz - h, 0.56, h + 1); }
        g.fillStyle = K.lin(g, 0, hz - 1, 0, y1, [[0, '#2b6e6c'], [0.3, '#123d45'], [1, '#05161c']]); K.fillRidge(g, d1, y1);
        g.fillStyle = K.lin(g, 0, hz - 4, 0, hz + 2, [[0, 'rgba(60,170,170,0)'], [1, 'rgba(60,170,170,0.25)']]); g.fillRect(x0, hz - 4, x1 - x0, 6);
      },
      anim(ctx, K) {
        const T = K.T, hz = K.hz;
        // light shafts baked once (soft, low-res); two copies sway against each other: 2 blits a frame
        const o = K.soft('shafts', 4, Math.max(hz - 14, K.y0 - 2), hz + 8, (g, S) => {
          const sh = shaftSpr(K), n = Math.round((S.x1 - S.x0) / 3.2); g.globalCompositeOperation = 'lighter';
          for (let i = 0; i < n; i++) { const x = S.x0 + ((i + 0.5) / n) * (S.x1 - S.x0) + Math.sin(i * 2.7) * 1.2, w = 1.6 + (i % 3) * 0.9; g.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(i * 1.9)); g.save(); g.translate(x, hz - 14); g.transform(1, 0, 0.32, 1, 0, 0); g.drawImage(sh, -w / 2, 0, w, 22); g.restore(); }
        });
        ctx.globalCompositeOperation = 'lighter';
        if (!K.lowQ) { ctx.globalAlpha = 0.3 + 0.1 * Math.sin(T * 0.4); K.blitOut(o, Math.sin(T * 0.15) * 0.9, 0); }
        ctx.globalCompositeOperation = 'source-over';
        if (K.lowQ) { ctx.globalAlpha = 1; return; }
        const f = fishSpr(K, '#1d5a62'), span = K.x1 - K.x0 + 12; // a distant school drifting across
        const sx = K.x1 + 6 - ((T * 0.5) % span), sy = hz - 3 + Math.sin(T * 0.3) * 0.8;
        ctx.globalAlpha = 0.8;
        for (let i = 0; i < K.n(9); i++) { const ox = (i % 5) * 0.55 + Math.sin(T * 1.5 + i) * 0.12, oy = ((i * 3) % 7) * 0.22 + Math.cos(T * 1.2 + i * 2) * 0.1; ctx.drawImage(f, sx + ox, sy + oy, 0.42, 0.21); }
        ctx.globalAlpha = 1;
      },
    },
    { // mid: standing and toppled columns, kelp forests, the seafloor with coral below
      p: 0.42,
      paint(g, K) {
        const { x0, x1, y1 } = K, b = K.b, hz = K.hz, R = K.rng(33);
        g.fillStyle = K.lin(g, 0, hz + 1, 0, y1, [[0, '#1d5154'], [0.4, '#103539'], [1, '#061a1f']]);
        const fl = K.ridge({ x0: x0 - 1, x1: x1 + 1, y: hz + 2, amp: 0.6, seed: 9, step: 0.4, rough: 0.4 }); K.fillRidge(g, fl, y1);
        g.strokeStyle = 'rgba(160,220,200,0.12)'; g.lineWidth = 0.06; // sand ripples
        for (let i = 0; i < (x1 - x0) * (y1 - hz) * 0.05; i++) { const x = x0 + R() * (x1 - x0), y = hz + 3 + R() * (y1 - hz - 3); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 0.6, y - 0.15, x + 1.2, y); g.stroke(); }
        const out = (x, m = 2) => x < b.x0 - m || x > b.x1 + m;
        for (const side of [-1, 1]) {
          const ex = side < 0 ? b.x0 - 3.2 : b.x1 + 3.2;
          for (let i = 0; i < 6; i++) {
            const x = ex + side * i * 2.6, base = hz + 4 + i * 1.6 + R() * 1.2, w = 1 + R() * 0.25, tall = R() < 0.45;
            colm(g, K, x, base, w, base - (tall ? 7 + R() * 2 : 2 + R() * 3), { broken: !tall, cap: tall, seed: 40 + i + side * 9 });
            if (R() < 0.7) kelp(g, x + side * 0.9, base + 0.2, 2 + R() * 3, i + side * 3);
          }
          // a toppled drum or two on the floor
          for (let i = 0; i < 2; i++) { const x = ex + side * (2 + i * 6), y = hz + 8 + i * 4; g.fillStyle = K.lin(g, 0, y - 0.6, 0, y + 0.6, [[0, STONE_HI], [1, STONE_LO]]); g.beginPath(); g.ellipse(x, y, 1.1, 0.55, 0, 0, 6.283); g.fill(); g.fillStyle = '#7fa398'; g.beginPath(); g.ellipse(x + side * 1, y, 0.25, 0.55, 0, 0, 6.283); g.fill(); }
        }
        for (let i = 0; i < (x1 - x0) * 0.9; i++) { const x = x0 + R() * (x1 - x0), y = hz + 3 + R() * (y1 - hz - 3); if (!out(x) && y < b.y1 + 2) continue; if (R() < 0.5) coral(g, K, x, y, 0.8 + R() * 0.8, i); else kelp(g, x, y, 1 + R() * 2, i, R() < 0.5 ? '#2f7a4a' : '#3d8a52'); }
        g.fillStyle = K.lin(g, 0, b.y1 + 1, 0, y1, [[0, 'rgba(3,18,24,0)'], [1, 'rgba(3,18,24,0.7)']]); g.fillRect(x0, b.y1 + 1, x1 - x0, y1 - b.y1);
      },
      anim(ctx, K) { // fish crossing and bubbles from the floor
        if (K.lowQ && K.reduced) return;
        const T = K.T, b = K.b, hz = K.hz, span = K.x1 - K.x0 + 6;
        const F = [['#e9a05a', 0.7, hz + 2, 0.35], ['#7fd1e0', 0.55, b.y1 + 2.5, 0.5], ['#f2d36b', 0.6, hz + 9, 0.28], ['#c87fd0', 0.5, b.y0 + 4, 0.4]];
        F.slice(0, K.n(4)).forEach(([c, s, y, v], i) => {
          const dir = i % 2 ? 1 : -1, u = (T * v + i * 7) % span, x = dir > 0 ? K.x0 - 3 + u : K.x1 + 3 - u, yy = y + Math.sin(T * 0.7 + i) * 0.5;
          if (K.hidden(x - s, yy - s, x + s, yy + s)) return;
          ctx.save(); ctx.translate(x, yy); if (dir > 0) ctx.scale(-1, 1); ctx.drawImage(fishSpr(K, c), -s / 2, -s / 4, s, s / 2); ctx.restore();
        });
        const bs = bubbleSpr(K), R = K.rng(4);
        ctx.globalAlpha = 0.7;
        for (let i = 0; i < K.n(16); i++) { const x = K.x0 + R() * (K.x1 - K.x0), sp = 0.6 + R() * 0.8, ph = (T * sp * 0.08 + R()) % 1, y = K.y1 - ph * (K.y1 - K.y0), s = 0.12 + R() * 0.15; if (K.hidden(x, y, x + s, y + s)) continue; ctx.drawImage(bs, x + Math.sin(T * 2 + i) * 0.12, y, s, s); }
        ctx.globalAlpha = 1;
      },
    },
    { // rim: the temple floor's broken colonnade behind, carved borders at the sides, steps sinking at the front
      p: 1, r: 4.5, res: 0.85,
      paint(g, K) {
        const b = K.b, L = b.x0 - 0.7, Rr = b.x1 + 0.7, top = b.y0 - 0.7, bot = b.y1 + 0.7, R = K.rng(51);
        // stylobate behind the board and a row of column stumps/whole columns
        g.fillStyle = K.lin(g, 0, top - 0.9, 0, top, [[0, '#8fb3a8'], [1, '#2a4a4a']]); g.fillRect(L - 3.5, top - 0.9, Rr - L + 7, 0.95);
        const n = Math.round((Rr - L) / 2.2);
        for (let i = 0; i <= n; i++) { const x = L + (i * (Rr - L)) / n, whole = i === 0 || i === n || i % 3 === 1; colm(g, K, x, top - 0.75, 0.85, top - 0.75 - (whole ? 3.4 : 0.8 + R() * 1.3), { broken: !whole, cap: whole, seed: 60 + i }); }
        g.fillStyle = 'rgba(160,230,210,0.35)'; g.fillRect(L - 3.5, top - 0.92, Rr - L + 7, 0.06);
        // side borders: carved slabs with a meander frieze, weed and coral
        for (const side of [-1, 1]) {
          const ix = side < 0 ? L : Rr, w = 2.6, xa = side < 0 ? ix - w : ix;
          g.fillStyle = K.lin(g, ix, 0, ix + side * w, 0, [[0, '#24403f'], [0.15, '#6f948b'], [1, '#3a5a57']]); g.fillRect(xa, top - 0.1, w, bot - top + 2.3);
          g.strokeStyle = 'rgba(12,32,34,0.4)'; g.lineWidth = 0.03; g.beginPath(); for (let y = top + 1.2; y < bot + 2; y += 1.2) { g.moveTo(xa, y); g.lineTo(xa + w, y); } g.stroke();
          const mx = ix + side * 0.55; g.strokeStyle = 'rgba(200,240,225,0.45)'; g.lineWidth = 0.06; g.beginPath(); // meander (Greek key)
          for (let y = top + 0.1; y < bot + 1.8; y += 0.6) { g.moveTo(mx - 0.2, y); g.lineTo(mx + 0.2, y); g.lineTo(mx + 0.2, y + 0.4); g.lineTo(mx - 0.1, y + 0.4); g.lineTo(mx - 0.1, y + 0.2); g.lineTo(mx + 0.05, y + 0.2); } g.stroke();
          g.fillStyle = K.lin(g, ix, 0, ix + side * 0.5, 0, [[0, 'rgba(0,0,0,0.4)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(Math.min(ix, ix + side * 0.5), top, 0.5, bot - top);
          for (let y = top + 1; y < bot + 1.5; y += 1.1 + R() * 1.4) { const x = ix + side * (1.1 + R() * 1.3); if (R() < 0.55) coral(g, K, x, y, 0.7 + R() * 0.5, y * 9 + side); else { g.fillStyle = 'rgba(70,140,90,0.7)'; g.beginPath(); g.ellipse(x, y, 0.4, 0.18, 0, 0, 6.283); g.fill(); } }
          for (let y = top + 2; y < bot; y += 4.4) { g.fillStyle = '#e8d6c0'; g.beginPath(); g.moveTo(ix + side * 1.8, y); g.arc(ix + side * 1.8, y, 0.22, Math.PI, 0); g.fill(); g.strokeStyle = 'rgba(120,90,70,0.6)'; g.lineWidth = 0.025; g.beginPath(); for (let a = -2.8; a < -0.2; a += 0.45) { g.moveTo(ix + side * 1.8, y); g.lineTo(ix + side * 1.8 + Math.cos(a) * 0.22, y + Math.sin(a) * 0.22); } g.stroke(); }
        }
        // front: steps going down into the dark
        for (let i = 0; i < 4; i++) {
          const y = bot + i * 0.55, k = i / 4;
          g.fillStyle = K.mix('#7fa398', '#0d2328', k); g.fillRect(L - 0.4 - i * 0.3, y, Rr - L + 0.8 + i * 0.6, 0.18);
          g.fillStyle = K.mix('#3f625f', '#071619', k); g.fillRect(L - 0.4 - i * 0.3, y + 0.18, Rr - L + 0.8 + i * 0.6, 0.37);
        }
        g.fillStyle = K.lin(g, 0, bot + 1, 0, bot + 2.6, [[0, 'rgba(4,20,26,0)'], [1, 'rgba(4,20,26,0.9)']]); g.fillRect(L - 3.5, bot + 1, Rr - L + 7, 1.6);
        void STONE;
      },
      anim(ctx, K) { // weed swaying at the corners, bubbles leaking from the floor's cracks
        const b = K.b, L = b.x0 - 0.7, Rr = b.x1 + 0.7, top = b.y0 - 0.7, bot = b.y1 + 0.7, T = K.T;
        const sway = K.reduced ? 0.3 : 1;
        ctx.strokeStyle = '#3d8a52'; ctx.lineCap = 'round'; ctx.lineWidth = 0.1;
        const W = [[L - 0.9, top + 3], [L - 1.6, b.y1 - 2], [Rr + 0.9, top + 6], [Rr + 1.6, b.y1 - 4], [L - 0.5, bot + 0.4], [Rr + 0.5, bot + 0.4]];
        for (let i = 0; i < W.length; i++) { const [x, y] = W[i]; if (K.hidden(x - 1, y - 2, x + 1, y)) continue; ctx.beginPath(); ctx.moveTo(x, y); for (let s = 1; s <= 6; s++) ctx.lineTo(x + Math.sin(T * 0.9 + i + s * 0.5) * 0.08 * s * sway, y - s * 0.28); ctx.stroke(); }
        if (K.lowQ) return;
        const bs = bubbleSpr(K); ctx.globalAlpha = 0.85;
        const V = [[L - 1.3, top + 5], [Rr + 1.2, b.y1 - 1], [b.x0 + 4, bot + 0.6], [Rr + 1.8, top + 1]];
        V.forEach(([x, y], i) => { for (let j = 0; j < 3; j++) { const ph = (T * 0.35 + j / 3 + i * 0.21) % 1; ctx.drawImage(bs, x + Math.sin(T * 3 + j + i) * 0.08, y - ph * 3.5, 0.16 + j * 0.04, 0.16 + j * 0.04); } });
        ctx.globalAlpha = 1;
      },
    },
  ],
};

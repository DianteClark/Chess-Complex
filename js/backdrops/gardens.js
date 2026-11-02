// E1 15.0: Royal Gardens. A palace garden on a golden afternoon: domes and cypress rows on the horizon, clipped hedges and
// topiary, lawns striped by the gardeners, fountains, and white marble statues of the chess pieces standing guard around
// the board on a gravel parterre. Petals fall. Contract: see the top of js/backdrop.js.
import { getPath } from '../pieces.js';

const HEDGE = '#2f6b34', HEDGE_HI = '#5f9e4e', HEDGE_LO = '#173d1f', GRAVEL = '#d9ccb0';

function hedge(g, K, x0, y0, x1, y1, seed) { // clipped hedge block (3/4 view: top face + front face)
  const th = Math.min(0.5, (y1 - y0) * 0.45);
  g.fillStyle = K.lin(g, 0, y0 + th, 0, y1, [[0, HEDGE], [1, HEDGE_LO]]); g.fillRect(x0, y0 + th, x1 - x0, y1 - y0 - th);
  g.fillStyle = K.lin(g, 0, y0, 0, y0 + th, [[0, '#7cb860'], [1, HEDGE_HI]]); g.fillRect(x0, y0, x1 - x0, th);
  const R = K.rng(seed); g.fillStyle = 'rgba(20,50,20,0.35)';
  for (let i = 0; i < (x1 - x0) * (y1 - y0) * 5; i++) { g.beginPath(); g.arc(x0 + R() * (x1 - x0), y0 + th + R() * (y1 - y0 - th), 0.05 + R() * 0.06, 0, 6.283); g.fill(); }
  g.fillStyle = 'rgba(200,240,160,0.35)'; for (let i = 0; i < (x1 - x0) * 4; i++) { g.beginPath(); g.arc(x0 + R() * (x1 - x0), y0 + R() * th, 0.04 + R() * 0.05, 0, 6.283); g.fill(); }
}
function topiary(g, K, x, y, s, kind) { // ball / cone on a trunk in a pot
  g.fillStyle = 'rgba(30,40,20,0.3)'; g.beginPath(); g.ellipse(x, y + 0.02, 0.5 * s, 0.14 * s, 0, 0, 6.283); g.fill();
  g.fillStyle = '#b07a52'; g.fillRect(x - 0.22 * s, y - 0.3 * s, 0.44 * s, 0.3 * s); g.fillStyle = '#d29a6a'; g.fillRect(x - 0.25 * s, y - 0.34 * s, 0.5 * s, 0.07 * s);
  g.fillStyle = '#5a3b22'; g.fillRect(x - 0.035 * s, y - 0.75 * s, 0.07 * s, 0.45 * s);
  const fill = K.rad(g, x - 0.12 * s, y - 1.1 * s, 0.05 * s, 0.6 * s, [[0, '#86c568'], [0.6, HEDGE], [1, HEDGE_LO]]);
  g.fillStyle = fill;
  if (kind === 'cone') { g.beginPath(); g.moveTo(x, y - 2 * s); g.quadraticCurveTo(x + 0.45 * s, y - 0.9 * s, x + 0.36 * s, y - 0.7 * s); g.lineTo(x - 0.36 * s, y - 0.7 * s); g.quadraticCurveTo(x - 0.45 * s, y - 0.9 * s, x, y - 2 * s); g.fill(); }
  else { g.beginPath(); g.arc(x, y - 1.05 * s, 0.38 * s, 0, 6.283); g.fill(); }
}
function statue(g, K, piece, x, y, s, flip) { // a marble chess piece on a plinth, y = ground
  const pw = 0.62 * s;
  g.fillStyle = 'rgba(40,40,20,0.3)'; g.beginPath(); g.ellipse(x + 0.2 * s, y + 0.04, pw * 0.9, 0.16 * s, 0, 0, 6.283); g.fill();
  g.fillStyle = K.lin(g, x - pw / 2, 0, x + pw / 2, 0, [[0, '#cfc6b6'], [0.35, '#f4efe6'], [1, '#9c9384']]); g.fillRect(x - pw / 2, y - 0.55 * s, pw, 0.55 * s);
  g.fillStyle = '#fbf8f2'; g.fillRect(x - pw / 2 - 0.06 * s, y - 0.62 * s, pw + 0.12 * s, 0.09 * s); g.fillRect(x - pw / 2 - 0.04 * s, y - 0.06 * s, pw + 0.08 * s, 0.06 * s);
  g.save(); g.translate(x, y - 0.6 * s); g.scale(flip ? -s * 0.95 : s * 0.95, s * 0.95);
  const P = getPath(piece);
  g.fillStyle = K.lin(g, -0.3, 0, 0.3, 0, [[0, '#bdb4a4'], [0.3, '#fffdf8'], [0.6, '#e8e1d4'], [1, '#8e8576']]); g.fill(P);
  g.strokeStyle = 'rgba(90,80,64,0.55)'; g.lineWidth = 0.025; g.stroke(P);
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,240,200,0.25)'; g.fillRect(-0.4, -1.4, 0.18, 1.4); g.globalCompositeOperation = 'source-over';
  g.restore();
}
function fountain(g, K, x, y, s) { // basin seen in 3/4, the jet animates
  g.fillStyle = 'rgba(40,50,30,0.3)'; g.beginPath(); g.ellipse(x, y + 0.1 * s, 1.25 * s, 0.45 * s, 0, 0, 6.283); g.fill();
  g.fillStyle = K.lin(g, 0, y - 0.3 * s, 0, y + 0.35 * s, [[0, '#fbf6ec'], [1, '#a99f8c']]); g.beginPath(); g.ellipse(x, y, 1.15 * s, 0.42 * s, 0, 0, 6.283); g.fill();
  g.fillStyle = K.lin(g, 0, y - 0.3 * s, 0, y + 0.2 * s, [[0, '#7fc7de'], [1, '#3f8fb0']]); g.beginPath(); g.ellipse(x, y - 0.06 * s, 0.98 * s, 0.32 * s, 0, 0, 6.283); g.fill();
  g.fillStyle = '#efe8da'; g.fillRect(x - 0.09 * s, y - 0.75 * s, 0.18 * s, 0.7 * s);
  g.beginPath(); g.ellipse(x, y - 0.75 * s, 0.38 * s, 0.13 * s, 0, 0, 6.283); g.fill();
  g.fillStyle = '#8fd0e4'; g.beginPath(); g.ellipse(x, y - 0.78 * s, 0.3 * s, 0.09 * s, 0, 0, 6.283); g.fill();
}
function flowers(g, K, x0, y0, x1, y1, seed, cols) {
  const R = K.rng(seed);
  g.fillStyle = '#3d7a3a'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (let i = 0; i < (x1 - x0) * (y1 - y0) * 26; i++) { g.fillStyle = cols[(R() * cols.length) | 0]; g.beginPath(); g.arc(x0 + R() * (x1 - x0), y0 + R() * (y1 - y0), 0.04 + R() * 0.05, 0, 6.283); g.fill(); }
}
const petalSpr = (K, col) => K.sprite('petal' + col, 16, 12, (g) => { g.fillStyle = col; g.beginPath(); g.ellipse(8, 6, 6.5, 3.6, 0.4, 0, 6.283); g.fill(); g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(6.5, 5, 3, 1.2, 0.4, 0, 6.283); g.fill(); });
const jetSpr = (K) => K.sprite('gjet', 24, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(235,250,255,0)'); gr.addColorStop(0.2, 'rgba(235,250,255,0.9)'); gr.addColorStop(1, 'rgba(200,235,250,0.3)'); g.fillStyle = gr; g.beginPath(); g.moveTo(w / 2 - 2, h); g.quadraticCurveTo(w / 2 - 3, h * 0.2, w / 2, 0); g.quadraticCurveTo(w / 2 + 3, h * 0.2, w / 2 + 2, h); g.fill(); });

export default {
  id: 'gardens',
  base: '#9cc3dc',
  light: { tint: ['#fff4de', '#f6efe0'], glow: ['t', '#ffe0a0', 0.1], caustic: '#fff2c4' },
  layers: [
    { // sky: a warm late afternoon with soft clouds
      p: 0.04, res: 0.5,
      paint(g, K) {
        const { x0, y0, x1, y1 } = K, hz = K.hz;
        g.fillStyle = K.lin(g, 0, hz - 12, 0, hz + 1, [[0, '#5e97cf'], [0.5, '#9ec5e2'], [0.85, '#f1dcc0'], [1, '#f8cf9a']]); g.fillRect(x0, y0, x1 - x0, y1 - y0);
        const R = K.rng(7);
        for (let i = 0; i < (x1 - x0) * 0.35; i++) {
          const cx = x0 + R() * (x1 - x0), cy = hz - 3 - R() * 8, w = 2 + R() * 3;
          for (let j = 0; j < 6; j++) { const px = cx + (R() - 0.5) * w * 1.4, py = cy + (R() - 0.5) * w * 0.3, r = w * (0.25 + R() * 0.25); g.fillStyle = K.rad(g, px, py - r * 0.2, 0, r, [[0, 'rgba(255,252,246,0.95)'], [0.6, 'rgba(255,240,228,0.7)'], [1, 'rgba(240,220,215,0)']]); g.beginPath(); g.arc(px, py, r, 0, 6.283); g.fill(); }
        }
        g.globalAlpha = 0.55; g.drawImage(K.glow('#fff0c0'), (K.b.x0 + K.b.x1) / 2 + (K.wide ? 12 : 4) - 5, hz - 5, 10, 7); g.globalAlpha = 1;
      },
    },
    { // far: the palace, cypress rows, rolling hills
      p: 0.14, res: 0.7,
      paint(g, K) {
        const { x0, x1, y1 } = K, cx = (K.b.x0 + K.b.x1) / 2, hz = K.hz;
        const hill = K.ridge({ x0: x0 - 1, x1: x1 + 1, y: hz, amp: 1.2, seed: 2, step: 0.5, rough: 0.4 });
        g.fillStyle = K.lin(g, 0, hz - 2, 0, hz + 2, [[0, '#8fae8a'], [1, '#6f9670']]); K.fillRidge(g, hill, y1);
        const px = K.wide ? cx - 16 : cx, pb = hz + 0.2, haze = '#b9b7c9', hz2 = '#a5a3ba';
        g.fillStyle = haze; g.fillRect(px - 7, pb - 2.2, 14, 2.4); // wings
        g.fillStyle = hz2; for (let i = -6; i <= 6; i++) g.fillRect(px + i - 0.12, pb - 1.9, 0.24, 1.2); // windows
        g.fillStyle = haze; g.fillRect(px - 2.2, pb - 3.6, 4.4, 1.6); // central block
        g.beginPath(); g.arc(px, pb - 3.6, 2, Math.PI, 0); g.fill(); // dome
        g.fillRect(px - 0.12, pb - 6.2, 0.24, 0.7); g.beginPath(); g.arc(px, pb - 5.5, 0.35, 0, 6.283); g.fill();
        for (const s of [-1, 1]) { g.fillRect(px + s * 7 - 0.9, pb - 3.4, 1.8, 3.4); g.beginPath(); g.arc(px + s * 7, pb - 3.4, 0.9, Math.PI, 0); g.fill(); }
        g.fillStyle = 'rgba(255,236,200,0.45)'; g.beginPath(); g.arc(px + 0.5, pb - 3.7, 1.6, Math.PI * 1.1, Math.PI * 1.7); g.lineTo(px + 0.5, pb - 3.7); g.fill();
        const R = K.rng(12);
        for (let x = x0; x < x1; x += 0.7 + R() * 0.9) { if (Math.abs(x - px) < 8.5) continue; const h = 1.6 + R() * 1.4, y = hz + 0.4 + R() * 0.6; g.fillStyle = K.mix('#41664a', '#7f9c84', 0.35); g.beginPath(); g.ellipse(x, y - h / 2, 0.28, h / 2, 0, 0, 6.283); g.fill(); }
        g.fillStyle = K.lin(g, 0, hz - 3, 0, hz + 2, [[0, 'rgba(248,224,190,0)'], [1, 'rgba(248,224,190,0.35)']]); g.fillRect(x0, hz - 3, x1 - x0, 5);
      },
      anim(ctx, K) { // a couple of clouds drifting and birds
        if (K.lowQ) return;
        const T = K.T, span = K.x1 - K.x0 + 10;
        ctx.strokeStyle = 'rgba(60,60,80,0.6)'; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
        for (let i = 0; i < K.n(5); i++) { const x = K.x0 - 5 + ((T * 0.6 + i * 3.1) % span), y = K.hz - 6 + Math.sin(T * 0.4 + i) * 0.6 + (i % 3) * 0.7, f = Math.sin(T * (5 + i) + i) * 0.12; ctx.beginPath(); ctx.moveTo(x - 0.25, y - f); ctx.quadraticCurveTo(x - 0.1, y - 0.08, x, y); ctx.quadraticCurveTo(x + 0.1, y - 0.08, x + 0.25, y - f); ctx.stroke(); }
      },
    },
    { // mid: lawns, hedge walls and topiary at the sides, a great fountain below
      p: 0.42,
      paint(g, K) {
        const { x0, x1, y1 } = K, b = K.b, hz = K.hz, cx = (b.x0 + b.x1) / 2, R = K.rng(41);
        g.fillStyle = K.lin(g, 0, hz + 1, 0, y1, [[0, '#7fae62'], [0.5, '#5f9a4b'], [1, '#3f7a38']]); g.fillRect(x0, hz + 1, x1 - x0, y1 - hz);
        for (let x = Math.floor(x0); x < x1; x += 2) { g.fillStyle = 'rgba(255,255,220,0.08)'; g.fillRect(x, hz + 1, 1, y1 - hz); } // mowing stripes
        // hedge rows stepping away to the sides with topiary in front
        for (const side of [-1, 1]) {
          for (let i = 0; i < 6; i++) {
            const y = hz + 2 + i * 3.2, xa = side < 0 ? x0 - 1 : b.x1 + 3.5, xb = side < 0 ? b.x0 - 3.5 : x1 + 1;
            if (y > b.y1 + 6) break;
            hedge(g, K, xa, y, xb, y + 0.9 + i * 0.08, 60 + i + side * 7);
            for (let x = side < 0 ? xb - 1 : xa + 1; side < 0 ? x > xa : x < xb; x += side * (2.4 + R())) topiary(g, K, x, y + 2.4 + i * 0.1, 0.8 + i * 0.06, R() < 0.5 ? 'cone' : 'ball');
          }
        }
        // the great fountain and flower beds below the board
        const fy = b.y1 + 5.5;
        g.fillStyle = GRAVEL; g.beginPath(); g.ellipse(cx, fy + 0.2, 5, 1.8, 0, 0, 6.283); g.fill();
        flowers(g, K, cx - 9, fy - 1, cx - 5.5, fy + 1.2, 81, ['#f4a3b8', '#ffffff', '#f6d36b']); flowers(g, K, cx + 5.5, fy - 1, cx + 9, fy + 1.2, 82, ['#c79ae0', '#ffffff', '#f4a3b8']);
        fountain(g, K, cx, fy, 2.4);
        g.fillStyle = K.lin(g, 0, hz, 0, hz + 4, [[0, 'rgba(250,230,200,0.45)'], [1, 'rgba(250,230,200,0)']]); g.fillRect(x0, hz, x1 - x0, 4);
      },
      anim(ctx, K) {
        const b = K.b, cx = (b.x0 + b.x1) / 2, fy = b.y1 + 5.5, T = K.T;
        if (K.hidden(cx - 3, fy - 5, cx + 3, fy)) return;
        const j = jetSpr(K), h = 2.6 + (K.reduced ? 0 : Math.sin(T * 3) * 0.12);
        ctx.globalAlpha = 0.85; ctx.drawImage(j, cx - 0.35, fy - 1.85 - h, 0.7, h);
        if (!K.lowQ) for (let i = 0; i < K.n(10); i++) { const ph = (T * 0.8 + i / 10) % 1, a = (i / 10) * 6.283, r = ph * 1.6; ctx.globalAlpha = (1 - ph) * 0.8; ctx.fillStyle = '#e8f8ff'; ctx.fillRect(cx + Math.cos(a) * r - 0.04, fy - 1.85 - h + ph * 2.2 + ph * ph * 1.5 - 0.04 + h * (1 - Math.min(1, ph * 3)) * 0, 0.08, 0.08); }
        ctx.globalAlpha = 1;
      },
    },
    { // rim: the gravel parterre around the board, box hedges, statues of the pieces, corner fountains
      p: 1, r: 4.5, res: 0.85,
      paint(g, K) {
        const b = K.b, L = b.x0 - 0.7, Rr = b.x1 + 0.7, top = b.y0 - 0.7, bot = b.y1 + 0.7, cx = (b.x0 + b.x1) / 2, R = K.rng(71);
        // gravel all around, speckled
        const gx0 = L - 3.6, gx1 = Rr + 3.6, gy0 = top - 3.2, gy1 = bot + 2.4;
        // lawn panels, then a gravel walk 1.3 tiles wide around the board
        g.fillStyle = K.lin(g, 0, gy0, 0, gy1, [[0, '#6fa257'], [1, '#4f8a42']]); g.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
        for (let x = gx0; x < gx1; x += 1.6) { g.fillStyle = 'rgba(255,255,210,0.07)'; g.fillRect(x, gy0, 0.8, gy1 - gy0); }
        const wx0 = L - 1.3, wx1 = Rr + 1.3, wy0 = top - 1.3, wy1 = bot + 1.3;
        g.fillStyle = 'rgba(30,50,20,0.3)'; g.fillRect(wx0 - 0.08, wy0 - 0.08, wx1 - wx0 + 0.16, wy1 - wy0 + 0.16);
        g.fillStyle = K.lin(g, 0, wy0, 0, wy1, [[0, '#cbbb98'], [1, '#b5a47f']]); g.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
        for (let i = 0; i < (wx1 - wx0) * (wy1 - wy0) * 5; i++) { const x = wx0 + R() * (wx1 - wx0), y = wy0 + R() * (wy1 - wy0); if (x > L && x < Rr && y > top && y < bot) continue; g.fillStyle = R() < 0.5 ? 'rgba(110,92,64,0.35)' : 'rgba(255,248,230,0.35)'; g.fillRect(x, y, 0.05, 0.05); }
        // edge of the lawn: low box hedge bordering the parterre
        hedge(g, K, gx0 - 0.6, gy0 - 0.9, gx1 + 0.6, gy0 + 0.1, 72);
        for (const side of [-1, 1]) { const xa = side < 0 ? gx0 - 0.6 : gx1, xb = xa + 0.6; hedge(g, K, xa, gy0, xb, gy1, 73 + side); }
        hedge(g, K, gx0 - 0.6, gy1 - 0.2, gx1 + 0.6, gy1 + 0.6, 75);
        // a soft shadow ring and a marble kerb hugging the board's frame
        g.fillStyle = '#d9d1c1'; g.fillRect(L - 0.12, top - 0.12, Rr - L + 0.24, bot - top + 0.24);
        g.fillStyle = 'rgba(120,100,70,0.35)'; g.fillRect(L - 0.2, bot + 0.2, Rr - L + 0.4, 0.15);
        // flower beds along the sides
        for (const side of [-1, 1]) for (let y = top + 0.8; y < bot - 2; y += 4.6) { const x = side < 0 ? L - 2.95 : Rr + 1.65; flowers(g, K, x, y, x + 1.3, y + 2.6, y * 13 + side, side < 0 ? ['#f4a3b8', '#ffffff', '#e8607a'] : ['#c79ae0', '#ffffff', '#f6d36b']); g.strokeStyle = '#f4efe4'; g.lineWidth = 0.08; g.strokeRect(x, y, 1.3, 2.6); }
        // statues of the pieces behind the board and at the corners
        const span = Rr - L, set = ['rook', 'knight', 'bishop', 'king', 'queen', 'bishop', 'knight', 'rook'], n = span > 12 ? 6 : 4;
        for (let i = 0; i < n; i++) { const x = L + (span * (i + 0.5)) / n, pc = n === 6 ? ['rook', 'knight', 'king', 'queen', 'knight', 'rook'][i] : ['rook', 'king', 'queen', 'rook'][i]; topiary(g, K, x + span / n / 2, top - 0.5, 0.7, 'cone'); statue(g, K, pc, x, top - 0.45, 1.25, i >= n / 2); }
        void set;
        statue(g, K, 'bishop', L - 2.2, bot + 1.4, 1.2, false); statue(g, K, 'bishop', Rr + 2.2, bot + 1.4, 1.2, true);
        fountain(g, K, L - 1.9, top + 0.2, 0.9); fountain(g, K, Rr + 1.9, top + 0.2, 0.9);
        void cx;
      },
      anim(ctx, K) { // corner fountain jets and petals drifting past the margins
        const b = K.b, L = b.x0 - 0.7, Rr = b.x1 + 0.7, top = b.y0 - 0.7, T = K.T;
        const j = jetSpr(K);
        for (const x of [L - 1.9, Rr + 1.9]) { if (K.hidden(x - 1, top - 2, x + 1, top + 1)) continue; const h = 1.05 + (K.reduced ? 0 : Math.sin(T * 3 + x) * 0.06); ctx.globalAlpha = 0.85; ctx.drawImage(j, x - 0.14, top - 0.48 - h, 0.28, h); }
        ctx.globalAlpha = 1;
        if (K.lowQ) return;
        const cols = ['#f7b6c8', '#ffffff', '#f49ab4'], R = K.rng(3), n = K.n(18), wv = K.x1 - K.x0, hv = K.y1 - K.y0;
        for (let i = 0; i < n; i++) {
          const sp = 0.5 + R() * 0.5, ph = (T * sp * 0.05 + R()) % 1, x = K.x0 + ((R() * wv + ph * wv * 0.5) % wv), y = K.y0 + ph * hv, s = 0.16 + R() * 0.1;
          if (K.hidden(x - s, y - s, x + s, y + s)) continue;
          ctx.save(); ctx.translate(x + Math.sin(T * 1.3 + i) * 0.3, y); ctx.rotate(T * (0.8 + R()) + i); ctx.drawImage(petalSpr(K, cols[i % 3]), -s / 2, -s * 0.37, s, s * 0.75); ctx.restore();
        }
      },
    },
  ],
};

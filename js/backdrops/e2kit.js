// E2 15.0: shared painting helpers for the E2 location scenes (ruins, works, rift, bog) and the location wheel.
// Pure canvas helpers in board-tile units; nothing here touches the DOM except creating canvases.
const TAU = Math.PI * 2;
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mixH = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
export const shadeH = (h, k) => toHex(hex(h).map((v) => (k >= 0 ? v + (255 - v) * k : v * (1 + k))));
export const rgbaH = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };

// a vertical colour ramp in world y: stops [[y, '#hex'], ...] sorted by y. at(y) samples it, grad() builds a gradient.
export function ramp(stops) {
  const at = (y) => {
    if (y <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (y <= stops[i][0]) { const [ya, ca] = stops[i - 1], [yb, cb] = stops[i]; return mixH(ca, cb, (y - ya) / (yb - ya || 1)); }
    return stops[stops.length - 1][1];
  };
  const grad = (g, y0, y1, alpha = 1) => {
    const gr = g.createLinearGradient(0, y0, 0, y1), span = y1 - y0 || 1;
    gr.addColorStop(0, rgbaH(at(y0), alpha));
    for (const [y, c] of stops) if (y > y0 && y < y1) gr.addColorStop((y - y0) / span, rgbaH(c, alpha));
    gr.addColorStop(1, rgbaH(at(y1), alpha));
    return gr;
  };
  return { at, grad };
}

// ---------- chess statues (lathe profiles: [half width, height] from the base up, in units of the statue height) ----------
const ball = (cy, r, from = -90, to = 90, n = 10) => { const o = []; for (let i = 0; i <= n; i++) { const a = ((from + ((to - from) * i) / n) * Math.PI) / 180; o.push([Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
export const PROFILES = {
  pawn: [[0.34, 0], [0.34, 0.06], [0.28, 0.1], [0.26, 0.15], [0.17, 0.22], [0.12, 0.44], [0.2, 0.48], [0.2, 0.52], [0.12, 0.56], ...ball(0.75, 0.2, -65, 90, 9)],
  rook: [[0.36, 0], [0.36, 0.07], [0.3, 0.1], [0.3, 0.15], [0.23, 0.21], [0.2, 0.7], [0.27, 0.74], [0.27, 0.78], [0.29, 0.8], [0.29, 1]],
  bishop: [[0.34, 0], [0.34, 0.06], [0.28, 0.1], [0.26, 0.15], [0.16, 0.22], [0.11, 0.55], [0.2, 0.58], [0.2, 0.62], [0.11, 0.64], [0.17, 0.72], [0.18, 0.79], [0.13, 0.88], [0.04, 0.93], ...ball(0.97, 0.05, -40, 90, 4)],
  king: [[0.35, 0], [0.35, 0.06], [0.29, 0.1], [0.27, 0.14], [0.17, 0.2], [0.12, 0.58], [0.21, 0.61], [0.21, 0.65], [0.13, 0.67], [0.23, 0.79], [0.23, 0.82], [0.12, 0.84], [0.06, 0.86], [0.035, 0.86], [0.035, 0.9], [0.09, 0.9], [0.09, 0.94], [0.035, 0.94], [0.035, 1]],
  queen: [[0.35, 0], [0.35, 0.06], [0.29, 0.1], [0.27, 0.14], [0.17, 0.2], [0.12, 0.58], [0.21, 0.61], [0.21, 0.65], [0.13, 0.67], [0.24, 0.85], [0.17, 0.86], ...ball(0.9, 0.06, -60, 90, 5)],
};
function profilePath(g, prof, x, base, h) {
  g.beginPath();
  for (let i = 0; i < prof.length; i++) { const [w, y] = prof[i]; if (i) g.lineTo(x - w * h, base - y * h); else g.moveTo(x - w * h, base - y * h); }
  for (let i = prof.length - 1; i >= 0; i--) { const [w, y] = prof[i]; g.lineTo(x + w * h, base - y * h); }
  g.closePath();
}
// A giant stone chess piece. o: { x, base, h, type, dark, mid, lite, light: -1 (lit from left) .. 1 (right), seed,
//   broken: 0..1 (fraction of the top snapped off), lean (radians), cracks, rim: '#hex' rim light, flat (no shading, for far haze) }
export function statue(g, o) {
  const { x, base, h, type = 'rook', light = 1, seed = 1, broken = 0, lean = 0 } = o;
  const prof = PROFILES[type] || PROFILES.rook, R = rnd(seed), wmax = 0.37 * h;
  g.save(); g.translate(x, base); g.rotate(lean); g.translate(-x, -base);
  if (broken > 0) { // jagged fracture: keep everything below a ragged diagonal
    const yb = base - h * (1 - broken), tilt = (R() - 0.5) * h * 0.35;
    g.beginPath(); g.moveTo(x - wmax * 1.6, base + 1); g.lineTo(x - wmax * 1.6, yb - tilt);
    const n = 9; for (let i = 1; i < n; i++) { const t = i / n; g.lineTo(x - wmax * 1.6 + t * wmax * 3.2, yb - tilt + t * tilt * 2 + (R() - 0.5) * h * 0.09); }
    g.lineTo(x + wmax * 1.6, yb + tilt); g.lineTo(x + wmax * 1.6, base + 1); g.closePath(); g.clip();
  }
  profilePath(g, prof, x, base, h);
  if (o.flat) { g.fillStyle = o.mid; g.fill(); }
  else {
    const sh = g.createLinearGradient(x - wmax, 0, x + wmax, 0), L = light >= 0;
    sh.addColorStop(0, L ? o.dark : o.lite); sh.addColorStop(0.35, o.mid); sh.addColorStop(L ? 0.72 : 0.28, L ? o.lite : o.mid); sh.addColorStop(1, L ? o.mid : o.dark);
    g.fillStyle = sh; g.fill();
    g.save(); g.clip();
    // horizontal masonry courses and a few vertical joints
    g.strokeStyle = rgbaH(o.dark, 0.35); g.lineWidth = h * 0.006;
    for (let yy = 0.12; yy < 1; yy += 0.07 + R() * 0.03) { g.beginPath(); g.moveTo(x - wmax, base - yy * h); g.lineTo(x + wmax, base - yy * h); g.stroke(); }
    if (o.cracks !== false) {
      g.strokeStyle = rgbaH(o.dark, 0.75); g.lineWidth = h * 0.008;
      for (let c = 0; c < 3; c++) { let cx = x + (R() - 0.5) * wmax, cy = base - h * (0.25 + R() * 0.6); g.beginPath(); g.moveTo(cx, cy); for (let s = 0; s < 5; s++) { cx += (R() - 0.5) * h * 0.06; cy += h * (0.02 + R() * 0.04); g.lineTo(cx, cy); } g.stroke(); }
    }
    if (type === 'rook') { // window slits
      g.fillStyle = rgbaH(o.dark, 0.85);
      for (const yy of [0.35, 0.55]) { g.beginPath(); g.ellipse(x + (light >= 0 ? -1 : 1) * wmax * 0.15, base - yy * h, h * 0.018, h * 0.05, 0, 0, TAU); g.fill(); }
    }
    // ambient occlusion at the foot
    const ao = g.createLinearGradient(0, base - h * 0.22, 0, base); ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, rgbaH(o.dark, 0.55)); g.fillStyle = ao; g.fillRect(x - wmax, base - h * 0.22, wmax * 2, h * 0.22);
    g.restore();
    if (o.rim) { g.strokeStyle = o.rim; g.lineWidth = h * 0.012; profilePath(g, prof, x + (light >= 0 ? 1 : -1) * h * 0.004, base, h); g.save(); g.clip(); g.stroke(); g.restore(); }
  }
  if (type === 'rook') { // crenellation gaps
    g.globalCompositeOperation = 'destination-out';
    for (const f of [-0.12, 0.12]) g.fillRect(x + f * h - h * 0.045, base - h * 1.01, h * 0.09, h * 0.09);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  return { top: base - h * (1 - broken), w: wmax };
}

// a smooth dune crest from x0 to x1 peaking at (px, y - hgt), lit from `light` side; filled down to `bottom`
export function dune(g, { x0, x1, px, y, hgt, bottom, lite, dark, crest, lee = null }) {
  if (!(bottom > y - hgt)) return;
  g.beginPath(); g.moveTo(x0, bottom); g.lineTo(x0, y);
  g.bezierCurveTo(x0 + (px - x0) * 0.5, y, px - (px - x0) * 0.25, y - hgt, px, y - hgt);
  g.bezierCurveTo(px + (x1 - px) * 0.18, y - hgt * 0.96, x1 - (x1 - px) * 0.4, y, x1, y);
  g.lineTo(x1, bottom); g.closePath();
  const gr = g.createLinearGradient(0, y - hgt, 0, bottom); gr.addColorStop(0, lite); gr.addColorStop(Math.max(0, Math.min(1, (hgt / Math.max(0.01, bottom - y + hgt)) * 1.6)), dark); gr.addColorStop(1, dark);
  g.fillStyle = gr; g.fill();
  // the shadowed lee side: right of the crest
  g.save(); g.clip();
  g.beginPath(); g.moveTo(px, y - hgt); g.bezierCurveTo(px + (x1 - px) * 0.1, y - hgt * 0.3, px + (x1 - px) * 0.4, y + (bottom - y) * 0.2, px + (x1 - px) * 0.25, bottom); g.lineTo(x1 + 1, bottom); g.lineTo(x1 + 1, y - hgt - 1); g.closePath();
  g.fillStyle = lee || rgbaH(dark, 0.55); g.fill();
  g.restore();
  if (crest) { g.strokeStyle = crest; g.lineWidth = 0.05; g.beginPath(); g.moveTo(x0 + (px - x0) * 0.35, y - hgt * 0.35); g.bezierCurveTo(px - (px - x0) * 0.25, y - hgt * 0.9, px - 0.2, y - hgt, px, y - hgt); g.stroke(); }
}

export function rnd(seed) { let a = (seed * 2654435761) >>> 0 || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// keep a reference to a baked layer canvas so an anim can re-draw slices of it (heat haze, water ripples)
export function grab(g, K) { return { c: g.canvas, k: K.k, x0: K.x0, y0: K.y0, x1: K.x1, y1: K.y1 }; }
// redraw horizontal slices [ya, yb] of a grabbed layer shifted by dx(y): a cheap refraction shimmer
export function shimmer(ctx, P, K, ya, yb, n, dx) {
  if (!P || !P.c) return;
  const xa = Math.max(P.x0, K.x0), xb = Math.min(P.x1, K.x1); if (xb <= xa) return;
  const hs = (yb - ya) / n;
  for (let i = 0; i < n; i++) {
    const y = ya + i * hs, sx = (xa - P.x0) * P.k, sy = (y - P.y0) * P.k;
    if (sy < 0 || sy + hs * P.k > P.c.height) continue;
    ctx.drawImage(P.c, sx, sy, (xb - xa) * P.k, hs * P.k, xa + dx(y, i), y, xb - xa, hs + 0.01);
  }
}
// soft streak sprite (a horizontal line that fades at both ends), made once per colour
const STREAK = new Map();
export function streak(col) {
  let c = STREAK.get(col); if (c) return c;
  c = document.createElement('canvas'); c.width = 128; c.height = 8; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, rgbaH(col, 0)); gr.addColorStop(0.65, rgbaH(col, 1)); gr.addColorStop(1, rgbaH(col, 0));
  g.fillStyle = gr; g.beginPath(); g.ellipse(64, 4, 64, 2.2, 0, 0, TAU); g.fill();
  STREAK.set(col, c); return c;
}
export const TAU_ = TAU;

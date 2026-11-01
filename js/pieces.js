// Chess Complex piece art (10.0, A4).
// Pieces are sculpted signed-distance models, ray-marched once per (piece, resolution) into a skin-independent
// G-buffer (normal, position, material id, ambient occlusion, soft shadow, creases). Each skin is then a cheap
// per-pixel material pass (stone, porcelain, metal, glass, crystal, jade, magma, neon, cosmic, ...) baked into a
// cached sprite. Animated skins get 2-3 additive overlay sprites that crossfade (shimmer, lava flow, twinkle,
// circuit pulses), so a live drawPiece() costs 1-3 drawImage calls.
// Coordinates (unchanged API): origin at base centre, 1 unit = 1 tile, up is negative y.
import { SKINS } from './data.js';

export const HOLLOW_SKIN = { body: ['#b9b5e6', '#2a2846'], rim: '#e6e3ff', glow: '#8f8cff', line: '#120f26', fx: 'wisp', mat: 'ghost', eye: '#bff6ff' };
export const COLOSSUS_SKIN = { body: ['#8e7bb0', '#1a1226'], rim: '#efe2ff', glow: '#b26bff', line: '#0a0611', fx: 'star', mat: 'colossus', pattern: 'cracks', emissive: 0.8, eye: '#f0d6ff' };
export const skinOf = (id) => (id === 'hollow' ? HOLLOW_SKIN : id === 'colossus-boss' ? COLOSSUS_SKIN : SKINS[id] || SKINS.ivory);

// Projected top of each piece (sprite units, used by the renderer for labels/bars).
export const PIECE_TOP = { pawn: -0.86, rook: -0.98, bishop: -1.15, knight: -1.16, queen: -1.1, king: -1.33, hollow: -0.98, colossus: -1.32 };
// Use for the Siege boss: drawPiece(ctx, pieceKind(u), u.skin, ...) gives the Colossus its own model.
export const pieceKind = (u) => (u && u.boss ? 'colossus' : u ? u.piece : 'pawn');

let MOTION = true, MOTION_SET = false, motionTick = 0;
// Reduced-motion hook: setPieceMotion(false) freezes skin animation (drawPiece then draws the t=0 frame).
// Without an explicit call, the body.reduced class (Settings > Reduce motion) is honoured automatically.
export function setPieceMotion(on) { MOTION = !!on; MOTION_SET = true; }

// ---------------------------------------------------------------- math
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);
function smin(a, b, k) { const h = sat(0.5 + 0.5 * (b - a) / k); return mix(b, a, h) - k * h * (1 - h); }
const SQ = Math.sqrt, AB = Math.abs, MX = Math.max, MN = Math.min;

const CAM_E = 16 * Math.PI / 180, SE = Math.sin(CAM_E), CE = Math.cos(CAM_E);
// key light upper-left-front, rim light back-right, view vector
const L = norm3(-0.52, -0.72, 0.46), LR = norm3(0.85, -0.25, -0.45), V = [0, -SE, CE];
const HV = norm3(L[0] + V[0], L[1] + V[1], L[2] + V[2]);
function norm3(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }

// ---------------------------------------------------------------- noise
function h3(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = mix(h3(xi, yi, zi), h3(xi + 1, yi, zi), fx), b = mix(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), fx);
  const c = mix(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), fx), d = mix(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), fx);
  return mix(mix(a, b, fy), mix(c, d, fy), fz);
}
function fbm(x, y, z, o = 3) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, o)); }
// cellular: returns F2-F1 (edge distance) in VOR_E, F1 in VOR_F, cell hash in VOR_H
let VOR_E = 0, VOR_F = 0, VOR_H = 0;
function voronoi(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let f1 = 9, f2 = 9, hh = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const dx = cx + h3(cx, cy, cz) - x, dy = cy + h3(cy, cz, cx) - y, dz = cz + h3(cz, cx, cy) - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; hh = h3(cx + 7, cy, cz); } else if (d < f2) f2 = d;
  }
  VOR_F = SQ(f1); VOR_E = SQ(f2) - VOR_F; VOR_H = hh;
}

// ---------------------------------------------------------------- lathe profiles
// A turned piece is r(y): a table of radii (max over shapes) with a material id per row.
const LY0 = -1.46, LN = 730, LDY = -LY0 / LN;
function makeLathe(shapes) {
  const R = new Float32Array(LN + 1), K = new Float32Array(LN + 1), M = new Uint8Array(LN + 1);
  for (let i = 0; i <= LN; i++) {
    const y = LY0 + i * LDY; let best = -1, m = 0;
    for (const s of shapes) if (y >= s.y0 && y <= s.y1) { const r = s.f(y); if (r > best) { best = r; m = s.m || 0; } }
    R[i] = best; M[i] = m;
  }
  // empty rows: negative distance to the nearest filled row keeps the field conservative
  let last = -1e9;
  for (let i = 0; i <= LN; i++) { if (R[i] >= 0) last = i; else R[i] = -(i - last) * LDY; }
  last = 1e9;
  for (let i = LN; i >= 0; i--) { if (R[i] >= 0) last = i; else R[i] = MX(R[i], -(last - i) * LDY); }
  const s = new Float32Array(LN + 1);
  for (let i = 0; i <= LN; i++) { const a = R[MX(0, i - 1)], b = R[MN(LN, i + 1)]; const d = (b - a) / (2 * LDY); s[i] = 1 / SQ(1 + d * d); }
  const W = 22; // window: about 0.044 units
  for (let i = 0; i <= LN; i++) { let k = 1; for (let j = MX(0, i - W); j <= MN(LN, i + W); j++) if (s[j] < k) k = s[j]; K[i] = MX(0.14, k); }
  return { R, K, M };
}
let MT = 0; // material id of the closest surface (set by scene functions)
function latheD(T, x, y, z) {
  const f = (y - LY0) / LDY;
  if (f < 0) return LY0 - y + 0.02;
  const i = f > LN - 1 ? LN - 1 : f | 0, t = f - i;
  const r = T.R[i] + (T.R[i + 1] - T.R[i]) * t, k = T.K[i] < T.K[i + 1] ? T.K[i] : T.K[i + 1];
  MT = T.M[t < 0.5 ? i : i + 1];
  const d = (SQ(x * x + z * z) - r) * k;
  return d > y ? d : y;
}
// profile shape helpers: each returns {y0,y1,f,m}
const sph = (cy, R, m = 0) => ({ y0: cy - R, y1: cy + R, f: (y) => SQ(MX(0, R * R - (y - cy) * (y - cy))), m });
const ring = (cy, a, R0, m = 0) => ({ y0: cy - a, y1: cy + a, f: (y) => R0 + SQ(MX(0, a * a - (y - cy) * (y - cy))), m });
const disk = (y0, y1, r, b, m = 0) => ({ y0, y1, m, f: (y) => { const e = MN(y - y0, y1 - y); return e >= b ? r : r - b + SQ(MX(0, b * b - (b - e) * (b - e))); } });
// smooth monotone cubic through [y, r] points (ascending y)
function curve(pts, m = 0) {
  const n = pts.length, dl = [], tg = [];
  for (let i = 0; i < n - 1; i++) dl.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  for (let i = 0; i < n; i++) {
    if (i === 0) tg.push(dl[0]); else if (i === n - 1) tg.push(dl[n - 2]);
    else tg.push(dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2);
  }
  return { y0: pts[0][0], y1: pts[n - 1][0], m, f: (y) => {
    let i = 0; while (i < n - 2 && y > pts[i + 1][0]) i++;
    const [ya, ra] = pts[i], [yb, rb] = pts[i + 1], h = yb - ya, t = (y - ya) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ra + (t3 - 2 * t2 + t) * h * tg[i] + (-2 * t3 + 3 * t2) * rb + (t3 - t2) * h * tg[i + 1];
  } };
}
// Staunton foot shared by every chess piece
const FOOT = () => [disk(-0.075, 0, 0.29, 0.03), curve([[-0.1, 0.25], [-0.088, 0.262], [-0.075, 0.27]]), ring(-0.118, 0.03, 0.222, 1), disk(-0.165, -0.1, 0.235, 0.012)];

// ---------------------------------------------------------------- primitives
const sdSph = (x, y, z, cx, cy, cz, r) => SQ((x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz)) - r;
function sdBox(x, y, z, bx, by, bz, r = 0) {
  const qx = AB(x) - bx + r, qy = AB(y) - by + r, qz = AB(z) - bz + r;
  const ax = qx > 0 ? qx : 0, ay = qy > 0 ? qy : 0, az = qz > 0 ? qz : 0;
  return SQ(ax * ax + ay * ay + az * az) + MN(MX(qx, MX(qy, qz)), 0) - r;
}
// plain box distance used as a conservative bound
function bb(x, y, z, cx, cy, cz, hx, hy, hz) { const qx = AB(x - cx) - hx, qy = AB(y - cy) - hy, qz = AB(z - cz) - hz; const ax = qx > 0 ? qx : 0, ay = qy > 0 ? qy : 0, az = qz > 0 ? qz : 0; return SQ(ax * ax + ay * ay + az * az) + MN(MX(qx, MX(qy, qz)), 0); }
function sdCap(x, y, z, ax, ay, az, bx, by, bz, r) {
  const px = x - ax, py = y - ay, pz = z - az, ex = bx - ax, ey = by - ay, ez = bz - az;
  const h = sat((px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez));
  const dx = px - ex * h, dy = py - ey * h, dz = pz - ez * h;
  return SQ(dx * dx + dy * dy + dz * dz) - r;
}
// cone-capsule with radii ra -> rb
function sdCone(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const px = x - ax, py = y - ay, pz = z - az, ex = bx - ax, ey = by - ay, ez = bz - az;
  const h = sat((px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez));
  const dx = px - ex * h, dy = py - ey * h, dz = pz - ez * h;
  return SQ(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}
function sdEll(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz, bx = ax / rx, by = ay / ry, bz = az / rz;
  const k0 = SQ(ax * ax + ay * ay + az * az), k1 = SQ(bx * bx + by * by + bz * bz);
  return k1 < 1e-9 ? -MN(rx, ry, rz) : k0 * (k0 - 1) / k1;
}
// fold the polar angle around +z (viewer) into a sector of 2pi/n; returns local angle in FOLD_A
let FOLD_A = 0;
function fold(x, z, n, off = 0) { const a = Math.atan2(z, x) - Math.PI / 2 - off, s = 2 * Math.PI / n; FOLD_A = a - s * Math.round(a / s); return FOLD_A; }

// 2D polygon SDF baked into a grid (knight head). Exact within a band of +-BAND, clamped beyond (conservative).
function polyGrid(pts, x0, x1, y0, y1, cell) {
  const BAND = 0.1, nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1, g = new Float32Array(nx * ny).fill(BAND * BAND), n = pts.length;
  const PX = new Float64Array(n), PY = new Float64Array(n); for (let i = 0; i < n; i++) { PX[i] = pts[i][0]; PY[i] = pts[i][1]; }
  for (let a = 0, b = n - 1; a < n; b = a++) {
    const ax = PX[a], ay = PY[a], bx = PX[b], by = PY[b], ex = bx - ax, ey = by - ay, el = ex * ex + ey * ey || 1e-9;
    const i0 = MX(0, Math.floor((MN(ax, bx) - BAND - x0) / cell)), i1 = MN(nx - 1, Math.ceil((MX(ax, bx) + BAND - x0) / cell));
    const j0 = MX(0, Math.floor((MN(ay, by) - BAND - y0) / cell)), j1 = MN(ny - 1, Math.ceil((MX(ay, by) + BAND - y0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const wx = x0 + i * cell - ax, wy = y0 + j * cell - ay, h = sat((wx * ex + wy * ey) / el), dx = wx - ex * h, dy = wy - ey * h, dd = dx * dx + dy * dy;
      const k = j * nx + i; if (dd < g[k]) g[k] = dd;
    }
  }
  const xs = [];
  for (let j = 0; j < ny; j++) { // scanline parity for the sign
    const py = y0 + j * cell; xs.length = 0;
    for (let a = 0, b = n - 1; a < n; b = a++) { const ax = PX[a], ay = PY[a], bx = PX[b], by = PY[b]; if ((ay > py) !== (by > py)) xs.push(ax + (bx - ax) * (py - ay) / (by - ay)); }
    xs.sort((p, q) => p - q);
    for (let i = 0; i < nx; i++) {
      const px = x0 + i * cell; let c = 0; for (let q = 0; q < xs.length; q++) if (xs[q] > px) c++;
      const k = j * nx + i; g[k] = (c & 1) ? -SQ(g[k]) : SQ(g[k]);
    }
  }
  return { g, nx, ny, x0, y0, cell };
}
function sampG(G, x, y) {
  const fx = (x - G.x0) / G.cell, fy = (y - G.y0) / G.cell;
  if (fx < 0 || fy < 0 || fx >= G.nx - 1 || fy >= G.ny - 1) {
    const cx = clamp(fx, 0, G.nx - 1.001), cy = clamp(fy, 0, G.ny - 1.001);
    return sampG(G, G.x0 + cx * G.cell, G.y0 + cy * G.cell) + Math.hypot((fx - cx) * G.cell, (fy - cy) * G.cell);
  }
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * G.nx + i, g = G.g;
  return mix(mix(g[k], g[k + 1], tx), mix(g[k + G.nx], g[k + G.nx + 1], tx), ty);
}
// Catmull-Rom resample of a closed polygon
function smoothPoly(pts, sub = 6) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- scenes
// material ids: 0 body, 1 trim/accent, 2 jewel/core, 3 cavity/velvet, 4 eye
const SCENES = {}, LAZY = {};
function scene(name, rb, top, fn) { SCENES[name] = { rb, top, fn }; }
// scenes are built on first use (keeps module load instant)
const getScene = (name) => SCENES[name] || (LAZY[name] ? (LAZY[name](), SCENES[name]) : getScene('pawn'));

LAZY.pawn = () => { // PAWN
  const T = makeLathe([...FOOT(),
    curve([[-0.5, 0.098], [-0.42, 0.104], [-0.33, 0.124], [-0.24, 0.16], [-0.17, 0.205], [-0.15, 0.215]]),
    disk(-0.535, -0.49, 0.152, 0.018, 1), ring(-0.5, 0.022, 0.135, 1),
    curve([[-0.575, 0.08], [-0.555, 0.086], [-0.535, 0.1]]),
    sph(-0.708, 0.158),
  ]);
  scene('pawn', 0.3, -0.9, (x, y, z) => latheD(T, x, y, z));
};
LAZY.rook = () => { // ROOK
  const T = makeLathe([...FOOT(),
    curve([[-0.74, 0.178], [-0.6, 0.176], [-0.45, 0.184], [-0.3, 0.2], [-0.19, 0.222], [-0.155, 0.232]]),
    ring(-0.745, 0.022, 0.172, 1),
    curve([[-0.8, 0.236], [-0.79, 0.226], [-0.775, 0.2], [-0.76, 0.18]]),
    disk(-1.0, -0.79, 0.248, 0.016),
  ]);
  scene('rook', 0.3, -1.02, (x, y, z) => {
    let d = latheD(T, x, y, z); const m = MT;
    if (y < -0.84) {
      const rho = SQ(x * x + z * z);
      d = MX(d, -MX(0.172 - rho, y + 0.9)); // pit
      fold(x, z, 6, Math.PI / 6); // gap centres between merlons; a merlon faces the viewer
      const notch = MX(AB(rho * Math.sin(FOLD_A)) - 0.048, y + 0.905);
      d = MX(d, -notch);
    }
    MT = m;
    // arrow slit
    if (y > -0.6 && y < -0.32 && z > 0.12) {
      const s = sdBox(x, y + 0.47, z - 0.2, 0.022, 0.085, 0.04, 0.012);
      if (-s > d) { d = -s; MT = 3; }
    }
    return d;
  });
};
LAZY.bishop = () => { // BISHOP
  const T = makeLathe([...FOOT(),
    curve([[-0.56, 0.09], [-0.47, 0.097], [-0.37, 0.115], [-0.27, 0.148], [-0.19, 0.198], [-0.155, 0.215]]),
    disk(-0.6, -0.555, 0.15, 0.016, 1), ring(-0.565, 0.02, 0.132, 1), ring(-0.615, 0.016, 0.102, 1),
    curve([[-1.06, 0.0], [-1.04, 0.045], [-0.99, 0.1], [-0.9, 0.148], [-0.81, 0.162], [-0.73, 0.15], [-0.66, 0.115], [-0.625, 0.085]]),
    curve([[-1.075, 0.018], [-1.06, 0.024], [-1.045, 0.02]]),
    sph(-1.11, 0.04, 1),
  ]);
  const nx = Math.cos(0.72), ny = Math.sin(0.72);
  scene('bishop', 0.3, -1.16, (x, y, z) => {
    let d = latheD(T, x, y, z);
    if (y < -0.68 && y > -1.03 && z > -0.03) { // mitre slot, front half only
      const s = MX(AB((x - 0.01) * nx + (y + 0.875) * ny) - 0.017, -z - 0.02);
      if (-s > d) { d = -s; MT = 0; }
    }
    return d;
  });
};
LAZY.queen = () => { // QUEEN
  const T = makeLathe([...FOOT(),
    curve([[-0.67, 0.088], [-0.58, 0.092], [-0.47, 0.105], [-0.36, 0.13], [-0.26, 0.165], [-0.19, 0.205], [-0.155, 0.218]]),
    disk(-0.715, -0.67, 0.155, 0.016, 1), ring(-0.68, 0.02, 0.137, 1), ring(-0.735, 0.018, 0.108, 1),
    curve([[-1.03, 0.205], [-0.98, 0.196], [-0.92, 0.17], [-0.86, 0.13], [-0.8, 0.098], [-0.755, 0.088]]),
  ]);
  scene('queen', 0.3, -1.12, (x, y, z) => {
    let d = latheD(T, x, y, z);
    if (y < -0.86) {
      d = MX(d, -sdSph(x, y, z, 0, -1.07, 0, 0.18)); // bowl
      fold(x, z, 9);
      const a = AB(FOLD_A) / (Math.PI / 9), yTop = -1.03 + 0.1 * Math.pow(a, 0.85);
      d = MX(d, (yTop - y) * 0.6); // coronet points
      const rho = SQ(x * x + z * z), lx = rho * Math.cos(FOLD_A) - 0.2, lz = rho * Math.sin(FOLD_A);
      const b = SQ(lx * lx + (y + 1.045) * (y + 1.045) + lz * lz) - 0.028;
      MT = 0; if (b < d) { d = b; MT = 2; }
    }
    const dome = sdSph(x, y, z, 0, -0.955, 0, 0.098); if (dome < d) { d = smin(d, dome, 0.01); MT = 0; }
    const top = sdSph(x, y, z, 0, -1.085, 0, 0.042); if (top < d) { d = top; MT = 1; }
    return d;
  });
};
LAZY.king = () => { // KING
  const T = makeLathe([...FOOT(),
    curve([[-0.69, 0.094], [-0.6, 0.098], [-0.49, 0.112], [-0.37, 0.136], [-0.27, 0.168], [-0.19, 0.208], [-0.155, 0.22]]),
    disk(-0.74, -0.69, 0.162, 0.016, 1), ring(-0.7, 0.022, 0.142, 1), ring(-0.758, 0.018, 0.115, 1),
    curve([[-0.97, 0.198], [-0.93, 0.19], [-0.87, 0.172], [-0.81, 0.15], [-0.77, 0.13]], 1),
  ]);
  scene('king', 0.3, -1.38, (x, y, z) => {
    let d = latheD(T, x, y, z), m = MT;
    if (y < -0.82) {
      d = MX(d, -sdSph(x, y, z, 0, -1.02, 0, 0.19)); // crown bowl
      fold(x, z, 8);
      const a = AB(FOLD_A) / (Math.PI / 8), yTop = -1.04 + 0.085 * Math.pow(a, 0.7);
      d = MX(d, (yTop - y) * 0.55); m = 1;
      const rho = SQ(x * x + z * z), lx = rho * Math.cos(FOLD_A) - 0.205, lz = rho * Math.sin(FOLD_A);
      const pearl = SQ(lx * lx + (y + 1.05) * (y + 1.05) + lz * lz) - 0.022;
      if (pearl < d) { d = pearl; m = 1; }
    }
    MT = m;
    // jewels around the band
    if (y < -0.8 && y > -0.92) {
      fold(x, z, 8, Math.PI / 8);
      const rho = SQ(x * x + z * z), lx = rho * Math.cos(FOLD_A) - 0.178, lz = rho * Math.sin(FOLD_A);
      const j = sdEll(lx, y + 0.86, lz, 0.026, 0.032, 0.026);
      if (j < d) { d = j; MT = 2; }
    }
    // velvet cap
    const cap = sdSph(x, y, z, 0, -0.9, 0, 0.165); if (cap < d) { d = cap; MT = 3; }
    // arches
    if (y < -0.95) {
      const yy = (y + 0.95) * (y + 0.95), q1 = SQ(x * x + yy) - 0.165, a1 = MX(SQ(q1 * q1 + z * z) - 0.024, y + 0.97);
      const q2 = SQ(z * z + yy) - 0.165, a2 = MX(SQ(q2 * q2 + x * x) - 0.024, y + 0.97);
      const a = MN(a1, a2); if (a < d) { d = a; MT = 1; }
    }
    const orb = sdSph(x, y, z, 0, -1.155, 0, 0.048); if (orb < d) { d = orb; MT = 1; }
    const cr = MN(sdBox(x, y + 1.27, z, 0.02, 0.075, 0.02, 0.008), sdBox(x, y + 1.285, z, 0.062, 0.02, 0.02, 0.008));
    if (cr < d) { d = cr; MT = 1; }
    const gem = sdSph(x, y, z, 0, -1.285, 0.022, 0.014); if (gem < d) { d = gem; MT = 2; }
    return d;
  });
};
LAZY.knight = () => { // KNIGHT (faces +x)
  const T = makeLathe([...FOOT(), disk(-0.27, -0.15, 0.218, 0.03)]);
  const HEAD = smoothPoly([
    [-0.2, -0.16], [-0.235, -0.32], [-0.245, -0.5], [-0.225, -0.68], [-0.175, -0.84], [-0.1, -0.97], [-0.05, -1.04],
    [-0.03, -1.12], [0.005, -1.2], [0.035, -1.11], [0.05, -1.06], [0.1, -1.02], [0.17, -0.95], [0.235, -0.86], [0.29, -0.77],
    [0.345, -0.69], [0.375, -0.625], [0.37, -0.575], [0.335, -0.548], [0.27, -0.55], [0.2, -0.56], [0.13, -0.585],
    [0.075, -0.58], [0.06, -0.5], [0.1, -0.4], [0.17, -0.3], [0.2, -0.16]], 5);
  const G = polyGrid(HEAD, -0.36, 0.46, -1.28, -0.1, 0.0065);
  const BACK = [[-0.04, -1.07], [-0.1, -0.98], [-0.17, -0.86], [-0.22, -0.72], [-0.24, -0.56], [-0.235, -0.38], [-0.215, -0.24]];
  const BL = []; let acc = 0; for (let i = 0; i < BACK.length - 1; i++) { const l = Math.hypot(BACK[i + 1][0] - BACK[i][0], BACK[i + 1][1] - BACK[i][1]); BL.push([acc, l]); acc += l; }
  // bake the mane (serrated ridge along the back of the neck) into grids: 2D distance and tooth height
  const GM = { ...G, g: new Float32Array(G.g.length) }, GT = { ...G, g: new Float32Array(G.g.length) };
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const x = G.x0 + i * G.cell, y = G.y0 + j * G.cell; let md = 9, s = 0;
    if (x > 0.06) { GM.g[j * G.nx + i] = 0.2; GT.g[j * G.nx + i] = 0.05; continue; } // mane only sampled at x < 0.02
    for (let q = 0; q < BACK.length - 1; q++) {
      const ax = BACK[q][0], ay = BACK[q][1], ex = BACK[q + 1][0] - ax, ey = BACK[q + 1][1] - ay;
      const h = sat(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)), qx = x - ax - ex * h, qy = y - ay - ey * h, dd = qx * qx + qy * qy;
      if (dd < md) { md = dd; s = BL[q][0] + BL[q][1] * h; }
    }
    md = SQ(md); const tooth = AB(fract(s * 13) - 0.5) * 2;
    GM.g[j * G.nx + i] = md - (0.022 + 0.026 * tooth) * sstep(0, 0.08, s) * (1 - sstep(0.85, 0.95, s));
    GT.g[j * G.nx + i] = 0.075 * (1 - 0.4 * tooth);
  }
  scene('knight', 0.42, -1.22, (x, y, z) => {
    let d = latheD(T, x, y, z);
    if (bb(x, y, z, 0.015, -0.675, 0, 0.4, 0.57, 0.17) < d) {
      const d2 = sampG(G, x, y);
      const H = (0.125 + 0.03 * sat((y + 0.6) / 0.4) - 0.03 * sat((x - 0.12) / 0.25)) * (y < -1.02 ? 0.62 : 1);
      const Rb = 0.085, e = MN(-d2, Rb) / Rb, zm = d2 < 0 ? H * SQ(MX(0, 1 - (1 - e) * (1 - e))) : 0;
      let hd = MX(d2, AB(z) - zm) * 0.72;
      if (x < 0.02) {
        const m2 = sampG(GM, x, y), mz = AB(z) - sampG(GT, x, y), a = MX(m2, 0), b = MX(mz, 0);
        const mane = (SQ(a * a + b * b) + MN(MX(m2, mz), 0) - 0.012) * 0.8;
        hd = smin(hd, mane, 0.02);
      }
      if (z > 0.02) {
        // eye socket, nostril, mouth line, cheek (carving only, safe to skip outside)
        if (x > 0.08 && x < 0.19 && y < -0.8 && y > -0.92) hd = MX(hd, -sdSph(x, y, z, 0.135, -0.86, 0.118, 0.034));
        if (x > 0.25) { hd = MX(hd, -sdSph(x, y, z, 0.335, -0.628, 0.088, 0.02)); hd = MX(hd, -sdCap(x, y, z, 0.375, -0.567, 0.06, 0.29, -0.563, 0.08, 0.007)); }
        if (x > 0.03 && x < 0.16 && y > -0.77 && y < -0.6) hd = MX(hd, -sdCap(x, y, z, 0.06, -0.63, 0.12, 0.13, -0.74, 0.12, 0.008) + 0.002);
      }
      if (hd < d + 0.02) { d = smin(d, hd, 0.02); MT = 0; }
      const eye = sdSph(x, y, z, 0.135, -0.86, 0.095, 0.024); if (eye < d) { d = eye; MT = 4; }
    }
    return d;
  });
};
LAZY.hollow = () => { // HOLLOW: hooded wraith with a tattered hem
  const T = makeLathe([
    curve([[-0.66, 0.06], [-0.62, 0.13], [-0.55, 0.17], [-0.42, 0.185], [-0.28, 0.21], [-0.14, 0.245], [0, 0.275]]),
  ]);
  scene('hollow', 0.36, -1.0, (x, y, z) => {
    let d = latheD(T, x, y, z);
    if (y > -0.16) { // ragged hem (carving)
      const ph = Math.atan2(z, x), rag = 0.035 + 0.075 * Math.pow(AB(Math.sin(ph * 4.5 + 0.6)), 0.7) + 0.03 * Math.sin(ph * 11);
      d = MX(d, (y + rag) * 0.7);
    }
    if (sdSph(x, y, z, 0, -0.85, -0.04, 0.32) < d) { // hood + peak
      d = smin(d, sdEll(x, y + 0.8, z + 0.02, 0.19, 0.2, 0.19), 0.06);
      d = smin(d, sdCone(x, y, z, 0, -0.9, -0.05, 0, -1.0, -0.13, 0.12, 0.012), 0.04);
    }
    const ax = AB(x);
    if (bb(ax, y, z, 0.22, -0.42, 0.08, 0.18, 0.3, 0.17) < d) { // sleeves reaching forward
      d = smin(d, sdCone(ax, y, z, 0.15, -0.58, 0.02, 0.27, -0.33, 0.12, 0.06, 0.034), 0.05);
      d = smin(d, sdCone(ax, y, z, 0.27, -0.33, 0.12, 0.3, -0.24, 0.15, 0.032, 0.008), 0.02);
    }
    MT = 0;
    if (y < -0.62 && y > -0.92 && z > 0.0 && ax < 0.13) { // face cavity + eyes
      const cav = sdEll(x, y + 0.77, z - 0.15, 0.105, 0.125, 0.12);
      if (-cav > d) { d = -cav; MT = 3; }
    }
    const e = sdSph(ax, y, z, 0.046, -0.785, 0.075, 0.021);
    if (e < d) { d = e; MT = 4; }
    return d;
  });
};
LAZY.colossus = () => { // COLOSSUS: armoured stone giant with a violet core
  scene('colossus', 0.56, -1.4, (X, y, z) => {
    const x = AB(X);
    let d = sdBox(X, y + 0.05, z, 0.3, 0.05, 0.2, 0.04); // rubble plinth
    if (bb(x, y, z, 0.14, -0.27, 0, 0.16, 0.25, 0.16) < d) d = smin(d, sdCone(x, y, z, 0.13, -0.08, 0, 0.15, -0.42, 0.01, 0.1, 0.085), 0.04); // legs
    if (bb(X, y, z, 0, -0.46, 0, 0.22, 0.12, 0.17) < d) d = smin(d, sdBox(X, y + 0.46, z, 0.17, 0.07, 0.12, 0.04), 0.04); // waist
    if (bb(X, y, z, 0, -0.72, 0, 0.33, 0.28, 0.2) < d) { const tw = 0.15 + 0.12 * sat((-0.5 - y) / 0.42); d = smin(d, sdBox(X, y + 0.72, z, tw, 0.22, 0.15, 0.06) * 0.85, 0.05); } // torso
    if (bb(x, y, z, 0.3, -0.9, 0, 0.17, 0.17, 0.17) < d) d = smin(d, sdSph(x, y, z, 0.3, -0.9, 0, 0.125), 0.04); // pauldrons
    if (bb(x, y, z, 0.345, -0.6, 0.05, 0.12, 0.33, 0.14) < d) { // arms + fists
      d = smin(d, sdCone(x, y, z, 0.31, -0.84, 0.02, 0.37, -0.57, 0.06, 0.075, 0.07), 0.03);
      d = smin(d, sdCone(x, y, z, 0.37, -0.57, 0.06, 0.38, -0.37, 0.1, 0.075, 0.085), 0.03);
      d = smin(d, sdBox(x - 0.38, y + 0.3, z - 0.11, 0.075, 0.075, 0.08, 0.04), 0.03);
    }
    if (bb(x, y, z, 0.38, -1.05, -0.01, 0.09, 0.12, 0.06) < d) d = MN(d, sdCone(x, y, z, 0.33, -0.98, 0, 0.43, -1.12, -0.02, 0.035, 0.006)); // shoulder spikes
    if (bb(X, y, z, 0, -1.06, 0.02, 0.12, 0.12, 0.13) < d) d = smin(d, sdBox(X, y + 1.06, z - 0.02, 0.085, 0.085, 0.09, 0.035), 0.03); // helm
    if (bb(x, y, z, 0.125, -1.24, -0.015, 0.1, 0.14, 0.06) < d) { d = MN(d, sdCone(x, y, z, 0.06, -1.12, 0, 0.15, -1.22, -0.01, 0.032, 0.02)); d = MN(d, sdCone(x, y, z, 0.15, -1.22, -0.01, 0.19, -1.36, -0.03, 0.02, 0.004)); } // horns
    if (y > -0.6 && y < -0.52 && z > 0.08) d = MX(d, -sdBox(X, y + 0.56, z - 0.16, 0.13, 0.008, 0.03)); // belt seam
    MT = 0;
    if (z > 0.04) {
      if (y < -1.0 && y > -1.1 && x < 0.1) { const visor = sdBox(X, y + 1.05, z - 0.11, 0.06, 0.013, 0.04, 0.004); if (-visor > d) { d = -visor; MT = 3; } }
      if (y < -0.64 && y > -0.84 && x < 0.1) { const sock = sdSph(X, y, z, 0, -0.74, 0.17, 0.075); if (-sock > d) { d = -sock; MT = 3; } }
    }
    const eye = sdSph(x, y, z, 0.03, -1.05, 0.085, 0.016); if (eye < d) { d = eye; MT = 4; }
    const core = sdSph(X, y, z, 0, -0.74, 0.135, 0.058); if (core < d) { d = core; MT = 2; }
    return d;
  });
};

// ---------------------------------------------------------------- G-buffer (skin independent)
const X0 = 0.62, Y0 = 1.4, WU = 1.24, HU = 1.52; // sprite covers x [-0.62, 0.62], y [-1.4, 0.12]
const GB = new Map();
const BIG = 384; // G-buffers at or above this resolution are guided by a finished lower-resolution one
let gbTick = 0;
function newGB(piece, res) {
  const S = getScene(piece);
  const W = Math.ceil(WU * res), H = Math.ceil(HU * res), n = W * H;
  return { piece, res, S, W, H, row: 0, crow: 1, done: false, ox: Math.round(X0 * res), oy: Math.round(Y0 * res), lo: null, msRow: 0, used: ++gbTick,
    A: new Float32Array(n), N: new Float32Array(n * 3), P: new Float32Array(n * 3), M: new Uint8Array(n), AO: new Float32Array(n), SH: new Float32Array(n), D: new Float32Array(n), C: new Uint8Array(n),
    bx0: W, by0: H, bx1: -1, by1: -1 };
}
// The guide for a big G-buffer: the best finished one of the same piece (or the resolution to build first).
function guideRes(piece, res) {
  let best = 0;
  for (const [k, g] of GB) if (g.done && g.piece === piece && g.res < BIG && g.res >= 96 && g.res > best && k === piece + '@' + g.res) best = g.res;
  return best || 128;
}
function buildRows(g, rows) {
  const { S, W, H, res } = g, f = S.fn, rb = S.rb, px = 1 / res, eps = 0.35 * px, hn = 0.5 * px, T0 = 2;
  const ytop = S.top - 0.06, end = MN(H, g.row + rows), shadows = res >= 90;
  const lo = g.lo, LA = lo && lo.A, LW = lo ? lo.W : 0, LH = lo ? lo.H : 0;
  for (let j = g.row; j < end; j++) {
    const sy = (j + 0.5 - g.oy) / res;
    for (let i = 0; i < W; i++) {
      const sx = (i + 0.5 - g.ox) / res;
      if (AB(sx) > rb + 2 * px) continue;
      const ox = sx, oy = sy * CE - T0 * SE, oz = sy * SE + T0 * CE;
      // clip the ray to the bounding slab
      let t = MX((ytop - oy) / SE, (oz - rb) / CE), t1 = MN((0.02 - oy) / SE, (oz + rb) / CE);
      if (t > t1) continue;
      let shG = -1;
      if (lo) { // guided: skip what the guide shows empty, start interior rays just in front of the guide's surface
        const fi = sx * lo.res + lo.ox - 0.5, fj = sy * lo.res + lo.oy - 0.5, i0 = Math.floor(fi), j0 = Math.floor(fj);
        if (i0 >= 1 && j0 >= 1 && i0 + 2 < LW && j0 + 2 < LH) {
          let any = 0;
          for (let b = -1; b <= 2 && !any; b++) { const r = (j0 + b) * LW + i0; if (LA[r - 1] > 0 || LA[r] > 0 || LA[r + 1] > 0 || LA[r + 2] > 0) any = 1; }
          if (!any) continue;
          const q = j0 * LW + i0, q2 = q + LW;
          if (LA[q] >= 0.99 && LA[q + 1] >= 0.99 && LA[q2] >= 0.99 && LA[q2 + 1] >= 0.99 && !(lo.C[q] | lo.C[q + 1] | lo.C[q2] | lo.C[q2 + 1])) {
            const LD = lo.D, d0 = MN(MN(LD[q], LD[q + 1]), MN(LD[q2], LD[q2 + 1])) - 0.03;
            if (d0 > t) t = d0;
            const fx = fi - i0, fy = fj - j0, LS = lo.SH;
            shG = (LS[q] * (1 - fx) + LS[q + 1] * fx) * (1 - fy) + (LS[q2] * (1 - fx) + LS[q2 + 1] * fx) * fy;
          }
        } else if (i0 < -2 || j0 < -2 || i0 > LW + 1 || j0 > LH + 1) continue;
      }
      let hit = false, dmin = 9, tmin = t;
      for (let k = 0; k < 96 && t < t1; k++) {
        const d = f(ox, oy + t * SE, oz - t * CE);
        if (d < dmin) { dmin = d; tmin = t; }
        if (d < eps) { hit = true; break; }
        t += d * 0.9;
      }
      let a;
      if (hit) { a = 1; tmin = t; } else { a = sat(1 - dmin * res / 1.1); if (a <= 0.02) continue; }
      const x = ox, y = oy + tmin * SE, z = oz - tmin * CE, k = j * W + i;
      // tetrahedral normal
      const a1 = f(x + hn, y - hn, z - hn), a2 = f(x - hn, y - hn, z + hn), a3 = f(x - hn, y + hn, z - hn), a4 = f(x + hn, y + hn, z + hn);
      let nx = a1 - a2 - a3 + a4, ny = -a1 - a2 + a3 + a4, nz = -a1 + a2 - a3 + a4;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      f(x, y, z); g.M[k] = MT;
      // ambient occlusion
      let occ = 0, w = 1;
      for (let s = 1; s <= 3; s++) { const h = 0.022 * s; occ += (h - f(x + nx * h, y + ny * h, z + nz * h)) * w; w *= 0.6; }
      g.AO[k] = sat(1 - occ * 7);
      // soft shadow toward the key light (smooth, so guided pixels take it from the guide)
      let sh = 1;
      if (shG >= 0 && hit) sh = shG;
      else if (shadows) {
        let st = 0.025;
        for (let s = 0; s < 10 && st < 0.7; s++) {
          const h = f(x + nx * 0.006 + L[0] * st, y + ny * 0.006 + L[1] * st, z + nz * 0.006 + L[2] * st);
          sh = MN(sh, 9 * h / st); if (sh < 0.02) break; st += clamp(h, 0.02, 0.14);
        }
      }
      g.SH[k] = sat(sh); g.A[k] = a; g.D[k] = tmin;
      g.N[k * 3] = nx; g.N[k * 3 + 1] = ny; g.N[k * 3 + 2] = nz;
      g.P[k * 3] = x; g.P[k * 3 + 1] = y; g.P[k * 3 + 2] = z;
      if (i < g.bx0) g.bx0 = i; if (i > g.bx1) g.bx1 = i; if (j < g.by0) g.by0 = j; if (j > g.by1) g.by1 = j;
    }
  }
  g.row = end;
}
// crease lines (depth jumps / material borders), in row chunks
function creaseRows(g, rows) {
  const { W, H, A, D, M, C } = g, thr = 0.035, end = MN(H - 1, g.crow + rows);
  for (let j = g.crow; j < end; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i; if (A[k] < 0.99) continue;
    let c = 0;
    for (let oi = 0; oi < 4; oi++) {
      const q = k + (oi === 0 ? 1 : oi === 1 ? -1 : oi === 2 ? W : -W); if (A[q] < 0.99) continue;
      if (D[k] - D[q] > thr) c = MX(c, 2); else if (M[q] !== M[k] && M[k] !== 2 && M[q] !== 2 && D[k] >= D[q]) c = MX(c, 1);
    }
    C[k] = c;
  }
  g.crow = end;
  if (g.crow >= H - 1) { g.done = true; g.lo = null; }
}
const gbKey = (piece, res) => piece + '@' + res;
function gbGet(piece, res) {
  const key = gbKey(piece, res); let g = GB.get(key);
  if (!g) { g = newGB(piece, res); GB.set(key, g); gbEvict(g); }
  g.used = ++gbTick;
  return g;
}
// Advance a G-buffer build by about `ms` milliseconds (Infinity = finish now). Returns true when done.
function gbStep(g, ms) {
  if (g.done) return true;
  const t0 = now();
  if (g.res >= BIG && !g.lo && g.row < g.H) { // big buffers march from a finished guide
    const lg = gbGet(g.piece, guideRes(g.piece, g.res));
    if (!lg.done) { gbStep(lg, ms); if (!lg.done) return false; }
    g.lo = lg;
  }
  while (!g.done) {
    const left = ms - (now() - t0); if (left <= 0) return false;
    if (g.row < g.H) {
      const rows = ms === Infinity ? g.H : !g.msRow ? 1 : MX(1, MN(64, Math.floor(left / MX(0.02, g.msRow))));
      const ta = now(), r0 = g.row; buildRows(g, rows);
      const per = (now() - ta) / MX(1, g.row - r0); g.msRow = g.msRow ? g.msRow * 0.6 + per * 0.4 : per;
    } else creaseRows(g, ms === Infinity ? g.H : MX(8, Math.round(60000 / g.W)));
  }
  return true;
}
// G-buffers are kept (they are what makes a new skin cheap) within a memory budget; big ones are evicted first.
const GB_BUDGET = (typeof window !== 'undefined' && (innerWidth * innerHeight >= 1e6 || (navigator.deviceMemory || 4) >= 8) ? 64 : 36) << 20; // phones: the 6 pieces at 96/128/192 fit
function gbEvict(keep) {
  const bytes = (g) => g.W * g.H * 42;
  let total = 0; for (const g of GB.values()) total += bytes(g);
  if (total <= GB_BUDGET) return;
  const busy = new Set(); for (const j of JOBS.values()) busy.add(gbKey(j.piece, j.res));
  const order = [...GB.entries()].filter(([k, g]) => g !== keep && !busy.has(k) && g !== (keep && keep.lo)).sort((a, b) => (b[1].res >= BIG) - (a[1].res >= BIG) || a[1].used - b[1].used);
  for (const [k, g] of order) { if (total <= GB_BUDGET * 0.8) break; GB.delete(k); total -= bytes(g); }
}
function getGB(piece, res) { const g = gbGet(piece, res); gbStep(g, Infinity); return g; }

// ---------------------------------------------------------------- materials
const HEX = new Map();
function rgb(c) {
  let v = HEX.get(c); if (v) return v;
  let s = String(c || '#888').trim();
  if (s[0] === '#') { if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]; const n = parseInt(s.slice(1, 7), 16); v = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  else { const m = s.match(/[\d.]+/g) || [128, 128, 128]; v = [m[0] / 255, m[1] / 255, m[2] / 255]; }
  HEX.set(c, v); return v;
}
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;

// defaults for skins that predate the material fields (SKINS fields always win)
const HINTS = {
  ivory: { mat: 'porcelain', accent: '#d8b15e' }, obsidian: { mat: 'obsidian', accent: '#c4bcff' },
  ember: { mat: 'magma' }, glacier: { mat: 'glass', pattern: 'frost' }, verdant: { mat: 'jade', pattern: 'veins' },
  neon: { mat: 'neon' }, gilded: { mat: 'metal', pattern: 'filigree' }, crimson: { mat: 'lacquer', accent: '#ffcf6a', pattern: 'filigree' },
  celestial: { mat: 'iridescent', pattern: 'stars' }, voidborn: { mat: 'cosmic' }, arcane: { mat: 'iridescent', pattern: 'runes' },
  sovereign: { mat: 'obsidian', accent: '#ffd76a', pattern: 'filigree' }, warden: { mat: 'metal', accent: '#e8f6ff', pattern: 'runes' },
  colossus: { mat: 'cosmic', pattern: 'cracks', emissive: 0.6 }, jade: { mat: 'jade' }, amethyst: { mat: 'crystal' },
  onyx: { mat: 'magma', pattern: 'cracks' }, frostfire: { mat: 'glass', pattern: 'frost', emissive: 0.35 }, solar: { mat: 'metal', emissive: 0.5, pattern: 'runes' },
};
const MATS = {
  //            wrap  spec shin env   rim  sss  alpha
  stone:      [0.25, 0.18, 18, 0.03, 0.25, 0.06, 1],
  porcelain:  [0.35, 0.6, 90, 0.16, 0.22, 0.16, 1],
  bone:       [0.4, 0.12, 12, 0.0, 0.2, 0.2, 1],
  obsidian:   [0.08, 1.0, 150, 0.5, 0.5, 0.0, 1],
  metal:      [0.1, 1.2, 110, 0.85, 0.35, 0.0, 1],
  lacquer:    [0.2, 0.9, 130, 0.3, 0.35, 0.05, 1],
  jade:       [0.6, 0.55, 70, 0.18, 0.3, 0.45, 0.97],
  glass:      [0.5, 1.1, 170, 0.5, 0.6, 0.3, 0.72],
  crystal:    [0.3, 1.3, 220, 0.45, 0.5, 0.25, 0.9],
  wood:       [0.3, 0.2, 22, 0.05, 0.2, 0.05, 1],
  neon:       [0.1, 0.8, 90, 0.25, 1.0, 0.0, 0.94],
  cosmic:     [0.2, 0.7, 90, 0.25, 0.9, 0.1, 1],
  magma:      [0.15, 0.35, 30, 0.08, 0.4, 0.0, 1],
  iridescent: [0.35, 0.8, 110, 0.3, 0.45, 0.12, 1],
  ghost:      [0.6, 0.4, 40, 0.1, 0.9, 0.4, 0.8],
  colossus:   [0.2, 0.25, 26, 0.06, 0.55, 0.0, 1],
};
const MAT_ALIAS = { ethereal: 'ghost', molten: 'magma', lava: 'magma', ice: 'glass', marble: 'stone', gold: 'metal', steel: 'metal', chrome: 'metal', void: 'cosmic', wire: 'neon', gem: 'crystal' };
const PAT_DEFAULT = { magma: 'cracks', neon: 'circuit', cosmic: 'stars', wood: 'grain', jade: 'swirl', ghost: 'wisps', colossus: 'cracks', bone: 'pores', stone: 'veins' };
const PATS = new Set(['veins', 'runes', 'scales', 'circuit', 'stars', 'cracks', 'filigree', 'frost', 'swirl', 'grain', 'wisps', 'pores']);

function inferMat(sk) {
  if (sk.wire) return 'neon';
  switch (sk.fx) {
    case 'ember': return 'magma'; case 'frost': return 'glass'; case 'leaf': return 'jade'; case 'glint': return 'metal';
    case 'star': return 'cosmic'; case 'aurora': case 'spark': return 'iridescent'; case 'wisp': return 'ghost';
  }
  return lum(rgb(sk.body[1])) < 0.08 ? 'obsidian' : 'porcelain';
}
const MATCACHE = new Map();
export function materialOf(skinId) {
  let m = MATCACHE.get(skinId); if (m) return m;
  const sk = skinOf(skinId), h = HINTS[skinId] || {};
  let type = sk.mat || h.mat; type = MAT_ALIAS[type] || type; if (!MATS[type]) type = h.mat && MATS[h.mat] ? h.mat : inferMat(sk);
  let pat = sk.pattern || h.pattern || PAT_DEFAULT[type] || null; if (pat && !PATS.has(pat)) pat = PAT_DEFAULT[type] || null;
  if (type === 'stone' && !sk.pattern && !h.pattern && skinId !== 'marble') pat = 'veins';
  let em = sk.emissive != null ? sk.emissive : h.emissive != null ? h.emissive : 0;
  if (typeof em !== 'number') em = 0.6;
  const accent = sk.accent || h.accent || (type === 'metal' ? null : (sk.fx === 'glint' ? sk.rim : null));
  const P = MATS[type];
  const body0 = rgb(sk.body[0]), body1 = rgb(sk.body[1]);
  m = {
    type, pat, em: clamp(em, 0, 1), wrap: P[0], spec: P[1], shin: P[2], env: P[3], rimA: P[4], sss: P[5], alpha: P[6],
    b0: body0, b1: body1, deep: lerp3(mul3(body1, 0.42), rgb(sk.line), 0.25), hi: lerp3(body0, rgb(sk.rim), 0.55),
    rim: rgb(sk.rim), glow: rgb(sk.glow), line: rgb(sk.line), accent: accent ? rgb(accent) : null,
    eye: rgb(sk.eye || sk.glow), gem: rgb(sk.gem || sk.glow), aurora: sk.fx === 'aurora',
  };
  const c0 = [body0[0] - lum(body0), body0[1] - lum(body0), body0[2] - lum(body0)], c1 = [body1[0] - lum(body1), body1[1] - lum(body1), body1[2] - lum(body1)];
  m.split = c0[0] * c1[0] + c0[1] * c1[1] + c0[2] * c1[2] < -0.004 && Math.hypot(...c0) > 0.08 && Math.hypot(...c1) > 0.08;
  m.anim = animOf(m, sk);
  m.void3 = lerp3(m.line, m.glow, 0.12); m.velvet3 = lerp3(mul3(m.glow, 0.32), m.deep, 0.35); m.eyeDark = mul3(m.line, 0.7);
  m.hotC = lerp3(m.glow, m.b0, 0.5); m.veinC = m.accent || lerp3(m.line, m.b1, 0.4); m.inkC = lerp3(m.line, m.glow, 0.35); m.specC = type === 'metal' ? lerp3(m.rim, m.b0, 0.3) : m.rim;
  MATCACHE.set(skinId, m); return m;
}
function animOf(m, sk) {
  if (m.type === 'neon' || m.pat === 'circuit') return 'scan';
  if (m.type === 'magma' || m.pat === 'cracks') return 'flow';
  if (m.type === 'iridescent' || m.aurora) return 'hue';
  if (m.type === 'cosmic' || m.pat === 'stars') return 'twinkle';
  if (m.type === 'ghost') return 'wisp';
  if (m.pat === 'runes' || m.em > 0.25) return 'pulse';
  if (m.type === 'metal' || m.type === 'crystal' || sk.fx === 'glint' || m.type === 'obsidian' || m.type === 'lacquer') return 'shimmer';
  return null;
}
export const isAnimatedSkin = (id) => !!materialOf(id).anim;
const NPH = { scan: 3, flow: 2, hue: 3, twinkle: 2, wisp: 2, pulse: 2, shimmer: 3 };
const PERIOD = { scan: 2.4, flow: 3.2, hue: 6, twinkle: 2.6, wisp: 3, pulse: 2.2, shimmer: 4.5 };

// studio environment for reflections
function envL(rx, ry, rz, hz = 1) {
  let e = ry < 0 ? 0.45 + 0.55 * Math.pow(-ry, 0.6) : 0.18 - 0.1 * ry;
  e -= 0.22 * hz * Math.exp(-ry * ry * 90);
  const sb = MX(0, -0.55 * rx - 0.62 * ry + 0.56 * rz); e += Math.pow(sb, 14) * 1.4;
  const s2 = MX(0, 0.86 * rx - 0.3 * ry - 0.4 * rz); e += Math.pow(s2, 8) * 0.6;
  return e;
}
function ramp(m, I, out) {
  let a, b, t;
  if (I < 0.35) { a = m.deep; b = m.b1; t = I / 0.35; } else if (I < 0.88) { a = m.b1; b = m.b0; t = (I - 0.35) / 0.53; } else { a = m.b0; b = m.hi; t = MN(1, (I - 0.88) / 0.4); }
  t = t * t * (3 - 2 * t);
  out[0] = mix(a[0], b[0], t); out[1] = mix(a[1], b[1], t); out[2] = mix(a[2], b[2], t);
}
function hue(h, out, s = 1) { // h in turns -> rainbow
  out[0] = 0.5 + 0.5 * s * Math.cos(6.2832 * (h)); out[1] = 0.5 + 0.5 * s * Math.cos(6.2832 * (h - 0.333)); out[2] = 0.5 + 0.5 * s * Math.cos(6.2832 * (h - 0.667));
}
// pattern value (0..1) at object position; sets PAT_C for patterns that need a second channel
let PAT_C = 0, CR_E = 1;
function pattern(p, x, y, z, ph) {
  const u = Math.atan2(x, z) * 0.22;
  switch (p) {
    case 'veins': { const w = fbm(x * 3.2 + 3, y * 3.2, z * 3.2, 3); const v = AB(Math.sin((x * 2.1 + y * 1.3 + z * 1.6 + w * 2.6) * 7)); PAT_C = w; return Math.pow(sat(1 - v * 7), 2); }
    case 'cracks': { voronoi(x * 9 + 11, y * 9, z * 9); CR_E = VOR_E; PAT_C = sstep(0.3, 0, VOR_E); const fl = fbm(x * 5, y * 5 + ph * 2.2, z * 5, 2); return sstep(0.05, 0.0, VOR_E - 0.025 * fl) * sstep(0.3, 0.62, fl) * (0.5 + 0.8 * fl); }
    case 'runes': {
      const cs = 0.062, gu = u / cs, gv = y / cs + 0.5, cu = Math.floor(gu), cv = Math.floor(gv), fu = gu - cu, fv = gv - cv;
      const band = ((cv % 6) + 6) % 6; if (band !== 2 || h3(cu, cv, 5) < 0.2) return 0;
      const hb = h3(cu, cv, 9) * 255 | 0; let dm = 9;
      const segs = [[0.2, 0.2, 0.2, 0.8], [0.8, 0.2, 0.8, 0.8], [0.2, 0.2, 0.8, 0.2], [0.2, 0.8, 0.8, 0.8], [0.2, 0.2, 0.8, 0.8], [0.8, 0.2, 0.2, 0.8], [0.5, 0.15, 0.5, 0.85], [0.2, 0.5, 0.8, 0.5]];
      for (let s = 0; s < 8; s++) if (hb & (1 << s)) { const [ax, ay, bx, by] = segs[s], ex = bx - ax, ey = by - ay, h = sat(((fu - ax) * ex + (fv - ay) * ey) / (ex * ex + ey * ey)); dm = MN(dm, Math.hypot(fu - ax - ex * h, fv - ay - ey * h)); }
      PAT_C = cu * 0.09; return sstep(0.1, 0.035, dm);
    }
    case 'circuit': {
      const cs = 0.05, gu = u / cs, gv = y / cs, cu = Math.floor(gu), cv = Math.floor(gv), fu = gu - cu, fv = gv - cv, hh = h3(cu, cv, 3);
      let d = 9;
      if (hh < 0.4) d = AB(fv - 0.5); else if (hh < 0.75) d = AB(fu - 0.5); else if (hh < 0.85) d = MN(AB(fu - 0.5) + MX(0, 0.5 - fv), AB(fv - 0.5) + MX(0, fu - 0.5));
      const pad = Math.hypot(fu - 0.5, fv - 0.5) < 0.17 && hh > 0.88 ? 1 : 0;
      PAT_C = cv * 0.13 + h3(cu, 0, 1); return MX(pad, sstep(0.12, 0.04, d));
    }
    case 'stars': {
      const k = 34, gx = x * k, gy = y * k, gz = z * k, cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz), hh = h3(cx, cy, cz);
      PAT_C = fbm(x * 3 + 5, y * 3, z * 3, 3);
      if (hh < 0.9) return 0;
      const dx = gx - cx - 0.5, dy = gy - cy - 0.5, dz = gz - cz - 0.5, d = SQ(dx * dx + dy * dy + dz * dz);
      const tw = ph < 0 ? 1 : 0.5 + 0.5 * Math.cos(6.2832 * (h3(cz, cx, cy) - ph));
      return sstep(0.32, 0.0, d) * (0.4 + 0.6 * hh) * tw;
    }
    case 'filigree': { const band = sstep(0.82, 0.9, AB(Math.sin(y * 7 + 0.6))); if (band <= 0) return 0; const a = Math.sin(u * 60 + Math.sin(y * 48) * 1.8), b = Math.sin(y * 60 + Math.sin(u * 48) * 1.8); return sstep(0.16, 0.0, AB(a * b)) * band; }
    case 'scales': { const k = 16, gv = y * k, rv = Math.floor(gv), gu = u * k + (rv & 1) * 0.5, ru = Math.floor(gu); const d = Math.hypot(gu - ru - 0.5, (gv - rv) * 1.1); PAT_C = d; return sstep(0.4, 0.62, d) * (1 - sstep(0.62, 0.8, d)); }
    case 'frost': { const n = fbm(x * 22, y * 22, z * 22, 2); PAT_C = fbm(x * 4, y * 4, z * 4, 2); return sstep(0.62, 0.8, n); }
    case 'swirl': { const w = fbm(x * 2.5 + fbm(x * 4, y * 4, z * 4, 2) * 1.5, y * 2.5, z * 2.5, 3); PAT_C = w; return w; }
    case 'grain': { const r = SQ(x * x + z * z) * 26 + fbm(x * 3, y * 3, z * 3, 2) * 2 + y * 0.8; return sstep(0.75, 1, AB(Math.sin(r * 3.14))); }
    case 'wisps': { const w = fbm(x * 5, y * 3.2 + ph * 1.4, z * 5, 3); PAT_C = w; return sstep(0.45, 0.85, w); }
    case 'pores': { const n = vnoise(x * 60, y * 60, z * 60); return sstep(0.8, 0.95, n); }
  }
  return 0;
}

// Shade a G-buffer for a skin. Returns RGBA for the base and additive overlay layers (one per animation phase).
function shadeInit(g, skinId) {
  const m = materialOf(skinId), n = g.W * g.H, nph = m.anim ? NPH[m.anim] : 0;
  // RGBA buffers cover only the rows with coverage (offset `off`), and are pooled to keep GC quiet
  const k0 = g.by1 >= 0 ? g.by0 * g.W : 0, k1 = g.by1 >= 0 ? (g.by1 + 1) * g.W : 0, len = MX(4, (k1 - k0) * 4);
  const layers = []; for (let k = 0; k < nph; k++) layers.push(takeBuf(len));
  return { g, skinId, m, base: takeBuf(len), layers, nph, k: k0, n: k1, off: k0 };
}
function shade(g, skinId) { const st = shadeInit(g, skinId); shadeRun(st, 1e12); return st; }
const POOL = new Map();
function takeBuf(len) { const a = POOL.get(len); if (a && a.length) { const b = a.pop(); b.fill(0); return b; } return new Uint8ClampedArray(len); }
function giveBufs(st) {
  for (const b of [st.base, ...st.layers]) { if (b.length > (8 << 20)) continue; let a = POOL.get(b.length); if (!a) POOL.set(b.length, (a = [])); if (a.length < 4) a.push(b); }
  if (POOL.size > 24) POOL.clear();
  st.base = null; st.layers = [];
}
// Skin-independent per-pixel values (pattern fields, animation phases, shimmer) are cached on the G-buffer, so
// every further skin of the same piece/resolution skips that noise work. NaN marks "not computed yet".
function gcache(g, st, key) {
  const C = g.cc || (g.cc = new Map()); let a = C.get(key);
  if (!a) { a = new Float32Array(MX(1, st.n - st.off)); a.fill(NaN); C.set(key, a); }
  return a;
}
// shade up to `count` pixels; returns true when finished
function shadeRun(st, count) {
  const { g, m, base, layers, nph, n, off } = st, { A, N, P, M, AO, SH, C } = g;
  const cc = g.res < BIG, pat0 = m.pat && (g.res >= 90 || m.pat !== 'cracks') ? m.pat : null;
  const PV = cc && pat0 ? gcache(g, st, 'v:' + pat0) : null, PCa = PV && gcache(g, st, 'c:' + pat0), PE = PV && pat0 === 'cracks' ? gcache(g, st, 'e:cracks') : null;
  // per-phase caches, only for the channels this material uses
  const qArr = (tag, on) => { const r = []; for (let q = 0; q < nph; q++) r.push(cc && on ? gcache(g, st, tag + q + '/' + nph) : null); return r; };
  const FQ = qArr('f', m.type === 'magma'), SQs = qArr('s', m.type === 'cosmic' && m.pat === 'stars'), WQ = qArr('w', m.type === 'ghost'), HQ = qArr('h', m.anim === 'shimmer' && m.type !== 'crystal');
  const kEnd = MN(n, st.k + count);
  const col = [0, 0, 0], tmp = [0, 0, 0], em = [0, 0, 0];
  const dyn = new Float32Array(nph); const type = m.type;
  const isGhost = type === 'ghost', heavy = g.res >= 90;
  for (let k = st.k; k < kEnd; k++) {
    const a0 = A[k]; if (a0 <= 0) continue;
    let nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2];
    const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2], mid = M[k], ao = AO[k], sh = 0.3 + 0.7 * SH[k];
    const ci = k - off;
    let facetE = 0;
    if (type === 'crystal' && mid === 0) { // facet the normals: constant tilt per cell
      voronoi(x * 7.5 + 3, y * 7.5, z * 7.5);
      const hc = VOR_H * 1e6 | 0; facetE = sstep(0.05, 0.0, VOR_E);
      nx += (h3(hc, 1, 2) - 0.5) * 0.8; ny += (h3(hc, 3, 4) - 0.5) * 0.8; nz += (h3(hc, 5, 6) - 0.5) * 0.3;
      const l = SQ(nx * nx + ny * ny + nz * nz); nx /= l; ny /= l; nz /= l;
    }
    const ndl = nx * L[0] + ny * L[1] + nz * L[2], nv = MX(0, nx * V[0] + ny * V[1] + nz * V[2]);
    const ndh = MX(0, nx * HV[0] + ny * HV[1] + nz * HV[2]), F = Math.pow(1 - nv, 4), rl = MX(0, nx * LR[0] + ny * LR[1] + nz * LR[2] + 0.35);
    const rx = 2 * nv * nx - V[0], ry = 2 * nv * ny - V[1], rz = 2 * nv * nz - V[2];
    const occ = 0.32 + 0.68 * ao;
    let alpha = a0;
    em[0] = em[1] = em[2] = 0; for (let q = 0; q < nph; q++) dyn[q] = 0;
    let dynC = m.glow; // overlay colour
    if (mid === 1 && m.accent) { // metal trim
      const e = envL(rx, ry, rz), I = clamp((0.2 + 0.75 * e + 0.35 * MX(0, ndl)) * (0.4 + 0.6 * occ) * (0.6 + 0.4 * sh), 0, 1.6), a = m.accent;
      const t = sat(I * 1.15);
      col[0] = mix(a[0] * 0.28, a[0], t); col[1] = mix(a[1] * 0.28, a[1], t); col[2] = mix(a[2] * 0.28, a[2], t);
      const s = Math.pow(ndh, 90) * 1.6 * sh + MX(0, I - 1) * 0.8; col[0] += s; col[1] += s; col[2] += s * 0.9;
      if (m.anim === 'shimmer') for (let q = 0; q < nph; q++) dyn[q] = shimC(HQ[q], ci, nx, ny, nz, q, nph) * 0.9;
      dynC = m.rim;
    } else if (mid === 2) { // jewel / core
      const gm = m.gem, d = MX(0, ndl);
      col[0] = gm[0] * (0.3 + 0.7 * d) + gm[0] * F * 0.6; col[1] = gm[1] * (0.3 + 0.7 * d) + gm[1] * F * 0.6; col[2] = gm[2] * (0.3 + 0.7 * d) + gm[2] * F * 0.6;
      const s = Math.pow(ndh, 160) * 2.2; col[0] += s; col[1] += s; col[2] += s;
      em[0] = gm[0] * 0.35; em[1] = gm[1] * 0.35; em[2] = gm[2] * 0.35;
      for (let q = 0; q < nph; q++) dyn[q] = 0.25 + 0.25 * Math.cos(6.2832 * q / nph);
      dynC = gm;
    } else if (mid === 3) { // cavity / velvet
      const isVoid = isGhost || type === 'colossus' || g.piece !== 'king';
      const base3 = isVoid ? m.void3 : m.velvet3;
      const sheen = isVoid ? 0.15 : 0.55;
      const I = (0.25 + 0.75 * MX(0, ndl)) * occ;
      col[0] = base3[0] * I + base3[0] * F * sheen * 2; col[1] = base3[1] * I + base3[1] * F * sheen * 2; col[2] = base3[2] * I + base3[2] * F * sheen * 2;
      if (isVoid && (isGhost || type === 'colossus')) { const v = 0.18 * (1 - nv); em[0] = m.glow[0] * v; em[1] = m.glow[1] * v; em[2] = m.glow[2] * v; }
    } else if (mid === 4) { // eyes
      if (isGhost || type === 'colossus') {
        const e = m.eye; col[0] = e[0] * 1.15 + 0.2; col[1] = e[1] * 1.15 + 0.2; col[2] = e[2] * 1.15 + 0.2;
        for (let q = 0; q < nph; q++) dyn[q] = 0.35 + 0.35 * Math.cos(6.2832 * q / nph); dynC = e;
      } else {
        const glowy = type === 'neon' || type === 'cosmic' || type === 'magma' || m.em > 0.3;
        const c0 = glowy ? m.glow : m.eyeDark;
        const I = glowy ? 1 : 0.4 + 0.6 * MX(0, ndl);
        col[0] = c0[0] * I; col[1] = c0[1] * I; col[2] = c0[2] * I;
        const s = Math.pow(ndh, 120) * 2.5; col[0] += s; col[1] += s; col[2] += s;
      }
    } else { // body (or trim without an accent)
      const wrap = m.wrap;
      let I = ((ndl + wrap) / (1 + wrap)); I = (0.1 + 0.9 * sat(I) * sh) * occ;
      if (m.split) I = mix(I, 0.12 + 0.95 * sat(y / -0.9), 0.55) * (0.75 + 0.25 * occ);
      if (mid === 1) I *= 1.04;
      const pat = m.pat;
      let pv = 0;
      if (pat0) {
        if (PV) { const v = PV[ci]; if (v === v) { pv = v; PAT_C = PCa[ci]; if (PE) CR_E = PE[ci]; } else { pv = pattern(pat0, x, y, z, -1); PV[ci] = pv; PCa[ci] = PAT_C; if (PE) PE[ci] = CR_E; } }
        else pv = pattern(pat0, x, y, z, -1);
      }
      const pc = PAT_C;
      switch (type) {
        case 'metal': {
          const e = envL(rx, ry, rz);
          ramp(m, clamp((0.08 + 0.7 * e + 0.25 * MX(0, ndl)) * occ * (0.55 + 0.45 * sh), 0, 1.35), col);
          break;
        }
        case 'magma': {
          const crust = (0.12 + 0.7 * I);
          tmp[0] = m.b1[0] * 0.35; tmp[1] = m.b1[1] * 0.3; tmp[2] = m.b1[2] * 0.3;
          col[0] = mix(m.deep[0] * 0.5, mix(tmp[0], m.b1[0] * 0.8, 0.5), crust * 1.4); col[1] = mix(m.deep[1] * 0.5, mix(tmp[1], m.b1[1] * 0.8, 0.5), crust * 1.4); col[2] = mix(m.deep[2] * 0.5, mix(tmp[2], m.b1[2] * 0.8, 0.5), crust * 1.4);
          const halo = PAT_C * 0.3 * (pv > 0 ? 1 : 0.5);
          em[0] = m.glow[0] * halo; em[1] = m.glow[1] * halo; em[2] = m.glow[2] * halo;
          const hp = sat(pv), cv = hp * 0.63;
          em[0] += mix(m.glow[0], m.b0[0], hp) * cv; em[1] += mix(m.glow[1], m.b0[1], hp) * cv; em[2] += mix(m.glow[2], m.b0[2], hp) * cv;
          if (nph && heavy) { const ce = CR_E; for (let q = 0; q < nph; q++) { const FQa = FQ[q]; let fl = FQa ? FQa[ci] : NaN; if (fl !== fl) { fl = fbm(x * 5, y * 5 + (q / nph) * 2.2, z * 5, 2); if (FQa) FQa[ci] = fl; } dyn[q] = sstep(0.05, 0, ce - 0.025 * fl) * sstep(0.3, 0.62, fl) * fl * 1.1 + halo * 0.2; } }
          dynC = m.hotC; pv = 0;
          break;
        }
        case 'neon': {
          const dk = m.b1, lt = m.b0, d = MX(0, ndl);
          col[0] = dk[0] * 0.6 + lt[0] * d * 0.5; col[1] = dk[1] * 0.6 + lt[1] * d * 0.5; col[2] = dk[2] * 0.6 + lt[2] * d * 0.5;
          const edge = Math.pow(1 - nv, 2.2);
          em[0] = m.glow[0] * edge * 1.1; em[1] = m.glow[1] * edge * 1.1; em[2] = m.glow[2] * edge * 1.1;
          const tr = pv * 0.55; em[0] += m.rim[0] * tr; em[1] += m.rim[1] * tr; em[2] += m.rim[2] * tr;
          for (let q = 0; q < nph; q++) dyn[q] = pv * Math.pow(0.5 + 0.5 * Math.cos(6.2832 * (pc - q / nph)), 6) * 1.2 + edge * 0.2 * Math.pow(0.5 + 0.5 * Math.cos(6.2832 * (y * 1.4 - q / nph)), 8);
          dynC = m.rim; alpha *= 0.9 + 0.1 * edge; pv = 0;
          break;
        }
        case 'cosmic': {
          ramp(m, I * 0.75, col);
          const neb = PAT_C || fbm(x * 3 + 5, y * 3, z * 3, 3), nb = sstep(0.4, 0.9, neb) * 0.55;
          tmp[0] = mix(m.glow[0], m.rim[0], neb); tmp[1] = mix(m.glow[1], m.rim[1], neb); tmp[2] = mix(m.glow[2], m.rim[2], neb);
          em[0] = tmp[0] * nb * 0.5; em[1] = tmp[1] * nb * 0.5; em[2] = tmp[2] * nb * 0.5;
          const fr = Math.pow(1 - nv, 2.5) * 0.7; em[0] += m.glow[0] * fr; em[1] += m.glow[1] * fr; em[2] += m.glow[2] * fr;
          if (pat === 'stars') { for (let q = 0; q < nph; q++) { const SQa = SQs[q]; let v = SQa ? SQa[ci] : NaN; if (v !== v) { v = pattern('stars', x, y, z, q / nph); if (SQa) SQa[ci] = v; } dyn[q] = v * 1.4; } pv = 0; dynC = [1, 1, 1]; }
          else if (pat === 'cracks') { em[0] += m.glow[0] * pv; em[1] += m.glow[1] * pv; em[2] += m.glow[2] * pv; for (let q = 0; q < nph; q++) dyn[q] = pv * (0.5 + 0.5 * Math.cos(6.2832 * (y * 1.2 - q / nph))); pv = 0; }
          break;
        }
        case 'iridescent': {
          ramp(m, I, col);
          const film = nv * 1.3 + y * 0.35 + fbm(x * 2, y * 2, z * 2, 2) * 0.4;
          hue(film, tmp, 0.9);
          const s = (0.18 + 0.55 * F) * (m.aurora ? 1.2 : 1);
          col[0] = mix(col[0], col[0] * tmp[0] * 1.6, 0.35); col[1] = mix(col[1], col[1] * tmp[1] * 1.6, 0.35); col[2] = mix(col[2], col[2] * tmp[2] * 1.6, 0.35);
          for (let q = 0; q < nph; q++) dyn[q] = s;
          dynC = null; // per-phase hue below
          break;
        }
        case 'ghost': {
          ramp(m, 0.25 + I * 0.75, col);
          const fade = sstep(0.0, -0.32, y);
          alpha *= (0.38 + 0.5 * fade + 0.3 * F) * (g.piece === 'hollow' ? 1 : 0.9);
          const w = pv * 0.35; em[0] = m.glow[0] * (w + F * 0.6); em[1] = m.glow[1] * (w + F * 0.6); em[2] = m.glow[2] * (w + F * 0.6);
          for (let q = 0; q < nph; q++) { const WQa = WQ[q]; let v = WQa ? WQa[ci] : NaN; if (v !== v) { v = pattern('wisps', x, y, z, q / nph); if (WQa) WQa[ci] = v; } dyn[q] = v * 0.45 * (0.4 + fade); }
          pv = 0;
          break;
        }
        case 'colossus': {
          ramp(m, I, col);
          const cr = pv; em[0] = m.glow[0] * cr * 1.1 + m.glow[0] * PAT_C * 0.18; em[1] = m.glow[1] * cr * 1.1 + m.glow[1] * PAT_C * 0.18; em[2] = m.glow[2] * cr * 1.1 + m.glow[2] * PAT_C * 0.18;
          for (let q = 0; q < nph; q++) dyn[q] = cr * (0.4 + 0.6 * Math.cos(6.2832 * (y * 0.9 - q / nph)) ** 2);
          pv = 0;
          break;
        }
        case 'glass': case 'crystal': {
          ramp(m, mix(I, 1 - I * 0.4, 0.25), col);
          const caust = sstep(0.4, 1, fbm(x * 6, y * 9, z * 6, 2)) * 0.25 * (1 - nv);
          col[0] += m.rim[0] * caust; col[1] += m.rim[1] * caust; col[2] += m.rim[2] * caust;
          alpha *= m.alpha + (1 - m.alpha) * (F * 1.5 + (1 - ao) * 0.6);
          if (type === 'crystal') { const fe = facetE * 0.35 * (0.5 + I); col[0] += m.rim[0] * fe; col[1] += m.rim[1] * fe; col[2] += m.rim[2] * fe; const sp = Math.pow(ndh, 400) * 2; col[0] += sp; col[1] += sp; col[2] += sp; }
          break;
        }
        default: ramp(m, I, col);
      }
      // generic pattern application
      if (pv > 0) {
        if (pat === 'veins') { const vc = m.veinC, k2 = pv * (type === 'jade' ? 0.35 : 0.42); col[0] = mix(col[0], vc[0] * (0.4 + 0.6 * I), k2); col[1] = mix(col[1], vc[1] * (0.4 + 0.6 * I), k2); col[2] = mix(col[2], vc[2] * (0.4 + 0.6 * I), k2); }
        else if (pat === 'cracks' && lum(m.b0) > 0.55 && m.em < 0.3) { const k2 = pv * 0.6, lc = m.inkC; col[0] = mix(col[0], lc[0], k2); col[1] = mix(col[1], lc[1], k2); col[2] = mix(col[2], lc[2], k2); const e2 = pv * 0.12; em[0] += m.glow[0] * e2; em[1] += m.glow[1] * e2; em[2] += m.glow[2] * e2; }
        else if (pat === 'runes' || pat === 'circuit' || pat === 'cracks') { const c2 = pat === 'runes' ? m.glow : m.rim, k2 = 0.25 + m.em * 0.6; em[0] += c2[0] * pv * k2; em[1] += c2[1] * pv * k2; em[2] += c2[2] * pv * k2; for (let q = 0; q < nph; q++) dyn[q] = MX(dyn[q], pv * (0.5 + 0.5 * Math.cos(6.2832 * (pc - q / nph)))); if (pat !== 'cracks') dynC = c2; }
        else if (pat === 'filigree') { const a = m.accent || m.rim, k2 = pv * 0.7, I2 = 0.35 + 0.95 * I; col[0] = mix(col[0], a[0] * I2, k2); col[1] = mix(col[1], a[1] * I2, k2); col[2] = mix(col[2], a[2] * I2, k2); }
        else if (pat === 'scales') { const k2 = pv * 0.5; col[0] *= 1 - k2; col[1] *= 1 - k2; col[2] *= 1 - k2; const hl = (1 - sat(pc / 0.6)) * 0.12; col[0] += m.rim[0] * hl; col[1] += m.rim[1] * hl; col[2] += m.rim[2] * hl; }
        else if (pat === 'frost') { const k2 = pv * 0.45; col[0] = mix(col[0], 1, k2); col[1] = mix(col[1], 1, k2); col[2] = mix(col[2], 1, k2); }
        else if (pat === 'swirl') { const k2 = (pv - 0.5) * 0.5; col[0] *= 1 + k2; col[1] *= 1 + k2; col[2] *= 1 + k2; }
        else if (pat === 'grain' || pat === 'pores') { const k2 = pv * 0.28; col[0] *= 1 - k2; col[1] *= 1 - k2; col[2] *= 1 - k2; }
      }
      // specular, environment, rim light, subsurface
      const sp = Math.pow(ndh, m.shin) * m.spec * sh * (type === 'metal' ? 1.2 : 1);
      const sc = m.specC;
      col[0] += sc[0] * sp; col[1] += sc[1] * sp; col[2] += sc[2] * sp;
      if (type !== 'metal' && m.env > 0) { const e = envL(rx, ry, rz, type === 'obsidian' || type === 'lacquer' ? 0.6 : 0) * m.env * (0.06 + 0.94 * F) * occ; col[0] += m.rim[0] * e; col[1] += m.rim[1] * e; col[2] += m.rim[2] * e; }
      const rimL = Math.pow(1 - nv, 2.6) * rl * m.rimA * occ;
      col[0] += m.glow[0] * rimL; col[1] += m.glow[1] * rimL; col[2] += m.glow[2] * rimL;
      if (m.sss > 0) { const s = m.sss * (1 - MX(0, ndl)) * 0.35 * (0.4 + 0.6 * ao); col[0] += m.glow[0] * s; col[1] += m.glow[1] * s; col[2] += m.glow[2] * s; }
      if (m.em > 0 && type !== 'magma' && type !== 'neon') { const e = m.em * (0.12 + 0.4 * Math.pow(1 - nv, 2)); em[0] += m.glow[0] * e; em[1] += m.glow[1] * e; em[2] += m.glow[2] * e; for (let q = 0; q < nph; q++) dyn[q] = MX(dyn[q], m.em * 0.35 * (0.5 + 0.5 * Math.cos(6.2832 * q / nph)) * (1 - nv)); }
      if (m.anim === 'shimmer') for (let q = 0; q < nph; q++) dyn[q] = MX(dyn[q], shimC(HQ[q], ci, nx, ny, nz, q, nph) * (type === 'metal' ? 0.9 : 0.6) * occ);
      if (m.anim === 'shimmer') dynC = m.rim;
    }
    // ground contact darkening + creases
    const gc = 1 - 0.35 * sstep(-0.06, 0.06, y) * (mid === 0 ? 1 : 0);
    let r = (col[0] + em[0]) * gc, gg = (col[1] + em[1]) * gc, b = (col[2] + em[2]) * gc;
    const cr = C[k];
    if (cr) { const kc = cr === 2 ? 0.62 : 0.35, lc = m.line; r = mix(r, lc[0], kc); gg = mix(gg, lc[1], kc); b = mix(b, lc[2], kc); }
    const o = ci * 4;
    base[o] = tone(r); base[o + 1] = tone(gg); base[o + 2] = tone(b); base[o + 3] = alpha * 255;
    for (let q = 0; q < nph; q++) {
      const v = dyn[q]; if (v <= 0.004) continue;
      let c = dynC;
      if (!c) { hue(nv * 1.3 + y * 0.35 + q / nph, tmp, 1); c = tmp; }
      const L2 = layers[q], va = sat(v) * a0 * (cr === 2 ? 0.5 : 1);
      L2[o] = c[0] * 255; L2[o + 1] = c[1] * 255; L2[o + 2] = c[2] * 255; L2[o + 3] = va * 255;
    }
  }
  st.k = kEnd; return kEnd >= n;
}
function shimC(a, ci, nx, ny, nz, q, nph) { let v = a ? a[ci] : NaN; if (v !== v) { v = shimmer(nx, ny, nz, q, nph); if (a) a[ci] = v; } return v; }
function shimmer(nx, ny, nz, q, nph) {
  const a = -1.9 + 1.7 * (q / nph) * 2 / (nph > 1 ? (nph - 1) * 2 / nph : 1);
  const lx = Math.cos(a) * 0.8, ly = -0.55, lz = 0.35 + Math.sin(a) * 0.3;
  const hx = lx + V[0], hy = ly + V[1], hz = lz + V[2], hl = Math.hypot(hx, hy, hz);
  return Math.pow(MX(0, (nx * hx + ny * hy + nz * hz) / hl), 70) * 1.3;
}
const tone = (v) => 255 * (v < 0.82 ? v : 0.82 + 0.18 * (1 - Math.exp(-(v - 0.82) * 4.5)));

// ---------------------------------------------------------------- sprites
// Resolution buckets (sprite pixels per tile unit). Big ones serve the title hero / showroom / store stages at
// their real on-screen size x devicePixelRatio and are built lazily, from a lower-resolution guide.
const BUCKETS = [64, 96, 128, 192, 288, 384, 512];
const SPR = new Map(); // key piece|skin|res -> sprite record
let sprPx = 0, sprVer = 0;
// Canvas pixels held by all sprites (~4 bytes each). LRU beyond this, but a sprite drawn in the last few seconds is
// never evicted (the visible set may exceed the budget rather than thrash). Phones ~24 MB, big screens ~48 MB.
// B3 10.1: phones get 6e6 px (~24 MB) whatever navigator.deviceMemory says (8 GB phones still kill tabs over canvas memory).
const SPR_BUDGET = typeof window !== 'undefined' && innerWidth * innerHeight >= 1e6 ? 12e6 : 6e6;
const SPR_KEEP_MS = 3000;
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function imgCanvas(W, H, data) { const c = mkCanvas(W, H); const x = c.getContext('2d'); const id = x.createImageData(W, H); id.data.set(data); x.putImageData(id, 0, 0); return c; }
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function spriteFor(piece, skinId, res) { // synchronous build (used by caching callers)
  const key = piece + '|' + skinId + '|' + res; let s = SPR.get(key); if (s) return s;
  let job = JOBS.get(key); if (job) JOBS.delete(key); else job = null;
  const g = getGB(piece, res);
  let sh = job && job.sh && job.sh.g === g ? job.sh : null; if (!sh) sh = shadeInit(g, skinId); shadeRun(sh, 1e12);
  const it = finishSteps(piece, skinId, res, g, sh); while (!it.next().done);
  return SPR.get(key);
}
// Turning shaded pixels into canvases, split into steps so a big sprite never makes one long task.
function* finishSteps(piece, skinId, res, g, sh) {
  const key = piece + '|' + skinId + '|' + res, { W, H } = g, m = sh.m, sk = skinOf(skinId);
  const ow = MX(1.4, res * 0.017), big = res >= BIG;
  // skin-independent crop box from the G-buffer (no per-skin pixel scans)
  const box = (pad) => { pad = Math.ceil(pad); const x0 = MX(0, g.bx0 - pad), y0 = MX(0, g.by0 - pad), x1 = MN(W - 1, g.bx1 + pad), y1 = MN(H - 1, g.by1 + pad); return { x: x0, y: y0, w: MX(0, x1 - x0 + 1), h: MX(0, y1 - y0 + 1) }; };
  const B = box(ow + res * 0.08), Bs = box(1);
  if (B.w <= 0) { const s = { c: { img: null, x: 0, y: 0, w: 0, h: 0 }, sil: { img: null, x: 0, y: 0, w: 0, h: 0 }, layers: [], W, H, res, ox: g.ox, oy: g.oy, anim: null, outl: new Map(), px: 0, used: now() }; sprVer++; SPR.set(key, s); return; }
  // work only inside the crop box. Small sprites finish in one step on shared scratch canvases (fewer canvas
  // allocations); big ones yield between steps and use their own.
  const r0 = sh.off / W, r1 = sh.n / W; // rows held by the shading buffers
  const sub = (data, b) => { const out = new Uint8ClampedArray(b.w * b.h * 4); for (let j = 0; j < b.h; j++) { const row = b.y + j; if (row < r0 || row >= r1) continue; const o = ((row - r0) * W + b.x) * 4; out.set(data.subarray(o, o + b.w * 4), j * b.w * 4); } return out; };
  const w = B.w, h = B.h;
  const cv = (i) => big ? mkCanvas(w, h) : scratch(i, w, h);
  const put = (i, data) => { const c = cv(i), x = c.getContext('2d'); const id = x.createImageData(w, h); id.data.set(data); x.putImageData(id, 0, 0); return c; };
  const D = (x, img, dx = 0, dy = 0) => x.drawImage(img, 0, 0, w, h, dx, dy, w, h);
  const raw = put(0, sub(sh.base, B));
  if (big) yield;
  const sil = cv(1), sx = sil.getContext('2d');
  D(sx, raw); sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#fff'; sx.fillRect(0, 0, w, h); sx.globalCompositeOperation = 'source-over';
  const tint = cv(2), tx = tint.getContext('2d');
  D(tx, sil); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = sk.line || '#000'; tx.fillRect(0, 0, w, h); tx.globalCompositeOperation = 'source-over';
  if (big) yield;
  // final: outline + bloom + body
  const c = mkCanvas(w, h), x = c.getContext('2d');
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; D(x, tint, Math.cos(a) * ow, Math.sin(a) * ow); }
  if (big) yield;
  const glowy = m.type === 'neon' || m.type === 'cosmic' || m.type === 'magma' || m.type === 'ghost' || m.type === 'colossus' || m.em > 0.3;
  if (glowy && res >= 90) {
    x.save(); x.shadowColor = sk.glow; x.shadowBlur = res * 0.07; x.globalAlpha = m.type === 'ghost' ? 0.55 : 0.75; D(x, tint); x.restore();
    if (m.type === 'neon') { x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5; D(x, tint); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; }
    if (big) yield;
  }
  if (m.type === 'glass' || m.type === 'crystal' || m.type === 'ghost' || m.type === 'neon') { // translucent bodies: punch the outline out of the interior first
    x.globalCompositeOperation = 'destination-out'; D(x, sil); x.globalCompositeOperation = 'source-over';
  }
  D(x, raw);
  const silB = mkCanvas(Bs.w, Bs.h); silB.getContext('2d').drawImage(sil, Bs.x - B.x, Bs.y - B.y, Bs.w, Bs.h, 0, 0, Bs.w, Bs.h);
  const layers = [];
  for (const L2 of sh.layers) {
    if (big) yield;
    layers.push({ img: imgCanvas(Bs.w, Bs.h, sub(L2, Bs)), x: Bs.x, y: Bs.y, w: Bs.w, h: Bs.h });
  }
  const s = { c: { img: c, x: B.x, y: B.y, w: B.w, h: B.h }, sil: { img: silB, x: Bs.x, y: Bs.y, w: Bs.w, h: Bs.h }, layers, W, H, res, ox: g.ox, oy: g.oy, anim: m.anim, outl: new Map(), used: now() }; sprVer++;
  giveBufs(sh);
  s.px = B.w * B.h + Bs.w * Bs.h * (1 + layers.length);
  const old = SPR.get(key); if (old) sprPx -= old.px;
  SPR.set(key, s); sprPx += s.px;
  if (sprPx > SPR_BUDGET && now() - evictAt > 1000) sprEvict();
}
const SCR = [];
function scratch(i, w, h) {
  let c = SCR[i];
  if (!c) c = SCR[i] = mkCanvas(MX(64, w), MX(64, h));
  else if (c.width < w || c.height < h) { c.width = MX(c.width, w); c.height = MX(c.height, h); }
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, w, h);
  return c;
}
let evictAt = -1e9;
function sprEvict() {
  const order = [...SPR.entries()].sort((a, b) => a[1].used - b[1].used), keepAfter = now() - SPR_KEEP_MS;
  for (const [k, s] of order) { if (sprPx <= SPR_BUDGET * 0.75 || s.used > keepAfter) break; SPR.delete(k); sprPx -= s.px; }
  if (sprPx > SPR_BUDGET) evictAt = now(); // over budget with only visible sprites: retry later, not every build
}
function outlineOf(s, color) {
  let o = s.outl.get(color); if (o) return o;
  const r = 0.045 * s.res, c = s.sil, P = Math.ceil(r) + 1;
  o = mkCanvas(c.w + 2 * P, c.h + 2 * P); const x = o.getContext('2d');
  const t = mkCanvas(c.w, c.h), tx = t.getContext('2d'); tx.drawImage(c.img, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = color; tx.fillRect(0, 0, c.w, c.h);
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; x.drawImage(t, P + Math.cos(a) * r, P + Math.sin(a) * r); }
  o = { img: o, x: c.x - P, y: c.y - P, w: c.w + 2 * P, h: c.h + 2 * P };
  if (s.outl.size > 6) s.outl.clear(); s.outl.set(color, o); return o;
}
const pieceRes = (scale) => { const need = scale * (scale > 250 ? 1 : 1.08); for (const b of BUCKETS) if (b >= need) return b; return BUCKETS[BUCKETS.length - 1]; };
const RESHINT = new Map();
function pickRes(piece, skinId, scale) {
  const need = pieceRes(scale), k = piece + '|' + skinId + '|' + (need >= BIG ? 1 : 0), have = RESHINT.get(k);
  if (have && have >= need && have <= need * 2.3 && SPR.has(piece + '|' + skinId + '|' + have)) return have; // hysteresis: reuse a bigger sprite while scaling animates
  RESHINT.set(k, need); return need;
}
// best finished sprite of a piece/skin, preferring the closest resolution at or above `res`, else the largest below
function bestOf(piece, skinId, res) {
  const pre = piece + '|' + skinId + '|';
  let below = null;
  for (const b of BUCKETS) { const s = SPR.get(pre + b); if (!s) continue; if (b >= res) return s; below = s; }
  return below;
}

// ---------------------------------------------------------------- demand-driven build queue
// Every sprite is a job with a priority. Live draws re-request their sprite every frame, so jobs for things that
// left the screen go stale and are dropped. Icons are prioritised while an <img> showing their stand-in is on
// screen. Urgent work (visible stand-ins) runs in <= 8 ms slices posted through a MessageChannel, which yields to
// rendering and input between slices; everything else (upgrades of faint background pieces, warming) runs only in
// idle callbacks. The skin-independent G-buffer of a piece/resolution is built once and shared by every skin.
const JOBS = new Map(); // piece|skin|res -> job
const READY_CB = [];
const URGENT = 10, SLICE_MS = 8, STALE_MS = 1500;
let OWN = null;
// The local player's equipped skin is built first (menus call setOwnSkin; falls back to the live profile).
export function setOwnSkin(id) { OWN = id || null; }
const ownSkin = () => OWN || (typeof window !== 'undefined' && window.__cc && window.__cc.profile && window.__cc.profile.skin) || null;
function request(piece, skinId, res, prio, icon) {
  const key = piece + '|' + skinId + '|' + res;
  if (SPR.has(key)) return;
  const t = now(); let j = JOBS.get(key);
  if (!j) { j = { key, piece, skinId, res, sh: null, fin: null, prio, seen: t, icon: !!icon, born: t }; JOBS.set(key, j); }
  else { j.prio = t - j.seen > 250 ? prio : MX(j.prio, prio); j.seen = t; if (icon) j.icon = true; }
  schedule(icon ? URGENT : prio); // icons: the slice decides (visible ones are urgent)
}
// icon visibility (rescanned at most every 150 ms)
let visAt = -1e9; const VIS = new Set(), INDOM = new Set();
function scanVisible() {
  const t = now(); if (t - visAt < 150) return; visAt = t; VIS.clear(); INDOM.clear();
  if (!TEMP.size || typeof document === 'undefined') return;
  const H = innerHeight, W = innerWidth;
  for (const img of document.images) {
    const e = TEMPURL.get(img.getAttribute('src')); if (!e || VIS.has(e)) continue;
    const r = img.getBoundingClientRect();
    if (r.width > 0) INDOM.add(e); // laid out (not on a hidden screen)
    if (r.width > 0 && r.bottom > -40 && r.top < H + 40 && r.right > 0 && r.left < W) VIS.add(e);
  }
}
function prioOf(j, t) {
  let p;
  if (j.icon) {
    let vis = 0; for (const k of j.iconKeys || []) { const e = TEMP.get(k); if (e && VIS.has(e)) { vis = 2; break; } if (e && INDOM.has(e)) vis = 1; }
    p = vis === 2 ? 60 : vis ? 12 : 2; // on screen > in the page (scrolled away) > not shown anywhere
    if (!vis && t - j.seen < STALE_MS && j.prio > p) p = j.prio; // also drawn live
  } else p = j.prio;
  if (p >= URGENT && j.skinId === ownSkin()) p += 30; // the player's own skin first (never for faint backdrops)
  return p;
}
function pick() {
  scanVisible();
  const t = now(); let best = null, bp = -1;
  for (const j of JOBS.values()) {
    if (!j.icon && t - j.seen > STALE_MS && !j.fin) { // left the screen; drop a half-built big G-buffer with it
      JOBS.delete(j.key);
      const gk = gbKey(j.piece, j.res), g = GB.get(gk);
      if (g && !g.done && j.res >= BIG && ![...JOBS.values()].some((o) => o.piece === j.piece && o.res === j.res)) GB.delete(gk);
      continue;
    }
    const p = prioOf(j, t);
    if (p > bp) { bp = p; best = j; }
  }
  return best ? { j: best, p: bp } : null;
}
// one unit of work on a job within `ms`; returns true when the sprite was finished
function work(j, ms) {
  const t0 = now();
  const g = gbGet(j.piece, j.res);
  if (!g.done) { gbStep(g, ms); if (!g.done) return false; }
  if (!j.sh || j.sh.g !== g) j.sh = shadeInit(g, j.skinId);
  const st = j.sh;
  while (st.k < st.n) {
    const left = ms - (now() - t0); if (left <= 0) return false;
    const cnt = MX(256, MN(40000, Math.floor(left / MX(0.0005, st.msPx || 0.004))));
    const ta = now(), k0 = st.k; shadeRun(st, cnt);
    const per = (now() - ta) / MX(1, st.k - k0); st.msPx = st.msPx ? st.msPx * 0.6 + per * 0.4 : per;
  }
  if (!j.fin) j.fin = finishSteps(j.piece, j.skinId, j.res, g, st);
  while (now() - t0 < ms) if (j.fin.next().done) { JOBS.delete(j.key); return true; }
  return false;
}
let urgentPosted = false, idlePosted = false, finishedAny = false;
const MC = typeof MessageChannel !== 'undefined' && typeof window !== 'undefined' ? new MessageChannel() : null;
if (MC) MC.port1.onmessage = () => { urgentPosted = false; runSlice(urgentBudget(), URGENT); };
// Frame pacing: a slice normally costs <= SLICE_MS. When frames are already long (a saturated main thread only
// gives us one task per frame) the slice may grow to 10% of the frame interval (max 24 ms), so visible stand-ins
// still resolve while fps drops by at most ~10%.
let frameMs = 16, lastRaf = 0, rafOn = false;
function rafTick(t) { if (lastRaf) frameMs = frameMs * 0.8 + MN(1000, t - lastRaf) * 0.2; lastRaf = t; if (JOBS.size) requestAnimationFrame(rafTick); else { rafOn = false; lastRaf = 0; } }
function urgentBudget() {
  if (!rafOn && typeof requestAnimationFrame !== 'undefined') { rafOn = true; requestAnimationFrame(rafTick); }
  return frameMs > 60 ? MN(24, MX(SLICE_MS, frameMs * 0.1)) : SLICE_MS;
}
function schedule(prio) {
  if (typeof window === 'undefined') return;
  if (prio >= URGENT && !urgentPosted) { urgentPosted = true; if (MC) MC.port2.postMessage(0); else setTimeout(() => { urgentPosted = false; runSlice(urgentBudget(), URGENT); }, 0); }
  if (!idlePosted) {
    idlePosted = true;
    const ric = window.requestIdleCallback;
    if (ric) ric((d) => { idlePosted = false; runSlice(MN(SLICE_MS + 3, MX(3, d.timeRemaining() - 1)), 0); }, { timeout: 1200 });
    else setTimeout(() => { idlePosted = false; runSlice(SLICE_MS, 0); }, 60);
  }
}
const STATS = { slices: 0, ms: 0, idle: 0 }; // exposed via _internal for perf checks
function runSlice(ms, minPrio) {
  const t0 = now(); STATS.slices++; if (!minPrio) STATS.idle++;
  let next = null;
  while (now() - t0 < ms) {
    next = pick();
    if (!next || next.p < minPrio) { if (!next && minPrio === 0 && warmStep(ms - (now() - t0))) continue; break; }
    if (work(next.j, ms - (now() - t0))) { finishedAny = true; next = null; }
  }
  if (finishedAny) { finishedAny = false; for (const f of READY_CB) f(); }
  STATS.ms += now() - t0;
  next = next || pick();
  if (next) schedule(next.p);
  else if (WARM.length) schedule(0);
}
// cheap vector stand-in while a sprite builds
function drawFallback(ctx, piece, sk) {
  const p = getPath(piece === 'colossus' ? 'hollow' : piece);
  const g = ctx.createLinearGradient(-0.3, -1.1, 0.3, 0); g.addColorStop(0, sk.body[0]); g.addColorStop(1, sk.body[1]);
  ctx.fillStyle = g; ctx.fill(p); ctx.strokeStyle = sk.line; ctx.lineWidth = 0.03; ctx.lineJoin = 'round'; ctx.stroke(p);
}

// Draw a piece in local units. ctx must already be translated to the base and scaled to tile size.
// opts: { flash, alpha, t (seconds, drives skin animation), outline (css colour), res (force a sprite resolution) }
// Calls without `t` are treated as caching calls (sprite caches in fx.js, codex) and always get the full-quality
// sprite synchronously; calls with `t` never block: they draw the closest finished resolution (or a vector
// stand-in), queue the sprite that matches the on-screen size, and cross-fade to it when it is ready.
const PENDING = new Map(), FADES = new Map(), FADE_MS = 240, BIGSTABLE = new Map();
export function drawPiece(ctx, piece, skinId, opts = {}) {
  const { flash = 0, alpha = 1, outline = null } = opts, live = opts.t !== undefined, t = opts.t || 0;
  if (!LAZY[piece]) piece = 'pawn';
  if (piece === 'colossus' && skinId === 'hollow') skinId = 'colossus-boss';
  if (skinId !== 'hollow' && skinId !== 'colossus-boss' && !SKINS[skinId]) skinId = 'ivory';
  const tr = ctx.getTransform ? ctx.getTransform() : null;
  const scale = tr ? MX(Math.hypot(tr.a, tr.b), Math.hypot(tr.c, tr.d)) : 128;
  const ea = (ctx.globalAlpha === undefined ? 1 : ctx.globalAlpha) * alpha;
  let res = opts.res || pickRes(piece, skinId, scale);
  if (live && !opts.res && ea < 0.4) res = MN(res, pieceRes(scale * 0.6), 192); // faint background pieces
  const key = piece + '|' + skinId + '|' + res;
  let s = SPR.get(key), from;
  if (!s) {
    if (!live) s = spriteFor(piece, skinId, res);
    else {
      s = bestOf(piece, skinId, res);
      let prio = 4; // faint background pieces: idle time only
      if (ea >= 0.4) { prio = 20; if (!s) prio += 15; else if (s.res >= res * 0.66) prio -= 8; } // a near-enough sprite: upgrading is less urgent
      if (outline) prio += 30; // the local player's unit
      // big tiers are only queued once the on-screen size has settled (a pop/zoom animation would otherwise start
      // a 512 build that is abandoned a moment later)
      const sk2 = piece + '|' + skinId, st2 = res >= BIG ? BIGSTABLE.get(sk2) : null, tn = now();
      if (res >= BIG && (!st2 || st2.res !== res)) BIGSTABLE.set(sk2, { res, t: tn });
      else if (res < BIG || tn - st2.t > 350) request(piece, skinId, res, prio, false);
      if (!s && res > 128 && ea >= 0.4) request(piece, skinId, 128, prio + 5, false); // something real fast (also the big build's guide), then cross-fade up
      if (PENDING.size > 400) PENDING.clear();
      PENDING.set(key, s || 0);
    }
  } else if (live) {
    const pv = PENDING.get(key);
    if (pv !== undefined) { PENDING.delete(key); if (MOTION && pv !== s) FADES.set(key, { from: pv, t0: now() }); }
    const f = FADES.get(key);
    if (f) { const k = (now() - f.t0) / FADE_MS; if (k >= 1) FADES.delete(key); else from = { s: f.from, k }; }
  }
  if (s) s.used = now();
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (from) { // cross-fade from what was shown before the matching sprite was ready
    ctx.save();
    if (from.s) blitSprite(ctx, from.s, 0, null, 0); else drawFallback(ctx, piece, skinOf(skinId));
    ctx.restore();
    ctx.globalAlpha *= from.k * from.k * (3 - 2 * from.k);
  }
  if (!s) {
    drawFallback(ctx, piece, skinOf(skinId));
    if (flash > 0) { ctx.globalAlpha *= Math.min(1, flash); ctx.fillStyle = '#fff'; ctx.fill(getPath(piece)); }
    ctx.restore(); return;
  }
  blitSprite(ctx, s, flash, outline, t);
  ctx.restore();
}
function blitSprite(ctx, s, flash, outline, t) {
  const ir = 1 / s.res, dx = -s.ox * ir, dy = -s.oy * ir;
  const blit = (o) => { if (o.img) ctx.drawImage(o.img, dx + o.x * ir, dy + o.y * ir, o.w * ir, o.h * ir); };
  ctx.imageSmoothingEnabled = true;
  if (outline) blit(outlineOf(s, outline));
  blit(s.c);
  const n = s.layers.length;
  if (n && !MOTION_SET && ++motionTick > 90) { motionTick = 0; MOTION = !(typeof document !== 'undefined' && document.body && document.body.classList.contains('reduced')); }
  if (n) {
    const per = PERIOD[s.anim] || 3, ph = ((MOTION ? t : 0) / per) * n;
    const ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    for (let q = 0; q < n; q++) {
      let dd = AB(((ph - q) % n + n) % n); dd = MN(dd, n - dd);
      const w = 1 - dd; if (w <= 0.04) continue;
      ctx.globalAlpha = ga * w; blit(s.layers[q]);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ga;
  }
  if (flash > 0) { ctx.globalAlpha *= Math.min(1, flash); blit(s.sil); }
}
// true once the full-quality sprite for this piece/skin exists at some resolution
export const pieceReady = (piece, skinId) => !!bestOf(piece, skinId, 0);
// true once a live draw at `px` sprite pixels per tile unit would show the final sprite (not a stand-in or a
// lower-resolution one). Note: drawPiece WITHOUT opts.t is always final (it builds synchronously).
export const isPieceReady = (piece, skinId, px = 160) => SPR.has(piece + '|' + (piece === 'colossus' && skinId === 'hollow' ? 'colossus-boss' : skinId) + '|' + pieceRes(px));
// bumps whenever any sprite finishes (cheap change detection for callers that cache their own renders)
export const pieceVersion = () => sprVer;

// Icons are memoised URLs. A not-yet-built icon returns an SVG stand-in immediately (no canvas encode on the main
// thread); any <img> showing it is upgraded in place once the real sprite exists (PNG encoded off-thread via toBlob).
const ICONS = new Map(), TEMP = new Map(), TEMPURL = new Map(); // key -> url ; key -> entry ; stand-in url -> entry
function iconFrame(piece, px) { const top = -(PIECE_TOP[piece] || -1); return px * 0.86 / MX(1.06, top + 0.1); }
const iconDpr = () => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
function iconCanvas(piece, skinId, color, px, res) {
  const dpr = iconDpr();
  const c = mkCanvas(Math.round(px * dpr), Math.round(px * dpr));
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  if (color) {
    const g = x.createRadialGradient(px / 2, px * 0.86, 1, px / 2, px * 0.86, px * 0.42);
    g.addColorStop(0, color + 'aa'); g.addColorStop(1, color + '00');
    x.fillStyle = g; x.fillRect(0, 0, px, px);
  }
  const sc = iconFrame(piece, px);
  x.translate(px / 2, px * 0.9);
  x.scale(sc, sc);
  drawPiece(x, piece, skinId, { res });
  return c;
}
const SVGD = {};
function svgStandIn(piece, skinId, color, px) {
  const sk = skinOf(skinId === 'hollow' && piece === 'colossus' ? 'colossus-boss' : skinId), sc = iconFrame(piece, px);
  const d = SVGD[piece] ||= (() => { const r = new SvgRec(); tracePiece(r, piece === 'colossus' ? 'hollow' : piece); return r.d; })();
  const bg = color ? `<radialGradient id="g" cx="${px / 2}" cy="${px * 0.86}" r="${px * 0.42}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity=".67"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"><defs>${bg}<linearGradient id="b" x1="-0.3" y1="-1.1" x2="0.3" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${sk.body[0]}"/><stop offset="1" stop-color="${sk.body[1]}"/></linearGradient></defs>`
    + (color ? `<rect width="${px}" height="${px}" fill="url(#g)"/>` : '')
    + `<g opacity=".85" transform="translate(${px / 2} ${px * 0.9}) scale(${sc.toFixed(3)})"><path d="${d}" fill="url(#b)" stroke="${sk.line}" stroke-width="0.03" stroke-linejoin="round"/></g></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
export function pieceIcon(piece, skinId, color = null, px = 64) {
  const key = piece + '|' + skinId + '|' + color + '|' + px;
  const hit = ICONS.get(key); if (hit) return hit;
  const tmp = TEMP.get(key); if (tmp) return tmp.url;
  if (!LAZY[piece]) piece = 'pawn';
  const sk = piece === 'colossus' && skinId === 'hollow' ? 'colossus-boss' : skinId;
  const res = pieceRes(iconFrame(piece, px) * iconDpr() * 0.9);
  if (SPR.has(piece + '|' + sk + '|' + res) || typeof window === 'undefined') { // sprite ready: encode now
    const url = iconCanvas(piece, skinId, color, px, res).toDataURL();
    if (ICONS.size > 600) clearIcons();
    ICONS.set(key, url); return url;
  }
  const url = svgStandIn(piece, skinId, color, px);
  const e = { key, url, piece, skinId, sk, color, px, res };
  TEMP.set(key, e); TEMPURL.set(url, e); visAt = -1e9;
  const jk = piece + '|' + sk + '|' + res;
  request(piece, sk, res, 2, true);
  const j = JOBS.get(jk); if (j) (j.iconKeys ||= []).push(key);
  return url;
}
// debug / tests: true once pieceIcon(...) returns the final (non stand-in) image
export const iconReady = (piece, skinId, color = null, px = 64) => ICONS.has(piece + '|' + skinId + '|' + color + '|' + px);
// B3 10.1: blob: icon URLs pin their PNG until revoked; free them when the memo is dropped (shown <img>s keep their decoded image)
function clearIcons() {
  const old = [...ICONS.values()].filter((u) => typeof u === 'string' && u.startsWith('blob:')); ICONS.clear();
  if (old.length) setTimeout(() => { for (const u of old) { try { URL.revokeObjectURL(u); } catch {} } }, 30000); // after any in-flight markup has loaded
}
let iconSwapBusy = false;
READY_CB.push(function swapIcons() {
  if (!TEMP.size || iconSwapBusy) return;
  const ready = [];
  for (const e of TEMP.values()) {
    if (SPR.has(e.piece + '|' + e.sk + '|' + e.res)) ready.push(e);
    else if (!JOBS.has(e.piece + '|' + e.sk + '|' + e.res)) { request(e.piece, e.sk, e.res, 2, true); const j = JOBS.get(e.piece + '|' + e.sk + '|' + e.res); if (j) (j.iconKeys ||= []).push(e.key); }
  }
  if (!ready.length) return;
  iconSwapBusy = true;
  let left = ready.length; const swaps = new Map();
  const done = () => {
    if (--left) return;
    iconSwapBusy = false;
    if (swaps.size && typeof document !== 'undefined') for (const img of document.images) { const u = swaps.get(img.getAttribute('src')); if (u) img.src = u; }
    if (TEMP.size) for (const e of TEMP.values()) if (SPR.has(e.piece + '|' + e.sk + '|' + e.res)) { swapIcons(); break; }
  };
  for (const e of ready) {
    TEMP.delete(e.key); TEMPURL.delete(e.url);
    const c = iconCanvas(e.piece, e.skinId, e.color, e.px, e.res);
    const fin = (url) => { if (ICONS.size > 600) clearIcons(); ICONS.set(e.key, url); swaps.set(e.url, url); done(); };
    if (c.toBlob && typeof URL !== 'undefined' && URL.createObjectURL) c.toBlob((b) => fin(b ? URL.createObjectURL(b) : c.toDataURL()), 'image/png');
    else fin(c.toDataURL());
  }
});

// Warm skin-independent G-buffers in idle time only (never competes with visible work). With no arguments it
// warms what a match needs (board sprites are built at 192 by fx.hiSprite; HUD and menus use 96/128).
const WARM = [];
export function warmPieces(list = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'hollow'], resList = [192, 96]) {
  for (const r of resList) for (const p of list) if (!WARM.some((q) => q[0] === p && q[1] === r)) WARM.push([p, r]);
  schedule(0);
}
function warmStep(ms) {
  while (WARM.length) { const g = GB.get(gbKey(WARM[0][0], WARM[0][1])); if (g && g.done) WARM.shift(); else break; }
  if (!WARM.length || ms <= 0) return false;
  gbStep(gbGet(WARM[0][0], WARM[0][1]), ms);
  return true;
}
if (typeof window !== 'undefined') setTimeout(() => warmPieces(), 6000);

// ---------------------------------------------------------------- legacy vector paths (kept for API compatibility)
function plinth(p) {
  p.moveTo(-0.3, 0); p.lineTo(0.3, 0); p.quadraticCurveTo(0.32, -0.08, 0.26, -0.11);
  p.lineTo(0.24, -0.17); p.lineTo(-0.24, -0.17); p.lineTo(-0.26, -0.11); p.quadraticCurveTo(-0.32, -0.08, -0.3, 0); p.closePath();
}
export function piecePath(piece) { const p = new Path2D(); tracePiece(p, piece); return p; }
// records the same outline as an SVG path (icon stand-ins)
const f3 = (v) => +v.toFixed(3);
class SvgRec {
  constructor() { this.d = ''; }
  moveTo(x, y) { this.d += `M${f3(x)} ${f3(y)}`; }
  lineTo(x, y) { this.d += `L${f3(x)} ${f3(y)}`; }
  quadraticCurveTo(a, b, x, y) { this.d += `Q${f3(a)} ${f3(b)} ${f3(x)} ${f3(y)}`; }
  bezierCurveTo(a, b, c, d, x, y) { this.d += `C${f3(a)} ${f3(b)} ${f3(c)} ${f3(d)} ${f3(x)} ${f3(y)}`; }
  closePath() { this.d += 'Z'; }
  rect(x, y, w, h) { this.d += `M${f3(x)} ${f3(y)}h${f3(w)}v${f3(h)}h${f3(-w)}Z`; }
  ellipse(cx, cy, rx, ry) { this.d += `M${f3(cx + rx)} ${f3(cy)}A${f3(rx)} ${f3(ry)} 0 1 0 ${f3(cx - rx)} ${f3(cy)}A${f3(rx)} ${f3(ry)} 0 1 0 ${f3(cx + rx)} ${f3(cy)}Z`; }
  arc(cx, cy, r) { this.ellipse(cx, cy, r, r); }
}
function tracePiece(p, piece) {
  plinth(p);
  switch (piece) {
    case 'pawn': p.moveTo(-0.2, -0.16); p.quadraticCurveTo(-0.1, -0.3, -0.09, -0.5); p.lineTo(0.09, -0.5); p.quadraticCurveTo(0.1, -0.3, 0.2, -0.16); p.closePath(); p.moveTo(0.16, -0.7); p.arc(0, -0.7, 0.16, 0, Math.PI * 2); break;
    case 'rook': p.moveTo(-0.22, -0.16); p.lineTo(-0.18, -0.78); p.lineTo(0.18, -0.78); p.lineTo(0.22, -0.16); p.closePath(); p.rect(-0.25, -0.98, 0.5, 0.2); break;
    case 'bishop': p.moveTo(-0.2, -0.16); p.lineTo(-0.09, -0.6); p.lineTo(0.09, -0.6); p.lineTo(0.2, -0.16); p.closePath(); p.ellipse(0, -0.82, 0.16, 0.24, 0, 0, Math.PI * 2); p.moveTo(0.04, -1.11); p.arc(0, -1.11, 0.04, 0, Math.PI * 2); break;
    case 'knight': p.moveTo(-0.22, -0.16); p.bezierCurveTo(-0.27, -0.5, -0.2, -0.85, -0.03, -1.1); p.lineTo(0.0, -1.18); p.lineTo(0.06, -1.06); p.bezierCurveTo(0.2, -0.95, 0.3, -0.8, 0.37, -0.62); p.lineTo(0.33, -0.55); p.lineTo(0.08, -0.58); p.bezierCurveTo(0.08, -0.45, 0.18, -0.3, 0.21, -0.16); p.closePath(); break;
    case 'queen': p.moveTo(-0.2, -0.16); p.lineTo(-0.09, -0.75); p.lineTo(0.09, -0.75); p.lineTo(0.2, -0.16); p.closePath(); p.moveTo(-0.1, -0.76); p.lineTo(-0.21, -1.04); p.lineTo(0.21, -1.04); p.lineTo(0.1, -0.76); p.closePath(); p.moveTo(0.045, -1.09); p.arc(0, -1.09, 0.045, 0, Math.PI * 2); break;
    case 'king': p.moveTo(-0.2, -0.16); p.lineTo(-0.1, -0.76); p.lineTo(0.1, -0.76); p.lineTo(0.2, -0.16); p.closePath(); p.moveTo(-0.13, -0.77); p.lineTo(-0.2, -1.04); p.lineTo(0.2, -1.04); p.lineTo(0.13, -0.77); p.closePath(); p.rect(-0.02, -1.36, 0.04, 0.24); p.rect(-0.065, -1.31, 0.13, 0.04); break;
    default: p.ellipse(0, -0.5, 0.25, 0.48, 0, 0, Math.PI * 2);
  }
}
const PATHS = {};
export const getPath = (piece) => (PATHS[piece] ||= piecePath(piece));

// Node/test hook: raw shading without canvas (used by the contact-sheet tools).
export const _internal = { getGB, shade, SCENES, materialOf, JOBS, TEMP, SPR, GB, VIS, STATS };

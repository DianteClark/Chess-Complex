// Chess Complex 10.2 (Input & UX): board tap resolution, target assist and the confirm loupe.
// main.js owns the pointer handlers and calls in here; nothing in this file touches game state directly.
//
// How a tap becomes an action:
//  1. touch-down freezes the camera mapping (Renderer.view()) and the aim point; the finger may drift up to SLOP px
//     before the gesture turns into a pan, and the tap always resolves at the touch-down point with that frozen mapping;
//  2. pick() resolves what the player meant: a piece's body (sprites stand taller than their tile) selects its tile,
//     then a legal target under the finger, and a near miss (within ASSIST of a legal target) snaps to the closest one;
//  3. when tiles are small (< SMALL px) a touch first previews the target and shows a magnified loupe; a second tap on
//     the same target (or anywhere on it inside the loupe) confirms. The one-tap setting skips the preview.
import { SIZE } from './data.js';
import { PIECE_TOP, pieceKind } from './pieces.js';

export const SMALL = 30; // tile size in CSS px below which touch taps preview first
export const slopFor = (pointerType) => pointerType === 'mouse' ? 5 : Math.round(Math.min(18, 10 + 2.5 * Math.min(3, devicePixelRatio || 1)));
// assist radius, in tiles, from a candidate's centre: ~14 px on screen, never less than 0.6 of a tile, capped below a full tile
export const assistR = (z) => Math.max(0.6, Math.min(0.85, 14 / z));

const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;

// The unit whose drawn body covers world point (wx, wy); front-most (largest y) wins, like the draw order.
export function unitAt(r, s, wx, wy, tol = 0) {
  let best = null, bestY = -1e9;
  for (const u of s.units) {
    if (!u.alive) continue;
    const d = r.disp && r.disp.get(u.id); const ux = d ? d.x : u.x, uy = d ? d.y : u.y;
    const BS = u.boss ? 1.5 : u.role === 'mite' ? 0.7 : 1;
    const base = uy + 0.86, top = base + (PIECE_TOP[pieceKind(u)] || -1) * 0.92 * BS - (d && d.lift || 0);
    // silhouette: full body width below, a narrower head in the top third (that is the part that pokes into the tile above)
    const hw = (wy < top + (base - top) * 0.33 ? 0.24 : 0.36) * BS + tol;
    const inBody = wx >= ux + 0.5 - hw && wx <= ux + 0.5 + hw && wy >= top - tol && wy <= base + 0.1;
    const inTile = !tol && Math.floor(wx) === u.x && Math.floor(wy) === u.y;
    if ((inBody || inTile) && base > bestY) { best = u; bestY = base; }
  }
  return best;
}

// Legal targets right now: [{ x, y, opt? }]. Move mode uses the move overlay; ability modes use every option's anchor.
export function candidates(g) {
  if (!g.s || !g.myTurn()) return [];
  if (g.mode === 'move') return ((g.r.overlay && g.r.overlay.moves) || []).map((m) => ({ x: m.x, y: m.y }));
  return (g.options() || []).map((o) => ({ x: o.anchor.x, y: o.anchor.y, opt: o }));
}

// Resolve a world point to { tile, cand } where cand is a legal target (or null). prefer: a target that wins near-ties.
export function pick(g, wx, wy, z, prefer) {
  const r = g.r, s = g.s;
  const raw = { x: Math.floor(wx), y: Math.floor(wy) };
  const onBoard = (t) => t && t.x >= 0 && t.y >= 0 && t.x < SIZE && t.y < SIZE;
  const cands = candidates(g);
  const find = (t) => t && cands.find((c) => same(c, t));
  // an ability option also owns the tiles it strikes when it is the only option covering that tile
  const owner = (t) => { if (g.mode === 'move') return null; const hit = cands.filter((c) => c.opt && c.opt.tiles.some((p) => same(p, t))); return hit.length === 1 ? hit[0] : null; };
  const u = unitAt(r, s, wx, wy);
  const ut = u ? { x: u.x, y: u.y } : null;
  // 1. a piece's body selects the piece's tile: what you see is what you tap (sprites stand taller than their tile).
  //    A legal target there (attack the enemy you touched, even on its head) or else inspect; never snaps away.
  if (ut) return find(ut) ? { tile: ut, cand: find(ut), how: 'body' } : { tile: ut, cand: owner(ut), how: 'unit' };
  // 2. the tile under the finger is a legal target
  if (find(raw)) return { tile: raw, cand: find(raw), how: 'tile' };
  const own = owner(raw); if (own) return { tile: raw, cand: own, how: 'area' };
  // 3. near miss: the closest legal target within the assist radius (the previewed one gets a little extra reach)
  const R = assistR(z);
  let best = null, bd = 1e9;
  for (const c of cands) {
    const d = Math.hypot(wx - (c.x + 0.5), wy - (c.y + 0.5)) - (same(c, prefer) ? 0.2 : 0);
    if (d < bd) { bd = d; best = c; }
  }
  if (best && bd <= R) return { tile: { x: best.x, y: best.y }, cand: best, how: 'assist' };
  // 4. a near miss on a piece (just outside its silhouette, on an empty tile): look at that piece
  const nu = unitAt(r, s, wx, wy, Math.min(0.3, 8 / z));
  if (nu) return { tile: { x: nu.x, y: nu.y }, cand: null, how: 'unit' };
  return { tile: onBoard(raw) ? raw : null, cand: null, how: 'none' };
}

// ---------- loupe ----------
// A magnified view of the previewed target, drawn over the finished frame (copied from the board canvas), so the
// player can see exactly which tile the next tap confirms. Taps inside it map back to the board at loupe precision.
const LR = 54; // loupe radius, CSS px
export function setLoupe(r, tile, label, color) {
  if (!tile) { r.loupe = null; return; }
  const keep = r.loupe && same(r.loupe, tile);
  r.loupe = { x: tile.x, y: tile.y, label, color: color || '#7fe0ff', t0: keep ? r.loupe.t0 : performance.now() };
}
function geom(r, L) {
  const [sx, sy] = r.toScreen(L.x + 0.5, L.y + 0.5);
  const m = Math.max(1.8, Math.min(3.2, (LR * 2 / 3.4) / r.z)); // about 3.4 tiles across
  const gap = Math.max(26, r.z * 0.9);
  let cy = sy - LR - gap; const below = cy - LR < (r.pad ? r.pad.t : 0) + 4;
  if (below) cy = sy + LR + gap;
  const vw = r.VW || r.W;
  const cx = Math.max(LR + 6, Math.min(vw - LR - 6, sx));
  return { cx, cy, sx, sy, m, below };
}
// world point under a screen point inside the loupe, or null if the point is outside it
export function loupeWorld(r, px, py) {
  const L = r.loupe; if (!L || !L.g) return null;
  const G = L.g, dx = px - G.cx, dy = py - G.cy;
  if (dx * dx + dy * dy > (LR + 6) * (LR + 6)) return null;
  const [wx, wy] = r.toWorld(G.sx + dx / G.m, G.sy + dy / G.m, G.v);
  return { wx, wy, z: G.v.z * G.m };
}
let tmp = null;
export function drawLoupe(r) {
  const L = r.loupe; if (!L || !r.state) return;
  const ctx = r.x, dpr = r.dpr, G = geom(r, L);
  G.v = r.view(); L.g = G;
  const k = r.reduced ? 1 : Math.min(1, (performance.now() - L.t0) / 140), sc = 0.7 + 0.3 * (1 - Math.pow(1 - k, 3));
  const src = (LR * 2) / G.m; // CSS px of board shown
  const need = Math.ceil(src * dpr);
  if (!tmp) tmp = document.createElement('canvas');
  if (tmp.width !== need) { tmp.width = tmp.height = need; }
  const tc = tmp.getContext('2d');
  tc.clearRect(0, 0, need, need);
  tc.drawImage(r.c, Math.round((G.sx - src / 2) * dpr), Math.round((G.sy - src / 2) * dpr), need, need, 0, 0, need, need);
  ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(G.cx, G.cy); ctx.scale(sc, sc); ctx.globalAlpha = k;
  // tail pointing at the target
  const ty = G.below ? -LR : LR, tipY = (G.sy - G.cy) / sc;
  ctx.fillStyle = 'rgba(8,7,12,0.9)'; ctx.beginPath(); ctx.moveTo(-10, ty * 0.92); ctx.lineTo(10, ty * 0.92); ctx.lineTo((G.sx - G.cx) / sc, tipY - Math.sign(tipY) * r.z * 0.45); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, LR, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#07060b'; ctx.fillRect(-LR, -LR, LR * 2, LR * 2);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, -LR, -LR, LR * 2, LR * 2);
  // target frame at loupe scale
  const ts = r.z * G.m, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
  ctx.strokeStyle = L.color; ctx.lineWidth = 2.5; ctx.globalAlpha = k * (0.75 + 0.25 * pulse);
  ctx.strokeRect(-ts / 2 + 2, -ts / 2 + 2, ts - 4, ts - 4); ctx.globalAlpha = k;
  ctx.restore();
  ctx.lineWidth = 2; ctx.strokeStyle = L.color; ctx.beginPath(); ctx.arc(0, 0, LR, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(0, 0, LR + 1.5, 0, Math.PI * 2); ctx.stroke();
  if (L.label) {
    ctx.font = '700 11px "Chakra Petch", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(L.label).width + 16, ly = G.below ? LR + 13 : -LR - 13;
    const lx = Math.max(6 + w / 2 - G.cx, Math.min((r.VW || r.W) - 6 - w / 2 - G.cx, 0)); // keep the pill on screen
    ctx.fillStyle = 'rgba(8,7,12,0.92)'; ctx.fillRect(lx - w / 2, ly - 9, w, 18);
    ctx.strokeStyle = L.color; ctx.lineWidth = 1; ctx.strokeRect(lx - w / 2 + 0.5, ly - 8.5, w - 1, 17);
    ctx.fillStyle = '#f2ecff'; ctx.fillText(L.label, lx, ly + 0.5);
  }
  ctx.restore();
}

// Vector piece art. Coordinates: origin at base centre, 1 unit = 1 tile, up is negative y.
import { SKINS } from './data.js';

export const HOLLOW_SKIN = { body: ['#9a97c4', '#2a2840'], rim: '#d9d6ff', glow: '#8f8cff', line: '#15142a', fx: 'wisp' };
export const skinOf = (id) => (id === 'hollow' ? HOLLOW_SKIN : SKINS[id] || SKINS.ivory);

function plinth(p) {
  p.moveTo(-0.36, 0); p.lineTo(0.36, 0);
  p.quadraticCurveTo(0.38, -0.08, 0.3, -0.12);
  p.lineTo(0.27, -0.2); p.lineTo(-0.27, -0.2);
  p.lineTo(-0.3, -0.12);
  p.quadraticCurveTo(-0.38, -0.08, -0.36, 0);
  p.closePath();
}
function collar(p, y, w) { p.ellipse(0, y, w, 0.045, 0, 0, Math.PI * 2); }

export function piecePath(piece) {
  const p = new Path2D();
  switch (piece) {
    case 'pawn':
      plinth(p);
      p.moveTo(-0.24, -0.19); p.quadraticCurveTo(-0.1, -0.3, -0.09, -0.5); p.lineTo(0.09, -0.5); p.quadraticCurveTo(0.1, -0.3, 0.24, -0.19); p.closePath();
      collar(p, -0.52, 0.17);
      p.moveTo(0.18, -0.72); p.arc(0, -0.72, 0.18, 0, Math.PI * 2);
      break;
    case 'rook':
      plinth(p);
      p.moveTo(-0.24, -0.19); p.lineTo(-0.19, -0.7); p.lineTo(0.19, -0.7); p.lineTo(0.24, -0.19); p.closePath();
      p.moveTo(-0.29, -0.7); p.lineTo(0.29, -0.7); p.lineTo(0.3, -0.84); p.lineTo(-0.3, -0.84); p.closePath();
      for (const x of [-0.3, -0.06, 0.18]) p.rect(x, -1.0, 0.12, 0.17);
      break;
    case 'bishop':
      plinth(p);
      p.moveTo(-0.24, -0.19); p.quadraticCurveTo(-0.08, -0.32, -0.08, -0.52); p.lineTo(0.08, -0.52); p.quadraticCurveTo(0.08, -0.32, 0.24, -0.19); p.closePath();
      collar(p, -0.55, 0.17);
      p.moveTo(0, -1.08);
      p.bezierCurveTo(0.2, -0.92, 0.22, -0.7, 0.12, -0.6);
      p.lineTo(-0.12, -0.6);
      p.bezierCurveTo(-0.22, -0.7, -0.2, -0.92, 0, -1.08);
      p.moveTo(0.055, -1.12); p.arc(0, -1.12, 0.055, 0, Math.PI * 2);
      break;
    case 'knight':
      plinth(p);
      p.moveTo(-0.27, -0.19);
      p.bezierCurveTo(-0.3, -0.45, -0.28, -0.75, -0.12, -0.95);
      p.lineTo(-0.02, -1.08); p.lineTo(0.03, -1.17); p.lineTo(0.09, -1.03);
      p.bezierCurveTo(0.22, -0.98, 0.3, -0.85, 0.36, -0.7);
      p.quadraticCurveTo(0.38, -0.6, 0.3, -0.58);
      p.lineTo(0.16, -0.6);
      p.quadraticCurveTo(0.06, -0.6, 0.04, -0.54);
      p.bezierCurveTo(0.12, -0.44, 0.26, -0.32, 0.27, -0.19);
      p.closePath();
      break;
    case 'queen':
      plinth(p);
      p.moveTo(-0.25, -0.19); p.quadraticCurveTo(-0.08, -0.36, -0.08, -0.6); p.lineTo(0.08, -0.6); p.quadraticCurveTo(0.08, -0.36, 0.25, -0.19); p.closePath();
      collar(p, -0.62, 0.17);
      p.moveTo(-0.15, -0.66); p.lineTo(-0.27, -0.98); p.lineTo(-0.12, -0.84); p.lineTo(0, -1.04); p.lineTo(0.12, -0.84); p.lineTo(0.27, -0.98); p.lineTo(0.15, -0.66); p.closePath();
      for (const [x, y] of [[-0.27, -1.0], [0, -1.07], [0.27, -1.0]]) { p.moveTo(x + 0.05, y); p.arc(x, y, 0.05, 0, Math.PI * 2); }
      break;
    case 'king':
      plinth(p);
      p.moveTo(-0.25, -0.19); p.quadraticCurveTo(-0.08, -0.36, -0.08, -0.62); p.lineTo(0.08, -0.62); p.quadraticCurveTo(0.08, -0.36, 0.25, -0.19); p.closePath();
      collar(p, -0.64, 0.18);
      p.moveTo(-0.16, -0.68); p.quadraticCurveTo(-0.26, -0.9, -0.08, -0.96); p.lineTo(0.08, -0.96); p.quadraticCurveTo(0.26, -0.9, 0.16, -0.68); p.closePath();
      p.rect(-0.035, -1.24, 0.07, 0.28);
      p.rect(-0.11, -1.16, 0.22, 0.065);
      break;
    case 'hollow':
      p.moveTo(-0.26, -0.06);
      p.quadraticCurveTo(-0.17, -0.12, -0.13, -0.04); p.quadraticCurveTo(-0.07, -0.12, 0, -0.04); p.quadraticCurveTo(0.07, -0.12, 0.13, -0.04); p.quadraticCurveTo(0.17, -0.12, 0.26, -0.06);
      p.bezierCurveTo(0.3, -0.4, 0.26, -0.62, 0.2, -0.72);
      p.arc(0, -0.74, 0.2, 0, Math.PI, true);
      p.bezierCurveTo(-0.26, -0.62, -0.3, -0.4, -0.26, -0.06);
      p.closePath();
      break;
  }
  return p;
}
const PATHS = {};
export const getPath = (piece) => (PATHS[piece] ||= piecePath(piece));

export const PIECE_TOP = { pawn: -0.92, rook: -1.02, bishop: -1.18, knight: -1.18, queen: -1.1, king: -1.26, hollow: -0.96 };

// Draw a piece in local units. ctx must already be translated to the base and scaled to tile size.
export function drawPiece(ctx, piece, skinId, opts = {}) {
  const sk = skinOf(skinId);
  const path = getPath(piece);
  const { flash = 0, alpha = 1, t = 0, outline = null } = opts;
  ctx.save();
  ctx.globalAlpha *= alpha * (piece === 'hollow' ? 0.82 : 1);
  ctx.lineJoin = 'round';
  if (outline) {
    ctx.strokeStyle = outline; ctx.lineWidth = 0.09; ctx.stroke(path);
  }
  if (sk.wire) {
    ctx.fillStyle = sk.body[1]; ctx.fill(path);
    ctx.shadowColor = sk.glow; ctx.shadowBlur = 10;
    ctx.strokeStyle = sk.glow; ctx.lineWidth = 0.035; ctx.stroke(path);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = sk.rim; ctx.lineWidth = 0.012; ctx.stroke(path);
    // circuit traces
    ctx.save(); ctx.clip(path);
    ctx.strokeStyle = sk.rim; ctx.globalAlpha *= 0.45; ctx.lineWidth = 0.012;
    const off = (t * 0.4) % 0.2;
    for (let y = -1.3 + off; y < 0; y += 0.2) { ctx.beginPath(); ctx.moveTo(-0.4, y); ctx.lineTo(-0.05, y); ctx.lineTo(0.05, y - 0.08); ctx.lineTo(0.4, y - 0.08); ctx.stroke(); }
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(-0.35, -1.1, 0.35, 0);
    g.addColorStop(0, sk.body[0]); g.addColorStop(1, sk.body[1]);
    ctx.fillStyle = g; ctx.fill(path);
    ctx.save(); ctx.clip(path);
    const r = ctx.createRadialGradient(-0.14, -0.85, 0.02, -0.14, -0.85, 0.6);
    r.addColorStop(0, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r; ctx.fillRect(-0.5, -1.4, 1, 1.4);
    // rim light on the right edge
    const rg = ctx.createLinearGradient(0.1, 0, 0.4, 0);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, sk.glow + '55');
    ctx.fillStyle = rg; ctx.fillRect(0, -1.4, 0.5, 1.4);
    if (sk.fx === 'star') {
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 9; i++) {
        const sx = Math.sin(i * 12.9898) * 0.3, sy = -0.15 - ((i * 0.137 + t * 0.03) % 1) * 1.05;
        ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(t * 2 + i));
        ctx.fillRect(sx, sy, 0.018, 0.018);
      }
    }
    if (sk.fx === 'glint') {
      const gx = ((t * 0.35) % 2) - 1;
      const gl = ctx.createLinearGradient(gx - 0.15, -1, gx + 0.15, 0);
      gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(-0.5, -1.4, 1, 1.4);
    }
    ctx.restore();
    ctx.strokeStyle = sk.line; ctx.lineWidth = 0.03; ctx.stroke(path);
  }
  if (piece === 'knight') { ctx.fillStyle = sk.wire ? sk.glow : sk.line; ctx.beginPath(); ctx.arc(0.14, -0.86, 0.03, 0, Math.PI * 2); ctx.fill(); }
  if (piece === 'bishop') { ctx.strokeStyle = sk.wire ? sk.glow : sk.line; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(-0.06, -0.78); ctx.lineTo(0.08, -0.92); ctx.stroke(); }
  if (piece === 'hollow') {
    ctx.fillStyle = '#c8f3ff'; ctx.shadowColor = '#8ff0ff'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.ellipse(-0.075, -0.72, 0.035, 0.05, 0, 0, Math.PI * 2); ctx.ellipse(0.075, -0.72, 0.035, 0.05, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (flash > 0) { ctx.globalAlpha = Math.min(1, flash) * alpha; ctx.fillStyle = '#ffffff'; ctx.fill(path); }
  ctx.restore();
}

const ICONS = new Map();
export function pieceIcon(piece, skinId, color = null, px = 64) {
  const key = piece + skinId + color + px;
  if (ICONS.has(key)) return ICONS.get(key);
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = px * dpr;
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  if (color) {
    const g = x.createRadialGradient(px / 2, px * 0.86, 1, px / 2, px * 0.86, px * 0.42);
    g.addColorStop(0, color + 'aa'); g.addColorStop(1, color + '00');
    x.fillStyle = g; x.fillRect(0, 0, px, px);
  }
  x.translate(px / 2, px * 0.9);
  const sc = px * 0.7;
  x.scale(sc, sc);
  drawPiece(x, piece, skinId, { t: 0 });
  const url = c.toDataURL();
  ICONS.set(key, url);
  return url;
}

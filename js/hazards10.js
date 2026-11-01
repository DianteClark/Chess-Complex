// A9 (10.0): minimal readable visuals for the new gameplay tiles and unit states.
// A fallback until the world renderer draws its own art; render.js calls tile() from the animated floor loop
// and overlay() after units. Everything is in world units (1 = one tile). Cheap: flat fills and strokes only.
import { ROLES } from './engine.js';

export const TILES = { throne: 1, geyser: 1, conveyor: 1, crumble: 1, pit: 1 };
const isT = (s, x, y, k) => x >= 0 && y >= 0 && x < 16 && y < 16 && s.tiles[y * 16 + x].t === k;

export function tile(r, ctx, t, x, y, T) {
  const s = r.state;
  if (t.t === 'throne') {
    const p = 0.5 + 0.5 * Math.sin(T * 2 + (x + y) * 0.5);
    ctx.fillStyle = `rgba(255,200,80,${0.13 + p * 0.06})`; ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = 'rgba(255,215,110,0.28)'; ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.15); ctx.lineTo(x + 0.85, y + 0.5); ctx.lineTo(x + 0.5, y + 0.85); ctx.lineTo(x + 0.15, y + 0.5); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 0.07; ctx.beginPath();
    if (!isT(s, x, y - 1, 'throne')) { ctx.moveTo(x, y + 0.035); ctx.lineTo(x + 1, y + 0.035); }
    if (!isT(s, x, y + 1, 'throne')) { ctx.moveTo(x, y + 0.965); ctx.lineTo(x + 1, y + 0.965); }
    if (!isT(s, x - 1, y, 'throne')) { ctx.moveTo(x + 0.035, y); ctx.lineTo(x + 0.035, y + 1); }
    if (!isT(s, x + 1, y, 'throne')) { ctx.moveTo(x + 0.965, y); ctx.lineTo(x + 0.965, y + 1); }
    ctx.stroke();
    if (s.hill && s.hill.holder != null) { const h = s.units.find((u) => u.id === s.hill.holder); if (h) { ctx.fillStyle = h.color; ctx.globalAlpha *= 0.12; ctx.fillRect(x, y, 1, 1); ctx.globalAlpha /= 0.12; } }
  } else if (t.t === 'geyser') {
    const hot = t.ph === 2, p = 0.5 + 0.5 * Math.sin(T * (hot ? 9 : 3) + x);
    if (hot) { // the plus that will be scalded
      ctx.fillStyle = `rgba(150,240,255,${0.1 + p * 0.12})`;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ctx.fillRect(x + dx + 0.06, y + dy + 0.06, 0.88, 0.88);
    }
    ctx.save(); ctx.translate(x + 0.5, y + 0.55); ctx.scale(1, 0.75);
    ctx.fillStyle = '#3b3340'; ctx.beginPath(); ctx.arc(0, 0, 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hot ? `rgba(160,245,255,${0.6 + p * 0.4})` : t.ph === 1 ? '#3f6f80' : '#1d2a33';
    ctx.beginPath(); ctx.arc(0, 0, 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hot ? '#e6fdff' : '#7d6f86'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(0, 0, 0.36, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (hot || t.ph === 1) { // steam wisps
      ctx.strokeStyle = `rgba(230,250,255,${hot ? 0.55 : 0.22})`; ctx.lineWidth = 0.04;
      for (let i = 0; i < (hot ? 3 : 1); i++) { const k = (T * 0.8 + i * 0.33) % 1; const yy = y + 0.45 - k * 0.6; ctx.globalAlpha *= 1 - k; ctx.beginPath(); ctx.moveTo(x + 0.4 + i * 0.1, yy + 0.15); ctx.quadraticCurveTo(x + 0.6 + Math.sin(T * 3 + i) * 0.1, yy + 0.05, x + 0.45 + i * 0.1, yy - 0.08); ctx.stroke(); ctx.globalAlpha /= 1 - k || 1; }
    }
  } else if (t.t === 'conveyor') {
    ctx.fillStyle = '#2b2a31'; ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
    ctx.strokeStyle = '#55525f'; ctx.lineWidth = 0.04; ctx.strokeRect(x + 0.06, y + 0.06, 0.88, 0.88);
    const dx = t.dx || 0, dy = t.dy || 0, off = (T * 0.6) % 0.5;
    ctx.save(); ctx.beginPath(); ctx.rect(x + 0.06, y + 0.06, 0.88, 0.88); ctx.clip();
    ctx.translate(x + 0.5, y + 0.5); ctx.rotate(Math.atan2(dy, dx));
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 0.08; ctx.lineCap = 'round';
    for (let i = -2; i <= 2; i++) { const c = i * 0.5 + off; ctx.beginPath(); ctx.moveTo(c - 0.12, -0.22); ctx.lineTo(c + 0.08, 0); ctx.lineTo(c - 0.12, 0.22); ctx.stroke(); }
    ctx.lineCap = 'butt'; ctx.restore();
  } else if (t.t === 'crumble') {
    const bad = t.hp <= 1;
    if (bad) { ctx.fillStyle = 'rgba(20,14,18,0.35)'; ctx.fillRect(x + 0.05, y + 0.05, 0.9, 0.9); }
    ctx.strokeStyle = bad ? 'rgba(255,170,90,0.85)' : 'rgba(200,180,150,0.55)'; ctx.lineWidth = bad ? 0.055 : 0.035;
    ctx.beginPath();
    ctx.moveTo(x + 0.12, y + 0.3); ctx.lineTo(x + 0.42, y + 0.45); ctx.lineTo(x + 0.55, y + 0.2); ctx.lineTo(x + 0.88, y + 0.35);
    ctx.moveTo(x + 0.42, y + 0.45); ctx.lineTo(x + 0.36, y + 0.82);
    if (bad) { ctx.moveTo(x + 0.55, y + 0.55); ctx.lineTo(x + 0.85, y + 0.78); ctx.moveTo(x + 0.42, y + 0.45); ctx.lineTo(x + 0.55, y + 0.55); ctx.lineTo(x + 0.62, y + 0.9); }
    ctx.stroke();
  } else if (t.t === 'pit') {
    ctx.fillStyle = '#05040a'; ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
    ctx.fillStyle = 'rgba(60,40,70,0.55)'; ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.14);
    ctx.strokeStyle = '#6a5a52'; ctx.lineWidth = 0.05; ctx.strokeRect(x + 0.05, y + 0.05, 0.9, 0.9);
  }
}

// Unit states and screen-wide effects, drawn after the units inside the world transform.
export function overlay(r, ctx, s, T) {
  for (const u of s.units) {
    if (!u.alive) continue;
    const d = r.disp && r.disp.get(u.id); if (!d) continue;
    const cx = d.x + 0.5, base = d.y + 0.86;
    if (u.role && ROLES[u.role] && !u.boss) { ctx.strokeStyle = ROLES[u.role].color; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.ellipse(cx, base, 0.36, 0.13, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (u.role === 'regent') { ctx.strokeStyle = 'rgba(90,255,200,0.7)'; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.ellipse(cx, base, 0.6, 0.2, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (u.shield > 0) {
      const f = Math.max(0.2, u.shield / (u.shieldMax || u.shield));
      ctx.strokeStyle = `rgba(150,200,255,${0.35 + 0.5 * f})`; ctx.lineWidth = 0.05 + 0.04 * f;
      ctx.beginPath(); ctx.arc(cx, d.y + 0.35, 0.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    }
    if (s.bounty && s.bounty.id === u.id) {
      const y = d.y - 0.45 + Math.sin(T * 3) * 0.05;
      ctx.save(); ctx.translate(cx, y); ctx.rotate(T * 1.2);
      ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(0, 0, 0.16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; ctx.moveTo(Math.cos(a) * 0.1, Math.sin(a) * 0.1); ctx.lineTo(Math.cos(a) * 0.27, Math.sin(a) * 0.27); } ctx.stroke();
      ctx.restore();
    }
    if (u.braced) { ctx.strokeStyle = 'rgba(200,220,255,0.6)'; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.ellipse(cx, base, 0.42, 0.16, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (s.eclipse) { // darkness everywhere except a sight radius of about 4 tiles around my piece
    const me = r.viewer && r.viewer();
    const d = me && me.alive && r.disp.get(me.id);
    if (d) {
      const g = ctx.createRadialGradient(d.x + 0.5, d.y + 0.5, 3.6, d.x + 0.5, d.y + 0.5, 4.8);
      g.addColorStop(0, 'rgba(6,3,14,0)'); g.addColorStop(1, 'rgba(6,3,14,0.9)');
      ctx.fillStyle = g;
    } else ctx.fillStyle = 'rgba(6,3,14,0.45)';
    ctx.fillRect(-4, -4, 24, 24);
  }
}

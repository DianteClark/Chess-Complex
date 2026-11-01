// Store catalog, daily featured shop, bundles and item previews.
import { SKINS, BOARDS, FINISHERS, TRAILS, EMOTE_PACKS, BUNDLES, RARITIES, RARITY } from './data.js';
import { drawPiece } from './pieces.js';
import { FX, hiSprite } from './fx.js';

export const KINDS = {
  skin:     { label: 'Piece Set', table: SKINS,       owned: 'owned',          equip: 'skin' },
  board:    { label: 'Board',     table: BOARDS,      owned: 'ownedBoards',    equip: 'board' },
  finisher: { label: 'Finisher',  table: FINISHERS,   owned: 'ownedFinishers', equip: 'finisher' },
  trail:    { label: 'Trail',     table: TRAILS,      owned: 'ownedTrails',    equip: 'trail' },
  emote:    { label: 'Emote Pack', table: EMOTE_PACKS, owned: 'ownedEmotes',    equip: null },
};

export function ensureStore(p) {
  if (!Array.isArray(p.ownedTrails)) p.ownedTrails = ['none'];
  if (!p.trail) p.trail = 'none';
  if (!Array.isArray(p.ownedEmotes)) p.ownedEmotes = ['basic'];
  return p;
}
export const rarityOf = (kind, id) => (kind === 'trail' ? TRAILS[id].rarity : kind === 'emote' ? EMOTE_PACKS[id].rarity : (RARITIES[kind] || {})[id] || 'common');
export const rarityColor = (kind, id) => RARITY[rarityOf(kind, id)].color;
export const isOwned = (p, kind, id) => p[KINDS[kind].owned].includes(id);
export const isEquipped = (p, kind, id) => (KINDS[kind].equip ? p[KINDS[kind].equip] === id : isOwned(p, kind, id));

export function item(p, kind, id) {
  const t = KINDS[kind].table[id];
  return { kind, id, name: t.name, price: t.price, rarity: rarityOf(kind, id), owned: isOwned(p, kind, id), equipped: isEquipped(p, kind, id), season: t.price == null };
}
export function listKind(p, kind) {
  const order = { common: 0, rare: 1, epic: 2, legendary: 3, season: 4 };
  return Object.keys(KINDS[kind].table).filter((id) => !(kind === 'trail' && id === 'none') || true).map((id) => item(p, kind, id)).sort((a, b) => order[a.rarity] - order[b.rarity] || (a.price || 0) - (b.price || 0));
}

function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// Four rotating offers per day; the first is the Deal of the Day at 30% off.
export function featured(p, date) {
  const pool = [];
  for (const kind of Object.keys(KINDS)) for (const id of Object.keys(KINDS[kind].table)) { const t = KINDS[kind].table[id]; if (t.price) pool.push([kind, id]); }
  let h = hash('feat-' + date); const out = [];
  const avail = pool.filter(([k, id]) => !isOwned(p, k, id));
  const src = avail.length >= 4 ? avail : pool;
  const used = new Set();
  while (out.length < Math.min(4, src.length)) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; const i = h % src.length; if (used.has(i)) continue; used.add(i); out.push(src[i]); }
  return out.map(([k, id], i) => { const it = item(p, k, id); it.off = i === 0 ? 0.3 : 0; it.deal = i === 0; it.final = Math.round(it.price * (1 - it.off)); return it; });
}
export function bundleInfo(p, key) {
  const B = BUNDLES[key];
  const items = B.items.map(([k, id]) => item(p, k, id));
  const missing = items.filter((i) => !i.owned);
  const full = missing.reduce((a, i) => a + (i.price || 0), 0);
  return { key, name: B.name, items, missing, full, price: Math.round(full * (1 - B.off)), off: B.off, owned: missing.length === 0 };
}
export function grant(p, kind, id) { const k = KINDS[kind].owned; if (!p[k].includes(id)) p[k].push(id); }
export function equip(p, kind, id) { const e = KINDS[kind].equip; if (e) p[e] = id; }
export function activeEmotes(p) { const out = {}; for (const id of p.ownedEmotes) Object.assign(out, EMOTE_PACKS[id] ? EMOTE_PACKS[id].emotes : {}); return out; }

// ---------- previews ----------
export function makePreview(cv, kind, id, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect(); cv.width = Math.max(10, (r.width || 150) * dpr); cv.height = Math.max(10, (r.height || 110) * dpr);
  return { cv, ctx: cv.getContext('2d'), dpr, kind, id, t: Math.random() * 2, cycle: 0, fx: new FX(), skin: opts.skin || 'ivory', big: !!opts.big, rays: !!opts.rays, color: rarityColor(kind, id) };
}
export function drawPreview(p, dt) {
  const { ctx, cv, dpr } = p; const W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  p.t += dt;
  ctx.clearRect(0, 0, W, H);
  if (p.rays) {
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(p.t * 0.4);
    for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); const g = ctx.createLinearGradient(0, 0, 0, -W * 0.7); g.addColorStop(0, p.color + '66'); g.addColorStop(1, p.color + '00'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(30, -W * 0.7); ctx.lineTo(-30, -W * 0.7); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    const g = ctx.createRadialGradient(W / 2, H / 2, 4, W / 2, H / 2, W * 0.45); g.addColorStop(0, p.color + '55'); g.addColorStop(1, p.color + '00'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else { ctx.fillStyle = '#0d0b13'; ctx.fillRect(0, 0, W, H); }
  const k = p.kind;
  if (k === 'skin') {
    const ts = H / 1.7; ctx.save(); ctx.translate(W / 2, H * 0.86 + Math.sin(p.t * 2) * 2); ctx.scale(ts, ts);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(0, 0, 0.32, 0.08, 0, 0, Math.PI * 2); ctx.fill();
    drawPiece(ctx, p.big ? 'queen' : 'knight', p.id, { t: p.t }); ctx.restore();
  } else if (k === 'board') {
    const th = BOARDS[p.id]; const ts = Math.min(W / 6, H / 4.2);
    ctx.save(); ctx.translate((W - ts * 6) / 2, (H - ts * 4) / 2); ctx.scale(ts, ts);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) { ctx.fillStyle = (x + y) % 2 ? th.dark : th.light; ctx.fillRect(x, y, 1, 1); }
    ctx.strokeStyle = th.grid; ctx.lineWidth = 0.03; for (let i = 0; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 4); ctx.stroke(); }
    if (th.lava) { ctx.strokeStyle = `rgba(255,110,30,${0.5 + 0.3 * Math.sin(p.t * 2)})`; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(0.2, 2.6); ctx.lineTo(1.4, 2.3); ctx.lineTo(2, 2.8); ctx.stroke(); }
    if (th.glowGrid) { const sw = (p.t * 2) % 5; ctx.strokeStyle = 'rgba(0,240,255,0.6)'; ctx.beginPath(); ctx.moveTo(0, sw); ctx.lineTo(6, sw); ctx.stroke(); }
    const g = ctx.createLinearGradient(4, 0.6, 5, 1.6); g.addColorStop(0, th.wallTop[0]); g.addColorStop(1, th.wallTop[1]);
    ctx.fillStyle = th.wallFront; ctx.fillRect(4, 1.58, 1, 0.42); ctx.fillStyle = g; ctx.fillRect(4, 0.58, 1, 1);
    // weather hint
    ctx.fillStyle = th.mote; for (let i = 0; i < 8; i++) { const wx = (i * 0.77 + Math.sin(p.t + i) * 0.2) % 6, wy = th.weather === 'snow' || th.weather === 'petals' ? ((p.t * 0.4 + i * 0.5) % 4) : 4 - ((p.t * 0.4 + i * 0.5) % 4); ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(wx, wy, 0.04, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.translate(2.5, 2.86 + Math.sin(p.t * 2) * 0.02); ctx.scale(0.92, 0.92); drawPiece(ctx, 'knight', p.skin, { t: p.t });
    ctx.restore();
  } else if (k === 'finisher') {
    const ts = H / 2.2;
    ctx.save(); ctx.scale(ts, ts);
    const cx = W / ts / 2, by = 1.75;
    p.cycle += dt;
    if (p.cycle > 2.8) { p.cycle = 0; p.shown = false; }
    if (!p.shown && p.cycle > 0.5) { p.shown = true; p.fx.finisher(p.id, cx, by, 'rook', 'obsidian', '#7f6bff'); }
    p.fx.update(dt);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.beginPath(); ctx.ellipse(cx, by, 0.6, 0.15, 0, 0, Math.PI * 2); ctx.fill();
    p.fx.drawGround(ctx);
    if (!p.shown) { ctx.save(); ctx.translate(cx, by); ctx.scale(0.92, 0.92); drawPiece(ctx, 'rook', 'obsidian', { t: p.t, flash: Math.max(0, (p.cycle - 0.35) * 6) }); ctx.restore(); }
    p.fx.drawAbove(ctx);
    ctx.restore();
    if (p.fx.screenFlash > 0.01) { ctx.globalAlpha = p.fx.screenFlash * 0.6; ctx.fillStyle = p.fx.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  } else if (k === 'trail') {
    const ts = H / 2.2; ctx.save(); ctx.scale(ts, ts);
    const span = W / ts, x = 0.6 + ((Math.sin(p.t * 1.4) + 1) / 2) * (span - 1.2), by = 1.75;
    const cols = TRAILS[p.id].colors;
    if (cols.length) for (let i = 0; i < 2; i++) p.fx.parts.push({ x: x + (Math.random() - 0.5) * 0.3, y: by - 0.2 - Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.4, vy: -0.3, g: p.id === 'royal' ? 2 : -0.2, life: 0.7, t: 0, color: cols[(Math.random() * cols.length) | 0], size: 0.035, kind: p.id === 'royal' ? 'coin' : p.id === 'petals' ? 'chunk' : 'spark', rot: Math.random() * 6, vr: 6, floor: p.id === 'royal' ? by : null });
    p.fx.update(dt);
    p.fx.drawAbove(ctx);
    ctx.translate(x, by); ctx.scale(0.92, 0.92); drawPiece(ctx, 'knight', p.skin, { t: p.t });
    ctx.restore();
  } else if (k === 'emote') {
    const em = Object.values(EMOTE_PACKS[p.id].emotes);
    const i = Math.floor(p.t / 1.2) % em.length, kk = (p.t % 1.2) / 1.2;
    ctx.font = `700 ${Math.round(H * 0.13)}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(em[i]).width + 24, h = H * 0.26, sc = kk < 0.1 ? kk / 0.1 : 1;
    ctx.save(); ctx.translate(W / 2, H * 0.36); ctx.scale(sc, sc); ctx.globalAlpha = kk > 0.85 ? (1 - kk) / 0.15 : 1;
    ctx.fillStyle = '#f6f1ff'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.4) : ctx.rect(-w / 2, -h / 2, w, h); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, h / 2 - 1); ctx.lineTo(0, h / 2 + 8); ctx.lineTo(6, h / 2 - 1); ctx.fill();
    ctx.fillStyle = '#1a1626'; ctx.fillText(em[i], 0, 1); ctx.restore(); ctx.globalAlpha = 1;
    const ts = H / 2.6; ctx.save(); ctx.translate(W / 2, H * 0.95); ctx.scale(ts, ts); drawPiece(ctx, 'pawn', p.skin, { t: p.t }); ctx.restore();
  }
}
export { hiSprite };

// Chess Complex 18.0 "Rivals" (NE): Ranks UI. Crown Rating tier badges (lobby cards, in-match name tags, results,
// leaderboards, profile) and the cloud-save inbox that carries the weekly Season rewards (title + banner).
// Tiers and bands live in js/rivals.js (shared with the server). No emojis: the badge is an inline SVG shield with the
// tier's chess piece.
import { tierOf, cleanRk, TIERS, PROVISIONAL, rewardFor } from './rivals.js';
import { applyReward as applyWReward } from './warden.js'; // 18.1 (L3)

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// piece glyphs in a 24 x 24 box
const GLYPH = {
  pawn: 'M12 4.4a3.3 3.3 0 1 1 0 6.6a3.3 3.3 0 1 1 0-6.6zM9.4 11.6h5.2l1.4 5.6H8zM7 18h10v2.6H7z',
  knight: 'M7.6 18.2h10.2v2.4H7.6zM9 17.4c-.2-2.6 2.4-4.4 2.6-6.3l-3.4 1.6-1.6-1.7 4.2-5.4.9-2.2 1.6 1.9c3 1 4.6 4.3 4.3 12.1z',
  bishop: 'M12 3.2l1.3 1.5c2.3 2 3.4 4.3 3.4 6.2 0 2-1.3 3.5-2.7 4.2H10c-1.4-.7-2.7-2.2-2.7-4.2 0-1.9 1.1-4.2 3.4-6.2zM7.4 16.8h9.2v1.7H7.4zM6.4 19.2h11.2v1.9H6.4z',
  rook: 'M6.4 3.8h2.5v2.1h1.9V3.8h2.4v2.1h1.9V3.8h2.5v4.7l-2 1.6v6.3h2l1 2.3H5.4l1-2.3h2v-6.3l-2-1.6zM5 19.4h14v1.7H5z',
  queen: 'M3.8 7.4l3.3 8.8h9.8l3.3-8.8-4.5 3.6L12 4.2l-3.7 6.8zM6.4 17.2h11.2v2H6.4zM5.4 19.8h13.2v1.5H5.4z',
  king: 'M11 2.4h2v2.1h2.1v2H13v2.1c3 .6 5.1 2.7 5.1 5.4 0 1.4-.6 2.6-1.4 3.5H7.3c-.8-.9-1.4-2.1-1.4-3.5 0-2.7 2.1-4.8 5.1-5.4V6.5H8.9v-2H11zM6.4 17.9h11.2v1.6H6.4zM5.4 20h13.2v1.5H5.4z',
};
export function badgeSVG(t, px = 18) {
  const id = 'rkg' + t.id + (t.prov ? 'p' : '');
  const fill = t.prov ? '#2a2f3d' : `url(#${id})`;
  return `<svg class="rk18-svg" viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.color}"/><stop offset="1" stop-color="${t.c2}"/></linearGradient></defs>`
    + `<path d="M12 .8l9.6 4.4v7.2c0 5.4-4 9.4-9.6 10.9C6.4 21.8 2.4 17.8 2.4 12.4V5.2z" fill="${fill}" stroke="${t.prov ? t.color : 'rgba(10,8,16,.85)'}" stroke-width="${t.prov ? 1.3 : 1}"${t.prov ? ' stroke-dasharray="2.2 1.6"' : ''}/>`
    + `<g transform="translate(4.2 3.6) scale(.65)"><path d="${GLYPH[t.id]}" fill="${t.prov ? t.color : '#fffaf0'}" stroke="rgba(10,8,16,.55)" stroke-width=".8" paint-order="stroke"/></g></svg>`;
}
const label = (t) => (t.prov ? `${t.name} (provisional)` : `${t.name} - ${t.r}`);
// <span> badge for a {r, p?} wire rank, or '' when unknown
export function badge(rk, px = 16) {
  const k = cleanRk(rk); if (!k) return '';
  const t = tierOf(k.r, !!k.p);
  return `<span class="rk18 rk18-${t.id}${t.prov ? ' prov' : ''}" title="${esc(label(t))}" aria-label="Rank ${esc(label(t))}">${badgeSVG(t, px)}</span>`;
}
// badge + tier name (profile, leaderboard hero, results)
export function chip(rk, o = {}) {
  const k = cleanRk(rk); if (!k) return '';
  const t = tierOf(k.r, !!k.p);
  return `<span class="rk18-chip rk18-${t.id}${t.prov ? ' prov' : ''}" style="--rk:${t.color}">${badgeSVG(t, o.px || 18)}<b>${t.name}</b>${o.r ? `<em>${t.prov ? 'Provisional' : t.r}</em>` : ''}</span>`;
}
// a rating card from /lb/me ({r, games, prov}) -> wire rank
export const fromCard = (c) => (c && c.r != null ? { r: Math.round(c.r), ...(c.prov || c.games < PROVISIONAL ? { p: 1 } : {}) } : null);
export function ladderHTML(rk) {
  const k = cleanRk(rk), cur = k ? tierOf(k.r, !!k.p) : null;
  return `<div class="rk18-ladder">${TIERS.map((T) => { const t = tierOf(T.min + 1, false); return `<div class="rk18-step${cur && cur.id === T.id ? ' on' : ''}" style="--rk:${T.color}">${badgeSVG(t, 26)}<b>${T.name}</b><small>${T.min ? T.min + '+' : 'start'}</small></div>`; }).join('')}</div>`;
}

// ---------- canvas: a tier gem beside in-match name tags (render.js drawTags -> NEM tag hook) ----------
const IMG = new Map();
export function drawGem(ctx, x, y, px, rk) {
  const k = cleanRk(rk); if (!k) return false;
  const t = tierOf(k.r, !!k.p), key = t.id + (t.prov ? 'p' : '');
  let im = IMG.get(key);
  if (!im) { im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(badgeSVG(t, 48).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')); IMG.set(key, im); }
  if (!im.complete || !im.naturalWidth) return false;
  ctx.drawImage(im, Math.round(x - px / 2), Math.round(y - px / 2), px, px);
  return true;
}

// ---------- my own rank (cached from the leaderboard's /lb/me rating card) ----------
const MY_KEY = 'cc_rk18';
let mine = null; try { mine = cleanRk(JSON.parse(localStorage.getItem(MY_KEY) || 'null')); } catch {}
export const myRk = () => mine;
export function setMine(card) { const k = fromCard(card); if (!k) return; mine = k; try { localStorage.setItem(MY_KEY, JSON.stringify(k)); } catch {} }

// ---------- inbox: weekly Season rewards from the Player DO (cloudsave.js hooks inbox / acks) ----------
let H = null;
export function init(hooks) { H = hooks; }
const P = () => (H && H.profile ? H.profile() : null);
// cloudsave.js calls this from inside a sync (before it may adopt the server copy), so apply on the next tick
export function inbox(items) {
  if (!Array.isArray(items) || !items.length) return;
  setTimeout(() => {
    const p = P(); if (!p) return;
    p.inboxDone = Array.isArray(p.inboxDone) ? p.inboxDone : [];
    let got = [];
    for (const it of items) {
      if (!it || typeof it.id !== 'string' || p.inboxDone.includes(it.id)) continue;
      if (it.k === 'season') {
        const rw = rewardFor(+it.rank); if (!rw) { p.inboxDone.push(it.id); continue; }
        p.titles = Array.isArray(p.titles) ? p.titles : [];
        if (!p.titles.includes(rw.title)) p.titles.push(rw.title);
        p.ownedBanners = Array.isArray(p.ownedBanners) ? p.ownedBanners : [];
        if (!p.ownedBanners.includes(rw.banner)) p.ownedBanners.push(rw.banner);
        p.seasonRewards = [...(Array.isArray(p.seasonRewards) ? p.seasonRewards : []).filter((x) => x && x.sid !== it.sid), { sid: String(it.sid || '').slice(0, 12), rank: +it.rank | 0, reward: rw.id, title: rw.title, banner: rw.banner }].slice(-12);
        got.push({ rank: +it.rank | 0, rw, sid: it.sid });
      }
      if (it.k === 'wseason') { const w = applyWReward(p, it); if (w) got.push({ ...w, coop: true }); } // 18.1 (L3): weekly co-op season rewards
      p.inboxDone.push(it.id);
    }
    p.inboxDone = p.inboxDone.slice(-20);
    if (H.save) H.save();
    for (const g of got) { try { H.toast && H.toast(`${g.coop ? 'Co-op season' : 'Season'} reward: you finished #${g.rank} last week. New title "${g.rw.title}" and the ${g.rw.title} banner are yours.`); H.sfx && H.sfx('levelup'); } catch {} }
  }, 60);
}
export function acks() { const p = P(); return p && Array.isArray(p.inboxDone) ? p.inboxDone.slice(-20) : []; }

// Chess Complex 15.0 front end (F): title rank plate + avatar chip, profile editor, grouped Play screen with location
// info, loadout build slots + ability unlocks + Ascension / pawn line previews, the match-intro location wheel, and the
// party lobby / Back to Party hooks. main.js wires these in with small Edits; everything reads data defensively so a
// teammate's field that has not landed yet just hides its section.
import * as DATA from './data.js';
import * as STORE from './store.js';
import * as PROG from './progression.js';
import { pieceIcon } from './pieces.js';

const { PIECES, PASSIVES, ABILITIES, PRESETS, SKINS, MODES, STAT_POINTS, titleFor, xpForLevel } = DATA;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const own = (T, k) => !!T && typeof k === 'string' && Object.prototype.hasOwnProperty.call(T, k);
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const reduced = () => !!(D.settings && D.settings.motion) || document.body.classList.contains('reduced');
let D = {}; // deps from main.js
export function init(deps) { D = deps; bindEditor(); preload(); }
const P = () => D.profile();
const play = (n) => { try { D.sfx && D.sfx[n] && D.sfx[n](); } catch {} };

// optional teammate modules (dynamic so a missing file never breaks the menus)
let LOC = null, WHEEL = null;
function preload() {
  import('./locations.js').then((m) => { LOC = m; if (D.onLocations) D.onLocations(); }).catch(() => {});
  import('./wheel.js').then((m) => { WHEEL = m; }).catch(() => {});
}
export const locations = () => (LOC && LOC.LOCATIONS) || null;

// ---------- profile data ----------
// Banners are S's data (data.js BANNERS, store.js bannerList/bannerCss/bannerOwned); this file only draws the picker.
const BANNERS = () => DATA.BANNERS || { gold: { name: 'Gold', colors: ['#d6b05c', '#4a3410'], price: 0 } };
export const bannerOf = (p) => { const B = BANNERS(); const b = B[p && p.banner] || B.gold || Object.values(B)[0]; const c = (b && b.colors) || ['#d6b05c', '#4a3410']; return { c1: b.accent && b.pattern ? b.accent : c[0], c2: c[1], css: STORE.bannerCss ? STORE.bannerCss(p && p.banner) : `linear-gradient(115deg, ${c[0]}, ${c[1]})` }; };
export const AVATAR_PIECES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const BASE_PIECES = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
const PAWN_LINE = ['veteran', 'champion'];
// pieces that carry a build (equips), in showroom order: Pawn, its promotions, then the main ladder
export const buildPieces = () => ['pawn', ...PAWN_LINE.filter((k) => own(PIECES, k)), ...BASE_PIECES.slice(1)];
const SLOT_N = 3;
function normPts(src) { const pts = { hp: 0, atk: 0, def: 0, spd: 0 }; let left = STAT_POINTS; for (const k of Object.keys(pts)) { const v = Math.max(0, Math.min(left, Math.floor(+((src || {})[k]) || 0))); pts[k] = v; left -= v; } return pts; }
function normEquips(src, fallback) {
  const out = {};
  for (const pc of buildPieces()) { const list = (PIECES[pc] && PIECES[pc].equips) || []; if (!list.length) continue; const v = src && src[pc]; out[pc] = list.includes(v) ? v : (fallback && list.includes(fallback[pc]) ? fallback[pc] : list[0]); }
  return out;
}
function normSlot(s, i, def) {
  if (!s || typeof s !== 'object') return null;
  return { name: clean(s.name, 16) || `Custom ${i + 1}`, pts: normPts(s.pts), passive: own(PASSIVES, s.passive) ? s.passive : def.passive, equips: normEquips(s.equips, def.equips) };
}
// Called at the end of main.js normalizeProfile: every 15.0 front-end field gets a safe default.
export function normalizeFront(p, raw) {
  if (!p || typeof p !== 'object') return p;
  // pawn-line pieces (veteran / champion) keep their own equip choice; main.js rebuilds build.equips for the base ladder only
  const rawEq = raw && raw.build && raw.build.equips && typeof raw.build.equips === 'object' ? raw.build.equips : {};
  if (p.build && p.build.equips) for (const pc of PAWN_LINE) { const list = (PIECES[pc] && PIECES[pc].equips) || []; if (list.length) p.build.equips[pc] = list.includes(rawEq[pc]) ? rawEq[pc] : list.includes(p.build.equips[pc]) ? p.build.equips[pc] : list[0]; }
  // avatar + banner are validated by S's ensureStore (store.js); only guard the shape here
  if (!p.avatar || typeof p.avatar !== 'object') p.avatar = { piece: 'knight', skin: null };
  if (!own(PIECES, p.avatar.piece)) p.avatar.piece = 'knight';
  const def = p.build || {};
  const sl = Array.isArray(p.slots) ? p.slots : [];
  p.slots = Array.from({ length: SLOT_N }, (_, i) => normSlot(sl[i], i, def));
  p.slot = Number.isInteger(p.slot) && p.slot >= 0 && p.slot < SLOT_N && p.slots[p.slot] ? p.slot : -1;
  if (!Array.isArray(p.unlocked)) p.unlocked = [];
  return p;
}

// ---------- unlocks (DESIGN_15 §2: PASSIVES/ABILITIES entries may carry unlock: <marks>) ----------
const table = (kind) => (kind === 'passive' ? PASSIVES : ABILITIES);
// S owns the economy: progression.js isUnlocked/unlockPrice/buyUnlock and storeui.js unlockAbility (its own confirm sheet).
export const priceOf = (kind, id) => { if (typeof PROG.unlockPrice === 'function') { try { return +PROG.unlockPrice(kind, id) || 0; } catch {} } const e = table(kind)[id]; return e && +e.unlock > 0 ? +e.unlock : 0; };
export const isLocked = (p, kind, id) => { if (typeof PROG.isUnlocked === 'function') { try { return !PROG.isUnlocked(p, kind, id); } catch {} } return priceOf(kind, id) > 0 && !(Array.isArray(p.unlocked) && p.unlocked.includes(`${kind}:${id}`)); };
let armed = null, armT = 0;
const done = (kind, id) => { play('unlock'); D.haptic && D.haptic([20, 30, 40]); D.save(); D.renderProfile && D.renderProfile(); D.renderLoadout && D.renderLoadout(); };
// With S's sheet: one tap opens it. Fallback: two taps (the first arms the button, the second buys).
export function tryUnlock(btn) {
  const [kind, id] = (btn.dataset.unlock || '').split(':'); const p = P(); const price = priceOf(kind, id);
  if (!isLocked(p, kind, id)) return false;
  if (D.SUI && typeof D.SUI.unlockAbility === 'function') {
    play('tap');
    Promise.resolve(D.SUI.unlockAbility(kind, id)).then((ok) => { if (ok) done(kind, id); }).catch((e) => console.warn(e));
    return false;
  }
  if (p.marks < price) { play('error'); D.toast && D.toast(`You need ${price - p.marks} more Marks`); btn.classList.remove('nudge'); void btn.offsetWidth; btn.classList.add('nudge'); return false; }
  if (armed !== btn.dataset.unlock || Date.now() - armT > 3500) { armed = btn.dataset.unlock; armT = Date.now(); btn.classList.add('armed'); btn.querySelector('span') && (btn.querySelector('span').textContent = 'Confirm'); play('tap'); return false; }
  armed = null;
  let ok = false;
  if (typeof PROG.buyUnlock === 'function') { try { ok = !!(PROG.buyUnlock(p, kind, id) || {}).ok; } catch (e) { console.warn(e); } }
  else if (p.marks >= price) { p.marks -= price; (p.unlocked ||= []).push(`${kind}:${id}`); ok = true; }
  if (ok) { D.toast && D.toast(`Unlocked ${table(kind)[id].name}`); done(kind, id); }
  return false;
}
const lockHTML = (kind, id) => { const pr = priceOf(kind, id); const can = (P().marks || 0) >= pr; return `<span class="lk-tag" aria-hidden="true"><svg><use href="#m-lock"/></svg>Locked</span><button type="button" class="lk-buy ${can ? '' : 'poor'}" data-unlock="${kind}:${id}" aria-label="Unlock ${esc(table(kind)[id].name)} for ${pr} Marks"><span>Unlock</span><i class="mark-ico"></i><b>${pr}</b></button>`; };

// ---------- title: rank plate under the logo + avatar chip ----------
let lastRank = null;
export function renderTitle() {
  const p = P(); if (!p) return;
  const need = xpForLevel(p.level), pct = Math.min(100, (p.xp / need) * 100);
  const n = $('#t-xpn'); if (n) n.textContent = `${p.xp} / ${need} XP`;
  const bar = $('#t-xp'), plate = $('#t-rank');
  if (bar && lastRank && (p.level > lastRank.level || p.xp > lastRank.xp) && !reduced()) {
    // came back with more XP: replay the gain on the plate (and a level-up burst)
    const from = p.level > lastRank.level ? 0 : Math.min(100, (lastRank.xp / need) * 100);
    bar.style.transition = 'none'; bar.style.width = from + '%'; void bar.offsetWidth;
    setTimeout(() => { bar.style.transition = ''; bar.style.width = pct + '%'; }, 700);
    if (plate) { plate.classList.remove('gain', 'lvlup'); void plate.offsetWidth; plate.classList.add(p.level > lastRank.level ? 'lvlup' : 'gain'); }
  } else if (bar) bar.style.width = pct + '%';
  lastRank = { level: p.level, xp: p.xp };
  const b = bannerOf(p), chip = $('#s-title .profile-chip');
  paint(chip, b);
  const av = $('#t-av'); if (av) { const src = avatarSrc(p, 88); if (av.dataset.src !== src) { av.dataset.src = src; av.innerHTML = `<img src="${src}" alt="">`; } }
  const nm = $('#t-name'); if (nm) nm.textContent = p.name;
  const sub = $('#t-sub'); if (sub) sub.textContent = 'Profile';
}
const paint = (el, b) => { if (!el) return; el.style.setProperty('--b1', b.c1); el.style.setProperty('--b2', b.c2); el.style.setProperty('--bg', b.css); };
export const avatarSrc = (p, size = 64) => pieceIcon(p.avatar && p.avatar.piece || 'king', (p.avatar && p.avatar.skin) || p.skin || 'ivory', null, size);

// ---------- profile editor (#m-pedit) ----------
// Lives in index.html (so main.js's #in-name listener keeps working). Opened from the Profile screen.
export function decorateProfile() {
  const body = $('#profile-body'); if (!body) return;
  const p = P(), b = bannerOf(p), hero = $('.pf-hero', body);
  if (hero) { paint(hero, b); hero.classList.add('f15'); }
  let card = $('.pe-open', body);
  if (!card) {
    card = document.createElement('button'); card.className = 'pe-open'; card.dataset.act = 'edit-profile'; card.type = 'button';
    if (hero) hero.after(card); else body.prepend(card);
  }
  card.innerHTML = `<span class="pe-ic"><svg><use href="#m-edit"/></svg></span><span class="pe-t"><b>Edit Profile</b><em>Name, avatar, banner and title</em></span><svg class="pe-chev"><use href="#m-chev"/></svg>`;
  paint(card, b);
}
let peTab = 'piece';
export function openEditor() {
  const m = $('#m-pedit'); if (!m) return;
  renderEditor(); m.classList.remove('hidden'); play('open');
  const box = $('.modal-box', m); if (box) box.scrollTop = 0;
}
function closeEditor() {
  const m = $('#m-pedit'); if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden'); play('close'); D.save();
  D.renderProfile && D.renderProfile();
  if (D.screen && D.screen() === 'profile' && D.SUI && D.SUI.renderProfileScreen) { D.SUI.renderProfileScreen(); decorateProfile(); }
}
function renderEditor() {
  const p = P(), b = bannerOf(p);
  const card = $('#pe-card'); paint(card, b);
  $('#pe-card-av').src = avatarSrc(p, 160);
  $('#pe-card-name').textContent = p.name; $('#pe-card-title').textContent = p.title || titleFor(p.level);
  $('#pe-card-lvl').textContent = p.level;
  const inp = $('#in-name'); if (inp && document.activeElement !== inp) inp.value = p.name;
  const titles = ['', ...(Array.isArray(p.titles) ? p.titles : [])];
  if (p.title && !titles.includes(p.title)) titles.push(p.title);
  $('#pe-titles').innerHTML = titles.map((t) => `<button type="button" class="pe-chip ${p.title === t ? 'on' : ''}" data-pe-title="${esc(t)}" aria-pressed="${p.title === t}">${t ? esc(t) : `Rank: ${esc(titleFor(p.level))}`}</button>`).join('')
    + (titles.length < 2 ? '<p class="hint">Earn more titles from trophies, collections, mastery and the Crown Path.</p>' : '');
  const skin = p.avatar.skin || p.skin;
  $('#pe-pieces').innerHTML = AVATAR_PIECES.concat(PAWN_LINE.filter((k) => own(PIECES, k))).map((pc) => `<button type="button" class="pe-pc ${p.avatar.piece === pc ? 'on' : ''}" data-pe-piece="${pc}" aria-pressed="${p.avatar.piece === pc}" aria-label="${esc(PIECES[pc] ? PIECES[pc].name : pc)}"><img src="${pieceIcon(pc, skin, null, 64)}" alt=""><span>${esc(PIECES[pc] ? PIECES[pc].name : pc)}</span></button>`).join('');
  const skins = (Array.isArray(p.owned) ? p.owned : []).filter((k) => own(SKINS, k));
  $('#pe-skins').innerHTML = `<button type="button" class="pe-sk ${!p.avatar.skin ? 'on' : ''}" data-pe-skin="" aria-pressed="${!p.avatar.skin}"><img src="${pieceIcon(p.avatar.piece, p.skin, null, 56)}" alt=""><span>Equipped</span></button>`
    + skins.map((k) => `<button type="button" class="pe-sk ${p.avatar.skin === k ? 'on' : ''}" data-pe-skin="${k}" aria-pressed="${p.avatar.skin === k}"><img src="${pieceIcon(p.avatar.piece, k, null, 56)}" alt="" loading="lazy"><span>${esc(SKINS[k].name)}</span></button>`).join('');
  const bl = typeof STORE.bannerList === 'function' ? STORE.bannerList(p) : Object.entries(BANNERS()).map(([id, x]) => ({ id, name: x.name, colors: x.colors, owned: x.price === 0, how: 'Earned' }));
  $('#pe-banners').innerHTML = bl.map((x) => { const bg = STORE.bannerCss ? STORE.bannerCss(x.id) : `linear-gradient(115deg, ${x.colors[0]}, ${x.colors[1]})`; const on = p.banner === x.id;
    return `<button type="button" class="pe-bn ${on ? 'on' : ''} ${x.owned ? '' : 'locked'} ${x.royal ? 'royal' : ''}" data-pe-banner="${x.id}" ${x.owned ? '' : 'data-locked="1"'} style="--b1:${(x.accent && x.pattern) ? x.accent : x.colors[0]};--bg:${bg}" aria-pressed="${on}" aria-label="${esc(x.name)}${x.owned ? '' : ', locked: ' + esc(x.how)}"><i></i><span>${esc(x.name)}</span>${x.owned ? '' : `<small>${esc(x.how)}</small>`}</button>`; }).join('');
  $$('#m-pedit .pe-tab').forEach((t) => { const on = t.dataset.peTab === peTab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  $$('#m-pedit .pe-pane').forEach((x) => x.classList.toggle('hidden', x.dataset.pane !== peTab));
}
function bounce(el) { if (!el || reduced()) return; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
function bindEditor() {
  const m = $('#m-pedit'); if (!m || m.dataset.bound) return; m.dataset.bound = '1';
  m.addEventListener('click', (e) => {
    const p = P();
    if (e.target === m || e.target.closest('[data-pe-close]')) { closeEditor(); return; }
    const tab = e.target.closest('[data-pe-tab]'); if (tab) { peTab = tab.dataset.peTab; play('tab'); renderEditor(); return; }
    const t = e.target.closest('[data-pe-title]'); if (t) { p.title = t.dataset.peTitle; play('select'); D.save(); renderEditor(); bounce($('#pe-card-title')); return; }
    const pc = e.target.closest('[data-pe-piece]'); if (pc) { p.avatar.piece = pc.dataset.pePiece; play('select'); D.save(); renderEditor(); bounce($('#pe-card-av')); return; }
    const sk = e.target.closest('[data-pe-skin]'); if (sk) { p.avatar.skin = sk.dataset.peSkin || null; play('equip'); D.save(); renderEditor(); bounce($('#pe-card-av')); return; }
    const bn = e.target.closest('[data-pe-banner]'); if (bn && bn.dataset.locked) { play('error'); D.toast && D.toast(`${bn.querySelector('span').textContent}: ${bn.querySelector('small') ? bn.querySelector('small').textContent : 'locked'}`); return; }
    if (bn) { p.banner = bn.dataset.peBanner; play('select'); D.save(); renderEditor(); bounce($('#pe-card')); return; }
  });
  const inp = $('#in-name');
  if (inp) inp.addEventListener('input', () => { const p = P(); $('#pe-card-name').textContent = p.name; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) closeEditor(); });
}

// ---------- Play screen: groups ----------
export const GROUP_ART = {
  competitive: { icon: 'm-swords', c1: '#f0c25e', c2: '#5a3a0c', art: [['knight', 'ember'], ['king', 'gilded']], tag: 'Every piece for itself' },
  coop: { icon: 'm-shield', c1: '#74e4ff', c2: '#0d3550', art: [['rook', 'glacier'], ['bishop', 'jade']], tag: 'Team up vs the Hollows' },
  party: { icon: 'm-spark', c1: '#ff5ad2', c2: '#3a0b4a', art: [['queen', 'neon'], ['king', 'crimson']], tag: 'Wild rules, big laughs' },
  challenge: { icon: 'm-target', c1: '#ffd76a', c2: '#3b2d6b', art: [['queen', 'celestial'], ['pawn', 'ivory']], tag: 'One build, one score' },
  custom: { icon: 'm-sliders', c1: '#c9c2ff', c2: '#262046', art: [['bishop', 'obsidian'], ['rook', 'amethyst']], tag: 'Your lobby, your rules' },
};
const FALLBACK_GROUP = { royale: 'competitive', blitz: 'competitive', duel: 'competitive', squads: 'competitive', siege: 'coop', gauntlet: 'coop', hill: 'party', chaos: 'party', daily: 'challenge' };
export function groups() {
  if (Array.isArray(DATA.MODE_GROUPS) && DATA.MODE_GROUPS.length) return DATA.MODE_GROUPS.map((g) => ({ ...g, modes: (g.modes || []).filter((k) => own(MODES, k)) }));
  const by = {}; for (const k of Object.keys(MODES)) { const g = MODES[k].group || FALLBACK_GROUP[k]; if (!g) continue; (by[g] ||= []).push(k); }
  const names = { competitive: 'Competitive', coop: 'Co-op', party: 'Party', challenge: 'Challenge', custom: 'Custom' };
  return Object.keys(names).map((id) => ({ id, name: names[id], desc: GROUP_ART[id].tag, modes: by[id] || [], custom: id === 'custom' }));
}
export const customModes = () => (Array.isArray(DATA.CUSTOM_MODES) ? DATA.CUSTOM_MODES.filter((k) => own(MODES, k)) : Object.keys(MODES).filter((k) => k !== 'daily'));
export const groupOfMode = (id) => { for (const g of groups()) if (g.modes.includes(id)) return g.id; return 'competitive'; };
const artImg = (pc, sk, sz) => pieceIcon(pc, own(SKINS, sk) ? sk : 'ivory', null, sz);
// The carousel holds every group: an illustrated header card, then its mode cards, so all modes stay in #modes.
export function modesHTML(modeCard) {
  return groups().map((g) => {
    const a = GROUP_ART[g.id] || GROUP_ART.competitive;
    const head = `<div class="g-head" data-group="${g.id}" style="--m1:${a.c1};--m2:${a.c2}" role="presentation"><span class="gh-art"><img class="gh-a" src="${artImg(a.art[0][0], a.art[0][1], 96)}" alt=""><img class="gh-b" src="${artImg(a.art[1][0], a.art[1][1], 96)}" alt=""></span><span class="gh-glyph"><svg><use href="#${a.icon}"/></svg></span><b>${esc(g.name)}</b><p>${esc(g.desc || a.tag)}</p></div>`;
    const cards = g.custom
      ? `<button class="mode custom-card" data-custom="1" style="--m1:${a.c1};--m2:${a.c2}"><span class="m-art"><img class="mi" src="${artImg('bishop', 'obsidian', 120)}" alt=""></span><span class="m-glyph"><svg><use href="#m-sliders"/></svg></span><span class="chip new">NEW</span><b>Custom Lobby</b><p>Pick the mode, location and rules</p><span class="m-who">Online + bots</span></button>`
      : g.modes.map((k, i) => modeCard(k, MODES[k], i)).join('');
    return `<section class="m-group" data-group="${g.id}" aria-label="${esc(g.name)}">${head}${cards}</section>`;
  }).join('');
}
export function tabsHTML(cur) {
  return groups().map((g) => { const a = GROUP_ART[g.id] || GROUP_ART.competitive; const on = g.id === cur; return `<button class="g-tab ${on ? 'on' : ''}" data-gtab="${g.id}" role="tab" aria-selected="${on}" style="--m1:${a.c1}"><svg><use href="#${a.icon}"/></svg><span>${esc(g.name)}</span></button>`; }).join('');
}
// Tabs follow the carousel scroll; tapping a tab glides to its group.
export function bindPlay(modesEl, tabsEl) {
  if (!modesEl || !tabsEl || modesEl.dataset.f15) return; modesEl.dataset.f15 = '1';
  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-gtab]'); if (!t) return;
    const sec = $(`.m-group[data-group="${t.dataset.gtab}"]`, modesEl); if (!sec) return;
    play('tab'); markTab(tabsEl, t.dataset.gtab); modesEl.__lock = Date.now();
    modesEl.scrollTo({ left: sec.offsetLeft - parseFloat(getComputedStyle(modesEl).paddingLeft || 0), behavior: reduced() ? 'auto' : 'smooth' });
  });
  let raf = 0;
  modesEl.addEventListener('scroll', () => {
    if (raf || Date.now() - (modesEl.__lock || 0) < 600) return;
    raf = requestAnimationFrame(() => { raf = 0; const x = modesEl.scrollLeft + modesEl.clientWidth * 0.35; let cur = null; for (const s of $$('.m-group', modesEl)) if (s.offsetLeft <= x) cur = s.dataset.group; if (cur) markTab(tabsEl, cur); });
  }, { passive: true });
}
function markTab(tabsEl, id) {
  for (const t of $$('[data-gtab]', tabsEl)) { const on = t.dataset.gtab === id; if (t.classList.contains('on') !== on) { t.classList.toggle('on', on); t.setAttribute('aria-selected', on); if (on) t.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } }
}
// Location strip for the mode detail: Daily shows the location of the day; everything else rolls one of the eight.
export function locationHTML(modeId, dailySeedValue) {
  const L = locations(); if (!L) return '';
  const ids = Object.keys(L); if (!ids.length) return '';
  const dot = (id) => { const mo = L[id].mood || {}; return `<span class="loc-chip" role="listitem" style="--lc:${mo.accent || '#f0c25e'}" title="${esc(L[id].blurb || '')}"><i></i>${esc(L[id].name)}</span>`; };
  if (modeId === 'daily' && LOC && typeof LOC.locationOfDay === 'function' && dailySeedValue != null) {
    const id = LOC.locationOfDay(dailySeedValue); const l = L[id];
    if (l) return `<div class="md-loc today" style="--lc:${(l.mood || {}).accent || '#f0c25e'}"><svg><use href="#m-globe"/></svg><div><small>Location of the day</small><b>${esc(l.name)}</b><p>${esc(l.blurb || '')}</p></div></div>`;
  }
  const line = MODES[modeId] && MODES[modeId].siege ? 'The wheel picks where you make your stand' : `The wheel picks one of ${ids.length}, each with its own weather, hazards and events`;
  return `<div class="md-loc compact"><svg><use href="#m-globe"/></svg><div><small>World Tour</small><p>${line}</p></div><div class="loc-chips" role="list">${ids.map(dot).join('')}</div></div>`;
}

// ---------- loadout: build slots ----------
const buildOf = (p) => ({ pts: { ...p.build.pts }, passive: p.build.passive, equips: { ...p.build.equips } });
const applyBuild = (p, b) => { p.build.pts = { ...b.pts }; p.build.passive = b.passive; p.build.equips = { ...p.build.equips, ...b.equips }; };
export function presetsHTML(skin, PRESET_ART, STAT_KEYS, STAT_COL) {
  const p = P();
  const presets = Object.entries(PRESETS).map(([k, x]) => {
    const art = PRESET_ART[k] || ['pawn', skin]; const on = p.slot < 0 && p.build.preset === k;
    const lk = isLocked(p, 'passive', x.passive);
    return `<button class="preset ${on ? 'on' : ''} ${lk ? 'locked' : ''}" data-preset="${k}" aria-pressed="${on}"><img class="pa" src="${pieceIcon(art[0], own(SKINS, art[1]) ? art[1] : skin, null, 64)}" alt=""><b>${esc(x.name)}</b><span>${esc(x.blurb)}</span><div class="pmini">${STAT_KEYS.map((s) => `<i style="--c:${STAT_COL[s]};--v:${x.pts[s] / 5}"></i>`).join('')}</div>${on ? '<svg class="pcheck"><use href="#m-check"/></svg>' : ''}${lk ? '<svg class="plock"><use href="#m-lock"/></svg>' : ''}</button>`;
  }).join('');
  const unsaved = p.slot < 0 && !p.build.preset;
  const slots = p.slots.map((s, i) => {
    const on = p.slot === i;
    if (!s) return `<div class="bslot blank ${unsaved ? 'save' : ''}"><button type="button" class="sl-main" data-slot-new="${i}"><svg><use href="#m-plus"/></svg><b>${unsaved ? 'Save here' : 'New build'}</b><span>Slot ${i + 1}</span></button></div>`;
    const pas = PASSIVES[s.passive];
    return `<div class="bslot ${on ? 'on' : ''}"><button type="button" class="sl-main" data-slot-pick="${i}" aria-pressed="${on}"><b>${esc(s.name)}</b><span>${pas ? esc(pas.name) : ''}</span><div class="pmini">${STAT_KEYS.map((k) => `<i style="--c:${STAT_COL[k]};--v:${s.pts[k] / 5}"></i>`).join('')}</div></button><div class="sl-acts"><button type="button" class="sl-ic" data-slot-rename="${i}" aria-label="Rename ${esc(s.name)}"><svg><use href="#m-edit"/></svg></button>${unsaved ? `<button type="button" class="sl-ic sl-save" data-slot-save="${i}" aria-label="Save current build to ${esc(s.name)}"><svg><use href="#m-down"/></svg></button>` : ''}</div></div>`;
  }).join('');
  const sub = p.slot >= 0 ? `Editing <b>${esc(p.slots[p.slot].name)}</b>. Changes save automatically.` : unsaved ? 'Unsaved changes. Save them to a slot.' : 'Three builds of your own. Edit any stat or ability to fill one.';
  return `${presets}<div class="custom-slots ${p.slot >= 0 ? 'on' : ''}"><div class="bs-head"><svg><use href="#m-sliders"/></svg><b>Custom</b><span>${sub}</span></div><div class="bs-row">${slots}</div></div>`;
}
// Returns true when it handled the click (main.js then saves and re-renders).
export function onBuildClick(b) {
  const p = P();
  if (b.dataset.slotPick != null) { const i = +b.dataset.slotPick, s = p.slots[i]; if (!s) return false; if (p.slot === i) { play('tap'); return true; } applyBuild(p, s); p.slot = i; p.build.preset = null; play('equip'); D.haptic && D.haptic(12); return true; }
  if (b.dataset.slotNew != null) { const i = +b.dataset.slotNew; p.slots[i] = { name: `Custom ${i + 1}`, ...buildOf(p) }; p.slot = i; p.build.preset = null; play('equip'); D.toast && D.toast(`Saved to ${p.slots[i].name}`); return true; }
  if (b.dataset.slotSave != null) { const i = +b.dataset.slotSave; if (!p.slots[i]) return false; p.slots[i] = { ...p.slots[i], ...buildOf(p) }; p.slot = i; play('equip'); D.toast && D.toast(`Saved to ${p.slots[i].name}`); return true; }
  if (b.dataset.slotRename != null) { renameSlot(+b.dataset.slotRename, b); return 'nosave'; }
  if (b.dataset.preset) { p.slot = -1; return false; } // main.js applies the preset
  return false;
}
// After any stat / passive / equip edit: write it into the selected slot, or into the first empty slot.
export function afterEdit() {
  const p = P();
  if (p.slot >= 0 && p.slots[p.slot]) { p.slots[p.slot] = { ...p.slots[p.slot], ...buildOf(p) }; p.build.preset = null; return; }
  const free = p.slots.findIndex((s) => !s);
  if (free >= 0 && !p.build.preset) { p.slots[free] = { name: `Custom ${free + 1}`, ...buildOf(p) }; p.slot = free; D.toast && D.toast(`Saved as ${p.slots[free].name}`); }
}
function renameSlot(i, btn) {
  const p = P(), s = p.slots[i]; if (!s) return;
  const wrap = btn.closest('.bslot'); if (!wrap || wrap.querySelector('input')) return;
  play('tap');
  const main = wrap.querySelector('.sl-main'); const nameEl = main.querySelector('b');
  const inp = document.createElement('input'); inp.className = 'sl-name'; inp.maxLength = 16; inp.value = s.name; inp.setAttribute('aria-label', 'Build name'); inp.autocomplete = 'off'; inp.spellcheck = false;
  nameEl.replaceWith(inp); wrap.classList.add('renaming'); inp.focus(); inp.select();
  let done = false;
  const commit = () => { if (done) return; done = true; s.name = clean(inp.value, 16) || s.name; D.save(); play('select'); D.renderLoadout && D.renderLoadout(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { done = true; D.renderLoadout && D.renderLoadout(); } e.stopPropagation(); });
  inp.addEventListener('blur', commit);
  inp.addEventListener('click', (e) => e.stopPropagation());
}

// ---------- loadout: passives / equips with locks, Ascension and the pawn line ----------
export function passivesHTML() {
  const p = P();
  const ent = Object.entries(PASSIVES).sort(([a], [b]) => (priceOf('passive', a) > 0) - (priceOf('passive', b) > 0));
  return ent.map(([k, x]) => {
    const lk = isLocked(p, 'passive', k), on = p.build.passive === k;
    return `<div class="choice-wrap ${lk ? 'locked' : ''}"><button class="choice ${on ? 'on' : ''}" data-passive="${k}" aria-pressed="${on}" ${lk ? 'aria-disabled="true"' : ''}><i class="dot"></i><div><b>${esc(x.name)}${x.unlock && !lk ? '<em class="new-k">Unlocked</em>' : ''}</b><span>${esc(x.desc)}</span></div></button>${lk ? lockHTML('passive', k) : ''}</div>`;
  }).join('');
}
export function equipLocked(id) { return isLocked(P(), 'ability', id); }
export const passiveLocked = (id) => isLocked(P(), 'passive', id);
export { lockHTML };
// Ascension: honing to level 3 turns a piece Ascended. C may publish it as PIECES[pc].ascend / .ascended, or DATA.ASCENSION[pc].
export function ascInfo(pc) {
  const P0 = PIECES[pc] || {}; const a = (DATA.ASCEND && DATA.ASCEND[pc]) || null;
  if (!a || typeof a !== 'object') return null;
  // C's shape: { name, passive: 'Cavalry', desc: <passive text>, ult: <empowered ultimate text> }
  const baseUlt = P0.ult && ABILITIES[P0.ult];
  return { name: a.name || `Ascended ${P0.name || pc}`, desc: '', passive: typeof a.passive === 'string' ? a.passive : '', passiveDesc: a.desc || '', ult: typeof a.ult === 'string' && a.ult ? `${baseUlt ? baseUlt.name : 'Ultimate'}+` : '', ultDesc: typeof a.ult === 'string' ? a.ult : '' };
}
export function ascHTML(pc, skin) {
  const a = ascInfo(pc); if (!a) return '';
  return `<div class="asc-card"><div class="asc-art"><img src="${pieceIcon(pc, skin, null, 72, { ascended: true })}" alt=""><span class="asc-pips"><i></i><i></i><i></i></span></div><div class="asc-body"><span class="tag t-asc">Hone 3: Ascension</span><b>${esc(a.name)}</b>${a.desc ? `<p>${esc(a.desc)}</p>` : ''}${a.passive ? `<p><em>${esc(a.passive)}</em> ${esc(a.passiveDesc)}</p>` : ''}${a.ult ? `<p><em>${esc(a.ult)}</em> ${esc(a.ultDesc)}</p>` : ''}</div></div>`;
}
// Pawn line: Pawn -> Veteran -> Champion (pawn-only promotions). Shown as a ladder ribbon in the showroom.
export function pawnLineHTML(cur, skin) {
  const line = ['pawn', ...PAWN_LINE.filter((k) => own(PIECES, k))]; if (line.length < 2 || !line.includes(cur)) return '';
  const cost = (k) => { const c = PIECES[k] && (PIECES[k].cost ?? PIECES[k].promoteCost); return c ? `${c} shards` : ''; };
  return `<div class="pawn-line" aria-label="Pawn line">${line.map((k, i) => `${i ? '<svg class="pl-arrow"><use href="#m-chev"/></svg>' : ''}<button type="button" class="pl-step ${k === cur ? 'on' : ''}" data-lopiece="${k}" aria-label="${esc(PIECES[k].name)}"><img src="${pieceIcon(k, skin, null, 40)}" alt=""><b>${esc(PIECES[k].name)}</b>${i && cost(k) ? `<small>${cost(k)}</small>` : ''}</button>`).join('')}</div>`;
}

// ---------- match intro: the location wheel ----------
// After the contender reveal. Lands on s.location; a tap skips straight to the landing; reduced motion shows it settled.
export const wheelMs = () => (reduced() ? 1300 : 3100);
let wheelOn = null;
export function locationIntro(s, { director, sfx } = {}) {
  const id = s && s.location; if (!id) return 0;
  const L = locations() || {}; const loc = L[id] || { name: id };
  stopWheel();
  const host = document.createElement('div'); host.id = 'loc-wheel'; host.className = 'loc-wheel' + (reduced() ? ' calm' : '');
  host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', 'Location: ' + (loc.name || id));
  const mood = loc.mood || {}; host.style.setProperty('--lc', mood.accent || '#f0c25e'); if (mood.sky) { host.style.setProperty('--s1', mood.sky[0]); host.style.setProperty('--s2', mood.sky[1]); }
  host.innerHTML = '<div class="lw-kick">World Tour</div><div class="lw-stage"></div><div class="lw-skip">Tap to skip</div>';
  ($('#s-game') || document.body).appendChild(host);
  const dur = wheelMs();
  let landed = false, closeT = 0, ctl = null;
  const land = () => {
    if (landed) return; landed = true; host.classList.add('landed');
    try { dispatchEvent(new CustomEvent('cc:wheel-landed', { detail: { id } })); } catch {}
    clearTimeout(closeT); closeT = setTimeout(close, reduced() ? 500 : 900);
  };
  const close = () => { if (!host.isConnected) return; host.classList.add('out'); setTimeout(() => host.remove(), 320); if (wheelOn === ctrl) wheelOn = null; try { director && director.release && director.release(); } catch {} };
  const skip = () => { if (ctl && typeof ctl.skip === 'function') { try { ctl.skip(); } catch {} } if (!landed) { fallbackLand(host, id, L); land(); } else close(); };
  host.addEventListener('pointerdown', (e) => { e.stopPropagation(); skip(); });
  const ctrl = { host, skip, close }; wheelOn = ctrl;
  try { dispatchEvent(new CustomEvent('cc:wheel-start', { detail: { id } })); } catch {}
  try { director && director.hold && director.hold(dur + 1000); } catch {}
  const stage = $('.lw-stage', host);
  let used = false;
  if (WHEEL && typeof WHEEL.spinWheel === 'function') {
    try { ctl = WHEEL.spinWheel(stage, { target: id, reduced: reduced(), duration: dur, locations: L, onDone: land }) || null; used = true; host.classList.add('e2'); } catch (e) { console.warn('wheel', e); used = false; }
  }
  if (!used) fallbackWheel(stage, id, L, dur, land, sfx);
  setTimeout(land, dur + 1500); // never hang
  return dur + 900;
}
export function stopWheel() { if (wheelOn) { const w = wheelOn; wheelOn = null; w.host.remove(); } }
// Built-in wheel (used until / unless js/wheel.js provides spinWheel): a ring of the eight location names that spins,
// eases out and locks onto the target with a flash.
function fallbackWheel(stage, id, L, dur, land, sfx) {
  const ids = Object.keys(L).length ? Object.keys(L) : [id];
  const n = ids.length, step = 360 / n, ti = Math.max(0, ids.indexOf(id));
  stage.innerHTML = `<div class="lw-ring">${ids.map((k, i) => `<span class="lw-seg" style="--a:${i * step}deg;--lc:${(L[k] && L[k].mood && L[k].mood.accent) || '#f0c25e'}"><b>${esc((L[k] && L[k].name) || k)}</b></span>`).join('')}</div><div class="lw-pointer"></div><div class="lw-name"><small>Location</small><b>${esc((L[id] && L[id].name) || id)}</b><p>${esc((L[id] && L[id].blurb) || '')}</p></div>`;
  const ring = $('.lw-ring', stage);
  const end = -(ti * step) - 360 * (reduced() ? 0 : 4);
  if (reduced()) { ring.style.transform = `rotate(${end}deg)`; setTimeout(land, 500); return; }
  const t0 = performance.now(); let lastSeg = -1;
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const tick = (now) => {
    if (!stage.isConnected || stage.closest('.landed')) return;
    const k = Math.min(1, (now - t0) / (dur - 300)); const a = end * ease(k);
    ring.style.transform = `rotate(${a.toFixed(2)}deg)`;
    const seg = Math.floor((-a + step / 2) / step); if (seg !== lastSeg) { lastSeg = seg; try { const wt = sfx && sfx['wheel:tick']; if (typeof wt === 'function') wt(Math.max(0, Math.min(1, 4 * Math.pow(1 - k, 3)))); } catch {} } // AU: ratchet ticks
    if (k < 1) requestAnimationFrame(tick); else land();
  };
  requestAnimationFrame(tick);
}
function fallbackLand(host, id, L) {
  const ring = $('.lw-ring', host); if (!ring) return;
  const ids = Object.keys(L); const step = 360 / Math.max(1, ids.length); const ti = Math.max(0, ids.indexOf(id));
  ring.style.transform = `rotate(${-(ti * step) - 1440}deg)`;
}

// ---------- results: Back to Party ----------
export function partyResults() {
  const b = $('#btn-rematch'); if (!b) return;
  b.classList.toggle('to-party', /party/i.test(b.textContent || '')); // N's party.rematchButton sets the label
}

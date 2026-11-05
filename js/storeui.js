// 10.0 (A7): Store, item showcase, unlock reveal, collections, Crown Path, Trophies, Profile and daily login screens.
// main.js calls init(deps) once and the render* functions from go(); frame(dt) runs from the main loop.
import { SKINS, BOARDS, FINISHERS, TRAILS, EMOTE_PACKS, BUNDLES, RARITY, SEASON, SEASON_REWARDS, ROYAL_PASS, ROYAL_REWARDS, ACHIEVEMENTS, ACH_CATS, ACH_CAT, LOGIN_REWARDS, PIECES, PAST_SEASONS, xpForLevel, titleFor } from './data.js';
import { KINDS, item, listKind, featured, weeklyCollection, msToMidnight, bundleInfo, grant, equip, isOwned, toggleWish, toggleShowcase, rarityOf, rarityRank, allItems, makePreview, drawPreview, makeStage, resizeStage, drawStage, cyclePiece, stagePieceLabel, playFinisher, makeReveal, drawReveal, skipReveal, bannerCss, locName, STAGE_ROSTER, rosterIcon, setStagePiece } from './store.js';
import { seasonTier, seasonProgress, seasonDaysLeft, rewardLabel, resolveReward, rewardKind, checkAchievements, achievementValue, achievementGoal, masteryLevel, ownedCounts, claimCollections, loginStatus, claimLogin, settlePending, hasRoyal, royalStatus, buyRoyalPass, unlockList, buyUnlock, unlockPrice, isUnlocked } from './progression.js';

let D = null; // deps from main.js
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const P = () => D.profile();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const play = (n, ...a) => { try { const f = D.sfx[n]; if (typeof f === 'function') f(...a); } catch { /* audio optional */ } };
const RC = (r) => (RARITY[r] || RARITY.common).color;
const reduced = () => !!(D.settings && D.settings.motion);
const lowQ = () => !!(D.settings && (D.settings.quality === 'low' || D.settings.lowQ));
const PIECE_ORDER = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

const S = { tab: 'featured', filter: 'all', abFilter: 'all', previews: [], stage: null, reveal: null, queue: [], io: null, active: 'title', achCat: 'all', profStage: null, pathHero: null, loginShown: false };

export function init(deps) {
  D = deps;
  if ('IntersectionObserver' in window) S.io = new IntersectionObserver((es) => { for (const e of es) { const p = S.previews.find((q) => q.cv === e.target); if (p) p.visible = e.isIntersecting; } }, { rootMargin: '60px' });
  $('#s-armory').addEventListener('click', onStoreClick);
  $('#m-item').addEventListener('click', onItemClick);
  $('#m-reveal').addEventListener('click', onRevealClick);
  $('#s-path').addEventListener('click', onPathClick);
  $('#s-trophies').addEventListener('click', onTrophyClick);
  $('#s-profile').addEventListener('click', onProfileClick);
  $('#m-login').addEventListener('click', onLoginClick);
  addEventListener('resize', () => { if (S.stage) resizeStage(S.stage); if (S.profStage) resizeStage(S.profStage); });
  const g = settlePending(P()); if (g.length) D.save();
  setTimeout(() => maybeLogin(), 2500);
  setTimeout(() => revealSeasonItems(), 4000);
}

// ---------- lazy piece icons: building a new skin sprite is expensive, so only visible icons are drawn, a few per frame ----------
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const icon = (pc, id, px, cls = '') => `<img class="lz ${cls}" src="${BLANK}" data-ic="${pc}|${id}|${px}" alt="">`;
const LZ = { q: [], io: null, busy: false };
function lzPump() {
  if (LZ.busy) return; LZ.busy = true;
  const run = () => {
    const t0 = performance.now();
    while (LZ.q.length && performance.now() - t0 < 14) { const img = LZ.q.shift(); if (!img.isConnected || !img.dataset.ic) continue; const [pc, id, px] = img.dataset.ic.split('|'); img.src = D.pieceIcon(pc, id, null, +px); delete img.dataset.ic; img.classList.add('in'); }
    if (LZ.q.length) requestAnimationFrame(run); else LZ.busy = false;
  };
  requestAnimationFrame(run);
}
function hydrate(root) {
  const imgs = [...root.querySelectorAll('img[data-ic]')];
  if (!('IntersectionObserver' in window)) { LZ.q.push(...imgs); lzPump(); return; }
  if (!LZ.io) LZ.io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { LZ.io.unobserve(e.target); LZ.q.push(e.target); } lzPump(); }, { rootMargin: '120px' });
  for (const i of imgs) LZ.io.observe(i);
}

// ---------- shared bits ----------
const timeLeft = () => { const ms = msToMidnight(); return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`; };
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.4 3.2 5 6.6 5c2 0 3.5 1.1 5.4 3 1.9-1.9 3.4-3 5.4-3 3.4 0 5.6 3.4 4.1 6.8C19.5 16.4 12 21 12 21z"/></svg>';
const mark = (n) => `<i class="mark-ico"></i>${n}`;
function thumb(kind, id, px = 52) {
  if (kind === 'skin') return icon('queen', id, px);
  if (kind === 'board') { const b = BOARDS[id]; return `<span class="th-board" style="--l:${b.light};--d:${b.dark};--f:${b.frame}"></span>`; }
  if (kind === 'finisher') return `<span class="th-fin">${icon('rook', 'obsidian', px)}</span>`;
  if (kind === 'trail') { const c = TRAILS[id].colors; return `<span class="th-trail">${(c.length ? c : ['#555']).slice(0, 4).map((x, i) => `<i style="background:${x};--i:${i}"></i>`).join('')}</span>`; }
  if (kind === 'emote') return `<span class="th-emote">${esc(Object.values(EMOTE_PACKS[id].emotes)[0])}</span>`;
  if (kind === 'banner') return `<span class="th-banner" style="background:${bannerCss(id)}"></span>`;
  if (kind === 'title') return '<span class="th-title">T</span>';
  return '<span class="th-marks"><i class="mark-ico"></i></span>';
}
function regPreview(cv, opts = {}) {
  const pv = makePreview(cv, cv.dataset.kind, cv.dataset.id, { skin: P().skin, board: P().board, ...opts });
  S.previews.push(pv); if (S.io) { pv.visible = false; S.io.observe(cv); }
  return pv;
}
function clearPreviews() { if (S.io) for (const p of S.previews) S.io.unobserve(p.cv); S.previews = []; }
function card(it, opts = {}) {
  const col = RC(it.rarity);
  const visual = it.kind === 'skin'
    ? `<div class="sc-vis sc-skin">${icon('knight', it.id, 56)}${icon('queen', it.id, 84, 'mid')}${icon('rook', it.id, 56)}</div>`
    : `<canvas class="preview sc-vis" data-kind="${it.kind}" data-id="${it.id}"></canvas>`;
  const price = opts.final ?? it.price;
  const state = it.equipped && KINDS[it.kind].equip ? '<span class="sc-state on">Equipped</span>'
    : it.owned ? (KINDS[it.kind].equip ? `<button class="sc-state eq" data-equip="${it.kind}:${it.id}">Equip</button>` : '<span class="sc-state">Owned</span>')
    : it.royal ? `<span class="sc-state cp royal">Royal Pass${it.seasonNo ? ` S${it.seasonNo}` : ''}</span>`
    : it.season ? `<span class="sc-state cp">Crown Path${it.seasonNo ? ` S${it.seasonNo}` : ''}</span>`
    : `<span class="sc-price ${P().marks >= price ? 'ok' : 'no'}">${opts.off ? `<s>${it.price}</s>` : ''}${mark(price)}</span>`;
  return `<div class="sc rr-${it.rarity} ${it.royal ? 'royal' : ''} ${opts.hero ? 'hero' : ''} ${it.owned ? 'owned' : ''} ${it.equipped && KINDS[it.kind].equip ? 'equipped' : ''}" data-open="${it.kind}:${it.id}" style="--rc:${col}" role="button" tabindex="0" aria-label="${esc(it.name)}">
    <div class="sc-frame"></div>${opts.deal ? '<div class="sc-ribbon">-30%</div>' : ''}
    ${it.season ? '' : `<button class="sc-wish ${it.wished ? 'on' : ''}" data-wish="${it.kind}:${it.id}" aria-label="Wishlist">${HEART}</button>`}
    ${visual}<div class="sc-meta"><div class="sc-rar">${RARITY[it.rarity].name} ${KINDS[it.kind].label}</div><h4>${esc(it.name)}</h4>${state}</div></div>`;
}

// ---------- store ----------
export function renderStore() {
  const p = P(); D.renderProfile(); clearPreviews();
  $$('#armory-tabs .tab').forEach((t) => {
    t.classList.toggle('on', t.dataset.tab === S.tab);
    const kind = Object.keys(KINDS).find((k) => KINDS[k].tab === t.dataset.tab);
    const lbl = t.dataset.label || (t.dataset.label = t.textContent.trim());
    if (kind) { const all = listKind(p, kind); t.innerHTML = `${lbl}<em>${all.filter((i) => i.owned).length}/${all.length}</em>`; }
    else if (t.dataset.tab === 'wishlist') t.innerHTML = `${lbl}${p.wishlist.length ? `<em>${p.wishlist.length}</em>` : ''}`;
    else if (t.dataset.tab === 'abilities') { const u = unlockList(p).filter((x) => x.price); t.innerHTML = `${lbl}<em>${u.filter((x) => x.owned).length}/${u.length}</em>`; }
  });
  const el = $('#skins'), hint = $('#armory-hint');
  el.className = 'store-body tab-' + S.tab;
  if (S.tab === 'featured') {
    hint.innerHTML = `<span class="st-clock"></span>New offers in <b>${timeLeft()}</b>`;
    const feat = featured(p, D.today());
    if (p.storeSeen !== D.today()) { p.storeSeen = D.today(); D.save(); }
    const deal = feat[0], wk = bundleInfo(p, weeklyCollection(D.today()), 0.1);
    const wishAff = p.wishlist.map((k) => k.split(':')).filter(([k, id]) => KINDS[k] && KINDS[k].table[id]).map(([k, id]) => item(p, k, id)).filter((i) => !i.owned && i.price && i.price <= p.marks);
    el.innerHTML = `<div class="deal-hero rr-${deal.rarity}" style="--rc:${RC(deal.rarity)}" data-open="${deal.kind}:${deal.id}" data-final="${deal.final}">
        <canvas class="deal-stage" id="deal-stage"></canvas>
        <div class="dh-top"><span class="dh-tag">Deal of the Day</span><span class="dh-off">-30%</span></div>
        <div class="dh-info"><div class="dh-rar">${RARITY[deal.rarity].name} ${KINDS[deal.kind].label}</div><h3>${esc(deal.name)}</h3>
          <div class="dh-row">${deal.owned ? '<span class="sc-state on">Owned</span>' : `<span class="dh-price"><s>${deal.price}</s>${mark(deal.final)}</span><span class="dh-save">Save ${deal.price - deal.final}</span>`}<span class="dh-view">View</span></div></div></div>
      ${wishAff.length ? `<div class="wish-strip"><b>On your wishlist and affordable</b><div>${wishAff.slice(0, 4).map((i) => `<button class="ws-it" data-open="${i.kind}:${i.id}" style="--rc:${RC(i.rarity)}">${thumb(i.kind, i.id, 40)}<span>${esc(i.name)}</span></button>`).join('')}</div></div>` : ''}
      ${hasRoyal(p) ? '' : `<button class="rp-strip" data-royal="1"><i class="rp-crown"></i><div><b>Royal Pass</b><span>${esc(SEASON.short)}: ${Object.values(ROYAL_REWARDS).filter((r) => rewardKind(r)).length} exclusive items, 4 location finishers</span></div><em>${mark(ROYAL_PASS.price.toLocaleString())}</em></button>`}
      <div class="sec-h"><b>Featured</b><span>Rotates daily</span></div>
      <div class="sc-grid">${feat.slice(1).map((it) => card(it)).join('')}</div>
      <button class="week-col" data-tabgo="collections" data-col="${wk.key}" style="--cc:${wk.color}">
        <div class="wc-k">Collection of the Week <span>Extra 10% off</span></div><b>${esc(wk.name)}</b><p>${esc(wk.blurb)}</p>
        <div class="wc-items">${wk.items.slice(0, 6).map((i) => `<span class="${i.owned ? 'have' : ''}" style="--rc:${RC(i.rarity)}">${thumb(i.kind, i.id, 36)}</span>`).join('')}</div>
        <div class="wc-foot">${wk.have}/${wk.items.length} owned${wk.owned ? '' : ` - ${mark(wk.price)}`}</div></button>
      <p class="hint center econ">Marks come from every match, quests, level ups, trophies, the Crown Path and daily logins. Nothing here costs real money.</p>`;
    S.stage = makeStage($('#deal-stage'), lookWith(deal.kind, deal.id), { piece: deal.kind === 'skin' ? 'queen' : 'knight', emote: deal.kind === 'emote' ? deal.id : null, reduced: reduced(), lowQ: lowQ(), cols: 4, reserve: 0.32 });
    S.stageOwner = 'deal';
  } else if (S.tab === 'collections') {
    S.stage = null;
    const wkKey = weeklyCollection(D.today());
    const keys = Object.keys(BUNDLES).sort((a, b) => (a === wkKey ? -1 : b === wkKey ? 1 : 0) || (!!BUNDLES[b].tour - !!BUNDLES[a].tour));
    const done = keys.filter((k) => bundleInfo(p, k).done).length;
    hint.innerHTML = `Own every item in a collection to claim its reward. Buying the rest only charges for what you are missing. <b>${done}/${keys.length} complete</b>`;
    el.innerHTML = keys.map((k) => {
      const b = bundleInfo(p, k, k === wkKey ? 0.1 : 0); const pct = Math.round(b.have / b.items.length * 100);
      return `<div class="col-card ${b.done ? 'done' : ''}" style="--cc:${b.color}" id="col-${k}">
        <div class="cc-h"><div>${BUNDLES[k].tour ? '<span class="cc-tour">World Tour</span>' : ''}<b>${esc(b.name)}</b><p>${esc(b.blurb)}</p></div>${k === wkKey ? '<span class="cc-week">Week</span>' : ''}${b.owned ? '' : `<span class="cc-off">-${Math.round(b.off * 100)}%</span>`}</div>
        <div class="cc-items">${b.items.map((i) => `<button class="cc-it ${i.owned ? 'have' : ''} rr-${i.rarity}" data-open="${i.kind}:${i.id}" style="--rc:${RC(i.rarity)}">${thumb(i.kind, i.id, 44)}<span>${esc(i.name)}</span>${i.owned ? '<i class="tick"></i>' : ''}</button>`).join('')}</div>
        <div class="cc-prog"><div class="cc-bar"><i style="width:${pct}%"></i></div><span>${b.have}/${b.items.length}</span></div>
        <div class="cc-foot"><div class="cc-rw ${b.claimed ? 'got' : ''}"><span>Reward</span>${b.reward ? `${mark(b.reward.marks)} + title <b>${esc(b.reward.title)}</b>` : ''}${b.claimed ? ' - Claimed' : ''}</div>
        ${b.owned ? '<span class="sc-state on">Complete</span>' : b.buyable.length ? `<button class="btn small gold" data-bundle="${k}" data-price="${b.price}"><s>${b.full}</s> ${mark(b.price)}</button>` : '<span class="sc-state cp">Crown Path items left</span>'}</div></div>`;
    }).join('');
    if (S.scrollCol) { const n = $('#col-' + S.scrollCol); S.scrollCol = null; if (n) setTimeout(() => n.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }), 60); }
  } else if (S.tab === 'abilities') {
    S.stage = null; renderAbilities(el, hint);
  } else if (S.tab === 'wishlist') {
    S.stage = null;
    const list = p.wishlist.map((k) => k.split(':')).filter(([k, id]) => KINDS[k] && KINDS[k].table[id]).map(([k, id]) => item(p, k, id));
    const need = list.filter((i) => !i.owned && i.price).reduce((a, i) => a + i.price, 0);
    hint.innerHTML = list.length ? `Wishlist total: ${mark(need)} - you have ${mark(p.marks)}` : '';
    el.innerHTML = list.length ? `<div class="sc-grid">${list.map((i) => card(i)).join('')}</div>` : '<div class="empty"><b>Your wishlist is empty</b><p>Tap the heart on anything in the store to save it here. Items you can afford show up on the Featured page.</p></div>';
  } else {
    S.stage = null;
    const kind = Object.keys(KINDS).find((k) => KINDS[k].tab === S.tab);
    hint.innerHTML = { skin: 'Piece sets change how your pieces look to everyone.', board: 'Boards change the arena you see, weather included.', finisher: 'Finishers play when you eliminate someone. Everyone sees them.', trail: 'Trails follow your piece whenever it moves.', emote: 'Emote packs add phrases to your emote wheel.' }[kind]
      + `<div class="filters">${['all', 'new', 'owned'].map((f) => `<button class="chip ${S.filter === f ? 'on' : ''}" data-filter="${f}">${{ all: 'All', new: 'Not owned', owned: 'Owned' }[f]}</button>`).join('')}</div>`;
    const list = listKind(p, kind).filter((i) => S.filter === 'all' || (S.filter === 'owned' ? i.owned : !i.owned));
    el.innerHTML = `<div class="sc-grid">${list.map((i) => card(i)).join('')}</div>` + (list.length ? '' : '<div class="empty"><b>Nothing here</b><p>Try another filter.</p></div>');
  }
  $$('#skins canvas.preview').forEach((cv) => regPreview(cv));
  hydrate($('#s-armory'));
}
function lookWith(kind, id) {
  const p = P(); const look = { skin: p.skin, board: p.board, trail: p.trail, finisher: p.finisher };
  if (kind === 'skin' || kind === 'board' || kind === 'trail' || kind === 'finisher') look[kind] = id;
  if (look.trail === 'none' && kind !== 'trail') look.trail = 'sparks';
  return look;
}
function onStoreClick(e) {
  const tab = e.target.closest('.tab'); if (tab) { S.tab = tab.dataset.tab; S.filter = 'all'; play('tap'); renderStore(); $('#s-armory .scroll').scrollTop = 0; return; }
  const f = e.target.closest('[data-filter]'); if (f) { S.filter = f.dataset.filter; play('tap'); renderStore(); return; }
  const af = e.target.closest('[data-abfilter]'); if (af) { S.abFilter = af.dataset.abfilter; play('tap'); renderStore(); return; }
  const ul = e.target.closest('[data-unlock]'); if (ul) { e.stopPropagation(); const [k, id] = ul.dataset.unlock.split(':'); unlockAbility(k, id).then((ok) => { if (ok && S.active === 'armory') renderStore(); }); return; }
  const rp = e.target.closest('[data-royal]'); if (rp) { play('select'); openRoyal(); return; }
  const w = e.target.closest('[data-wish]'); if (w) { e.stopPropagation(); const [k, id] = w.dataset.wish.split(':'); const on = toggleWish(P(), k, id); D.save(); play(on ? 'select' : 'back'); w.classList.toggle('on', on); if (on) { w.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }); D.toast('Added to wishlist'); checkTrophies(); } if (S.tab === 'wishlist') renderStore(); return; }
  const eq = e.target.closest('[data-equip]'); if (eq) { e.stopPropagation(); const [k, id] = eq.dataset.equip.split(':'); equip(P(), k, id); D.save(); play('select'); D.toast(`${KINDS[k].table[id].name} equipped`); renderStore(); return; }
  const tg = e.target.closest('[data-tabgo]'); if (tg) { S.tab = tg.dataset.tabgo; S.scrollCol = tg.dataset.col; play('tap'); renderStore(); return; }
  const bb = e.target.closest('[data-bundle]'); if (bb) { buyBundle(bb); return; }
  const o = e.target.closest('[data-open]'); if (o) { const [k, id] = o.dataset.open.split(':'); openItem(k, id, o.dataset.final ? +o.dataset.final : null); }
}
function confirmStep(b, price) {
  const p = P();
  if (p.marks < price) { play('error'); D.toast(`You need ${price - p.marks} more Marks`); b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], 200); return false; }
  if (!b.classList.contains('confirm-buy')) { $$('.confirm-buy').forEach((x) => { x.classList.remove('confirm-buy'); x.innerHTML = x.dataset.lbl; }); b.dataset.lbl = b.innerHTML; b.innerHTML = `Confirm - ${p.marks - price} left`; b.classList.add('confirm-buy'); play('select'); return false; }
  return true;
}
function buyBundle(b) {
  const p = P(); const k = b.dataset.bundle; const wk = weeklyCollection(D.today()) === k ? 0.1 : 0;
  const info = bundleInfo(p, k, wk); const price = info.price;
  if (!confirmStep(b, price)) return;
  p.marks -= price; for (const i of info.buyable) grant(p, i.kind, i.id);
  const q = info.buyable.slice().sort((a, c) => rarityRank(c.rarity) - rarityRank(a.rarity)).map((i) => [i.kind, i.id]);
  D.save(); renderStore(); D.toast(`${info.name}: ${q.length} items unlocked`);
  startReveals(q);
}

// ---------- item detail / try on ----------
function openItem(kind, id, final = null) {
  if (!KINDS[kind] || !KINDS[kind].table[id]) return;
  const p = P(); const it = item(p, kind, id); const col = RC(it.rarity);
  S.cur = { kind, id, final, compare: false };
  const m = $('#m-item'); m.style.setProperty('--rc', col); m.className = `modal global rr-${it.rarity}`;
  const cols = Object.entries(BUNDLES).filter(([, b]) => b.items.some(([k, i]) => k === kind && i === id)).map(([k]) => bundleInfo(p, k));
  const price = final ?? it.price;
  $('#mi-body').innerHTML = `<div class="mi-stage-wrap"><canvas id="mi-stage"></canvas><div class="mi-badge">${RARITY[it.rarity].name}</div>
      <div class="mi-tools"><button class="chip" data-mi="piece">Piece</button><button class="chip" data-mi="fin">${kind === 'finisher' ? 'Play finisher' : 'Finisher'}</button>${it.owned ? '' : '<button class="chip" data-mi="compare">Compare</button>'}</div></div>
    <div class="mi-info"><div class="mi-kind" style="color:${col}">${RARITY[it.rarity].name} ${KINDS[kind].label}${it.seasonNo ? ` - Season ${it.seasonNo}` : ''}${it.loc ? ` - ${esc(locName(it.loc))}` : ''}</div><h3>${esc(it.name)}</h3><p class="mi-desc">${esc(it.desc)}</p>
    ${cols.length ? `<div class="mi-cols">${cols.map((c) => `<button class="chip col" data-col="${c.key}" style="--cc:${c.color}">${esc(c.name)} ${c.have}/${c.items.length}</button>`).join('')}</div>` : ''}
    ${kind === 'banner' ? `<div class="mi-banner" style="background:${bannerCss(id)}"><b>${esc(p.name)}</b><span>${esc(p.title || titleFor(p.level))}</span></div>` : ''}
    ${kind === 'skin' ? `<div class="mi-roster" aria-label="Every piece in this set">${STAGE_ROSTER.map((k) => `<button data-stp="${k}" aria-label="${esc(stagePieceLabel(k))}" class="${k === 'queen' ? 'on' : ''}">${icon(rosterIcon(k), id, 34)}</button>`).join('')}</div>` : ''}
    <p class="mi-try" id="mi-try">Trying it on with your loadout</p></div>
    <div class="mi-acts">${it.owned
      ? (KINDS[kind].equip ? (it.equipped ? '<button class="btn wide" disabled>Equipped</button>' : `<button class="btn wide gold" data-mi="equip">Equip</button>`) : '<button class="btn wide" disabled>Owned</button>')
      : it.royal && it.seasonNo === SEASON.id && !hasRoyal(p) ? `<button class="btn wide gold big royal-cta" data-mi="royal">Get the Royal Pass</button>`
      : it.royal ? `<button class="btn wide" disabled>Royal Pass reward${it.seasonNo ? ` (Season ${it.seasonNo})` : ''}</button>`
      : it.season ? `<button class="btn wide" disabled>Crown Path reward${it.seasonNo ? ` (Season ${it.seasonNo})` : ''}</button>`
      : `<button class="btn wide gold big" data-mi="buy" data-price="${price}">${final != null && final !== it.price ? `<s>${it.price}</s> ` : ''}${mark(price)}</button>`}
      <div class="mi-row"><button class="btn ghost ${it.wished ? 'on' : ''}" data-mi="wish">${it.wished ? 'Wishlisted' : 'Wishlist'}</button>${it.owned ? `<button class="btn ghost ${p.showcase.includes(kind + ':' + id) ? 'on' : ''}" data-mi="show">${p.showcase.includes(kind + ':' + id) ? 'In showcase' : 'Showcase'}</button>` : ''}<button class="btn ghost" data-mi="close">Close</button></div></div>`;
  m.classList.remove('hidden'); hydrate(m);
  S.stage = makeStage($('#mi-stage'), lookWith(kind, id), { piece: kind === 'skin' ? 'queen' : 'knight', emote: kind === 'emote' ? id : null, reduced: reduced(), lowQ: lowQ(), reserve: 0.13 });
  S.stageOwner = 'item';
  if (kind === 'finisher') setTimeout(() => { if (!S.stage || S.stageOwner !== 'item') return; playFinisher(S.stage); if (typeof D.sfx.finisherPreview === 'function') play('finisherPreview', id); }, 500);
  play('select');
}
function closeItem() { $('#m-item').classList.add('hidden'); S.cur = null; if (S.active === 'armory') renderStore(); else S.stage = null; }
function onItemClick(e) {
  if (e.target.id === 'm-item') { closeItem(); return; }
  const sp = e.target.closest('[data-stp]'); if (sp && S.stage) { setStagePiece(S.stage, sp.dataset.stp); $$('#m-item [data-stp]').forEach((x) => x.classList.toggle('on', x === sp)); const c = $('#m-item [data-mi=piece]'); if (c) c.textContent = stagePieceLabel(sp.dataset.stp); play('tap'); return; }
  const b = e.target.closest('[data-mi],[data-col]'); if (!b || !S.cur) return;
  if (b.dataset.col) { closeItem(); S.tab = 'collections'; S.scrollCol = b.dataset.col; if (S.active !== 'armory') D.go('armory'); else renderStore(); return; }
  const { kind, id } = S.cur; const p = P();
  switch (b.dataset.mi) {
    case 'piece': play('tap'); b.textContent = stagePieceLabel(cyclePiece(S.stage)); break;
    case 'royal': play('select'); closeItem(); openRoyal(); break;
    case 'fin': { const f = S.stage.look.finisher; if (typeof D.sfx.finisherPreview === 'function') play('finisherPreview', f); else play('tap'); playFinisher(S.stage); break; }
    case 'compare': S.cur.compare = !S.cur.compare; S.stage.look = S.cur.compare ? lookWith(null, null) : lookWith(kind, id); S.stage.emote = !S.cur.compare && kind === 'emote' ? id : null; $('#mi-try').textContent = S.cur.compare ? 'Showing your current loadout' : 'Trying it on with your loadout'; b.classList.toggle('on', S.cur.compare); play('tap'); break;
    case 'wish': { const on = toggleWish(p, kind, id); D.save(); b.textContent = on ? 'Wishlisted' : 'Wishlist'; b.classList.toggle('on', on); play(on ? 'select' : 'back'); if (on) checkTrophies(); break; }
    case 'show': { const on = toggleShowcase(p, kind, id); D.save(); b.textContent = on ? 'In showcase' : 'Showcase'; b.classList.toggle('on', on); play('select'); break; }
    case 'equip': equip(p, kind, id); D.save(); play(typeof D.sfx.equip === 'function' ? 'equip' : 'select'); D.toast(`${KINDS[kind].table[id].name} equipped`); closeItem(); break;
    case 'buy': {
      const price = +b.dataset.price; if (!confirmStep(b, price)) return;
      p.marks -= price; grant(p, kind, id);
      const pos = p.wishlist.indexOf(`${kind}:${id}`); if (pos >= 0) p.wishlist.splice(pos, 1);
      D.save(); $('#m-item').classList.add('hidden'); S.cur = null; if (S.active === 'armory') renderStore();
      startReveals([[kind, id]]);
      break;
    }
    case 'close': play('back'); closeItem(); break;
  }
}

// ---------- reveal sequence ----------
function startReveals(list) { S.queue = list.slice(1); if (list.length) showReveal(list[0][0], list[0][1]); }
function showReveal(kind, id) {
  const it = item(P(), kind, id), col = RC(it.rarity);
  const m = $('#m-reveal'); m.style.setProperty('--rc', col); m.className = `modal global rr-${it.rarity}`; m.classList.remove('burst');
  $('#rv-rar').textContent = `${RARITY[it.rarity].name} ${KINDS[kind].label}`; $('#rv-rar').style.color = col;
  $('#rv-name').textContent = it.name;
  $('#rv-new').textContent = it.rarity === 'mythic' ? 'MYTHIC UNLOCK' : it.rarity === 'legendary' ? 'LEGENDARY UNLOCK' : 'NEW ITEM';
  $('#rv-equip').dataset.equip = KINDS[kind].equip ? `${kind}:${id}` : '';
  $('#rv-equip').textContent = KINDS[kind].equip ? 'Equip now' : 'Awesome';
  $('#rv-close').textContent = S.queue.length ? `Next (${S.queue.length} more)` : 'Later';
  m.classList.remove('hidden');
  S.reveal = makeReveal($('#rv-canvas'), kind, id, { skin: P().skin, reduced: reduced(), onBurst: (r) => onBurst(r) });
  if (typeof D.sfx.chest === 'function') play('chest'); else if (rarityRank(it.rarity) >= 2) play('ultcharge'); else play('whoosh');
  D.haptic([10, 40, 10]);
}
function onBurst(r) {
  $('#m-reveal').classList.add('burst');
  if (typeof D.sfx.reveal === 'function') { play('chest:open'); play('reveal', r); }
  else { play('buy'); if (rarityRank(r) >= 2) setTimeout(() => play('levelup'), 200); if (rarityRank(r) >= 3) setTimeout(() => play('crown'), 420); }
  D.uiFlash(); D.haptic(rarityRank(r) >= 3 ? [30, 30, 60, 30, 90] : [20, 30, 40]);
  const done = claimCollections(P());
  if (done.length) { D.save(); setTimeout(() => { D.toast(`Collection complete: ${done[0].name}. +${done[0].reward.marks} Marks, title ${done[0].reward.title}`); play(typeof D.sfx.claim === 'function' ? 'claim' : 'crown'); }, 900); }
  checkTrophies();
}
function nextReveal() {
  $('#m-reveal').classList.add('hidden'); S.reveal = null;
  if (S.queue.length) { const [k, id] = S.queue.shift(); setTimeout(() => showReveal(k, id), 160); }
  else if (S.active === 'armory') renderStore();
}
function onRevealClick(e) {
  if (S.reveal && !S.reveal.rv.burst) { skipReveal(S.reveal); return; }
  if (e.target.closest('#rv-equip')) { const v = $('#rv-equip').dataset.equip; if (v) { const [k, id] = v.split(':'); equip(P(), k, id); D.save(); play('select'); } nextReveal(); return; }
  if (e.target.closest('#rv-close')) { play('back'); nextReveal(); }
}
// Lets other screens (Crown Path, results) use the same reveal for granted rewards.
export function revealItems(list) { const l = list.filter(([k, id]) => KINDS[k] && KINDS[k].table[id]); if (l.length) startReveals(l); }

function checkTrophies() { const a = checkAchievements(P()); if (a.length) { D.save(); setTimeout(() => D.toast(`Trophy unlocked: ${a[0].name}  +${a[0].reward}`), 1200); } }

// ---------- Crown Path ----------
export function renderPath() {
  const p = P(); D.renderProfile();
  const tier = seasonTier(p), max = SEASON.tiers, royal = hasRoyal(p);
  const cap = royal ? ROYAL_REWARDS[max] : SEASON_REWARDS[max], capR = resolveReward(cap), capK = rewardKind(capR), capL = rewardLabel(cap);
  const next = Math.min(max, tier + 1), nextL = rewardLabel(SEASON_REWARDS[next]);
  const days = seasonDaysLeft(), rs = royalStatus(p);
  const cell = (t, r0, prem) => {
    if (!r0) return '<div class="pl-cell empty"></div>';
    const soon = r0.finisher && !FINISHERS[r0.finisher]; // a location finisher still in development: show it, pay the fallback until it ships
    const r = soon ? r0 : resolveReward(r0), L = soon ? { name: 'Location Finisher', kind: 'Coming soon' } : rewardLabel(r0), k = rewardKind(r);
    const rar = k ? rarityOf(k, r[k]) : r.title ? (prem ? 'royal' : 'epic') : 'common';
    const got = prem ? royal && t <= p.season.prem : t <= tier;
    const locked = prem && !royal, earned = t <= tier;
    return `<div class="pl-cell ${prem ? 'prem' : 'free'} ${got ? 'got' : ''} ${locked ? 'locked' : ''} ${locked && earned ? 'claimable' : ''} ${k ? 'big' : ''} rr-${rar}" style="--rc:${RC(rar)}" ${k && !soon ? `data-open="${k}:${r[k]}"` : prem && locked ? 'data-royal="1"' : ''}>
      <div class="pt-th">${thumb(k || (r.title ? 'title' : 'marks'), k ? r[k] : '', 40)}</div><div class="pt-tx"><b>${esc(L.name)}</b><span>${L.kind}</span></div>${got ? '<i class="pt-ok"></i>' : locked ? '<i class="pl-lock"></i>' : ''}</div>`;
  };
  const free = Object.values(SEASON_REWARDS).filter((r) => rewardKind(resolveReward(r))).length;
  const items = Object.values(ROYAL_REWARDS).filter((r) => rewardKind(r));
  $('#path-body').innerHTML = `<div class="ph-hero ${royal ? 'royal' : ''}">
      <canvas id="ph-canvas" ${capK ? `data-kind="${capK}" data-id="${capR[capK]}"` : ''}></canvas>
      <div class="ph-season"><span>${esc(SEASON.name.split(':')[0])}</span><b>${esc(SEASON.short || SEASON.name)}</b><em>${days} day${days === 1 ? '' : 's'} left</em></div>
      <div class="ph-cap"><span>Tier ${max} ${royal ? 'Royal' : ''} reward</span><b>${esc(capL.name)}</b><em>${capL.kind}</em></div></div>
    ${royal ? `<div class="rp-owned"><i class="rp-crown"></i><div><b>Royal Pass active</b><span>${p.season.prem >= 0 ? `${p.season.prem + 1} of ${max + 1} Royal rewards claimed` : 'Royal rewards unlock as you climb'}</span></div></div>`
      : `<button class="rp-cta" data-royal="1"><i class="rp-crown"></i><div class="rp-tx"><span>Royal Pass</span><b>${items.length} exclusive items + ${rs.rebate.toLocaleString()} Marks back</b><em>${tier > 0 ? `Claim ${tier + 1} reward${tier ? 's' : ''} you've already earned` : 'Unlock the second lane for the whole season'}</em></div><div class="rp-price">${mark(ROYAL_PASS.price.toLocaleString())}</div></button>`}
    <div class="ph-prog"><div class="ph-tier"><span>Tier</span><b>${tier}</b></div><div class="ph-bar-wrap"><div class="ph-lbl">${tier >= max ? 'Path complete' : `Next: <b>${esc(nextL.name)}</b>`}</div><div class="ph-bar"><i style="width:${tier >= max ? 100 : seasonProgress(p) * 100}%"></i></div><div class="ph-xp">${tier >= max ? 'Every reward claimed' : `${p.season.xp % SEASON.tierXp} / ${SEASON.tierXp} XP`}</div></div></div>
    <p class="hint center">Season XP comes from every match. The free lane has ${free} items across ${max} tiers; a tier takes about four matches.</p>
    <div class="pl-head"><span></span><b>Free</b><b class="r">Royal Pass</b></div>
    <div class="ph-track lanes">
      <div class="pt pl-row zero ${royal ? 'got' : ''}"><div class="pt-n">0</div><div class="pl-cell free empty"><span class="pl-note">Buy the pass</span></div>${cell(0, ROYAL_REWARDS[0], true)}</div>
      ${Array.from({ length: max }, (_, i) => { const t = i + 1;
        return `${t % 10 === 1 && t > 1 ? `<div class="pt-mile"><span>Tier ${t - 1} milestone</span></div>` : ''}<div class="pt pl-row ${t <= tier ? 'got' : ''} ${t === tier + 1 ? 'next' : ''}" ${t === tier + 1 ? 'id="tier-next"' : ''}><div class="pt-n">${t}</div>${cell(t, SEASON_REWARDS[t], false)}${cell(t, ROYAL_REWARDS[t], true)}</div>`; }).join('')}</div>
    ${p.pastSeasons.length ? `<div class="panel past"><div class="lbl">Past seasons</div>${p.pastSeasons.map((s) => `<div class="ps"><b>${esc(PAST_SEASONS[s.id] || 'Season ' + s.id)}</b><span>Reached tier ${s.tier}${s.pass ? ' - Royal Pass' : ''}</span></div>`).join('')}<p class="hint">Rewards from past seasons stay in your collection forever.</p></div>` : ''}`;
  hydrate($('#path-body'));
  const cv = $('#ph-canvas');
  S.pathHero = capK ? makePreview(cv, capK, capR[capK], { skin: p.skin, big: true, rays: true }) : null;
  p.season.seen = tier; D.save(); D.renderProfile();
  if (S.openRoyal) { S.openRoyal = false; setTimeout(() => openRoyal(), 250); }
  else setTimeout(() => { const n = $('#tier-next'); if (n) n.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); }, 300);
}
function onPathClick(e) {
  if (e.target.closest('[data-royal]')) { play('select'); openRoyal(); return; }
  const o = e.target.closest('[data-open]'); if (o) { const [k, id] = o.dataset.open.split(':'); openItem(k, id); }
}

// ---------- 15.0: Royal Pass purchase sheet ----------
// A modal of our own (created on first use) so index.html stays untouched.
function sheet() {
  let m = $('#m-royal');
  if (!m) {
    m = document.createElement('div'); m.id = 'm-royal'; m.className = 'modal global hidden'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="modal-box rp-box"></div>'; document.body.appendChild(m);
    m.addEventListener('click', onRoyalClick);
  }
  return m;
}
export function openRoyal() {
  const p = P(); const m = sheet(); const box = m.querySelector('.rp-box');
  if (S.active !== 'path' && D.go) { S.openRoyal = true; D.go('path'); return; }
  const st = royalStatus(p), tier = st.tier;
  const now = Array.from({ length: tier + 1 }, (_, t) => ROYAL_REWARDS[t]).filter(Boolean);
  const nowItems = now.map((r) => resolveReward(r)).filter((r) => rewardKind(r));
  const nowMarks = now.reduce((a, r) => a + (resolveReward(r).marks || 0), 0);
  const all = Object.entries(ROYAL_REWARDS).map(([t, r]) => [+t, r]).filter(([, r]) => rewardKind(r)); // as designed, including finishers still in development
  const byKind = (k) => all.filter(([, r]) => rewardKind(r) === k).length;
  m.dataset.mode = st.owned ? 'owned' : 'buy';
  box.innerHTML = `<div class="rp-top"><i class="rp-crown big"></i><span>${esc(SEASON.name)}</span><h3>${esc(ROYAL_PASS.name)}</h3><p>${esc(ROYAL_PASS.blurb)}</p></div>
    <div class="rp-grid">${all.map(([t, r]) => { const k = rewardKind(r); const rar = rarityOf(k, r[k]); return `<button class="rp-it rr-${rar} ${t <= tier ? 'now' : ''}" data-open="${k}:${r[k]}" style="--rc:${RC(rar)}" aria-label="${esc(rewardLabel(r).name)}">${thumb(k, r[k], 40)}<em>${t}</em></button>`; }).join('')}</div>
    <div class="rp-sum"><span>${byKind('skin')} piece sets</span><span>${byKind('board')} boards</span><span>${byKind('trail')} trails</span><span>${byKind('finisher')} finishers</span><span>${byKind('banner')} banners</span><span>${byKind('emote')} emote pack</span><span>${mark(st.rebate.toLocaleString())} back</span></div>
    ${st.owned ? '<p class="rp-note">You own the Royal Pass this season. Rewards unlock as you climb the Crown Path.</p>'
      : `<div class="rp-now"><b>Unlocks instantly:</b> ${nowItems.length} item${nowItems.length === 1 ? '' : 's'}${nowMarks ? ` and ${mark(nowMarks)}` : ''} (tier 0${tier ? ` to ${tier}` : ''})</div>
      <div class="rp-bal"><span>Your Marks</span><b>${mark(p.marks.toLocaleString())}</b><span>After</span><b class="${st.afford ? '' : 'no'}">${st.afford ? mark((p.marks - st.price + nowMarks).toLocaleString()) : `${(st.price - p.marks).toLocaleString()} short`}</b></div>`}
    <div class="rp-acts">${st.owned ? '<button class="btn wide" data-rp="close">Close</button>'
      : `<button class="btn wide gold big" data-rp="buy" ${st.afford ? '' : 'aria-disabled="true"'}>${st.afford ? `Buy for ${mark(st.price.toLocaleString())}` : `Need ${mark((st.price - p.marks).toLocaleString())} more`}</button><button class="btn ghost wide" data-rp="close">Not now</button>
      <p class="rp-fine">Paid with Marks you earn by playing. No real money. One pass covers this season only.</p>`}</div>`;
  m.classList.remove('hidden'); hydrate(m); play('select');
}
function closeRoyal() { const m = $('#m-royal'); if (m) m.classList.add('hidden'); }
function onRoyalClick(e) {
  const m = $('#m-royal');
  if (e.target === m) { closeRoyal(); return; }
  const o = e.target.closest('[data-open]'); if (o) { const [k, id] = o.dataset.open.split(':'); closeRoyal(); openItem(k, id); return; }
  const b = e.target.closest('[data-rp]'); if (!b) return;
  if (b.dataset.rp === 'close') { play('back'); closeRoyal(); return; }
  if (b.dataset.rp === 'buy') {
    const p = P(); const st = royalStatus(p);
    if (!st.afford) { play('error'); D.toast(`You need ${st.price - p.marks} more Marks. A Royale match pays about 70.`); b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], 200); return; }
    if (!b.classList.contains('confirm-buy')) { b.classList.add('confirm-buy'); b.innerHTML = `Tap again to confirm - ${(p.marks - st.price).toLocaleString()} left`; play('select'); return; }
    const r = buyRoyalPass(p); if (!r.ok) { play('error'); closeRoyal(); return; }
    D.save(); closeRoyal(); D.renderProfile();
    const marks = r.granted.reduce((a, g) => a + (g.marks || 0), 0);
    const list = r.granted.map((g) => { const k = rewardKind(g); return k ? [k, g[k]] : null; }).filter(Boolean).reverse();
    p.season.pshown = p.season.prem; D.save();
    play(typeof D.sfx.claim === 'function' ? 'claim' : 'crown'); D.uiFlash(); D.haptic([30, 40, 60, 40, 90]);
    D.toast(`Royal Pass unlocked${marks ? `: +${marks} Marks` : ''}`);
    checkTrophies();
    if (S.active === 'path') renderPath();
    if (list.length) setTimeout(() => revealItems(list), 350);
  }
}

// ---------- 15.0: ability unlocks (Store Abilities tab and Loadout via unlockAbility) ----------
const STATUS_WORDS = ['burn', 'poison', 'freeze', 'stun', 'slow', 'shield', 'haste'];
const statusTags = (desc) => STATUS_WORDS.filter((w) => new RegExp(`\\b${w}`, 'i').test(desc || ''));
function abilityCard(u) {
  const tags = statusTags(u.desc);
  return `<div class="ab-card ${u.owned ? 'owned' : ''} ${u.price ? '' : 'free'}" data-ab="${u.kind}:${u.id}">
    <div class="ab-ic">${u.kind === 'passive' ? '<svg viewBox="0 0 24 24"><path d="M12 2l3 6 6 1-4.5 4.3 1 6.2L12 16.6 6.5 19.5l1-6.2L3 9l6-1z"/></svg>' : icon(u.pieces[0] || 'pawn', P().skin, 40)}</div>
    <div class="ab-tx"><b>${esc(u.name)}</b>${u.pieces.length ? `<span class="ab-pc">${u.pieces.map((k) => PIECES[k].name).join(', ')}</span>` : '<span class="ab-pc">Base ability</span>'}<p>${esc(u.desc)}</p>${tags.length ? `<div class="ab-tags">${tags.map((t) => `<i class="st-${t}">${t}</i>`).join('')}</div>` : ''}</div>
    <div class="ab-act">${!u.price ? '<span class="sc-state">Free</span>' : u.owned ? '<span class="sc-state on">Unlocked</span>' : `<button class="btn small gold" data-unlock="${u.kind}:${u.id}">${mark(u.price)}</button>`}</div></div>`;
}
function renderAbilities(el, hint) {
  const p = P(); const all = unlockList(p);
  const paid = all.filter((u) => u.price), have = paid.filter((u) => u.owned).length;
  const left = paid.filter((u) => !u.owned).reduce((a, u) => a + u.price, 0);
  hint.innerHTML = `Unlock new base abilities and equips for good. Each one is a sidegrade, never a straight upgrade. <b>${have}/${paid.length} unlocked</b>${left ? ` - ${mark(left.toLocaleString())} for the rest` : ''}<div class="filters">${['all', 'locked', 'owned'].map((f) => `<button class="chip ${S.abFilter === f ? 'on' : ''}" data-abfilter="${f}">${{ all: 'All', locked: 'Locked', owned: 'Unlocked' }[f]}</button>`).join('')}</div>`;
  const keep = (u) => S.abFilter === 'all' || (S.abFilter === 'locked' ? !u.owned : u.owned);
  const sect = (title, list) => { const l = list.filter(keep); return l.length ? `<div class="sec-h"><b>${title}</b><span>${list.filter((u) => u.owned).length}/${list.length}</span></div><div class="ab-list">${l.map(abilityCard).join('')}</div>` : ''; };
  el.innerHTML = sect('Base abilities', all.filter((u) => u.kind === 'passive'))
    + PIECE_ORDER.map((pc) => sect(`${PIECES[pc].name} equips`, all.filter((u) => u.kind === 'ability' && u.pieces[0] === pc))).join('')
    || '<div class="empty"><b>Nothing here</b><p>Try another filter.</p></div>';
}
// Buys an unlock after a confirm sheet. Used by the Store and by F's Loadout. Resolves true when the unlock went through.
export function unlockAbility(kind, id) {
  return new Promise((resolve) => {
    const p = P(); const price = unlockPrice(kind, id);
    if (isUnlocked(p, kind, id)) { resolve(true); return; }
    const name = (unlockList(p).find((u) => u.kind === kind && u.id === id) || {}).name || id;
    const m = sheet(); const box = m.querySelector('.rp-box'); m.dataset.mode = 'unlock';
    const afford = p.marks >= price;
    box.innerHTML = `<div class="rp-top ab"><span>${kind === 'passive' ? 'Base ability' : 'Equip'}</span><h3>${esc(name)}</h3><p>${esc((unlockList(p).find((u) => u.kind === kind && u.id === id) || {}).desc || '')}</p></div>
      <div class="rp-bal"><span>Your Marks</span><b>${mark(p.marks.toLocaleString())}</b><span>After</span><b class="${afford ? '' : 'no'}">${afford ? mark((p.marks - price).toLocaleString()) : `${(price - p.marks).toLocaleString()} short`}</b></div>
      <div class="rp-acts"><button class="btn wide gold big" data-ul="buy" ${afford ? '' : 'aria-disabled="true"'}>${afford ? `Unlock for ${mark(price)}` : `Need ${mark(price - p.marks)} more`}</button><button class="btn ghost wide" data-ul="close">Not now</button></div>`;
    const done = (v) => { m.removeEventListener('click', on, true); m.classList.add('hidden'); resolve(v); };
    const on = (e) => {
      if (e.target === m) { e.stopPropagation(); done(false); return; }
      const b = e.target.closest('[data-ul]'); if (!b) return; e.stopPropagation();
      if (b.dataset.ul === 'close') { play('back'); done(false); return; }
      const r = buyUnlock(P(), kind, id);
      if (!r.ok) { if (r.reason === 'owned' || r.reason === 'free') { done(true); return; } play('error'); D.toast(`You need ${r.need} more Marks`); b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], 200); return; }
      D.save(); D.renderProfile(); play(typeof D.sfx.claim === 'function' ? 'claim' : 'buy'); D.uiFlash(); D.haptic([20, 30, 50]);
      D.toast(`${name} unlocked`); checkTrophies(); done(true);
    };
    m.addEventListener('click', on, true);
    m.classList.remove('hidden'); play('select');
  });
}

// ---------- Trophies ----------
export function renderTrophies() {
  const p = P(); checkAchievements(p); D.save();
  const ids = Object.keys(ACHIEVEMENTS);
  const cat = (a) => a.cat || ACH_CAT[a.stat] || 'combat';
  $('#ach-count').textContent = `${p.achievements.length}/${ids.length}`;
  $('#ach-cats').innerHTML = ['all', ...Object.keys(ACH_CATS)].map((c) => { const n = ids.filter((id) => c === 'all' || cat(ACHIEVEMENTS[id]) === c); return `<button class="chip ${S.achCat === c ? 'on' : ''}" data-cat="${c}">${c === 'all' ? 'All' : ACH_CATS[c]} <em>${n.filter((id) => p.achievements.includes(id)).length}/${n.length}</em></button>`; }).join('');
  const rows = ids.filter((id) => S.achCat === 'all' || cat(ACHIEVEMENTS[id]) === S.achCat).map((id) => { const a = ACHIEVEMENTS[id], goal = achievementGoal(a), done = p.achievements.includes(id), v = Math.min(goal, achievementValue(p, a)); return { id, a, goal, done, v, k: done ? 2 : v / goal }; })
    .sort((x, y) => (x.done - y.done) || (y.k - x.k));
  $('#ach-list').innerHTML = rows.map(({ a, goal, done, v }) => `<div class="ach ${done ? 'done' : ''}"><div class="ai"><svg><use href="#i-trophy"/></svg></div><div class="at"><b>${esc(a.name)}</b><p>${esc(a.desc)}</p>${done ? '<span class="ach-t">Title unlocked</span>' : `<div class="qbar"><i style="width:${(v / goal) * 100}%"></i></div><span class="ach-v">${v.toLocaleString()} / ${goal.toLocaleString()}</span>`}</div><div class="rw">${mark(a.reward)}</div></div>`).join('');
  $('#title-count').textContent = `${p.titles.length} unlocked`;
  $('#title-list').innerHTML = [`<button class="${!p.title ? 'on' : ''}" data-title="">None</button>`, ...p.titles.map((t) => `<button class="${p.title === t ? 'on' : ''}" data-title="${esc(t)}">${esc(t)}</button>`)].join('') + (p.titles.length ? '' : '<p class="hint" style="margin:6px 0 0">Earn titles from trophies, collections and the Crown Path.</p>');
  $('#mastery-list').innerHTML = [...PIECE_ORDER, 'king'].map((pc) => { const m = masteryLevel(p.mastery[pc] || 0); const pct = m.need ? Math.round(m.into / m.need * 100) : 100; return `<div class="ms-row ${m.lv >= 10 ? 'max' : ''}">${icon(pc, p.skin, 34)}<div><b>${PIECES[pc].name}</b><span>Level ${m.lv}${m.lv >= 10 ? ' - Master' : ` - ${m.into}/${m.need}`}</span><div class="xpbar"><i style="width:${pct}%"></i></div></div></div>`; }).join('');
  hydrate($('#s-trophies'));
  const st = p.stats;
  $('#career2').innerHTML = `<div><b>${st.games}</b><span>Games</span></div><div><b>${st.wins}</b><span>Wins</span></div><div><b>${st.kills}</b><span>KOs</span></div><div><b>${st.bestStreak}</b><span>Best streak</span></div>`;
}
function onTrophyClick(e) {
  const c = e.target.closest('[data-cat]'); if (c) { S.achCat = c.dataset.cat; play('tap'); renderTrophies(); return; }
  const t = e.target.closest('[data-title]'); if (t) { P().title = t.dataset.title; D.save(); play('select'); renderTrophies(); }
}

// ---------- Profile / Collection ----------
export function renderProfileScreen() {
  const p = P(); const st = p.stats; const oc = ownedCounts(p);
  const wr = st.games ? Math.round(st.wins / st.games * 100) : 0;
  const pinned = p.showcase.map((k) => k.split(':')).filter(([k, id]) => KINDS[k] && KINDS[k].table[id] && isOwned(p, k, id));
  const auto = allItems(p).filter((i) => i.owned && !i.def && !pinned.some(([k, id]) => k === i.kind && id === i.id)).sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || (b.price || 0) - (a.price || 0));
  const show = [...pinned.map(([k, id]) => item(p, k, id)), ...auto].slice(0, 4);
  const cols = Object.keys(BUNDLES), colDone = cols.filter((k) => bundleInfo(p, k).done).length;
  const login = loginStatus(p);
  const mast = [...PIECE_ORDER, 'king'].map((pc) => ({ pc, m: masteryLevel(p.mastery[pc] || 0) }));
  const topR = ['mythic', 'legendary', 'epic', 'rare', 'common', 'season'];
  const av = p.avatar && PIECES[p.avatar.piece] ? p.avatar : { piece: 'king', skin: null }, avSkin = av.skin && SKINS[av.skin] ? av.skin : p.skin;
  $('#profile-body').innerHTML = `<div class="pf-hero ${hasRoyal(p) ? 'royal' : ''}"><canvas id="pf-stage"></canvas>
      <div class="pf-id" style="background:${bannerCss(p.banner)}"><div class="pf-av">${icon(av.piece, avSkin, 44)}<div class="lvl">${p.level}</div></div><div><b>${esc(p.name)}</b><span>${esc(p.title || titleFor(p.level))}</span></div><div class="pf-season"><span>${hasRoyal(p) ? 'Royal Pass' : 'Crown Path'}</span><b>${seasonTier(p)}/${SEASON.tiers}</b></div></div>
      <div class="xpbar"><i style="width:${Math.min(100, p.xp / xpForLevel(p.level) * 100)}%"></i></div></div>
    <div class="panel"><div class="lbl">Showcase <span class="pts">Pin from an item page</span></div><div class="pf-show">${show.map((i) => `<button class="pf-sh rr-${i.rarity}" data-open="${i.kind}:${i.id}" style="--rc:${RC(i.rarity)}">${thumb(i.kind, i.id, 56)}<b>${esc(i.name)}</b><span>${RARITY[i.rarity].name}</span></button>`).join('') || '<p class="hint">Unlock items in the Store and the Crown Path to fill your showcase.</p>'}</div></div>
    <div class="panel"><div class="lbl">Career</div><div class="pf-stats">
      ${[['Games', st.games], ['Wins', st.wins], ['Win rate', wr + '%'], ['KOs', st.kills], ['Crowns', st.crowns], ['Best streak', st.bestStreak], ['Ultimates', st.ults], ['Damage', (st.dmgTotal || 0).toLocaleString()], ['Login streak', `${login.claimed ? login.streak : Math.max(0, login.streak - 1)} (best ${p.login.best})`]].map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('')}</div></div>
    <div class="panel"><div class="lbl">Collection <span class="pts">${oc.total} / ${oc.all} unlocked</span></div><div class="cc-bar big"><i style="width:${Math.round(oc.total / Math.max(1, oc.all) * 100)}%"></i></div>
      <div class="pf-kinds">${Object.keys(KINDS).filter((k) => KINDS[k].tab).map((k) => `<button data-store="${KINDS[k].tab}"><b>${oc.byKind[k].owned}<em>/${oc.byKind[k].total}</em></b><span>${KINDS[k].label}s</span></button>`).join('')}</div>
      <div class="pf-rar">${topR.filter((r) => oc.byRarity[r]).map((r) => `<span style="--rc:${RC(r)}">${oc.byRarity[r]} ${RARITY[r].name}</span>`).join('')}</div>
      <button class="pf-cols" data-store="collections"><b>${colDone}/${cols.length}</b><span>Collections complete</span></button></div>
    <div class="panel"><div class="lbl">Mastery <span class="pts">Top level ${Math.max(...mast.map((x) => x.m.lv))}</span></div><div class="pf-mast">${mast.map(({ pc, m }) => `<div class="${m.lv >= 10 ? 'max' : ''}">${icon(pc, p.skin, 40)}<b>${m.lv}</b><i style="--k:${m.need ? m.into / m.need : 1}"></i></div>`).join('')}</div></div>
    <div class="panel"><div class="lbl">Abilities <span class="pts">${(() => { const u = unlockList(p).filter((x) => x.price); return `${u.filter((x) => x.owned).length}/${u.length} unlocked`; })()}</span></div><button class="btn wide" data-store="abilities">Unlock abilities</button></div>
    <div class="panel"><div class="lbl">Trophies <span class="pts">${p.achievements.length}/${Object.keys(ACHIEVEMENTS).length}</span></div><button class="btn wide" data-go="trophies">View trophies and titles</button></div>
    ${p.pastSeasons.length ? `<div class="panel"><div class="lbl">Seasons</div>${p.pastSeasons.map((s) => `<div class="ps"><b>${esc(PAST_SEASONS[s.id] || 'Season ' + s.id)}</b><span>Tier ${s.tier}</span></div>`).join('')}<div class="ps"><b>${esc(SEASON.name)}</b><span>Tier ${seasonTier(p)} (now)</span></div></div>` : ''}`;
  hydrate($('#profile-body'));
  S.profStage = makeStage($('#pf-stage'), { skin: avSkin, board: p.board, trail: p.trail === 'none' ? 'none' : p.trail, finisher: p.finisher }, { piece: STAGE_ROSTER.includes(av.piece) ? av.piece : 'king', reduced: reduced(), lowQ: lowQ(), cols: 4, reserve: 0.3, solo: true });
}
function onProfileClick(e) {
  const s = e.target.closest('[data-store]'); if (s) { S.tab = s.dataset.store; S.filter = 'all'; play('tap'); D.go('armory'); return; }
  const o = e.target.closest('[data-open]'); if (o) { const [k, id] = o.dataset.open.split(':'); openItem(k, id); }
}

// ---------- daily login ----------
// Shows the daily reward once per session on the title screen, waiting until splash, intro and other dialogs are gone.
export function maybeLogin(tries = 3) {
  if (S.loginShown) return; const p = P(); const st = loginStatus(p);
  const q = new URLSearchParams(location.search);
  if (q.get('join') || q.get('net') === 'local') return; // never get in the way of an invite link or a local test session
  if (st.claimed) return;
  const busy = $$('.modal:not(.hidden)').length || document.querySelector('.sequel') || ($('#splash') && !$('#splash').classList.contains('out')) || !$('#s-title.active');
  if (busy) { if (tries > 0) setTimeout(() => maybeLogin(tries - 1), 1000); return; } // short window only: never pop up under a finger mid-navigation
  S.loginShown = true;
  $('#lg-days').innerHTML = LOGIN_REWARDS.map((r, i) => `<div class="lg-d ${i + 1 < st.day ? 'got' : ''} ${i + 1 === st.day ? 'now' : ''} ${i === 6 ? 'big' : ''}"><span>Day ${i + 1}</span><i class="mark-ico"></i><b>${r.marks}</b>${r.xp ? `<em>+${r.xp} XP</em>` : ''}</div>`).join('');
  $('#lg-streak').textContent = st.streak > 1 ? `${st.streak} day streak` : 'Welcome back';
  $('#m-login').classList.remove('hidden');
  if (!navigator.userActivation || navigator.userActivation.hasBeenActive) play('quest');
}
// Leaving the title with the reward still open claims it quietly, so it never blocks anything.
export function leaveLogin() {
  const m = $('#m-login'); if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  const r = claimLogin(P()); if (!r) return;
  D.save(); D.toast(`Day ${r.day} reward claimed: +${r.reward.marks} Marks`);
}
function onLoginClick(e) {
  if (!e.target.closest('#lg-claim')) return;
  const p = P(); const r = claimLogin(p); $('#m-login').classList.add('hidden');
  if (!r) return;
  D.save(); D.renderProfile(); play(typeof D.sfx.claim === 'function' ? 'claim' : 'buy'); D.uiFlash(); D.haptic([20, 30, 40]);
  D.toast(`Day ${r.day} reward: +${r.reward.marks} Marks${r.reward.xp ? ` and ${r.reward.xp} season XP` : ''}`);
  setTimeout(() => revealSeasonItems(), 900);
  checkTrophies();
}

// Crown Path item rewards earned in a match get the full reveal the next time the title screen is calm.
function revealSeasonItems() {
  const p = P(); if (S.active !== 'title' || $$('.modal:not(.hidden)').length || document.querySelector('.sequel')) return;
  const tier = seasonTier(p); const prem = hasRoyal(p) ? p.season.prem : -1;
  if (p.season.shown >= tier && p.season.pshown >= prem) return;
  const items = [];
  for (let t = p.season.shown + 1; t <= tier; t++) { const r = resolveReward(SEASON_REWARDS[t]); const k = rewardKind(r); if (k) items.push([k, r[k]]); }
  for (let t = p.season.pshown + 1; t <= prem; t++) { const r = resolveReward(ROYAL_REWARDS[t]); const k = rewardKind(r); if (k) items.push([k, r[k]]); }
  p.season.shown = Math.max(p.season.shown, tier); p.season.pshown = Math.max(p.season.pshown, prem); D.save();
  if (items.length) { D.toast('Crown Path rewards unlocked'); revealItems(items.reverse()); }
}

// ---------- per-frame ----------
export function onScreen(name) {
  S.active = name;
  if (name === 'title' || name === 'armory' || name === 'profile') { const done = claimCollections(P()); if (done.length) { D.save(); setTimeout(() => { D.toast(`Collection complete: ${done[0].name}. +${done[0].reward.marks} Marks, title ${done[0].reward.title}`); play(typeof D.sfx.claim === 'function' ? 'claim' : 'crown'); }, 600); } }
  if (name !== 'armory' && !(S.cur && !$('#m-item').classList.contains('hidden'))) { if (S.stageOwner === 'deal') S.stage = null; clearPreviews(); }
  if (name === 'title') setTimeout(() => revealSeasonItems(), 1400);
  if (name !== 'profile') S.profStage = null;
  if (name !== 'path') S.pathHero = null;
}
let acc = 0;
export function frame(dt) {
  const slow = reduced() || lowQ();
  acc += dt; if (slow && acc < 1 / 20) return; const step = slow ? acc : dt; acc = 0;
  const itemOpen = !$('#m-item').classList.contains('hidden');
  if (S.reveal && !$('#m-reveal').classList.contains('hidden')) drawReveal(S.reveal, step);
  if (S.stage && (itemOpen || S.active === 'armory')) drawStage(S.stage, step);
  if (S.active === 'armory' && !itemOpen) for (const p of S.previews) if (p.visible) drawPreview(p, step);
  if (S.active === 'profile' && S.profStage) drawStage(S.profStage, step);
  if (S.active === 'path' && S.pathHero) drawPreview(S.pathHero, step);
}

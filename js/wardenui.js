// Chess Complex 18.1 "Warden Rating" (L3): co-op rating UI + the solo verified-run client.
//   - Co-op tab on the Leaderboards screen (Warden Rating board + this week / last week co-op season)
//   - Warden badge (hex emblem, distinct from the Crown shield) on the profile, co-op lobbies and co-op results
//   - results line: run score + rating change; solo runs: ticket (server seed) -> start -> submit -> verified status
//   - Play screen note: which runs count
// Math, tiers and rewards: js/warden.js. Server: server/src/warden.js (routes /lb/coop/*, boards warden + wseason).
// main.js wiring (one-line Edits tagged 18.1 (L3)): init, take/begin in startSolo, onResults, decorateProfile,
// cardTag in co-op lobby cards, resBadge on co-op standings, playNote on the Play screen.
import * as CL from './cloud.js';
import { pieceIcon } from './pieces.js';
import { protoVer } from './statehash.js';
import { WARDEN, WTIERS, wtierOf, cleanWk, runFacts, runScore, isCoop } from './warden.js';

const KEY = 'cc_wd_v1', CLOUD_KEY = 'cc_cloud_v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let H = { profile: () => ({}), toast: () => {}, sfx: null };
function readLS(k) { try { const o = JSON.parse(localStorage.getItem(k) || 'null'); return o && typeof o === 'object' ? o : null; } catch { return null; } }
let st = readLS(KEY) || {};
if (!st.views || typeof st.views !== 'object') st.views = {};
const writeSt = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
export function identity() { const c = readLS(CLOUD_KEY); return c && /^[0-9A-Z]{10}$/i.test(c.id || '') && c.secret ? { id: String(c.id).toUpperCase(), secret: c.secret } : null; }

// ---------- network ----------
async function call(path, opt = {}, ms = 5000) {
  let base = null; try { base = await CL.endpoint(); } catch {}
  if (!base) throw Object.assign(new Error('off'), { off: true });
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => ctl && ctl.abort(), ms);
  try { const r = await fetch(base + path, { cache: 'no-store', ...opt, signal: ctl && ctl.signal }); return { status: r.status, body: await r.json().catch(() => null) }; }
  catch { throw Object.assign(new Error('net'), { net: true }); } finally { clearTimeout(to); }
}
const postA = (path, body, ms) => { const id = identity(); return call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + id.secret }, body: JSON.stringify({ cid: id.id, ...body }) }, ms); };

// ---------- badges ----------
const GLYPH = {
  squire: 'M11.1 3.2L12 1.6l.9 1.6v10.6h-1.8zM7.4 13.8h9.2v1.9H7.4zM11.1 15.7h1.8v3.1h-1.8zM9.9 18.8h4.2v1.9H9.9z',
  sentinel: 'M12 1.8l2.5 4.6h-1.6v15.3h-1.8V6.4H9.5zM9.2 8.4h5.6v1.4H9.2z',
  guardian: 'M12 3.6a8.4 8.4 0 1 1 0 16.8a8.4 8.4 0 1 1 0-16.8zM12 6.2a5.8 5.8 0 1 0 0 11.6a5.8 5.8 0 1 0 0-11.6zM12 9.6a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 1 1 0-4.8z',
  bulwark: 'M3.6 5.2h3.2v2.6h1.9V5.2h2.4v2.6h1.8V5.2h2.4v2.6h1.9V5.2h3.2v15.4H3.6zM6 11.2v1.3h12v-1.3zM6 15.6v1.3h12v-1.3zM11.4 8.8v2.4h1.2V8.8zM8.2 12.5v3.1h1.2v-3.1zM14.6 12.5v3.1h1.2v-3.1z',
  paladin: 'M10.5 2.6h3v7.9h7.9v3h-7.9v7.9h-3v-7.9H2.6v-3h7.9z',
  warden: 'M10.6 1.8h2.8v1.9h1.8l1 2.1H7.8l1-2.1h1.8zM7.6 6.8h8.8l-.9 1.6v8.2l.9 1.6H7.6l.9-1.6V8.4zM12 9.4c1.4 1.5 2 2.6 2 3.6a2 2 0 0 1-4 0c0-1 .6-2.1 2-3.6zM7.4 19.2h9.2v2.2H7.4z',
};
const HEX = 'M12 .9l10 5.6v11L12 23.1 2 17.5v-11z';
export function badgeSVG(t, px = 18) {
  const id = 'wdg' + t.id + (t.prov ? 'p' : '');
  return `<svg class="wd18-svg" viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.color}"/><stop offset="1" stop-color="${t.c2}"/></linearGradient></defs>`
    + `<path d="${HEX}" fill="${t.prov ? '#1f2a26' : `url(#${id})`}" stroke="${t.prov ? t.color : 'rgba(6,12,10,.85)'}" stroke-width="${t.prov ? 1.3 : 1}"${t.prov ? ' stroke-dasharray="2.2 1.6"' : ''}/>`
    + `<g transform="translate(4.1 4.1) scale(.66)"><path d="${GLYPH[t.id]}" fill="${t.prov ? t.color : '#f6fff4'}" fill-rule="evenodd" stroke="rgba(6,12,10,.55)" stroke-width=".8" paint-order="stroke"/></g></svg>`;
}
const label = (t) => (t.prov ? `${t.name} (provisional)` : `${t.name} - ${t.r}`);
// wk = {w, wp?} (or an rk object carrying w)
export function badge(wk, px = 16) {
  const k = cleanWk(wk); if (!k) return '';
  const t = wtierOf(k.w, !!k.wp);
  return `<span class="wd18 wd18-${t.id}${t.prov ? ' prov' : ''}" title="Warden: ${esc(label(t))}" aria-label="Warden rank ${esc(label(t))}">${badgeSVG(t, px)}</span>`;
}
export function chip(wk, o = {}) {
  const k = cleanWk(wk); if (!k) return '';
  const t = wtierOf(k.w, !!k.wp);
  return `<span class="wd18-chip wd18-${t.id}${t.prov ? ' prov' : ''}" style="--wd:${t.color}">${badgeSVG(t, o.px || 18)}<b>${t.name}</b>${o.r ? `<em>${t.prov ? 'Provisional' : t.r}</em>` : ''}</span>`;
}
const fromCard = (c) => (c && c.games > 0 ? { w: Math.round(c.r), ...(c.prov ? { wp: 1 } : {}) } : null);
export const myWk = () => fromCard(st.me && st.me.d && st.me.d.warden);
export function ladderHTML(wk) {
  const k = cleanWk(wk), cur = k ? wtierOf(k.w, !!k.wp) : null;
  return `<div class="wd18-ladder">${WTIERS.map((T) => `<div class="wd18-step${cur && cur.id === T.id ? ' on' : ''}" style="--wd:${T.color}">${badgeSVG(wtierOf(T.min, false), 24)}<b>${T.name}</b><small>${T.min ? T.min + '+' : 'start'}</small></div>`).join('')}</div>`;
}
// co-op lobby card (main.js lobbyHTML): the Warden badge replaces the Crown badge
export function cardTag(p) { if (!p) return ''; const w = cleanWk(p.rk) || (p.pid === 'me' ? myWk() : null); return badge(w, 15); }
// co-op standings on the results screen
export function resBadge(pid, sess) {
  const seat = sess && Array.isArray(sess.players) ? sess.players.find((q) => q && q.pid === pid) : null;
  const w = (seat && cleanWk(seat.rk)) || (sess && pid === sess.myPid ? myWk() : null);
  return badge(w, 14);
}

// ---------- my card ----------
export async function fetchMe() {
  const id = identity(); if (!id) return null;
  const r = await call(`/lb/coop/me?cid=${id.id}`);
  if (r.status !== 200 || !r.body) return null;
  st.me = { at: Date.now(), d: r.body }; writeSt();
  return r.body;
}

// ---------- solo runs: ticket -> start -> submit ----------
// A ticket (server-chosen seed) is fetched ahead of time, so starting a run never waits on the network.
let ticketing = null;
export function prefetch() {
  if (!identity() || ticketing) return ticketing;
  if (st.ticket && st.ticket.cid === identity().id && Date.now() - st.ticket.at < 20 * 3600e3) return Promise.resolve(st.ticket);
  ticketing = postA('/lb/coop/ticket', {}, 5000).then((r) => {
    if (r.status === 200 && r.body && r.body.rid) { st.ticket = { rid: r.body.rid, seed: r.body.seed, at: Date.now(), cid: identity().id }; writeSt(); }
    return st.ticket || null;
  }, () => null).finally(() => { ticketing = null; });
  return ticketing;
}
// startSolo: a solo Siege / Gauntlet takes the ticket (its seed seeds the match) -> {rid, seed} | null (unranked)
export function take(mode) {
  if (!isCoop(mode)) return null;
  const id = identity(), t = st.ticket;
  if (!id || !t || t.cid !== id.id || Date.now() - t.at > 20 * 3600e3) { st.why = id ? 'offline' : 'nocloud'; writeSt(); prefetch(); return null; }
  st.ticket = null; writeSt();
  return { rid: t.rid, seed: t.seed };
}
// register the start (the server marks the ticket started). -> Promise<{ranked, rid, mode}>
export function begin(t, mode) {
  const p = H.profile() || {};
  const av = p.avatar && typeof p.avatar === 'object' ? { piece: p.avatar.piece, skin: p.avatar.skin || p.skin } : null;
  return postA('/lb/coop/start', { rid: t.rid, mode, name: p.name || 'Player', title: p.title || '', avatar: av }, 6000)
    .then((r) => ({ ranked: r.status === 200 && !!(r.body && r.body.ranked), rid: t.rid, mode, why: r.status === 200 ? '' : 'refused' }), () => ({ ranked: false, rid: t.rid, mode, why: 'offline' }));
}
async function submit(att, rec) {
  const body = { rid: att.rid, ver: protoVer(), players: rec.players, opts: rec.opts, actions: rec.actions };
  const r = await postA('/lb/coop/run', body, 15000);
  return r;
}
async function status(rid, tries = 40) {
  const id = identity(); if (!id) return null;
  for (let i = 0; i < tries; i++) {
    try { const r = await call(`/lb/coop/status?cid=${id.id}&rid=${rid}`); if (r.body && r.body.st !== 'queued') return r.body; } catch { return null; }
    await new Promise((res) => setTimeout(res, 700 + Math.min(i, 10) * 150));
  }
  return { st: 'queued' };
}

// ---------- results ----------
// ctx: {s (final state), myPid, session, quit}
const gen = { n: 0 };
export function onResults(ctx) {
  const box = $('#r-quests'); if (!box || !ctx || !ctx.s || !ctx.s.siege) return;
  const old = $('#wd-res'); if (old) old.remove();
  const sess = ctx.session || {};
  const f = runFacts(ctx.s, ctx.myPid); if (!f) return;
  const est = runScore(f).score, g = ++gen.n;
  const row = document.createElement('div'); row.className = 'r-unlock lb-res wd-res'; row.id = 'wd-res';
  const set = (a, b, tone) => { if (g !== gen.n) return; row.innerHTML = `<span>${a}</span><b>${b}</b>`; row.dataset.tone = tone || ''; };
  box.prepend(row);
  const head = (sc) => `${badge(myWk(), 16)}Warden run <em class="lb-score">${sc}</em>`;
  const after = (card, sc) => {
    const d = card && card.last != null ? Math.round(card.last) : null;
    const dl = d != null ? ` <em class="lb-d ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}</em>` : '';
    set(head(sc), card ? (card.prov ? `Rating ${card.r}${dl} - provisional (${card.left} left)` : `Rating ${card.r}${dl} - #${card.rank} of ${card.of}`) : 'Counted', 'good');
    const li = card && document.querySelector('#r-board li.me > span'); // my badge on the standings, now that the card is known
    if (li && !li.querySelector('.wd18')) li.insertAdjacentHTML('afterbegin', badge(fromCard(card), 14));
  };
  if (sess.cloud) { // the Room's own record counts (verified seats); refresh my card a moment later
    if (!identity()) { set(head(est), 'Not counted: cloud save off', 'mute'); return; }
    if (ctx.quit) { set(head(est), 'Not counted: you left the match', 'mute'); return; }
    set(head(est), 'Updating...', 'wait');
    const before = st.me && st.me.d && st.me.d.warden ? st.me.d.warden.games : null;
    setTimeout(async () => {
      let me = null; try { me = await fetchMe(); } catch {}
      if (!me || !me.warden) { set(head(est), 'Offline', 'mute'); return; }
      if (before != null && me.warden.games <= before) { set(head(est), 'Not counted (cloud save not verified)', 'mute'); return; }
      after(me.warden, me.warden.recent && me.warden.recent[0] ? me.warden.recent[0].score : est);
    }, 2600);
    return;
  }
  if (sess.mode !== 'solo') { set(head(est), 'Not counted: only cloud rooms and server-checked solo runs count', 'mute'); return; }
  if (!sess.wd) { set(head(est), st.why === 'nocloud' || !identity() ? 'Not counted: cloud save off' : 'Not counted: offline at the start', 'mute'); prefetch(); return; }
  if (ctx.quit) { set(head(est), 'Quit: counts as a 0 run', 'mute'); prefetch(); return; }
  set(head(est), 'Checking your run...', 'wait');
  Promise.resolve(sess.wd).then(async (att) => {
    if (!att || !att.ranked) { set(head(est), att && att.why === 'offline' ? 'Not counted: offline at the start' : 'Not counted', 'mute'); return; }
    const rec = sess.host && sess.host.rec;
    if (!rec || !Array.isArray(rec.actions) || !rec.actions.length) { set(head(est), 'Not counted: no record', 'mute'); return; }
    let r = null; try { r = await submit(att, rec); } catch {}
    if (!r) { set(head(est), 'Offline: not counted', 'mute'); return; }
    if (r.status !== 202) { set(head(est), esc((r.body && r.body.why) || 'Not counted'), 'mute'); return; }
    set(head(est), 'Verifying on the server...', 'wait');
    const s = await status(att.rid);
    if (!s) set(head(est), 'Offline', 'mute');
    else if (s.st === 'ok') { if (s.card) { st.me = { at: Date.now(), d: { ...(st.me && st.me.d), warden: s.card } }; writeSt(); } set(head(s.score), '', 'good'); after(s.card ? { ...s.card, last: s.delta } : null, s.score); }
    else if (s.st === 'rejected') set(head(est), 'Run could not be verified', 'bad');
    else set(head(est), 'Still verifying - check the Co-op board', 'wait');
  }).catch(() => set(head(est), 'Offline', 'mute')).finally(() => prefetch());
}

// ---------- Play screen ----------
export function playNote(mode) {
  const old = $('#wd-note');
  if (!isCoop(mode)) { if (old) old.remove(); return; }
  const anchor = $('#opt-diff'); if (!anchor) return;
  const n = old || document.createElement('p'); n.id = 'wd-note'; n.className = 'lb-dnote wd-note';
  if (!old) anchor.after(n);
  const set = (t, tone) => { n.textContent = t; n.dataset.tone = tone; };
  if (!identity()) return set('Warden Rating: cloud save is off, so solo runs won\'t count.', 'off');
  set('Warden Rating: the server replays this run to count it. Fewer allies score more.', 'go');
  prefetch().then((t) => { if (!t && n.isConnected) set('Offline: this run won\'t count for your Warden Rating.', 'off'); });
}

// ---------- profile ----------
export function decorateProfile() {
  const body = $('#profile-body'); if (!body) return;
  let el = $('.wd-prof', body);
  if (!el) { el = document.createElement('div'); el.className = 'panel wd-prof'; const after = $('.lb-prof', body) || $('.pf-hero', body); if (after) after.after(el); else body.prepend(el); }
  const paint = (me, off) => {
    const c = me && me.warden, S = me && me.wseason, wk = fromCard(c);
    el.innerHTML = `<div class="lbl">Warden Rating <span class="pts">Co-op</span>${off ? ' <span class="pts lb-off-t">Offline</span>' : ''}</div>
      <div class="wd-pf"><div class="wd-pf-big">${wk ? chip(wk, { px: 30 }) : badge({ w: 0, wp: 1 }, 30)}<b>${c && c.games ? c.r : '-'}</b><small>${!identity() ? 'Cloud save off' : !c || !c.games ? 'Play Siege or Gauntlet' : c.prov ? `Provisional, ${c.left} more run${c.left === 1 ? '' : 's'}` : `#${c.rank} of ${c.of}`}</small></div>
      <div class="wd-pf-s"><span><small>This week</small><b>${S && S.rank ? '#' + S.rank : '-'}</b><em>${S ? S.pts : 0} pts</em></span><span><small>Runs</small><b>${c ? c.games : 0}</b><em>${c ? c.wins || 0 : 0} won</em></span><span><small>Peak</small><b>${c && c.peak ? c.peak : '-'}</b><em>top third</em></span></div></div>
      ${ladderHTML(wk)}<button class="btn wide" data-go="ranks" data-lb-tab="coop">Co-op leaderboard</button>`;
  };
  paint(st.me && st.me.d, !navigator.onLine);
  if (identity()) fetchMe().then((me) => me && paint(me, false), () => paint(st.me && st.me.d, true));
}

// ---------- the Co-op tab (js/leaderboard.js delegates load('coop') here) ----------
const V = { sub: 'warden', gen: 0 };
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
const left = (t) => { const s = Math.max(0, (t - Date.now()) / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const fmtDay = (sid) => { try { return new Date(sid + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return sid; } };
function avatarImg(a, size = 40) { const [pc, sk] = String(a || '').split(':'); try { return `<img src="${pieceIcon(pc || 'pawn', sk || 'ivory', null, size)}" alt="">`; } catch { return ''; } }
function rowHTML(r) {
  const medal = r.rank <= 3 ? ` m${r.rank}` : '';
  const sub = r.title ? esc(r.title) : r.games != null ? `${r.games} run${r.games === 1 ? '' : 's'}${r.wins ? `, ${r.wins} won` : ''}` : '';
  return `<li class="lb-row${r.me ? ' me' : ''}${medal}"><span class="lb-rk">${r.rank}</span><span class="lb-av">${avatarImg(r.avatar)}</span><span class="lb-nm"><b>${badge(r.wk, 15)}${esc(r.name)}${r.me ? ' <i>You</i>' : ''}</b><em>${sub}</em></span><span class="lb-v">${r.v}<small>${V.sub === 'warden' ? '' : 'pts'}</small></span></li>`;
}
function heroHTML(d) {
  const id = identity(), c = d && d.card;
  const seg = `<div class="seg small wd-seg" role="tablist" aria-label="Co-op board">${[['warden', 'Warden Rating'], ['week', 'This week'], ['last', 'Last week']].map(([k, n]) => `<button role="tab" class="${V.sub === k ? 'on' : ''}" aria-selected="${V.sub === k}" data-wd-sub="${k}">${n}</button>`).join('')}</div>`;
  if (V.sub === 'warden') {
    const wk = fromCard(c);
    const sub = !id ? 'Cloud save off' : !c || !c.games ? 'No counted runs yet' : c.prov ? `Provisional: ${c.left} more run${c.left === 1 ? '' : 's'}` : `#${c.rank} of ${c.of} - peak ${c.peak}`;
    const dl = c && c.games && c.last ? `<em class="lb-d ${c.last >= 0 ? 'up' : 'down'}">${c.last >= 0 ? '+' : ''}${Math.round(c.last)} last run</em>` : '';
    return `${seg}<div class="lb-hero"><div class="lb-big wd-big"><small>Warden Rating</small><b>${c && c.games ? c.r : '-'}</b><span>${sub}</span></div><div class="lb-hi">${wk ? chip(wk, { px: 22 }) : ''}<p>Siege and Gauntlet, solo or 2-4 players. Each run scores waves, the win, the mode and your share; fewer allies score more. Your rating is the average of your best third of your last ${WARDEN.window} runs.</p><p class="wd-rule">Cloud rooms count for cloud-saved players. Solo runs count once the server replays them. Offline and phone-hosted runs don't count.</p>${dl}</div></div>`;
  }
  const last = V.sub === 'last';
  const me = d && d.me;
  const when = last ? (d && d.sid ? `Week of ${fmtDay(d.sid)} - final standings` : 'No finished co-op season yet') : d && d.ends ? `Week of ${fmtDay(d.sid)} - ends in ${left(d.ends)}` : 'This week';
  return `${seg}<div class="lb-hero"><div class="lb-big wd-big"><small>${last ? 'Last week' : 'Co-op season'}</small><b>${me ? '#' + me.rank : '-'}</b><span>${me ? me.v : 0} pts</span></div><div class="lb-hi"><p>${when}</p><p>Points = your best ${WARDEN.seasonBest} run scores of the week.</p><p class="rk18-rw">Top 50 at the Monday reset earn a co-op title and banner: Lord of the Keep (1st), Keepwarden (top 3), Wavebreaker (top 10), Hollowbane (top 50).</p></div></div>`;
}
function paint(d, state) {
  const body = $('#lb-body'), pin = $('#lb-pin'); if (!body) return;
  const status = state === 'loading' && !d ? '<div class="lb-state">Loading...</div>'
    : state === 'off' ? `<div class="lb-state off" role="status"><svg><use href="#m-link"/></svg><span><b>Offline</b>${d ? ` Showing the board from ${ago(d._at || d.at)}.` : ' Connect to see the leaderboards.'}</span><button class="hdr-btn" data-lb="refresh">Retry</button></div>` : '';
  const empty = V.sub === 'warden' ? `No rated wardens yet. Ratings appear after ${WARDEN.prov} counted runs.` : V.sub === 'last' ? 'Last week\'s co-op board appears after the Monday reset.' : 'No co-op runs counted this week yet.';
  const list = d && d.top ? (d.top.length ? `<ol class="lb-list">${d.top.map(rowHTML).join('')}</ol>` : `<p class="lb-empty">${empty}</p>`) : '';
  const around = d && d.around && d.around.length ? `<div class="lb-sep"><span>Around you</span></div><ol class="lb-list">${d.around.map(rowHTML).join('')}</ol>` : '';
  const foot = d && d.of ? `<p class="lb-foot">${d.of} ranked${V.sub === 'warden' ? ` (${WARDEN.prov}+ runs)` : ''}${d.at ? ` - updated ${ago(d._at || d.at)}` : ''}</p>` : '';
  body.innerHTML = status + heroHTML(d) + list + around + foot;
  const me = d && d.me, inTop = !!(d && d.top && d.top.some((r) => r.me));
  if (pin) { pin.innerHTML = me && !inTop ? `<ol class="lb-list">${rowHTML({ ...me, me: true })}</ol>` : ''; pin.classList.toggle('hidden', !(me && !inTop)); }
  $$('#lb-tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.lbTab === 'coop'); b.setAttribute('aria-selected', b.dataset.lbTab === 'coop'); });
}
export async function load() {
  const k = V.sub, g = ++V.gen, id = identity();
  const cached = st.views[k] ? { ...st.views[k].d, _at: st.views[k].at } : null;
  paint(cached, 'loading');
  try {
    const q = new URLSearchParams({ board: k === 'warden' ? 'warden' : 'wseason', n: '50' });
    if (k === 'last') q.set('sid', 'last');
    if (id) q.set('cid', id.id);
    const r = await call((id ? '/lb/view?' : '/lb/top?') + q);
    if (r.status !== 200 || !r.body) throw new Error('bad');
    st.views[k] = { at: Date.now(), d: r.body };
    if (k === 'warden' && r.body.card) st.me = { at: Date.now(), d: { ...(st.me && st.me.d), warden: r.body.card } };
    writeSt();
    if (g === V.gen) paint(r.body, 'ok');
  } catch { if (g === V.gen) paint(cached, 'off'); }
}
const tap = () => { try { H.sfx && H.sfx.tap && H.sfx.tap(); } catch {} };
export function init(hooks) {
  H = { ...H, ...(hooks || {}) };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#s-ranks [data-wd-sub]'); if (!b) return;
    tap(); V.sub = b.dataset.wdSub; load();
  }, true);
  setTimeout(() => { prefetch(); if (identity() && !(st.me && Date.now() - st.me.at < 3600e3)) fetchMe().catch(() => {}); }, 5000);
  addEventListener('online', () => prefetch());
}

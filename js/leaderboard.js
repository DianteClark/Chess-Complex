// 17.0 (L2): Leaderboards screen (Season / Crown Rating / Daily), Daily Challenge submissions, and the rank lines on
// the results and profile screens. Talks to the Board routes (/lb/*, server/src/board.js) on the cloud endpoint
// (js/cloud.js endpoint()). Works offline: the last boards are kept in localStorage and shown with an "Offline" state;
// a finished Daily run waits in a small outbox until the cloud answers (while its day is still open).
//
// main.js wiring (small Edits, tagged 17.0 (L2)): init(hooks) once; go('ranks') -> open(); startSolo (daily) builds
// the match with js/daily.js dailySetup; results -> onResults(ctx) with GameHost.rec.actions (RP's recorder in net.js:
// every accepted action in order, bots included); profile -> decorateProfile().
import * as CL from './cloud.js';
import { pieceIcon } from './pieces.js';
import { protoVer } from './statehash.js';
import { dayKey } from './daily.js';

const KEY = 'cc_lb_v1', CLOUD_KEY = 'cc_cloud_v1';
const TABS = [['season', 'Season'], ['rating', 'Crown Rating'], ['daily', 'Daily']];
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let H = { profile: () => ({}), toast: () => {}, sfx: null };
const S = { tab: 'season', last: false, from: 'title', busy: 0, gen: 0 };

// ---------- storage ----------
function readLS(k) { try { const o = JSON.parse(localStorage.getItem(k) || 'null'); return o && typeof o === 'object' ? o : null; } catch { return null; } }
let st = readLS(KEY) || {};
if (!st.views || typeof st.views !== 'object') st.views = {};
if (!Array.isArray(st.out)) st.out = [];
const writeSt = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
export function identity() { const c = readLS(CLOUD_KEY); return c && /^[0-9A-Z]{10}$/i.test(c.id || '') && c.secret ? { id: String(c.id).toUpperCase(), secret: c.secret } : null; }
const today = () => dayKey();

// ---------- network ----------
async function endpoint() { try { const e = await CL.endpoint(); return e || null; } catch { return null; } }
async function call(path, opt = {}, ms = 5000) {
  const base = await endpoint(); if (!base) throw Object.assign(new Error('off'), { off: true });
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(base + path, { cache: 'no-store', ...opt, signal: ctl && ctl.signal });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } catch (e) { throw Object.assign(new Error('net'), { net: true }); } finally { clearTimeout(to); }
}
const viewKey = (tab, last) => tab + (tab === 'season' && last ? ':last' : tab === 'daily' ? ':' + today() : '');
async function fetchView(tab, last) {
  const id = identity();
  const q = new URLSearchParams({ board: tab, n: '50' });
  if (tab === 'daily') q.set('day', today());
  if (tab === 'season' && last) q.set('sid', 'last');
  if (id) q.set('cid', id.id);
  const r = await call((id ? '/lb/view?' : '/lb/top?') + q);
  if (r.status !== 200 || !r.body) throw Object.assign(new Error('bad'), { status: r.status });
  st.views[viewKey(tab, last)] = { at: Date.now(), d: r.body }; writeSt();
  return r.body;
}
export async function fetchMe() {
  const id = identity(); if (!id) return null;
  const r = await call(`/lb/me?cid=${id.id}&day=${encodeURIComponent(today())}`);
  if (r.status !== 200 || !r.body) return null;
  st.me = { at: Date.now(), d: r.body }; writeSt();
  return r.body;
}

// ---------- Daily submissions ----------
// The ranked attempt is registered when the run starts (POST /lb/daily/start): only the first registered run of the
// day is ranked, an abandoned one is a DNF, and a run that could not register (offline) is practice.
export function dailyStart() {
  const day = today(), id = identity(), p = H.profile() || {};
  const used = st.att && st.att.day === day;
  st.att = { day, ranked: false, why: used ? 'used' : 'offline' }; writeSt();
  if (used || !id) return Promise.resolve({ ranked: false, why: used ? 'used' : 'nocloud' });
  const body = { cid: id.id, day, name: p.name || 'Player', title: p.title || '', avatar: p.avatar && typeof p.avatar === 'object' ? { piece: p.avatar.piece, skin: p.avatar.skin || p.skin } : null };
  return call('/lb/daily/start', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + id.secret }, body: JSON.stringify(body) }, 6000)
    .then((r) => {
      const ok = r.status === 200 && r.body && r.body.ranked === true;
      st.att = { day, ranked: ok, why: ok ? '' : r.status === 200 ? 'used' : 'offline' }; writeSt();
      return { ranked: ok, why: st.att.why };
    }, () => ({ ranked: false, why: 'offline' }));
}
function queueDaily(log, result, att) {
  const id = identity(); const p = H.profile() || {};
  const run = { day: att.day || today(), at: Date.now(), cid: id ? id.id : null, name: p.name || 'Player', title: p.title || '', skin: p.skin || 'ivory', avatar: p.avatar && typeof p.avatar === 'object' ? { piece: p.avatar.piece, skin: p.avatar.skin || p.skin } : null, actions: JSON.parse(JSON.stringify(log)), score: result && result.score };
  if (!att.ranked || st.out.some((o) => o.day === run.day)) return { practice: true, why: att.why };
  st.out = [...st.out.filter((o) => o.day !== run.day), run].slice(-2); writeSt();
  return { queued: true };
}
// Status line for the Daily card on the Play screen, shown before the run starts.
export async function dailyNote(el) {
  if (!el) return;
  let n = el.querySelector('.lb-dnote'); if (!n) { n = document.createElement('p'); n.className = 'lb-dnote'; el.appendChild(n); }
  const set = (t, tone) => { n.textContent = t; n.dataset.tone = tone; };
  const day = today();
  const used = st.att && st.att.day === day;
  if (!identity()) return set('Cloud save is off: this run won\'t be ranked.', 'off');
  if (used) return set(st.att.why === 'offline' || st.att.why === 'nocloud' ? 'Practice: your first run today started offline, so it could not be ranked.' : 'Practice: your first run of the day already counted. A new Daily starts tomorrow.', 'mute');
  set('Your first run of the day counts. Quitting it counts as a DNF.', 'go');
  // the status request doubles as the reachability check (the cloud health result can be a minute old)
  let r = null; try { const id = identity(); r = await call(`/lb/daily/status?cid=${id.id}&day=${encodeURIComponent(day)}`, {}, 3000); } catch {}
  if (!r || r.status !== 200 || !r.body) return set('Offline: this run won\'t be ranked.', 'off');
  if (r.body.st && r.body.st !== 'none') { st.att = { day, ranked: false, why: 'used' }; writeSt(); set(`Practice: today's ranked run is ${r.body.st === 'ok' ? `in (#${r.body.rank}, ${r.body.score} pts)` : r.body.st === 'dnf' ? 'a DNF' : 'used'}.`, 'mute'); }
}
let flushing = null;
export function flushDaily() {
  if (flushing) return flushing;
  flushing = (async () => {
    const id = identity();
    for (const run of [...st.out]) {
      if (!id) break;
      try {
        const body = { cid: id.id, day: run.day, ver: protoVer(), name: run.name, title: run.title, skin: run.skin, avatar: run.avatar, actions: run.actions };
        const r = await call('/lb/daily', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + id.secret }, body: JSON.stringify(body) }, 12000);
        if (r.status === 202 || r.status === 409 || r.status === 400 || r.status === 413) {
          // answered: drop it from the outbox (409 = already ranked today, closed day or old version)
          st.out = st.out.filter((o) => o !== run && o.day !== run.day);
          if (r.status === 202 || (r.body && r.body.st)) st.ranked = run.day;
          st.dres = { day: run.day, st: r.status === 202 ? 'queued' : (r.body && r.body.st) || 'refused', why: r.body && r.body.why }; writeSt();
        } else if (r.status === 401) break; // cloud save not ready on this phone yet: keep it
      } catch { break; } // offline: keep it for later
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
async function dailyStatus(day, tries = 14) {
  const id = identity(); if (!id) return null;
  for (let i = 0; i < tries; i++) {
    try { const r = await call(`/lb/daily/status?cid=${id.id}&day=${encodeURIComponent(day)}`); if (r.body && r.body.st !== 'queued') return r.body; } catch { return null; }
    await new Promise((res) => setTimeout(res, 700 + i * 150));
  }
  return { st: 'queued' };
}

// ---------- results + profile ----------
// ctx: {daily: bool, log, result: {score, place}, online: bool}
export function onResults(ctx) {
  const box = $('#r-quests'); if (!box || !ctx) return;
  const old = $('#lb-res'); if (old) old.remove();
  if (!ctx.daily && !ctx.online) return;
  const row = document.createElement('div'); row.className = 'r-unlock lb-res'; row.id = 'lb-res';
  const set = (a, b, tone) => { row.innerHTML = `<span>${a}</span><b>${b}</b>`; row.dataset.tone = tone || ''; };
  const gen = ++S.gen;
  if (ctx.daily) {
    box.insertBefore(row, box.children[1] || null); // under the Daily score line
    set('Daily leaderboard', 'Checking your run...', 'wait');
    Promise.resolve(ctx.start || { ranked: false, why: 'offline' }).then((att) => {
      if (gen !== S.gen) return null;
      const q = Array.isArray(ctx.log) && ctx.log.length ? queueDaily(ctx.log.slice(), ctx.result, { ...att, day: (st.att && st.att.day) || today() }) : { practice: true, why: att.why };
      if (q.practice) { set('Practice run', q.why === 'used' ? 'Not ranked: your first run today counted' : q.why === 'nocloud' ? 'Not ranked: cloud save off' : 'Not ranked: offline at the start', 'mute'); return null; }
      return flushDaily();
    }).then(async (go) => {
      if (go === null || gen !== S.gen) return;
      if (st.out.some((o) => o.day === today())) { set('Daily leaderboard', 'Offline: sends when you reconnect', 'mute'); return; }
      const r = st.dres && st.dres.day === today() ? st.dres : null;
      if (r && r.st === 'refused') { set('Daily leaderboard', esc(r.why || 'Not ranked'), 'mute'); return; }
      const s = await dailyStatus(today());
      if (gen !== S.gen) return;
      if (!s) set('Daily leaderboard', 'Offline', 'mute');
      else if (s.st === 'ok') set(`Daily rank <em class="lb-score">${s.score} pts</em>`, `#${s.rank} of ${s.of}`, 'good');
      else if (s.st === 'rejected') set('Daily leaderboard', 'Run could not be verified', 'bad');
      else set('Daily leaderboard', 'Verifying...', 'wait');
    }).catch(() => { if (gen === S.gen) set('Daily leaderboard', 'Offline', 'mute'); }); // QC: no unhandled rejection on the results screen
    return;
  }
  if (!identity()) return;
  set('Crown Rating', 'Updating...', 'wait'); box.prepend(row);
  const before = st.me && st.me.d && st.me.d.rating ? st.me.d.rating.games : null;
  setTimeout(async () => {
    let me = null; try { me = await fetchMe(); } catch {}
    if (gen !== S.gen) return;
    if (!me || !me.rating) { row.remove(); return; } // QC: a 200 without a rating block must not throw in this timer
    const R = me.rating, d = before != null && R.games > before ? R.last : null;
    const delta = d != null ? ` <em class="lb-d ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${Math.round(d)}</em>` : '';
    set(`Crown Rating${delta}`, R.prov ? `${R.r} - provisional (${R.left} left)` : `${R.r} - #${R.rank} of ${R.of}`, 'good');
  }, 2200);
}
export function decorateProfile() {
  const body = $('#profile-body'); if (!body) return;
  let el = $('.lb-prof', body);
  if (!el) { el = document.createElement('div'); el.className = 'panel lb-prof'; const after = $('.pe-open', body) || $('.pf-hero', body); if (after) after.after(el); else body.prepend(el); }
  const paint = (me, off) => {
    const R = me && me.rating, Sx = me && me.season, D = me && me.daily;
    const cell = (k, v, sub) => `<div class="lb-pc"><small>${k}</small><b>${v}</b><span>${sub}</span></div>`;
    el.innerHTML = `<div class="lbl">Rankings ${off ? '<span class="pts lb-off-t">Offline</span>' : ''}</div><div class="lb-pcs">${
      cell('Crown Rating', R ? R.r : '-', R ? (R.prov ? `Provisional, ${R.left} to go` : `#${R.rank} of ${R.of}`) : identity() ? 'Play online' : 'Cloud save off')}${
      cell('Season', Sx && Sx.rank ? '#' + Sx.rank : '-', Sx ? `${Sx.pts} pts this week` : 'No games yet')}${
      cell('Daily', D && D.st === 'ok' ? '#' + D.rank : D && D.st === 'dnf' ? 'DNF' : '-', D && D.st === 'ok' ? `${D.score} pts today` : D && D.st === 'queued' ? 'Verifying' : D && D.st === 'dnf' ? 'Did not finish' : 'Not ranked today')}</div><button class="btn wide" data-go="ranks" data-lb-tab="season">View leaderboards</button>`;
  };
  paint(st.me && st.me.d, !navigator.onLine);
  if (identity()) fetchMe().then((me) => me && paint(me, false), () => paint(st.me && st.me.d, true));
}

// ---------- the screen ----------
function avatarImg(a, size = 40) {
  const [pc, sk] = String(a || '').split(':');
  try { return `<img src="${pieceIcon(pc || 'pawn', sk || 'ivory', null, size)}" alt="">`; } catch { return ''; }
}
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
const left = (t) => { const s = Math.max(0, (t - Date.now()) / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const fmtDay = (sid) => { try { return new Date(sid + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return sid; } };
const unit = (tab) => (tab === 'rating' ? '' : 'pts');
function rowHTML(r, tab) {
  const medal = r.rank <= 3 ? ` m${r.rank}` : '';
  const sub = tab === 'daily' && r.place ? `Placed ${r.place}${r.kills ? `, ${r.kills} KO` : ''}` : r.title ? esc(r.title) : r.games != null ? `${r.games} game${r.games === 1 ? '' : 's'}` : '';
  if (r.dnf) return `<li class="lb-row dnf${r.me ? ' me' : ''}"><span class="lb-rk">DNF</span><span class="lb-av">${avatarImg(r.avatar)}</span><span class="lb-nm"><b>${esc(r.name)}${r.me ? ' <i>You</i>' : ''}</b><em>Did not finish</em></span><span class="lb-v">-</span></li>`;
  return `<li class="lb-row${r.me ? ' me' : ''}${medal}"><span class="lb-rk">${r.rank}</span><span class="lb-av">${avatarImg(r.avatar)}</span><span class="lb-nm"><b>${esc(r.name)}${r.me ? ' <i>You</i>' : ''}</b><em>${sub}</em></span><span class="lb-v">${r.v}<small>${unit(tab)}</small></span></li>`;
}
function heroHTML(tab, d, me) {
  const id = identity();
  if (tab === 'season') {
    const pts = me ? me.v : 0, rank = me ? `#${me.rank}` : '-';
    const when = S.last ? (d && d.sid ? `Week of ${fmtDay(d.sid)} - final standings` : 'No finished season yet') : d && d.ends ? `Week of ${fmtDay(d.sid)} - ends in ${left(d.ends)}` : 'This week';
    return `<div class="lb-hero"><div class="lb-big"><small>${S.last ? 'Last week' : 'Your season'}</small><b>${rank}</b><span>${pts} pts</span></div><div class="lb-hi"><p>${when}</p><div class="seg small lb-wk"><button class="${S.last ? '' : 'on'}" data-lb-last="0">This week</button><button class="${S.last ? 'on' : ''}" data-lb-last="1">Last week</button></div></div></div>`;
  }
  if (tab === 'rating') {
    const c = d && d.card;
    const big = c ? c.r : '-', sub = !id ? 'Cloud save off' : !c ? '' : c.prov ? `Provisional: ${c.left} more game${c.left === 1 ? '' : 's'}` : `#${c.rank} of ${c.of} - peak ${c.peak}`;
    const dl = c && c.games && c.last ? `<em class="lb-d ${c.last >= 0 ? 'up' : 'down'}">${c.last >= 0 ? '+' : ''}${Math.round(c.last)} last match</em>` : '';
    return `<div class="lb-hero"><div class="lb-big crown"><small>Crown Rating</small><b>${big}</b><span>${sub}</span></div><div class="lb-hi"><p>Online Royale, Blitz, Duel and Squads with 2 or more cloud-saved players. You gain for every player you finish above.</p>${dl}</div></div>`;
  }
  const c = d && d.card;
  const big = c && c.st === 'ok' ? '#' + c.rank : c && c.st === 'dnf' ? 'DNF' : '-';
  const sub = !id ? 'Cloud save off' : !c || c.st === 'none' ? 'Not played today' : c.st === 'ok' ? `${c.score} pts - placed ${c.place}` : c.st === 'queued' ? 'Verifying your run' : c.st === 'started' ? 'Run in progress' : c.st === 'dnf' ? 'DNF - did not finish' : 'Run could not be verified';
  const play = !c || c.st === 'none' ? '<button class="btn gold lb-play" data-lb="play-daily">Play today\'s challenge</button>' : '';
  return `<div class="lb-hero"><div class="lb-big sun"><small>Today's Daily</small><b>${big}</b><span>${sub}</span></div><div class="lb-hi"><p><b class="lb-rule">Your first run of the day counts.</b> Same location, same build, seven Hard bots. Quit it and it is a DNF; later runs are practice. The server replays every run to check it.</p>${play}</div></div>`;
}
function emptyHTML(tab) {
  const t = tab === 'season' ? (S.last ? 'Last week\'s board appears after the Monday reset.' : 'No ranked players this week yet. Online matches with 2 or more cloud-saved players score season points.') : tab === 'rating' ? 'No rated players yet. Ratings appear after 10 online matches.' : 'Nobody has a verified run today. Be the first.';
  return `<p class="lb-empty">${t}</p>`;
}
function paint(tab, d, state) {
  const body = $('#lb-body'), pin = $('#lb-pin'); if (!body) return;
  const me = d && d.me;
  const status = state === 'loading' && !d ? '<div class="lb-state">Loading...</div>'
    : state === 'off' ? `<div class="lb-state off" role="status"><svg><use href="#m-link"/></svg><span><b>Offline</b>${d ? ` Showing the board from ${ago(d._at || d.at)}.` : ' Connect to see the leaderboards.'}</span><button class="hdr-btn" data-lb="refresh">Retry</button></div>` : '';
  const list = d && d.top ? (d.top.length ? `<ol class="lb-list">${d.top.map((r) => rowHTML(r, tab)).join('')}</ol>` : emptyHTML(tab)) : '';
  const around = d && d.around && d.around.length ? `<div class="lb-sep"><span>Around you</span></div><ol class="lb-list">${d.around.map((r) => rowHTML(r, tab)).join('')}</ol>` : '';
  const foot = d && d.of ? `<p class="lb-foot">${d.of} ranked${d.dnf ? `, ${d.dnf} DNF` : ''}${tab === 'rating' ? ' (10+ games)' : ''}${d.at ? ` - updated ${ago(d._at || d.at)}` : ''}</p>` : '';
  body.innerHTML = status + heroHTML(tab, d, me) + list + around + foot;
  // the player's own row stays pinned at the bottom when it is not already in view
  const inTop = !!(d && d.top && d.top.some((r) => r.me));
  if (pin) { pin.innerHTML = me && !inTop ? `<ol class="lb-list">${rowHTML({ ...me, me: true }, tab)}</ol>` : ''; pin.classList.toggle('hidden', !(me && !inTop)); }
  $$('#lb-tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.lbTab === tab); b.setAttribute('aria-selected', b.dataset.lbTab === tab); });
}
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
async function load(tab = S.tab) {
  S.tab = tab; const k = viewKey(tab, S.last), gen = ++S.gen;
  const cached = st.views[k] ? { ...st.views[k].d, _at: st.views[k].at } : null;
  paint(tab, cached, 'loading');
  try { const d = await fetchView(tab, S.last); if (gen === S.gen) paint(tab, d, 'ok'); }
  catch { if (gen === S.gen) paint(tab, cached, 'off'); }
}
export function open(tab) {
  const scr = $('#s-ranks'); if (!scr) return;
  if (!$('#lb-tabs button')) $('#lb-tabs').innerHTML = TABS.map(([k, n]) => `<button role="tab" data-lb-tab="${k}">${n}</button>`).join('');
  const back = $('.back', scr); if (back) back.dataset.go = S.from || 'title';
  if (st.out.length) flushDaily();
  load(tab || S.tab);
}
const tap = () => { try { H.sfx && H.sfx.tap && H.sfx.tap(); } catch {} };
export function init(hooks) {
  H = { ...H, ...(hooks || {}) };
  // remember where the screen was opened from, so Back returns there; tabs, week toggle, retry, play daily
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go="ranks"]');
    if (g) { const scr = g.closest('.screen'); S.from = scr && scr.id !== 's-ranks' ? scr.id.slice(2) : 'title'; if (g.dataset.lbTab) S.tab = g.dataset.lbTab; return; }
    const b = e.target.closest('#s-ranks [data-lb-tab], #s-ranks [data-lb-last], #s-ranks [data-lb]'); if (!b) return;
    if (b.dataset.lbTab) { tap(); S.last = false; load(b.dataset.lbTab); }
    else if (b.dataset.lbLast != null) { tap(); S.last = b.dataset.lbLast === '1'; load('season'); }
    else if (b.dataset.lb === 'refresh') { tap(); load(); }
    else if (b.dataset.lb === 'play-daily' && H.playDaily) { tap(); H.playDaily(); }
  }, true);
  addEventListener('online', () => { if (st.out.length) flushDaily(); });
  if (st.out.length) setTimeout(() => flushDaily(), 4000);
  // drop outbox runs whose day has closed (the server accepts a day for about 24 h after it ends)
  st.out = st.out.filter((o) => Date.now() - (o.at || 0) < 40 * 3600e3); writeSt();
}

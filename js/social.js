// 18.0 "Rivals" (SO): Friends screen, Recent Players, player tags, presence, party invites, blocks, Appear Offline.
// Server: server/src/social.js (Player DO). This module keeps ONE WebSocket "friends link" to the player's own Player
// DO while the game is open (that is what "Online" means to friends). The server answers the {"t":"hb"} pings without
// waking up, and pushes invites, friend requests and friends' presence changes the moment they happen; the friends list
// (one request to the player's own DO, whatever the friend count) is refreshed at most every 30 s, and only while the
// Friends screen is open. Cloud only: with no cloud save (or the
// server down) the screen says so, and Recent Players still works from the save.
//
// Recent Players: the last 30 online opponents / teammates, recorded when a cloud match starts (lobby seats carry the
// public tag of every verified player) and kept in profile.recent, so the cloud save carries it to other phones.
import * as CL from './cloud.js';
import { MODES } from './data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mName = (id) => (MODES[id] || {}).name || 'a match';
export const fmtTag = (t) => (t && t.length === 8 ? t.slice(0, 4) + '-' + t.slice(4) : t || '');
const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>';
const RECENT_MAX = 30, LIST_EVERY = 30000, HB = 25000, INV_TTL = 600000;

let D = null; // deps from main.js: session(), screen(), go(n), join(code), endSession(), toast(m), sfx, profile(), save(), host()
const S = {
  ws: null, ok: false, me: null, n: { inv: 0, req: 0 }, inv: [], list: null, listAt: 0, err: null, tab: 'friends', from: 'title',
  q: new Map(), qn: 0, back: 0, retryT: null, hbT: null, lastRx: 0, timer: null, lastMid: null, pend: new Set(), more: null, busy: new Set(), sent: {},
};
let rowExtra = null; // LV: fn(friend) -> HTML (e.g. a Watch button next to a friend in a match)
export const setRowExtra = (fn) => { rowExtra = typeof fn === 'function' ? fn : null; if (D && D.screen() === 'friends') render(); };

function cred() {
  try { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || 'null'); if (o && typeof o.id === 'string' && typeof o.secret === 'string' && o.id && o.secret) return { id: o.id, secret: o.secret }; } catch {}
  return null;
}
const recent = () => { const p = D.profile(); if (!Array.isArray(p.recent)) p.recent = []; return p.recent; };
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
const hue = (t) => { let h = 0; for (const c of String(t || '?')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const av = (name, tag) => `<span class="so-av" style="--h:${hue(tag || name)}" aria-hidden="true">${esc(String(name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;

// ---------------------------------------------------------------- link
function connect() {
  const c = cred(), ep = CL.endpoint();
  if (!c || !ep || S.ws || document.hidden) return;
  clearTimeout(S.retryT);
  let ws; try { ws = new WebSocket(ep.replace(/^http/, 'ws') + '/social/ws/' + c.id); } catch { return retry(); }
  S.ws = ws; S.ok = false;
  ws.onopen = () => { try { ws.send(JSON.stringify({ t: 'auth', s: c.secret })); } catch {} };
  ws.onmessage = (e) => { S.lastRx = Date.now(); let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = (e) => {
    if (S.ws !== ws) return;
    S.ws = null; S.ok = false; clearInterval(S.hbT);
    for (const [, f] of S.q) f({ ok: false, why: 'offline' }); S.q.clear();
    if (e && e.code === 4001) { S.err = 'auth'; return; } // secret reset on another phone: cloudsave.js handles that
    retry();
  };
  ws.onerror = () => {};
  clearInterval(S.hbT);
  S.hbT = setInterval(() => {
    if (S.ws !== ws) return clearInterval(S.hbT);
    if (S.ok && Date.now() - S.lastRx > HB * 2.5) { try { ws.close(); } catch {} S.ws = null; S.ok = false; retry(); return; } // dead link (phone slept, network switch)
    try { ws.send('{"t":"hb"}'); } catch {}
  }, HB);
}
function retry() {
  clearTimeout(S.retryT);
  if (document.hidden) return;
  const ms = [3000, 6000, 12000, 30000, 60000][Math.min(4, S.back++)];
  S.retryT = setTimeout(connect, ms);
}
function onMsg(m) {
  if (m.t === 'hb') return;
  if (m.t === 'me') { const again = !!S.list; S.ok = true; S.back = 0; S.err = null; S.me = { tag: m.tag, hidden: !!m.hidden }; S.inv = m.inv || []; badge(m.n); if (again) refresh(true); else paint(); return; } // a relink may have missed pushes: resync
  if (m.t === 'r') { const f = S.q.get(m.q); if (f) { S.q.delete(m.q); f(m); } return; }
  if (m.t === 'bye') { S.err = m.why === 'auth' ? 'auth' : null; return; }
  if (m.n) badge(m.n);
  if (m.t === 'inv' && m.inv) { S.inv = [m.inv, ...S.inv.filter((x) => x.tag !== m.inv.tag)]; invited(m.inv); paint(); }
  else if (m.t === 'req') { if (S.list) S.list.req = [{ tag: m.tag, name: m.name, at: Date.now() }, ...S.list.req.filter((x) => x.tag !== m.tag)]; if (D.screen() !== 'game') D.toast(`${m.name} sent you a friend request`); paint(); }
  else if (m.t === 'pres') { // a friend's presence changed (pushed by their DO through mine): update the row in place
    const f = S.list && S.list.friends.find((x) => x.tag === m.tag);
    if (f) { Object.assign(f, { st: m.st, mode: m.mode || null, room: m.room || null, seen: m.seen || 0 }); if (m.name) f.name = m.name; paint(); }
  }
  else if (m.t === 'friend') { D.toast(`${m.name} is now your friend`); refresh(true); }
  else if (m.t === 'drop') { if (S.list) { for (const k of ['friends', 'req', 'out']) S.list[k] = S.list[k].filter((x) => x.tag !== m.tag); } S.inv = S.inv.filter((x) => x.tag !== m.tag); paint(); }
}
// one op: over the link when it is up, else HTTPS (same answers)
function op(name, args = {}) {
  const c = cred(), ep = CL.endpoint();
  if (!c || !ep) return Promise.resolve({ ok: false, why: 'offline' });
  if (S.ws && S.ok) {
    return new Promise((res) => {
      const q = 'q' + (++S.qn); S.q.set(q, res);
      try { S.ws.send(JSON.stringify({ t: 'op', q, op: name, ...args })); } catch { S.q.delete(q); res({ ok: false, why: 'offline' }); }
      setTimeout(() => { if (S.q.has(q)) { S.q.delete(q); res({ ok: false, why: 'offline' }); } }, 8000);
    });
  }
  connect();
  return fetch(ep + '/social/' + c.id, { method: 'POST', headers: { Authorization: 'Bearer ' + c.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: name, ...args }) })
    .then((r) => r.json()).catch(() => ({ ok: false, why: 'offline' }));
}

// ---------------------------------------------------------------- badge + invite pop-up
function badge(n) {
  if (n) S.n = { inv: n.inv | 0, req: n.req | 0 };
  const k = S.n.inv + S.n.req;
  document.querySelectorAll('.so-badge').forEach((b) => { b.textContent = k ? String(Math.min(k, 9)) : ''; });
}
function invited(inv) {
  D.sfx.select && D.sfx.select();
  if (D.screen() === 'game') { D.toast(`${inv.name} invited you to ${mName(inv.mode)}. Open Friends after this match.`); return; }
  const el = $('#so-pop'); if (!el) return;
  el.innerHTML = `${av(inv.name, inv.tag)}<div class="so-pop-t"><b>${esc(inv.name)}</b><span>invited you to ${esc(mName(inv.mode))}</span></div><button class="btn small" data-so="inv-later" data-tag="${esc(inv.tag)}">Later</button><button class="btn small gold" data-so="inv-join" data-tag="${esc(inv.tag)}">Join</button>`;
  el.classList.remove('hidden'); el.classList.add('show');
  clearTimeout(invited.t); invited.t = setTimeout(hidePop, 12000);
}
function hidePop() { const el = $('#so-pop'); if (el) { el.classList.remove('show'); el.classList.add('hidden'); } }

// ---------------------------------------------------------------- actions
async function refresh(force) {
  if (!force && Date.now() - S.listAt < LIST_EVERY - 500) return;
  S.listAt = Date.now();
  const r = await op('list');
  if (r && r.ok) { S.list = r; S.me = { tag: r.tag, hidden: !!r.hidden }; S.inv = r.inv || []; S.err = null; badge(r.n); }
  else if (!S.list) S.err = (r && r.why) || 'offline';
  paint();
}
async function act(name, args, done) {
  const key = name + ':' + (args.tag || '');
  if (S.busy.has(key)) return null;
  S.busy.add(key); paint();
  const r = await op(name, args);
  S.busy.delete(key);
  if (!r || !r.ok) { D.toast(r && r.why && r.why !== 'offline' ? r.why : 'Can\'t reach the online server. Try again.'); D.sfx.error && D.sfx.error(); }
  else if (done) done(r);
  paint();
  return r;
}
function addTag(tag, name) {
  return act('add', { tag }, (r) => {
    D.sfx.select && D.sfx.select();
    D.toast(r.st === 'friend' ? `You and ${r.name || name || 'they'} are now friends` : `Friend request sent${name ? ' to ' + name : ''}`);
    refresh(true);
  });
}
function inParty() {
  const s = D.session();
  return s && s.cloud && s.code && s.myPid && s.lobbyMsg && !(s.lobbyMsg.party && s.lobbyMsg.party.live) ? s : null;
}
function invite(tag, name) {
  const s = inParty();
  if (!s) {
    const g = D.session(); if (g && D.screen() === 'game') { D.toast('Finish this match first.'); return; }
    S.pend.add(tag); D.toast(`Opening a party for ${name || 'your friend'}...`); D.host(); return; // the invite goes out once the room has a code (lobby())
  }
  act('invite', { tag, room: s.code, mode: s.lobbyMsg.mode }, () => { S.sent[tag] = Date.now(); D.toast(`Invite sent to ${name || 'your friend'}`); });
}
async function answer(tag, join) {
  hidePop();
  const s = D.session();
  if (join && s && D.screen() === 'game' && D.live && D.live()) { D.toast('Finish this match first.'); return; }
  const r = await act('answer', { tag, join: !!join }, () => {});
  S.inv = S.inv.filter((x) => x.tag !== tag); paint();
  if (r && r.ok && join && r.room) { D.sfx.select && D.sfx.select(); D.join(r.room); }
}

// ---------------------------------------------------------------- screen
export function mount(deps) {
  D = deps;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-so]'); if (!b) return;
    const a = b.dataset.so, tag = b.dataset.tag || '', name = b.dataset.name || '';
    if (a === 'open') { D.sfx.tap && D.sfx.tap(); S.from = D.screen() === 'friends' ? S.from : D.screen(); D.go('friends'); }
    else if (a === 'back') { D.sfx.back && D.sfx.back(); D.go(['play', 'host', 'join', 'title'].includes(S.from) ? S.from : 'title'); }
    else if (a === 'refresh') { D.sfx.tap && D.sfx.tap(); refresh(true); }
    else if (a === 'tab') { S.tab = b.dataset.v; S.more = null; D.sfx.tap && D.sfx.tap(); render(); }
    else if (a === 'copy') { const t = fmtTag(S.me && S.me.tag); if (t) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => D.toast('Tag copied'), () => D.toast(t)); D.sfx.select && D.sfx.select(); } }
    else if (a === 'hide') { const on = !(S.me && S.me.hidden); act('hide', { on }, (r) => { S.me = { ...(S.me || {}), hidden: !!r.hidden }; if (S.list) S.list.hidden = !!r.hidden; D.toast(r.hidden ? 'You appear offline to friends' : 'Friends can see when you are online'); }); }
    else if (a === 'add') { const i = $('#so-add-in'); const v = (i && i.value || '').trim(); if (!v) { i && i.focus(); return; } addTag(v).then((r) => { if (r && r.ok && i) i.value = ''; }); }
    else if (a === 'add-tag') addTag(tag, name);
    else if (a === 'accept') act('accept', { tag }, () => { D.toast(`You and ${name || 'they'} are now friends`); refresh(true); });
    else if (a === 'decline' || a === 'cancel') act(a === 'cancel' ? 'remove' : 'decline', { tag }, () => { if (S.list) { S.list.req = S.list.req.filter((x) => x.tag !== tag); S.list.out = S.list.out.filter((x) => x.tag !== tag); } badgeFromList(); });
    else if (a === 'more') { S.more = S.more === tag ? null : tag; D.sfx.tap && D.sfx.tap(); render(); }
    else if (a === 'remove') act('remove', { tag }, () => { S.more = null; if (S.list) S.list.friends = S.list.friends.filter((x) => x.tag !== tag); D.toast(`Removed ${name || 'friend'}`); });
    else if (a === 'block') { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to block'; return; } act('block', { tag, name }, () => { S.more = null; D.toast(`Blocked ${name || 'player'}. They can't see you or invite you.`); refresh(true); }); }
    else if (a === 'unblock') act('unblock', { tag }, () => { if (S.list) S.list.blocked = S.list.blocked.filter((x) => x.tag !== tag); D.toast(`Unblocked ${name || 'player'}`); });
    else if (a === 'invite') invite(tag, name);
    else if (a === 'watch') { if (typeof window.ccWatch === 'function') { D.sfx.select && D.sfx.select(); window.ccWatch(tag); } }
    else if (a === 'inv-join') answer(tag, true);
    else if (a === 'inv-later') { hidePop(); D.sfx.tap && D.sfx.tap(); }
    else if (a === 'inv-no') answer(tag, false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'so-add-in') { e.preventDefault(); const b = $('[data-so="add"]'); if (b) b.click(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) return; S.back = 0; connect(); if (D.screen() === 'friends') refresh(); });
  addEventListener('online', () => { S.back = 0; connect(); });
  addEventListener('storage', (e) => { if (e.key === 'cc_cloud_v1' && !S.ws) connect(); });
  // the cloud save creates the player id a moment after the first launch: try the link a few times early on
  for (const ms of [1500, 6000, 20000]) setTimeout(() => { if (!S.ws) connect(); }, ms);
  badge();
}
function badgeFromList() { if (S.list) { S.n = { inv: S.inv.length, req: S.list.req.length }; badge(); } }
export function onScreen(name) {
  clearInterval(S.timer); S.timer = null;
  if (name !== 'friends') { S.more = null; return; }
  connect(); render(); refresh(true);
  S.timer = setInterval(() => { if (D.screen() === 'friends' && !document.hidden) refresh(); }, LIST_EVERY);
}
// main.js cloudLobby: record Recent Players when a match starts, send invites waiting for this party's code
export function lobby(sess, m) {
  if (!sess || !m) return;
  const live = !!(m.party && m.party.live);
  if (live && sess.mid && sess.mid !== S.lastMid && Array.isArray(m.players)) {
    S.lastMid = sess.mid;
    const list = recent(), now = Date.now();
    let changed = false;
    for (const p of m.players) {
      if (!p || p.isBot || p.pid === sess.myPid) continue;
      const name = String(p.name || 'Player').slice(0, 14), tag = typeof p.tag === 'string' && /^[0-9A-Z]{8}$/.test(p.tag) ? p.tag : null;
      const i = list.findIndex((x) => (tag ? x.tag === tag : !x.tag && x.name === name));
      if (i >= 0) list.splice(i, 1);
      list.unshift({ tag, name, mode: m.mode || null, at: now }); changed = true;
    }
    if (changed) { list.length = Math.min(list.length, RECENT_MAX); D.save(); }
  }
  if (!live && S.pend.size && sess.code && sess.myPid) {
    const tags = [...S.pend]; S.pend.clear();
    for (const tag of tags) { const f = S.list && S.list.friends.find((x) => x.tag === tag); act('invite', { tag, room: sess.code, mode: m.mode }, () => { S.sent[tag] = Date.now(); D.toast(`Invite sent to ${f ? f.name : 'your friend'}`); }); }
  }
}

function paint() { if (D && D.screen() === 'friends') render(); }
const stLine = (f) => {
  const t = f.st === 'match' ? 'In a match' + (f.mode ? ' &middot; ' + esc(mName(f.mode)) : '') : f.st === 'lobby' ? 'In a lobby' + (f.mode ? ' &middot; ' + esc(mName(f.mode)) : '') : f.st === 'online' ? 'Online' : f.seen ? 'Seen ' + ago(f.seen) : 'Offline';
  return `<i class="so-dot ${f.st === 'online' ? 'on' : f.st === 'match' || f.st === 'lobby' ? f.st : ''}"></i><em>${t}</em>`;
};
const btn = (a, label, o = {}) => `<button class="btn small ${o.cls || ''}" data-so="${a}" data-tag="${esc(o.tag || '')}" data-name="${esc(o.name || '')}"${o.dis ? ' disabled' : ''}${o.aria ? ` aria-label="${esc(o.aria)}"` : ''}>${label}</button>`;
function render() {
  const body = $('#so-body'), tabs = $('#so-tabs'); if (!body || !tabs) return;
  const L = S.list, nReq = L ? L.req.length : S.n.req;
  tabs.innerHTML = [['friends', 'Friends', S.n.inv + nReq], ['recent', 'Recent', 0], ['blocked', 'Blocked', 0]]
    .map(([v, t, k]) => `<button class="${S.tab === v ? 'on' : ''}" data-so="tab" data-v="${v}" role="tab" aria-selected="${S.tab === v}">${t}${k ? ` <i class="so-n">${k}</i>` : ''}</button>`).join('');
  const c = cred();
  if (!c || !CL.endpoint()) { body.innerHTML = offline(!c ? 'Your player tag is created with your cloud save. Open Settings > Transfer Code to set it up, then come back.' : 'Friends need the online server. Check your connection.') + (S.tab === 'recent' ? recentHTML() : ''); return; }
  if (S.tab === 'recent') { body.innerHTML = recentHTML(); return; }
  if (S.tab === 'blocked') { body.innerHTML = blockedHTML(); return; }
  body.innerHTML = meHTML() + invHTML() + reqHTML() + friendsHTML() + outHTML();
}
function offline(msg) { return `<div class="panel so-empty"><b>Friends are offline</b><p>${esc(msg)}</p></div>`; }
function meHTML() {
  const tag = S.me && S.me.tag, hidden = !!(S.me && S.me.hidden), party = inParty();
  return `<div class="panel so-me">
    <div class="so-me-top"><div class="so-me-tag"><span class="lbl">Your player tag</span><b>${tag ? esc(fmtTag(tag)) : '<span class="so-wait">Connecting...</span>'}</b></div>${btn('copy', 'Copy', { dis: !tag })}</div>
    <div class="so-add"><input id="so-add-in" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="Friend's tag, e.g. ABCD-1234" aria-label="Friend's player tag">${btn('add', 'Add', { cls: 'gold', dis: S.busy.has('add:') })}</div>
    <div class="so-me-foot"><button class="mm-switch so-switch${hidden ? ' on' : ''}" data-so="hide" role="switch" aria-checked="${hidden}"><i aria-hidden="true"></i><span>Appear offline</span></button><p>${party ? `Party ${esc(party.code)} is open: tap Invite to bring friends in.` : 'Invite opens a party and sends your friend the code.'}</p></div>
  </div>`;
}
function invHTML() {
  const list = S.inv.filter((x) => (x.left == null || x.at + INV_TTL > Date.now()));
  if (!list.length) return '';
  return `<div class="lbl so-h">Party invites</div><ul class="so-list">${list.map((x) => `<li class="so-row inv">${av(x.name, x.tag)}<div class="so-who"><b>${esc(x.name)}</b><span>invited you to ${esc(mName(x.mode))} &middot; ${ago(x.at)}</span></div><div class="so-acts">${btn('inv-no', 'Dismiss', { tag: x.tag })}${btn('inv-join', 'Join', { tag: x.tag, cls: 'gold' })}</div></li>`).join('')}</ul>`;
}
function reqHTML() {
  const L = S.list; if (!L || !L.req.length) return '';
  return `<div class="lbl so-h">Friend requests</div><ul class="so-list">${L.req.map((x) => `<li class="so-row">${av(x.name, x.tag)}<div class="so-who"><b>${esc(x.name)}</b><span>${esc(fmtTag(x.tag))}</span></div><div class="so-acts">${btn('decline', 'Decline', { tag: x.tag, name: x.name })}${btn('accept', 'Accept', { tag: x.tag, name: x.name, cls: 'gold' })}</div></li>`).join('')}</ul>`;
}
function friendsHTML() {
  const L = S.list;
  if (!L) return `<div class="panel so-empty">${S.err ? `<b>Can't reach the online server</b><p>Your friends list will load when you're back online.</p>${btn('refresh', 'Try Again')}` : '<p><span class="so-wait">Loading friends...</span></p>'}</div>`;
  const on = L.friends.filter((f) => f.st !== 'offline' && f.st !== 'unknown').length;
  const head = `<div class="lbl so-h">Friends <span class="pts">${on} online &middot; ${L.friends.length}</span></div>`;
  if (!L.friends.length) return head + '<div class="panel so-empty"><b>No friends yet</b><p>Share your tag, or open Recent to add players you just met.</p></div>';
  return head + `<ul class="so-list">${L.friends.map((f) => {
    const sent = S.sent[f.tag] && Date.now() - S.sent[f.tag] < 15000, open = S.more === f.tag;
    const extra = rowExtra ? (() => { try { return rowExtra(f) || ''; } catch { return ''; } })() : f.st === 'match' && f.room && typeof window.ccWatch === 'function' ? btn('watch', 'Watch', { tag: f.room, name: f.name, cls: 'so-watch' }) : ''; // LV's spectator
    return `<li class="so-row so-${f.st}${open ? ' open' : ''}" data-tag="${esc(f.tag)}">${av(f.name, f.tag)}<div class="so-who"><b>${esc(f.name)}</b><span class="so-st">${stLine(f)}</span></div><div class="so-acts">${extra}${btn('invite', sent ? 'Sent' : 'Invite', { tag: f.tag, name: f.name, cls: 'so-inv', dis: sent || S.busy.has('invite:' + f.tag) })}${btn('more', DOTS, { tag: f.tag, cls: 'so-more', aria: 'More for ' + f.name })}</div>
      ${open ? `<div class="so-menu"><span>${esc(fmtTag(f.tag))}</span>${btn('remove', 'Remove', { tag: f.tag, name: f.name })}${btn('block', 'Block', { tag: f.tag, name: f.name, cls: 'danger' })}</div>` : ''}</li>`;
  }).join('')}</ul>`;
}
function outHTML() {
  const L = S.list; if (!L || !L.out.length) return '';
  return `<div class="lbl so-h">Requests sent</div><ul class="so-list">${L.out.map((x) => `<li class="so-row out">${av(x.name, x.tag)}<div class="so-who"><b>${esc(x.name === 'Player' ? fmtTag(x.tag) : x.name)}</b><span>Waiting for them to add you back</span></div><div class="so-acts">${btn('cancel', 'Cancel', { tag: x.tag, name: x.name })}</div></li>`).join('')}</ul>`;
}
function relOf(tag) {
  const L = S.list; if (!L || !tag) return null;
  if (L.friends.some((x) => x.tag === tag)) return 'friend';
  if (L.out.some((x) => x.tag === tag)) return 'out';
  if (L.req.some((x) => x.tag === tag)) return 'in';
  if (L.blocked.some((x) => x.tag === tag)) return 'block';
  return null;
}
function recentHTML() {
  const list = recent();
  if (!list.length) return '<div class="panel so-empty"><b>No recent players</b><p>People you play online with show up here, so you can add them as friends.</p></div>';
  const mine = S.me && S.me.tag;
  return `<div class="lbl so-h">Played with recently <span class="pts">${list.length}</span></div><ul class="so-list">${list.map((x) => {
    const rel = relOf(x.tag), open = S.more === 'r:' + (x.tag || x.name);
    let acts;
    if (!x.tag) acts = '<span class="so-note">No player tag</span>';
    else if (x.tag === mine) acts = '<span class="so-note">You</span>';
    else if (rel === 'friend') acts = '<span class="so-note ok">Friend</span>';
    else if (rel === 'out') acts = '<span class="so-note">Requested</span>';
    else if (rel === 'block') acts = '<span class="so-note">Blocked</span>';
    else if (rel === 'in') acts = btn('accept', 'Accept', { tag: x.tag, name: x.name, cls: 'gold' });
    else acts = btn('add-tag', 'Add', { tag: x.tag, name: x.name, cls: 'gold', dis: S.busy.has('add:' + x.tag) });
    const more = x.tag && x.tag !== mine && rel !== 'block' ? btn('more', DOTS, { tag: 'r:' + x.tag, cls: 'so-more', aria: 'More for ' + x.name }) : '';
    return `<li class="so-row${open ? ' open' : ''}">${av(x.name, x.tag || x.name)}<div class="so-who"><b>${esc(x.name)}</b><span>${x.mode ? esc(mName(x.mode)) + ' &middot; ' : ''}${ago(x.at)}</span></div><div class="so-acts">${acts}${more}</div>
      ${open ? `<div class="so-menu"><span>${esc(fmtTag(x.tag))}</span>${btn('block', 'Block', { tag: x.tag, name: x.name, cls: 'danger' })}</div>` : ''}</li>`;
  }).join('')}</ul>`;
}
function blockedHTML() {
  const L = S.list;
  if (!L) return '<div class="panel so-empty"><p><span class="so-wait">Loading...</span></p></div>';
  if (!L.blocked.length) return '<div class="panel so-empty"><b>Nobody blocked</b><p>Blocked players can\'t see when you\'re online, send you friend requests or invite you.</p></div>';
  return `<div class="lbl so-h">Blocked <span class="pts">${L.blocked.length}</span></div><ul class="so-list">${L.blocked.map((x) => `<li class="so-row">${av(x.name, x.tag)}<div class="so-who"><b>${esc(x.name)}</b><span>${esc(fmtTag(x.tag))}</span></div><div class="so-acts">${btn('unblock', 'Unblock', { tag: x.tag, name: x.name })}</div></li>`).join('')}</ul>`;
}
// tests / debugging
export const _state = S;

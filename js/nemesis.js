// Chess Complex 18.0 "Rivals" (NE): Nemesis, client side.
// Your Nemesis is whoever eliminated you most recently: online a person (by nid, the public hash of their verified cloud
// id, js/rivals.js), solo a bot (by name; startSolo brings that bot back). The engine rule (js/engine.js 18.0 (NE)) runs
// from createMatch opts.nemesis, so every screen and the server agree. This module keeps the rivalry in the profile,
// builds the solo map, says what the Room / host needs at join, and draws the UI: lobby card + tags, the in-match
// crown-of-thorns marker over your Nemesis's name tag (render.js drawTags hook), callouts through the Director,
// the results line (+Marks) and the profile panel.
import { nemesisOf, huntersOf, unitById } from './engine.js';
import { MODES } from './data.js';
import { nidOf, cleanNem } from './rivals.js';
import * as RK from './ranks.js';
import { director } from './announcer.js';

export const NEM_MARKS = { vendetta: 40, thorn: 15 };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let H = null, myNid = null;
const P = () => (H && H.profile ? H.profile() : null);
export function init(hooks) {
  H = hooks;
  refreshNid();
}
// my own public nid (peer-to-peer hosts match on it; the cloud Room computes it from the verified cid itself)
export function refreshNid() { let c = null; try { c = JSON.parse(localStorage.getItem('cc_cloud_v1') || 'null'); } catch {} if (c && c.id) nidOf(String(c.id)).then((n) => { myNid = n; }); }
export const mine = () => { if (!myNid) refreshNid(); return myNid; };

// ---------- profile state ----------
// p.nem = { cur: {k:'nid'|'bot', id, name, n, at} | null, prey: [{k, id, name, at}] (newest first, max 4) }
// counters live in p.stats (vendetta, thorn, nemBest) so the cloud merge keeps the max.
export function ensure(p) {
  if (!p) return { cur: null, prey: [] };
  if (!p.nem || typeof p.nem !== 'object') p.nem = { cur: null, prey: [] };
  const okId = (x) => x && typeof x === 'object' && (x.k === 'nid' || x.k === 'bot') && typeof x.id === 'string' && x.id;
  if (!okId(p.nem.cur)) p.nem.cur = null;
  p.nem.prey = Array.isArray(p.nem.prey) ? p.nem.prey.filter(okId).slice(0, 4) : [];
  if (p.nem.cur) p.nem.cur.n = Math.max(1, Math.min(99, Math.floor(+p.nem.cur.n) || 1));
  p.stats = p.stats || {};
  return p.nem;
}
// the join message's nem field (online + peer-to-peer hello): {nid, n} | {bot, n} | null
export function helloNem() {
  const c = ensure(P()).cur; if (!c) return null;
  return cleanNem(c.k === 'nid' ? { nid: c.id, n: c.n } : { bot: c.name || c.id, n: c.n });
}
const pvp = (mode) => { const M = MODES[mode]; return !!M && !M.siege && mode !== 'daily' && mode !== 'siege'; };

// ---------- solo: bring your Nemesis bot back (and the last bot you beat, who now hunts you) ----------
// players[0] is 'me'; bots are renamed in place before createMatch, so the map is part of the start args.
export function soloSetup(players, mode) {
  const p = P(); if (!p || !pvp(mode) || players.length < 2) return null;
  const st = ensure(p), bots = players.filter((q) => q.isBot), out = {};
  const used = new Set(players.map((q) => q.name));
  const take = (name, avoid) => {
    let b = bots.find((q) => q.name === name);
    if (!b) { b = bots.find((q) => !avoid.includes(q.pid)); if (!b) return null; used.delete(b.name); b.name = name; used.add(name); }
    return b;
  };
  const taken = [];
  if (st.cur && st.cur.k === 'bot') { const b = take(st.cur.id, taken); if (b) { out.me = { pid: b.pid, n: st.cur.n }; taken.push(b.pid); } }
  const prey = st.prey.find((x) => x.k === 'bot' && !(st.cur && st.cur.k === 'bot' && st.cur.id === x.id));
  if (prey && bots.length >= 2) { const b = take(prey.id, taken); if (b && !taken.includes(b.pid)) { out[b.pid] = { pid: 'me', n: 1 }; taken.push(b.pid); } }
  return Object.keys(out).length ? out : null;
}
// peer-to-peer host: the seats it knows -> opts.nemesis (members' nid/nem come from their join message)
export function hostMap(players, nemMapFn) {
  const seats = players.map((q) => (q.pid === 'me' ? { pid: 'me', name: q.name, nid: myNid, nem: helloNem() } : { pid: q.pid, isBot: !!q.isBot, name: q.name, nid: q.nid || null, nem: q.isBot ? null : q.nem }));
  return nemMapFn(seats);
}

// ---------- identity of a unit (for the profile) ----------
function seatOf(sess, pid) { const L = (sess && (sess.lobby || sess.players)) || []; return L.find((q) => q && q.pid === pid) || null; }
function idOf(sess, u) {
  if (!u || u.kind !== 'player') return null;
  const seat = seatOf(sess, u.pid);
  if (sess && sess.mode === 'solo') return u.pid === 'me' ? null : { k: 'bot', id: u.name, name: u.name };
  if (seat && seat.nid) return { k: 'nid', id: seat.nid, name: u.name };
  if ((seat && seat.isBot) || (!seat && u.bot)) return { k: 'bot', id: u.name, name: u.name };
  return null; // an unverified person: no stable identity to keep
}
const same = (a, b) => !!a && !!b && a.k === b.k && a.id === b.id;

// ---------- lobby ----------
// per card: rank badge + Nemesis / Hunting-you tag. Cards come from lobbyHTML (main.js).
export function cardTags(p) {
  if (!p) return '';
  const st = ensure(P());
  const isNem = st.cur && ((st.cur.k === 'nid' && p.nid === st.cur.id) || (st.cur.k === 'bot' && p.isBot && p.name === st.cur.id));
  return `${RK.badge(p.rk || (p.pid === 'me' ? RK.myRk() : null), 15)}${isNem ? `<span class="nem18-tag" title="Your Nemesis${st.cur.n > 1 ? ' x' + st.cur.n : ''}" aria-label="Your Nemesis"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${THORN_PATH}"/></svg></span>` : ''}`;
}
// the card above the seats when your Nemesis is in the lobby
export function lobbyCard(players) {
  const st = ensure(P()); if (!st.cur || !Array.isArray(players)) return '';
  const p = players.find((q) => (st.cur.k === 'nid' ? q.nid === st.cur.id : q.isBot && q.name === st.cur.id));
  if (!p) return '';
  return `<div class="nem18-card" role="note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${THORN_PATH}"/></svg><div><b>Your Nemesis is in this match</b><span>${esc(p.name)} took you down last time${st.cur.n > 1 ? ` (${st.cur.n} in a row)` : ''}. Eliminate them for a Vendetta: +1 shard, +${NEM_MARKS.vendetta} Marks.</span></div></div>`;
}

// ---------- in match ----------
const THORN_PATH = 'M3 15.5l2.2-6.8 2.6 4.1L9.9 5l2.1 6.4L14.1 5l2.1 7.8 2.6-4.1 2.2 6.8c-2.4 1.4-5.6 2.1-9 2.1s-6.6-.7-9-2.1zM4.2 17.6c2.3 1 4.9 1.5 7.8 1.5s5.5-.5 7.8-1.5l-.6 2.2c-2.1.8-4.5 1.2-7.2 1.2s-5.1-.4-7.2-1.2z';
let RKMAP = new Map(); // pid -> {r, p?} of the last match (results board)
export const rkBadge = (pid) => RK.badge(RKMAP.get(pid), 14);
let M = null; // this match: {myId, nemId, hunters:Set, rk: Map(pid -> rk), killer, events, said}
export function start(g, sess, s, myId) {
  M = { myId, said: false, killer: null, vend: false, thorn: [], again: null, rk: (RKMAP = new Map()), sess };
  for (const u of s.units) if (u.kind === 'player') { const seat = seatOf(sess, u.pid); const rk = seat && seat.rk ? seat.rk : u.pid === (sess && sess.myPid) && sess && sess.cloud ? RK.myRk() : null; if (rk) M.rk.set(u.pid, rk); }
  if (g && g.r) { g.r.tagHook = tagHook; }
}
function ids(s) {
  const me = M && unitById(s, M.myId), n = me ? nemesisOf(s, me) : null;
  return { me, nem: n, hunters: me ? huntersOf(s, me).filter((u) => u.alive) : [] };
}
// render.js drawTags: after the King crown, before the turn arrow. Returns the new top y.
function tagHook(ctx, L, u, ty, T, box) {
  const s = this.state; if (!s || !M) return ty;
  const rk = M.rk.get(u.pid);
  if (rk && box) RK.drawGem(ctx, box.x - 9, box.y, 15, rk);
  const e = s.nemesis && M.myId != null ? s.nemesis[(unitById(s, M.myId) || {}).pid] : null;
  if (e && e.pid === u.pid && u.alive && !e.paid) {
    const z = this.z || 40, cs = Math.max(16, Math.min(24, z * 0.42)), bob = this.reduced ? 0 : Math.sin(T * 2.4) * 1.4;
    ctx.save(); ctx.translate(L.sx - cs / 2, ty - cs + bob); ctx.scale(cs / 24, cs / 24);
    const p = new Path2D(THORN_PATH);
    ctx.lineJoin = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(12,4,8,0.9)'; ctx.stroke(p);
    ctx.fillStyle = '#ff3b4f'; ctx.fill(p);
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(T * 4); ctx.fillStyle = '#ffd0d6'; ctx.fillRect(3, 15.5, 18, 1.2);
    ctx.restore();
    ty -= cs + 2;
  }
  return ty;
}
const say = (g, o, ms) => g.after(() => director.say(o), ms);
export function events(g, ev, s, myId) {
  if (!M || !ev || !ev.length || !s) return;
  M.myId = myId;
  const { me, nem, hunters } = ids(s);
  // the first turn after the intro: who is after whom
  if (!M.said && ev.some((e) => e.e === 'turn')) {
    M.said = true;
    const e = me && s.nemesis && s.nemesis[me.pid];
    if (nem && e) say(g, { text: 'Your Nemesis', sub: nem.name, subHtml: `<b style="color:${nem.color}">${esc(nem.name)}</b>${e.n > 1 ? ` <span class="nem18-x">x${e.n}</span>` : ''}`, kicker: 'Vendetta: +1 shard', color: '#ff4d5e', tier: 2, prio: 62, key: 'nem-start', ttl: 3800, level: 3 }, 1400);
    else if (hunters.length) g.after(() => g.feed(`<span class="nem18-ln"><svg viewBox="0 0 24 24"><path d="${THORN_PATH}"/></svg><b>${esc(hunters[0].name)}</b> wants revenge. Outlast them: Thorn in their side.</span>`, 'nem-hunt'), 1600);
  }
  for (const e of ev) {
    if (e.e === 'death' && e.id === myId && e.by != null) { const k = unitById(s, e.by); M.killer = k && k.kind === 'player' && k.id !== myId ? k : null; }
    if (e.e === 'death' && e.by === myId && e.id !== myId) { const id = idOf(M.sess, unitById(s, e.id)); if (id) (M.killed ||= []).unshift(id); }
    if (e.e === 'vendetta') {
      const k = unitById(s, e.id), v = unitById(s, e.of); if (!k || !v) continue;
      if (e.id === myId) { M.vend = true; say(g, { text: 'Vendetta', sub: v.name, subHtml: `You took down <b style="color:${v.color}">${esc(v.name)}</b>`, kicker: 'Nemesis defeated', tags: ['+1 shard', `+${NEM_MARKS.vendetta} Marks`], color: '#ff4d5e', tier: 3, prio: 84, key: 'vendetta', ttl: 4200, level: 4, haptic: [30, 40, 30, 40, 90] }, 500); }
      else g.after(() => g.feed(`<span class="nem18-ln"><b>${esc(k.name)}</b> settled a Vendetta on <b>${esc(v.name)}</b></span>`, 'vend' + e.id, 'log'), 500);
    }
    if (e.e === 'nemesis') {
      const k = unitById(s, e.id), v = unitById(s, e.of); if (!k || !v) continue;
      if (e.of === myId) { M.again = e.n; say(g, { text: `Nemesis x${e.n}`, sub: k.name, subHtml: `<b style="color:${k.color}">${esc(k.name)}</b> got you again`, kicker: 'The rivalry grows', color: '#ff4d5e', tier: 2, prio: 74, key: 'nem-again', ttl: 3600, level: 3 }, 700); }
      else g.after(() => g.feed(`<span class="nem18-ln"><b>${esc(k.name)}</b> is <b>${esc(v.name)}</b>'s Nemesis x${e.n}</span>`, 'nemx' + e.of, 'log'), 600);
    }
    if (e.e === 'thorn' && e.id === myId) { const v = unitById(s, e.of); if (v) { M.thorn.push(v.name); g.after(() => g.feed(`<span class="nem18-ln"><svg viewBox="0 0 24 24"><path d="${THORN_PATH}"/></svg>Thorn in their side: you outlived <b>${esc(v.name)}</b> <em>+${NEM_MARKS.thorn} Marks</em></span>`, 'thorn' + e.of), 700); } }
  }
}

// ---------- results: update the rivalry, pay the Marks, one line on the results card ----------
// returns {marks, html}
export function results(sess, s, u) {
  const p = P(); if (!p || !M || !s || !u || (sess && (sess.mode === 'tutorial' || sess.replay))) return { marks: 0, html: '' };
  const st = ensure(p), st0 = st.cur ? { ...st.cur } : null;
  let marks = 0; const lines = [];
  if (M.vend) { marks += NEM_MARKS.vendetta; p.stats.vendetta = (p.stats.vendetta || 0) + 1; lines.push(`<span>Vendetta on <b>${esc(st0 ? st0.name : 'your Nemesis')}</b></span><b>+${NEM_MARKS.vendetta}</b>`); }
  if (M.thorn.length) { const n = NEM_MARKS.thorn * M.thorn.length; marks += n; p.stats.thorn = (p.stats.thorn || 0) + M.thorn.length; lines.push(`<span>Thorn in their side: outlived <b>${esc(M.thorn.join(', '))}</b></span><b>+${n}</b>`); }
  // prey: everyone I eliminated this match (the last one first)
  const killed = (M.killed || []);
  for (const pr of killed) { st.prey = [pr, ...st.prey.filter((x) => !same(x, pr))].slice(0, 4); }
  const kid = M.killer ? idOf(sess, M.killer) : null;
  if (kid) {
    const n = st.cur && same(st.cur, kid) ? st.cur.n + 1 : 1;
    st.cur = { ...kid, n, at: Date.now() };
    p.stats.nemBest = Math.max(p.stats.nemBest || 0, n);
    lines.push(`<span>${n > 1 ? `<b>${esc(kid.name)}</b> is your Nemesis x${n}` : `New Nemesis: <b>${esc(kid.name)}</b>`}</span><b class="nem18-r">Next time</b>`);
  } else if (M.vend) { st.cur = null; lines.push('<span>Rivalry settled. You have no Nemesis.</span><b></b>'); }
  M = null;
  return { marks, html: lines.map((l, i) => `<div class="r-unlock nem18-res" style="animation-delay:${1 + i * 0.12}s">${l}</div>`).join('') };
}
// ---------- profile ----------
export function decorateProfile() {
  const body = document.querySelector('#profile-body'); if (!body) return;
  const p = P(); if (!p) return;
  const st = ensure(p), S = p.stats || {};
  let el = body.querySelector('.nem18-prof');
  if (!el) { el = document.createElement('div'); el.className = 'panel nem18-prof'; const after = body.querySelector('.lb-prof') || body.querySelector('.pe-open') || body.querySelector('.pf-hero'); if (after) after.after(el); else body.prepend(el); }
  const cell = (k, v, sub) => `<div class="lb-pc"><small>${k}</small><b>${v}</b><span>${sub}</span></div>`;
  const rw = (Array.isArray(p.seasonRewards) ? p.seasonRewards : []).slice(-3).reverse();
  el.innerHTML = `<div class="lbl">Rivals</div>`
    + `<div class="nem18-who${st.cur ? ' on' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${THORN_PATH}"/></svg><div><small>Your Nemesis</small><b>${st.cur ? esc(st.cur.name || st.cur.id) : 'Nobody'}</b><span>${st.cur ? `Eliminated you ${st.cur.n > 1 ? st.cur.n + ' times in a row' : 'last time'}${st.cur.k === 'bot' ? ' (bot)' : ''}` : 'Whoever eliminates you next becomes your Nemesis.'}</span></div></div>`
    + `<div class="lb-pcs">${cell('Vendettas', S.vendetta || 0, 'Nemeses defeated')}${cell('Thorns', S.thorn || 0, 'Hunters outlived')}${cell('Longest', S.nemBest || 0, 'Nemesis streak')}</div>`
    + (rw.length ? `<div class="nem18-rw">${rw.map((r) => `<span class="nem18-rwi bn-${esc(r.banner)}"><b>${esc(r.title)}</b><small>#${r.rank} - week of ${esc(r.sid)}</small></span>`).join('')}</div>` : '')
    + `<div class="lbl nem18-sub">Crown Rating tiers</div>${RK.ladderHTML(RK.myRk())}`;
}

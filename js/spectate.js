// 18.0 (LV): live spectating. Watch a match that is being played right now in a cloud Room, read-only.
// The link is a cloud.js room link opened with {watch:true}: the Room admits it as a spectator (no seat, capped at 8 per
// room) and sends the lockstep stream (start + snapshot, then every action / hash / clock / seat change). cloud.js
// replays it with the engine exactly like a player's link, and every state goes to game.onMsg, so the board, camera
// director, announcer, feed and music run unchanged. The session looks like the replay viewer's (session.mode 'replay',
// body.replaying: no menu, emotes, timer or rewards) plus body.watching: the spectator bar (follow a player with the
// arrows, LIVE + how many are watching, Replay once the match is saved, Leave).
//
// Entry points: Browse (matchmaking.js "Watch" on live public matches), ?watch=CODE, and for the Friends screen (SO):
//   import { watch } from './spectate.js';  watch(code, { name, back })  -> Promise<boolean> (true once the board shows)
//   window.ccWatch(code, o) is the same function. A room can be watched while its match is live; anything else answers
//   false with a toast ("That match has ended", "Too many people are watching", ...).
import * as CL from './cloud.js';
import * as RP from './replay.js';

const $ = (q) => document.querySelector(q);
let X = null; // mount context from main.js: game, toast, sfx(name), begin(sess), end(screen), screen()
let V = null; // the live watch

export function mount(ctx) {
  X = ctx;
  const bar = $('#spec-bar');
  if (bar && !$('#sv-ctl')) {
    const el = document.createElement('div');
    el.className = 'sv-ctl'; el.id = 'sv-ctl'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Live match');
    el.innerHTML = '<span class="sv-live" id="sv-live">Live</span><small class="sv-n" id="sv-n" aria-live="polite"></small><button class="btn small hidden" data-sv="replay">Replay</button><button class="btn small" data-sv="leave">Leave</button>';
    bar.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sv]'); if (!b || !V) return;
      if (b.dataset.sv === 'leave') leave();
      else if (b.dataset.sv === 'replay' && V.replayId) { const id = V.replayId; X.sfx('select'); stop(); RP.openId(id); }
    });
  }
  addEventListener('keydown', (e) => { if (V && e.key === 'Escape' && !(X.game && X.game.potmOn)) leave(); });
  window.ccWatch = watch;
  // Friends (SO's js/social.js): a Watch button on a friend row whose match is live (row {tag, name, st, mode, room})
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-sv-watch]'); if (!b) return; X.sfx('select'); watch(b.dataset.svWatch, { name: b.dataset.name || null, back: 'friends' }); });
  import('./social.js').then((S) => {
    if (typeof S.setRowExtra !== 'function') return;
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    S.setRowExtra((f) => (f && f.st === 'match' && typeof f.room === 'string' && /^[A-Z0-9]{5}$/.test(f.room) ? `<button class="btn small" data-sv-watch="${f.room}" data-name="${esc(f.name || '')}" aria-label="Watch ${esc(f.name || 'friend')}'s match">Watch</button>` : ''));
  }).catch(() => {});
}
export const active = () => !!V;
const G = () => X.game;

export async function watch(code, o = {}) {
  if (!X) return false;
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { X.toast('That match code is not valid'); return false; }
  if (V && V.code === code && V.entered) return true;
  if (V) stop();
  if (!CL.endpoint()) { X.toast('Watching needs the online server'); return false; }
  const up = await CL.healthy();
  if (!up) { X.toast("Can't reach the online server right now"); return false; }
  X.toast(o.name ? `Joining ${o.name}'s match as a spectator...` : 'Joining the match as a spectator...');
  return new Promise((res) => {
    const W = V = { code, name: o.name || null, back: o.back || null, n: 0, entered: false, first: false, mid: null, over: false, replayId: null, res, done: false };
    window.__ccWatch = W; // tests
    const finish = (ok) => { if (!W.done) { W.done = true; res(ok); } };
    W.finish = finish;
    W.client = CL.openRoom(code, {
      watch: true,
      onOpen: () => {},
      onData: (m) => { if (V === W) onData(W, m); },
      onDrop: () => { if (V === W && W.entered) X.toast('Connection lost. Reconnecting...'); },
      onClose: () => { if (V !== W) return; X.toast('Lost the connection to the match'); finish(false); leave(true); },
      onError: (why) => { if (V !== W) return; V = null; finish(false); X.toast(why === 'peer-unavailable' ? 'That match has ended' : "Can't reach that match"); },
    });
    setTimeout(() => { if (V === W && !W.entered) { X.toast("That match didn't answer. Try again."); stop(); finish(false); } }, 15000);
  });
}

function onData(W, m) {
  switch (m.t) {
    case 'welcome': W.n = m.w || W.n; ui(); return;
    case 'spec': W.n = m.n | 0; ui(); return;
    case 'start': if (!W.entered || (m.mid && m.mid !== W.mid)) enter(W, m); return;
    case 'state':
      if (!W.entered) return;
      G().onMsg(m);
      if (W.first) { W.first = false; G().startSpectate(); W.finish(true); }
      return;
    case 'chat': case 'emote': if (W.entered) G().onMsg(m); return;
    case 'replay': if (typeof m.id === 'string' && (!m.mid || m.mid === W.mid)) { W.replayId = m.id.slice(0, 8); ui(); } return;
    case 'bye': {
      const why = m.why || m.reason;
      const msg = { nolive: 'That match has ended', watchfull: 'Too many people are watching this match. Try again later.', closed: 'The match room has closed', noroom: 'That match has ended', update: 'Updating the game...' }[why] || 'Stopped watching';
      X.toast(msg); W.finish(false);
      if (why === 'update') return; // cloud.js reloads the page
      if (W.entered && W.over) { try { W.client.close(); } catch {} W.client = null; ui(); return; } // keep the final board up
      leave(true);
      return;
    }
    default: // h / dl / seat / lobby / over: cloud.js already applied what matters; the board shows it
  }
}

function enter(W, m) {
  W.mid = m.mid || null; W.entered = true; W.first = true; W.over = false; W.replayId = null;
  const sess = {
    mode: 'replay', watch: true, code: W.code, myPid: '__watch', noPart: true, client: W.client,
    replay: { over: () => onOver(W) }, host: { go() {}, stop() {} }, send() {}, emote() {}, chat() {},
  };
  { const cur = X.session && X.session(); if (cur && cur.watch) cur.client = null; } // the next match in the same room: keep our link open
  X.begin(sess); // ends any other session, then game.enter()
  document.body.classList.add('replaying', 'watching');
  ui();
}

function onOver(W) {
  if (V !== W) return;
  W.over = true; ui();
  const s = G().s, w = s && s.winner != null && s.units.find((u) => u.id === s.winner);
  X.toast(w ? `Match over - ${w.name} wins` : 'Match over');
}

function ui() {
  const W = V; if (!W) return;
  const live = $('#sv-live'), n = $('#sv-n'), rp = $('#sv-ctl [data-sv="replay"]');
  if (live) { live.textContent = W.over ? 'Ended' : 'Live'; live.classList.toggle('off', !!W.over); }
  if (n) n.textContent = W.n > 0 ? `${W.n} watching` : '';
  if (rp) rp.classList.toggle('hidden', !(W.over && W.replayId));
}

// stop watching; the caller decides where to go (leave() goes back)
function stop() {
  const W = V; if (!W) return;
  V = null; window.__ccWatch = null;
  try { W.client && W.client.close(); } catch {}
  document.body.classList.remove('watching');
  if (!RP.active()) document.body.classList.remove('replaying');
  W.finish && W.finish(false);
}
export function leave(quiet) {
  const W = V; if (!W) return;
  if (!quiet) X.sfx('tap');
  stop();
  try { const u = new URL(location.href); if (u.searchParams.has('watch')) { u.searchParams.delete('watch'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } } catch {}
  if (W.entered) X.end(W.back || 'title');
}

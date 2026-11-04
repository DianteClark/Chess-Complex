// 17.0 (RP): match replays. A replay is the deterministic match record ({start:{players, seed, opts},
// actions:[[pid, a], ...]}): createMatch + applyAction reproduce every state, so the viewer plays it through the
// normal game screen exactly like the cloud lockstep client does (js/cloud.js): each applied action is fed to
// game.onMsg({t:'state', state, ev, dl}) so the renderer, camera director, announcer, feed and music run unchanged.
// The viewer is a spectator session (session.mode 'replay', no seat, no input to the match, no rewards):
// play / pause, 1x / 2x / 4x, jump to round N (re-simulated from the start), restart, Play of the Match, exit.
// Sources: GET <cloud>/replay/:id (?replay=ID links; online matches are saved by the Room's match-end hook), or the
// local record of a solo / phone-hosted match (net.js GameHost.rec), uploaded on Share (POST /replay, unverified).
import { createMatch, applyAction, introEvents, unitById } from './engine.js';
import { stateHash } from './statehash.js';
import * as CL from './cloud.js';

const $ = (q) => document.querySelector(q);
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const SPEEDS = [1, 2, 4];
const GAP = { step: 320, turn: 520 }; // ms between fed actions at 1x (bots on the server: 480 / 520)
let X = null; // mount context from main.js
let P = null; // the live viewer

export function mount(ctx) {
  X = ctx;
  // 1x / 2x / 4x / pause: scale the camera director's pace (it drives the renderer's timeline clock and the camera
  // glides together), so the frame's real dt (auto quality, springs) stays honest. Inert outside a replay.
  const cd = ctx.game.r && ctx.game.r.cd;
  if (cd && !cd._rpWrap) {
    const orig = cd.pace; cd._rpWrap = true;
    cd.pace = function (back, dt) {
      const m = X.game.rpSpeed;
      if (m == null) { if (this._rpBase != null) { this.speed = this._rpBase; this._rpBase = null; } return orig.call(this, back, dt); }
      if (this._rpBase != null) this.speed = this._rpBase;
      const k = orig.call(this, back, dt); this._rpBase = k; this.speed = k * m; return this.speed;
    };
  }
  $('#btn-rp-share').addEventListener('click', () => share());
  $('#btn-rp-watch').addEventListener('click', () => watchLocal());
  const bar = $('#rp-ctl');
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rp]'); if (!b || !P) return;
    const k = b.dataset.rp;
    if (k === 'play') toggle();
    else if (k === 'speed') { P.speed = SPEEDS[(SPEEDS.indexOf(P.speed) + 1) % SPEEDS.length]; applySpeed(); ui(); X.sfx('tap'); }
    else if (k === 'restart') { X.sfx('tap'); seekRound(1, true); }
    else if (k === 'prev') { X.sfx('tap'); seekRound(Math.max(1, curRound() - 1)); }
    else if (k === 'next') { X.sfx('tap'); seekRound(Math.min(P.lastRound, curRound() + 1)); }
    else if (k === 'potm') potm();
    else if (k === 'exit') exit();
  });
  const rg = $('#rp-round');
  rg.addEventListener('input', () => { if (P) $('#rp-rlabel').textContent = `Round ${rg.value} / ${P.lastRound}`; });
  rg.addEventListener('change', () => { if (P) seekRound(+rg.value); });
  addEventListener('keydown', (e) => {
    if (!P || e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && !G().potmOn) exit();
  });
}
const G = () => X.game;
export const active = () => !!P;

// ---------- records ----------
// The local record of the match on screen (solo, or this phone hosted it), in the server's record shape.
export function localRecord(sess, s) {
  const h = sess && sess.host, R = h && h.rec;
  if (!R || !R.actions || !R.actions.length || !h.s) return null;
  const ps = h.s.units.filter((u) => u.kind === 'player');
  const rec = { start: { players: R.players, seed: R.seed, opts: R.opts }, actions: R.actions.slice(), mode: h.s.mode, location: h.s.location || undefined, src: sess.mode };
  if (R.end) {
    rec.hash = stateHash(h.s);
    rec.result = { winner: h.s.winner, rounds: h.s.round, places: ps.map((u) => ({ pid: u.pid, name: u.name, place: u.alive ? 1 : u.place || 0 })) };
  }
  return rec;
}
const linkFor = (id) => {
  const c = new URLSearchParams(location.search).get('cloud');
  return `${location.origin}${location.pathname}?replay=${id}${c ? '&cloud=' + encodeURIComponent(c) : ''}`;
};
const base = () => { const e = CL.endpoint && CL.endpoint(); return e || location.origin; };

// Results screen: Share Replay (a cloud match id, or the local record) and Watch Replay (local record).
export function results(sess, s) {
  const row = $('#rp-row'); if (!row) return;
  const local = !!(sess && sess.host && sess.host.rec && sess.host.rec.actions.length);
  const id = sess && sess.replayId;
  // the same-origin cloud probe can still be pending or have timed out on a slow launch: offer Share unless cloud is off
  const off = /[?&](cloud=off|net=local)/.test(location.search);
  const canShare = !!(id || (local && !off));
  const canWatch = !!(local && sess.mode === 'solo') || !!id && sess.mode === 'solo';
  $('#btn-rp-share').classList.toggle('hidden', !canShare);
  $('#btn-rp-watch').classList.toggle('hidden', !canWatch);
  row.classList.toggle('hidden', !canShare && !canWatch);
}

async function upload(rec) {
  const body = JSON.stringify(rec);
  if (body.length > 200 * 1024) throw new Error('That match is too long to share');
  let res; try { res = await fetch(base() + '/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); } catch { throw new Error('Could not reach the server. Check your connection.'); }
  if (res.status === 429) throw new Error('Too many shares - try again later');
  if (!res.ok) throw new Error(res.status === 404 || res.status === 405 ? 'Replays need the cloud server' : 'Could not save the replay');
  const j = await res.json(); if (!j || !ID_RE.test(j.id)) throw new Error('Could not save the replay');
  return j.id;
}

let sharing = false;
export async function share(sess0) {
  const sess = sess0 || X.session(); if (!sess || sharing) return;
  sharing = true; const btn = $('#btn-rp-share'); btn.disabled = true;
  try {
    let id = sess.replayId;
    if (!id) {
      const rec = localRecord(sess, G().s); if (!rec) throw new Error('No replay for this match');
      X.toast('Saving replay...');
      id = await upload(rec); sess.replayId = id;
    }
    const url = linkFor(id);
    if (navigator.share) {
      try { await navigator.share({ title: 'Chess Complex replay', text: 'Watch this Chess Complex match', url }); X.sfx('select'); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    X.copy(url, 'Replay link copied');
  } catch (e) { X.toast((e && e.message) || 'Could not share the replay'); X.sfx('error'); }
  finally { sharing = false; btn.disabled = false; }
}

function watchLocal() {
  const sess = X.session();
  const rec = localRecord(sess, G().s);
  if (rec) { X.sfx('select'); play(rec, { id: sess.replayId || null, verified: true, local: true }); return; }
  if (sess && sess.replayId) openId(sess.replayId);
}

export async function openId(raw) {
  const id = String(raw || '').toUpperCase().slice(0, 8);
  if (!ID_RE.test(id)) { X.toast('That replay link is not valid'); return false; }
  X.toast('Loading replay...');
  try {
    const res = await fetch(base() + '/replay/' + id, { cache: 'no-store' });
    if (res.status === 404) { X.toast('That replay has expired or does not exist'); return false; }
    if (!res.ok) throw new Error('http ' + res.status);
    const j = await res.json();
    if (!j || !j.rec) throw new Error('empty');
    return play(j.rec, { id, verified: !!j.verified });
  } catch { X.toast('Could not load the replay. Check your connection.'); return false; }
}

// ---------- simulation ----------
const fresh = (rec) => createMatch(structuredClone(rec.start.players), rec.start.seed, structuredClone(rec.start.opts || {}));
// Run the record from the start to action index `to` (exclusive). Returns {s, i, ok}.
function simTo(rec, to) {
  const s = fresh(rec); let i = 0;
  for (; i < to && i < rec.actions.length; i++) { const [pid, a] = rec.actions[i]; if (!applyAction(s, pid, a).ok) return { s, i, ok: false }; }
  return { s, i, ok: true };
}
// One pass over the whole match: where each round starts, how far the record replays cleanly, the final hash, and
// the Play of the Match (main.js scoreMoment scoring, the same pick a live client makes).
function analyse(rec) {
  const s = fresh(rec), acts = rec.actions, rounds = { [s.round]: 0 }, sc = { best: null };
  let n = acts.length, bestAt = -1, broken = false;
  for (let i = 0; i < acts.length; i++) {
    if (rounds[s.round] == null) rounds[s.round] = i;
    const r = applyAction(s, acts[i][0], acts[i][1]);
    if (!r.ok) { n = i; broken = true; break; }
    const was = sc.best;
    try { G().scoreMoment.call(sc, true, s, r.ev); } catch {}
    if (sc.best !== was) { bestAt = i; sc.best = { ...sc.best, prev: null, next: null, ev: null }; }
  }
  if (rounds[s.round] == null) rounds[s.round] = n;
  const hash = stateHash(s);
  return { n, rounds, lastRound: Math.max(...Object.keys(rounds).map(Number)), broken, hash, hashOk: rec.hash == null ? null : (rec.hash >>> 0) === hash, best: sc.best, bestAt, final: s };
}

// ---------- viewer ----------
export function play(rec, meta = {}) {
  if (!rec || !rec.start || !Array.isArray(rec.actions)) { X.toast('That replay is damaged'); return false; }
  rec = { ...rec, actions: rec.actions.map((x) => [x[0] == null ? undefined : x[0], x[1], x[2] === 1 ? 1 : 0]) }; // Hollows have no pid (null after JSON); 3rd = turn timeout
  let A;
  const t0 = performance.now();
  try { A = analyse(rec); } catch (e) { console.error(e); X.toast('That replay is damaged'); return false; }
  stop(true);
  P = { rec, meta, ...A, s: null, i: 0, playing: true, speed: 1, lastFeed: 0, hold: false, ended: false, timer: null, simMs: performance.now() - t0, seeks: [] };
  window.__ccReplay = P; // tests
  document.body.classList.add('replaying');
  start(0, true);
  P.timer = setInterval(tick, 40);
  $('#rp-ctl').classList.remove('hidden');
  const pc = $('#m-potm [data-act="potm-close"]'); if (pc) { pc.dataset.rpLabel = pc.dataset.rpLabel || pc.textContent; pc.textContent = 'Back to Watching'; }
  if (A.broken) X.toast('This replay was recorded on another game version and ends early');
  ui();
  return true;
}

// (Re)start the game screen at action index `idx` (0 = the very start, with the match intro).
function start(idx, intro) {
  const sim = simTo(P.rec, idx);
  P.s = sim.s; P.i = sim.i; P.ended = false; P.hold = !!intro && P.s.v === 0;
  const R = P;
  const sess = { mode: 'replay', myPid: '__replay', replay: { over: () => onOver(R) }, host: { go: () => { if (P === R) { R.hold = false; R.lastFeed = performance.now(); } }, stop() {} }, send() {}, emote() {}, chat() {} };
  X.begin(sess);
  applySpeed();
  G().onMsg({ t: 'state', state: structuredClone(P.s), ev: P.s.v === 0 && !P.s.tutorial ? introEvents(P.s) : [], dl: -1 });
  G().startSpectate();
  // the intro calls session.host.go() when "Round 1" plays; a fallback in case it never runs
  if (P.hold) { const ms = (G().introDelay ? G().introDelay(P.s, false) : 0) + 1500; setTimeout(() => { if (P === R && R.hold) { R.hold = false; R.lastFeed = performance.now(); } }, ms); }
  P.lastFeed = performance.now();
  ui();
}

function tick() {
  if (!P || !P.playing || P.hold || P.ended) return;
  const g = G(); if (!g.s || g.potmOn) return;
  if (P.i >= P.n) { if (!P.ended) { P.ended = true; if (P.broken || !P.s.over) onOver(P); } return; }
  if (g.r && g.r.backlog && g.r.backlog() > 0.05) return;
  const [pid, a, to] = P.rec.actions[P.i];
  const gap = (P.s.active && unitById(P.s, P.s.active) && unitById(P.s, P.s.active).pid === pid ? GAP.step : GAP.turn) / P.speed;
  if (performance.now() - P.lastFeed < gap) return;
  const act = to ? unitById(P.s, P.s.active) : null;
  const r = applyAction(P.s, pid, a);
  if (!r.ok) { P.n = P.i; P.broken = true; return; }
  P.i++; P.lastFeed = performance.now();
  g.onMsg({ t: 'state', state: structuredClone(P.s), ev: act ? [{ e: 'timeout', id: act.id }, ...r.ev] : r.ev, dl: -1 }); // like cloud.js for {t:'a', to:1}
  ui();
}

function onOver(R) {
  if (P !== R) return;
  P.ended = true; P.playing = false; applySpeed(1);
  ui();
  const w = P.s && P.s.winner != null && unitById(P.s, P.s.winner);
  X.toast(w ? `Replay over - ${w.name} wins` : 'Replay over');
}

function toggle() {
  if (!P) return;
  if (P.ended || P.i >= P.n) { seekRound(1, true); return; }
  P.playing = !P.playing; P.lastFeed = performance.now(); applySpeed(); ui(); X.sfx('tap');
}
// renderer timeline speed (main.js loop multiplies the frame dt): 0 freezes a paused replay
function applySpeed(force) { const g = G(); if (!P) { g.rpSpeed = undefined; return; } g.rpSpeed = force != null ? force : P.playing ? P.speed : 0; }
const curRound = () => (P && P.s ? P.s.round : 1);

// Jump to the start of round N: re-simulate from the start (fast: no rendering), then restart the screen there.
function seekRound(n, intro) {
  if (!P) return;
  const t0 = performance.now();
  n = Math.max(1, Math.min(P.lastRound, n | 0));
  let idx = P.rounds[n]; if (idx == null) { const ks = Object.keys(P.rounds).map(Number).filter((k) => k <= n); idx = ks.length ? P.rounds[Math.max(...ks)] : 0; }
  if (intro) idx = 0;
  P.playing = true;
  start(idx, !!intro);
  P.seeks.push({ n, idx, ms: Math.round(performance.now() - t0) });
}

function potm() {
  if (!P || !P.best || P.bestAt < 0) { X.toast('No standout play in this match'); return; }
  const a = simTo(P.rec, P.bestAt); const prev = structuredClone(a.s);
  const r = applyAction(a.s, P.rec.actions[P.bestAt][0], P.rec.actions[P.bestAt][1]); if (!r.ok) return;
  const g = G(); g.best = { ...P.best, prev, next: structuredClone(a.s), ev: r.ev };
  X.sfx('select'); g.playPotm();
}

function ui() {
  if (!P) return;
  const pl = $('#rp-ctl [data-rp="play"]');
  const done = P.ended || P.i >= P.n;
  pl.dataset.state = done ? 'again' : P.playing ? 'pause' : 'play';
  pl.setAttribute('aria-label', done ? 'Watch again' : P.playing ? 'Pause' : 'Play');
  $('#rp-ctl [data-rp="speed"]').textContent = P.speed + 'x';
  $('#rp-ctl [data-rp="potm"]').classList.toggle('hidden', !P.best);
  const rg = $('#rp-round'); rg.max = P.lastRound; rg.value = curRound();
  $('#rp-rlabel').textContent = `Round ${curRound()} / ${P.lastRound}`;
  $('#rp-tag').textContent = P.meta.local ? 'Replay' : P.meta.verified ? 'Replay' : 'Replay - unverified';
}

function stop(keepScreen) {
  if (!P) return;
  clearInterval(P.timer); P = null; window.__ccReplay = null;
  document.body.classList.remove('replaying');
  $('#rp-ctl').classList.add('hidden');
  const pc = $('#m-potm [data-act="potm-close"]'); if (pc && pc.dataset.rpLabel) pc.textContent = pc.dataset.rpLabel;
  applySpeed();
  if (!keepScreen) X.end();
}
export function exit() {
  if (!P) return;
  X.sfx('tap');
  try { const u = new URL(location.href); if (u.searchParams.has('replay')) { u.searchParams.delete('replay'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } } catch {}
  stop(false);
}

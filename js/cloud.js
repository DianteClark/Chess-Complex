// 17.0 (N2): Chess Complex cloud client. Online matches and parties run in a Cloudflare Room (Durable Object) instead
// of on a player's phone; every device is a client. This module owns:
//  - endpoint resolution: CLOUD_DEFAULT (the deployed workers.dev URL), ?cloud=<url> overrides, ?cloud=off (and
//    ?net=local, the offline test transport) forces today's PeerJS path; a placeholder default counts as off
//  - healthy(): GET /health (6 s timeout, so slow phones still find it), cached, one request in flight (P's cloudsave.js reuses it)
//  - createRoom(): POST /room -> code
//  - openRoom(code, h): a WebSocket room link with the same shape as net.js openClient (send/close/live/reconnecting
//    and onOpen/onData/onDrop/onClose/onError), so main.js's join flow drives it unchanged. It reconnects with backoff,
//    sends heartbeats and the playback backlog ({t:'bl', ms}, from render.js's NET.backlog), and runs the LOCKSTEP
//    replay: {t:'start'} -> createMatch(players, seed, opts), {t:'a'} -> applyAction, {t:'h'} -> stateHash check
//    ({t:'sync'} on mismatch), {t:'snap'} -> replace the state. Every resulting state reaches main.js as today's
//    {t:'state', state, ev, dl} message, so rendering, director, camera and results run the same code as PeerJS play.
import { createMatch, applyAction, introEvents, unitById } from './engine.js';
import { NET } from './net.js';
import { stateHash, protoVer } from './statehash.js';

// The lead fills this in once the Worker is deployed (placeholder = cloud off by default).
export const CLOUD_DEFAULT = 'https://chess-complex.<subdomain>.workers.dev';

const HC = { ok: null, at: 0, p: null }; // health cache (also filled by the same-origin probe)
const qs = () => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } };
// Order: ?cloud=off (or ?net=local, the offline test transport) = off; ?cloud=<url>; the page's own origin when the
// Worker serves it (17.0 one-origin hosting: GET <origin>/health answers JSON {ok, ver}); else CLOUD_DEFAULT (the
// GitHub Pages copy). Same-origin detection never blocks the UI and never gives up on a slow phone: the probe runs in
// the background with a 6 s timeout; a timeout or network error leaves the origin as an open candidate (re-probed on
// every healthy() call, i.e. on Host/Join, and on the 'online' event); only a real HTTP answer that is not the Worker's
// /health (GitHub Pages 404, a static server) rules it out. A positive answer is cached in sessionStorage, so reloads
// and later screens know at once.
const AUTO = (() => { const q = qs(), c = q.get('cloud'); return !c && q.get('net') !== 'local' && typeof location !== 'undefined' && /^https?:$/.test(location.protocol); })();
const SAME_KEY = 'cc_cloud_same';
function resolve() {
  const q = qs(), c = q.get('cloud');
  if (c === 'off' || c === '0') return null;
  if (c) return c.replace(/\/+$/, '');
  if (q.get('net') === 'local') return null; // offline test transport: never the cloud unless asked for
  if (!CLOUD_DEFAULT || /[<>]/.test(CLOUD_DEFAULT)) return null;
  return CLOUD_DEFAULT.replace(/\/+$/, '');
}
let sameOk = false, sameNo = false, probe = null;
try { sameOk = AUTO && sessionStorage.getItem(SAME_KEY) === location.origin; } catch {}
export let CLOUD_URL = sameOk ? location.origin : resolve();
export const SAME = { timeout: 6000 };
function probeSame() {
  if (!AUTO || sameOk || sameNo) return Promise.resolve(sameOk);
  if (probe) return probe;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, to = setTimeout(() => ctl && ctl.abort(), SAME.timeout);
  probe = fetch(location.origin + '/health', { cache: 'no-store', signal: ctl && ctl.signal })
    .then((r) => {
      if (!(r.ok && /json/.test(r.headers.get('content-type') || ''))) { sameNo = true; return null; } // answered, and not the Worker
      return r.json().then((j) => j, () => { sameNo = true; return null; });
    }, () => null) // timeout / offline: still a candidate
    .then((j) => {
      if (j && j.ok && j.ver) { sameOk = true; CLOUD_URL = location.origin; HC.ok = true; HC.at = Date.now(); try { sessionStorage.setItem(SAME_KEY, location.origin); } catch {} }
      else if (j) sameNo = true;
      return sameOk;
    })
    .finally(() => { clearTimeout(to); probe = null; });
  return probe;
}
const sameOpen = () => AUTO && !sameOk && !sameNo; // origin not ruled in or out yet
if (sameOpen()) probeSame();
if (AUTO && typeof window !== 'undefined') window.addEventListener('online', () => { if (HC.ok === false) HC.ok = null; if (sameOpen()) probeSame(); });
export const endpoint = () => CLOUD_URL || (sameOpen() ? location.origin : null);
const wsBase = () => CLOUD_URL && CLOUD_URL.replace(/^http/, 'ws');
export const sameOrigin = () => !!CLOUD_URL && typeof location !== 'undefined' && CLOUD_URL === location.origin;

// ---------- health ----------
export const HEALTH = { timeout: 6000, okFor: 60000, failFor: 15000 }; // Host/Join wait up to ~6 s (slow phones) before phone hosting
export function healthy() {
  if (sameOpen()) { // the Worker may be serving this page: give this Host/Join tap up to SAME.timeout from now
    const until = Date.now() + SAME.timeout, wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
    const step = () => Promise.race([probeSame(), wait(until - Date.now())]).then(() => {
      if (!sameOpen()) return healthy();
      if (Date.now() < until - 250) return step(); // an older probe (from page load) timed out: probe again for the rest
      return false; // still unknown: phone hosting this time; the probe carries on in the background for the next tap
    });
    return step();
  }
  if (!CLOUD_URL) return Promise.resolve(false);
  const now = Date.now();
  if (HC.ok !== null && now - HC.at < (HC.ok ? HEALTH.okFor : HEALTH.failFor)) return Promise.resolve(HC.ok);
  if (HC.p) return HC.p;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => ctl && ctl.abort(), HEALTH.timeout);
  HC.p = fetch(CLOUD_URL + '/health', { cache: 'no-store', signal: ctl && ctl.signal })
    .then((r) => r.ok, () => false)
    .then((ok) => { clearTimeout(to); HC.ok = ok; HC.at = Date.now(); HC.p = null; return ok; });
  return HC.p;
}
export const cloudHealthy = healthy;
// Cached answer without waiting: true / false, or null when unknown (no check yet or expired).
export function healthyNow() {
  if (sameOpen() || HC.p) return null;
  if (!CLOUD_URL) return false;
  if (HC.ok === null || Date.now() - HC.at > (HC.ok ? HEALTH.okFor : HEALTH.failFor)) return null;
  return HC.ok;
}
// A cloud link that failed after a good health check marks the cloud down for a while (next Host/Join uses PeerJS).
export function markDown() { HC.ok = false; HC.at = Date.now(); }

export async function createRoom() {
  if (!CLOUD_URL) throw new Error('off');
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => ctl && ctl.abort(), 5000);
  try {
    const r = await fetch(CLOUD_URL + '/room', { method: 'POST', signal: ctl && ctl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    if (!j || typeof j.code !== 'string' || !/^[A-Z0-9]{5}$/.test(j.code)) throw new Error('bad code');
    return j.code;
  } finally { clearTimeout(to); }
}

// ---------- room link ----------
export const CLOUD = { hb: 5000, dead: 16000, retry: [400, 800, 1600, 3000, 4000], retryFor: 55000, openTimeout: 8000, bl: 500, log: [], stats: { rx: 0, tx: 0, acts: 0, hashes: 0, mismatches: 0, syncs: 0, snaps: 0 } };
const clog = (s) => { CLOUD.log.push(`${new Date().toISOString().slice(11, 23)} ${s}`); if (CLOUD.log.length > 80) CLOUD.log.shift(); };
let ver = null; const VER = () => (ver ||= protoVer());

// NET.drop(ms) (net.js, used by the online suite) also cuts cloud links and keeps them offline for ms.
const rooms = new Set(); let offlineUntil = 0;
{ const od = NET.drop; NET.drop = (ms = 0) => { try { od && od(ms); } catch {} offlineUntil = Date.now() + ms; for (const r of [...rooms]) r.cut(); }; }

// Hidden traps stay hidden on screen: the lockstep state has every trap, so filter by owner/team before main.js sees it
// (same rule as main.js hostEmit for PeerJS clients).
function viewFor(s, myPid, ev) {
  const st = structuredClone(s);
  if (!st.items || !st.items.some((i) => i.k === 'trap')) return { state: st, ev };
  const u = st.units.find((v) => v.pid === myPid);
  st.items = st.items.filter((i) => i.k !== 'trap' || (u && (i.owner === u.id || (u.team != null && i.team === u.team))));
  ev = (ev || []).filter((e) => e.e !== 'trapSet' || (u && (e.id === u.id || (u.team != null && (st.units.find((v) => v.id === e.id) || {}).team === u.team))));
  return { state: st, ev };
}

// h: { onOpen(again), onData(m), onDrop(why), onClose(), onError(why) } like net.js openClient.
export function openRoom(code, h) {
  let ws = null, opened = false, gone = false, dropAt = 0, retryT = null, openT = null, tries = 0, gen = 0, live = false;
  let rx = Date.now(), tick = Date.now(), sawHb = false, hbT = null, blT = null, lastBl = 0;
  let hello = null; // the last {t:'join'} main.js sent, re-sent as hello on every (re)connect
  const M = { s: null, mid: null, pid: null, dlAt: 0, pendingH: null, syncAt: 0, waitSnap: false };
  const me = { cut: () => { if (ws) { clog('cut'); kill(ws); fail(gen, 'cut'); } } };
  rooms.add(me);
  const kill = (w) => { try { w.onopen = w.onmessage = w.onclose = w.onerror = null; w.close(); } catch {} };
  const raw = (o) => { if (ws && ws.readyState === 1) { try { ws.send(typeof o === 'string' ? o : JSON.stringify(o)); CLOUD.stats.tx++; } catch {} } };
  const emit = (m) => { try { h.onData(m); } catch (e) { console.error(e); } };
  const dl = () => (M.dlAt ? Math.max(0, M.dlAt - Date.now()) : -1);
  const setDl = (v) => { if (typeof v === 'number') M.dlAt = v >= 0 ? Date.now() + v : 0; };
  const publish = (ev) => { const { state, ev: e } = viewFor(M.s, M.pid, ev || []); emit({ t: 'state', state, ev: e, dl: dl() }); };
  const askSync = (why) => {
    const now = Date.now(); if (M.waitSnap && now - M.syncAt < 3000) return;
    M.waitSnap = true; M.syncAt = now; CLOUD.stats.syncs++; clog(`sync (${why}) at v${M.s ? M.s.v : '-'}`); raw({ t: 'sync' });
  };
  const checkHash = () => {
    const p = M.pendingH; if (!p || !M.s || M.s.v < p.v) return;
    M.pendingH = null; if (M.s.v !== p.v) return; // already past it (a snap moved us on)
    CLOUD.stats.hashes++;
    const x = stateHash(M.s);
    if (x !== (p.x >>> 0)) { CLOUD.stats.mismatches++; askSync(`hash v${p.v} ${x} != ${p.x}`); }
  };
  const startMatch = (m) => {
    if (M.s && m.mid && m.mid === M.mid && !M.s.over && !m.resume) return; // a repeated start for the live match: keep it (no intro reset)
    M.s = createMatch(m.players, m.seed, m.opts || {}); M.mid = m.mid; M.pendingH = null; M.waitSnap = false; M.dlAt = 0;
    if (typeof m.pid === 'string') M.pid = m.pid;
    emit({ t: 'start', pid: M.pid, mid: m.mid, resume: !!m.resume, introMs: m.introMs });
    if (!m.resume) publish(M.s.v === 0 && !M.s.tutorial ? introEvents(M.s) : []);
    // a resume is followed by a snap with the live state
  };
  const onMsg = (m) => {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hb': sawHb = true; return;
      case 'welcome': M.pid = m.pid; emit(m); return;
      case 'start': startMatch(m); return;
      case 'a': {
        if (!M.s) return;
        if (M.waitSnap) return; // a sync is pending: the snap brings us up to date
        if (!(m.v > M.s.v)) return; // duplicate
        if (m.v !== M.s.v + 1) { askSync(`gap v${M.s.v} -> ${m.v}`); return; }
        const act = unitById(M.s, M.s.active);
        const r = applyAction(M.s, m.pid, m.a);
        CLOUD.stats.acts++;
        if (!r.ok || M.s.v !== m.v) { askSync(`apply ${r.ok ? 'v' + M.s.v : 'refused'} for v${m.v}`); return; }
        setDl(m.dl);
        const ev = m.to && act ? [{ e: 'timeout', id: act.id }, ...r.ev] : r.ev;
        publish(ev);
        checkHash();
        return;
      }
      case 'dl': if (!M.s || (m.v != null && m.v !== M.s.v)) return; setDl(m.dl); publish([]); return;
      case 'h': M.pendingH = { v: m.v, x: m.x }; checkHash(); return;
      case 'snap': {
        if (!m.state || typeof m.state !== 'object') return;
        CLOUD.stats.snaps++;
        const fresh = !M.s || (m.mid && m.mid !== M.mid);
        if (fresh && m.mid) { M.mid = m.mid; emit({ t: 'start', pid: M.pid, mid: m.mid, resume: true }); }
        M.s = m.state; M.waitSnap = false; M.pendingH = null; setDl(m.dl);
        publish(Array.isArray(m.ev) ? m.ev : []);
        return;
      }
      case 'seat': { if (M.s) { const u = M.s.units.find((v) => v.pid === m.pid && v.kind === 'player'); if (u) u.bot = !!m.bot; } emit(m); return; }
      case 'over': noteReplay(m); emit(m); return;
      case 'lobby': noteReplay(m); emit(m); return;
      case 'ident': M.ident = { cid: m.cid || null, verified: !!m.verified }; emit(m); return; // S2: seat verified for boards
      case 'replay': noteReplay(m); emit(m); return; // S2/RP: {t:'replay', mid, id}; main.js stores session.replayId
      case 'bye': {
        const why = m.why || m.reason;
        if (why === 'update') { reloadForUpdate(); }
        if (!opened && (why === 'noroom' || why === 'missing')) { gone = true; teardown(); h.onError('peer-unavailable'); return; }
        emit({ ...m, t: 'bye', reason: m.reason || why });
        return;
      }
      default: emit(m); // lobby, chat, vc, emote, err, part, dbg ... pass straight through
    }
  };
  const teardown = () => { clearInterval(hbT); clearInterval(blT); clearTimeout(openT); clearTimeout(retryT); live = false; if (ws) { kill(ws); ws = null; } };
  const fail = (g, why) => {
    if (gone || g !== gen) return;
    gen++; teardown();
    clog(`fail ${why}`);
    if (!opened) { gone = true; rooms.delete(me); markDown(); h.onError(why === 'timeout' ? 'timeout' : 'network'); return; }
    if (!dropAt) { dropAt = Date.now(); try { h.onDrop && h.onDrop(why); } catch (e) { console.error(e); } }
    if (Date.now() - dropAt > CLOUD.retryFor) { gone = true; rooms.delete(me); clog('gave up'); h.onClose(); return; }
    retryT = setTimeout(attempt, CLOUD.retry[Math.min(tries++, CLOUD.retry.length - 1)]);
  };
  const sendHello = () => {
    if (!hello) return;
    const pr = { title: hello.title, skin: hello.skin, finisher: hello.finisher, trail: hello.trail, build: hello.build, botLevel: hello.botLevel, mode: hello.mode, avatar: hello.avatar };
    const o = { t: 'hello', pid: hello.token, name: hello.name, profile: pr, ver: VER() };
    const id = cloudId(); if (id) { o.cid = id.id; o.cproof = id.secret; } // 17.0: verified seat (leaderboards)
    if (M.mid && M.s && !M.s.over) o.resume = { mid: M.mid };
    raw(o);
  };
  const attempt = () => {
    if (gone) return;
    if (Date.now() < offlineUntil) { retryT = setTimeout(attempt, Math.max(50, offlineUntil - Date.now())); return; } // NET.drop: this page is offline
    const g = ++gen;
    let w;
    try { w = new WebSocket(wsBase() + '/ws/room/' + encodeURIComponent(code)); } catch (e) { fail(g, 'network'); return; }
    ws = w;
    openT = setTimeout(() => { if (g === gen) fail(g, 'timeout'); }, CLOUD.openTimeout);
    w.onopen = () => {
      if (g !== gen) return;
      clearTimeout(openT); live = true; rx = tick = Date.now();
      const again = opened; opened = true; dropAt = 0; tries = 0; clog(`open${again ? ' (reconnected)' : ''}`);
      hbT = setInterval(() => {
        if (g !== gen) return;
        const now = Date.now();
        if (now - tick > CLOUD.hb * 3) rx = Math.max(rx, now - CLOUD.hb); // this device slept: give the link a fresh window
        tick = now;
        if (sawHb && now - rx > CLOUD.dead) { fail(g, 'dead'); return; }
        raw('{"t":"hb"}');
      }, CLOUD.hb);
      blT = setInterval(() => {
        if (g !== gen || !M.s || M.s.over) return;
        let ms = 0; try { ms = NET.backlog ? Math.round(NET.backlog()) : 0; } catch {}
        if (ms > 0 || lastBl > 0) raw({ t: 'bl', ms: Math.max(0, ms) });
        lastBl = ms;
      }, CLOUD.bl);
      try { h.onOpen(again); } catch (e) { console.error(e); }
    };
    w.onmessage = (e) => {
      if (g !== gen) return;
      rx = Date.now(); CLOUD.stats.rx++;
      if (Date.now() < offlineUntil) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      onMsg(m);
    };
    w.onclose = () => { if (g === gen) fail(g, 'closed'); };
    w.onerror = () => { if (g === gen && w.readyState !== 1) fail(g, 'closed'); };
  };
  attempt();
  // outgoing: main.js speaks today's client protocol; translate the few messages that differ
  const send = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.t === 'join') {
      hello = o; sendHello(); return; // main.js sends its join from onOpen, on every (re)connect
    }
    if (o.t === 'act') { raw({ t: 'act', a: o.a, n: M.s ? M.s.v : -1 }); return; }
    raw(o);
  };
  return {
    send,
    close: () => { gone = true; gen++; rooms.delete(me); teardown(); },
    get live() { return live; },
    get reconnecting() { return !!dropAt && !gone; },
    cloud: true,
    get match() { return M; },
    dbg: (op, args = {}) => raw({ t: 'dbg', op, ...args }),
  };
}

// 17.0: the cloud player id + secret js/cloudsave.js keeps (localStorage cc_cloud_v1 {id, secret}); read here instead of
// importing cloudsave.js (it imports this module). Sent once per connection, over TLS, so the Room can verify the seat.
function cloudId() {
  try { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || 'null'); if (o && typeof o.id === 'string' && typeof o.secret === 'string' && o.id && o.secret) return { id: o.id, secret: o.secret }; } catch {}
  return null;
}
// 17.0 (RP): the Room's over/lobby message carries the saved replay id of the match that just ended (field replay or
// replayId). It is kept in lastReplay() and announced as window event 'cc:replay' {detail:{id, mid}} for the results
// screen's share button; the message itself still reaches main.js unchanged.
let replay = null;
export const lastReplay = () => replay;
function noteReplay(m) {
  const pr = m && m.party && m.party.replay, id = m && (m.t === 'replay' ? m.id : (typeof m.replay === 'string' && m.replay) || m.replayId || (pr && typeof pr === 'object' ? pr.id : pr));
  if (typeof id !== 'string' || !id || id.length > 64 || (replay && replay.id === id)) return;
  replay = { id, mid: m.mid || (pr && pr.mid) || null, at: Date.now() };
  try { window.dispatchEvent(new CustomEvent('cc:replay', { detail: { ...replay } })); } catch {}
}

// {t:'bye', why:'update'}: this build's engine differs from the server's; reload once to pick up the new version.
function reloadForUpdate() {
  try {
    const k = 'cc_cloud_reload', last = +sessionStorage.getItem(k) || 0;
    if (Date.now() - last < 120000) return; // already tried: stay put rather than loop
    sessionStorage.setItem(k, String(Date.now()));
  } catch {}
  try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {}); } catch {}
  setTimeout(() => location.reload(), 600);
}

// kick off the first health check early so Host/Join usually know the answer without waiting
// and, once the cloud answers, compute the engine fingerprint (protoVer, ~0.3-1.5 s of JIT-cold engine work) while
// the player is still on the menus instead of on their first Host/Join tap
if ((CLOUD_URL || sameOpen()) && typeof window !== 'undefined') setTimeout(() => { healthy().then((ok) => { if (!ok || ver) return; const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500)); idle(() => { try { VER(); } catch {} }, { timeout: 5000 }); }); }, 0);

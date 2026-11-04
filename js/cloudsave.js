// Chess Complex 17.0 Cloud (P): automatic cloud save + transfer codes. No sign-up.
// - First launch with a healthy cloud: POST /player/new -> {id, secret}, kept in localStorage (cc_cloud_v1).
// - Every profile save() marks the cloud copy dirty; PUT /player/:id 5 s later (debounced), at once on match end and
//   when the app is hidden (keepalive). Offline or cloud off: nothing breaks, the phone copy is the save.
// - Server keeps the blob with the higher rev. On a conflict (another phone saved first) the two copies are merged:
//   unlocks are unioned, progress counters take the max, Marks NEVER add up (see merge()).
// - Transfer code = id + secret + 1 check char, Crockford base32, shown with a QR code (local encoder, no network).
// main.js wiring: save() calls track(profile) before writing and dirty() after; init(hooks) once; flush() on match end.
import { settings, saveSettings } from './audio.js';
import { qrSvg } from './vendor/qr.js';
import * as C from './cloud.js'; // N2: endpoint() + healthy() (1.5 s timeout, cached, one in flight)

const KEY = 'cc_cloud_v1';
const A32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DEBOUNCE = 5000, PULL_GAP = 60000;
let offN = 0; const backoff = () => Math.min(60000, 8000 * 2 ** offN++); // offline retries: 8, 16, 32, 60, 60 ... s
const UNION = ['owned', 'ownedBoards', 'ownedFinishers', 'ownedTrails', 'ownedEmotes', 'ownedBanners', 'unlocked', 'titles', 'achievements', 'collections', 'locations', 'modesPlayed', 'modesWon', 'discovered', 'tutorial', 'seenItems', 'played'];
const MAXN = ['games', 'wins', 'kills', 'crowns', 'bestAttune'];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

let H = null; // hooks from main.js: { profile(), normalize(d), save(), refresh(), toast(msg), sfx(name) }
let st = readSt();
let status = 'off', statusWhy = '', ep;
let timer = 0, inflight = null, again = false, applying = false, pulledAt = 0, retryAt = 0;
const subs = new Set();

function readSt() { try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && typeof o === 'object') return o; } catch {} return {}; }
function writeSt() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }
function setStatus(s, why = '') { if (s === 'saved' || s === 'saving') offN = 0; status = s; statusWhy = why; for (const f of subs) try { f(s); } catch {} renderRow(); if (s === 'saved') setTimeout(maybeMoveCard, 300); }
export const getStatus = () => ({ status, why: statusWhy, at: st.at || 0, id: st.id || null, linked: !!(st.id && st.secret) });
export const onStatus = (f) => { subs.add(f); return () => subs.delete(f); };

// ---------- endpoint + health: N2's js/cloud.js (?cloud=<url> overrides, ?cloud=off or ?net=local = off) ----------
async function endpoint() { try { ep = (await C.endpoint()) || null; } catch { ep = null; } if (ep) ep = String(ep).replace(/\/+$/, ''); return ep; } // re-read: same-origin is settled by N2's probe
async function healthy() { try { return !!(await C.healthy()); } catch { return false; } }
const markDown = () => { try { C.markDown(); } catch {} };
async function gz(text) {
  if (typeof CompressionStream !== 'function') return null;
  try { return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); } catch { return null; }
}
async function api(method, path, { secret, body, keepalive } = {}) {
  const headers = {}; if (secret) headers.Authorization = 'Bearer ' + secret;
  let b; if (body !== undefined) { headers['Content-Type'] = 'application/json'; const z = body.length > 1024 ? await gz(body) : null; if (z && z.length < body.length) { b = z; headers['Content-Encoding'] = 'gzip'; } else b = body; }
  const ac = typeof AbortController === 'function' && !keepalive ? new AbortController() : null; const t = ac && setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(ep + path, { method, headers, body: b, cache: 'no-store', keepalive: !!keepalive && (!b || b.length < 60000), signal: ac && ac.signal });
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  } catch { markDown(); return { s: 0, j: null }; } finally { clearTimeout(t); }
}

// ---------- Marks ledger: makes the merge safe ----------
// profile.cs = { earn, spend, debt, t }: earn/spend only ever grow (diffs of profile.marks between saves), t = last
// local change. st.lastMarks = marks at the last save on this phone, st.base = spend both copies agreed on at the last sync.
export function track(p) {
  if (!p || typeof p !== 'object') return;
  const cs = p.cs && typeof p.cs === 'object' ? p.cs : (p.cs = {});
  for (const k of ['earn', 'spend', 'debt']) cs[k] = Math.max(0, num(cs[k]));
  const m = num(p.marks);
  if (typeof st.lastMarks !== 'number') st.lastMarks = m;
  const d = m - st.lastMarks;
  if (d > 0) cs.earn += d; else if (d < 0) cs.spend -= d;
  if (cs.debt > 0 && p.marks > 0) { const pay = Math.min(cs.debt, p.marks); p.marks -= pay; cs.debt -= pay; } // a merge deficit is paid from new Marks
  if (!applying) cs.t = Date.now();
  st.lastMarks = num(p.marks); writeSt();
}
const uniq = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
const maxMap = (a, b) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(b || {})) if (typeof v === 'number' && isFinite(v)) o[k] = Math.max(num(o[k]), v); return o; };

// Merge two profiles (both already normalized). Settings, loadout, equipped items, name etc. come from the copy changed
// last; unlocks are unioned; counters take the max. Marks: each copy's spending since the common base is charged to the
// other copy's wallet and the better result is kept, so merged Marks + merged items are never worth more than either copy
// on its own (two phones spending the same Marks on different items both keep the items, and the Marks go to 0 with the
// difference as debt that new Marks pay off). Earnings never add (max), so a conflict cannot mint Marks.
export function merge(L, S, base) {
  const lc = L.cs || {}, sc = S.cs || {};
  const B = typeof base === 'number' ? Math.min(base, num(lc.spend), num(sc.spend)) : Math.min(num(lc.spend), num(sc.spend));
  const first = num(sc.t) > num(lc.t) ? S : L, other = first === S ? L : S;
  const out = JSON.parse(JSON.stringify(first));
  for (const k of UNION) if (Array.isArray(L[k]) || Array.isArray(S[k])) out[k] = uniq(first[k], other[k]);
  if (Array.isArray(out.played)) out.played = out.played.slice(-60);
  for (const k of MAXN) if (typeof L[k] === 'number' || typeof S[k] === 'number') out[k] = Math.max(num(L[k]), num(S[k]));
  const hi = num(L.level) * 1e9 + num(L.xp) >= num(S.level) * 1e9 + num(S.xp) ? L : S; out.level = hi.level; out.xp = hi.xp; // xp resets each level: keep the pair
  out.stats = maxMap(first.stats, other.stats); out.mastery = maxMap(first.mastery, other.mastery);
  if (L.season && S.season && L.season.id === S.season.id) {
    const a = L.season, b = S.season, o = out.season;
    for (const k of ['xp', 'tier', 'prem', 'shown', 'pshown']) if (typeof a[k] === 'number' || typeof b[k] === 'number') o[k] = Math.max(typeof a[k] === 'number' ? a[k] : -1, typeof b[k] === 'number' ? b[k] : -1);
    o.pass = a.pass === true || b.pass === true;
  }
  if (Array.isArray(L.pastSeasons) || Array.isArray(S.pastSeasons)) {
    const m = new Map();
    for (const r of [...(L.pastSeasons || []), ...(S.pastSeasons || [])]) { if (!r || typeof r.id !== 'number') continue; const o = m.get(r.id); m.set(r.id, o ? { ...o, tier: Math.max(num(o.tier), num(r.tier)), ...(o.pass || r.pass ? { pass: true } : {}) } : { ...r }); }
    out.pastSeasons = [...m.values()];
  }
  if (L.login && S.login) for (const k of ['streak', 'best']) out.login[k] = Math.max(num(L.login[k]), num(S.login[k]));
  const sL = Math.max(0, num(lc.spend) - B), sS = Math.max(0, num(sc.spend) - B);
  let marks = Math.max(num(L.marks) - sS, num(S.marks) - sL), debt = Math.max(num(lc.debt), num(sc.debt));
  if (marks < 0) { debt += -marks; marks = 0; }
  out.marks = Math.floor(marks);
  out.cs = { earn: Math.max(num(lc.earn), num(sc.earn)), spend: B + sL + sS, debt, t: Math.max(num(lc.t), num(sc.t)) };
  return out;
}

// ---------- apply a blob to the live profile (in place, so every module keeps its reference) ----------
const blobOf = (p) => ({ v: 1, p, set: { ...settings } });
function apply(blob, { merged } = {}) {
  const p = H.profile();
  const n = H.normalize(JSON.parse(JSON.stringify(blob.p)));
  for (const k of Object.keys(p)) delete p[k];
  Object.assign(p, n);
  if (!merged && blob.set && typeof blob.set === 'object') { for (const [k, v] of Object.entries(blob.set)) if (k in settings && typeof v === typeof settings[k]) settings[k] = v; try { saveSettings(); } catch {} }
  st.lastMarks = num(p.marks); st.base = num(p.cs && p.cs.spend);
  applying = true; try { H.save(); } finally { applying = false; }
  try { H.refresh && H.refresh(); } catch {}
}

// ---------- sync ----------
async function ready(direct) { // direct: a tap is waiting, so skip the cached health answer and just try
  if (!H) return false;
  if (!(await endpoint())) { setStatus('off'); return false; }
  if (st.revoked) { setStatus('revoked'); return false; }
  const up = direct ? true : await healthy();
  if (!(await endpoint())) { setStatus('off'); return false; } // the same-origin probe said this page is not the Worker
  if (!up) { setStatus('offline'); if (!timer) later(backoff()); return false; }
  if (!st.id || !st.secret) return create();
  return true;
}
// First cloud player for this phone. Single flight; asks Turnstile for a token only when the server's /cfg has a site key.
let creating = null, tsDeclined = false;
function create() {
  if (creating) return creating;
  creating = (async () => {
    let body;
    const key = await siteKey();
    if (key) {
      if (tsDeclined) { setStatus('pending', 'check'); return false; }
      const token = await humanToken(key);
      if (!token) { tsDeclined = true; setStatus('pending', 'check'); return false; } // no nagging: Transfer Code > Try Again asks again
      body = JSON.stringify({ turnstile: token });
    }
    const r = await api('POST', '/player/new', { body });
    if (r.s !== 201 || !r.j || !r.j.id) {
      if (r.s === 403) { tsDeclined = true; setStatus('pending', 'check'); return false; }
      setStatus(r.s === 429 ? 'pending' : 'offline'); later(r.s === 429 ? (num(r.j && r.j.retry) || 600) * 1000 : backoff()); return false;
    }
    st = { ...st, id: r.j.id, secret: r.j.secret, rev: 0, dirty: true, base: num((H.profile().cs || {}).spend) }; writeSt();
    return true;
  })();
  return creating.finally(() => { creating = null; });
}
let cfgP = null;
function siteKey() { // S2's GET /cfg -> {turnstileSiteKey}; unreachable or missing = no widget
  cfgP = cfgP || api('GET', '/cfg').then((r) => (r.s === 200 && r.j && typeof r.j.turnstileSiteKey === 'string' ? r.j.turnstileSiteKey.trim() : ''), () => '');
  return cfgP.then((k) => { if (!k) cfgP = null; return k; });
}
// Turnstile: the script loads only here (first cloud player on a server that asks for it). 'interaction-only' keeps the
// widget invisible unless Cloudflare needs a tap; then a small card shows it. Any failure resolves null (offline-safe).
const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let tsLoad = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  tsLoad = tsLoad || new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = TS_SRC; sc.async = true; sc.defer = true;
    const to = setTimeout(() => rej(new Error('timeout')), 15000);
    sc.onload = () => { clearTimeout(to); window.turnstile ? res(window.turnstile) : rej(new Error('no turnstile')); };
    sc.onerror = () => { clearTimeout(to); rej(new Error('load')); };
    document.head.appendChild(sc);
  }).catch((e) => { tsLoad = null; throw e; });
  return tsLoad;
}
async function humanToken(key) {
  let ts; try { ts = await loadTurnstile(); } catch { return null; }
  let card = $('#cs-human');
  if (!card) {
    card = document.createElement('div'); card.id = 'cs-human'; card.className = 'cs-human hidden'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Cloud save check');
    card.innerHTML = '<b>Cloud save</b><span>One quick check before your progress is saved online.</span><div class="cs-ts-slot"></div><button class="btn small ghost" data-cs-human="skip">Not now</button>';
    document.body.appendChild(card);
  }
  return new Promise((res) => {
    let id = null, done = false;
    const finish = (t) => { if (done) return; done = true; clearTimeout(to); card.classList.add('hidden'); try { if (id != null) ts.remove(id); } catch {} res(t || null); };
    const to = setTimeout(() => finish(null), 120000);
    card.querySelector('[data-cs-human]').onclick = () => finish(null);
    try {
      id = ts.render(card.querySelector('.cs-ts-slot'), {
        sitekey: key, action: 'player-new', appearance: 'interaction-only', theme: 'dark',
        callback: (t) => finish(t), 'error-callback': () => finish(null), 'expired-callback': () => finish(null), 'timeout-callback': () => finish(null),
        'before-interactive-callback': () => card.classList.remove('hidden'),
      });
    } catch { finish(null); }
  });
}
function later(ms) { clearTimeout(timer); timer = setTimeout(() => push(), Math.max(ms, retryAt - Date.now(), 0)); }

// Pull the server copy; adopt it when it is newer and this phone has nothing unsaved, merge when both changed.
async function pull() {
  if (!(await ready())) return;
  pulledAt = Date.now();
  const r = await api('GET', `/player/${st.id}`, { secret: st.secret });
  if (r.s === 401) { st.revoked = true; writeSt(); setStatus('revoked'); return; }
  if (r.s === 404) { forget(); return; }
  if (r.s !== 200 || !r.j) { setStatus('offline'); return; }
  const srv = r.j;
  if (srv.blob && srv.blob.p && srv.rev > num(st.rev)) {
    if (st.dirty) { const p = H.profile(); const m = merge(H.normalize(JSON.parse(JSON.stringify(p))), H.normalize(JSON.parse(JSON.stringify(srv.blob.p))), st.base); st.rev = srv.rev; apply({ p: m }, { merged: true }); st.dirty = true; writeSt(); return push(); }
    st.rev = srv.rev; st.dirty = false; apply(srv.blob); st.at = srv.updatedAt || Date.now(); writeSt(); setStatus('saved'); return;
  }
  if (st.dirty || !srv.blob || srv.rev < num(st.rev)) return push();
  setStatus('saved');
}

async function push({ keepalive = false, direct = false } = {}) {
  clearTimeout(timer); timer = 0;
  if (inflight) { again = true; return inflight; }
  inflight = (async () => {
    for (let guard = 0; guard < 4; guard++) {
      if (!(await ready(direct))) return;
      if (!st.dirty && num(st.rev) > 0) { setStatus('saved'); return; }
      const p = H.profile(); const sent = num(p.cs && p.cs.spend);
      const body = JSON.stringify({ rev: num(st.rev) + 1, blob: blobOf(p) });
      if (body.length > 500000) { setStatus('error', 'too large'); return; }
      st.dirty = false; again = false; setStatus('saving');
      const r = await api('PUT', `/player/${st.id}`, { secret: st.secret, body, keepalive });
      if (r.s === 200 && r.j) { st.rev = r.j.rev; st.at = Date.now(); st.base = sent; if (again) st.dirty = true; writeSt(); setStatus(st.dirty ? 'pending' : 'saved'); if (st.dirty) later(DEBOUNCE); return; }
      st.dirty = true; writeSt();
      if (r.s === 409 && r.j && r.j.blob && r.j.blob.p) { // another phone saved first: merge, then save the merge on top
        const m = merge(H.normalize(JSON.parse(JSON.stringify(H.profile()))), H.normalize(JSON.parse(JSON.stringify(r.j.blob.p))), st.base);
        st.rev = r.j.rev; apply({ p: m }, { merged: true }); st.dirty = true; writeSt(); continue;
      }
      if (r.s === 429) { retryAt = Date.now() + (num(r.j && r.j.retry) || 2) * 1000; setStatus('pending'); later(0); return; }
      if (r.s === 401) { st.revoked = true; writeSt(); setStatus('revoked'); return; }
      if (r.s === 404) { forget(); later(0); return; }
      if (r.s === 413) { setStatus('error', 'too large'); return; }
      setStatus('offline'); later(backoff()); return;
    }
  })();
  try { await inflight; } finally { inflight = null; }
  if (again && st.dirty) { again = false; later(DEBOUNCE); }
}
function forget() { const keep = { lastMarks: st.lastMarks }; st = keep; st.dirty = true; writeSt(); }

export function dirty() {
  if (!H || applying) return;
  st.dirty = true; writeSt();
  if (inflight) { again = true; return; }
  if (status === 'saved') setStatus('pending');
  if (!timer) later(DEBOUNCE);
}
export const syncNow = () => pull(); // pull + merge/adopt + push (also used on foreground / online)
export function flush(opts) { if (!H) return; if (st.dirty || !st.id) return push(opts); }

// ---------- transfer codes ----------
// Check char = sum of alpha^k * value over GF(32) (x^5 + x^2 + 1): catches every single wrong character and every swap
// of two neighbours (a weighted mod-31 sum cannot tell 0 from Z).
const check = (s) => { let c = 0; for (const ch of s) { c <<= 1; if (c & 32) c ^= 0x25; c ^= A32.indexOf(ch); } return A32[c]; };
export function encodeCode(id, secret) { const s = (id + secret).toUpperCase(); const c = s + check(s); return c.match(/.{1,4}/g).join('-'); }
export function decodeCode(text) {
  const s = String(text || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 27 || [...s].some((ch) => A32.indexOf(ch) < 0)) return null;
  const body = s.slice(0, 26);
  if (check(body) !== s[26]) return null;
  return { id: body.slice(0, 10), secret: body.slice(10) };
}
export const myCode = () => (st.id && st.secret ? encodeCode(st.id, st.secret) : null);
const codeUrl = (code) => { try { const u = moveHome(); return u ? moveUrl(u, code) : `${location.origin}${location.pathname}#transfer=${code}`; } catch { return code; } }; // fragment: never sent to a server

// Load the player behind a code on this phone (replaces local progress; the other phone keeps working).
export async function applyCode(code) {
  const c = decodeCode(code); if (!c) return { ok: false, why: 'That code is not valid. Check it and try again.' };
  if (c.id === st.id && c.secret === st.secret) return { ok: false, why: 'That is this phone’s own code.' };
  if (!(await endpoint())) return { ok: false, why: 'Cloud save is offline. Connect to the internet and try again.' };
  const r = await api('GET', `/player/${c.id}`, { secret: c.secret }); // a tap: ask the server directly, not the cached health answer
  if (r.s === 0) return { ok: false, why: 'Cloud save is offline. Connect to the internet and try again.' };
  if (r.s === 401 || r.s === 404) return { ok: false, why: 'That code was not recognised. It may have been reset on the other phone.' };
  if (r.s !== 200 || !r.j) return { ok: false, why: 'Could not reach cloud save. Try again in a moment.' };
  st = { id: c.id, secret: c.secret, rev: r.j.rev, at: r.j.updatedAt || Date.now(), dirty: !r.j.blob, lastMarks: st.lastMarks };
  if (r.j.blob && r.j.blob.p) apply(r.j.blob);
  writeSt(); setStatus(st.dirty ? 'pending' : 'saved');
  if (st.dirty) push();
  return { ok: true, empty: !r.j.blob };
}
export async function rotate() {
  if (!st.id || !st.secret || !(await endpoint())) return { ok: false, why: 'Cloud save is offline. Try again when you are connected.' };
  const r = await api('POST', `/player/${st.id}/rotate`, { secret: st.secret });
  if (r.s === 0) return { ok: false, why: 'Cloud save is offline. Try again when you are connected.' };
  if (r.s === 200 && r.j && r.j.secret) { st.secret = r.j.secret; writeSt(); return { ok: true }; }
  if (r.s === 429) return { ok: false, why: 'You just reset it. Wait a few seconds and try again.' };
  return { ok: false, why: 'Could not reset the code. Try again in a moment.' };
}
export function startFresh() { st = { lastMarks: st.lastMarks, dirty: true }; writeSt(); return push(); }

// ---------- Settings UI: "Cloud Save" row + Transfer Code panel ----------
function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}
function statusLine() {
  switch (status) {
    case 'saved': return { t: `Saved ${ago(st.at || Date.now())}`, k: 'ok' };
    case 'saving': return { t: 'Saving...', k: 'busy' };
    case 'pending': if (statusWhy === 'check') return { t: 'Not set up yet - open Transfer Code', k: 'warn' }; return { t: st.at ? `Saving soon - last saved ${ago(st.at)}` : 'Saving soon', k: 'busy' };
    case 'offline': return { t: 'Offline - progress is kept on this phone', k: 'warn' };
    case 'revoked': return { t: 'Code was reset on another phone', k: 'bad' };
    case 'error': return { t: statusWhy === 'too large' ? 'Save too large to upload' : 'Cloud save error', k: 'bad' };
    default: return { t: 'Off', k: 'off' };
  }
}
function renderRow() {
  const el = $('#cs-state'); if (!el) return;
  const s = statusLine(); el.textContent = s.t; el.dataset.k = s.k;
  const row = $('#cs-row'); if (row) row.dataset.k = s.k;
}
let modal = null, shown = false;
function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'm-transfer'; modal.className = 'modal hidden global cs-modal';
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'cs-title');
  modal.innerHTML = '<div class="modal-box cs-box"></div>';
  const host = $('#m-settings'); (host && host.parentNode ? host.parentNode : document.body).appendChild(modal);
  modal.addEventListener('click', onClick);
  modal.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'cs-input') { e.preventDefault(); onClick({ target: modal.querySelector('[data-cs="load"]') }); } if (e.key === 'Escape') closePanel(); });
  return modal;
}
function mainView(note = '') {
  const code = myCode();
  const s = statusLine();
  const box = modal.querySelector('.cs-box'); box.className = 'modal-box cs-box cs-mainv' + (shown && code ? ' cs-hasqr' : '');
  box.innerHTML = `<h3 id="cs-title">Transfer Code</h3>
    <div class="cs-stat" data-k="${s.k}"><i></i><span>Cloud save: ${esc(s.t)}</span></div>
    ${code ? `<p class="set-note">Use this code to move your progress to another phone. Anyone with it can load your progress, so keep it private.</p>
    <div class="cs-code${shown ? '' : ' masked'}" id="cs-code" aria-live="polite">${(shown ? code : code.replace(/[0-9A-Z]/g, '\u2022')).split('-').map((g, i, a) => `<span>${esc(g)}${i < a.length - 1 ? '-' : ''}</span>`).join('')}</div>
    ${shown ? `<div class="cs-qr" aria-label="QR code of your transfer code">${qrSvg(codeUrl(code), { ecl: 'M', border: 3 })}</div><p class="cs-hint">Scan with the other phone's camera, or type the code there in Settings &gt; Transfer Code.</p>` : ''}
    <div class="row2"><button class="btn small" data-cs="show">${shown ? 'Hide Code' : 'Show Code'}</button><button class="btn small gold" data-cs="copy">Copy Code</button></div>`
    : `<p class="set-note">${status === 'off' ? 'Cloud save is off in this build. Your progress is kept on this phone; use Copy Backup Code to move it.' : status === 'revoked' ? 'The code for this phone was reset on another phone. Enter the new code below, or start a new cloud save for this phone.' : 'Your transfer code appears once cloud save connects. Your progress is safe on this phone meanwhile.'}</p>
    ${status === 'off' ? '' : `<button class="btn small wide" data-cs="${status === 'revoked' ? 'fresh' : 'retry'}">${status === 'revoked' ? 'New Cloud Save For This Phone' : 'Try Again'}</button>`}`}
    <div class="set-sec">Have a code?</div>
    <div class="cs-enter"><input id="cs-input" class="code-in cs-in" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Enter a code" aria-label="Transfer code"><button class="btn small" data-cs="load">Load</button></div>
    <p class="cs-err" id="cs-err" role="alert">${esc(note)}</p>
    ${code && moveHome() ? '<button class="btn small wide gold cs-move" data-cs="move">Open The New Site</button>' : ''}
    ${code ? '<button class="btn small wide danger cs-reset" data-cs="reset">Reset Code</button>' : ''}
    <button class="btn wide" data-cs="close">Done</button>`;
}
function confirmView(kind, data) {
  const box = modal.querySelector('.cs-box'); box.className = 'modal-box cs-box cs-confirm';
  const T = {
    load: { h: 'Replace progress?', p: 'This replaces the progress on this phone with the progress saved under that code. The other phone keeps working. This cannot be undone.', ok: 'Replace My Progress' },
    reset: { h: 'Reset code?', p: 'Your old code stops working. Any other phone using it stops syncing until you enter the new code there.', ok: 'Reset Code' },
  }[kind];
  box.innerHTML = `<h3 id="cs-title" class="red">${T.h}</h3><p class="set-note cs-warn">${T.p}</p>
    <div class="row2"><button class="btn small" data-cs="back">Cancel</button><button class="btn small danger" data-cs="ok-${kind}">${T.ok}</button></div>
    <p class="cs-err" id="cs-err" role="alert"></p>`;
  modal.dataset.pending = data || '';
  const b = box.querySelector('[data-cs="back"]'); if (b) b.focus();
}
const play = (n) => { try { H && H.sfx && H.sfx(n); } catch {} };
async function onClick(e) {
  const b = e.target && e.target.closest ? e.target.closest('[data-cs]') : null;
  if (!b) { if (e.target === modal) closePanel(); return; }
  const act = b.dataset.cs, err = (m) => { const x = modal.querySelector('#cs-err'); if (x) x.textContent = m; };
  if (act === 'close') return closePanel();
  if (act === 'show') { shown = !shown; play('tap'); return mainView(); }
  if (act === 'copy') {
    const code = myCode(); if (!code) return;
    let ok = false; try { await navigator.clipboard.writeText(code); ok = true; } catch {}
    if (!ok) { shown = true; mainView(); const el = modal.querySelector('#cs-code'); try { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ok = document.execCommand('copy'); } catch {} }
    H.toast(ok ? 'Transfer code copied' : 'Select the code to copy it'); play('tap'); return;
  }
  if (act === 'retry') { tsDeclined = false; play('tap'); b.disabled = true; await pull(); return mainView(); }
  if (act === 'fresh') { delete st.revoked; play('tap'); await startFresh(); return mainView(); }
  if (act === 'load') {
    const v = (modal.querySelector('#cs-input') || {}).value || '';
    if (!decodeCode(v)) { play('error'); return err('That code is not valid. Check it and try again.'); }
    play('select'); return confirmView('load', v);
  }
  if (act === 'reset') { play('select'); return confirmView('reset'); }
  if (act === 'move') return goHome();
  if (act === 'back') { play('tap'); return mainView(); }
  if (act === 'ok-load') {
    b.disabled = true; b.textContent = 'Loading...';
    const r = await applyCode(modal.dataset.pending);
    if (!r.ok) { play('error'); b.disabled = false; b.textContent = 'Replace My Progress'; return err(r.why); }
    play('buy'); H.toast(r.empty ? 'Linked. This phone’s progress is now saved under that code' : 'Progress loaded');
    closePanel(); try { $('#m-settings').classList.add('hidden'); } catch {}
    if (!r.empty) setTimeout(() => location.reload(), 900); // every screen re-reads the new profile
    return;
  }
  if (act === 'ok-reset') {
    b.disabled = true;
    const r = await rotate();
    if (!r.ok) { play('error'); b.disabled = false; return err(r.why); }
    play('buy'); shown = true; mainView(); H.toast('New transfer code made'); return;
  }
}
export function openPanel(prefill) {
  ensureModal(); shown = false; mainView();
  if (prefill) { const i = modal.querySelector('#cs-input'); if (i) i.value = prefill; }
  modal.classList.remove('hidden');
  const f = modal.querySelector(prefill ? '[data-cs="load"]' : '[data-cs="show"], [data-cs="retry"], #cs-input'); if (f) try { f.focus({ preventScroll: true }); } catch {}
}
export function closePanel() { if (modal) { modal.classList.add('hidden'); shown = false; } play('tap'); renderRow(); }

// ---------- 17.0 move from GitHub Pages to the Cloudflare Worker ----------
// On the old site, once the cloud copy is current, a one-time card opens the new home with the transfer code in the
// URL fragment (never sent to any server). The new home applies it at start: silently when it has no progress yet,
// with the usual confirm otherwise. ?home=<url> (kept for the tab) makes any origin act as the old site, for tests.
export const CLOUD_HOME = 'https://chess-complex.<subdomain>.workers.dev/'; // lead fills in the deployed URL
const OLD_HOSTS = ['dianteclark.github.io'];
const MOVE_KEY = 'cc_move_v1';
function moveHome() {
  let h = CLOUD_HOME, forced = false;
  try { const q = new URLSearchParams(location.search).get('home'); if (q) sessionStorage.setItem('cc_home', q); const f = sessionStorage.getItem('cc_home'); if (f) { h = f; forced = true; } } catch {}
  if (!h || /[<>]/.test(h)) return null;
  if (!forced && !OLD_HOSTS.includes(location.hostname)) return null;
  try { const u = new URL(h, location.href); return u.origin === location.origin ? null : u; } catch { return null; }
}
const moveUrl = (u, code) => { const x = new URL(u.href); x.hash = 'transfer=' + code; return x.href; };
async function goHome() {
  const u = moveHome(), code = myCode(); if (!u || !code) return;
  play('select');
  if (st.dirty || inflight) {
    H.toast('Saving your progress first...');
    for (let i = 0; i < 4 && (st.dirty || inflight); i++) { // a 429 (1 save per 2 s) just means wait a moment
      if (inflight) await inflight;
      if (retryAt > Date.now()) await new Promise((r) => setTimeout(r, retryAt - Date.now() + 150));
      await push({ direct: true });
    }
  } // the new site must get the latest copy
  if (st.dirty) { H.toast('Could not reach cloud save. Try again in a moment'); return false; }
  try { localStorage.setItem(MOVE_KEY, 'opened'); } catch {}
  location.href = moveUrl(u, code); return true;
}
let moveShown = false, moveRetry = 0;
function maybeMoveCard() {
  if (moveShown || status !== 'saved' || st.dirty || !myCode() || !moveHome()) return;
  try { if (localStorage.getItem(MOVE_KEY)) return; } catch { return; }
  if (H && H.idle && !H.idle()) return; // never during a match; the next save after it tries again
  if (document.querySelector('.modal:not(.hidden), .sequel')) { clearTimeout(moveRetry); moveRetry = setTimeout(maybeMoveCard, 4000); return; } // wait for other dialogs
  moveShown = true;
  const m = document.createElement('div'); m.id = 'm-move'; m.className = 'modal global cs-modal';
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'mv-title');
  m.innerHTML = `<div class="modal-box cs-box cs-move-box"><h3 id="mv-title">A New Home</h3>
    <p class="set-note cs-warn">Chess Complex has a new home with faster online play. Your progress is saved in the cloud and comes with you: one tap opens the new site with everything loaded.</p>
    <p class="cs-hint">This site keeps working too, and both stay in sync.</p>
    <button class="btn wide gold" data-mv="go">Open The New Site</button><button class="btn wide ghost" data-mv="later">Later</button></div>`;
  (($('#m-settings') || {}).parentNode || document.body).appendChild(m);
  m.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-mv]'); if (!b) return;
    if (b.dataset.mv === 'go') { b.disabled = true; goHome().then((ok) => { if (ok === false) b.disabled = false; else m.remove(); }); return; }
    try { localStorage.setItem(MOVE_KEY, 'later'); } catch {}
    m.remove(); play('tap'); H.toast('You can move any time from Settings > Transfer Code');
  });
  play('select');
}
// New home: #transfer=<code>
const freshProfile = (p) => !p || ((num(p.stats && p.stats.games) + num(p.games)) === 0 && num(p.level) <= 1 && !(p.season && num(p.season.xp) > 0));
async function arrive(code) {
  const c = decodeCode(code);
  if (!c || c.id === st.id) return pull();
  if (!freshProfile(H.profile())) { openPanel(code); confirmView('load', code); return; }
  const r = await applyCode(code);
  if (!r.ok) { openPanel(code); const e = modal && modal.querySelector('#cs-err'); if (e) e.textContent = r.why; return; }
  H.toast(r.empty ? 'Cloud save linked' : 'Welcome to the new home. Your progress is here');
  if (!r.empty) setTimeout(() => location.reload(), 700);
}

// ---------- init ----------
export function init(hooks) {
  if (H) return; H = hooks;
  const p = H.profile(); if (p && typeof st.lastMarks !== 'number') track(p);
  document.addEventListener('click', (e) => { const b = e.target && e.target.closest && e.target.closest('[data-act="cloud-transfer"]'); if (b) { e.preventDefault(); openPanel(); play('tap'); } });
  const ms = $('#m-settings');
  if (ms && typeof MutationObserver === 'function') new MutationObserver(() => { if (!ms.classList.contains('hidden')) { renderRow(); if (status === 'offline' || status === 'off') healthy().then((ok) => ok && pull()); } }).observe(ms, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush({ keepalive: true });
    else if (Date.now() - pulledAt > PULL_GAP) pull();
  });
  addEventListener('pagehide', () => flush({ keepalive: true }));
  addEventListener('online', () => pull());
  setInterval(renderRow, 30000);
  let t = null; try { t = new URLSearchParams(location.search).get('transfer'); } catch {}
  if (t) { try { const u = new URL(location.href); u.searchParams.delete('transfer'); history.replaceState(null, '', u); } catch {} setTimeout(() => openPanel(t), 600); }
  const takeHash = () => { let c = null; try { const m = /(?:^#|&)transfer=([0-9A-Za-z-]+)/.exec(location.hash || ''); if (m) { c = m[1]; history.replaceState(null, '', location.pathname + location.search); } } catch {} return c; };
  const h = takeHash();
  addEventListener('hashchange', () => { const c = takeHash(); if (c) arrive(c); }); // a #transfer= link opened in a tab that is already running
  renderRow();
  setTimeout(() => (h ? arrive(h) : pull()), 400); // after first paint; never blocks start-up
}

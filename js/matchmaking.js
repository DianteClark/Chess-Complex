// 17.1 (MM): public matchmaking on the cloud server. Owned by MM.
//  - Quick Play (Play screen): POST <cloud>/mm/quick {mode} -> the best open public lobby for that mode (or a new one),
//    then today's cloud join (main.js joinGame with {mode}). The Join screen shows a search / waiting / countdown card
//    instead of the code entry; the Room starts by itself when full or 45 s after a second player arrives (bots fill
//    the empty seats). Afterwards the room is a normal private party of the same players.
//  - Browse (#s-browse): GET <cloud>/mm/list -> open public lobbies (Quick Play rooms and parties a leader made Public).
//  - Public / Private switch on the cloud leader's Host screen ({t:'lead', op:'public', on}).
// Cloud only: when the server can't be reached the card says so and points at code rooms (PeerJS), which still work.
import * as CL from './cloud.js';
import { MODES } from './data.js';
import { modesIn } from './party.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const QP_MODES = () => modesIn('custom'); // same list as the server (server/src/match.js QP_MODES)
const mName = (id) => (MODES[id] || {}).name || 'Match';
const OFFLINE = 'Online matchmaking can\'t reach the Chess Complex server right now. Friend codes still work: tap Host Online on the Play screen, or Join With Code.';

let D = null; // deps from main.js: session(), screen(), go(name), join(code, qpMode|null), toast(t), sfx, profile()
const Q = { active: false, gen: 0, mode: 'royale', exclude: [], tries: 0, code: null, cdAt: 0, tick: null, last: null };
const B = { mode: '', timer: null, gen: 0, rooms: null, err: null };

export function mount(deps) {
  D = deps;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mm]'); if (!b) return;
    const a = b.dataset.mm;
    if (a === 'quick') { D.sfx.select(); quick(D.screen() === 'browse' && B.mode ? B.mode : D.profile().mode); }
    else if (a === 'retry') { D.sfx.tap(); quick(Q.mode); }
    else if (a === 'start-now') { const s = D.session(); if (s && s.cloud) { s.client.send({ t: 'lead', op: 'start' }); D.sfx.select(); } }
    else if (a === 'pub') { const s = D.session(); if (s && s.cloud && s.lead && s.lobbyMsg && !b.disabled) { s.client.send({ t: 'lead', op: 'public', on: !s.lobbyMsg.pub }); D.sfx.tap(); } }
    else if (a === 'refresh') { D.sfx.tap(); loadList(true); }
    else if (a === 'filter') { B.mode = b.dataset.v || ''; D.sfx.tap(); renderFilters(); loadList(true); }
    else if (a === 'join') { D.sfx.select(); const code = b.dataset.code, mode = b.dataset.mode; if (b.dataset.qp === '1') quick(mode, code); else { stop(); D.join(code, null); } }
  });
  setInterval(() => { if (Q.cdAt && Q.active) paintCd(); }, 250);
}

// ---------- screens ----------
export function onScreen(name) {
  if (name === 'browse') openBrowse(); else { clearInterval(B.timer); B.timer = null; }
  if (name === 'host') { const r = $('#mm-pub-row'); if (r) r.classList.add('hidden'); }
  if (name !== 'join' && name !== 'game' && Q.active) stop(); // left the Quick Play lobby (Back -> leave-lobby already parted)
  if (name === 'join' && !Q.active) clearCard();
  if (name === 'title' || name === 'play') { partyNote('', 'mm-host-note', ''); partyNote('', 'mm-join-note', ''); } // 17.1.1: never left over in a later (PeerJS) lobby
}
// Play screen: Quick Play only for party-playable modes (not Daily)
export function onPlay(mode) {
  const ok = QP_MODES().includes(mode), q = $('#btn-quick'), sub = $('#mm-quick-sub');
  if (q) q.classList.toggle('hidden', !ok);
  if (sub) sub.textContent = ok ? `${(MODES[mode] || {}).short || ''} online` : '';
  const row = $('#mm-row'); if (row) row.classList.toggle('solo', !ok);
}

// ---------- Quick Play ----------
function stop() { Q.active = false; Q.gen++; Q.cdAt = 0; Q.code = null; clearCard(); }
function clearCard() { const c = $('#mm-card'); if (c) { c.classList.add('hidden'); c.innerHTML = ''; } const j = $('#s-join'); if (j) { j.classList.remove('mm-qp'); const h = j.querySelector('.bar h2'); if (h && h.dataset.mm) { h.textContent = h.dataset.mm; delete h.dataset.mm; } } }
function showCard(html) {
  const j = $('#s-join'), c = $('#mm-card'); if (!j || !c) return;
  j.classList.add('mm-qp');
  const h = j.querySelector('.bar h2'); if (h && !h.dataset.mm) { h.dataset.mm = h.textContent; h.textContent = 'Quick Play'; }
  c.classList.remove('hidden'); c.innerHTML = html;
}
const head = (mode, chip) => `<div class="mm-head"><span class="mm-glyph"><svg><use href="#m-bolt"/></svg></span><div><b>${esc(mName(mode))}</b><em>${esc(chip)}</em></div></div>`;
function searching(text, sub) { showCard(`${head(Q.mode, 'Quick Play')}<div class="mm-state"><span class="mm-spin" aria-hidden="true"></span><div><b>${esc(text)}</b><p>${esc(sub || '')}</p></div></div>`); }
function failed(text, offline) {
  Q.cdAt = 0;
  showCard(`${head(Q.mode, offline ? 'Offline' : 'Quick Play')}<div class="mm-state err"><div><b>${offline ? 'Can\'t reach the online server' : 'No match this time'}</b><p>${esc(text)}</p></div></div><div class="row2"><button class="btn small" data-go="play">Back to Play</button><button class="btn small gold" data-mm="retry">Try Again</button></div>`);
  D.sfx.error();
}
// mode = the mode to play; code = a Quick Play room picked in Browse (joined directly, Matchmaker skipped)
export async function quick(mode, code) {
  if (!QP_MODES().includes(mode)) mode = 'royale';
  const fresh = !Q.active || Q.mode !== mode;
  Q.active = true; Q.mode = mode; Q.cdAt = 0; Q.code = null; if (fresh) { Q.exclude = []; Q.tries = 0; }
  const g = ++Q.gen;
  if (D.screen() !== 'join') D.go('join');
  { const s = D.session(); if (s) D.endSession(); }
  searching(code ? 'Joining match...' : `Finding a ${mName(mode)} match...`, code ? '' : 'Looking for an open lobby near you');
  if (!CL.endpoint()) { failed(OFFLINE, true); return; }
  const up = await CL.healthy(); if (g !== Q.gen) return;
  if (!up) { failed(OFFLINE, true); return; }
  if (!code) {
    let r = null, j = null;
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
      r = await fetch(CL.endpoint() + '/mm/quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, exclude: Q.exclude }), signal: ctl.signal }).finally(() => clearTimeout(to));
      j = await r.json().catch(() => null);
    } catch {}
    if (g !== Q.gen) return;
    if (!r) { CL.markDown(); failed(OFFLINE, true); return; }
    if (r.status === 429) { failed(`Too many searches. Try again in ${Math.max(5, (j && j.retry) || 60)} seconds.`); return; }
    if (r.status === 409) { failed((j && j.why) || 'You already have open public matches.'); return; }
    if (!r.ok || !j || typeof j.code !== 'string') { failed('The matchmaker is busy. Try again in a moment.'); return; }
    code = j.code;
  }
  Q.code = code;
  searching(`Joining ${mName(mode)} lobby...`, '');
  D.join(code, mode);
}
// the Room turned us away before we got a seat (full / started / gone): ask again without that room, twice at most
export function retry(code, why) {
  if (!Q.active) return false;
  if (code && !Q.exclude.includes(code)) Q.exclude.push(code);
  if (++Q.tries > 3) { failed(why === 'network' ? OFFLINE : 'Every open lobby filled up. Try again.', why === 'network'); return true; }
  if (why === 'network') { failed(OFFLINE, true); return true; }
  setTimeout(() => { if (Q.active) quick(Q.mode); }, 300);
  return true;
}

// Every cloud lobby message (main.js cloudLobby): the Quick Play card while the room is a Quick Play lobby, the
// Public switch for the leader of a normal cloud party.
export function lobby(sess, m) {
  if (!m) return;
  if (m.qp) {
    Q.active = true; Q.mode = MODES[m.mode] ? m.mode : Q.mode; Q.code = m.code;
    const players = Array.isArray(m.players) ? m.players : [], cap = m.maxP || players.length || 8;
    const humans = players.filter((p) => !p.isBot).length, lead = !!sess.myPid && m.leader === sess.myPid;
    Q.cdAt = m.cd > 0 ? Date.now() + m.cd : 0;
    const dots = Array.from({ length: cap }, (_, i) => `<i class="${i < humans ? 'on' : ''}"></i>`).join('');
    const body = Q.cdAt
      ? `<div class="mm-cd"><b id="mm-cd">${Math.ceil(m.cd / 1000)}</b><div><b>Match starts in</b><p>${humans >= cap ? 'Every seat is filled.' : 'Empty seats are filled with bots.'}</p></div></div>`
      : `<div class="mm-state"><span class="mm-spin" aria-hidden="true"></span><div><b>Waiting for players</b><p>${humans < 2 ? 'The countdown starts when a second player joins.' : ''}</p></div></div>`;
    showCard(`${head(Q.mode, 'Quick Play')}<div class="mm-seats" aria-label="${humans} of ${cap} players"><span>${humans} / ${cap} players</span><div class="mm-dots">${dots}</div></div>${body}${lead && humans < 2 && !Q.cdAt ? '<button class="btn small wide" data-mm="start-now">Start Now With Bots</button>' : ''}`);
    paintCd();
    const st = $('#join-status'); if (st && !st.classList.contains('err')) st.textContent = '';
    return;
  }
  if (Q.active && Q.code === m.code) { Q.active = false; Q.cdAt = 0; clearCard(); } // the match ended: now a normal party
  // 17.1.1: a party that came from Quick Play says so (same players, private, nobody new is matched into it)
  partyNote('#s-host .code-panel', 'mm-host-note', m.fromQp && sess.lead ? 'Your Quick Play group: same players, now a private party. Start a rematch when everyone is ready, or switch to Public to fill the open seats.' : '');
  partyNote('#join-lobby-panel', 'mm-join-note', m.fromQp && !sess.lead ? 'Your Quick Play group: same players, now a private party. Ready up for a rematch, or tap Back and Quick Play again.' : '');
  const row = $('#mm-pub-row'), btn = $('#mm-pub'), note = $('#mm-pub-note');
  if (!row) return;
  const show = !!(sess.cloud && sess.lead);
  row.classList.toggle('hidden', !show); if (!show) return;
  const live = !!(m.party && m.party.live);
  btn.setAttribute('aria-checked', String(!!m.pub)); btn.classList.toggle('on', !!m.pub); btn.disabled = live;
  note.textContent = m.pub ? 'Public: listed in Browse. Anyone can join while seats are free.' : 'Private: only players with the code can join.';
}
function partyNote(parentSel, id, text) {
  let n = document.getElementById(id);
  if (!text) { if (n) n.remove(); return; }
  const host = $(parentSel); if (!host) return;
  if (!n) { n = document.createElement('p'); n.id = id; n.className = 'mm-party-note'; n.setAttribute('role', 'status'); const lbl = host.querySelector('.lbl'); host.insertBefore(n, lbl ? lbl.nextSibling : host.firstChild); }
  n.textContent = text;
}
function paintCd() {
  const el = $('#mm-cd'); if (!el || !Q.cdAt) return;
  el.textContent = String(Math.max(0, Math.ceil((Q.cdAt - Date.now()) / 1000)));
}

// ---------- Browse ----------
function renderFilters() {
  const el = $('#mm-filters'); if (!el) return;
  el.innerHTML = [['', 'All'], ...QP_MODES().map((id) => [id, (MODES[id] || {}).short || id])].map(([v, n]) => `<button class="${B.mode === v ? 'on' : ''}" data-mm="filter" data-v="${v}" role="tab" aria-selected="${B.mode === v}">${esc(n)}</button>`).join('');
}
function openBrowse() {
  renderFilters(); loadList(false);
  clearInterval(B.timer); B.timer = setInterval(() => { if (D.screen() === 'browse' && !document.hidden) loadList(false, true); }, 8000);
}
async function loadList(user, quiet) {
  const el = $('#mm-list'); if (!el) return;
  const g = ++B.gen;
  if (!quiet) el.innerHTML = '<div class="mm-empty"><span class="mm-spin" aria-hidden="true"></span><p>Looking for open matches...</p></div>';
  if (!CL.endpoint()) { B.rooms = null; paintList(OFFLINE); return; }
  const up = await CL.healthy(); if (g !== B.gen) return;
  if (!up) { paintList(OFFLINE); return; }
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(CL.endpoint() + '/mm/list' + (B.mode ? '?mode=' + encodeURIComponent(B.mode) : ''), { cache: 'no-store', signal: ctl.signal }).finally(() => clearTimeout(to));
    if (g !== B.gen) return;
    if (r.status === 429) { paintList('Too many refreshes. Wait a moment and try again.'); return; }
    const j = await r.json(); B.rooms = Array.isArray(j.rooms) ? j.rooms : []; paintList(null);
  } catch { if (g === B.gen) { CL.markDown(); paintList(OFFLINE); } }
}
function paintList(err) {
  const el = $('#mm-list'); if (!el) return;
  const qb = $('#mm-browse-quick'); if (qb) qb.textContent = B.mode ? `Quick Play ${(MODES[B.mode] || {}).short || ''}` : 'Quick Play';
  if (err) { el.innerHTML = `<div class="mm-empty err"><svg><use href="#m-globe"/></svg><b>Can't load open matches</b><p>${esc(err)}</p><button class="btn small" data-mm="refresh">Try Again</button></div>`; return; }
  const rooms = B.rooms || [];
  if (!rooms.length) { el.innerHTML = `<div class="mm-empty"><svg><use href="#m-users"/></svg><b>No open ${B.mode ? esc(mName(B.mode)) + ' ' : ''}matches right now</b><p>Tap Quick Play to open one. Players who search for the same mode land in it.</p></div>`; return; }
  el.innerHTML = rooms.map((r) => {
    const tag = r.qp ? (r.st === 'starting' ? 'Starting soon' : 'Quick Play') : 'Hosted party', near = r.near === 2 ? '<span class="mm-near">Near you</span>' : '';
    return `<div class="mm-room ${r.st === 'starting' ? 'hot' : ''}"><span class="mm-glyph"><svg><use href="#${r.qp ? 'm-bolt' : 'm-users'}"/></svg></span><div class="mm-info"><b>${esc(mName(r.mode))}</b><em>${esc(tag)}${near}</em></div><div class="mm-n"><b>${r.n}/${r.cap}</b><span>players</span></div><button class="btn small gold" data-mm="join" data-code="${esc(r.code)}" data-mode="${esc(r.mode)}" data-qp="${r.qp ? 1 : 0}" aria-label="Join ${esc(mName(r.mode))}, ${r.n} of ${r.cap} players">Join</button></div>`;
  }).join('');
}

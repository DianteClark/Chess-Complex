// 15.0 (N): parties. A party is the host's room kept alive between matches: after results everyone taps
// Back to Party and lands in the party lobby again. The leader (the host) picks the mode group, mode, location and
// Custom rules and fills seats with bots; members ready up; the leader can start once every member is ready.
// If the leader leaves, members are told and the party closes. Logic and markup live here; looks are F's (.party-*).
import { MODES } from './data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const GROUPS = [['competitive', 'Competitive'], ['coop', 'Co-op'], ['party', 'Party'], ['custom', 'Custom']];
const FALLBACK_GROUP = { royale: 'competitive', blitz: 'competitive', duel: 'competitive', squads: 'competitive', siege: 'coop', gauntlet: 'coop', hill: 'party', chaos: 'party', daily: 'challenge', mirror: 'challenge' };
export const groupOf = (id) => (MODES[id] && MODES[id].group) || FALLBACK_GROUP[id] || 'competitive';
// Modes a party can play: everything but the solo challenge modes (Daily, and the retired Mirror id).
const playable = (id) => MODES[id] && !MODES[id].hidden && !MODES[id].retired && groupOf(id) !== 'challenge' && id !== 'custom';
export const modesIn = (g) => Object.keys(MODES).filter((id) => playable(id) && (g === 'custom' || groupOf(id) === g));

// Custom rules. Keys and defaults follow W's `opts.custom` (see V10_NOTES); only sent when the group is Custom.
export const RULES = [
  { k: 'mirror', name: 'Mirror builds', opts: [[false, 'Off'], [true, 'On']], def: false, desc: 'Everyone plays the same random build.' },
  { k: 'hazards', name: 'Hazards', opts: [[true, 'On'], [false, 'Off']], def: true, desc: 'Location hazards on the board.' },
  { k: 'storm', name: 'Storm', opts: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], def: 'normal', desc: 'How fast the ring closes.' },
  { k: 'events', name: 'World events', opts: [[true, 'On'], [false, 'Off']], def: true, desc: 'Location events during the match.' },
];
export const defaultRules = () => Object.fromEntries(RULES.map((r) => [r.k, r.def]));
export function cleanRules(c) {
  const out = defaultRules(); if (!c || typeof c !== 'object') return out;
  for (const r of RULES) if (r.opts.some(([v]) => v === c[r.k])) out[r.k] = c[r.k];
  return out;
}

// Locations come from W's js/locations.js (LOCATIONS keyed by id, or a list). Until it exists the picker shows Random only.
let LOCS = [];
import('./locations.js').then((m) => { const L = m.LOCATIONS || m.default || {}; LOCS = (Array.isArray(L) ? L : Object.entries(L).map(([id, v]) => ({ id, ...v }))).filter((l) => l && l.id && l.name); D && D.rerender && D.rerender(); }).catch(() => {});
export const locations = () => LOCS;
const locName = (id) => (id && id !== 'random' ? (LOCS.find((l) => l.id === id) || {}).name || id : 'Random');

let D = null; // deps from main.js
export function mount(deps) {
  D = deps;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-party]'); if (!b) return;
    const s = D.session(); if (!s) return;
    const a = b.dataset.party, v = b.dataset.v;
    if (a === 'ready' && s.mode === 'client') { if (b.disabled) return; s.client.send({ t: 'ready', on: !s.amReady }); s.amReady = !s.amReady; renderMember(s); D.sfx.select(); return; }
    if (s.cloud) { if (s.lead) cloudLead(s, a, v, b); return; } // 17.0 (N2): cloud party: the Room owns the options
    if (s.mode !== 'host' || s.started) return;
    const P = hostParty(s);
    if (a === 'group') { const list = modesIn(v); if (!list.length) return; P.group = v; if (v !== 'custom' && groupOf(s.gameMode) !== v) setMode(s, list[0]); else if (v === 'custom') P.custom ||= defaultRules(); }
    else if (a === 'mode') { if (!modesIn(P.group).includes(v)) return; setMode(s, v); }
    else if (a === 'loc') P.loc = v === 'random' || LOCS.some((l) => l.id === v) ? v : 'random';
    else if (a === 'rule') { const r = RULES.find((x) => x.k === b.dataset.k); if (!r) return; const o = r.opts.find(([x]) => String(x) === v); if (!o) return; (P.custom ||= defaultRules())[r.k] = o[0]; }
    else if (a === 'clear-bots') { s.players = s.players.filter((p) => !p.isBot); }
    else return;
    D.sfx.tap(); s.renderLobby();
  });
}

// ---------- leader (host) ----------
// F: the Custom card can open the lobby on the Custom group with go('host'); party.setGroup(session, 'custom').
export function setGroup(s, g) { if (!s || s.mode !== 'host' || !modesIn(g).length) return; const P = hostParty(s); P.group = g; if (g === 'custom') P.custom ||= defaultRules(); else if (groupOf(s.gameMode) !== g) setMode(s, modesIn(g)[0]); s.renderLobby && s.renderLobby(); }
export function hostParty(s) {
  if (!s.party) s.party = { group: s.custom ? 'custom' : groupOf(s.gameMode), loc: 'random', custom: s.custom ? defaultRules() : null, ready: new Set(), back: new Set() };
  if (s.party.group === 'challenge') s.party.group = 'competitive';
  return s.party;
}
function setMode(s, id) {
  const M = MODES[id]; if (!M) return;
  const max = M.players[1], humans = s.players.filter((p) => !p.isBot).length;
  if (humans > max) { D.toast(`${M.name} seats ${max}. Remove someone first.`); D.sfx.error(); return; }
  s.gameMode = id; s.maxP = max;
  while (s.players.length > max) { const i = s.players.map((p) => !!p.isBot).lastIndexOf(true); if (i < 0) break; s.players.splice(i, 1); }
  const pf = D.profile(); if (pf && pf.mode !== id) { pf.mode = id; D.save(); }
}
// What the engine gets: { location?, custom? }
export function matchOpts(s) {
  const P = hostParty(s), o = {};
  if (P.group === 'custom' && P.loc && P.loc !== 'random') o.location = P.loc; // 17.0 (D2): the leader picks the location only in Custom; every other match rolls one
  if (P.group === 'custom') o.custom = cleanRules(P.custom);
  return o;
}
// Members who still have to ready up (bots and the leader always count as ready).
// A member whose link dropped in the lobby (p.away) does not hold the party up; Start leaves them out.
export function waiting(s) { const P = hostParty(s); return s.players.filter((p) => p.pid !== 'me' && !p.isBot && !p.away && !P.ready.has(p.pid)); }
export const AWAY_MS = 20000;
// Lobby link dropped without a goodbye: keep the seat (and ready state) for AWAY_MS so an automatic reconnect lands
// back in it. Returns false when the member left on purpose (sent 'part'), so the caller removes them now.
export function lobbyDrop(s, conn) {
  if (conn.parted) return false;
  const p = s.players.find((x) => x.pid === conn.pid); if (!p) return false;
  p.away = true;
  clearTimeout(p.awayT);
  p.awayT = setTimeout(() => { if (s.dead || s.started || !p.away || s.conns.has(p.pid)) return; dropMember(s, p.pid); s.players = s.players.filter((x) => x !== p); s.renderLobby(); }, AWAY_MS);
  return true;
}
export function lobbyBack(s, pid) { const p = s.players.find((x) => x.pid === pid); if (p && p.away) { p.away = false; clearTimeout(p.awayT); } }
export function canStart(s) {
  const w = waiting(s); if (w.length) return { ok: false, why: `Waiting for ${w.length === 1 ? w[0].name : w.length + ' players'} to ready up` };
  return { ok: true };
}
// Host message handler for party messages; returns true when it handled m.
export function hostMsg(s, conn, m) {
  const P = hostParty(s);
  if (m.t === 'ready') { if (s.started) return true; if (m.on) P.ready.add(conn.pid); else P.ready.delete(conn.pid); P.back.add(conn.pid); s.renderLobby(); return true; }
  if (m.t === 'part') { conn.parted = true; return true; }
  if (m.t === 'back') { P.back.add(conn.pid); if (!s.started) s.renderLobby(); return true; }
  return false;
}
export function dropMember(s, pid) { const P = hostParty(s); P.ready.delete(pid); P.back.delete(pid); }
// Called when the leader starts a match: everyone has to ready up again for the next one.
export function onStart(s) { const P = hostParty(s); P.ready.clear(); P.back.clear(); s.mid = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); return s.mid; }
// Public party info that rides on the lobby message.
export function pub(s) {
  const P = hostParty(s);
  const loc = P.group === 'custom' ? P.loc : 'random'; // 17.0 (D2)
  return { group: P.group, mode: s.gameMode, loc, locName: locName(loc), custom: P.group === 'custom' ? cleanRules(P.custom) : null, live: !!s.started, leader: (s.players[0] || {}).name || 'Leader' };
}
// leader | bot | ready | wait (in the lobby, not ready) | results (still on the last match's results) | away (reconnecting)
export function memberState(s, p) {
  const P = hostParty(s);
  const live = s.players.find((x) => x.pid === p.pid);
  if (live && live.away) return 'away';
  return p.pid === 'me' ? 'leader' : p.isBot ? 'bot' : P.ready.has(p.pid) ? 'ready' : s.mid && !P.back.has(p.pid) ? 'results' : 'wait';
}

function seg(act, cur, list, extra = '') { return `<div class="party-seg" role="group">${list.map(([v, l]) => `<button type="button" data-party="${act}" data-v="${esc(String(v))}"${extra} class="${String(v) === String(cur) ? 'on' : ''}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('')}</div>`; }
function optsHTML(P, gameMode) {
  const modes = modesIn(P.group).map((id) => [id, MODES[id].short || MODES[id].name]);
  const locs = [['random', 'Random'], ...LOCS.map((l) => [l.id, l.name])];
  let h = `<div class="lbl">Party</div>`;
  h += `<div class="party-row"><span>Group</span>${seg('group', P.group, GROUPS.filter(([g]) => modesIn(g).length))}</div>`;
  h += `<div class="party-row"><span>Mode</span>${seg('mode', gameMode, modes)}</div>`;
  if (MODES[gameMode]) h += `<p class="party-desc">${esc(MODES[gameMode].desc || '')}</p>`;
  // 17.0 (D2): location picker only in Custom; elsewhere the wheel rolls a random location every match
  h += P.group === 'custom' ? `<div class="party-row party-loc"><span>Location</span>${seg('loc', P.loc, locs)}</div>` : `<div class="party-row party-loc"><span>Location</span><b>Random every match</b></div>`;
  if (P.group === 'custom') { const c = cleanRules(P.custom); h += RULES.map((r) => `<div class="party-row party-rule"><span>${esc(r.name)}</span>${seg('rule', c[r.k], r.opts, ` data-k="${r.k}"`)}</div>`).join(''); }
  return h;
}
function startBtn(players, gameMode, st) {
  const bots = players.some((p) => p.isBot), cb = $('#s-host [data-party="clear-bots"]'); if (cb) cb.disabled = !bots;
  const btn = $('#btn-start-host'); if (!btn) return;
  const minP = Math.max(2, MODES[gameMode].players[0]);
  if (players.length < minP) { btn.disabled = true; btn.textContent = `Needs ${minP} players`; }
  else if (!st.ok) { btn.disabled = true; btn.textContent = st.why; }
  else { btn.disabled = false; btn.textContent = 'Start Match'; }
}
export function renderHost(s) {
  const el = $('#party-opts'); if (!el) return;
  el.innerHTML = optsHTML(hostParty(s), s.gameMode);
  startBtn(s.players, s.gameMode, canStart(s));
}

// ---------- 17.0 (N2): cloud party leader ----------
// In a cloud room the leader is a client too: the options come from the server's lobby message (s.party = pub info,
// s.players = seats with st) and every control sends {t:'lead', op, ...}; the Room validates and broadcasts the lobby.
function cloudLead(s, a, v, b) {
  const P = s.party || {}, send = (o) => s.client.send({ t: 'lead', ...o });
  if (P.live && a !== 'clear-bots') return;
  if (a === 'group') { if (!modesIn(v).length || v === P.group) return; send({ op: 'group', group: v }); }
  else if (a === 'mode') {
    const M = MODES[v]; if (!M || !modesIn(P.group || groupOf(v)).includes(v)) return;
    const humans = (s.players || []).filter((p) => !p.isBot).length;
    if (humans > M.players[1]) { D.toast(`${M.name} seats ${M.players[1]}. Remove someone first.`); D.sfx.error(); return; }
    send({ op: 'mode', mode: v });
    const pf = D.profile(); if (pf && pf.mode !== v) { pf.mode = v; D.save(); }
  }
  else if (a === 'loc') { const loc = v === 'random' || LOCS.some((l) => l.id === v) ? v : 'random'; send({ op: 'location', loc, location: loc }); }
  else if (a === 'rule') { const r = RULES.find((x) => x.k === b.dataset.k); if (!r) return; const o = r.opts.find(([x]) => String(x) === v); if (!o) return; send({ op: 'custom', custom: { ...cleanRules(P.custom), [r.k]: o[0] } }); }
  else if (a === 'clear-bots') send({ op: 'clear-bots' });
  else return;
  D.sfx.tap();
}
// Members who still have to ready up, from the server's seat states.
export function cloudWaiting(s) { return (s.players || []).filter((p) => !p.isBot && p.st !== 'leader' && p.st !== 'ready' && p.st !== 'away'); }
export function renderCloudHost(s) {
  const el = $('#party-opts'); if (!el) return;
  const P = s.party || {}, gm = MODES[s.gameMode] ? s.gameMode : 'royale';
  const view = { group: P.group && GROUPS.some(([g]) => g === P.group) ? P.group : groupOf(gm), loc: P.loc || 'random', custom: P.custom || null };
  el.innerHTML = optsHTML(view, gm);
  const w = cloudWaiting(s);
  const st = P.live ? { ok: false, why: 'Match in progress' } : w.length ? { ok: false, why: `Waiting for ${w.length === 1 ? w[0].name : w.length + ' players'} to ready up` } : { ok: true };
  startBtn(s.players || [], gm, st);
}

// ---------- member (client) ----------
export function onLobby(s, m) {
  s.lobbyMsg = m; s.party = m.party && typeof m.party === 'object' ? m.party : null;
  const mine = (Array.isArray(m.players) ? m.players : []).find((p) => p.pid === s.myPid);
  if (mine) s.amReady = mine.st === 'ready';
  renderMember(s);
}
export function renderMember(s) {
  const P = s.party, el = $('#join-party-opts'), btn = $('#btn-ready');
  $('#s-join').classList.toggle('in-party', !!s.myPid && !s.byeReason);
  if (!el || !btn) return;
  if (!P || s.byeReason) { el.innerHTML = ''; btn.classList.add('hidden'); return; }
  const M = MODES[P.mode] || MODES.royale, g = (GROUPS.find(([k]) => k === P.group) || [0, ''])[1];
  const rules = P.custom ? RULES.map((r) => `${r.name}: ${(r.opts.find(([v]) => v === P.custom[r.k]) || [0, '-'])[1]}`).join(', ') : '';
  el.innerHTML = `<div class="party-row"><span>Mode</span><b>${esc(M.name)}</b>${g ? `<em>${esc(g)}</em>` : ''}</div><div class="party-row party-loc"><span>Location</span><b>${esc(P.group === 'custom' ? P.locName || 'Random' : 'Random every match')}</b></div>${rules ? `<div class="party-row party-rule"><span>Rules</span><b>${esc(rules)}</b></div>` : ''}`;
  btn.classList.remove('hidden');
  btn.disabled = !!P.live;
  btn.classList.toggle('on', !!s.amReady && !P.live);
  btn.setAttribute('aria-pressed', String(!!s.amReady && !P.live));
  btn.textContent = P.live ? 'Match in progress' : s.amReady ? 'Ready' : 'Ready Up';
  const hint = $('#join-lobby-panel .hint');
  if (hint) hint.textContent = P.live ? 'The match is still running. You can ready up for the next one when it ends.' : s.amReady ? `Ready. Waiting for ${P.leader} to start...` : 'Tap Ready Up when you are set.';
}
// Member taps Back to Party on the results screen.
export function backToParty(s) {
  if (!s || s.mode !== 'client' || s.byeReason) return false;
  s.benched = true; s.amReady = false;
  s.client.send({ t: 'back' });
  if (s.cloud && s.lead) { D.go('host'); return true; } // 17.0 (N2): the cloud leader's party lobby is the Host screen
  D.go('join');
  const st = $('#join-status'); st.textContent = 'In the party lobby.'; st.classList.remove('err');
  if (s.lobbyMsg) D.drawLobby(s.lobbyMsg);
  $('#join-lobby-panel').classList.remove('hidden');
  renderMember(s);
  return true;
}
// The party is gone for this member (leader left, kicked, full, lost connection): clear every trace of the lobby.
export function clearMember(s) {
  netBanner(null);
  $('#join-lobby-panel').classList.add('hidden'); $('#join-lobby').innerHTML = '';
  const el = $('#join-party-opts'); if (el) el.innerHTML = '';
  const b = $('#btn-ready'); if (b) b.classList.add('hidden');
  $('#s-join').classList.remove('in-party');
  if (s) { s.lobby = []; s.lobbyMsg = null; s.party = null; s.amReady = false; }
  // results: no way back to a party that no longer exists; say so on the card
  const rb = $('#btn-rematch'); if (rb && s && s.mode === 'client') rb.classList.add('hidden');
  if (s && s.byeReason && s.mode === 'client') resultsNote(s.byeReason === 'lost' ? 'Lost connection to the party.' : s.byeReason === 'kicked' ? 'The leader removed you from the party.' : 'The party leader left, so the party has closed.');
}
export function resultsNote(text) {
  const box = $('#r-box'); if (!box) return;
  let n = $('#r-partynote');
  if (!text) { if (n) n.remove(); return; }
  if (!n) { n = document.createElement('div'); n.id = 'r-partynote'; n.className = 'r-partynote'; n.setAttribute('role', 'status'); const row = box.querySelector('.row2'); box.insertBefore(n, row || null); }
  n.textContent = text;
}
// Fresh join screen (nothing left over from an earlier party).
export function resetJoin() { clearMember(null); resultsNote(null); const st = $('#join-status'); if (st) { st.textContent = ''; st.classList.remove('err'); } }

// Results button: solo "Play Again"; online "Back to Party" once there is a party lobby to go back to.
export function rematchButton(s, st, liveSpec) {
  const b = $('#btn-rematch'); if (!b) return;
  const online = s && (s.mode === 'host' || s.mode === 'client');
  b.textContent = online ? 'Back to Party' : 'Play Again';
  let show;
  if (!s || s.mode === 'solo' || s.mode === 'tutorial') show = !liveSpec;
  else if (s.mode === 'host') show = !!(st && st.over) && !liveSpec;
  else { const me = st && st.units.find((u) => u.pid === s.myPid); show = !s.byeReason && !!st && (st.over || !me || !me.alive || !!s.benched); }
  b.classList.toggle('hidden', !show);
}

// ---------- connection banner (member reconnecting) ----------
export function netBanner(text) {
  let el = $('#net-banner');
  if (!text) { if (el) el.classList.add('hidden'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'net-banner'; el.className = 'net-banner hidden'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.innerHTML = `<span class="nb-spin" aria-hidden="true"></span><span>${esc(text)}</span>`;
  el.classList.remove('hidden');
}

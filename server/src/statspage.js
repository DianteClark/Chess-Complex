// 17.0 (A): the /admin dashboard page (one self-contained HTML document, no external requests). Owned by A.
// Data comes from /admin/data (same origin, cookie or Bearer). Charts are inline SVG built in the page.
import { PIECES, ASCEND, PASSIVES, ABILITIES, MODES, PRESETS } from '../../js/data.js';
import { LOCATIONS } from '../../js/locations.js';

const map = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v, k)]));
const NAMES = {
  piece: { ...map(PIECES, (v) => v.name), ...Object.fromEntries(Object.entries(ASCEND).map(([k, v]) => ['asc-' + k, v.name])), 'coop-win': 'Co-op win', 'coop-loss': 'Co-op loss', '-': 'No winner' },
  road: { queen: 'Queen road', rook: 'Rook road', ascend: 'Ascension', pawn: 'Pawn line', early: 'Stayed early', '-': 'None' },
  preset: { ...map(PRESETS, (v) => v.name), custom: 'Custom build' },
  passive: { ...map(PASSIVES, (v) => v.name), none: 'None' },
  ability: map(ABILITIES, (v) => v.name),
  mode: map(MODES, (v) => v.name),
  loc: { ...map(LOCATIONS, (v) => v.name), none: 'No location' },
};
const esc = (s) => String(s).replace(/</g, '\\u003c');

const CSS = `
:root{--bg:#0b0a10;--bg2:#13111b;--panel:#16131f;--line:rgba(214,176,92,.28);--gold:#d6b05c;--gold2:#ffe3a1;--ink:#ece6f6;--mute:#9a93ad;--dim:#5f5873;--good:#5cff9d;--bad:#ff4d6d}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 'Chakra Petch',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
body{background:radial-gradient(1200px 500px at 50% -200px,#2a2033 0,transparent 70%),var(--bg);min-height:100vh}
h1,h2{font-family:Cinzel,'Trajan Pro',Georgia,'Times New Roman',serif;font-weight:700;letter-spacing:.06em;margin:0}
h1{font-size:18px;color:var(--gold2)}h1 small{display:block;font:600 11px/1.2 system-ui,sans-serif;letter-spacing:.32em;color:var(--gold);text-transform:uppercase;opacity:.85}
h2{font-size:14px;color:var(--gold);margin-bottom:8px;text-transform:uppercase}
header{position:sticky;top:0;z-index:5;background:rgba(11,10,16,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:10px 12px 8px}
.top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.top a{color:var(--mute);font-size:12px;text-decoration:none;padding:10px 4px}
.ctl{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.seg{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.seg button{background:none;border:0;color:var(--mute);font:600 12px system-ui,sans-serif;min-height:40px;padding:0 11px;cursor:pointer}
.seg button.on{background:linear-gradient(180deg,#e9c46a,#a77c2c);color:#1a1206}
select,input[type=date],.btn{background:var(--bg2);color:var(--ink);border:1px solid var(--line);border-radius:10px;min-height:40px;padding:0 10px;font:600 12px system-ui,sans-serif}
.btn{display:inline-flex;align-items:center;text-decoration:none;color:var(--gold2);cursor:pointer}
main{padding:12px;display:grid;gap:12px;grid-template-columns:1fr;max-width:1400px;margin:0 auto}
@media(min-width:760px){main{grid-template-columns:repeat(2,minmax(0,1fr))}.wide{grid-column:1/-1}}
@media(min-width:1180px){main{grid-template-columns:repeat(3,minmax(0,1fr))}}
.card{background:linear-gradient(180deg,rgba(30,25,42,.9),rgba(18,16,26,.92));border:1px solid var(--line);border-radius:14px;padding:12px;min-width:0}
.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}@media(min-width:760px){.kpis{grid-template-columns:repeat(4,1fr)}}@media(min-width:1180px){.kpis{grid-template-columns:repeat(8,1fr)}}
.kpi{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:8px 10px}
.kpi b{display:block;font:700 22px/1.1 Cinzel,Georgia,serif;color:var(--gold2)}.kpi span{font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:.08em}
.note{color:var(--mute);font-size:12px;margin:4px 0 8px}
svg{display:block;width:100%;height:auto}svg text{font-family:system-ui,sans-serif}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}th,td{padding:5px 4px;text-align:right;border-bottom:1px solid rgba(214,176,92,.12);white-space:nowrap}
th{color:var(--mute);font-weight:600;font-size:11px;text-transform:uppercase}th:first-child,td:first-child{text-align:left;white-space:normal}
.tw{overflow-x:auto}.low{color:var(--dim)}.empty{color:var(--mute);padding:20px 0;text-align:center}
details summary{color:var(--mute);font-size:12px;cursor:pointer;min-height:32px;display:flex;align-items:center}
.err{color:var(--bad)}`;

const JS = `
const NAMES = __NAMES__;
const $ = (s) => document.querySelector(s);
const st = { r: 'week', d: new Date().toISOString().slice(0, 10), m: '', who: 'h' };
try { Object.assign(st, JSON.parse(sessionStorage.getItem('ccadm') || '{}')); } catch {}
let D = null;
const nm = (dim, k) => (NAMES[dim] && NAMES[dim][k]) || k;
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
const f1 = (a, b) => (b ? (a / b).toFixed(1) : '-');
const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function q() { return new URLSearchParams({ r: st.r, d: st.d, ...(st.m ? { m: st.m } : {}) }).toString(); }
async function load() {
  sessionStorage.setItem('ccadm', JSON.stringify(st));
  for (const b of document.querySelectorAll('#seg button')) b.classList.toggle('on', b.dataset.r === st.r);
  $('#d').value = st.d; $('#who').value = st.who; $('#d').disabled = st.r === 'all';
  $('#csv').href = '/admin/csv?' + q();
  try {
    const r = await fetch('/admin/data?' + q(), { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/admin'; return; }
    D = await r.json(); if (D.error) throw new Error(D.msg || D.error);
    render();
  } catch (e) { $('#main').innerHTML = '<div class="card wide err">Could not load stats: ' + h(e.message) + '</div>'; }
}
// sum rows by (dim, k) over modes; who folds .h/.b
function agg(dim, who = st.who) {
  const out = {};
  for (const r of D.rows) {
    const [d, w] = r.dim.split('.');
    if (d !== dim) continue;
    if (w && who !== 'a' && w !== who) continue;
    const o = (out[r.k] ||= { k: r.k, n: 0, win: 0, place: 0, top3: 0, x: 0, y: 0 });
    for (const c of ['n', 'win', 'place', 'top3', 'x', 'y']) o[c] += r[c];
  }
  return Object.values(out);
}
function meta() { const o = {}; for (const r of agg('meta')) o[r.k] = r.n; return o; }
function metaBy() { const o = {}; for (const r of D.rows) if (r.dim === 'meta') { (o[r.m] ||= {})[r.k] = ((o[r.m] || {})[r.k] || 0) + r.n; } return o; }
// horizontal bars: items [{label, v (0..1 or count), text, title, low}], ref = optional reference line value
function hbars(items, { max, ref, refLabel } = {}) {
  if (!items.length) return '<div class="empty">No data in this range</div>';
  const W = 340, L = 118, R = 84, rh = 22, H = items.length * rh + (ref != null ? 14 : 4);
  max = max || Math.max(...items.map((i) => i.v), 1e-9);
  const x = (v) => L + (W - L - R) * Math.min(1, v / max);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  items.forEach((it, i) => {
    const y = i * rh + 4, bw = Math.max(2, x(it.v) - L), op = it.low ? 0.4 : 1;
    s += '<g opacity="' + op + '"><title>' + h(it.title || it.label + ': ' + it.text) + '</title>';
    s += '<rect x="0" y="' + (y - 2) + '" width="' + W + '" height="' + rh + '" fill="transparent"/>';
    s += '<text x="' + (L - 6) + '" y="' + (y + 12) + '" text-anchor="end" font-size="11" fill="#ece6f6">' + h(it.label.length > 19 ? it.label.slice(0, 18) + '.' : it.label) + '</text>';
    s += '<rect x="' + L + '" y="' + (y + 2) + '" width="' + bw.toFixed(1) + '" height="13" rx="4" fill="url(#gg)"/>';
    s += '<text x="' + (L + bw + 5) + '" y="' + (y + 12) + '" font-size="11" fill="#9a93ad">' + h(it.text) + '</text></g>';
  });
  if (ref != null && ref > 0) { const rx = x(ref); s += '<line x1="' + rx + '" x2="' + rx + '" y1="2" y2="' + (H - 12) + '" stroke="#ffe3a1" stroke-opacity=".55" stroke-dasharray="3 3"/><text x="' + rx + '" y="' + (H - 2) + '" font-size="9" text-anchor="middle" fill="#ffe3a1" fill-opacity=".7">' + h(refLabel || '') + '</text>'; }
  return s + '</svg>';
}
function vbars(days) {
  if (days.length < 2) return '';
  const W = Math.max(320, Math.min(1400, ($('#main').clientWidth || 360) - 26)), H = 110, n = days.length, bw = (W - 20) / n, mx = Math.max(...days.map((d) => d.n), 1);
  let s = '<svg viewBox="0 0 ' + W + ' ' + (H + 16) + '" role="img"><line x1="10" x2="' + (W - 10) + '" y1="' + H + '" y2="' + H + '" stroke="rgba(214,176,92,.3)"/>';
  days.forEach((d, i) => { const bh = Math.max(1, (H - 14) * d.n / mx), x = 10 + i * bw; s += '<g><title>' + d.day + ': ' + d.n + ' matches</title><rect x="' + x + '" y="0" width="' + bw + '" height="' + H + '" fill="transparent"/><rect x="' + (x + Math.min(1, bw * 0.1)) + '" y="' + (H - bh) + '" width="' + Math.max(1, bw - Math.max(1, bw * 0.2)) + '" height="' + bh + '" rx="' + Math.min(4, bw / 3) + '" fill="url(#gv)"/></g>'; });
  s += '<text x="10" y="' + (H + 13) + '" font-size="10" fill="#9a93ad">' + days[0].day + '</text><text x="' + (W - 10) + '" y="' + (H + 13) + '" font-size="10" fill="#9a93ad" text-anchor="end">' + days[n - 1].day + '</text><text x="12" y="10" font-size="10" fill="#9a93ad">max ' + mx + '</text>';
  return s + '</svg>';
}
const LOWN = 10;
// player-level dim card: win rate bars + table
function dimCard(dim, title, note, { pick } = {}) {
  const rows = agg(dim).sort((a, b) => (b.n >= LOWN) - (a.n >= LOWN) || b.win / b.n - a.win / a.n || b.n - a.n);
  const players = (meta().humans || 0) * (st.who !== 'b') + (meta().bots || 0) * (st.who !== 'h');
  const T = rows.reduce((t, r) => ({ n: t.n + r.n, win: t.win + r.win }), { n: 0, win: 0 });
  const list = (pick ? rows.slice().sort((a, b) => b.n - a.n) : rows).slice(0, 24);
  const bars = hbars(list.map((r) => ({ label: nm(dim, r.k), v: r.win / r.n, text: pct(r.win, r.n) + ' (' + r.n + ')', low: r.n < LOWN })), { max: Math.max(...list.map((r) => r.win / r.n), 0.05), ref: T.n ? T.win / T.n : null, refLabel: 'avg ' + pct(T.win, T.n) });
  const tr = list.map((r) => '<tr class="' + (r.n < LOWN ? 'low' : '') + '"><td>' + h(nm(dim, r.k)) + '</td><td>' + r.n + '</td>' + (pick ? '<td>' + pct(r.n, players) + '</td>' : '') + '<td>' + pct(r.win, r.n) + '</td><td>' + f1(r.place, r.n) + '</td><td>' + pct(r.top3, r.n) + '</td><td>' + f1(r.x, r.n) + '</td></tr>').join('');
  return '<section class="card"><h2>' + title + '</h2><div class="note">' + note + ' Faded rows: fewer than ' + LOWN + ' players.</div>' + bars +
    '<details><summary>Table</summary><div class="tw"><table><tr><th>' + dim + '</th><th>n</th>' + (pick ? '<th>pick</th>' : '') + '<th>win</th><th>place</th><th>top 3</th><th>kills</th></tr>' + tr + '</table></div></details></section>';
}
function render() {
  const M = meta(), MB = metaBy(), comp = (M.matches || 0) - (M.coop || 0);
  const modes = Object.keys(MB).sort();
  const sel = $('#m'); const cur = st.m;
  sel.innerHTML = '<option value="">All modes</option>' + [...new Set([...modes, ...(cur ? [cur] : [])])].map((m) => '<option value="' + h(m) + '"' + (m === cur ? ' selected' : '') + '>' + h(nm('mode', m)) + '</option>').join('');
  const kpi = (v, l) => '<div class="kpi"><b>' + v + '</b><span>' + l + '</span></div>';
  let o = '<section class="card wide"><div class="note">' + h(D.label) + (D.mode ? ' - ' + h(nm('mode', D.mode)) : '') + ' (UTC). ' + (st.who === 'h' ? 'Player tables: humans only.' : st.who === 'b' ? 'Player tables: bots only.' : 'Player tables: humans and bots.') + (D.queue ? ' ' + D.queue + ' match(es) still replaying.' : '') + (D.replayErr ? ' <span class="err">' + D.replayErr + ' replay error(s).</span>' : '') + '</div><div class="kpis">' +
    kpi(M.matches || 0, 'Matches') + kpi(f1(M.rounds || 0, M.matches), 'Avg rounds') + kpi(pct(M.kingWin || 0, comp), 'King win') + kpi(pct(M.humanWin || 0, M.matches), 'Human won') +
    kpi(M.humans || 0, 'Human seats') + kpi(M.drops || 0, 'Disconnects') + kpi(M.leaves || 0, 'Forfeits') + kpi(M.timeouts || 0, 'Timeouts') + '</div></section>';
  if (D.days.length > 1) o += '<section class="card wide"><h2>Matches per day</h2>' + vbars(D.days) + '</section>';
  const mrows = modes.map((m) => ({ m, ...MB[m] })).sort((a, b) => (b.matches || 0) - (a.matches || 0));
  o += '<section class="card"><h2>Matches by mode</h2>' + hbars(mrows.map((r) => ({ label: nm('mode', r.m), v: r.matches || 0, text: String(r.matches || 0) })), {}) +
    '<div class="tw"><table><tr><th>mode</th><th>n</th><th>rounds</th><th>king win</th><th>human won</th><th>drops</th><th>t/o</th></tr>' + mrows.map((r) => '<tr><td>' + h(nm('mode', r.m)) + '</td><td>' + (r.matches || 0) + '</td><td>' + f1(r.rounds || 0, r.matches) + '</td><td>' + (r.coop ? 'co-op ' + pct(r.coopWin || 0, r.matches) : pct(r.kingWin || 0, r.matches)) + '</td><td>' + pct(r.humanWin || 0, r.matches) + '</td><td>' + (r.drops || 0) + '</td><td>' + (r.timeouts || 0) + '</td></tr>').join('') + '</table></div></section>';
  const loc = agg('loc').sort((a, b) => b.n - a.n);
  o += '<section class="card"><h2>Matches by location</h2>' + hbars(loc.map((r) => ({ label: nm('loc', r.k), v: r.n, text: r.n + ' (' + f1(r.x, r.n) + ' rnd)' })), {}) +
    '<details><summary>Table</summary><div class="tw"><table><tr><th>location</th><th>n</th><th>rounds</th><th>human won</th></tr>' + loc.map((r) => '<tr><td>' + h(nm('loc', r.k)) + '</td><td>' + r.n + '</td><td>' + f1(r.x, r.n) + '</td><td>' + pct(r.win, r.n) + '</td></tr>').join('') + '</table></div></details></section>';
  const wp = agg('wpiece').sort((a, b) => b.n - a.n), king = agg('king')[0] || { n: 0, win: 0, place: 0 };
  o += '<section class="card"><h2>King</h2><div class="kpis" style="grid-template-columns:repeat(3,1fr)">' + kpi(pct(M.kingWin || 0, comp), 'Won as King') + kpi(pct(M.crowned || 0, comp), 'Crown claimed') + kpi(pct(king.win, king.n), 'Crowned player won') + '</div>' +
    '<div class="note" style="margin-top:10px">Winner\\'s final piece (all players, share of matches)</div>' + hbars(wp.map((r) => ({ label: nm('piece', r.k), v: r.n / (M.matches || 1), text: pct(r.n, M.matches) + ' (' + r.n + ')' })), { max: 1 }) + '</section>';
  o += dimCard('piece', 'Win rate by final piece', 'Piece at match end (King, Ascended, pawn line). Dashed line = average.');
  o += dimCard('road', 'Win rate by road', 'Bots: their planned road (u.plan). Humans: the road their final piece shows.');
  o += dimCard('preset', 'Preset win rate', 'Stat points matched to a preset; anything else is Custom.');
  o += dimCard('passive', 'Passive win rate', '');
  o += dimCard('ability', 'Abilities: pick and win rate', 'Every equipped ability counts as a pick (pick = share of players). Sorted by picks.', { pick: true });
  o += '<section class="card wide"><h2>Recent matches</h2>' + (D.recent.length ? '<div class="tw"><table><tr><th>time (UTC)</th><th>mode</th><th>location</th><th>rounds</th><th>humans</th><th>bots</th><th>winner</th><th>human won</th><th>drops</th></tr>' + D.recent.map((r) => '<tr><td>' + new Date(r.at).toISOString().slice(5, 16).replace('T', ' ') + '</td><td>' + h(nm('mode', r.mode)) + '</td><td>' + h(nm('loc', r.loc)) + '</td><td>' + r.rounds + '</td><td>' + r.humans + '</td><td>' + r.bots + '</td><td>' + h(nm('piece', r.wp)) + '</td><td>' + (r.hwin ? 'yes' : '-') + '</td><td>' + r.drops + '</td></tr>').join('') + '</table></div>' : '<div class="empty">No matches in this range</div>') + '</section>';
  $('#main').innerHTML = o;
}
$('#seg').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.r = b.dataset.r; load(); } };
$('#d').onchange = (e) => { if (e.target.value) { st.d = e.target.value; load(); } };
$('#m').onchange = (e) => { st.m = e.target.value; load(); };
$('#who').onchange = (e) => { st.who = e.target.value; if (D) render(); };
$('#rf').onclick = () => load();
load();`;

export function adminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="theme-color" content="#0b0a10"><title>Chess Complex Admin</title><style>${CSS}</style></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#8a6420"/><stop offset="1" stop-color="#e9c46a"/></linearGradient><linearGradient id="gv" x1="0" x2="0" y1="1" y2="0"><stop offset="0" stop-color="#8a6420"/><stop offset="1" stop-color="#ffe3a1"/></linearGradient></defs></svg>
<header><div class="top"><h1><small>Chess Complex</small>Match Stats</h1><a href="/admin/logout">Log out</a></div>
<div class="ctl"><div class="seg" id="seg"><button data-r="day">Day</button><button data-r="week">Week</button><button data-r="7d">7d</button><button data-r="30d">30d</button><button data-r="all">All</button></div>
<input type="date" id="d" aria-label="Date"><select id="m" aria-label="Mode"><option value="">All modes</option></select>
<select id="who" aria-label="Players"><option value="h">Humans</option><option value="b">Bots</option><option value="a">Everyone</option></select>
<button class="btn" id="rf">Refresh</button><a class="btn" id="csv" href="/admin/csv">CSV</a></div></header>
<main id="main"><div class="card wide empty">Loading</div></main>
<script>${JS.replace('__NAMES__', esc(JSON.stringify(NAMES)))}</script></body></html>`;
}

export function loginPage(msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Chess Complex Admin</title><style>${CSS}
form{max-width:340px;margin:18vh auto 0;padding:20px;display:grid;gap:10px}input[type=password]{background:var(--bg2);color:var(--ink);border:1px solid var(--line);border-radius:10px;min-height:44px;padding:0 12px;font-size:16px}
button{min-height:44px;border:0;border-radius:10px;background:linear-gradient(180deg,#e9c46a,#a77c2c);color:#1a1206;font:700 14px system-ui,sans-serif}</style></head><body>
<form class="card" method="get" action="/admin"><h1><small>Chess Complex</small>Admin</h1>${msg ? `<div class="err">${String(msg).replace(/[<>&]/g, '')}</div>` : ''}<input type="password" name="key" placeholder="Admin key" autocomplete="current-password" aria-label="Admin key" required><button>Open dashboard</button></form></body></html>`;
}

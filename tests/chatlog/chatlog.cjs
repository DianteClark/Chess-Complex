// Q 10.3: chat log (Social & network). ?net=local, host + client (+ bots), real wire chat.
//   L1 strip     the in-match strip shows the last 3 messages in order on both host and client, updates on every
//                message, and is still showing them 15 s later (always visible; it may only step aside for a
//                Director message). While shown it never overlaps the HUD (card, actions, ULT, top bar, turn order,
//                chat / talk buttons), the Director lanes (banner, callouts, cine band, tips, feed, toast, lethal,
//                chips) or board-critical points (my piece, the active piece).
//   L2 history   tapping the strip opens the full history: every message (oldest at top), scrollable, opened at the
//                bottom; a new message keeps it at the bottom; scrolled up, a new message does not move it and a
//                "new messages" pill shows; the pill returns to the bottom and goes away; closing returns to the match
//   L3 muted     a muted player's new lines are not in the strip or history (and earlier lines are hidden: reported)
//   L4 xss       hostile custom text and a hostile player name render as text in strip and history (no elements,
//                no on* attributes, nothing runs)
//   L5 landscape L1 at 844x390
//   L6 spectate  an eliminated client (spectating) still gets the strip and the history; strip clear of #spec-bar
//   NODE_PATH=$(npm root -g) node tests/chatlog/chatlog.cjs [--url http://localhost:8123/] [--only L1,L2]
process.env.CC_URL = process.env.CC_URL || 'http://localhost:8123/';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (opt('url')) process.env.CC_URL = opt('url');
const L = require('../online/lib.js');
const { chromium, sleep } = L;
const ONLY = opt('only') ? opt('only').split(',') : null;
const STRIP = opt('strip', '#chat-log');

function INIT() {
  window.__xss = 0; window.alert = () => { window.__xss++; };
  window.__vis = (e) => { if (!e || !e.isConnected) return 0; let a = 1; for (let n = e; n && n !== document.documentElement; n = n.parentElement) { if (n.classList && (n.classList.contains('hidden') || n.classList.contains('yield'))) return 0; const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; a *= +cs.opacity; } const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 ? a : 0; };
}
// strip snapshot (in page)
function stripState(sel) {
  const s = document.querySelector(sel);
  if (!s) return { exists: false };
  const rows = [...s.children].filter((r) => window.__vis(r) > 0.2 && !r.classList.contains('out') && r.textContent.trim());
  const rr = s.getBoundingClientRect();
  return { exists: true, vis: window.__vis(s), rows: rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()), rects: rows.map((r) => { const b = r.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }), box: { x: rr.left, y: rr.top, w: rr.width, h: rr.height } };
}
function hazards(sel) {
  const $ = (q) => document.querySelector(q), out = [], strip = document.querySelector(sel);
  const add = (kind, el, pad = 0) => { if (!el || window.__vis(el) < 0.15 || (strip && (strip.contains(el) || el.contains(strip)))) return; const r = el.getBoundingClientRect(); if (r.width > 2 && r.height > 2) out.push({ kind, x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad }); };
  for (const q of ['#h-card', '#h-actions', '#ult-btn', '.hud-top .hud-info', '#h-order', '.hud-top .hud-btns', '.emote-wrap .emote-btn', '#vc-ptt', '#spec-bar', '#emote-menu:not(.hidden)']) document.querySelectorAll(q).forEach((e) => add('hud:' + q, e));
  for (const q of ['#gm-tip', '#toast.show', '#lethal', '#event-chip', '#discovery', '#contenders', '#h-streak']) add('dir:' + q, $(q));
  const ban = $('#h-banner'); if (ban) [...ban.children].filter((c) => c.textContent.trim()).forEach((c) => add('dir:banner', c));
  document.querySelectorAll('#h-feed > div').forEach((d) => add('dir:feed', d));
  document.querySelectorAll('[data-msg]').forEach((d) => add('dir:' + d.dataset.msg, d));
  const g = window.__cc.game, r = g.r;
  const D = window.__dirM; if (D && D.cineActive && D.cineActive()) { const hr = D.heroRect(); out.push({ kind: 'dir:cine', x: 0, y: hr.y - 28, w: innerWidth, h: hr.h + 56 }); }
  if (r && g.s) for (const [k, id] of [['board:me', r.myId], ['board:active', g.s.active]]) { const d = id != null && r.disp.get(id); const u = id != null && g.s.units.find((v) => v.id === id); if (!d || !u || !u.alive) continue; const [sx, sy] = r.toScreen(d.x + 0.5, d.y + 0.5); const c = r.c.getBoundingClientRect(), h = r.z * 0.45; out.push({ kind: k, x: c.left + sx - h, y: c.top + sy - h * 1.4, w: 2 * h, h: 2.2 * h }); }
  return out;
}
const inter = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 2 && h > 2 ? w * h : 0; };
const logOf = (p) => p.evaluate(async () => (await import('/js/chat.js')).chat.log.map((l) => `${l.name} ${l.text}`.replace(/\s+/g, ' ').trim()));
const presets = (p) => p.evaluate(async () => Object.keys((await import('/js/chat.js')).PHRASES));

async function setup(run, { vp, bots = 2, tips = false } = {}) {
  await run.ctx.addInitScript(INIT);
  if (vp) run.ctx.setDefaultTimeout(15000);
  const { host, code } = await L.hostLobby(run, { mode: 'royale' });
  const c1 = await L.clientJoin(run, 'c1', code);
  if (vp) for (const p of [host, c1]) await p.setViewportSize(vp);
  if (!tips) for (const p of [host, c1]) await p.evaluate(() => { window.__cc.profile.tips = Object.assign([], { includes: () => true }); }); // steady state: coach tips already seen
  await L.startMatch(run, host, { bots, clients: [c1] });
  await L.protectHumans(host);
  // quiet bots: bot chat lines would make "last 3" nondeterministic
  await host.evaluate(async () => { const C = await import('/js/chat.js'); for (const k of Object.keys(C.BOT_LINES)) C.BOT_LINES[k] = []; });
  await L.autoplay(host); await L.autoplay(c1);
  for (const p of [host, c1]) await p.evaluate(async () => { window.__dirM = (await import('/js/announcer.js')).director; });
  return { host, c1, keys: await presets(host) };
}
// send from page p (host uses sess.chat, client the raw wire)
const send = (p, m) => p.evaluate((m) => { const s = window.__cc.session; if (s.mode === 'host') s.chat(m); else s.client.send({ t: 'chat', ...m }); }, m);
let kix = 0;
const nextKey = (keys) => keys[(kix++ * 7) % keys.length];

async function stripCheck(run, host, c1, keys, label) {
  const sent = [];
  for (let i = 0; i < 5; i++) { const p = i % 2 ? c1 : host; const k = nextKey(keys); await send(p, { k }); sent.push(k); await sleep(1100); }
  for (const [lab, p] of [['host', host], ['c1', c1]]) {
    let st; for (let w = 0; w < 16; w++) { st = await p.evaluate(stripState, STRIP); if (st.vis > 0.3 && st.rows.length >= 3) break; await sleep(250); } // may yield briefly to a Director message
    const log = await logOf(p);
    run.check(st.exists, `${lab}: no ${STRIP}`); if (!st.exists) continue;
    const want = log.slice(-3);
    run.note(`${lab} strip ${JSON.stringify(st.rows)}`);
    run.check(st.rows.length === 3, `${lab}: strip shows ${st.rows.length} rows, want 3`);
    run.check(JSON.stringify(st.rows.map((r) => r.replace(/^Team /, ''))) === JSON.stringify(want), `${lab}: strip ${JSON.stringify(st.rows)} != last 3 ${JSON.stringify(want)}`);
  }
  // persistence + overlap sampling for 15 s (strip may yield for Director messages, but not most of the time)
  const st = { n: 0, shown: 0, three: 0, hits: {} };
  for (let i = 0; i < 60; i++) {
    for (const [lab, p] of [['host', host], ['c1', c1]]) {
      const s = await p.evaluate(stripState, STRIP); if (!s.exists) continue; st.n++;
      if (!(s.vis > 0.3 && s.rows.length)) { const c = await p.evaluate((sel) => { const el = document.querySelector(sel), me = el.getBoundingClientRect(), D = window.__dirM; if (!D) return '?'; const hit = (D.occupied() || []).filter((r) => r.x < me.right && r.x + r.w > me.left && r.y < me.bottom && r.y + r.h > me.top && !(Math.abs(r.x - (me.left - 4)) < 2 && Math.abs(r.y - (me.top - 4)) < 2)); const tags = []; if (D.hintCur && !D.hintEl.classList.contains('hidden')) tags.push('hint:' + (D.hintCur.kind || '?')); if (D.cineActive && D.cineActive()) tags.push('cine'); for (const d of D.feedEl ? D.feedEl.children : []) { const q = d.getBoundingClientRect(); if (q.left < me.right && q.right > me.left && q.top < me.bottom + 4 && q.bottom > me.top - 4) tags.push('feed'); } if (!hit.length) tags.push(el.classList.contains('yield') ? 'yield-nohit' : 'not-yield'); return tags.join('+') || 'hit:' + hit.length; }, STRIP); st.why = st.why || {}; st.why[lab + ' ' + c] = (st.why[lab + ' ' + c] || 0) + 1; }
      if (s.vis > 0.3 && s.rows.length) { st.shown++; if (s.rows.length === 3) st.three++;
        const hz = await p.evaluate(hazards, STRIP);
        for (const r of s.rects) for (const h of hz) if (inter(r, h) > 30) { const k = `${lab} ${h.kind}`; st.hits[k] = (st.hits[k] || 0) + 1; }
      }
    }
    if (i === 20 || i === 50) await run.shot('host', `${label}-${i}`);
    await sleep(250);
  }
  run.note(`${label}: samples ${st.n}, shown ${st.shown}, with 3 rows ${st.three}, overlaps ${JSON.stringify(st.hits)}, hidden because ${JSON.stringify(st.why || {})}`);
  run.check(st.shown / Math.max(1, st.n) >= 0.75, `${label}: strip shown only ${Math.round(100 * st.shown / Math.max(1, st.n))}% of 15 s after the last message (want always, except while yielding)`);
  run.check(st.three >= st.shown * 0.95, `${label}: strip dropped below 3 rows while shown (${st.three}/${st.shown})`);
  const bad = Object.entries(st.hits).filter(([k]) => !/board:active/.test(k));
  run.check(!bad.length, `${label}: strip overlaps ${JSON.stringify(Object.fromEntries(bad))}`);
  if (st.hits && Object.keys(st.hits).some((k) => /board:active/.test(k))) run.note(`${label}: strip over the ACTIVE piece in some samples (soft)`);
  // what share of the visible board does the tappable strip cover, and does a tap on a board tile under a row reach the board?
  const cov = await host.evaluate((sel) => { const r = window.__cc.game.r, c = r.c.getBoundingClientRect(); const bx = { x: c.left, y: c.top + r.pad.t, w: r.VW || r.W, h: r.VH }; let a = 0; const rows = [...document.querySelectorAll(sel + ' > *')].filter((e) => window.__vis(e) > 0.2 && getComputedStyle(e).pointerEvents !== 'none'); for (const e of rows) { const q = e.getBoundingClientRect(); const w = Math.min(q.right, bx.x + bx.w) - Math.max(q.left, bx.x), h = Math.min(q.bottom, bx.y + bx.h) - Math.max(q.top, bx.y); if (w > 0 && h > 0) a += w * h; } const tile = r.z; const e = rows[rows.length - 1]; const q = e && e.getBoundingClientRect(); return { pct: +(100 * a / (bx.w * bx.h)).toFixed(1), tiles: +(a / (tile * tile)).toFixed(1), tap: q ? { x: q.left + q.width * 0.75, y: q.top + q.height / 2 } : null }; }, STRIP);
  run.note(`${label}: tappable strip rows cover ${cov.pct}% of the board viewport (~${cov.tiles} tiles at the current zoom)`);
  if (cov.tap) {
    await host.evaluate(() => { window.__boardHit = 0; window.__cc.game.r.c.addEventListener('pointerdown', () => window.__boardHit++, { once: true }); });
    await host.touchscreen.tap(cov.tap.x, cov.tap.y); await sleep(500);
    const res = await host.evaluate(() => ({ board: window.__boardHit, sheet: !!document.querySelector('.cs-list') && window.__vis(document.querySelector('.cs-list')) > 0.2 }));
    run.note(`${label}: tap on a board tile under a strip row -> board ${res.board ? 'got it' : 'did NOT get it'}${res.sheet ? ', history sheet opened' : ''}`);
    if (res.sheet) await host.evaluate(() => { const k = document.querySelector('[data-cs="close"]'); if (k) k.click(); });
  }
}

// --- history helpers (in page)
function openHistoryProbe(sel) {
  const s = document.querySelector(sel); if (!s || !window.__vis(s)) return null;
  const rows = [...s.children].filter((r) => window.__vis(r) > 0.3); const t = rows[rows.length - 1] || s;
  const b = t.getBoundingClientRect(); return { x: b.left + Math.min(40, b.width / 2), y: b.top + b.height / 2, pe: getComputedStyle(s).pointerEvents, rpe: getComputedStyle(t).pointerEvents };
}
function findHistory(lastText) {
  const known = document.querySelector('.cs-list'); if (known && window.__vis(known) > 0.2) { known.setAttribute('data-q-hist', '1'); const rows = [...known.children].filter((r) => r.textContent.trim()).map((r) => r.textContent.replace(/\s+/g, ' ').trim()); return { id: known.id, cls: known.className, rows, sh: known.scrollHeight, ch: known.clientHeight, st: known.scrollTop }; }
  const cands = [...document.querySelectorAll('body *')].filter((e) => window.__vis(e) > 0.5 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.textContent.includes(lastText) && !e.closest('#chat-log'));
  cands.sort((a, b) => a.textContent.length - b.textContent.length);
  const e = cands[0]; if (!e) return null;
  e.setAttribute('data-q-hist', '1');
  const rows = [...e.children].filter((r) => r.textContent.trim()).map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  return { id: e.id, cls: e.className, rows, sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop };
}
const probeStrip = async (p) => { for (let w = 0; w < 20; w++) { const pr = await p.evaluate(openHistoryProbe, STRIP); if (pr) return pr; await sleep(250); } return null; };
const findHist = async (p, last) => { for (let i = 0; i < 10; i++) { const h = await p.evaluate(findHistory, last); if (h) return h; await sleep(250); } return null; };
const hist = (p) => p.evaluate(() => { const e = document.querySelector('[data-q-hist]'); if (!e || !window.__vis(e)) return null; const pill = [...document.querySelectorAll('button, [role=button], div, span')].find((b) => window.__vis(b) > 0.5 && /new messages?|^\d+ new|jump to (latest|bottom)/i.test(b.textContent.trim()) && b.textContent.trim().length < 30 && b.children.length < 3); return { sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop, atBottom: e.scrollTop + e.clientHeight >= e.scrollHeight - 6, rows: [...e.children].filter((r) => r.textContent.trim()).length, last: ([...e.children].filter((r) => r.textContent.trim()).pop() || {}).textContent, pill: !!pill }; });

const S = {};
S.L1 = async (run) => { const { host, c1, keys } = await setup(run); await stripCheck(run, host, c1, keys, 'portrait'); };
S.L5 = async (run) => { const { host, c1, keys } = await setup(run, { vp: { width: 844, height: 390 } }); await stripCheck(run, host, c1, keys, 'landscape'); };
S.L2 = async (run) => {
  const { host, c1, keys } = await setup(run);
  for (let i = 0; i < 24; i++) { await send(i % 2 ? c1 : host, { k: nextKey(keys) }); await sleep(820); }
  await sleep(600);
  const log = await logOf(host);
  const pr = await probeStrip(host);
  run.check(pr, 'no visible strip to tap'); if (!pr) return;
  run.note('strip pointer-events ' + pr.pe + '/' + pr.rpe);
  await host.touchscreen.tap(pr.x, pr.y); await sleep(700);
  const last = log[log.length - 1].split(' ').slice(1).join(' ');
  const h = await findHist(host, last);
  run.note('history ' + JSON.stringify(h && { id: h.id, cls: h.cls, n: h.rows.length, sh: h.sh, ch: h.ch, st: h.st, first: h.rows[0], last: h.rows[h.rows.length - 1] }));
  await run.shot('host', 'history');
  run.check(h, 'tapping the strip did not open a scrollable history'); if (!h) return;
  run.check(h.rows.length >= Math.min(log.length, 24), `history has ${h.rows.length} rows, log has ${log.length}`);
  run.check(h.rows.length && h.rows[h.rows.length - 1].includes(last), `history bottom row is not the newest message (${h.rows[h.rows.length - 1]})`);
  run.check(h.sh > h.ch + 10, 'history does not scroll (all rows fit or overflow hidden)');
  run.check(h.st + h.ch >= h.sh - 6, 'history did not open at the bottom');
  // at bottom + new message -> stays at bottom
  await send(c1, { k: nextKey(keys) }); await sleep(900);
  let s = await hist(host); run.check(s && s.atBottom, `new message while at bottom: not at bottom ${JSON.stringify(s)}`);
  run.check(s && !s.pill, 'pill shown while at the bottom');
  // scroll up + new message -> holds position, pill
  await host.evaluate(() => { const e = document.querySelector('[data-q-hist]'); e.scrollTop = 0; e.dispatchEvent(new Event('scroll')); }); await sleep(300);
  await send(c1, { k: nextKey(keys) }); await sleep(900);
  s = await hist(host); run.note('scrolled-up state ' + JSON.stringify(s));
  run.check(s && s.st < 20, `scrolled-up history jumped on a new message (scrollTop ${s && s.st})`);
  run.check(s && s.pill, 'no "new messages" pill when scrolled up');
  await run.shot('host', 'pill');
  const pp = await host.evaluate(() => { const b = [...document.querySelectorAll('button, [role=button], div, span')].find((b) => window.__vis(b) > 0.5 && /new messages?|^\d+ new|jump to (latest|bottom)/i.test(b.textContent.trim()) && b.textContent.trim().length < 30 && b.children.length < 3); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });
  if (pp) { run.check(pp.w >= 40 && pp.h >= 28, `pill too small ${pp.w}x${pp.h}`); await host.touchscreen.tap(pp.x, pp.y); for (let w = 0; w < 12; w++) { await sleep(250); s = await hist(host); if (s && s.atBottom) break; } run.check(s && s.atBottom && !s.pill, `pill tap: ${JSON.stringify(s)}`); }
  // user scroll by touch (real gesture) works
  const before = (await hist(host)).st;
  const bx = await host.evaluate(() => { const r = document.querySelector('[data-q-hist]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const cdp = await run.ctx.newCDPSession(host); const tp = (y) => [{ x: bx.x, y, radiusX: 4, radiusY: 4, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(bx.y - 60) });
  for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(bx.y - 60 + k * 18) }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(500);
  const after = (await hist(host)).st; run.check(after < before - 20, `touch drag did not scroll the history (${before} -> ${after})`);
  // close
  const closed = await host.evaluate(() => { const k = document.querySelector('[data-cs="close"]'); if (k && window.__vis(k)) { k.click(); return true; } const m = document.querySelector('[data-q-hist]'); const box = m.closest('[role=dialog], .modal, .qc, .chat-hist, section') || m.parentElement; const b = [...box.querySelectorAll('button')].find((b) => /close|done|back|^×$|^x$/i.test(b.textContent.trim() || b.getAttribute('aria-label') || '')); if (b) { b.click(); return true; } return false; });
  await sleep(500);
  run.check(closed, 'history has no Close button');
  run.check(!(await hist(host)), 'history still visible after Close');
  run.check(await L.advancing(host, 3000).then((a) => a.moved), 'match not advancing after history');
};
S.L3 = async (run) => {
  const { host, c1, keys } = await setup(run);
  const c1pid = await L.clientPid(c1);
  await send(c1, { k: nextKey(keys) }); await sleep(900);
  const preRows = (await host.evaluate(stripState, STRIP)).rows || [];
  await host.evaluate(async (pid) => { const c = (await import('/js/chat.js')).chat; if (!c.muted.has(pid)) { c.toggle && c.toggle(); c.tab = 'players'; c.render(); const b = document.querySelector(`[data-mute="${pid}"]`); if (b) b.click(); else c.muted.add(pid); } if (c.close) c.close(); }, c1pid);
  await sleep(500);
  const afterMuteRows = (await host.evaluate(stripState, STRIP)).rows || [];
  const name = await c1.evaluate(() => window.__cc.game.me.name);
  const n0 = (await logOf(host)).length;
  for (let i = 0; i < 3; i++) { await send(c1, { k: nextKey(keys) }); await sleep(900); }
  await send(host, { k: nextKey(keys) }); await sleep(900);
  const st = await host.evaluate(stripState, STRIP), log = await logOf(host);
  const c1log = (await logOf(c1)); run.check(c1log.filter((l) => l.startsWith(name + ' ')).length >= 3, 'control: c1 did not see its own lines');
  run.note(`muted ${name}: strip before mute ${JSON.stringify(preRows)} after ${JSON.stringify(afterMuteRows)} now ${JSON.stringify(st.rows)}`);
  const newFromMuted = log.slice(n0).filter((l) => l.startsWith(name + ' ')).length;
  run.check(newFromMuted === 0, `muted player's new lines reached the host log (${newFromMuted})`);
  run.check(!(st.rows || []).slice(-1).some((r) => r.startsWith(name)), 'muted player line in the strip');
  if (afterMuteRows.some((r) => r.startsWith(name))) run.note(`SOFT: earlier lines from ${name} stay in the strip after mute`);
  // history
  const pr = await probeStrip(host);
  if (pr) { await host.touchscreen.tap(pr.x, pr.y); await sleep(700); const h = await findHist(host, log[log.length - 1].split(' ').slice(1).join(' ')); if (h) { const m = h.rows.filter((r) => r.replace(/^\d{1,2}:\d{2}( ?[AP]M)?/, '').startsWith(name)).length; run.note(`history rows from muted player: ${m} (pre-mute line only expected or 0)`); run.check(m <= 1, `muted player's later lines in history (${m})`); } }
};
S.L4 = async (run) => {
  await run.ctx.addInitScript(INIT);
  const { host, code } = await L.hostLobby(run, { mode: 'royale' });
  const c1 = await run.page('c1');
  await c1.evaluate(() => { window.__cc.profile.name = '<img src=x onerror=alert(9)>"q'; });
  await c1.evaluate(() => document.querySelector('#s-title [data-go="join"]').click()); await sleep(700);
  await c1.fill('#in-code', code); await c1.evaluate(() => document.querySelector('#s-join [data-act="join"]').click());
  await c1.waitForFunction(() => /In the lobby/.test(document.querySelector('#join-status').textContent), null, { timeout: 8000 });
  await L.startMatch(run, host, { bots: 1, clients: [c1] }); await L.protectHumans(host); await L.autoplay(host); await L.autoplay(c1);
  const pay = ['<img src=x onerror=alert(1)>a', '"><svg onload=alert(2)>b', '<script>alert(3)</script>c', '&lt;b&gt;d&lt;/b&gt;', '<a href="javascript:alert(5)">e</a>'];
  for (const x of pay) { await send(c1, { x }); await sleep(3300); }
  const pr = await probeStrip(host);
  if (pr) { await host.touchscreen.tap(pr.x, pr.y); await sleep(700); }
  for (const [lab, p] of [['host', host], ['c1', c1]]) {
    const r = await p.evaluate((sel) => {
      const nodes = [...document.querySelectorAll(sel + ' *, [data-q-hist] *, .chat-hist *, #emote-menu *')];
      const bad = nodes.filter((n) => !/^(B|I|SPAN|EM|SMALL|STRONG|TIME|DIV|BUTTON|P|SVG|USE|PATH|H3|H4|LI|UL)$/.test(n.tagName) || [...n.attributes].some((a) => /^on|^href|^src/i.test(a.name))).map((n) => n.outerHTML.slice(0, 80));
      return { bad, xss: window.__xss, text: (document.querySelector(sel) || {}).textContent };
    }, STRIP);
    run.note(`${lab} strip text: ${(r.text || '').slice(0, 200)}`);
    run.check(!r.bad.length && !r.xss, `${lab}: markup rendered as elements ${JSON.stringify(r)}`);
  }
};
S.L6 = async (run) => {
  const { host, c1, keys } = await setup(run, { bots: 3 });
  await L.hostKill(host, await L.clientPid(c1)); await sleep(1500);
  await L.waitDead(c1);
  const sb = await c1.evaluate(() => { const s = [...document.querySelectorAll('#m-dead button')].find((x) => /spectate|watch/i.test(x.textContent)); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (sb) await c1.touchscreen.tap(sb.x, sb.y);
  await sleep(1200);
  run.check(await c1.evaluate(() => document.querySelector('#m-dead').classList.contains('hidden')), 'Eliminated modal still open after Spectate');
  run.check(await c1.evaluate(() => document.querySelector('#s-game').classList.contains('spectating')), 'c1 not spectating');
  for (let i = 0; i < 4; i++) { await send(host, { k: nextKey(keys) }); await sleep(1100); }
  let st; for (let w = 0; w < 16; w++) { st = await c1.evaluate(stripState, STRIP); if (st.vis > 0.3 && st.rows.length >= 3) break; await sleep(250); }
  const log = await logOf(c1);
  run.note('spectator strip ' + JSON.stringify(st.rows));
  run.check(st.rows && st.rows.length === 3 && st.vis > 0.3, `spectator strip not showing 3 rows ${JSON.stringify(st)}`);
  run.check(JSON.stringify(st.rows) === JSON.stringify(log.slice(-3)), 'spectator strip is not the last 3');
  const hz = await c1.evaluate(hazards, STRIP); const hits = [];
  for (const r of st.rects || []) for (const h of hz) if (inter(r, h) > 30 && !/board:/.test(h.kind)) hits.push(h.kind);
  run.check(!hits.length, `spectator strip overlaps ${[...new Set(hits)]}`);
  await run.shot('c1', 'spectate');
  const pr = await probeStrip(c1);
  if (pr) { await c1.touchscreen.tap(pr.x, pr.y); await sleep(700); }
  const h = await findHist(c1, log[log.length - 1].split(' ').slice(1).join(' '));
  run.check(h && h.rows.length >= 4, 'spectator cannot open the full history');
};
// L7 (measure): fresh profile, first match: how much of the time is the strip hidden while it has lines, and by what
S.L7 = async (run) => {
  const { host, c1, keys } = await setup(run, { tips: true });
  await host.evaluate(async () => { window.__dirM = (await import('/js/announcer.js')).director; });
  const why = {}; let n = 0, hidden = 0;
  for (let i = 0; i < 120; i++) {
    if (i % 6 === 0) await send(i % 12 ? c1 : host, { k: nextKey(keys) });
    const r = await host.evaluate((sel) => { const s = document.querySelector(sel); if (!s || !s.childElementCount) return null; const y = s.classList.contains('yield'); if (!y) return { y }; const me = s.getBoundingClientRect(), D = window.__dirM; const c = []; if (D.hintCur && !D.hintEl.classList.contains('hidden')) c.push('hint:' + ((D.hintCur.kind) || '?')); if (D.cur) c.push('hero'); if (!document.querySelector('#emote-menu').classList.contains('hidden')) c.push('menu'); return { y, c }; }, STRIP);
    if (r) { n++; if (r.y) { hidden++; const k = (r.c || []).join('+') || 'other'; why[k] = (why[k] || 0) + 1; } }
    await sleep(250);
  }
  run.note(`fresh profile, 30 s: strip had lines in ${n} samples, hidden in ${hidden} (${Math.round(100 * hidden / Math.max(1, n))}%), causes ${JSON.stringify(why)}`);
  run.check(hidden / Math.max(1, n) <= 0.35, `strip hidden ${Math.round(100 * hidden / Math.max(1, n))}% of a new player's first 30 s (tips/toasts share its slot)`);
};

(async () => {
  const browser = await chromium.launch();
  let fails = 0, n = 0;
  for (const [k, fn] of Object.entries(S)) {
    if (ONLY && !ONLY.includes(k)) continue;
    n++;
    const run = new L.Run(browser, k, 1); await run.open();
    try { await fn(run); } catch (e) { run.fails.push('threw: ' + String(e.message || e).split('\n')[0]); }
    run.fails.push(...run.errors);
    if (run.fails.length) fails++;
    console.log(`${run.fails.length ? 'FAIL' : 'PASS'} ${k}${run.fails.length ? '\n   - ' + run.fails.join('\n   - ') : ''}${run.notes.length ? '\n   . ' + run.notes.join('\n   . ') : ''}${run.shots.length ? '\n   shots ' + run.shots.join(' ') : ''}`);
    await run.close();
  }
  await browser.close();
  console.log(`chatlog: ${n - fails}/${n} pass`);
  process.exit(fails ? 1 : 0);
})();

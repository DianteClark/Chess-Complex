// 18.0 (SO): Friends e2e, two SEPARATE browser contexts (two phones) on the Worker-served game.
//   cd server && npx wrangler dev --local --port 8812 --ip 127.0.0.1 --var ROOM_TEST:1 --var PLAYER_TEST:1 --var NEW_PER_HOUR:1000 --var SO_FAN_MS:1500 --persist-to /tmp/so
//   NODE_PATH=$(npm root -g) node server/test/social.e2e.cjs [http://127.0.0.1:8812]      (screens -> /tmp/so18)
// Add friend by tag -> accept -> presence (online / in a lobby / in a match) -> Invite -> pop-up Join -> same lobby ->
// match start records Recent Players (cloud save) -> Appear Offline -> block from Recent -> blocked player loses presence
// and invites. Both orientations (390x844 + 844x390) are screenshotted; text >= 11 px and targets >= 40 px are checked.
const { chromium } = require('playwright');
const fs = require('fs');
const SITE = (process.argv[2] || 'http://127.0.0.1:8812').replace(/\/$/, '');
const OUT = process.env.OUT || '/tmp/so18';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
async function clear(page) { for (let i = 0; i < 6; i++) { const any = await page.evaluate(() => { const s = document.querySelector('.sequel'); if (s) { s.click(); return 1; } for (const x of document.querySelectorAll('.modal:not(.hidden)')) { if (x.id === 'm-settings' || x.id === 'm-results') continue; const b = x.querySelector('#lg-claim, [data-close], .btn'); if (b) { b.click(); return 1; } } return 0; }); if (!any) break; await page.waitForTimeout(400); } }
const go = (page, s) => page.evaluate((s) => { const b = document.createElement('button'); b.dataset.go = s; b.style.display = 'none'; document.querySelector('#s-title').appendChild(b); b.click(); b.remove(); }, s);
const until = async (page, fn, arg, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(200); } };
const SO = (page) => page.evaluate(async () => { const S = (await import('/js/social.js'))._state; return { tag: S.me && S.me.tag, ok: S.ok, n: S.n, inv: S.inv.length, list: S.list && { friends: S.list.friends.map((f) => f.name + ':' + f.st), req: S.list.req.map((x) => x.name), out: S.list.out.length, blocked: S.list.blocked.map((x) => x.name) } }; });
// one list op over the page's own friends link (= one request to its own Player DO), repeated until pred (presence is pushed, debounced)
async function pollList(page, pred, ms = 12000) { const t0 = Date.now(); let l; for (let i = 0; ; i++) { l = await page.evaluate((i) => new Promise(async (res) => { const S = (await import('/js/social.js'))._state; const q = 'qp' + i + Date.now(); S.q.set(q, res); S.ws.send(JSON.stringify({ t: 'op', q, op: 'list' })); }), i); if (l && l.friends && pred(l)) return l; if (Date.now() - t0 > ms) return l; await sleep(500); } }
const screen = (page) => page.evaluate(() => document.querySelector('.screen.active').id);
const errs = [];
async function open(browser, vp, name) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(name + ': ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|peerjs|ERR_|Failed to load resource|fonts|WebSocket/i.test(m.text())) errs.push(name + ': ' + m.text()); });
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('cc_seen_version', '99'); sessionStorage.setItem('seeded', '1'); } });
  await page.goto(SITE + '/', { waitUntil: 'load' }); await page.waitForTimeout(1500); await clear(page);
  await page.evaluate((n) => { const p = window.__cc.profile; p.name = n; p.mode = 'royale'; }, name);
  await until(page, () => { try { return JSON.parse(localStorage.getItem('cc_cloud_v1') || 'null').id; } catch { return null; } }, null, 20000, name + ' cloud save');
  // upload the name now (friends see the name from the cloud save)
  await page.evaluate(async () => { const CS = await import('/js/cloudsave.js'); CS.dirty(); await CS.flush(); });
  await until(page, async () => { const S = (await import('/js/social.js'))._state; return S.ok && S.me && S.me.tag; }, null, 30000, name + ' friends link');
  await page.waitForTimeout(1200); await clear(page); // the daily login reward card shows a moment after the title
  return { ctx, page, name };
}
// every visible text >= 11 px and every visible button >= 40 px tall on the Friends screen
const audit = (page) => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('#s-friends *, #so-pop *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && parseFloat(cs.fontSize) < 11) bad.push('font ' + cs.fontSize + ' ' + el.className + ' "' + el.textContent.trim().slice(0, 20) + '"');
    if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && r.height < 39.5) bad.push('target ' + Math.round(r.height) + ' ' + el.className + ' "' + el.textContent.trim().slice(0, 20) + '"');
  }
  const doc = document.querySelector('#s-friends .scroll'); if (doc && doc.scrollWidth > doc.clientWidth + 1) bad.push('horizontal overflow');
  return bad;
});
const shot = (X, f) => X.page.screenshot({ path: `${OUT}/${f}` });
const friendsRow = (page, name) => page.evaluate((n) => { const r = [...document.querySelectorAll('#so-body .so-row')].find((x) => x.querySelector('.so-who b') && x.querySelector('.so-who b').textContent === n); return r ? r.querySelector('.so-who span').textContent : null; }, name);

(async () => {
  const browser = await chromium.launch();
  const A = await open(browser, { width: 390, height: 844 }, 'Avery'), B = await open(browser, { width: 844, height: 390 }, 'Blake');
  try {
    const ta = (await SO(A.page)).tag, tb = (await SO(B.page)).tag;
    ok(/^[0-9A-Z]{8}$/.test(ta) && /^[0-9A-Z]{8}$/.test(tb) && ta !== tb, `tags ${ta} ${tb}`);
    // ---- entry points: title corner + Play footer
    await A.page.click('.corner-tr .so-open'); await sleep(600);
    ok(await screen(A.page) === 's-friends', 'title Friends button opens the Friends screen');
    ok(await A.page.evaluate(() => document.querySelector('.so-me-tag b').textContent) === ta.slice(0, 4) + '-' + ta.slice(4), 'own tag shown as XXXX-XXXX');
await go(B.page, 'play'); await sleep(500);
    await B.page.click('#btn-friends'); await sleep(600);
    ok(await screen(B.page) === 's-friends', 'Play screen Friends button opens it');
    await shot(A, 'friends-empty-390x844.png'); await shot(B, 'friends-empty-844x390.png');
    // ---- add by tag (typed lower case with a dash)
    await A.page.fill('#so-add-in', (tb.slice(0, 4) + '-' + tb.slice(4)).toLowerCase()); await A.page.click('[data-so="add"]');
    await until(A.page, async () => { const S = (await import('/js/social.js'))._state; return S.list && S.list.out.length === 1; }, null, 8000, 'request sent');
    ok(/Waiting for them/.test(await A.page.evaluate(() => document.querySelector('#so-body').textContent)), 'A: "Requests sent" row');
    await until(B.page, () => /\d/.test(document.querySelector('.so-tabs .so-n') ? document.querySelector('.so-tabs .so-n').textContent : ''), null, 8000, 'B request badge');
    ok(await B.page.evaluate(() => /Avery/.test(document.querySelector('#so-body').textContent) && !!document.querySelector('[data-so="accept"]')), 'B: request from Avery pushed live (no refresh)');
    await shot(B, 'friends-request-844x390.png');
    await B.page.click('[data-so="accept"]');
    await until(B.page, async () => { const S = (await import('/js/social.js'))._state; return S.list && S.list.friends.length === 1; }, null, 8000, 'B friends');
    await until(A.page, async () => { const S = (await import('/js/social.js'))._state; return S.list && S.list.friends.length === 1; }, null, 8000, 'A friends (pushed)');
    ok(/Online/.test(await friendsRow(A.page, 'Blake') || ''), 'presence: A sees Blake Online ' + await friendsRow(A.page, 'Blake'));
    await shot(A, 'friends-list-390x844.png'); await shot(B, 'friends-list-844x390.png');
    const au = [...await audit(A.page), ...await audit(B.page)]; ok(!au.length, 'Friends screen: text >= 11 px, targets >= 40 px, no overflow ' + au.slice(0, 6).join(' | '));
    // ---- invite: A has no party yet -> Invite opens one and sends the invite once the room has its code
    await B.page.click('[data-so="back"]'); await sleep(400); await go(B.page, 'title'); await sleep(1200); await clear(B.page);
    await A.page.click('#so-body [data-so="invite"]');
    await until(A.page, () => { const s = window.__cc.session; return s && s.cloud && s.code && s.myPid && document.querySelector('#s-host.active'); }, null, 20000, 'A hosts a cloud party');
    const code = await A.page.evaluate(() => window.__cc.session.code);
    await until(B.page, () => document.querySelector('#so-pop.show'), null, 10000, 'invite pop-up on B');
    ok(/Avery/.test(await B.page.evaluate(() => document.querySelector('#so-pop').textContent)), 'B: invite pop-up names Avery');
    ok(await B.page.evaluate(() => document.querySelector('.corner-tr .so-badge').textContent === '1'), 'B: Friends badge on the title button');
    await shot(B, 'invite-pop-844x390.png');
    await B.page.click('#so-pop [data-so="inv-join"]');
    await until(B.page, () => { const s = window.__cc.session; return s && s.myPid && s.lobbyMsg && s.lobbyMsg.players.length >= 2 && s.code; }, null, 20000, 'B in the lobby');
    const bs = await B.page.evaluate(() => ({ code: window.__cc.session.code, screen: document.querySelector('.screen.active').id, names: window.__cc.session.lobbyMsg.players.map((p) => p.name).join(',') }));
    ok(bs.code === code && bs.screen === 's-join' && /Avery/.test(bs.names) && /Blake/.test(bs.names), `accept -> same lobby ${JSON.stringify(bs)} (A ${code})`);
    ok(await until(B.page, () => window.__cc.session.lobbyMsg.players.every((p) => p.isBot || /^[0-9A-Z]{8}$/.test(p.tag || '')), null, 6000, 'tags').catch(() => false), 'lobby seats carry public tags (once verified)');
    await shot(A, 'party-host-390x844.png'); await shot(B, 'party-join-844x390.png');
    // presence from the Room: Friends screen from the Host screen's Invite Friends button
    await A.page.click('#so-host-inv'); await sleep(500);
    await until(A.page, async () => { const S = (await import('/js/social.js'))._state; return S.list && S.list.friends[0] && S.list.friends[0].st === 'lobby'; }, null, 10000, 'Blake in a lobby');
    ok(/In a lobby/.test(await friendsRow(A.page, 'Blake') || ''), 'presence: Blake In a lobby ' + await friendsRow(A.page, 'Blake'));
    ok(/Party .* is open/.test(await A.page.evaluate(() => document.querySelector('.so-me-foot p').textContent)), 'Friends screen knows the open party');
    await shot(A, 'friends-in-lobby-390x844.png');
    await A.page.click('[data-so="back"]'); await sleep(500);
    ok(await screen(A.page) === 's-host', 'Back returns to the party');
    // ---- match start -> Recent Players on both phones + presence In a match
    await A.page.evaluate(() => window.__cc.session.client.send({ t: 'test', op: 'set', T: { fast: true, introMs: 0 } }));
    await A.page.click('[data-act="add-bot"]'); await sleep(400);
    await B.page.click('#btn-ready'); await until(A.page, () => /Blake:ready/.test(window.__cc.session.lobbyMsg.players.map((x) => x.name + ':' + x.st).join(',')), null, 8000, 'Blake ready');
    await A.page.click('#btn-start-host');
    await until(A.page, () => document.querySelector('#s-game.active') && window.__cc.game.s, null, 20000, 'A in game');
    await until(B.page, () => document.querySelector('#s-game.active') && window.__cc.game.s, null, 20000, 'B in game');
    await sleep(800);
    const ra = await A.page.evaluate(() => window.__cc.profile.recent), rb = await B.page.evaluate(() => window.__cc.profile.recent);
    ok(ra && ra[0] && ra[0].name === 'Blake' && ra[0].tag === tb && ra[0].mode === 'royale', 'A Recent: Blake with tag ' + JSON.stringify(ra && ra[0]));
    ok(rb && rb[0] && rb[0].name === 'Avery' && rb[0].tag === ta && rb.length === 1, 'B Recent: Avery only (bots skipped) ' + JSON.stringify(rb));
    // ask the server directly through the friends link (the in-match screen has no list open)
    const fm = await pollList(A.page, (l) => l.friends[0] && l.friends[0].st === 'match');
    ok(fm.friends[0].st === 'match' && fm.friends[0].room === code && fm.rpc === 0, 'presence: Blake In a match (room shared for Watch), list read with 0 peer calls ' + JSON.stringify(fm.friends[0]));
    // the match ends (test kill), both go back to the menus
    await A.page.evaluate(() => { const s = window.__cc.game.s, me = window.__cc.session; for (const u of s.units) if (u.kind === 'player' && u.alive && u.name !== 'Avery') me.client.send({ t: 'test', op: 'kill', pid: u.pid }); });
    await until(A.page, () => window.__cc.game.s && window.__cc.game.s.over, null, 15000, 'match over');
    await sleep(1500);
    // ---- Appear Offline (B) hides presence from A
    for (const X of [A, B]) await X.page.evaluate(() => { document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden')); });
    await go(B.page, 'title'); await sleep(1200); await clear(B.page);
    await B.page.click('.corner-tr .so-open'); await sleep(700);
    await B.page.click('[data-so="hide"]'); await until(B.page, () => document.querySelector('[data-so="hide"]').getAttribute('aria-checked') === 'true', null, 6000, 'hide on');
    const fm2 = await pollList(A.page, (l) => l.friends[0] && l.friends[0].st === 'offline');
    ok(fm2.friends[0].st === 'offline', 'Appear Offline: A sees Blake offline ' + JSON.stringify(fm2.friends[0]));
    await shot(B, 'friends-appear-offline-844x390.png');
    await B.page.click('[data-so="hide"]'); await sleep(400);
    // ---- Recent tab (B) + block Avery from there
    await B.page.click('[data-so="tab"][data-v="recent"]'); await sleep(300);
    ok(/Avery/.test(await B.page.evaluate(() => document.querySelector('#so-body').textContent)) && /Friend/.test(await B.page.evaluate(() => document.querySelector('#so-body .so-note') && document.querySelector('#so-body .so-note').textContent)), 'Recent tab: Avery marked Friend');
    await shot(B, 'friends-recent-844x390.png');
    await B.page.click('#so-body [data-so="more"]'); await sleep(200);
    await B.page.click('#so-body [data-so="block"]'); await sleep(100);
    ok(/Tap again/.test(await B.page.evaluate(() => document.querySelector('#so-body [data-so="block"]').textContent)), 'block asks for a second tap');
    await B.page.click('#so-body [data-so="block"]');
    await until(B.page, async () => { const S = (await import('/js/social.js'))._state; return S.list && S.list.blocked.length === 1 && !S.list.friends.length; }, null, 8000, 'B blocked Avery');
    await B.page.click('[data-so="tab"][data-v="blocked"]'); await sleep(300);
    ok(/Avery/.test(await B.page.evaluate(() => document.querySelector('#so-body').textContent)) && await B.page.evaluate(() => !!document.querySelector('[data-so="unblock"]')), 'Blocked tab lists Avery with Unblock');
    await shot(B, 'friends-blocked-844x390.png');
    await until(A.page, async () => { const S = (await import('/js/social.js'))._state; return S.list && !S.list.friends.length; }, null, 8000, 'A lost Blake (pushed)');
    ok(true, 'A: Blake gone from friends after the block');
    const inv2 = await A.page.evaluate((tb) => new Promise(async (res) => { const S = (await import('/js/social.js'))._state; S.q.set('qt4', res); S.ws.send(JSON.stringify({ t: 'op', q: 'qt4', op: 'invite', tag: tb, room: 'ABCDE' })); }), tb);
    ok(!inv2.ok, 'blocked: A can no longer invite Blake (' + inv2.why + ')');
    await go(A.page, 'title'); await sleep(1200); await clear(A.page); await A.page.click('.corner-tr .so-open'); await sleep(500);
    await A.page.fill('#so-add-in', tb); await A.page.click('[data-so="add"]'); await sleep(1200);
    const bReq = await B.page.evaluate(async () => { const S = (await import('/js/social.js'))._state; return S.n.req; });
    ok(bReq === 0, 'blocked: A\'s new request never reaches Blake');
    await shot(A, 'friends-after-block-390x844.png');
    ok(!errs.length, 'no page errors ' + errs.slice(0, 5).join(' | '));
  } catch (e) { fail++; console.log('FAIL', e.message); for (const X of [A, B]) console.log('   ', X.name, JSON.stringify(await X.page.evaluate(async () => { const S = (await import('/js/social.js'))._state; return { ok: S.ok, ws: S.ws && S.ws.readyState, n: S.n, err: S.err, friends: S.list && S.list.friends.map((f) => f.name), screen: document.querySelector('.screen.active').id }; }).catch((e) => String(e)))); for (const X of [A, B]) await shot(X, 'fail-' + X.name + '.png').catch(() => {}); }
  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();

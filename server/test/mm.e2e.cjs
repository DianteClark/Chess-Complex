// 17.1 (MM): Quick Play / Browse / Public party e2e, two SEPARATE browser contexts on the Worker-served game.
//   cd server && npx wrangler dev --local --port 8799 --var ROOM_TEST:1 --var NEW_PER_HOUR:1000
//   NODE_PATH=$(npm root -g) node server/test/mm.e2e.cjs [http://localhost:8799]      (screens -> /tmp/mm17)
const { chromium } = require('playwright');
const fs = require('fs');
const SITE = (process.argv[2] || 'http://localhost:8799').replace(/\/$/, '');
const OUT = process.env.OUT || '/tmp/mm17';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(SITE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const list = (mode) => fetch(SITE + '/mm/list' + (mode ? '?mode=' + mode : '')).then((r) => r.json()).then((j) => j.rooms);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
async function clear(page) { for (let i = 0; i < 6; i++) { const any = await page.evaluate(() => { const s = document.querySelector('.sequel'); if (s) { s.click(); return 1; } for (const x of document.querySelectorAll('.modal:not(.hidden)')) { if (x.id === 'm-settings' || x.id === 'm-results') continue; const b = x.querySelector('#lg-claim, [data-close], .btn'); if (b) { b.click(); return 1; } } return 0; }); if (!any) break; await page.waitForTimeout(400); } }
const go = (page, s) => page.evaluate((s) => { const b = document.createElement('button'); b.dataset.go = s; b.style.display = 'none'; document.querySelector('#s-title').appendChild(b); b.click(); b.remove(); }, s);
const until = async (page, fn, arg, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(200); } };
const errs = [];
async function open(browser, vp, name, q = '') {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); page._nav = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) page._nav++; });
  page.on('pageerror', (e) => errs.push(name + ': ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|peerjs|ERR_|Failed to load resource|fonts|WebSocket/i.test(m.text())) errs.push(name + ': ' + m.text()); });
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('cc_seen_version', '99'); sessionStorage.setItem('seeded', '1'); } });
  await page.goto(SITE + '/' + q, { waitUntil: 'load' }); await page.waitForTimeout(1500); await clear(page);
  await page.evaluate((n) => { const p = window.__cc.profile; p.name = n; p.mode = 'royale'; }, name);
  return { ctx, page };
}

// ---- 17.1.1: after a Quick Play match (player report: Back to Party "reset the game")
const sess = (p) => p.evaluate(() => { const s = window.__cc.session; return s ? { code: s.code, lead: !!s.lead, bye: s.byeReason || null, mid: s.mid || null, pid: s.myPid, screen: document.querySelector('.screen.active').id, lm: s.lobbyMsg ? { qp: !!s.lobbyMsg.qp, pub: !!s.lobbyMsg.pub, fromQp: !!s.lobbyMsg.fromQp, live: !!(s.lobbyMsg.party || {}).live, cd: s.lobbyMsg.cd || 0, hum: s.lobbyMsg.players.filter((x) => !x.isBot).map((x) => x.name + ':' + x.st).join(',') } : null } : { screen: document.querySelector('.screen.active').id, none: true }; });
const killIn = (p, o) => p.evaluate((o) => { const s = window.__cc.game.s, me = window.__cc.session; for (const u of s.units) if (u.kind === 'player' && u.alive && (o.only ? o.only.includes(u.name) : !o.except.includes(u.name))) me.client.send({ t: 'test', op: 'kill', pid: u.pid }); }, o);
async function toResults(p) { // open the results card (an eliminated player is spectating: tap Results) and wait for the party button
  for (let i = 0; i < 120; i++) {
    await clear(p);
    const t = await p.evaluate(() => { if (document.querySelector('#m-results').classList.contains('hidden')) { const sb = document.querySelector('#spec-bar'), r = sb && sb.querySelector('[data-act="results"]'); if (sb && !sb.classList.contains('hidden') && r) r.click(); } const rb = document.querySelector('#btn-rematch'); return !document.querySelector('#m-results').classList.contains('hidden') && rb && !rb.classList.contains('hidden') && rb.textContent; }).catch(() => null);
    if (t) return t; await sleep(500);
  }
  throw new Error('results never showed a party button');
}
async function inGame(p, notMid) { return until(p, (m) => document.querySelector('#s-game.active') && window.__cc.game.s && window.__cc.session && window.__cc.session.mid && window.__cc.session.mid !== m && window.__cc.session.mid, notMid || '', 30000, 'in game'); }
async function afterMatch(browser) {
  const A = await open(browser, { width: 390, height: 844 }, 'Cara'), B = await open(browser, { width: 844, height: 390 }, 'Dima');
  try {
    for (const X of [A, B]) { await go(X.page, 'play'); await X.page.waitForTimeout(500); }
    await A.page.click('#btn-quick'); await until(A.page, () => window.__cc.session && window.__cc.session.myPid, null, 25000, 'Cara in lobby');
    await A.page.evaluate(() => window.__cc.session.client.send({ t: 'test', op: 'set', T: { qpWait: 2500 } }));
    await sleep(300); await B.page.click('#btn-quick');
    const mid1 = await inGame(A.page); await inGame(B.page);
    const code = (await sess(A.page)).code; ok((await sess(B.page)).code === code, 'after-match: both in Quick Play room ' + code);
    await sleep(1500);
    // member eliminated while the match runs: Back to Party now (match still live)
    await killIn(A.page, { only: ['Dima'] });
    ok(/Back to Party/.test(await toResults(B.page)), 'eliminated member: results offer Back to Party');
    await B.page.click('#btn-rematch'); await sleep(1500);
    let b = await sess(B.page); ok(b.screen === 's-join' && b.code === code && !b.bye, 'member Back to Party mid-match: party lobby of the same room ' + JSON.stringify(b));
    // the match ends; the leader taps Back to Party
    await killIn(A.page, { except: ['Cara'] });
    ok(/Back to Party/.test(await toResults(A.page)), 'leader (winner): results offer Back to Party');
    await A.page.click('#btn-rematch'); await sleep(2000);
    const a = await sess(A.page); b = await sess(B.page);
    const both = a.screen === 's-host' && a.lead && a.code === code && b.screen === 's-join' && b.code === code;
    ok(both, `both in the same party lobby (leader Host ${a.code}, member Join ${b.code})`);
    if (!both) for (const [X, n] of [[A, 'Cara'], [B, 'Dima']]) console.log('      ' + n + ' ' + JSON.stringify(await sess(X.page)) + '\n      link: ' + (await X.page.evaluate(async () => (await import('/js/cloud.js')).CLOUD.log.slice(-14).join(' | '))));
    ok(a.lm && !a.lm.qp && !a.lm.pub && a.lm.fromQp && !a.lm.live && a.lm.cd === 0 && /Cara:leader/.test(a.lm.hum) && /Dima:/.test(a.lm.hum), 'party: private, no Quick Play countdown, same two players ' + JSON.stringify(a.lm));
    ok(await A.page.evaluate(() => !!document.querySelector('#mm-host-note')) && await B.page.evaluate(() => !!document.querySelector('#mm-join-note')), 'Quick Play group note on both lobbies');
    ok(A.page._nav === 1 && B.page._nav === 1, `no reload / navigation (nav ${A.page._nav}/${B.page._nav})`);
    await A.page.screenshot({ path: `${OUT}/qp-after-party-390x844.png` }); await B.page.screenshot({ path: `${OUT}/qp-after-party-844x390.png` });
    ok(!(await list()).some((r) => r.code === code), 'party not listed in Browse');
    const q3 = await post('/mm/quick', { mode: 'royale' }); ok(q3.code && q3.code !== code, 'a stranger\'s Quick Play is never put into the party');
    // Play Again: member readies, leader starts the next match
    await B.page.click('#btn-ready'); await until(A.page, () => /Dima:ready/.test(window.__cc.session.lobbyMsg.players.map((x) => x.name + ':' + x.st).join(',')), null, 8000, 'Dima ready');
    await A.page.click('#btn-start-host');
    const mid2 = await inGame(A.page, mid1); const mid2b = await inGame(B.page, mid1);
    ok(mid2 === mid2b && mid2 !== mid1, 'rematch: both in the next match ' + mid2);
    await sleep(1500);
    // the leader's phone goes to the background mid-results (pagehide persisted = app switch / page cache) and comes back
    await killIn(A.page, { except: ['Cara'] });
    await toResults(A.page); await toResults(B.page);
    await A.page.evaluate(async () => { const { NET } = await import('/js/net.js'); dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); NET.drop(1500); });
    await sleep(2500);
    await A.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await until(A.page, () => window.__cc.session && window.__cc.session.client && window.__cc.session.client.live, null, 10000, 'Cara reconnected');
    const a2 = await sess(A.page); ok(!a2.none && a2.code === code && !a2.bye, 'pagehide (persisted) + pageshow: still in the party ' + JSON.stringify({ code: a2.code, bye: a2.bye }));
    await A.page.click('#btn-rematch');
    const a3 = await until(A.page, () => document.querySelector('#s-host.active') && window.__cc.session && window.__cc.session.code, null, 10000, 'Cara Host lobby');
    ok(a3 === code && await A.page.evaluate(() => window.__cc.session.mode !== 'solo'), 'then Back to Party: Host lobby of the same room (no solo match)');
    // the member's link gives up on the results screen (lost): Rejoin Party, never a solo Play Again
    await B.page.evaluate(async () => { // every reconnect fails until restored: cloud.js gives up after retryFor -> byeReason 'lost'
      const { CLOUD } = await import('/js/cloud.js'); const { NET } = await import('/js/net.js');
      window.__WS = window.WebSocket; window.WebSocket = class { constructor() { this.readyState = 0; setTimeout(() => this.onclose && this.onclose({}), 30); } send() {} close() {} };
      CLOUD.retryFor = 800; NET.drop(0);
    });
    const lbl = await until(B.page, () => { const s = window.__cc.session, rb = document.querySelector('#btn-rematch'); return s && s.byeReason === 'lost' && !rb.classList.contains('hidden') && rb.textContent; }, null, 15000, 'lost');
    ok(lbl === 'Rejoin Party', 'member link lost on results: button says ' + lbl);
    await B.page.evaluate(() => { window.WebSocket = window.__WS; }); await sleep(500); await B.page.screenshot({ path: `${OUT}/qp-lost-844x390.png` });
    await B.page.click('#btn-rematch');
    await until(B.page, () => window.__cc.session && window.__cc.session.myPid && window.__cc.session.lobbyMsg && document.querySelector('#s-join.active'), null, 15000, 'rejoined');
    b = await sess(B.page); ok(b.code === code && !b.bye && !(await B.page.evaluate(() => window.__cc.session.mode === 'solo')), 'Rejoin Party: back in the same party lobby ' + JSON.stringify({ code: b.code, hum: b.lm && b.lm.hum }));
    ok(A.page._nav === 1 && B.page._nav === 1, 'still no reloads');
    await B.page.screenshot({ path: `${OUT}/qp-rejoin-844x390.png` });
  } catch (e) {
    ok(false, 'after-match: ' + e.message);
    for (const [X, n] of [[A, 'Cara'], [B, 'Dima']]) { console.log('    ' + n, JSON.stringify(await sess(X.page).catch(() => null))); console.log('      link log: ' + (await X.page.evaluate(async () => (await import('/js/cloud.js')).CLOUD.log.slice(-14).join(' | ')).catch(() => ''))); }
  }
  await A.ctx.close(); await B.ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await post('/mm/test', { op: 'reset' }); await post('/mm/test', { op: 'set', L: { quickPerMin: 500, createsPer10: 500, roomsPerIp: 500 } });
  const A = await open(browser, { width: 390, height: 844 }, 'Alice');
  const B = await open(browser, { width: 844, height: 390 }, 'Bruno');
  try {
    // ---- Play screen with Quick Play + Browse (both orientations)
    for (const [X, tag] of [[A, '390x844'], [B, '844x390']]) { await go(X.page, 'play'); await X.page.waitForTimeout(900); await clear(X.page); await X.page.screenshot({ path: `${OUT}/play-${tag}.png` }); }
    ok(await A.page.isVisible('#btn-quick') && await B.page.isVisible('#btn-browse'), 'Quick Play + Browse on the Play screen');
    const fit = await B.page.evaluate(() => { const f = document.querySelector('#s-play .play-foot').getBoundingClientRect(); return f.bottom <= innerHeight + 1 && f.height < 90; });
    ok(fit, 'landscape: Play footer stays one row');

    // ---- Alice: Quick Play -> new public lobby, waiting card
    await A.page.click('#btn-quick');
    // (a box at load 15+ can push the first same-origin /health past cloud.js's 6 s budget: the card then offers Try Again, like on a slow phone)
    const st0 = await until(A.page, () => { const c = document.querySelector('#mm-card'); return c && !c.classList.contains('hidden') && (/Waiting for players/.test(c.textContent) ? 'wait' : /Try Again/.test(c.textContent) ? 'retry' : null); }, null, 20000, 'Alice waiting card');
    if (st0 === 'retry') { console.log('     (slow health: Try Again)'); await A.page.click('#mm-card [data-mm="retry"]'); await until(A.page, () => /Waiting for players/.test(document.querySelector('#mm-card').textContent), null, 20000, 'Alice waiting card (retry)'); }
    const codeA = await A.page.evaluate(() => window.__cc.session && window.__cc.session.code);
    ok(/^[A-Z0-9]{5}$/.test(codeA || ''), 'Alice in a Quick Play lobby ' + codeA);
    ok(await A.page.evaluate(() => getComputedStyle(document.querySelector('#s-join .code-panel')).display === 'none' && document.querySelector('#s-join .bar h2').textContent === 'Quick Play'), 'code entry hidden, header says Quick Play');
    await A.page.evaluate(() => window.__cc.session.client.send({ t: 'test', op: 'set', T: { qpWait: 7000 } })); // ROOM_TEST: shorter countdown for the test
    await A.page.waitForTimeout(400); await A.page.screenshot({ path: `${OUT}/qp-waiting-390x844.png` });

    // ---- Bruno: Browse shows Alice's lobby (no private rooms), then Quick Play lands in the same room
    await B.page.click('#btn-browse');
    await until(B.page, (c) => [...document.querySelectorAll('#mm-list [data-mm="join"]')].some((b) => b.dataset.code === c), codeA, 15000, 'Browse row');
    ok(true, 'Browse lists the open Quick Play lobby');
    await B.page.screenshot({ path: `${OUT}/browse-844x390.png` });
    await B.page.click('#s-browse .back'); await B.page.waitForTimeout(500);
    await B.page.click('#btn-quick');
    await until(B.page, () => window.__cc.session && window.__cc.session.myPid && window.__cc.session.code, null, 20000, 'Bruno joined');
    const codeB = await B.page.evaluate(() => window.__cc.session.code);
    ok(codeB === codeA, `both Quick Play into the same room (${codeA} / ${codeB})`);
    const cdA = await until(A.page, () => { const e = document.querySelector('#mm-cd'); return e && +e.textContent; }, null, 10000, 'countdown A');
    await until(B.page, () => document.querySelector('#mm-cd'), null, 10000, 'countdown B');
    ok(cdA > 0 && cdA <= 7, 'countdown on both screens: ' + cdA + ' s');
    await A.page.screenshot({ path: `${OUT}/qp-countdown-390x844.png` }); await B.page.screenshot({ path: `${OUT}/qp-countdown-844x390.png` });
    const rows = await list('royale'); ok(rows.some((r) => r.code === codeA && r.st === 'starting' && r.n === 2), 'listed as starting with 2 players');

    // ---- the match starts on both phones: same mid, 2 humans + 6 bots
    const midA = await until(A.page, () => document.querySelector('#s-game.active') && window.__cc.game.s && window.__cc.session.mid, null, 25000, 'Alice in game');
    const midB = await until(B.page, () => document.querySelector('#s-game.active') && window.__cc.game.s && window.__cc.session.mid, null, 25000, 'Bruno in game');
    ok(midA && midA === midB, 'same match ' + midA);
    const who = await A.page.evaluate(() => { const s = window.__cc.game.s; return { n: s.units.filter((u) => u.kind === 'player').length, hum: s.units.filter((u) => u.kind === 'player' && !u.isBot && ['Alice', 'Bruno'].includes(u.name)).length }; });
    ok(who.n === 8 && who.hum === 2, `8 seats, 2 humans (${JSON.stringify(who)})`);
    await A.page.waitForTimeout(2500); await A.page.screenshot({ path: `${OUT}/qp-match-390x844.png` });
    { const L = await list(), e = L.find((r) => r.code === codeA); ok(!e || e.st === 'live', 'live match listed only as live (18.0 Watch), never as joinable: ' + JSON.stringify(e)); } // 18.0 (A0)
  } catch (e) {
    ok(false, 'quick play flow: ' + e.message);
    for (const [X, n] of [[A, 'A'], [B, 'B']]) console.log('    ' + n, JSON.stringify(await X.page.evaluate(() => ({ scr: (document.querySelector('.screen.active') || {}).id, card: document.querySelector('#mm-card').textContent.slice(0, 160), st: document.querySelector('#join-status').textContent, modal: [...document.querySelectorAll('.modal:not(.hidden)')].map((m) => m.id) }))).catch(() => null));
  }
  await A.ctx.close(); await B.ctx.close();
  await afterMatch(browser); // 17.1.1 (MM)

  // ---- a code party: Private by default (hidden), Public switch lists it, back to Private unlists it
  const C = await open(browser, { width: 390, height: 844 }, 'Hosty');
  try {
    await go(C.page, 'play'); await C.page.waitForTimeout(600); await C.page.click('#btn-host');
    const code = await until(C.page, () => window.__cc.session && window.__cc.session.cloud && window.__cc.session.lead && window.__cc.session.code, null, 20000, 'cloud host');
    await until(C.page, () => !document.querySelector('#mm-pub-row').classList.contains('hidden'), null, 8000, 'switch');
    ok(await C.page.evaluate(() => document.querySelector('#mm-pub').getAttribute('aria-checked') === 'false'), 'new code party is Private');
    ok(!(await list()).some((r) => r.code === code), 'private code not in Browse');
    await C.page.click('#mm-pub');
    await until(C.page, () => document.querySelector('#mm-pub').getAttribute('aria-checked') === 'true', null, 8000, 'public on');
    await sleep(400); ok((await list()).some((r) => r.code === code && !r.qp), 'Public party listed in Browse');
    await C.page.evaluate(() => document.querySelector('#mm-pub-row').scrollIntoView({ block: 'center' })); await C.page.screenshot({ path: `${OUT}/host-public-390x844.png` });
    await C.page.click('#mm-pub');
    await until(C.page, () => document.querySelector('#mm-pub').getAttribute('aria-checked') === 'false', null, 8000, 'public off');
    await sleep(400); ok(!(await list()).some((r) => r.code === code), 'back to Private: unlisted');
    await C.page.click('#s-host .back'); await sleep(300);
    await C.page.setViewportSize({ width: 844, height: 390 }); await go(C.page, 'host');
    await until(C.page, () => !document.querySelector('#mm-pub-row').classList.contains('hidden'), null, 20000, 'switch landscape');
    await C.page.evaluate(() => document.querySelector('#mm-pub-row').scrollIntoView({ block: 'center' })); await C.page.screenshot({ path: `${OUT}/host-public-844x390.png` });
    await C.page.click('#s-host .back'); await sleep(300);
    // Browse empty state (portrait + landscape)
    await C.page.setViewportSize({ width: 390, height: 844 }); await go(C.page, 'browse');
    await C.page.click('#mm-filters [data-v="duel"]');
    await until(C.page, () => /No open Duel matches/.test(document.querySelector('#mm-list').textContent), null, 10000, 'empty');
    ok(true, 'Browse empty state for Duel'); await C.page.screenshot({ path: `${OUT}/browse-empty-390x844.png` });
    await C.page.setViewportSize({ width: 844, height: 390 }); await C.page.waitForTimeout(400); await C.page.screenshot({ path: `${OUT}/browse-empty-844x390.png` });
  } catch (e) { ok(false, 'public switch: ' + e.message); }
  await C.ctx.close();

  // ---- offline: ?cloud=off -> clear message, code rooms still offered
  const D = await open(browser, { width: 390, height: 844 }, 'Off', '?cloud=off');
  try {
    await go(D.page, 'play'); await D.page.waitForTimeout(600); await D.page.click('#btn-quick');
    await until(D.page, () => /Can't reach the online server/.test(document.querySelector('#mm-card').textContent), null, 10000, 'offline card');
    ok(true, 'offline: clear message on Quick Play'); await D.page.screenshot({ path: `${OUT}/qp-offline-390x844.png` });
    await D.page.setViewportSize({ width: 844, height: 390 }); await D.page.waitForTimeout(400); await D.page.screenshot({ path: `${OUT}/qp-offline-844x390.png` });
    await D.page.click('#mm-card [data-go="play"]'); await D.page.waitForTimeout(400);
    ok(await D.page.evaluate(() => document.querySelector('#s-play.active') && !document.querySelector('#s-join').classList.contains('mm-qp')), 'Back to Play clears the card');
    await go(D.page, 'browse');
    await until(D.page, () => /Can't load open matches/.test(document.querySelector('#mm-list').textContent), null, 10000, 'offline browse');
    ok(true, 'offline: Browse explains');
    await go(D.page, 'join'); await D.page.waitForTimeout(300);
    ok(await D.page.evaluate(() => getComputedStyle(document.querySelector('#s-join .code-panel')).display !== 'none' && document.querySelector('#s-join .bar h2').textContent === 'Join'), 'Join With Code screen normal again');
  } catch (e) { ok(false, 'offline: ' + e.message); }
  await D.ctx.close();
  await browser.close();
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

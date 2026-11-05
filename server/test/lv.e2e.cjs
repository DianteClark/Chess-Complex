// 18.0 (LV) e2e: a viewer watches a live Quick Play match (Browse -> Watch, window.ccWatch, Leave, Ended + Replay).
// Players and viewers are SEPARATE browser contexts. Server: see test/lv.test.mjs. NODE_PATH=$(npm root -g) node server/test/lv.e2e.cjs http://127.0.0.1:8813   (screens -> /tmp/lv18)
const { chromium } = require('playwright');
const SITE = (process.argv[2] || 'http://127.0.0.1:8813').replace(/\/$/, ''), OUT = '/tmp/lv18';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
async function clear(page) { for (let i = 0; i < 6; i++) { const any = await page.evaluate(() => { const s = document.querySelector('.sequel'); if (s) { s.click(); return 1; } for (const x of document.querySelectorAll('.modal:not(.hidden)')) { if (x.id === 'm-settings' || x.id === 'm-results') continue; const b = x.querySelector('#lg-claim, [data-close], .btn'); if (b) { b.click(); return 1; } } return 0; }); if (!any) break; await page.waitForTimeout(400); } }
const go = (page, s) => page.evaluate((s) => { const b = document.createElement('button'); b.dataset.go = s; b.style.display = 'none'; document.querySelector('#s-title').appendChild(b); b.click(); b.remove(); }, s);
const until = async (page, fn, arg, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(200); } };
const errs = [];
async function open(browser, vp, name) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(name + ': ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|peerjs|ERR_|Failed to load resource|fonts|WebSocket/i.test(m.text())) errs.push(name + ': ' + m.text()); });
  await page.addInitScript(() => { const o = WebSocket.prototype.send; window.__wsOut = []; WebSocket.prototype.send = function (d) { try { const t = JSON.parse(d).t; if (t !== 'hb') window.__wsOut.push(t); } catch {} return o.call(this, d); }; });
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('cc_seen_version', '99'); sessionStorage.setItem('seeded', '1'); } });
  await page.goto(SITE + '/', { waitUntil: 'load' }); await page.waitForTimeout(1500); await clear(page);
  await page.evaluate((n) => { const p = window.__cc.profile; p.name = n; p.mode = 'royale'; p.games = Math.max(1, p.games || 0); }, name);
  return { ctx, page };
}
const hashOf = (p, watcher) => p.evaluate(async (w) => { const { stateHash } = await import('/js/statehash.js'); const M = w ? window.__ccWatch && window.__ccWatch.client && window.__ccWatch.client.match : window.__cc.session && window.__cc.session.client && window.__cc.session.client.match; return M && M.s ? { v: M.s.v, x: stateHash(M.s), over: !!M.s.over } : null; }, watcher);

(async () => {
  const browser = await chromium.launch();
  try {
    await fetch(SITE + '/mm/test', { method: 'POST', body: JSON.stringify({ op: 'reset' }) });
    await fetch(SITE + '/mm/test', { method: 'POST', body: JSON.stringify({ op: 'set', L: { quickPerMin: 500, createsPer10: 500, roomsPerIp: 500 } }) });
    const A = await open(browser, { width: 390, height: 844 }, 'Ava'), B = await open(browser, { width: 390, height: 844 }, 'Ben');
    const V = await open(browser, { width: 390, height: 844 }, 'Vic');
    for (const X of [A, B]) { await go(X.page, 'play'); await X.page.waitForTimeout(500); }
    await A.page.click('#btn-quick'); await until(A.page, () => window.__cc.session && window.__cc.session.myPid, null, 25000, 'Ava in lobby');
    await A.page.evaluate(() => window.__cc.session.client.send({ t: 'test', op: 'set', T: { qpWait: 2000, introMs: 4000 } }));
    await sleep(300); await B.page.click('#btn-quick');
    await until(A.page, () => document.querySelector('#s-game.active') && window.__cc.game.s, null, 30000, 'match on Ava');
    const code = await A.page.evaluate(() => window.__cc.session.code);
    ok(!!code, 'Quick Play match live in room ' + code);
    // viewer: Browse -> Watch
    await go(V.page, 'browse');
    const live = await until(V.page, (c) => { const b = document.querySelector(`#mm-list [data-mm="watch"][data-code="${c}"]`); return b && b.closest('.mm-room').textContent; }, code, 20000, 'Watch row in Browse');
    ok(/Live/i.test(live), 'Browse shows the live match with Watch: ' + live.replace(/\s+/g, ' ').trim());
    await V.page.screenshot({ path: `${OUT}/browse-live-390x844.png` });
    const n0 = await V.page.evaluate(async () => (await import('/js/cloud.js')).CLOUD.stats.tx);
    await V.page.click(`#mm-list [data-mm="watch"][data-code="${code}"]`);
    await until(V.page, () => document.body.classList.contains('watching') && document.querySelector('#s-game.active') && window.__cc.game.s && !document.querySelector('#spec-bar').classList.contains('hidden'), null, 20000, 'viewer on the board');
    ok(true, 'viewer entered the match (spectator bar up)');
    const ui = await V.page.evaluate(() => ({ live: document.querySelector('#sv-live').textContent, n: document.querySelector('#sv-n').textContent, menu: getComputedStyle(document.querySelector('#s-game [data-act="menu"]')).display, rp: document.querySelector('#rp-ctl').classList.contains('hidden'), mode: window.__cc.session.mode, watch: !!window.__cc.session.watch, me: !!window.__cc.game.me }));
    ok(ui.live === 'Live' && /1 watching/.test(ui.n) && ui.menu === 'none' && ui.rp && ui.watch && !ui.me, 'spectator bar: LIVE, 1 watching, no menu / replay controls / seat ' + JSON.stringify(ui));
    await sleep(6000);
    await V.page.screenshot({ path: `${OUT}/watch-390x844.png` });
    // lockstep: same state hash as a player at the same version
    let same = null;
    for (let i = 0; i < 40 && !same; i++) { const [a, v] = [await hashOf(A.page, false), await hashOf(V.page, true)]; if (a && v && a.v === v.v) same = { a, v }; else await sleep(150); }
    ok(same && same.a.x === same.v.x, 'viewer replica hash == player hash ' + JSON.stringify(same));
    // follow a player, taps on the board send nothing
    await V.page.click('#spec-bar [data-act="spec-next"]'); await sleep(300);
    const fol = await V.page.evaluate(() => document.querySelector('#spec-name').textContent);
    ok(fol && !/^Auto/.test(fol), 'follow a player: ' + fol);
    const box = await V.page.locator('#s-game canvas').first().boundingBox();
    for (const [fx, fy] of [[0.5, 0.45], [0.3, 0.5], [0.7, 0.55]]) await V.page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
    await sleep(800);
    const out = await V.page.evaluate(() => window.__wsOut.slice());
    // 18.0 (A0): 'auth'/'hb' come from the Friends socket (js/social.js), not the Room
    ok(out.length >= 1 && out.every((t) => t === 'watch' || t === 'sync' || t === 'auth' || t === 'hb'), `viewer sent only watch (+sync), no bl/act after board taps: ${JSON.stringify(out)}`);
    // a second viewer in landscape: count goes to 2 on both
    const W2 = await open(browser, { width: 844, height: 390 }, 'Wes');
    await W2.page.evaluate((c) => window.ccWatch(c), code);
    await until(W2.page, () => document.body.classList.contains('watching') && window.__cc.game.s, null, 20000, 'second viewer');
    await until(V.page, () => /2 watching/.test(document.querySelector('#sv-n').textContent), null, 8000, '2 watching');
    ok(true, 'second viewer (window.ccWatch, 844x390): both show 2 watching');
    await sleep(2500); await W2.page.screenshot({ path: `${OUT}/watch-844x390.png` });
    // Leave -> back to Browse
    await V.page.click('#sv-ctl [data-sv="leave"]');
    await until(V.page, () => document.querySelector('#s-browse.active') && !document.body.classList.contains('watching') && !document.body.classList.contains('replaying'), null, 8000, 'viewer back on Browse');
    ok(true, 'Leave returns the viewer to Browse');
    await until(W2.page, () => /1 watching/.test(document.querySelector('#sv-n').textContent), null, 8000, 'count back to 1');
    ok(true, 'watcher count drops to 1 on the other viewer');
    // end the match: the viewer sees Ended + Replay, which opens the replay viewer
    await A.page.evaluate(() => { const s = window.__cc.game.s, me = window.__cc.session; for (const u of s.units) if (u.kind === 'player' && u.alive && u.name !== 'Ava') me.client.send({ t: 'test', op: 'kill', pid: u.pid }); });
    await until(W2.page, () => document.querySelector('#sv-live').textContent === 'Ended', null, 20000, 'Ended tag');
    const end = await until(W2.page, () => !document.querySelector('#sv-ctl [data-sv="replay"]').classList.contains('hidden') && document.querySelector('#s-game.active') && document.querySelector('#m-results').classList.contains('hidden') && 'replay', null, 25000, 'Replay button');
    ok(!!end, 'match over on the viewer: Ended tag + Replay button, no results card');
    const fa = await hashOf(A.page, false), fw = await hashOf(W2.page, true);
    ok(fa && fw && fa.over && fw.over && fa.x === fw.x, 'final hash equal ' + JSON.stringify([fa, fw]));
    await W2.page.screenshot({ path: `${OUT}/watch-ended-844x390.png` });
    await W2.page.click('#sv-ctl [data-sv="replay"]');
    await until(W2.page, () => window.__ccReplay && !document.querySelector('#rp-ctl').classList.contains('hidden') && !document.body.classList.contains('watching'), null, 20000, 'replay viewer');
    ok(true, 'Replay opens the saved match in the replay viewer');
    // a match that is over can't be watched
    const late = await V.page.evaluate((c) => window.ccWatch(c), code);
    ok(late === false, 'watching a finished match answers false (toast)');
    ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 5)));
  } catch (e) { fail++; console.log('FAIL', e.message); }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

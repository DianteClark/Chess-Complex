// 17.0 (L2): Leaderboards e2e + screenshots. NODE_PATH=$(npm root -g) node server/test/lb.e2e.cjs [http://localhost:8789]  (wrangler dev with --var LB_TEST:1; shots in /tmp/l217)
const { chromium } = require('playwright');
const SITE = (process.argv[2] || 'http://localhost:8789').replace(/\/$/, '');
const Q = '/?cloud=' + SITE;
const OUT = '/tmp/l217';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(SITE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const get = (p) => fetch(SITE + p).then((r) => r.json());
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
const NAMES = ['Kasparov', 'Judit', 'Hikaru', 'Magnus', 'Vishy', 'Ding', 'Alireza', 'Hou Yifan', 'Fabi', 'Nepo', 'Wesley', 'Levon', 'Anish', 'Gukesh', 'Pragg', 'Ju Wenjun', 'Tania', 'Bobby', 'Mikhail', 'Garry', 'Viktor', 'Boris', 'Anatoly', 'Vera', 'Nona'];
const PCS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'], SK = ['ivory', 'onyx', 'celestial', 'ember', 'frost', 'jade'];
const cidN = (i) => 'R' + String(i).padStart(9, '0');
const rows = (n, f) => Array.from({ length: n }, (_, i) => ({ cid: cidN(i + 1), name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + (Math.floor(i / NAMES.length) + 1) : ''), avatar: PCS[i % 6] + ':' + SK[(i * 7) % 6], title: i % 3 === 0 ? 'Grandmaster' : i % 3 === 1 ? 'Tactician' : '', ...f(i) }));
async function clear(page) { for (let i = 0; i < 6; i++) { const any = await page.evaluate(() => { const s = document.querySelector('.sequel'); if (s) { s.click(); return 1; } for (const x of document.querySelectorAll('.modal:not(.hidden)')) { if (x.id === 'm-settings') continue; const b = x.querySelector('#lg-claim, [data-close], .btn'); if (b) { b.click(); return 1; } } return 0; }); if (!any) break; await page.waitForTimeout(500); } }
const go = (page, s) => page.evaluate((s) => { const b = document.createElement('button'); b.dataset.go = s; b.style.display = 'none'; document.querySelector('#s-title').appendChild(b); b.click(); b.remove(); }, s);
async function tab(page, t) { await page.evaluate((t) => document.querySelector(`#lb-tabs [data-lb-tab="${t}"]`).click(), t); await page.waitForTimeout(900); }

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|peerjs|ERR_INTERNET|Failed to load resource|fonts/i.test(m.text())) errs.push(m.text()); });
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('cc_seen_version', '99'); sessionStorage.setItem('seeded', '1'); } });
  await post('/lb/test/reset', {});
  await page.goto(SITE + Q, { waitUntil: 'load' }); await page.waitForTimeout(1800); await clear(page);
  let id = null; for (let i = 0; i < 60 && !id; i++) { id = await page.evaluate(() => (JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}').id) || null); if (!id) await sleep(250); }
  ok(!!id, 'cloud save id created: ' + id);
  await page.evaluate(() => { const p = window.__cc.profile; p.name = 'Diante'; p.title = 'Crown Seeker'; });

  // ---- the Daily card says the rule before the run
  await page.evaluate(() => { window.__cc.profile.mode = 'daily'; }); await go(page, 'play'); await page.waitForTimeout(2500);
  const note = await page.evaluate(() => { const n = document.querySelector('#opt-daily .lb-dnote'); if (n) n.scrollIntoView({ block: 'center' }); return n && n.textContent; });
  ok(/Your first run of the day counts/.test(note || ''), 'Play > Daily card: "' + note + '"');
  await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/play-daily-390.png` });
  // ---- an honest Daily played in the page (human = planBot on a copy, bots = the page's own GameHost)
  const t0 = Date.now();
  await page.evaluate(async () => {
    const E = await import('/js/engine.js');
    window.__cc.startSolo(null, 'daily');
    const sess = window.__cc.session; sess.host.fast = true; sess.host.go();
    window.__drive = setInterval(() => {
      const s = sess.host.s; if (s.over) { clearInterval(window.__drive); return; }
      const u = s.units.find((v) => v.id === s.active); if (!u || u.pid !== 'me' || u.bot) return;
      if (window.__busy) return; window.__busy = true;
      const plan = E.planBot(structuredClone(s), structuredClone(u)); const turn = s.turnNo;
      for (const a of plan) { sess.send(a); if (s.over || s.active !== u.id || s.turnNo !== turn) break; }
      if (!s.over && s.active === u.id && s.turnNo === turn) sess.send({ type: 'end' });
      window.__busy = false;
    }, 30);
  });
  let res = null;
  for (let i = 0; i < 240 && !res; i++) { await sleep(500); await clear(page).catch(() => {}); res = await page.evaluate(() => { const r = document.querySelector('#lb-res'); return r && /#\d+ of|could not|Offline|Cloud/.test(r.textContent) ? r.textContent : null; }); }
  ok(res && /Daily rank/.test(res), `Daily run from the page verified by the server: "${res}" (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const nAct = await page.evaluate(() => window.__cc.session && window.__cc.session.host.rec.actions.length);
  console.log('     actions logged', nAct);
  await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (/back to results/i.test(b.textContent) && b.offsetParent) b.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('#lb-res') && document.querySelector('#lb-res').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/results-daily-390.png` });

  // ---- seed the boards around this player
  const sid = (await get('/lb/top?board=season')).sid;
  await post('/lb/test/rowset', { board: 'season', sid, rows: [...rows(70, (i) => ({ v: 960 - i * 12, games: 4 + (i % 9), wins: i % 4 })), { cid: id, name: 'Diante', avatar: 'queen:celestial', title: 'Crown Seeker', v: 960 - 57.5 * 12, games: 9, wins: 2 }] });
  await post('/lb/test/rowset', { board: 'rating', rows: [...rows(40, (i) => ({ v: 1712 - i * 14 - (i % 3) * 3, games: 14 + i })), { cid: id, name: 'Diante', avatar: 'queen:celestial', title: 'Crown Seeker', v: 1655, games: 23 }] });
  const day = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; });
  await post('/lb/test/rowset', { board: 'daily', day, rows: rows(24, (i) => ({ v: 2380 - i * 71, place: 1 + (i % 5), kills: 3 - (i % 4) })) });
  const lastSid = new Date(Date.parse(sid) - 7 * 864e5).toISOString().slice(0, 10);
  await post('/lb/test/rowset', { board: 'season', sid: lastSid, rows: rows(30, (i) => ({ v: 1400 - i * 31, games: 10, wins: 5 })) });
  await post('/lb/test/rollover', {}); // archives last week (the seeded rows) into the "Last week" board

  async function shoot(w, h, tagName) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300);
    await go(page, 'title'); await page.waitForTimeout(900); await clear(page);
    await page.screenshot({ path: `${OUT}/title-${tagName}.png` });
    await page.evaluate(() => document.querySelector('.lb-open').click()); await page.waitForTimeout(1200);
    const on = await page.evaluate(() => document.querySelector('#s-ranks').classList.contains('active'));
    ok(on, `${tagName}: title crown button opens Leaderboards`);
    await tab(page, 'season');
    const S = await page.evaluate(() => ({ rows: document.querySelectorAll('#lb-body .lb-row').length, pin: !document.querySelector('#lb-pin').classList.contains('hidden') && document.querySelector('#lb-pin .lb-row.me .lb-rk').textContent, around: !!document.querySelector('.lb-sep') }));
    ok(S.rows >= 50 && S.pin === '59' && S.around, `${tagName}: Season top 50 + around me + pinned row #${S.pin}`);
    await page.screenshot({ path: `${OUT}/season-${tagName}.png` });
    await page.evaluate(() => document.querySelector('[data-lb-last="1"]').click()); await page.waitForTimeout(900);
    const L = await page.evaluate(() => document.querySelectorAll('#lb-body .lb-row').length);
    ok(L === 30, `${tagName}: Last week archive shows ${L}`);
    await page.screenshot({ path: `${OUT}/season-last-${tagName}.png` });
    await tab(page, 'rating');
    const R = await page.evaluate(() => ({ me: document.querySelector('#lb-body .lb-row.me .lb-rk') && document.querySelector('#lb-body .lb-row.me .lb-rk').textContent, big: document.querySelector('.lb-big b').textContent, pinHidden: document.querySelector('#lb-pin').classList.contains('hidden') }));
    ok(R.me === '5' && R.big === '1655' && R.pinHidden, `${tagName}: Crown Rating, my row #${R.me} in the list, hero ${R.big}`);
    await page.screenshot({ path: `${OUT}/rating-${tagName}.png` });
    await tab(page, 'daily');
    const D = await page.evaluate(() => ({ n: document.querySelectorAll('#lb-body .lb-list .lb-row').length, me: !!document.querySelector('#lb-body .lb-row.me, #lb-pin .lb-row.me'), big: document.querySelector('.lb-big b').textContent }));
    ok(D.n >= 25 && D.me && /^#\d+$/.test(D.big), `${tagName}: Daily board ${D.n} rows, my verified run ${D.big}`);
    await page.screenshot({ path: `${OUT}/daily-${tagName}.png` });
    // offline: the cached board with a clear Offline state
    await ctx.setOffline(true);
    await tab(page, 'season');
    const O = await page.evaluate(() => ({ off: !!document.querySelector('.lb-state.off'), rows: document.querySelectorAll('#lb-body .lb-row').length }));
    ok(O.off && O.rows >= 50, `${tagName}: offline shows the cached board (${O.rows} rows) with the Offline banner`);
    await page.screenshot({ path: `${OUT}/offline-${tagName}.png` });
    await ctx.setOffline(false);
    await go(page, 'profile');
    let P = null; for (let i = 0; i < 20 && !/1655/.test(P || ''); i++) { await page.waitForTimeout(500); P = await page.evaluate(() => { const e = document.querySelector('.lb-prof'); if (!e) return null; e.scrollIntoView({ block: 'center' }); return e.textContent; }); }
    ok(P && /1655/.test(P) && /#59/.test(P), `${tagName}: profile Rankings panel (${(P || '').replace(/\s+/g, ' ').slice(0, 90)})`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/profile-${tagName}.png` });
    // back button returns to where the screen was opened from
    await page.evaluate(() => document.querySelector('.lb-prof [data-go="ranks"]').click()); await page.waitForTimeout(800);
    const back = await page.evaluate(() => document.querySelector('#s-ranks .back').dataset.go);
    ok(back === 'profile', `${tagName}: Back from Leaderboards returns to ${back}`);
  }
  await shoot(390, 844, '390');
  await shoot(844, 390, '844');
  // never-online player: no cache, offline
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errs.push(String(e)));
  await p2.addInitScript(() => { localStorage.setItem('cc_seen_version', '99'); });
  await p2.goto(SITE + '/?cloud=off', { waitUntil: 'load' }); await p2.waitForTimeout(1500); await clear(p2);
  await p2.evaluate(() => document.querySelector('.lb-open').click()); await p2.waitForTimeout(900);
  const off = await p2.evaluate(() => document.querySelector('.lb-state.off') && document.querySelector('.lb-state.off').textContent);
  ok(off && /Connect/.test(off), 'cloud off, nothing cached: Offline state with guidance');
  await p2.screenshot({ path: `${OUT}/offline-empty-390.png` });
  // ---- start -> quit -> second run is practice (DNF on the board); offline start is unranked
  const fresh = async (q) => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); const pg = await c.newPage(); pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('cc_seen_version', '99'); sessionStorage.setItem('seeded', '1'); } });
    await pg.goto(SITE + (q || Q), { waitUntil: 'load' }); await pg.waitForTimeout(1800); await clear(pg); return { c, pg }; };
  const waitId = async (pg) => { for (let i = 0; i < 60; i++) { const v = await pg.evaluate(() => JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}').id || null); if (v) return v; await sleep(250); } return null; };
  {
    const { c, pg } = await fresh(); const qid = await waitId(pg);
    await pg.evaluate(() => { window.__cc.profile.name = 'Quitter'; });
    const a1 = await pg.evaluate(async () => { window.__cc.startSolo(null, 'daily'); return window.__cc.session.lbStart; });
    ok(a1 && a1.ranked === true, 'quit test: first Daily start registered as the ranked run');
    await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(1800); await clear(pg); // app closed mid-run
    await pg.evaluate(() => { window.__cc.profile.mode = 'daily'; }); await go(pg, 'play'); await pg.waitForTimeout(2500);
    const n2 = await pg.evaluate(() => document.querySelector('#opt-daily .lb-dnote') && document.querySelector('#opt-daily .lb-dnote').textContent);
    ok(/Practice/.test(n2 || ''), 'quit test: Play card now says "' + n2 + '"');
    const a2 = await pg.evaluate(async () => { window.__cc.startSolo(null, 'daily'); return window.__cc.session.lbStart; });
    ok(a2 && a2.ranked === false, 'quit test: second run is practice (' + JSON.stringify(a2) + ')');
    const day = await pg.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; });
    await post('/lb/test/age', { cid: qid, day, ms: 91 * 60e3 });
    const stt = await get(`/lb/daily/status?cid=${qid}&day=${day}`);
    ok(stt.st === 'dnf', 'quit test: server shows the abandoned run as ' + stt.st);
    await c.close();
    await page.setViewportSize({ width: 390, height: 844 }); await go(page, 'title'); await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('.lb-open').click()); await page.waitForTimeout(900); await tab(page, 'daily');
    const dn = await page.evaluate(() => { const r = document.querySelector('#lb-body .lb-row.dnf'); if (r) r.scrollIntoView({ block: 'center' }); return r && r.textContent; });
    ok(/DNF/.test(dn || '') && /Quitter/.test(dn || ''), 'Daily board lists the abandoned run as DNF below the finishers');
    await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/daily-dnf-390.png` });
  }
  {
    const { c, pg } = await fresh(); await waitId(pg);
    await c.route('**/health', (r) => r.abort()); await c.route('**/lb/**', (r) => r.abort());
    await pg.evaluate(() => { window.__cc.profile.mode = 'daily'; }); await go(pg, 'play');
    let n3 = null; for (let i = 0; i < 20 && !/Offline/.test(n3 || ''); i++) { await pg.waitForTimeout(500); n3 = await pg.evaluate(() => { const n = document.querySelector('#opt-daily .lb-dnote'); if (n) n.scrollIntoView({ block: 'center' }); return n && n.textContent; }); }
    ok(/Offline: this run won't be ranked/.test(n3 || ''), 'offline: Play card says "' + n3 + '"');
    await pg.screenshot({ path: `${OUT}/play-daily-offline-390.png` });
    const a3 = await pg.evaluate(async () => { window.__cc.startSolo(null, 'daily'); return window.__cc.session.lbStart; });
    ok(a3 && a3.ranked === false && a3.why === 'offline', 'offline: the run is unranked (' + JSON.stringify(a3) + ')');
    await c.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();

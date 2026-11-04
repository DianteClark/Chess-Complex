// 17.0 Cloud (P): client cloud save + transfer code, end to end in Chromium.
// 17.0: the Worker serves the game and the API on one origin. Needs `wrangler dev` (server/) on CLOUD:
//   cd server && npx wrangler dev --port 8797 --persist-to /tmp/cc-e2e --var NEW_PER_HOUR:50
//   NODE_PATH=$(npm root -g) node server/test/cloudsave.e2e.cjs [http://localhost:8797] [shotDir]
// TS=1: Turnstile mode. Start wrangler with --var TURNSTILE_SECRET:test-secret
//   --var TURNSTILE_VERIFY_URL:http://127.0.0.1:8796/siteverify; this script serves that fake siteverify, answers /cfg with
//   a site key and replaces the Cloudflare widget script with a stub (this sandbox cannot reach Cloudflare).
// The migration check opens the old site as http://127.0.0.1:<port>/?cloud=http://localhost:<port>&home=http://localhost:<port>/
// (any origin + ?home acts as GitHub Pages; the API is cross-origin like Pages -> workers.dev) and follows the move card to http://localhost:<port>/#transfer=... (a second origin).
// Checks: a fresh phone creates a cloud player and saves; earning Marks is uploaded; a second browser context (phone B)
// applies phone A's transfer code from Settings (confirm dialog) and gets A's progress; ?cloud=off and an unreachable
// cloud stay fully local with no page errors; Settings screenshots at 390x844 and 844x390.
const { chromium } = require('playwright');
const fs = require('fs');
const CLOUD = (process.argv[2] || process.env.CLOUD || 'http://localhost:8797').replace(/\/$/, '');
const TS = process.env.TS === '1';
const OLD = CLOUD.replace('//localhost', '//127.0.0.1');
const SHOTS = process.argv[3] || '/tmp/p17';
const SITE = process.env.SITE || CLOUD + '/';
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const encode = (id, secret) => { const s = id + secret; let c = 0; for (const ch of s) { c <<= 1; if (c & 32) c ^= 0x25; c ^= A32.indexOf(ch); } return (s + A32[c]).match(/.{1,4}/g).join('-'); };

// Main phones name the cloud explicitly (N2's same-origin probe gives up after 1.5 s, which a loaded test box can exceed);
// the migration check below uses the real same-origin detection on both origins.
async function phone(browser, { w = 390, h = 844, query = '?nosplash=1&cloud=' + encodeURIComponent(CLOUD), seed, site = SITE, human = 'auto' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [], reqs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|net::/.test(m.text())) errs.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(site)) reqs.push(r.method() + ' ' + r.url()); });
  if (TS) await turnstileStub(ctx, human);
  await page.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('cc_seen_version', '99'); if (s) localStorage.setItem('cc_profile_v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, seed || null);
  await page.goto(site + query, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await clear(page);
  return { ctx, page, errs, reqs };
}
async function clear(page) {
  for (let i = 0; i < 6; i++) {
    const any = await page.evaluate(() => { const s = document.querySelector('.sequel'); if (s) { s.click(); return 1; } for (const x of document.querySelectorAll('.modal:not(.hidden)')) { if (x.id === 'm-settings' || x.id === 'm-transfer' || x.id === 'm-move') continue; const b = x.querySelector('#lg-claim, [data-close], .btn'); if (b) { b.click(); return 1; } } return 0; });
    if (!any) break; await page.waitForTimeout(500);
  }
}
const cs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'));
const waitFor = async (page, fn, arg, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(250); } };
async function server(id, secret) { const r = await fetch(`${CLOUD}/player/${id}`, { headers: { Authorization: 'Bearer ' + secret } }); return { s: r.status, j: await r.json().catch(() => null) }; }
async function openSettings(page) { await page.evaluate(() => document.querySelector('[data-act="settings"]').click()); await page.waitForTimeout(500); await page.evaluate(() => document.querySelector('#cs-row').scrollIntoView({ block: 'center' })); await page.waitForTimeout(300); }
async function openTransfer(page) { await page.evaluate(() => document.querySelector('[data-act="cloud-transfer"]').click()); await page.waitForTimeout(500); }

// Turnstile stub: /cfg gets a site key; the widget script defines window.turnstile. human 'auto' passes at once,
// 'tap' asks for interaction (before-interactive-callback) and passes when the stub's button is tapped.
async function turnstileStub(ctx, human) {
  await ctx.route('**/cfg', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ turnstileSiteKey: '1x00000000000000000000AA', features: {} }) }));
  await ctx.route('https://challenges.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.__tsLoads = (window.__tsLoads || 0) + 1; window.turnstile = { render(el, o) { window.__tsOpts = { sitekey: o.sitekey, appearance: o.appearance };
    if (${JSON.stringify(human)} === 'auto') { setTimeout(() => o.callback('GOOD-TOKEN'), 50); return 'w1'; }
    o['before-interactive-callback'] && o['before-interactive-callback']();
    const b = document.createElement('button'); b.id = 'ts-fake'; b.textContent = 'I am human'; b.style.cssText = 'width:300px;height:65px'; b.onclick = () => o.callback('GOOD-TOKEN'); el.appendChild(b); return 'w2'; },
    remove() { const b = document.getElementById('ts-fake'); if (b) b.remove(); } };` }));
}

(async () => {
  let fakeVerify = null;
  if (TS) fakeVerify = require('http').createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: /GOOD-TOKEN/.test(b) && /test-secret/.test(b) })); }); }).listen(8796, '127.0.0.1');
  const browser = await chromium.launch();
  const health = await fetch(CLOUD + '/health').then((r) => r.ok).catch(() => false);
  if (!health) { console.log('FAIL cloud not reachable at ' + CLOUD); process.exit(1); }

  // ---- phone A: create on first launch, initial save ----
  const A = await phone(browser, { human: 'tap' });
  if (TS) {
    const card = await waitFor(A.page, () => { const c = document.querySelector('#cs-human'); return c && !c.classList.contains('hidden') ? 1 : null; }, null, 15000);
    ok(!!card, 'TS: the check card shows only when Turnstile asks for a tap');
    ok(await A.page.evaluate(() => window.__tsLoads === 1 && window.__tsOpts.sitekey === '1x00000000000000000000AA' && window.__tsOpts.appearance === 'interaction-only'), 'TS: script loaded once, with the /cfg site key, interaction-only');
    await A.page.screenshot({ path: `${SHOTS}/turnstile-390x844.png` });
    await A.page.click('#ts-fake');
  }
  const credA = await waitFor(A.page, () => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.id && o.rev >= 1 ? o : null; }, null, 60000);
  ok(!!credA, 'A: new profile created and first save uploaded', credA ? `id ${credA.id}, rev ${credA.rev}` : JSON.stringify(await cs(A.page)));
  let srv = credA && await server(credA.id, credA.secret);
  ok(srv && srv.s === 200 && srv.j.blob && srv.j.blob.p && srv.j.blob.p.name, 'A: server holds the profile blob', srv && `rev ${srv.j.rev}, name ${srv.j.blob && srv.j.blob.p.name}`);

  // ---- earn Marks (any profile save, here the name field) -> debounced upload ----
  const before = await A.page.evaluate(() => window.__cc.profile.marks);
  await A.page.evaluate(() => { window.__cc.profile.marks += 250; const i = document.querySelector('#in-name'); i.value = 'CloudTester'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const t0 = Date.now();
  const up = await waitFor(A.page, (rev) => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.rev > rev && !o.dirty ? o : null; }, credA.rev, 45000);
  ok(!!up, 'A: earning Marks triggers a debounced save', up ? `rev ${up.rev} after ${((Date.now() - t0) / 1000).toFixed(1)} s` : '');
  srv = await server(credA.id, credA.secret);
  ok(srv.j.blob.p.marks === before + 250 && srv.j.blob.p.name === 'CloudTester', 'A: server has the new Marks and name', `marks ${srv.j.blob.p.marks} (was ${before}), ledger ${JSON.stringify(srv.j.blob.p.cs)}`);
  ok(srv.j.blob.p.cs && srv.j.blob.p.cs.earn >= 250, 'A: Marks ledger recorded the earning');

  // ---- Settings row + Transfer panel, screenshots ----
  await openSettings(A.page);
  const row = await A.page.evaluate(() => document.querySelector('#cs-state').textContent);
  ok(/^Saved/.test(row), 'A: Settings row shows Saved', row);
  await A.page.screenshot({ path: `${SHOTS}/settings-390x844.png` });
  await openTransfer(A.page);
  await A.page.screenshot({ path: `${SHOTS}/transfer-masked-390x844.png` });
  await A.page.evaluate(() => document.querySelector('[data-cs="show"]').click()); await A.page.waitForTimeout(300);
  const code = await A.page.evaluate(() => document.querySelector('#cs-code').textContent.trim());
  ok(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4}){6}$/.test(code), 'A: transfer code shown (7 groups, checksum char)', code);
  ok(await A.page.evaluate(() => !!document.querySelector('.cs-qr svg path')), 'A: QR code drawn locally');
  await A.page.screenshot({ path: `${SHOTS}/transfer-390x844.png` });
  const sizes = await A.page.evaluate(() => { const bad = []; for (const el of document.querySelectorAll('#m-transfer *')) { const r = el.getBoundingClientRect(); if (!r.width) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && fs < 11) bad.push(el.className + ' ' + fs); if (el.matches('button, input') && (r.height < 40)) bad.push('target ' + (el.dataset.cs || el.id) + ' ' + Math.round(r.height)); } return bad; });
  ok(sizes.length === 0, 'A: panel text >= 11 px and targets >= 40 px (390x844)', sizes.join(', '));

  // ---- phone B: a different phone applies A's code ----
  const B = await phone(browser, { w: 844, h: 390 });
  const credB = await waitFor(B.page, () => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.id && o.rev >= 1 ? o : null; }, null, 60000);
  ok(credB && credB.id !== credA.id, 'B: has its own cloud player first', credB && credB.id);
  await openSettings(B.page);
  await B.page.screenshot({ path: `${SHOTS}/settings-844x390.png` });
  await openTransfer(B.page);
  await B.page.evaluate(() => document.querySelector('[data-cs="show"]').click()); await B.page.waitForTimeout(300);
  await B.page.screenshot({ path: `${SHOTS}/transfer-844x390.png` });
  const sizesB = await B.page.evaluate(() => { const bad = []; for (const el of document.querySelectorAll('#m-transfer button, #m-transfer input')) { const r = el.getBoundingClientRect(); if (r.width && r.height < 40) bad.push((el.dataset.cs || el.id) + ' ' + Math.round(r.height)); } const box = document.querySelector('#m-transfer .cs-box').getBoundingClientRect(); if (box.right > innerWidth + 1 || box.left < -1) bad.push('box overflows x'); return bad; });
  ok(sizesB.length === 0, 'B: panel targets >= 40 px and fits (844x390)', sizesB.join(', '));
  await B.page.fill('#cs-input', 'AAAA-BBBB-CCCC'); await B.page.evaluate(() => document.querySelector('[data-cs="load"]').click()); await B.page.waitForTimeout(300);
  ok(/not valid/.test(await B.page.evaluate(() => document.querySelector('#cs-err').textContent)), 'B: a bad code is refused before any request');
  const typo = code.slice(0, -1) + (code.slice(-1) === '0' ? '1' : '0');
  await B.page.fill('#cs-input', typo); await B.page.evaluate(() => document.querySelector('[data-cs="load"]').click()); await B.page.waitForTimeout(300);
  ok(/not valid/.test(await B.page.evaluate(() => document.querySelector('#cs-err').textContent)), 'B: a one-character typo fails the checksum');
  await B.page.fill('#cs-input', code.toLowerCase().replace(/-/g, ' ')); await B.page.evaluate(() => document.querySelector('[data-cs="load"]').click()); await B.page.waitForTimeout(400);
  const conf = await B.page.evaluate(() => document.querySelector('#m-transfer .cs-box').textContent);
  ok(/This replaces the progress on this phone/.test(conf), 'B: confirm dialog says it replaces the progress on this phone');
  await B.page.screenshot({ path: `${SHOTS}/confirm-844x390.png` });
  await B.page.evaluate(() => document.querySelector('[data-cs="ok-load"]').click());
  await B.page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => {});
  await B.page.waitForTimeout(1800);
  const pB = await B.page.evaluate(() => ({ marks: window.__cc.profile.marks, name: window.__cc.profile.name })); // before clear() claims a login reward
  await clear(B.page);
  const cB = await cs(B.page);
  ok(pB.marks === before + 250 && pB.name === 'CloudTester' && cB.id === credA.id, 'B: transfer restored A’s progress', JSON.stringify(pB) + ' id ' + cB.id);

  // ---- both phones keep syncing: B earns, A picks it up when it comes back to the foreground ----
  await sleep(2200);
  await B.page.evaluate(() => { window.__cc.profile.marks += 40; const i = document.querySelector('#in-name'); i.value = 'FromPhoneB'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const upB = await waitFor(B.page, (rev) => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.rev > rev && !o.dirty ? o : null; }, cB.rev, 45000);
  ok(!!upB, 'B: saves under the shared id', upB && `rev ${upB.rev}`);
  const marksB = await B.page.evaluate(() => window.__cc.profile.marks);
  await A.page.evaluate(() => { document.querySelector('#m-transfer').classList.add('hidden'); });
  // the foreground pull (visibilitychange visible after 60 s), called directly
  await A.page.evaluate(async () => { const m = await import('/js/cloudsave.js'); await m.syncNow(); });
  const pA = await waitFor(A.page, () => window.__cc.profile.name === 'FromPhoneB' ? window.__cc.profile.marks : null, null, 20000);
  ok(pA === marksB && pA >= before + 290, 'A: pulls B’s newer save (adopt, no Marks added)', `A ${pA}, B ${marksB}`);

  // ---- reset code on A: B's old secret stops working ----
  await openTransfer(A.page);
  await A.page.evaluate(() => document.querySelector('[data-cs="reset"]').click()); await A.page.waitForTimeout(300);
  ok(/old code stops working/.test(await A.page.evaluate(() => document.querySelector('#m-transfer .cs-box').textContent)), 'A: reset asks for confirmation');
  await A.page.evaluate(() => document.querySelector('[data-cs="ok-reset"]').click());
  const rotated = await waitFor(A.page, (s) => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.secret && o.secret !== s ? o.secret : null; }, credA.secret, 8000);
  ok(!!rotated, 'A: reset made a new secret', rotated ? '' : await A.page.evaluate(() => (document.querySelector('#cs-err') || {}).textContent));
  ok((await server(credA.id, credA.secret)).s === 401 && (await server(credA.id, rotated)).s === 200, 'A: old secret 401, new secret 200');
  const newCode = await A.page.evaluate(() => (document.querySelector('#cs-code') || {}).textContent || '');
  ok(newCode && newCode !== code, 'A: panel shows the new code', newCode);
  ok(A.errs.length === 0 && B.errs.length === 0, 'A + B: no page errors', [...A.errs, ...B.errs].slice(0, 3).join(' | '));
  await A.ctx.close(); await B.ctx.close();

  // ---- offline: ?cloud=off ----
  const O = await phone(browser, { query: '?nosplash=1&cloud=off' });
  await O.page.evaluate(() => { window.__cc.profile.marks += 10; const i = document.querySelector('#in-name'); i.value = 'Offline'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(6000);
  const oc = await cs(O.page);
  ok(!oc.id && O.reqs.filter((u) => /\/player|\/health/.test(u)).length === 0, '?cloud=off: no player created, no cloud requests', O.reqs.slice(0, 3).join(', '));
  ok(await O.page.evaluate(() => JSON.parse(localStorage.getItem('cc_profile_v1')).name === 'Offline'), '?cloud=off: local save still works');
  await openSettings(O.page);
  ok((await O.page.evaluate(() => document.querySelector('#cs-state').textContent)) === 'Off', '?cloud=off: Settings row says Off');
  await openTransfer(O.page);
  ok(/Cloud save is off/.test(await O.page.evaluate(() => document.querySelector('#m-transfer').textContent)), '?cloud=off: panel explains and offers Backup Code');
  await O.page.screenshot({ path: `${SHOTS}/transfer-off-390x844.png` });
  await O.page.evaluate(() => document.querySelector('#m-transfer').classList.add('hidden'));
  await O.page.evaluate(() => document.querySelector('[data-act="export-profile"]').click()); await O.page.waitForTimeout(400);
  const backup = await O.page.evaluate(() => document.querySelector('#m-info textarea').value);
  await O.page.evaluate(() => { window.__cc.profile.name = 'Changed'; document.querySelector('#m-info').classList.add('hidden'); document.querySelector('[data-act="import-profile"]').click(); });
  await O.page.waitForTimeout(300);
  await O.page.evaluate((c) => { document.querySelector('#import-code').value = c; document.querySelector('[data-act="do-import"]').click(); }, backup);
  await O.page.waitForTimeout(400);
  ok(await O.page.evaluate(() => JSON.parse(localStorage.getItem('cc_profile_v1')).name === 'Offline'), 'Backup Code export + Restore Backup still work');
  ok(!O.reqs.some((u) => /challenges\.cloudflare/.test(u)), '?cloud=off: Turnstile script never loaded');
  ok(O.errs.length === 0, '?cloud=off: no page errors', O.errs.slice(0, 3).join(' | '));
  await O.ctx.close();

  // ---- offline: cloud configured but unreachable ----
  const U = await phone(browser, { query: '?nosplash=1&cloud=' + encodeURIComponent('http://localhost:9') });
  await U.page.evaluate(() => { const i = document.querySelector('#in-name'); i.value = 'NoNet'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(2500);
  await openSettings(U.page);
  const ur = await U.page.evaluate(() => document.querySelector('#cs-state').textContent);
  ok(/^Offline/.test(ur), 'unreachable cloud: Settings row says Offline', ur);
  ok(await U.page.evaluate(() => JSON.parse(localStorage.getItem('cc_profile_v1')).name === 'NoNet'), 'unreachable cloud: local save still works');
  await openTransfer(U.page);
  await U.page.screenshot({ path: `${SHOTS}/transfer-offline-390x844.png` });
  ok(U.errs.length === 0, 'unreachable cloud: no page errors', U.errs.slice(0, 3).join(' | '));
  await U.ctx.close();

  // ---- TS: "Not now" leaves no player and no nagging; Try Again in the panel finishes it ----
  if (TS) {
    const D = await phone(browser, { human: 'tap' });
    await waitFor(D.page, () => { const c = document.querySelector('#cs-human'); return c && !c.classList.contains('hidden') ? 1 : null; }, null, 15000);
    await D.page.evaluate(() => document.querySelector('[data-cs-human="skip"]').click());
    await sleep(1500);
    await openSettings(D.page);
    const row = await D.page.evaluate(() => document.querySelector('#cs-state').textContent);
    ok(!(await cs(D.page)).id && /Not set up yet/.test(row), 'TS: Not now -> no player, row says Not set up yet', row);
    await openTransfer(D.page);
    await D.page.evaluate(() => document.querySelector('[data-cs="retry"]').click());
    await waitFor(D.page, () => document.querySelector('#ts-fake') ? 1 : null, null, 8000);
    await D.page.click('#ts-fake');
    const cD = await waitFor(D.page, () => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.id && o.rev >= 1 ? o : null; }, null, 15000);
    ok(!!cD, 'TS: Try Again -> check -> player created and saved');
    ok(D.errs.length === 0, 'TS: no page errors', D.errs.slice(0, 3).join(' | '));
    await D.ctx.close();
  }

  // ---- migration: old site (127.0.0.1 + ?home) -> new home (localhost) via the one-time card and #transfer= ----
  {
    // old site = GitHub Pages shape: page on one origin, API cross-origin (CORS) on the Worker
    const M = await phone(browser, { site: OLD + '/', query: '?nosplash=1&cloud=' + encodeURIComponent(CLOUD) + '&home=' + encodeURIComponent(CLOUD + '/') });
    const cM = await waitFor(M.page, () => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.id && o.rev >= 1 && !o.dirty ? o : null; }, null, 60000);
    await M.page.evaluate(() => { window.__cc.profile.marks += 77; const i = document.querySelector('#in-name'); i.value = 'Mover'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    let card = null; for (let t0 = Date.now(); !card && Date.now() - t0 < 60000; ) { await clear(M.page); card = await waitFor(M.page, () => (document.querySelector('#m-move') ? 1 : null), null, 3000); } // the card waits for other dialogs (login reward) to close
    if (!card) console.log('DIAG', await M.page.evaluate(() => JSON.stringify({ modals: [...document.querySelectorAll('.modal:not(.hidden)')].map((m) => m.id), sequel: !!document.querySelector('.sequel'), mv: localStorage.getItem('cc_move_v1'), home: sessionStorage.getItem('cc_home'), host: location.host })));
    const synced = await cs(M.page);
    ok(!!card && synced.rev >= cM.rev, 'move: card appears on the old site once the cloud copy is current (Open uploads any newer change first)', `rev ${synced.rev}, dirty ${!!synced.dirty}`);
    await M.page.screenshot({ path: `${SHOTS}/move-390x844.png` });
    const want = { ...(await M.page.evaluate(() => ({ marks: window.__cc.profile.marks, name: window.__cc.profile.name }))), host: new URL(CLOUD).host };
    await M.page.evaluate(() => document.querySelector('[data-mv="go"]').click());
    await M.page.waitForURL((u) => u.origin === new URL(CLOUD).origin, { timeout: 30000 }).catch(() => {});
    ok(M.page.url().startsWith(CLOUD), 'move: opened the new origin', M.page.url().replace(/transfer=.*/, 'transfer=<code>'));
    await M.page.waitForTimeout(1500);
    await M.page.waitForLoadState('load'); await M.page.waitForTimeout(1800);
    const got = await waitFor(M.page, (w) => (location.host === w.host && window.__cc && window.__cc.profile.name === w.name ? { marks: window.__cc.profile.marks, cs: JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'), hash: location.hash } : null), want, 15000);
    ok(got && got.marks === want.marks && got.cs.id === cM.id, 'move: new home (no progress yet) applied the code without asking', got && `marks ${got.marks}, id ${got.cs.id}`);
    ok(got && !got.hash, 'move: the code is removed from the address bar');
    await sleep(2500); await M.page.waitForLoadState('load'); await M.page.waitForTimeout(1500); // the new home reloads after applying
    ok(!(await M.page.evaluate(() => !!document.querySelector('#m-transfer:not(.hidden)'))), 'move: no confirm shown on a fresh new home');
    // the old site does not show the card again
    const M2 = await M.ctx.newPage(); const e2 = []; M2.on('pageerror', (e) => e2.push(e.message));
    await M2.goto(OLD + '/?nosplash=1&cloud=' + encodeURIComponent(CLOUD) + '&home=' + encodeURIComponent(CLOUD + '/'), { waitUntil: 'load' }); await M2.waitForTimeout(6000); await clear(M2);
    ok(!(await M2.evaluate(() => !!document.querySelector('#m-move'))), 'move: one time only (old site, next visit)');
    ok(await M2.evaluate(() => [...document.querySelectorAll('#m-settings [data-act]')].length > 0 && !!JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}').id), 'move: the old site keeps its cloud save');
    // a new home that already has progress asks first
    const N = await phone(browser, { query: '?nosplash=1&cloud=' + encodeURIComponent(CLOUD) });
    await waitFor(N.page, () => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.id ? 1 : null; }, null, 60000);
    await N.page.evaluate(() => { window.__cc.profile.stats.games = 3; const i = document.querySelector('#in-name'); i.value = 'HasProgress'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    const code = encode(cM.id, (await cs(M.page)).secret);
    await N.page.goto(CLOUD + '/?nosplash=1&cloud=' + encodeURIComponent(CLOUD) + '#transfer=' + code, { waitUntil: 'load' });
    const conf = await waitFor(N.page, () => { const m = document.querySelector('#m-transfer:not(.hidden)'); return m && /This replaces the progress on this phone/.test(m.textContent) ? 1 : null; }, null, 10000);
    ok(!!conf && (await N.page.evaluate(() => window.__cc.profile.name)) === 'HasProgress', 'move: a new home with progress asks before replacing');
    await N.page.screenshot({ path: `${SHOTS}/move-confirm-844x390.png` }).catch(() => {});
    ok(M.errs.length === 0 && e2.length === 0 && N.errs.length === 0, 'move: no page errors', [...M.errs, ...e2, ...N.errs].slice(0, 3).join(' | '));
    await M.ctx.close(); await N.ctx.close();
  }

  // ---- landscape panel fits without scrolling ----
  {
    const L = await phone(browser, { w: 844, h: 390 });
    await waitFor(L.page, () => { const o = JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}'); return o.id && o.rev >= 1 ? 1 : null; }, null, 60000);
    await openSettings(L.page); await openTransfer(L.page);
    await L.page.evaluate(() => document.querySelector('[data-cs="show"]').click()); await L.page.waitForTimeout(400);
    const fit = await L.page.evaluate(() => { const b = document.querySelector('#m-transfer .cs-box'); const done = b.querySelector('[data-cs="close"]').getBoundingClientRect(); return { sh: b.scrollHeight, ch: b.clientHeight, doneBottom: Math.round(done.bottom), vh: innerHeight }; });
    ok(fit.sh <= fit.ch + 1 && fit.doneBottom <= fit.vh, 'landscape: Transfer panel fits 844x390 without scrolling', JSON.stringify(fit));
    await L.page.screenshot({ path: `${SHOTS}/transfer-844x390.png` });
    await L.ctx.close();
  }

  if (fakeVerify) fakeVerify.close();
  await browser.close();
  console.log(`\n${pass} pass / ${fail} fail (screens in ${SHOTS})`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

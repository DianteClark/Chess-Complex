// 18.1 (L3): Warden Rating e2e + screenshots. NODE_PATH=$(npm root -g) node server/test/warden.e2e.cjs [http://127.0.0.1:8815]
// (wrangler dev with --var LB_TEST:1 --var PLAYER_TEST:1; shots in /tmp/l318)
const { chromium } = require('playwright');
const SITE = (process.argv[2] || 'http://127.0.0.1:8815').replace(/\/$/, '');
const OUT = '/tmp/l318';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(SITE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
const NAMES = ['Aldric', 'Brenna', 'Cassian', 'Delphine', 'Edmund', 'Freya', 'Gareth', 'Helena', 'Isolde', 'Jory', 'Kael', 'Liora'];
const PCS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'], SK = ['ivory', 'onyx', 'celestial', 'ember', 'frost', 'jade'];
// a minimal final co-op state (runFacts reads siege, siegeWon, units, log)
const fakeState = (mode, cleared, won, team) => ({ siege: { waves: mode === 'gauntlet' ? 4 : 8, wave: won ? (mode === 'gauntlet' ? 4 : 8) : cleared + 1, next: 0, gauntlet: mode === 'gauntlet' }, siegeWon: won, over: true, log: [],
  units: team.map((t, i) => ({ kind: 'player', pid: 'h' + i, name: 'U' + i, bot: !!t.bot, botLevel: 'normal', hk: t.hk, dmgDealt: t.dmg, alive: true })) });
async function seed(players, t1 = Date.now(), tag = 'a') {
  let k = 0;
  for (const [i, P] of players.entries()) for (let r = 0; r < P.runs; r++) {
    const mode = r % 3 ? 'siege' : 'gauntlet', n = 1 + ((i + r) % 3), won = (r + i) % 4 !== 0, W = mode === 'gauntlet' ? 4 : 8;
    const team = Array.from({ length: n }, (_, j) => ({ hk: j ? 10 : 10 + P.skill, dmg: j ? 900 : 900 + 80 * P.skill }));
    const st = fakeState(mode, won ? W : Math.max(0, Math.min(W - 1, Math.round(W * (0.3 + P.skill / 20)))), won && P.skill > 2, team);
    await post('/lb/test/rate', { rec: { mid: `e2e-${tag}-${k++}`, mode, t1, start: { opts: { mode } }, humans: { h0: { name: P.name, verified: true, cid: P.cid, pub: { name: P.name, title: P.title || '', avatar: P.avatar } } }, result: { places: [] }, state: st } });
  }
}
async function clear(page) { for (let i = 0; i < 6; i++) { const any = await page.evaluate(() => { const s = document.querySelector('.sequel'); if (s) { s.click(); return 1; } for (const x of document.querySelectorAll('.modal:not(.hidden)')) { if (x.id === 'm-results' || x.id === 'm-potm') continue; const b = x.querySelector('[data-close], .close, button'); if (b) { b.click(); return 1; } } return 0; }); if (!any) break; await sleep(250); } }
const go = (page, s) => page.evaluate((s) => { const b = document.createElement('button'); b.dataset.go = s; b.style.display = 'none'; document.querySelector('#s-title').appendChild(b); b.click(); b.remove(); }, s);
async function both(page, name, prep) {
  for (const [w, h, tag] of [[390, 844, '390'], [844, 390, '844']]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400); if (prep) await prep(); await page.screenshot({ path: `${OUT}/${name}-${tag}.png` }); }
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
}
// every visible text node >= 11 px and every visible button >= 40 px tall inside a root
const audit = (page, sel) => page.evaluate((sel) => {
  const root = document.querySelector(sel); if (!root) return { small: ['no root'], tiny: [] };
  const small = [], tiny = [];
  for (const el of root.querySelectorAll('*')) { if (!el.offsetParent || !el.childNodes.length) continue; const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (hasText && parseFloat(getComputedStyle(el).fontSize) < 11) small.push(el.className + ':' + el.textContent.trim().slice(0, 20)); }
  for (const b of root.querySelectorAll('button')) { if (!b.offsetParent) continue; const r = b.getBoundingClientRect(); if (r.height < 39.5) tiny.push(b.textContent.trim().slice(0, 20) + ' ' + Math.round(r.height)); }
  return { small: small.slice(0, 6), tiny: tiny.slice(0, 6) };
}, sel);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|peerjs|ERR_INTERNET|Failed to load resource|fonts/i.test(m.text())) errs.push(m.text()); });
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('cc_seen_version', '99'); sessionStorage.setItem('seeded', '1'); } });
  await post('/lb/test/reset', {});
  await page.goto(SITE + '/?cloud=' + SITE, { waitUntil: 'load' }); await page.waitForTimeout(1800); await clear(page);
  let id = null; for (let i = 0; i < 60 && !id; i++) { id = await page.evaluate(() => (JSON.parse(localStorage.getItem('cc_cloud_v1') || '{}').id) || null); if (!id) await sleep(250); }
  ok(!!id, 'cloud save id: ' + id);
  await page.evaluate(() => { const p = window.__cc.profile; p.name = 'Diante'; p.title = 'Wall Keeper'; });
  // seed: 12 other wardens with 5-9 runs at several skills, last week's board too; me: 4 earlier cloud runs
  const others = NAMES.map((n, i) => ({ name: n, cid: 'W' + String(i + 1).padStart(9, '0'), runs: 5 + (i % 5), skill: i % 7, avatar: PCS[i % 6] + ':' + SK[(i * 5) % 6], title: i % 4 === 0 ? 'Hollowbane' : '' }));
  const lastSid = (() => { const d = new Date(Date.now() - 7 * 864e5); const dow = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10); })();
  await post('/lb/test/wrows', { sid: lastSid, rows: others.slice(0, 8).map((o, i) => ({ cid: o.cid, name: o.name, avatar: o.avatar, title: o.title, v: 6000 - i * 430, games: 10 + i, wins: 8 })) });
  await post('/lb/test/rollover', { now: Date.now() });
  await seed(others); await seed([{ name: 'Diante', cid: id, runs: 4, skill: 3, avatar: 'rook:ivory', title: 'Wall Keeper' }], Date.now(), 'me');

  // ---- Play > Siege: the note says which runs count
  await page.evaluate(() => { window.__cc.profile.mode = 'siege'; }); await go(page, 'play'); await page.waitForTimeout(2500);
  const note = await page.evaluate(() => { const n = document.querySelector('#wd-note'); if (n) n.scrollIntoView({ block: 'center' }); return n && n.textContent; });
  ok(/server replays this run/.test(note || ''), 'Play > Siege note: "' + note + '"');
  await both(page, 'play-siege', () => page.evaluate(() => document.querySelector('#wd-note') && document.querySelector('#wd-note').scrollIntoView({ block: 'center' })));
  const tk = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_wd_v1') || '{}').ticket);
  ok(tk && /^[0-9A-Z]{12}$/.test(tk.rid), 'ticket prefetched: ' + (tk && tk.rid));

  // ---- a solo Gauntlet with 1 bot ally, played in the page; verified on the server
  const t0 = Date.now();
  await page.evaluate(async () => {
    const E = await import('/js/engine.js');
    window.__cc.profile.mode = 'gauntlet'; window.__cc.startSolo(1, 'gauntlet');
    const sess = window.__cc.session; sess.host.fast = true; sess.host.go();
    window.__drive = setInterval(() => {
      const s = sess.host.s; if (s.over) { clearInterval(window.__drive); return; }
      const u = s.units.find((v) => v.id === s.active); if (!u || u.pid !== 'me' || u.bot || window.__busy) return;
      window.__busy = true;
      const plan = E.planBot(structuredClone(s), structuredClone(u)); const turn = s.turnNo;
      for (const a of plan) { sess.send(a); if (s.over || s.active !== u.id || s.turnNo !== turn) break; }
      if (!s.over && s.active === u.id && s.turnNo === turn) sess.send({ type: 'end' });
      window.__busy = false;
    }, 30);
  });
  const seedOk = await page.evaluate((rid) => window.__cc.session.host.rec.seed, tk.rid);
  ok(seedOk === tk.seed, 'match seeded by the ticket');
  let res = null;
  for (let i = 0; i < 300 && !res; i++) { await sleep(500); await clear(page).catch(() => {}); res = await page.evaluate(() => { const r = document.querySelector('#wd-res'); return r && /#\d+ of|provisional|could not|Not counted|Offline/.test(r.textContent) ? r.textContent : null; }); }
  ok(res && /Warden run \d+/.test(res) && /(\+|-)\d+/.test(res), `results line: "${res}" (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (/back to results/i.test(b.textContent) && b.offsetParent) b.click(); });
  await page.waitForTimeout(600);
  const rb = await page.evaluate(() => { const b = document.querySelector('#r-board'); return b ? { wd: b.querySelectorAll('.wd18').length, rk: b.querySelectorAll('.rk18').length } : null; });
  ok(rb && rb.wd >= 1 && rb.rk === 0, 'co-op standings carry the Warden badge, not the Crown: ' + JSON.stringify(rb));
  await both(page, 'results', () => page.evaluate(() => document.querySelector('#wd-res') && document.querySelector('#wd-res').scrollIntoView({ block: 'center' })));

  // ---- Leaderboards > Co-op
  await page.evaluate(() => { for (const b of document.querySelectorAll('#m-results button, #s-results button')) if (/home|title|menu/i.test(b.textContent) && b.offsetParent) { b.click(); break; } });
  await page.waitForTimeout(800); await clear(page);
  await go(page, 'ranks'); await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('#lb-tabs [data-lb-tab="coop"]').click()); await page.waitForTimeout(1500);
  const wv = await page.evaluate(() => ({ rows: document.querySelectorAll('#lb-body .lb-row').length, badges: document.querySelectorAll('#lb-body .lb-row .wd18').length, crown: document.querySelectorAll('#lb-body .lb-row .rk18').length, me: !!document.querySelector('#lb-body .lb-row.me, #lb-pin .lb-row.me'), big: (document.querySelector('.wd-big b') || {}).textContent, on: (document.querySelector('#lb-tabs .on') || {}).textContent }));
  ok(wv.rows >= 12 && wv.badges === wv.rows && wv.crown === 0 && wv.on === 'Co-op', 'Co-op tab: Warden board ' + JSON.stringify(wv));
  ok(wv.me && /^\d+$/.test(wv.big || ''), 'my row + rating shown (5 runs: no longer provisional): ' + wv.big);
  let a = await audit(page, '#s-ranks'); ok(!a.small.length && !a.tiny.length, 'Co-op tab: text >= 11 px, buttons >= 40 px ' + JSON.stringify(a));
  await both(page, 'coop-warden');
  await page.evaluate(() => document.querySelector('[data-wd-sub="week"]').click()); await page.waitForTimeout(1200);
  const wk = await page.evaluate(() => ({ rows: document.querySelectorAll('#lb-body .lb-row').length, hero: (document.querySelector('.wd-big small') || {}).textContent }));
  ok(wk.rows >= 13 && /Co-op season/i.test(wk.hero || ''), 'This week ' + JSON.stringify(wk));
  await both(page, 'coop-week');
  await page.evaluate(() => document.querySelector('[data-wd-sub="last"]').click()); await page.waitForTimeout(1200);
  const lw = await page.evaluate(() => ({ rows: document.querySelectorAll('#lb-body .lb-row').length, txt: (document.querySelector('.lb-hi p') || {}).textContent }));
  ok(lw.rows === 8 && /final standings/.test(lw.txt || ''), 'Last week ' + JSON.stringify(lw));
  await both(page, 'coop-last');
  await page.evaluate(() => document.querySelector('#lb-tabs [data-lb-tab="rating"]').click()); await page.waitForTimeout(1000);
  ok(await page.evaluate(() => !document.querySelector('.wd-seg') && /Crown Rating/.test(document.querySelector('#lb-body').textContent)), 'Crown Rating tab unchanged');

  // ---- profile panel
  await go(page, 'profile'); await page.waitForTimeout(1800);
  const pf = await page.evaluate(() => { const e = document.querySelector('.wd-prof'); if (e) e.scrollIntoView({ block: 'start' }); return e && { txt: e.textContent.replace(/\s+/g, ' ').slice(0, 160), chip: !!e.querySelector('.wd18-chip'), steps: e.querySelectorAll('.wd18-step').length }; });
  ok(pf && pf.chip && pf.steps === 6 && /Warden Rating/.test(pf.txt), 'profile Warden panel: ' + (pf && pf.txt));
  a = await audit(page, '.wd-prof'); ok(!a.small.length && !a.tiny.length, 'profile panel sizes ' + JSON.stringify(a));
  await both(page, 'profile', () => page.evaluate(() => document.querySelector('.wd-prof').scrollIntoView({ block: 'start' })));

  // ---- lobby cards: co-op shows Warden, competitive keeps Crown
  const lob = await page.evaluate(async () => {
    const W = await import('/js/wardenui.js');
    return { coop: W.cardTag({ pid: 'me' }), seat: W.cardTag({ pid: 'x', rk: { r: 1300, w: 940 } }), none: W.cardTag({ pid: 'x', rk: { r: 1300 } }) };
  });
  ok(/wd18-paladin/.test(lob.seat) && /wd18/.test(lob.coop) && lob.none === '', 'lobby tags: seat w 940 -> Paladin, mine from cache, none without w');

  // ---- offline: a solo run without a ticket says it won't count
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cc_wd_v1')); s.ticket = null; localStorage.setItem('cc_wd_v1', JSON.stringify(s)); });
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500); await clear(page);
  await page.route('**/lb/coop/**', (r) => r.abort());
  await page.evaluate(() => { window.__cc.profile.mode = 'siege'; }); await go(page, 'play'); await page.waitForTimeout(2500);
  const off = await page.evaluate(() => (document.querySelector('#wd-note') || {}).textContent);
  ok(/Offline: this run won't count/.test(off || ''), 'offline note: "' + off + '"');
  await both(page, 'play-offline', () => page.evaluate(() => document.querySelector('#wd-note') && document.querySelector('#wd-note').scrollIntoView({ block: 'center' })));
  ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });

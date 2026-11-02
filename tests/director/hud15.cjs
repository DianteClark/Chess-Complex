// D 15.0: HUD feedback screenshots + checks (boss bar, status chips/locks, crown telegraph, King phases,
// Regicide tier 4, location intro, Ascension). Drives the real game with injected state/events, so it works
// before the engine emits these events itself.
//   NODE_PATH=$(npm root -g) node tests/director/hud15.cjs [--url http://localhost:8123/] [--land] [--out /tmp/cc-director/hud15]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('url', 'http://localhost:8123/');
const LAND = process.argv.includes('--land');
const OUT = arg('out', '/tmp/cc-director/hud15');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const vp = LAND ? { width: 844, height: 390 } : { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource|locations\.js|dynamically imported/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (r) => (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  for (let i = 0; ; i++) { if (await page.evaluate(() => !!(window.__cc && window.__cc.game && window.__cc.game.r)).catch(() => false)) break; if (i > 80) throw new Error('no game'); await page.waitForTimeout(250); }
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__cc.startSolo(7, 'royale'); });
  await page.waitForTimeout(800);
  // location intro: fake a location on the live state and replay the intro path
  // the real intro: contenders, F's wheel (lands ~5.8 s), then the location card
  let locAt = 0; for (let i = 0; i < 120; i++) { await page.waitForTimeout(150); if (await page.evaluate(() => { const d = window.__cc.game.r.dir; const ok = !!(d.cur && d.cur.tier === 'loc' && performance.now() - d.cur.start > 450); if (ok) { d.cur.end += 20000; d.heroEl.style.animationPlayState = 'paused'; } return ok; })) { locAt = i; break; } }
  await page.waitForTimeout(700);
  const dlog = [];
  // the box can be slow (frames stall for seconds): wait until the Director actually shows the callout
  const waitHero = async (text) => { for (let i = 0; i < 80; i++) { if (await page.evaluate((tx) => { const d = window.__cc.game.r.dir; const ok = !!(d.cur && d.cur.text === tx && performance.now() - d.cur.start > 380); if (ok) { d.cur.end += 20000; d.heroEl.style.animationPlayState = 'paused'; } return ok; }, text)) return true; await page.waitForTimeout(150); } return false; };
  const shot = async (n) => { const f = path.join(OUT, `${LAND ? 'land-' : ''}${n}.png`); await page.screenshot({ path: f }); await page.evaluate(() => { const d = window.__cc.game.r.dir; if (d.heroEl.style.animationPlayState) { d.heroEl.style.animationPlayState = ''; if (d.cur) d.cur.end = performance.now(); } }); dlog.push(n + ' ' + await page.evaluate(() => { const d = window.__cc.game.r.dir; return JSON.stringify({ cur: d.cur && (d.cur.text || d.cur.kind), q: d.q.map((m) => m.text), held: d.held(), hint: d.hintCur && d.hintCur.kind }); })); return f; };
  const shots = [];
  shots.push(await shot('01-location'));
  // hold the game still: stop the host from advancing turns while we inject
  await page.evaluate(() => { const H = window.__cc.session.host; if (H) { H.runAI = () => {}; H.act = () => {}; H.schedule = () => {}; clearTimeout(H.aiT); clearTimeout(H.timerT); } });
  // make a King (another player) with a status, statuses on me, then fire events
  const info = await page.evaluate(() => {
    const g = window.__cc.game, s = g.s, me = g.me;
    const k = s.units.find((u) => u.kind === 'player' && u.id !== me.id && u.alive);
    k.kingFrom = k.piece; k.kingStats = { hp: 600, atk: 20, def: 12, spd: 6 }; k.piece = 'king'; k.hp = 380; k.status = [{ k: 'burn', t: 2 }, { k: 'exposed', t: 1, n: 2 }];
    me.status = [{ k: 'freeze', t: 1, live: true }, { k: 'poison', t: 3, n: 2 }, { k: 'shield', t: 2, n: 30 }]; if (s.turn) s.turn.rooted = true;
    s.crownWarn = null;
    g.refresh();
    return { king: k.id, me: me.id, kname: k.name };
  });
  await page.waitForTimeout(700);
  shots.push(await shot('02-bossbar-status'));
  const geo = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { boss: r('#dir-boss'), hudTop: r('.hud-top'), chip: r('#event-chip'), status: r('#h-status'), card: r('#h-card'), laneTop: getComputedStyle(document.querySelector('#s-game')).getPropertyValue('--lane-top'), chips: document.querySelectorAll('#h-status .stc').length, locked: [...document.querySelectorAll('#h-actions .act.locked')].map((b) => b.dataset.slot + ':' + b.dataset.lock) };
  });
  // freeze callout + crown telegraph + target preview
  await page.evaluate(({ me, king }) => { const g = window.__cc.game; g.handleEvents([{ e: 'status', id: me, k: 'freeze', on: true, t: 1, src: king }], false); }, info);
  await waitHero('Frozen');
  shots.push(await shot('03-frozen-callout'));
  await page.evaluate(({ king }) => { const g = window.__cc.game, k = g.s.units.find((u) => u.id === king); g.inspect({ x: k.x, y: k.y }); }, info);
  await page.waitForTimeout(400);
  shots.push(await shot('04-target-preview'));
  await page.waitForTimeout(3200);
  await page.evaluate(() => { const g = window.__cc.game; g.s.crownWarn = { x: 12, y: 3, round: g.s.round }; g.handleEvents([{ e: 'crownWarn', x: 12, y: 3 }], false); g.refresh(); });
  await waitHero('The Crown Descends');
  shots.push(await shot('05-crown-telegraph'));
  await page.waitForTimeout(3600);
  await page.evaluate(({ king }) => { const g = window.__cc.game, k = g.s.units.find((u) => u.id === king); k.hp = 190; k.status = [{ k: 'enrage', t: 2 }]; g.handleEvents([{ e: 'kingPhase', id: king, phase: 1 }], false); g.refresh(); }, info);
  await waitHero('Royal Wrath');
  shots.push(await shot('06-king-phase'));
  await page.waitForTimeout(4000);
  // ability info with status glossary (hold Signature)
  await page.evaluate(() => { const g = window.__cc.game; g.showAbInfo('move'); });
  await page.waitForTimeout(300);
  shots.push(await shot('07-abinfo-lock'));
  await page.evaluate(() => { document.querySelector('#abinfo').classList.add('hidden'); });
  // Ascension (mine) then Regicide
  await page.evaluate(({ me }) => { const g = window.__cc.game; g.handleEvents([{ e: 'promote', id: me, type: 'hone', piece: 'bishop', hone: 3 }], false); }, info);
  await waitHero('Archbishop');
  shots.push(await shot('08-ascension'));
  await page.waitForTimeout(3000);
  await page.evaluate(({ me, king }) => { const g = window.__cc.game, k = g.s.units.find((u) => u.id === king); k.alive = false; k.hp = 0; g.handleEvents([{ e: 'death', id: king, by: me, regicide: true }], false); g.refresh(); }, info);
  await waitHero('Regicide'); await page.waitForTimeout(500);
  shots.push(await shot('09-regicide'));
  const st = await page.evaluate(() => ({ stats: window.__cc.game && (window.__cc.game.r.dir || {}).stats, bossOn: !!(window.__cc.game.r.dir || {}).bossOn }));
  await browser.close();
  console.log(JSON.stringify({ vp, geo, st, errors, shots, dlog, locAt }, null, 1));
})();

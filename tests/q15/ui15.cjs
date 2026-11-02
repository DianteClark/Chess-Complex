// Q 15.0: browser checks for the 15.0 UX spec. 390x844 phone, touch, ?net=local for the online cases.
// Usage: NODE_PATH=$(npm root -g) node tests/q15/ui15.cjs [--url http://localhost:8123/] [--only Z,N,W,M,U] [--out /tmp/q15/ui]
//   Z zoom      default camera shows ~8x8 tiles around my piece; the zoom button toggles to the whole board and back;
//               a two-finger pinch zooms (CDP touch); my piece stays in view
//   N tags      name tags sit just above the piece: measured from the actual draw calls, tag bottom vs the visible top
//               of the piece sprite (alpha-scanned), in tiles, for every player piece on screen
//   W wheel     the location wheel lands on s.location (cc:wheel-landed detail and the wheel's text), solo in several
//               modes and on an online client (?net=local), plus the location card names on the Play screen
//   M migrate   old saves (10.3 profile with mode 'mirror' and now-locked abilities, a 5.0 profile, a corrupt one) boot
//               without errors, keep Marks/owned items, get a valid mode and build, and every menu screen renders
//   U unlocks   locked abilities show their price in the loadout and buying one deducts it; the Crown Path shows the
//               Royal Pass at 3000 Marks and buying it deducts 3000 (net of retro rewards) and marks it owned
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const BASE = args.url || 'http://localhost:8123/';
const ONLY = args.only ? String(args.only).split(',') : null;
const OUT = args.out || '/tmp/q15/ui'; fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { pass: 0, fail: 0, pend: 0, rows: [] };
const rec = (st, g, n, i = '') => { R[st]++; R.rows.push({ st, g, n, i }); console.log(`${st === 'pass' ? 'PASS' : st === 'fail' ? 'FAIL' : 'PEND'} ${g} ${n}${i ? ' :: ' + String(i).slice(0, 400) : ''}`); };
const check = (g, n, ok, i) => rec(ok ? 'pass' : 'fail', g, n, i);
const pending = (g, n, i) => rec('pend', g, n, i);
const want = (g) => !ONLY || ONLY.includes(g);
const PROFILES = JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles.json'), 'utf8'));

const DISMISS = () => {
  setInterval(() => {
    const lg = document.querySelector('#m-login:not(.hidden) #lg-claim'); if (lg) lg.click();
    const sq = document.querySelector('.sequel:not(.out)'); if (sq && performance.now() > 2500) sq.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  }, 400);
  window.__wheel = []; addEventListener('cc:wheel-start', (e) => window.__wheel.push({ ev: 'start', id: e.detail && e.detail.id, t: performance.now() })); addEventListener('cc:wheel-landed', (e) => { const w = document.querySelector('#loc-wheel'); window.__wheel.push({ ev: 'landed', id: e.detail && e.detail.id, t: performance.now(), text: w ? w.innerText.replace(/\s+/g, ' ').slice(0, 200) : null, loc: window.__cc && window.__cc.game && window.__cc.game.s && window.__cc.game.s.location }); });
};
async function newCtx(browser, init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (init) await ctx.addInitScript(init.fn, init.arg);
  await ctx.addInitScript(DISMISS);
  return ctx;
}
async function page(ctx, q = '') {
  const p = await ctx.newPage(); p.__err = [];
  p.on('pageerror', (e) => { if (!/BroadcastChannel.*closed/.test(e.message)) p.__err.push(e.message.split('\n')[0] + ' @ ' + ((e.stack || '').split('\n')[1] || '').trim().replace(/https?:\/\/[^/]+\//, '')); });
  p.on('console', (m) => { if (m.type() === 'error' && !/unpkg|peerjs|ERR_FAILED|Failed to load resource|navigator\.vibrate/i.test(m.text())) p.__err.push('console: ' + m.text().slice(0, 200)); });
  await p.goto(BASE + q, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 90000 });
  await sleep(1500);
  return p;
}
async function solo(p, mode = 'royale', bots = 3) {
  await p.evaluate(([mode, bots]) => { const cc = window.__cc; cc.profile.mode = mode; cc.profile.name = 'Tagme'; cc.startSolo(bots, mode); }, [mode, bots]);
}
// wait until it is my turn and the camera has settled (intro + wheel done)
async function settleMyTurn(p, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await p.evaluate(() => { const g = window.__cc.game, r = g.r; return { cam: [r.cam.x, r.cam.tx, r.cam.y, r.cam.ty, r.cam.z, r.cam.tz].map((v) => +(+v).toFixed(2)), mine: !!(g.myTurn && g.myTurn()), settle: Math.abs(r.cam.z - r.cam.tz) < r.cam.tz * 0.01 && Math.abs(r.cam.x - r.cam.tx) < 0.05 && Math.abs(r.cam.y - r.cam.ty) < 0.05, intro: !!(r.intro && r.intro.t != null && r.intro.t < 1.8), wheel: !!document.querySelector('#loc-wheel:not(.out)') }; });
    if (st.mine && st.settle && !st.intro && !st.wheel) return true;
    settleMyTurn.last = st;
    if (!st.mine) await p.evaluate(() => { const s = window.__cc.session; if (s && s.host) s.host.fast = true; });
    await sleep(400);
  }
  return false;
}
const camInfo = (p) => p.evaluate(() => { const g = window.__cc.game, r = g.r, me = g.me; const tilesW = r.VW / r.cam.tz, tilesH = r.VH / r.cam.tz; const inView = me && Math.abs(me.x + 0.5 - r.cam.tx) <= tilesW / 2 && Math.abs(me.y + 0.5 - r.cam.ty) <= tilesH / 2; return { me: me && [me.x, me.y], cam: [+r.cam.tx.toFixed(2), +r.cam.ty.toFixed(2)], z: r.cam.z, tz: r.cam.tz, fit: r.fitZoom, def: r.defaultZoom(), VW: r.VW, VH: r.VH, tilesW: +tilesW.toFixed(2), tilesH: +tilesH.toFixed(2), tilesMin: +Math.min(tilesW, tilesH).toFixed(2), inView, setting: window.__cc.game && (JSON.parse(localStorage.getItem('cc_settings_v1') || '{}').cam) }; });

async function testZoom(browser) {
  const G = 'Z'; const ctx = await newCtx(browser); const p = await page(ctx);
  try {
    await solo(p, 'royale', 3);
    if (!(await settleMyTurn(p))) { check(G, 'reach my turn with a settled camera', false, JSON.stringify(settleMyTurn.last)); return; }
    let c = await camInfo(p);
    check(G, 'default camera shows ~8 tiles across (7.5-9)', c.tilesMin >= 7.5 && c.tilesMin <= 9, JSON.stringify(c));
    check(G, 'my piece is in the default view', c.inView, JSON.stringify(c));
    await p.screenshot({ path: path.join(OUT, 'zoom-default.png') });
    await p.evaluate(() => document.querySelector('#s-game [data-act="zoom"]').click()); await sleep(2200);
    c = await camInfo(p);
    check(G, 'zoom button -> whole board (16 tiles fit)', c.tilesW >= 16 && c.tilesH >= 16 && Math.abs(c.tz - c.fit) / c.fit < 0.08, JSON.stringify(c));
    await p.screenshot({ path: path.join(OUT, 'zoom-full.png') });
    await p.evaluate(() => document.querySelector('#s-game [data-act="zoom"]').click()); await sleep(2200);
    c = await camInfo(p);
    check(G, 'zoom button again -> back to ~8x8', c.tilesMin >= 7.5 && c.tilesMin <= 9, JSON.stringify(c));
    // pinch out (fingers apart) then in
    const cdp = await ctx.newCDPSession(p);
    const z0 = (await camInfo(p)).z;
    const pinch = async (d0, d1) => { const cx = 195, cy = 430; const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) }); for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * i / 8) }); await sleep(30); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600); };
    await pinch(200, 80); const z1 = (await camInfo(p)).z; await pinch(80, 240); const z2 = (await camInfo(p)).z;
    check(G, 'pinch in zooms out, pinch out zooms in', z1 < z0 * 0.9 && z2 > z1 * 1.2, `z ${z0.toFixed(1)} -> ${z1.toFixed(1)} -> ${z2.toFixed(1)}`);
    check(G, 'no page errors', p.__err.length === 0, p.__err.slice(0, 3).join(' | '));
  } catch (e) { check(G, 'harness', false, e.message.split('\n')[0]); } finally { await ctx.close(); }
}

// capture, for one frame: R's tag bars (drawBar, screen px) and name sprites (blitName), and the piece sprites
// (drawImage of sprite canvases), then alpha-scan each piece sprite for its visible top. Fallback: canvas fillText names.
const TAGS_PROBE = () => new Promise((res) => {
  const g = window.__cc.game, r = g.r; const cv = document.querySelector('#board'); const x = cv.getContext('2d'); const rect = cv.getBoundingClientRect(); const dpr = cv.width / rect.width;
  const units = new Map(g.s.units.filter((u) => u.alive && u.kind === 'player').map((u) => [u.id, u]));
  const bars = [], imgs = [];
  const map = (m, px, py) => [(m.a * px + m.c * py + m.e) / dpr, (m.b * px + m.d * py + m.f) / dpr];
  const db = r.drawBar, bn = r.blitName, di = x.drawImage;
  r.drawBar = function (L, bx, by, w, bh) { if (L && L.u && units.has(L.u.id)) { const m = x.getTransform(); const [, y1] = map(m, 0, by + bh); const [sx] = map(m, bx + w / 2, 0); bars.push({ id: L.u.id, sx, barBottom: y1, headY: L.headY != null ? map(m, 0, L.headY)[1] : null, baseY: L.baseY != null ? map(m, 0, L.baseY)[1] : null }); } return db.apply(this, arguments); };
  x.drawImage = function (img) { const a = arguments; let dx, dy, dw, dh, sx = 0, sy = 0, sw = img.width, sh = img.height; if (a.length >= 9) { [sx, sy, sw, sh, dx, dy, dw, dh] = [a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]]; } else if (a.length >= 5) { [dx, dy, dw, dh] = [a[1], a[2], a[3], a[4]]; } else { dx = a[1]; dy = a[2]; dw = img.width; dh = img.height; }
    const m = this.getTransform(); const [x0, y0] = map(m, dx, dy), [x1, y1] = map(m, dx + dw, dy + dh);
    if (img instanceof HTMLCanvasElement && img !== cv && Math.abs(x1 - x0) > 8 && Math.abs(x1 - x0) < 400) imgs.push({ img, sx, sy, sw, sh, x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
    return di.apply(this, arguments); };
  requestAnimationFrame(() => requestAnimationFrame(() => {
    r.drawBar = db; x.drawImage = di;
    const z = r.z || r.cam.z; const out = [];
    for (const b of bars) {
      if (out.some((o) => o.id === b.id)) continue;
      const u = units.get(b.id);
      // piece sprite: drawn below the bar's screen x, bottom near the base, sized like a piece (0.4-2.6 tiles wide)
      const cand = imgs.filter((q) => q.x0 < b.sx && q.x1 > b.sx && q.x1 - q.x0 > z * 0.4 && q.x1 - q.x0 < z * 2.6 && q.y1 > b.barBottom && (b.baseY == null || Math.abs(q.y1 - b.baseY) < z * 0.9));
      let vis = null;
      for (const q of cand.slice(0, 6)) {
        try { const c = q.img.getContext('2d', { willReadFrequently: true }); const W = Math.max(1, Math.round(q.sw)), H = Math.max(1, Math.round(q.sh)); const d = c.getImageData(Math.round(q.sx), Math.round(q.sy), W, H).data;
          let top = -1; for (let yy = 0; yy < H && top < 0; yy++) for (let xx = Math.floor(W * 0.3); xx < Math.ceil(W * 0.7); xx++) if (d[(yy * W + xx) * 4 + 3] > 90) { top = yy; break; }
          if (top >= 0) { const yTop = q.y0 + (q.y1 - q.y0) * (top / H); if (yTop > b.barBottom - z * 1.2 && (!vis || yTop < vis.yTop)) vis = { yTop }; } } catch {}
      }
      out.push({ id: b.id, name: u.name, piece: u.piece, z: +z.toFixed(1), barBottom: +b.barBottom.toFixed(1), headY: b.headY != null ? +b.headY.toFixed(1) : null, spriteTop: vis ? +vis.yTop.toFixed(1) : null,
        gapTiles: vis ? +((vis.yTop - b.barBottom) / z).toFixed(2) : b.headY != null ? +((b.headY - b.barBottom) / z).toFixed(2) : null, from: vis ? 'sprite' : 'headY', tagAboveBaseTiles: b.baseY != null ? +((b.baseY - b.barBottom) / z).toFixed(2) : null });
    }
    res({ out, nBars: bars.length, nImgs: imgs.length });
  }));
});
async function testTags(browser) {
  const G = 'N'; const ctx = await newCtx(browser); const p = await page(ctx);
  try {
    const seen = {};
    for (const [mode, bots] of [['royale', 7], ['squads', 3]]) {
      await solo(p, mode, bots);
      await p.waitForFunction(() => window.__cc.game.s && !document.querySelector('#loc-wheel:not(.out)') && !(window.__cc.game.r.intro && window.__cc.game.r.intro.t < 1.8), null, { timeout: 60000 }).catch(() => {});
      await p.evaluate(() => { const s = window.__cc.session; if (s && s.host) s.host.fast = true; clearInterval(window.__tp); window.__tp = setInterval(() => { try { const g = window.__cc.game; if (g.myTurn()) window.__cc.session.send({ type: 'end' }); } catch {} }, 300); });
      // sample several times so bots have evolved into taller pieces; centre the 8x8 camera on each player in turn
      for (let k = 0; k < 4; k++) {
        await sleep(k ? 9000 : 2000);
        const ids = await p.evaluate(() => (window.__cc.game.s ? window.__cc.game.s.units.filter((u) => u.alive && u.kind === 'player').map((u) => u.id) : []));
        for (const id of ids) {
          const okc = await p.evaluate((id) => { const g = window.__cc.game, r = g.r; const u = g.s && g.s.units.find((v) => v.id === id && v.alive); if (!u) return false; try { r.cd.manual(); } catch {} r.follow = false; const z = r.defaultZoom(); r.cam.z = r.cam.tz = z; r.cam.x = r.cam.tx = u.x + 0.5; r.cam.y = r.cam.ty = u.y + 0.5; r.cam.vx = r.cam.vy = r.cam.vz = 0; return true; }, id);
          if (!okc) continue; await sleep(350);
          const r = await p.evaluate(TAGS_PROBE).catch(() => ({ out: [] }));
          for (const o of r.out) { (seen[o.piece] = seen[o.piece] || []).push(o); }
        }
      }
      await p.evaluate(() => clearInterval(window.__tp));
      await p.screenshot({ path: path.join(OUT, `tags-${mode}.png`) });
      await p.evaluate(() => { const m = document.querySelector('#s-game [data-act="menu"]'); m && m.click(); }); await sleep(300);
      await p.evaluate(() => { const f = document.querySelector('#m-menu [data-act="forfeit"]'); f && f.click(); }); await sleep(1500);
      await p.evaluate(() => { const b = document.querySelector('#m-results [data-act="to-title"]'); b && b.click(); }); await sleep(1200);
    }
    const all = Object.values(seen).flat();
    if (!all.length) { check(G, 'measured some name tags', false, JSON.stringify(seen).slice(0, 300)); return; }
    const med = (a) => { const v = a.filter((x) => x != null && isFinite(x)).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const rows = [];
    for (const [pc, xs] of Object.entries(seen)) {
      // (1) does R's head estimate (PIECE_TOP) match the drawn sprite? alpha-scanned top vs headY, in tiles (+ = sprite top is lower than R thinks)
      const headErr = med(xs.filter((o) => o.spriteTop != null && o.headY != null && Math.abs(o.spriteTop - o.headY) < o.z * 1.6).map((o) => (o.spriteTop - o.headY) / o.z));
      // (2) where the tag bar ends relative to the visible top (+ = gap above the piece, - = overlapping the piece)
      const vis = med(xs.filter((o) => o.spriteTop != null && Math.abs(o.spriteTop - o.headY) < o.z * 1.6).map((o) => (o.spriteTop - o.barBottom) / o.z));
      const aboveHead = xs.filter((o) => o.headY != null && o.barBottom <= o.headY + 1).length;
      rows.push({ pc, n: xs.length, headErr: headErr != null ? +headErr.toFixed(2) : null, gapVis: vis != null ? +vis.toFixed(2) : null, aboveHead });
      if (headErr != null) check(G, `${pc}: R's head height (PIECE_TOP) matches the drawn sprite within 0.25 tiles (median error ${headErr.toFixed(2)})`, Math.abs(headErr) <= 0.25, `n=${xs.length}`);
      if (vis != null) check(G, `${pc}: tag bar ends -0.4..0.35 tiles from the visible piece top (median ${vis.toFixed(2)}; - = slid onto the head by design)`, vis >= -0.4 && vis <= 0.35, `n=${xs.length}, tags above the head ${aboveHead}/${xs.length}`);
    }
    console.log('TAGS ' + JSON.stringify(rows));
    check(G, 'no page errors', p.__err.length === 0, p.__err.slice(0, 3).join(' | '));
  } catch (e) { check(G, 'harness', false, e.message.split('\n')[0]); } finally { await ctx.close(); }
}

async function testWheel(browser) {
  const G = 'W'; const ctx = await newCtx(browser); const p = await page(ctx);
  try {
    const hasLoc = await p.evaluate(async () => { try { const L = await import('/js/locations.js'); return Object.fromEntries(Object.entries(L.LOCATIONS).map(([k, v]) => [k, v.name])); } catch { return null; } });
    if (!hasLoc) { pending(G, 'location wheel', 'js/locations.js not loaded'); return; }
    for (const mode of ['royale', 'siege', 'hill', 'daily', 'duel']) {
      await p.evaluate(() => { window.__wheel = []; });
      await solo(p, mode, mode === 'siege' ? 2 : mode === 'duel' ? 1 : 5);
      await p.waitForFunction(() => window.__wheel.some((w) => w.ev === 'landed'), null, { timeout: 20000 }).catch(() => {});
      const w = await p.evaluate(() => ({ w: window.__wheel, loc: window.__cc.game.s && window.__cc.game.s.location }));
      const land = w.w.find((x) => x.ev === 'landed'); const start = w.w.find((x) => x.ev === 'start');
      if (!start) { check(G, `${mode}: wheel spins at match intro`, false, JSON.stringify(w)); continue; }
      check(G, `${mode}: wheel lands on s.location (${w.loc})`, land && land.id === w.loc && start.id === w.loc, JSON.stringify(w.w));
      if (land && land.text != null) { const after = land.text.split(/LOCATION/i).pop(); check(G, `${mode}: wheel's result card names the landed location`, after.includes(hasLoc[w.loc]) && Object.entries(hasLoc).every(([k, n]) => k === w.loc || !after.includes(n)), after.slice(0, 80)); }
      const wm = await p.evaluate(async () => { try { return (await import('/js/front15.js')).wheelMs(); } catch { return 3100; } });
      if (land) check(G, `${mode}: wheel lands about on time (spin ${wm} ms, +2.5 s slack on a loaded box)`, land.t - start.t < wm + 2500, Math.round(land.t - start.t) + 'ms');
      await sleep(1200);
      if (mode === 'royale') await p.screenshot({ path: path.join(OUT, 'wheel-royale.png') });
      await p.evaluate(() => { const m = document.querySelector('#s-game [data-act="menu"]'); m && m.click(); }); await sleep(300);
      await p.evaluate(() => { const f = document.querySelector('#m-menu [data-act="forfeit"]'); f && f.click(); }); await sleep(1500);
      await p.evaluate(() => { const b = document.querySelector('#m-results [data-act="to-title"]'); b && b.click(); }); await sleep(1200);
    }
    check(G, 'no page errors (solo)', p.__err.length === 0, p.__err.slice(0, 3).join(' | '));
    // online: the client's wheel lands on the host's location
    const ctx2 = await newCtx(browser); const h = await page(ctx2, '?net=local'); const c = await page(ctx2, '?net=local');
    try {
      await h.evaluate(() => { window.__cc.profile.mode = 'royale'; document.querySelector('#s-title [data-go="play"]').click(); }); await sleep(900);
      await h.evaluate(() => document.querySelector('#btn-host').click()); await sleep(1500);
      await h.waitForFunction(() => /Room open/.test(document.querySelector('#host-status').textContent), null, { timeout: 8000 }).catch(() => {});
      const code = await h.evaluate(() => document.querySelector('#host-code').textContent.trim());
      await c.evaluate(() => document.querySelector('#s-title [data-go="join"]').click()); await sleep(900);
      await c.fill('#in-code', code);
      await c.evaluate(() => document.querySelector('#s-join [data-act="join"]').click());
      await c.waitForFunction(() => /In the lobby/.test(document.querySelector('#join-status').textContent), null, { timeout: 8000 }).catch(() => {});
      await c.evaluate(() => { const r = document.querySelector('#btn-ready'); if (r && !r.classList.contains('hidden') && !r.disabled) r.click(); }); await sleep(900);
      await h.evaluate(() => { const b = document.querySelector('[data-act="add-bot"]'); b && b.click(); }); await sleep(300);
      await h.evaluate(() => document.querySelector('#btn-start-host').click());
      await c.waitForFunction(() => window.__wheel.some((w) => w.ev === 'landed'), null, { timeout: 25000 }).catch(() => {});
      const hw = await h.evaluate(() => ({ w: window.__wheel, loc: window.__cc.game.s && window.__cc.game.s.location }));
      const cw = await c.evaluate(() => ({ w: window.__wheel, loc: window.__cc.game.s && window.__cc.game.s.location }));
      const cl = cw.w.find((x) => x.ev === 'landed');
      check(G, 'online client: wheel lands on the host\'s s.location', !!cl && cl.id === hw.loc && cw.loc === hw.loc, `host ${hw.loc} client ${JSON.stringify(cw)}`);
      check(G, 'online: no page errors', h.__err.length + c.__err.length === 0, [...h.__err, ...c.__err].slice(0, 3).join(' | '));
    } finally { await ctx2.close(); }
  } catch (e) { check(G, 'harness', false, e.message.split('\n')[0]); } finally { await ctx.close(); }
}

async function testMigrate(browser) {
  const G = 'M';
  for (const [k, prof] of Object.entries(PROFILES)) {
    const ctx = await newCtx(browser, { fn: (pr) => { if (!sessionStorage.getItem('q15seeded')) { localStorage.setItem('cc_profile_v1', JSON.stringify(pr)); sessionStorage.setItem('q15seeded', '1'); } }, arg: prof });
    const p = await page(ctx);
    try {
      const st = await p.evaluate(async () => { const cc = window.__cc, P = cc.profile, D = await import('/js/data.js'); let PR = {}; try { PR = await import('/js/progression.js'); } catch {} return { mode: P.mode, modeOk: !!D.MODES[P.mode], passive: P.build.passive, passiveOk: !!D.PASSIVES[P.build.passive], passiveLocked: !!(D.PASSIVES[P.build.passive] && D.PASSIVES[P.build.passive].unlock), unlocked: P.unlocked, usable: typeof PR.isUnlocked === 'function' ? PR.isUnlocked(P, 'passive', P.build.passive) && Object.entries(P.build.equips).every(([pc, id]) => PR.isUnlocked(P, 'ability', id)) : null, equips: P.build.equips, marks: P.marks, owned: P.owned, name: P.name, level: P.level, slots: P.slots || P.buildSlots || null }; });
      if (k !== 'broken') {
        check(G, `${k}: Marks kept (${prof.marks})`, st.marks === prof.marks, st.marks);
        check(G, `${k}: owned skins kept`, prof.owned.every((x) => st.owned.includes(x)), st.owned.join(','));
        check(G, `${k}: level kept`, st.level === prof.level, st.level);
      }
      check(G, `${k}: mode is a real mode (was ${JSON.stringify(prof.mode)})`, st.modeOk, st.mode);
      check(G, `${k}: build passive valid`, st.passiveOk, st.passive);
      if (st.unlocked !== undefined) check(G, `${k}: profile.unlocked is an array`, Array.isArray(st.unlocked), JSON.stringify(st.unlocked));
      if (st.usable !== null) check(G, `${k}: equipped build only uses owned/free abilities (grandfathered or reset)`, st.usable, `passive ${st.passive} equips ${JSON.stringify(st.equips)} unlocked ${JSON.stringify(st.unlocked)}`);
      for (const sc of ['play', 'loadout', 'armory', 'path', 'profile', 'trophies', 'codex']) {
        await p.evaluate((sc) => { const b = document.querySelector(`#s-title [data-go="${sc}"]`); b && b.click(); }, sc); await sleep(900);
        const ok = await p.evaluate((sc) => { const a = document.querySelector('.screen.active'); return a && a.id === 's-' + sc && a.innerText.trim().length > 20; }, sc);
        check(G, `${k}: ${sc} screen renders`, ok);
        await p.evaluate(() => { for (const m of document.querySelectorAll('.modal:not(.hidden)')) m.classList.add('hidden'); const b = document.querySelector('.screen.active .back'); b && b.click(); }); await sleep(600);
      }
      await solo(p, (await p.evaluate(() => window.__cc.profile.mode)) || 'royale', 3); await sleep(5000);
      check(G, `${k}: a match starts from the migrated profile`, await p.evaluate(() => !!(window.__cc.game.s && window.__cc.game.s.units.length)));
      check(G, `${k}: no page errors`, p.__err.length === 0, p.__err.slice(0, 3).join(' | '));
      const raw = await p.evaluate(() => JSON.parse(localStorage.getItem('cc_profile_v1') || '{}'));
      check(G, `${k}: saved profile round-trips (reload keeps mode/build)`, raw.mode === st.mode || raw.mode == null, `${raw.mode} vs ${st.mode}`);
    } catch (e) { check(G, `${k}: harness`, false, e.message.split('\n')[0]); } finally { await ctx.close(); }
  }
}

async function testUnlocks(browser) {
  const G = 'U'; const ctx = await newCtx(browser, { fn: () => { if (!sessionStorage.getItem('q15m')) { const p = JSON.parse(localStorage.getItem('cc_profile_v1') || 'null'); sessionStorage.setItem('q15m', '1'); } }, arg: null });
  const p = await page(ctx);
  try {
    await p.evaluate(() => { window.__cc.profile.marks = 9000; });
    await p.evaluate(() => document.querySelector('#s-title [data-go="loadout"]').click()); await sleep(1200);
    const lo = await p.evaluate(async () => { const PR = await import('/js/progression.js'); const sc = document.querySelector('#s-loadout'); const t = sc.innerText; const locks = [...sc.querySelectorAll('[data-unlock], .locked, [data-price]')].filter((e) => e.offsetParent); return { n: locks.length, sample: locks.slice(0, 4).map((e) => (e.dataset.unlock || e.dataset.price || '') + ' ' + e.innerText.replace(/\s+/g, ' ').slice(0, 60)), hasPrice: /\b(400|[5-9]\d\d|1[0-4]\d\d|1500)\b/.test(t), fn: typeof PR.buyUnlock }; });
    if (!lo.n) pending(G, 'locked abilities in the loadout', 'no [data-unlock]/.locked/[data-price] elements visible: ' + JSON.stringify(lo));
    else {
      check(G, 'loadout shows locked abilities with a price', lo.hasPrice, JSON.stringify(lo));
      const before = await p.evaluate(() => window.__cc.profile.marks);
      const tgt = await p.evaluate(() => { const e = [...document.querySelectorAll('#s-loadout [data-unlock]')].find((x) => x.offsetParent); if (!e) return null; e.click(); return e.dataset.unlock; }); await sleep(800);
      // either the Store's unlock sheet (#m-royal [data-ul=buy]) or front15's two-tap arm/confirm on the same button
      const how = await p.evaluate((u) => { const b = document.querySelector('#m-royal:not(.hidden) [data-ul="buy"]'); if (b) { b.click(); return 'sheet'; } const e = document.querySelector(`#s-loadout [data-unlock="${u}"]`); if (e) { e.click(); return 'confirm-tap'; } return 'none'; }, tgt); await sleep(900);
      const after = await p.evaluate(() => ({ marks: window.__cc.profile.marks, unlocked: window.__cc.profile.unlocked }));
      check(G, `tapping a locked ability (${tgt}) and confirming (${how}) buys it`, after.marks < before && Array.isArray(after.unlocked) && after.unlocked.includes(tgt), `${before} -> ${JSON.stringify(after)}`);
      const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('cc_profile_v1')).unlocked); check(G, 'unlock is saved', Array.isArray(saved) && saved.length === (after.unlocked || []).length, JSON.stringify(saved));
    }
    await p.evaluate(() => { for (const m of document.querySelectorAll('.modal:not(.hidden)')) m.classList.add('hidden'); document.querySelector('.screen.active .back').click(); }); await sleep(700);
    await p.evaluate(() => { window.__cc.profile.marks = 3200; document.querySelector('#s-title [data-go="path"]').click(); }); await sleep(1500);
    const rp = await p.evaluate(() => { const sc = document.querySelector('#s-path'); const t = sc.innerText; const btn = [...sc.querySelectorAll('button, [role=button]')].find((b) => /royal pass/i.test(b.innerText) || /3,?000/.test(b.innerText)); return { text: /royal pass/i.test(t), price: /3,?000/.test(t), btn: btn ? btn.innerText.replace(/\s+/g, ' ').slice(0, 60) : null }; });
    if (!rp.text) pending(G, 'Royal Pass on the Crown Path', 'no "Royal Pass" text on #s-path');
    else {
      check(G, 'Crown Path shows the Royal Pass at 3000 Marks', rp.price, JSON.stringify(rp));
      if (rp.btn) {
        await p.evaluate(() => { const b = [...document.querySelectorAll('#s-path button, #s-path [role=button]')].find((b) => /royal pass/i.test(b.innerText) || /3,?000/.test(b.innerText)); b.click(); }); await sleep(800);
        for (let i = 0; i < 2; i++) { await p.evaluate(() => { const b = document.querySelector('#m-royal:not(.hidden) [data-rp="buy"]'); b && b.click(); }); await sleep(700); } // buy, then "tap again to confirm"
        await sleep(800);
        const st = await p.evaluate(async () => { const PR = await import('/js/progression.js'); const P = window.__cc.profile; return { marks: P.marks, owned: typeof PR.hasRoyal === 'function' ? PR.hasRoyal(P) : null }; });
        check(G, 'buying the Royal Pass marks it owned and costs 3000 (retro rewards may refund some)', st.owned === true && st.marks <= 3200 - 3000 + 1000, JSON.stringify(st));
      }
    }
    check(G, 'no page errors', p.__err.length === 0, p.__err.slice(0, 3).join(' | '));
  } catch (e) { check(G, 'harness', false, e.message.split('\n')[0]); } finally { await ctx.close(); }
}

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();
  for (const [g, fn] of [['Z', testZoom], ['N', testTags], ['W', testWheel], ['M', testMigrate], ['U', testUnlocks]]) if (want(g)) { try { await fn(browser); } catch (e) { check(g, 'suite', false, e.message.split('\n')[0]); } }
  await browser.close();
  console.log(`ui15: ${R.pass} pass, ${R.fail} fail, ${R.pend} pending in ${((Date.now() - t0) / 1000).toFixed(0)}s (shots in ${OUT})`);
  fs.writeFileSync(path.join(OUT, 'ui15.json'), JSON.stringify(R, null, 1));
  process.exitCode = R.fail ? 1 : 0;
})();

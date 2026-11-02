// Storm movement (QA, 10.2), in the browser with real touch taps, solo and ?net=local online (client taps).
// Usage: NODE_PATH=$(npm root -g) node tests/storm/storm-browser.cjs [--url http://localhost:8123/] [--modes solo,online]
//        [--zoom default,out] [--piece pawn]
// The tester's unit is put in the void (storm ring 3, tile (8,2)) while it is not their turn; then:
//   B1 their turn starts in the void: storm burn event for them, HUD shows Move available, overlay lists moves out
//   B2 a touch tap on a safe tile moves them out (state confirms)
//   B3 next turn: a touch tap on a void tile moves them back in
//   B4 next turn: burn again and the move overlay is still offered
// Screenshots: <tmp>/cc-storm/
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const BASE = args.url || 'http://localhost:8123/';
const MODES = String(args.modes || 'solo,online').split(',');
const ZOOMS = String(args.zoom || 'default,out').split(',');
const PIECE = args.piece || 'pawn';
const SHOTS = path.join(require('os').tmpdir(), 'cc-storm'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const mk = async (lab) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { if (!/BroadcastChannel.*closed/.test(e.message)) errors.push(`[${lab}] ${e.message}`); });
    p.on('console', (m) => { if (m.type() === 'error' && !/unpkg|peerjs|ERR_FAILED|Failed to load resource/i.test(m.text())) errors.push(`[${lab}] console: ${m.text()}`); });
    await p.goto(BASE + '?net=local', { waitUntil: 'load' });
    await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 15000 }); await sleep(900);
    return p;
  };
  return { ctx, mk };
}
async function hookEvents(p) {
  await p.evaluate(async () => { window.__TAPmod = await import('/js/input.js').catch(() => null); }); await p.evaluate(() => { const g = window.__cc.game; window.__taps = []; if (g.tapAt && !g.__tw) { const f = g.tapAt.bind(g); g.tapAt = (px, py, G) => { const before = { turn: g.myTurn(), mode: g.mode, pend: g.tapPending }; try { const [wx, wy] = g.r.toWorld(px, py, G.view); before.w = [+wx.toFixed(2), +wy.toFixed(2)]; const T = window.__TAPmod; if (T) { const pk = T.pick(g, wx, wy, G.view.z, null); before.pick = pk && { how: pk.how, tile: pk.tile, cand: !!pk.cand }; const uu = T.unitAt(g.r, g.s, wx, wy); if (uu) { const d = g.r.disp.get(uu.id); before.unit = { id: uu.id, me: uu.id === g.r.myId, at: [uu.x, uu.y], disp: d && [+d.x.toFixed(2), +d.y.toFixed(2)], lift: d && d.lift }; } } } catch (e) { before.err = e.message; } const r = f(px, py, G); window.__taps.push({ px: Math.round(px), py: Math.round(py), z: G && G.view && +G.view.z.toFixed(1), force: G && G.force, drag: G && G.drag, ...before, after: g.tapPending, insp: !document.querySelector('#h-inspect').classList.contains('hidden') }); return r; }; g.__tw = true; } window.__ev = []; if (!g.__wrapped) { const f = g.onMsg.bind(g); g.onMsg = (m) => { if (m && m.t === 'state') window.__ev.push(...(m.ev || [])); return f(m); }; g.__wrapped = true; } });
}
// host-side: place tester in the void and keep everyone else away/alive
async function placeInVoid(host, pid, piece) {
  return host.evaluate(async ([pid, piece]) => {
    const E = await import('/js/engine.js'); const D = await import('/js/data.js');
    const h = window.__cc.session.host, s = h.s; h.noTimer = true; clearTimeout(h.timerT);
    s.storm.ring = 3; s.storm.crack = false;
    const u = s.units.find((v) => v.pid === pid);
    for (let y = 0; y <= 5; y++) for (let x = 5; x <= 11; x++) { const t = s.tiles[y * D.SIZE + x]; if (t && t.t !== 'floor' && t.t !== 'out') s.tiles[y * D.SIZE + x] = { t: 'floor' }; const o = E.unitAt(s, x, y); if (o && o !== u) { o.x = 15 - (o.id % 4); o.y = 12 + (o.id % 3); } }
    s.items = s.items.filter((i) => !(i.y <= 5 && i.x >= 5 && i.x <= 11));
    if (piece === 'king' && !u.kingStats) u.kingStats = E.baseStats({ ...u, piece: 'queen' });
    u.piece = piece; u.x = 8; u.y = 2; u.hp = E.stats(u).maxHp; u.buffs = [];
    for (const v of s.units) if (v.alive && v.kind === 'player') v.hp = E.stats(v).maxHp;
    s.v++; h.publish([]);
    const wasActive = s.active === u.id;
    if (wasActive) h.act(pid, { type: 'end' }); // atomically hand the turn on so the next one STARTS in the void
    return { void: E.isVoid(s, 8, 2), active: s.active === u.id, wasActive };
  }, [pid, piece]);
}
// touch tap at the on-screen centre of tile (x,y); returns false if the point is covered by DOM
async function tapTile(p, cdp, t) {
  const pt = await p.evaluate((t) => {
    const r = window.__cc.game.r, c = document.querySelector('#board'), rect = c.getBoundingClientRect();
    const z = r.cam.z * (1 + (r.punch || 0));
    const cx = rect.left + (t.x + 0.5 - r.cam.x) * z + (r.CX ?? r.W / 2), cy = rect.top + (t.y + 0.5 - r.cam.y) * z + r.CY;
    const el = document.elementFromPoint(cx, cy);
    return { cx, cy, ok: el === c, top: el ? el.id || el.className : null };
  }, t);
  if (!pt.ok) return pt;
  const tp = { x: pt.cx, y: pt.cy, radiusX: 6, radiusY: 6, force: 1, id: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp] }); await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // 10.2 confirm step: small tiles preview first; confirm when the preview is the tile we meant
  await sleep(200);
  const pend = await p.evaluate(() => window.__cc.game.tapPending || null);
  pt.taps = 1;
  if (pend && pend.x === t.x && pend.y === t.y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp] }); await sleep(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); pt.taps = 2;
  } else if (pend) pt.wrongPreview = pend;
  await sleep(150); pt.diag = await p.evaluate(() => (window.__taps || []).slice(-2));
  return pt;
}
const myState = (p) => p.evaluate(async () => {
  const E = await import('/js/engine.js'); const g = window.__cc.game, u = g.me, s = g.s; if (!u) return null;
  const ov = g.r.overlay && g.r.overlay.moves ? g.r.overlay.moves : null;
  const mb = document.querySelector('#h-actions [data-slot="move"]');
  return { x: u.x, y: u.y, hp: u.hp, max: E.stats(u).maxHp, id: u.id, myTurn: g.myTurn(), inVoid: E.isVoid(s, u.x, u.y), mode: g.mode,
    canMove: E.canMove(s, u), legal: E.legalMoves(s, u).map((m) => ({ x: m.x, y: m.y, v: E.isVoid(s, m.x, m.y) })),
    overlay: ov ? ov.map((m) => ({ x: m.x, y: m.y, v: E.isVoid(s, m.x, m.y) })) : null,
    moveBtn: mb ? { dis: mb.disabled || mb.classList.contains('used') || mb.classList.contains('off'), cls: mb.className } : null };
});
async function waitMyTurn(p, ms = 20000) { await p.waitForFunction(() => window.__cc.game.myTurn(), null, { timeout: ms }); await sleep(700); }
async function waitNotMyTurn(p, ms = 20000) { await p.waitForFunction(() => !window.__cc.game.myTurn(), null, { timeout: ms }); }

async function runOne(browser, mode, zoom) {
  const errors = [], fails = [], notes = [];
  const check = (c, m) => { if (!c) fails.push(m); return c; };
  const { ctx, mk } = await boot(browser, errors);
  let host, p;
  try {
    if (mode === 'solo') {
      p = host = await mk('solo');
      await p.evaluate(() => window.__cc.startSolo(1, 'royale'));
      await p.waitForFunction(() => window.__cc.game.s, null, { timeout: 10000 });
      await p.evaluate(() => { window.__cc.session.host.fast = true; });
      await sleep(3500);
    } else {
      host = await mk('host');
      await host.evaluate(() => { window.__cc.profile.mode = 'royale'; document.querySelector('#s-title [data-go="play"]').click(); }); await sleep(800);
      await host.evaluate(() => document.querySelector('#btn-host').click());
      await host.waitForFunction(() => /Room open/.test(document.querySelector('#host-status').textContent), null, { timeout: 6000 });
      const code = await host.textContent('#host-code');
      p = await mk('client');
      await p.evaluate(() => document.querySelector('#s-title [data-go="join"]').click()); await sleep(800);
      await p.fill('#in-code', code); await p.evaluate(() => document.querySelector('#s-join [data-act="join"]').click());
      await p.waitForFunction(() => /In the lobby/.test(document.querySelector('#join-status').textContent), null, { timeout: 6000 });
      await host.evaluate(() => document.querySelector('#btn-start-host').click());
      for (const q of [host, p]) await q.waitForFunction(() => window.__cc.game.s && document.querySelector('.screen.active').id === 's-game', null, { timeout: 10000 });
      await host.evaluate(() => { const h = window.__cc.session.host; h.fast = true; h.noTimer = true; clearInterval(window.__ap); window.__ap = setInterval(() => { const g = window.__cc.game, s = window.__cc.session; try { if (s && s.send && g.myTurn()) s.send({ type: 'end' }); } catch {} }, 300); });
      await sleep(3500);
    }
    const pid = await p.evaluate(() => window.__cc.session.myPid);
    await hookEvents(p);
    const cdp = await ctx.newCDPSession(p);
    // make sure it is NOT the tester's turn when we drop them in the void
    await waitMyTurn(p, 30000);
    await p.evaluate(() => { window.__ev = []; });
    const pl = await placeInVoid(host, pid, PIECE);
    check(pl.void && !pl.active, `setup: void=${pl.void} active=${pl.active}`);
    if (zoom === 'out') await p.evaluate(() => { const r = window.__cc.game.r; r.zoomBy(0.01); r.follow = false; });
    // B1
    await waitMyTurn(p);
    if (zoom === 'out') await p.evaluate(() => { const r = window.__cc.game.r; r.cam.z = r.cam.tz = r.minZ; }); await sleep(400);
    let st = await myState(p);
    const burn1 = await p.evaluate((id) => window.__ev.some((e) => e.e === 'dmg' && e.id === id && e.storm), st.id);
    check(st.inVoid, `B1 tester not in void at turn start (${st.x},${st.y})`);
    check(burn1 && st.hp < st.max, `B1 no storm burn at turn start in void (hp ${st.hp}/${st.max})`);
    check(st.canMove, 'B1 engine canMove false on the client');
    check(st.mode === 'move', `B1 HUD mode is '${st.mode}', not 'move'`);
    check(st.overlay && st.overlay.some((m) => !m.v), `B1 move overlay has no safe tile (overlay=${JSON.stringify(st.overlay)})`);
    check(!st.moveBtn || !st.moveBtn.dis, `B1 Move button disabled/used (${st.moveBtn && st.moveBtn.cls})`);
    await p.screenshot({ path: path.join(SHOTS, `${mode}-${zoom}-B1.png`) });
    // B2 tap out
    const outs = st.legal.filter((m) => !m.v);
    let moved = false, tapInfo = [];
    for (const t of outs) {
      const r = await tapTile(p, cdp, t); tapInfo.push(`${t.x},${t.y}:${r.ok ? 'tap' + r.taps + ' ' + JSON.stringify(r.diag) + (r.wrongPreview ? ' wrongPreview ' + JSON.stringify(r.wrongPreview) : '') : 'covered by ' + r.top}`); if (!r.ok) continue;
      await sleep(600); const s2 = await myState(p);
      if (s2.x === t.x && s2.y === t.y) { moved = true; break; }
      if (s2.x !== st.x || s2.y !== st.y) { fails.push(`B2 tapped (${t.x},${t.y}) but moved to (${s2.x},${s2.y})`); moved = true; break; }
      break;
    }
    check(moved, `B2 touch tap on a safe tile did not move the tester out of the void [${tapInfo.join(' ')}]`);
    st = await myState(p);
    check(!st.inVoid, `B2 tester still in void after tapping out (${st.x},${st.y})`);
    if (!st.inVoid) {
      // force out if needed so B3 can still be tested
    } else {
      await host.evaluate(async ([pid]) => { const h = window.__cc.session.host, s = h.s; const u = s.units.find((v) => v.pid === pid); u.y = 3; s.v++; h.publish([]); }, [pid]);
      notes.push('B2 failed; host moved tester to (x,3) to continue');
    }
    if (await p.evaluate(() => window.__cc.game.myTurn())) await p.evaluate(() => window.__cc.session.send({ type: 'end' }));
    // B3 tap back in
    await waitNotMyTurn(p).catch(() => {});
    await waitMyTurn(p);
    if (zoom === 'out') await p.evaluate(() => { const r = window.__cc.game.r; r.cam.z = r.cam.tz = r.minZ; }); await sleep(400);
    st = await myState(p);
    const ins = st.legal.filter((m) => m.v);
    check(ins.length > 0, `B3 no legal move back into the void from (${st.x},${st.y})`);
    check(st.overlay && st.overlay.some((m) => m.v), `B3 move overlay offers no void tile`);
    moved = false; tapInfo = [];
    for (const t of ins) {
      const r = await tapTile(p, cdp, t); tapInfo.push(`${t.x},${t.y}:${r.ok ? 'tap' + r.taps + ' ' + JSON.stringify(r.diag) + (r.wrongPreview ? ' wrongPreview ' + JSON.stringify(r.wrongPreview) : '') : 'covered by ' + r.top}`); if (!r.ok) continue;
      await sleep(600); const s3 = await myState(p);
      if (s3.x === t.x && s3.y === t.y) moved = true; else if (s3.x !== st.x || s3.y !== st.y) fails.push(`B3 tapped (${t.x},${t.y}) but moved to (${s3.x},${s3.y})`);
      break;
    }
    check(moved, `B3 touch tap on a void tile did not move the tester back in [${tapInfo.join(' ')}]`);
    // B4 (clear the event log and end the turn in one step: in fast solo the next turn can start within milliseconds)
    await p.evaluate(() => { window.__ev = []; if (window.__cc.game.myTurn()) window.__cc.session.send({ type: 'end' }); });
    await waitNotMyTurn(p).catch(() => {});
    await waitMyTurn(p);
    st = await myState(p);
    if (moved) {
      const burn2 = await p.evaluate((id) => window.__ev.some((e) => e.e === 'dmg' && e.id === id && e.storm), st.id);
      check(burn2, 'B4 no storm burn on the second void turn');
      check(st.canMove && st.overlay && st.overlay.length > 0, 'B4 no move overlay on the second void turn');
    }
    await p.screenshot({ path: path.join(SHOTS, `${mode}-${zoom}-B4.png`) });
  } catch (e) { fails.push('harness: ' + String(e.message || e).split('\n')[0]); }
  finally { await ctx.close().catch(() => {}); }
  return { mode, zoom, fails, errors: [...new Set(errors)], notes };
}

(async () => {
  const browser = await chromium.launch();
  let bad = 0;
  for (const mode of MODES) for (const zoom of ZOOMS) {
    const r = await runOne(browser, mode, zoom);
    const ok = !r.fails.length && !r.errors.length; if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'} storm ${mode}/${zoom}/${PIECE}`);
    for (const f of r.fails) console.log('   fail: ' + f);
    for (const e of r.errors.slice(0, 5)) console.log('   error: ' + e);
    for (const n of r.notes) console.log('   note: ' + n);
  }
  await browser.close();
  console.log(`storm-browser: ${MODES.length * ZOOMS.length - bad}/${MODES.length * ZOOMS.length} pass; shots ${SHOTS}`);
  process.exit(bad ? 1 : 0);
})();

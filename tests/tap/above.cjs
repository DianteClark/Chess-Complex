// IX 17.1: "hard to select the tile right above my piece". Sprites stand taller than their tile (Queen/Knight heads poke
// ~0.15-0.35 of a tile into the tile above; the boss King ~0.7), and the body hit-test used to win over the tile under
// the finger, so a tap in the lower part of the tile above selected (inspected) my own piece instead of moving there.
//
// For each viewport x zoom level (8x8 'close' and 'board') x piece (pawn, bishop via its 17.0 Sidestep, queen, boss King), my piece stands
// in the middle of the board with the tile above it empty and legal. Real touches (CDP touchStart/End, finger radius
// 6 px) at points inside that tile's on-screen square: centre, upper, lower, lower corners, 2 px above the shared edge.
// A preview (loupe / "Tap again to move") is confirmed with a second tap at the same point (10.2 behaviour kept).
// Expected: every one moves to the tile above. Control taps on my own tile (centre, 25% from its top edge) must not
// move anywhere (own piece wins taps clearly on its own tile). session.send is intercepted so the board stays put.
//
//   NODE_PATH=$(npm root -g) node tests/tap/above.cjs [--url http://localhost:8123/] [--vp 390x844@3,844x390@3]
//        [--zoom close,board] [--pieces pawn,bishop,queen,king]
// Exit code 1 on any failure.
const { chromium } = require('playwright');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const BASE = args.url || 'http://localhost:8123/';
const VPS = String(args.vp || '390x844@3,844x390@3').split(',').map((s) => { const m = /(\d+)x(\d+)@?([\d.]*)/.exec(s); return { w: +m[1], h: +m[2], dpr: +(m[3] || 2), id: s }; });
const ZOOMS = String(args.zoom || 'close,board').split(',');
const PIECES = String(args.pieces || 'pawn,bishop,queen,king').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// points in tile fractions (fx, fy) of the tile ABOVE my piece; fy 1.0 = the shared edge with my tile
const ABOVE = [['centre', 0.5, 0.5], ['upper', 0.5, 0.2], ['lower', 0.5, 0.8], ['lower-l', 0.25, 0.85], ['lower-r', 0.75, 0.85], ['edge-2px', 0.5, null]];
const OWN = [['own-centre', 0.5, 0.5], ['own-top', 0.5, 0.25]];

async function setup(p, piece, zoom) {
  return p.evaluate(async ([piece, zoom]) => {
    const E = await import('/js/engine.js');
    const g = window.__cc.game, h = window.__cc.session.host, s = h.s, r = g.r;
    h.noTimer = true; h.deadline = 0; clearTimeout(h.timerT);
    const u = s.units.find((v) => v.pid === window.__cc.session.myPid);
    if (piece === 'king' && !u.kingStats) { const b = E.baseStats(u); u.kingStats = { hp: Math.round(b.hp * 1.5), atk: b.atk + 4, def: b.def + 3, spd: b.spd }; }
    u.piece = piece; u.hp = E.stats(u).maxHp;
    s.kingBoss = piece === 'king' ? { id: u.id, name: u.name, hp: u.hp, hpMax: u.hp, phase: 0, aura: 2 } : null;
    // a centre spot whose tile above is free + legal and nobody stands two above (their body would cover it)
    const free = (x, y) => !s.units.some((v) => v.alive && v !== u && v.x === x && v.y === y);
    let spot = null;
    for (let y = 6; y < 11 && !spot; y++) for (let x = 6; x < 10 && !spot; x++) {
      if (!free(x, y) || !free(x, y - 1) || !free(x, y - 2) || !free(x, y + 1)) continue;
      const o = [u.x, u.y]; u.x = x; u.y = y;
      if (E.legalMoves(s, u).some((m) => m.x === x && m.y === y - 1)) spot = { x, y }; else { u.x = o[0]; u.y = o[1]; }
    }
    if (!spot) return { skip: 'no spot' };
    s.v++; h.publish([]);
    await new Promise((res) => setTimeout(res, 400));
    g.mode = 'move'; g.preview = null; g.clearPending && g.clearPending(true);
    r.setCamMode('free'); r.setZoomLevel(zoom, false); r.zoomSet = true;
    const z = r.defaultZoom(); r.cam.z = r.cam.tz = z; r.cam.x = r.cam.tx = spot.x + 0.5; r.cam.y = r.cam.ty = spot.y + 0.5; r.cam.vx = r.cam.vy = r.cam.vz = 0; r.cd.g = null;
    for (const d of r.disp.values()) { d.x = d.sx = d.tx; d.y = d.sy = d.ty; }
    g.refresh && g.refresh();
    return { spot, z, scale: r.scaleOf(u) };
  }, [piece, zoom]);
}

async function tapAt(p, cdp, fx, fy, tile) {
  const pt = await p.evaluate(([fx, fy, t]) => {
    const r = window.__cc.game.r, rect = document.querySelector('#board').getBoundingClientRect();
    const z = r.cam.z * (1 + (r.punch || 0));
    const sx = (wx) => rect.left + (wx - r.cam.x) * z + (r.CX ?? r.W / 2), sy = (wy) => rect.top + (wy - r.cam.y) * z + r.CY;
    const y = fy == null ? sy(t.y + 1) - 2 : sy(t.y + fy);
    const x = sx(t.x + fx);
    const el = document.elementFromPoint(x, y);
    window.__ab = { sent: [] }; const g = window.__cc.game; g.clearPending && g.clearPending(true); document.querySelector('#h-inspect') && document.querySelector('#h-inspect').classList.add('hidden');
    return { x, y, covered: el !== document.querySelector('#board'), tilePx: z };
  }, [fx, fy, tile]);
  if (pt.covered) return { covered: true };
  const touch = async (id) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, radiusX: 6, radiusY: 6, force: 1, id }] });
    await sleep(70);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(160);
  };
  await touch(1);
  let st = await p.evaluate(() => ({ sent: window.__ab.sent.slice(), pend: window.__cc.game.tapPending, ins: !document.querySelector('#h-inspect').classList.contains('hidden') }));
  let taps = 1;
  if (!st.sent.length && st.pend) { await sleep(150); await touch(2); taps = 2; st = { ...st, sent: await p.evaluate(() => window.__ab.sent.slice()) }; }
  const mv = st.sent.find((a) => a && a.type === 'move');
  return { move: mv ? { x: mv.x, y: mv.y } : null, taps, preview: st.pend, inspect: st.ins, tilePx: pt.tilePx };
}

(async () => {
  const browser = await chromium.launch();
  let fails = 0, n = 0, covered = 0; const errors = [];
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr, isMobile: true, hasTouch: true });
    await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`[${vp.id}] ${e.message}`));
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 20000 });
    await sleep(800);
    await p.evaluate(() => window.__cc.startSolo(3, 'royale'));
    await sleep(400);
    await p.evaluate(() => { const i = window.__cc.intro; i && i.skipAll && i.skipAll(); });
    await p.evaluate(() => { window.__cc.session.host.fast = true; });
    await p.waitForFunction(() => window.__cc.game.myTurn(), null, { timeout: 40000 });
    await sleep(2500); // the drop-in
    await p.waitForFunction(() => window.__cc.game.myTurn(), null, { timeout: 40000 });
    await p.evaluate(() => { const s = window.__cc.session; s.__send = s.send; s.send = (a) => { (window.__ab ||= { sent: [] }).sent.push(a); }; });
    const cdp = await ctx.newCDPSession(p);
    for (const zoom of ZOOMS) for (const piece of PIECES) {
      const su = await setup(p, piece, zoom);
      if (su.skip) { console.log(`${vp.id} ${zoom} ${piece}: skip (${su.skip})`); continue; }
      const above = { x: su.spot.x, y: su.spot.y - 1 }, own = su.spot;
      const row = [];
      for (const [name, fx, fy] of ABOVE) {
        const r = await tapAt(p, cdp, fx, fy, above); if (r.covered) { covered++; row.push(name + ':covered'); continue; }
        n++; const ok = r.move && r.move.x === above.x && r.move.y === above.y;
        if (!ok) fails++;
        row.push(`${name}:${ok ? 'ok' : 'FAIL(' + (r.move ? r.move.x + ',' + r.move.y : r.inspect ? 'inspect' : 'none') + ')'}${r.taps > 1 ? '*' : ''}`);
      }
      for (const [name, fx, fy] of OWN) {
        const r = await tapAt(p, cdp, fx, fy, own); if (r.covered) { covered++; row.push(name + ':covered'); continue; }
        n++; const ok = !r.move;
        if (!ok) fails++;
        row.push(`${name}:${ok ? 'ok' : 'FAIL(moved ' + r.move.x + ',' + r.move.y + ')'}`);
      }
      console.log(`${vp.id} ${zoom.padEnd(5)} ${piece.padEnd(6)} tile ${su.z.toFixed(1)}px x${su.scale}  ${row.join(' ')}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`SUMMARY taps ${n}, fails ${fails}, covered ${covered}, page errors ${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''}  (* = previewed, confirmed by a second tap)`);
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

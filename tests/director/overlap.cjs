// A1 Director: on-screen message overlap probe.
// Plays fast bot matches (the player seat is handed to the AI) and samples every visible
// message element (DOM callouts, banners, tips, feed, toast, lethal, chips, discovery,
// canvas ultimate cine / canvas banners / floating combat text) every 100 ms.
// Reports overlapping pairs per mode and saves screenshots.
//
//   NODE_PATH=$(npm root -g) node tests/director/overlap.cjs [--url http://localhost:8123/] [--secs 120] [--tag after] [--modes royale,squads,siege] [--land]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('url', 'http://localhost:8123/');
const SECS = +arg('secs', 120);
const TAG = arg('tag', 'run');
const MODES = arg('modes', 'royale,squads,siege').split(',');
const LAND = process.argv.includes('--land');
const OUT = arg('out', path.join('/tmp', 'cc-director', TAG));
fs.mkdirSync(OUT, { recursive: true });

// Runs in the page before any script: record canvas text drawn inside the message draw calls.
function hookCanvas() {
  window.__msgRec = { frame: [], last: [], tag: null };
  const P = CanvasRenderingContext2D.prototype, fill = P.fillText;
  P.fillText = function (text, x, y, mw) {
    const R = window.__msgRec;
    if (R.tag && this.canvas && this.canvas.id === 'board' && String(text).trim()) {
      const m = this.measureText(text);
      const px = parseFloat((this.font.match(/(\d+(\.\d+)?)px/) || [0, 12])[1]);
      const w = m.width, al = this.textAlign, bl = this.textBaseline;
      const x0 = al === 'center' ? x - w / 2 : al === 'right' || al === 'end' ? x - w : x;
      const y0 = bl === 'middle' ? y - px * 0.45 : bl === 'top' ? y : y - px * 0.8;
      const T = this.getTransform();
      const pts = [[x0, y0], [x0 + w, y0], [x0, y0 + px * 0.9], [x0 + w, y0 + px * 0.9]].map(([a, b]) => [T.a * a + T.c * b + T.e, T.b * a + T.d * b + T.f]);
      const r = this.canvas.getBoundingClientRect(), k = r.width / this.canvas.width;
      const xs = pts.map((p) => r.left + p[0] * k), ys = pts.map((p) => r.top + p[1] * k);
      if (this.globalAlpha > 0.12) R.frame.push({ tag: R.tag, id: R.id, text: String(text), x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
    return fill.call(this, text, x, y, mw);
  };
}

// Runs in the page after the game loaded: wrap the renderer's message draw calls.
function hookRenderer() {
  const r = window.__cc.game.r, R = window.__msgRec;
  let seq = 0;
  const wrap = (name, tag) => { const f = r[name]; if (!f) return; r[name] = function (...a) { const pt = R.tag, pid = R.id; R.tag = tag; R.id = tag + (++seq); try { return f.apply(this, a); } finally { R.tag = pt; R.id = pid; } }; };
  wrap('drawCine', 'cine'); wrap('drawBanner', 'cbanner');
  // floats: every float is its own message (each fillText = one item)
  const ds = r.drawScreenText; if (ds) r.drawScreenText = function (...a) { const pt = R.tag; R.tag = 'float'; R.id = null; try { return ds.apply(this, a); } finally { R.tag = pt; } };
  const fr = r.frame; r.frame = function (...a) { R.frame = []; const out = fr.apply(this, a); R.last = R.frame; return out; };
}

// Sample all visible message rects (runs in page).
function sample() {
  const items = [];
  const vis = (el) => {
    if (!el || !el.isConnected) return 0;
    if (el.classList.contains('hidden')) return 0;
    let a = 1;
    for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; a *= +cs.opacity; }
    return a;
  };
  const tight = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
  const add = (kind, el, useTight) => {
    const a = vis(el); if (a < 0.15) return;
    const r = useTight ? tight(el) : el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    items.push({ kind, x: r.left, y: r.top, w: r.width, h: r.height, a: +a.toFixed(2), text: (el.textContent || '').trim().slice(0, 40) });
  };
  const $ = (s) => document.querySelector(s);
  const gs = $('#s-game'); if (!gs || !gs.classList.contains('active')) return { items: [], hud: [] };
  const ban = $('#h-banner');
  if (ban) { const a = vis(ban); if (a >= 0.15) { const rs = [...ban.children].filter((c) => c.textContent.trim()).map(tight); if (rs.length) { const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top)), x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom)); items.push({ kind: 'banner', x: x0, y: y0, w: x1 - x0, h: y1 - y0, a, text: ban.textContent.trim().slice(0, 40) }); } } }
  add('streak', $('#h-streak'), true);
  add('tip', $('#gm-tip'));
  document.querySelectorAll('#h-feed > div').forEach((d) => add('feed', d));
  add('toast', $('#toast'));
  add('lethal', $('#lethal'));
  add('chip', $('#event-chip'));
  add('discovery', $('#discovery'), true);
  add('intro', $('#contenders'), true);
  // Director-managed lanes (10.0) mark their message nodes with data-msg
  document.querySelectorAll('[data-msg]').forEach((d) => { if (!['h-banner', 'h-streak', 'gm-tip'].includes(d.id) && !(d.parentElement && d.parentElement.id === 'h-feed')) add(d.dataset.msg, d, d.dataset.tight === '1'); });
  // canvas text from the last drawn frame, grouped per draw call
  const groups = new Map();
  for (const t of window.__msgRec.last) {
    const key = t.tag === 'float' ? 'f' + Math.random() : t.id;
    const g = groups.get(key);
    if (!g) groups.set(key, { kind: t.tag, x: t.x, y: t.y, x1: t.x + t.w, y1: t.y + t.h, text: t.text });
    else { g.x = Math.min(g.x, t.x); g.y = Math.min(g.y, t.y); g.x1 = Math.max(g.x1, t.x + t.w); g.y1 = Math.max(g.y1, t.y + t.h); }
  }
  for (const g of groups.values()) items.push({ kind: g.kind, x: g.x, y: g.y, w: g.x1 - g.x, h: g.y1 - g.y, a: 1, text: g.text.slice(0, 40) });
  // interactive HUD that messages must not sit on
  const hud = [];
  for (const s of ['#h-card', '#h-actions', '#ult-btn', '.hud-top .hud-info', '#h-order', '.hud-top .hud-btns']) { const el = $(s); if (el && vis(el) > 0.3) { const r = el.getBoundingClientRect(); if (r.width > 2) hud.push({ kind: s, x: r.left, y: r.top, w: r.width, h: r.height }); } }
  return { items, hud };
}

const inter = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 2 && h > 2 ? w * h : 0; };

async function runMode(browser, mode, vp) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(hookCanvas);
  await page.route('**/*', (r) => (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  for (let i = 0; ; i++) { if (await page.evaluate(() => !!(window.__cc && window.__cc.game && window.__cc.game.r)).catch(() => false)) break; if (i > 80) throw new Error('game did not load: ' + errors.join(' | ')); await page.waitForTimeout(250); }
  await page.waitForTimeout(900);
  await page.evaluate(hookRenderer);
  const bots = mode === 'siege' ? 3 : 7;
  await page.evaluate(([b, m]) => { window.__cc.startSolo(b, m); window.__cc.session.host.setBot('me'); }, [bots, mode]);
  await page.waitForTimeout(400); await page.evaluate(() => { const i = window.__cc.intro; i && i.skipAll && i.skipAll(); }); // 17.0 (D2): solo's briefing now waits for a tap; the intro has its own probe (/tmp/d217/intro.cjs)
  const st = { mode, samples: 0, pairSamples: 0, samplesWithOverlap: 0, floatFloat: 0, onHud: 0, kinds: {}, pairs: {}, maxVisible: 0, shots: [], errors };
  const t0 = Date.now(); let shotN = 0, lastShot = 0;
  while (Date.now() - t0 < SECS * 1000) {
    const smp = await page.evaluate(sample);
    const over = await page.evaluate(() => !!(window.__cc.game.s && window.__cc.game.s.over));
    st.samples++;
    const its = smp.items; st.maxVisible = Math.max(st.maxVisible, its.filter((i) => i.kind !== 'float').length);
    for (const i of its) st.kinds[i.kind] = (st.kinds[i.kind] || 0) + 1;
    let n = 0; const hit = [];
    for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
      const A = its[i], B = its[j];
      if (!inter(A, B)) continue;
      if (A.kind === 'float' && B.kind === 'float') { st.floatFloat++; continue; }
      n++; const key = [A.kind, B.kind].sort().join(' x '); st.pairs[key] = (st.pairs[key] || 0) + 1; hit.push(`${A.kind}:"${A.text}" x ${B.kind}:"${B.text}"`);
    }
    for (const it of its) for (const h of smp.hud) if (it.kind !== 'float' && inter(it, h) > 40) { st.onHud++; const kk = it.kind + ' on ' + h.kind; st.hudPairs = st.hudPairs || {}; st.hudPairs[kk] = (st.hudPairs[kk] || 0) + 1; }
    st.pairSamples += n; if (n) st.samplesWithOverlap++;
    const now = Date.now();
    if ((n && shotN < 6 && now - lastShot > 2500) || (now - lastShot > 20000)) {
      lastShot = now; const f = path.join(OUT, `${mode}${LAND ? '-land' : ''}-${String(++shotN).padStart(2, '0')}${n ? '-overlap' : ''}.png`);
      await page.screenshot({ path: f }); st.shots.push(f + (n ? '  ' + hit.slice(0, 2).join(' | ') : ''));
    }
    if (over && now - t0 > 8000) { await page.waitForTimeout(5200); break; }
    await page.waitForTimeout(100);
  }
  await ctx.close();
  return st;
}

(async () => {
  const browser = await chromium.launch();
  const vp = LAND ? { width: 844, height: 390 } : { width: 390, height: 844 };
  const res = [];
  for (const m of MODES) res.push(await runMode(browser, m, vp)); // sequential: keeps CPU contention (and timing) comparable
  await browser.close();
  const tot = { samples: 0, pairSamples: 0, samplesWithOverlap: 0, floatFloat: 0, onHud: 0 };
  for (const r of res) for (const k in tot) tot[k] += r[k];
  const out = { tag: TAG, url: URL, viewport: vp, secs: SECS, total: tot, modes: res };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 1));
  for (const r of res) console.log(`${r.mode.padEnd(7)} samples ${r.samples}  overlap pair-samples ${r.pairSamples}  samples-with-overlap ${r.samplesWithOverlap}  float-float ${r.floatFloat}  msg-on-HUD ${r.onHud}  max-visible ${r.maxVisible}  errors ${r.errors.length}\n   pairs ${JSON.stringify(r.pairs)}  onHUD ${JSON.stringify(r.hudPairs || {})}\n   kinds ${JSON.stringify(r.kinds)}`);
  console.log('TOTAL', JSON.stringify(tot), '\nreport', path.join(OUT, 'report.json'));
  for (const r of res) for (const e of r.errors.slice(0, 5)) console.log('ERR', r.mode, e);
})();

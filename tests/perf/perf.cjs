// Chess Complex perf + leak benchmark (A10, 10.0).
// Usage: NODE_PATH=$(npm root -g) node tests/perf/perf.cjs [--urls http://localhost:8124/,http://localhost:8123/] [--rounds 2] [--secs 8] [--leak 5] [--no-leak]
// For each URL: frame times (rAF interval avg/p95/max, long frames) and CDP CPU time per second during a busy 8-player
// match at 390x844, with and without 4x CPU throttle, then a leak check across N consecutive matches.
// The box is shared and loaded, so URLs are measured interleaved and CPU time is reported next to wall-clock frames.
const { chromium } = require('playwright');
const fs = require('fs');
const A = process.argv.slice(2); const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const URLS = arg('urls', 'http://localhost:8124/,http://localhost:8123/').split(',');
const ROUNDS = +arg('rounds', 2), SECS = +arg('secs', 8), LEAK = A.includes('--no-leak') ? 0 : +arg('leak', 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INIT = () => {
  window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
  // count rAF callbacks per frame (a growing number means leaked render loops) and live listeners per target
  const raf = window.requestAnimationFrame.bind(window); let pending = 0;
  window.__rafPerFrame = [];
  window.requestAnimationFrame = (cb) => { pending++; return raf((t) => { pending--; cb(t); }); };
  setInterval(() => { window.__rafPending = pending; }, 100);
  const L = (window.__listeners = { add: 0, remove: 0, byType: {} });
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) { L.add++; const k = (this === window ? 'window' : this === document ? 'document' : this.nodeName || this.constructor.name) + ':' + t; L.byType[k] = (L.byType[k] || 0) + 1; return add.call(this, t, f, o); };
  EventTarget.prototype.removeEventListener = function (t, f, o) { L.remove++; const k = (this === window ? 'window' : this === document ? 'document' : this.nodeName || this.constructor.name) + ':' + t; L.byType[k] = (L.byType[k] || 0) - 1; return rem.call(this, t, f, o); };
  const si = window.setInterval, ci = window.clearInterval; window.__intervals = new Set();
  window.setInterval = function (f, ms, ...a) { const id = si.call(window, f, ms, ...a); window.__intervals.add(id); return id; };
  window.clearInterval = function (id) { window.__intervals.delete(id); return ci.call(window, id); };
  window.__dismiss = setInterval(() => { const lg = document.querySelector('#m-login:not(.hidden) #lg-claim'); if (lg) lg.click(); const sq = document.querySelector('.sequel:not(.out)'); if (sq && performance.now() > 3000) sq.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }, 400);
};

async function open(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(INIT);
  const p = await ctx.newPage(); p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(e.message));
  const t0 = Date.now();
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 90000 });
  const ready = Date.now() - t0;
  await sleep(2500);
  p.__boot = { readyMs: ready, ...(await p.evaluate(() => ({ longTasks: window.__lt.length, longTotalMs: Math.round(window.__lt.reduce((a, b) => a + b, 0)), longMaxMs: Math.round(Math.max(0, ...window.__lt)) }))) };
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  return { ctx, p, cdp };
}
async function startBusy(p, fast = false) {
  await p.evaluate((fast) => {
    const cc = window.__cc; cc.profile.botLevel = 'normal'; cc.profile.mode = 'royale';
    cc.startSolo(7, 'royale');
    clearInterval(window.__ap);
    window.__ap = setInterval(async () => {
      const g = cc.game, s = cc.session; if (!s || !s.host) return;
      if (fast) s.host.fast = true;
      const me = s.host.s.units.find((u) => u.pid === 'me');
      if (!fast && me && me.alive) { const E = window.__E || (window.__E = await import('/js/engine.js')); if (me.hp < E.stats(me).maxHp * 0.7) me.hp = E.stats(me).maxHp; }
      try { if (g.myTurn()) s.send({ type: 'end' }); } catch {}
    }, 300);
  }, fast);
}
const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
async function measure(p, cdp, secs) {
  const m0 = await metrics(cdp);
  const fr = await p.evaluate((secs) => new Promise((r) => { const ts = []; const t0 = performance.now(); const f = (t) => { ts.push(t); if (t - t0 < secs * 1000) requestAnimationFrame(f); else r(ts); }; requestAnimationFrame(f); }), secs);
  const m1 = await metrics(cdp);
  const d = fr.slice(1).map((x, i) => x - fr[i]).sort((a, b) => a - b);
  const wall = (m1.Timestamp - m0.Timestamp) || secs;
  const st = await p.evaluate(() => { const g = window.__cc.game; return { turn: g.s && g.s.turnNo, over: g.s && g.s.over, alive: g.s && g.s.units.filter((u) => u.alive && u.kind === 'player').length }; });
  return {
    frames: d.length, fps: +(d.length / secs).toFixed(1), avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(0), long50: d.filter((x) => x > 50).length,
    taskPerSec: +((m1.TaskDuration - m0.TaskDuration) / wall).toFixed(3), scriptPerSec: +((m1.ScriptDuration - m0.ScriptDuration) / wall).toFixed(3), layoutPerSec: +((m1.LayoutDuration - m0.LayoutDuration + m1.RecalcStyleDuration - m0.RecalcStyleDuration) / wall).toFixed(3),
    heapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1), nodes: m1.Nodes, turnsAdvanced: st.turn, alive: st.alive, over: st.over,
  };
}
async function perfOnce(browser, url) {
  const { ctx, p, cdp } = await open(browser, url);
  const out = { boot: p.__boot };
  try {
    out.title = await measure(p, cdp, 4);
    await startBusy(p);
    await sleep(5000);
    out.match = await measure(p, cdp, SECS);
    // where does the frame time go? 5 s CPU profile, top self-time functions by file:line
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
    await sleep(5000);
    const { profile } = await cdp.send('Profiler.stop');
    const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map(); let tot = 0;
    profile.samples.forEach((id, i) => { const f = byId.get(id).callFrame; const d = profile.timeDeltas[i] || 0; tot += d; if (f.functionName === '(idle)') return; const k = `${f.functionName || '(anon)'} ${f.url.replace(/.*\//, '') || ''}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + d); });
    out.hot = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${(100 * v / tot).toFixed(1)}% ${k}`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await sleep(1500);
    out.match4x = await measure(p, cdp, SECS);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // low quality mode, if the game exposes it
    await p.evaluate(() => { try { window.__cc.game.r.setQuality('low'); } catch {} });
    await sleep(1000);
    out.matchLow = await measure(p, cdp, SECS);
  } catch (e) { out.error = e.message.split('\n')[0]; }
  out.errors = p.__errors.slice(0, 5);
  await ctx.close();
  return out;
}
async function leakCheck(browser, url, n) {
  const { ctx, p, cdp } = await open(browser, url);
  const rows = [];
  const sample = async (label) => {
    await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); await cdp.send('HeapProfiler.collectGarbage');
    const dc = await cdp.send('Memory.getDOMCounters');
    const m = await metrics(cdp);
    const pg = await p.evaluate(() => ({ listeners: window.__listeners.add - window.__listeners.remove, byType: window.__listeners.byType, intervals: window.__intervals.size, raf: window.__rafPending, canvases: document.querySelectorAll('canvas').length }));
    rows.push({ label, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: dc.nodes, jsListeners: dc.jsEventListeners, docs: dc.documents, ...pg });
  };
  try {
    await sample('boot');
    for (let i = 1; i <= n; i++) {
      await startBusy(p, true);
      const ok = await p.waitForFunction(() => !document.querySelector('#m-results').classList.contains('hidden'), null, { timeout: 180000, polling: 500 }).then(() => true, () => false);
      await p.evaluate(() => clearInterval(window.__ap));
      await sleep(800);
      await p.evaluate(() => { const b = document.querySelector('#m-results [data-act="to-title"]'); b && b.click(); });
      await sleep(900);
      await p.evaluate(() => { const y = document.querySelector('#cf-yes'); if (y && !y.closest('.hidden')) y.click(); document.querySelectorAll('#m-reveal:not(.hidden) [data-act="close-reveal"]').forEach((b) => b.click()); });
      await sleep(1500);
      await sample(`match${i}${ok ? '' : '(no results)'}`);
    }
  } catch (e) { rows.push({ error: e.message.split('\n')[0] }); }
  const errors = p.__errors.slice(0, 5);
  await ctx.close();
  // byType delta between first match and last
  const a = rows[1], b = rows[rows.length - 1]; const grow = {};
  if (a && b && a.byType && b.byType) for (const k of Object.keys(b.byType)) { const dlt = (b.byType[k] || 0) - (a.byType[k] || 0); if (dlt > 0) grow[k] = dlt; }
  for (const r of rows) delete r.byType;
  return { rows, listenerGrowthAfterMatch1: grow, errors };
}

(async () => {
  const browser = await chromium.launch();
  const report = { when: new Date().toISOString(), load: require('os').loadavg(), perf: {}, leak: {} };
  for (let r = 0; r < ROUNDS; r++) for (const u of (r % 2 ? URLS.slice().reverse() : URLS)) { (report.perf[u] = report.perf[u] || []).push(await perfOnce(browser, u)); console.log(`perf round ${r + 1} ${u}: ${JSON.stringify(report.perf[u][r].match)}`); }
  if (LEAK) for (const u of URLS) { report.leak[u] = await leakCheck(browser, u, LEAK); console.log(`leak ${u}:`); for (const row of report.leak[u].rows) console.log('   ', JSON.stringify(row)); console.log('    listener growth after match 1:', JSON.stringify(report.leak[u].listenerGrowthAfterMatch1)); }
  await browser.close();
  // summary: median across rounds
  const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  console.log('\nPERF SUMMARY (median of rounds; frame ms are wall-clock on a shared box, cpu = CDP task seconds per second)');
  for (const u of URLS) for (const k of ['title', 'match', 'match4x', 'matchLow']) {
    const xs = report.perf[u].map((r) => r[k]).filter(Boolean);
    if (!xs.length) continue;
    console.log(`  ${u.padEnd(24)} ${k.padEnd(8)} fps=${med(xs.map((x) => x.fps))} avg=${med(xs.map((x) => x.avg))}ms p95=${med(xs.map((x) => x.p95))}ms long>50=${med(xs.map((x) => x.long50))} cpu=${med(xs.map((x) => x.taskPerSec))} script=${med(xs.map((x) => x.scriptPerSec))} layout=${med(xs.map((x) => x.layoutPerSec))} heap=${med(xs.map((x) => x.heapMB))}MB nodes=${med(xs.map((x) => x.nodes))}`);
  }
  for (const u of URLS) { const bs = report.perf[u].map((r) => r.boot).filter(Boolean); if (bs.length) console.log(`  ${u.padEnd(24)} boot     ready=${med(bs.map((b) => b.readyMs))}ms longTotal=${med(bs.map((b) => b.longTotalMs))}ms longMax=${med(bs.map((b) => b.longMaxMs))}ms`); }
  for (const u of URLS) { const h = report.perf[u][0] && report.perf[u][0].hot; if (h) console.log(`  hot ${u}: ${h.slice(0, 10).join(' | ')}`); }
  console.log('  loadavg', report.load.map((x) => x.toFixed(1)).join(' '));
  const out = arg('json', '/tmp/cc-perf.json'); fs.writeFileSync(out, JSON.stringify(report, null, 1)); console.log('report:', out);
})();

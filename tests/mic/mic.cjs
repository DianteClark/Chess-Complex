// Q 10.3: microphone permission flow (Social & network). Chromium fake media, an emulated iOS Home Screen app
// (iPhone UA + display-mode: standalone + navigator.standalone) and a stubbed navigator.audioSession.
//   M1 card      Join Voice shows a pre-permission card (mentions the microphone, has Allow and Listen Only) and
//                getUserMedia has NOT been called yet
//   M2 allow     Allow calls getUserMedia exactly once, inside the tap's own task (iOS only shows the prompt from a
//                gesture), audioSession.type is 'play-and-record' before that call; voice ends up on, not listen-only
//   M3 listen    Listen Only joins voice with zero getUserMedia calls; Turn On Mic is offered
//   M4 denied    getUserMedia rejects NotAllowedError (+ permissions.query 'denied'): listen-only, the help shown is the
//                Home Screen app steps on iOS standalone and the browser steps on desktop Chrome; no page errors
//   M5 settings  Settings has Allow / Test Microphone and a permission state line; Test Microphone calls getUserMedia
//                from the tap, the level meter moves with the fake tone, and every test track is stopped after
//                the test / when Settings closes
//   M6 state     the Settings permission line follows permissions.query: granted / denied / prompt read differently
//   NODE_PATH=$(npm root -g) node tests/mic/mic.cjs [--url http://localhost:8123/] [--only M1,M2]
process.env.CC_URL = process.env.CC_URL || 'http://localhost:8123/';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (opt('url')) process.env.CC_URL = opt('url');
const L = require('../online/lib.js');
const { chromium, sleep } = L;
const ONLY = opt('only') ? opt('only').split(',') : null;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// in page, before any script
function INIT(o) {
  const M = window.__mic = { gum: [], order: [], streams: [], perm: o.perm || 'prompt', tapTask: false, as: [] };
  if (o.standalone) {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null } : mm(q));
    try { Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true }); } catch {}
  }
  if (o.audioSession) {
    let type = 'auto';
    const AS = { get type() { return type; }, set type(v) { type = v; M.as.push(v); M.order.push('as:' + v); }, state: 'active', addEventListener() {}, removeEventListener() {} };
    try { Object.defineProperty(navigator, 'audioSession', { get: () => AS, configurable: true }); } catch {}
  }
  // a tap's task: set during a click/pointerup/touchend (capture), cleared by the next macrotask
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click']) addEventListener(ev, () => { M.tapTask = true; setTimeout(() => { M.tapTask = false; }, 0); }, true);
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const g = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => {
      M.gum.push({ tap: M.tapTask, ua: !!(navigator.userActivation && navigator.userActivation.isActive), t: performance.now(), as: o.audioSession ? navigator.audioSession.type : null });
      M.order.push('gum');
      if (window.__gumFail) return Promise.reject(Object.assign(new Error('blocked by test'), { name: window.__gumFail }));
      return g(c).then((s) => { M.streams.push(s); return s; });
    };
  }
  if (navigator.permissions && navigator.permissions.query) {
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && d.name === 'microphone' ? Promise.resolve({ state: window.__mic.perm, name: 'microphone', onchange: null, addEventListener() {}, removeEventListener() {} }) : q(d));
  }
}

// visible element helpers (in page)
const FIND = () => {
  const vis = (e) => { if (!e || !e.isConnected) return false; for (let n = e; n && n !== document.documentElement; n = n.parentElement) { if (n.classList && n.classList.contains('hidden')) return false; const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; } const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  window.__vis = vis;
  window.__btn = (re, root = document) => [...root.querySelectorAll('button, [role=button], a.btn')].find((b) => vis(b) && new RegExp(re, 'i').test(b.textContent.replace(/\s+/g, ' ').trim()));
  window.__card = () => {
    const allow = window.__btn('^(allow|turn on|use) (the )?mic|^allow$|allow microphone'); if (!allow) return null;
    let box = allow.closest('[role=dialog], .modal-box, .card, .panel, .vc-card, .vc-pre, section, div'); for (let n = allow.parentElement; n; n = n.parentElement) { if (window.__btn('listen', n)) { box = n; break; } }
    const r = box.getBoundingClientRect();
    return { text: box.textContent.replace(/\s+/g, ' ').trim().slice(0, 300), listen: !!window.__btn('listen', box), rect: [r.left, r.top, r.width, r.height].map(Math.round), inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1 };
  };
};

async function open(browser, label, o) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: o.ua || IPHONE_UA });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(INIT, o);
  const run = new L.Run(browser, label, 1); run.ctx = ctx;
  return run;
}
const voiceOn = async (p, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(async () => (await import('/js/voice.js')).voice.state === 'on')) return true; await sleep(200); } return false; }; // waitForFunction does not await an async predicate
const vstate = (p) => p.evaluate(async () => { const v = (await import('/js/voice.js')).voice; return { state: v.state, listenOnly: v.listenOnly, err: v.err, errName: v.errName || null }; });
const mic = (p) => p.evaluate(() => ({ gum: window.__mic.gum, order: window.__mic.order, as: window.__mic.as, live: window.__mic.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length }));
const tapText = async (p, re) => { const box = await p.evaluate((re) => { const b = window.__btn(re); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, re); if (!box) return false; await p.touchscreen.tap(box.x, box.y); return true; };

async function lobbyJoin(run) {
  const { host } = await L.hostLobby(run, { mode: 'royale' });
  await host.evaluate(FIND);
  const ok = await tapText(host, '^join voice');
  run.check(ok, 'no Join Voice button in the host lobby');
  await sleep(700);
  return host;
}

const S = {};
S.M1 = async (run) => {
  const host = await lobbyJoin(run);
  const card = await host.evaluate(() => window.__card());
  const m = await mic(host);
  run.note('card ' + JSON.stringify(card));
  run.check(card, 'no pre-permission card after Join Voice (expected text about the microphone with Allow + Listen Only)');
  if (card) { run.check(/microphone|mic\b/i.test(card.text), 'card does not mention the microphone'); run.check(card.listen, 'card has no Listen Only'); run.check(card.inView, `card not fully on screen ${card.rect}`); }
  run.check(m.gum.length === 0, `getUserMedia called before Allow (${m.gum.length})`);
  await run.shot('host', 'card');
};
S.M2 = async (run) => {
  const host = await lobbyJoin(run);
  const ok = await tapText(host, '^(allow|turn on|use) (the )?mic|^allow$|allow microphone');
  run.check(ok, 'no Allow button');
  await voiceOn(host);
  const v = await vstate(host), m = await mic(host);
  run.note('gum ' + JSON.stringify(m.gum) + ' order ' + m.order.join('>'));
  run.check(m.gum.length >= 1, 'Allow did not call getUserMedia');
  run.check(m.gum.length <= 2, `getUserMedia called ${m.gum.length} times`);
  if (m.gum[0]) { run.check(m.gum[0].tap, 'getUserMedia ran outside the tap task (iOS will not show a prompt)'); run.check(m.gum[0].as === 'play-and-record', `audioSession.type was ${m.gum[0].as} at getUserMedia`); }
  run.check(v.state === 'on' && !v.listenOnly, `voice not on with mic: ${JSON.stringify(v)}`);
  const tr = await host.evaluate(async () => { const v = (await import('/js/voice.js')).voice; return { mine: window.__mic.streams.map((s) => s.getTracks().map((t) => t.readyState + '/' + t.enabled)), voice: v.mic ? v.mic.getTracks().map((t) => t.readyState + '/' + t.enabled + '/' + t.label) : null }; });
  run.note('tracks ' + JSON.stringify(tr));
  run.check(m.live >= 1, 'no live mic track after Allow');
};
S.M3 = async (run) => {
  const host = await lobbyJoin(run);
  const ok = await tapText(host, 'listen');
  run.check(ok, 'no Listen Only button');
  await voiceOn(host);
  const v = await vstate(host), m = await mic(host);
  run.check(m.gum.length === 0, `Listen Only called getUserMedia ${m.gum.length}x`);
  run.check(v.state === 'on' && v.listenOnly, `not listen-only: ${JSON.stringify(v)}`);
  run.check(await host.evaluate(() => !!window.__btn('turn on mic|allow mic|use mic')), 'no Turn On Mic offered after Listen Only');
  run.check(!(m.as || []).includes('play-and-record'), 'Listen Only switched the audio session to play-and-record');
};
const denied = (ua, standalone) => async (run) => {
  const host = await lobbyJoin(run);
  await host.evaluate(() => { window.__gumFail = 'NotAllowedError'; window.__mic.perm = 'denied'; });
  await tapText(host, '^(allow|turn on|use) (the )?mic|^allow$|allow microphone');
  await sleep(2000);
  const v = await vstate(host), m = await mic(host);
  const shown = await host.evaluate(() => [...document.querySelectorAll('.vc-err, .vc-help, [class*=vc-] p, .modal-box p, #gm-tip, #toast')].filter((e) => window.__vis(e)).map((e) => e.textContent.trim()).join(' | ').slice(0, 600));
  run.note('shown: ' + shown);
  run.check(v.listenOnly || v.state === 'off', `not listen-only after denial: ${JSON.stringify(v)}`);
  if (standalone) run.check(/settings/i.test(shown) && /(home screen|home-screen|app)/i.test(shown) && /microphone/i.test(shown), 'denied on iOS Home Screen app: no Home Screen steps on screen');
  else run.check(/(site settings|lock|address bar|permissions|browser)/i.test(shown) && !/home screen|home-screen/i.test(shown), 'denied on desktop Chrome: no browser steps (or iOS steps shown)');
  run.check(!(m.as || []).slice(-1).includes('play-and-record'), 'audio session left in play-and-record after denial');
  await run.shot('host', 'denied');
};
S.M4 = denied(IPHONE_UA, true);
S.M4d = denied(DESKTOP_UA, false);
S.M5 = async (run) => {
  const p = await run.page('p');
  await p.evaluate(FIND);
  await p.evaluate(() => document.querySelector('[data-act="settings"]').click()); await sleep(600);
  const before = await mic(p);
  const stateLine = await p.evaluate(() => { const k = document.querySelector('#mic-state'); if (k && window.__vis(k)) return 'state: ' + k.textContent.trim(); const s = document.querySelector('#m-settings'); return [...s.querySelectorAll('*')].filter((e) => window.__vis(e) && e.children.length === 0 && /microphone|mic\b/i.test(e.textContent)).map((e) => e.textContent.trim()).join(' | ').slice(0, 400); });
  run.note('settings mic text: ' + stateLine);
  run.check(before.gum.length === 0, 'opening Settings called getUserMedia');
  run.check(/(not (yet )?(asked|allowed)|allowed|blocked|will ask|ask)/i.test(stateLine), 'no microphone permission state line in Settings');
  const ok = await tapText(p, 'test (the )?mic');
  run.check(ok, 'no Test Microphone button in Settings');
  if (!ok) return;
  await sleep(500);
  const m = await mic(p);
  run.check(m.gum.length >= 1 && m.gum[0].tap, `Test Microphone: getUserMedia not called from the tap ${JSON.stringify(m.gum)}`);
  const vals = [];
  for (let i = 0; i < 16; i++) {
    vals.push(await p.evaluate(() => { const s = document.querySelector('#m-settings'); const e = s.querySelector('meter, progress, [role=meter], [role=progressbar], [class*=meter] i, [class*=meter] span, [class*=level] i, [class*=level] span, [class*=meter], [class*=level]'); if (!e) return null; const v = e.value ?? e.getAttribute('aria-valuenow'); if (v != null && v !== '') return +v; const cs = getComputedStyle(e); return Math.round(parseFloat(cs.width) * 10) / 10 + (cs.transform !== 'none' ? '|' + cs.transform : '') + '|' + (e.style.getPropertyValue('--lvl') || e.style.getPropertyValue('--level') || ''); }));
    await sleep(150);
  }
  run.note('meter samples ' + JSON.stringify(vals));
  run.check(vals.some((v) => v != null), 'no level meter found in Settings during the test');
  run.check(new Set(vals.filter((v) => v != null)).size >= 3, 'level meter did not move with the fake tone');
  await run.shot('p', 'meter');
  await sleep(6000); // a test should end on its own
  const mid = await mic(p);
  await p.evaluate(() => { const b = document.querySelector('[data-act="close-settings"]'); if (b) b.click(); }); await sleep(500);
  const after = await mic(p);
  run.note(`live tracks: 6 s after test ${mid.live}, after close ${after.live}`);
  run.check(after.live === 0, `${after.live} mic track(s) still live after closing Settings`);
};
S.M6 = async (run) => {
  const p = await run.page('p'); await p.evaluate(FIND);
  const lines = {};
  for (const st of ['granted', 'denied', 'prompt']) {
    await p.evaluate((st) => { window.__mic.perm = st; document.querySelector('[data-act="close-settings"]').click(); }, st); await sleep(200);
    await p.evaluate(() => document.querySelector('[data-act="settings"]').click()); await sleep(700);
    lines[st] = await p.evaluate(() => { const k = document.querySelector('#mic-state'); if (k) return k.textContent.trim(); const s = document.querySelector('#m-settings'); return [...s.querySelectorAll('*')].filter((e) => window.__vis(e) && e.children.length === 0 && /microphone|mic\b|allowed|blocked|not asked/i.test(e.textContent)).map((e) => e.textContent.trim()).join(' | ').slice(0, 200); });
  }
  run.note('state lines ' + JSON.stringify(lines));
  run.check(new Set(Object.values(lines)).size === 3, 'Settings permission line does not change with granted / denied / prompt');
  run.check(/allow|on|granted/i.test(lines.granted) && /block|denied|off/i.test(lines.denied), `granted/denied wording wrong ${JSON.stringify(lines)}`);
  run.check((await mic(p)).gum.length === 0, 'reading the permission state called getUserMedia');
};
// M7 returning player: permission remembered (cc_mic granted, permissions 'prompt' like an iPhone Home Screen relaunch)
// -> Join Voice may skip the card, but getUserMedia must still run inside the tap; voice ends up on with a mic
S.M7 = async (run) => {
  const { host } = await L.hostLobby(run, { mode: 'royale' });
  await host.evaluate(() => localStorage.setItem('cc_mic', JSON.stringify({ state: 'granted', name: '', ctx: 'ios-app', at: Date.now() })));
  await host.evaluate(FIND);
  await tapText(host, '^join voice'); await sleep(700);
  const card = await host.evaluate(() => window.__card());
  if (card) { run.note('card shown again for a returning player (ok)'); await tapText(host, '^(allow|turn on|use) (the )?mic|^allow$|allow microphone'); }
  await voiceOn(host);
  const v = await vstate(host), m = await mic(host);
  run.note('gum ' + JSON.stringify(m.gum));
  run.check(m.gum.length >= 1 && m.gum[0].tap, 'returning player: getUserMedia not called from the tap');
  run.check(v.state === 'on' && !v.listenOnly, `returning player: ${JSON.stringify(v)}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const out = []; let fails = 0;
  for (const [k, fn] of Object.entries(S)) {
    if (ONLY && !ONLY.includes(k)) continue;
    const desk = k === 'M4d';
    const run = await open(browser, k, { ua: desk ? DESKTOP_UA : IPHONE_UA, standalone: !desk, audioSession: !desk, perm: 'prompt' });
    try { await fn(run); } catch (e) { run.fails.push('threw: ' + String(e.message || e).split('\n')[0]); }
    run.fails.push(...run.errors);
    const ok = !run.fails.length; if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${k}${ok ? '' : '\n   - ' + run.fails.join('\n   - ')}${run.notes.length ? '\n   . ' + run.notes.join('\n   . ') : ''}`);
    out.push({ k, ok, fails: run.fails, notes: run.notes, shots: run.shots });
    await run.close();
  }
  await browser.close();
  console.log(`mic: ${out.length - fails}/${out.length} pass`);
  process.exit(fails ? 1 : 0);
})();

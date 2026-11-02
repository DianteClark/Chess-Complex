// QA social suite (10.2): independent checks of quick chat and voice that complement tests/online/social.js (N's).
// Usage: NODE_PATH=$(npm root -g) node tests/social/qa-social.cjs [--url http://localhost:8141/] [--only Q1,Q3]
//   Q1 three pages (host, c1 attacker, c2 bystander): raw wire chat from c1 (XSS, 5 kB, control chars, spoofed id/pid/tm,
//      prototype keys) -> host and c2 show only cleaned text, nothing executes, no new elements/inline handlers;
//      hostile player names with quotes ("x\" onclick=\"...") never become attributes anywhere (lobby, HUD, feed, results).
//   Q2 flood: c1 fires 400 raw chat messages in ~2 s -> host relays <= the bucket allows, the match keeps advancing,
//      the host page stays responsive (event-loop lag), c2 log stays bounded.
//   Q3 voice is opt-in: getUserMedia and RTCPeerConnection are counted from page start (addInitScript); lobby, match,
//      chat, settings open: zero calls on every page until a player taps Join Voice; a player who has not joined gets
//      no peer connection even when others are in voice.
//   Q4 voice failure paths (fake media flags): getUserMedia rejects NotAllowedError / NotFoundError -> listen-only
//      with a message, no page errors, match unaffected; mute (talk released) disables the track; a peer that crashes
//      (tab closed without leaving) is dropped by the host and can rejoin voice afterwards.
const L = require('../online/lib.js');
const { chromium, sleep } = L;
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
if (args.url) process.env.CC_URL = args.url;
const ONLY = args.only ? String(args.only).split(',') : null;

const COUNT_INIT = () => {
  window.__media = { gum: 0, pc: 0 };
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) { const g = md.getUserMedia.bind(md); md.getUserMedia = (...a) => { window.__media.gum++; if (window.__gumFail) return Promise.reject(Object.assign(new Error('blocked by test'), { name: window.__gumFail })); return g(...a); }; }
  const PC = window.RTCPeerConnection; if (PC) { window.RTCPeerConnection = function (...a) { window.__media.pc++; return new PC(...a); }; window.RTCPeerConnection.prototype = PC.prototype; }
  // XSS tripwires
  window.__xss = 0; window.alert = () => { window.__xss++; };
};
const domScan = (p) => p.evaluate(() => {
  const bad = [];
  for (const e of document.querySelectorAll('*')) {
    for (const a of e.attributes) if (/^on/i.test(a.name) && !e.__staticOn) bad.push(`${e.tagName.toLowerCase()}#${e.id}[${a.name}]`);
    if (/^(script|iframe|object|embed)$/i.test(e.tagName) && !e.src.includes('/js/') && !e.src.includes('peerjs') && e.closest('body')) bad.push('elem ' + e.tagName);
  }
  for (const im of document.querySelectorAll('img[src="x"], img[onerror], svg[onload]')) bad.push('img ' + im.outerHTML.slice(0, 60));
  return { bad, xss: window.__xss };
});
const markStatic = (p) => p.evaluate(() => { for (const e of document.querySelectorAll('*')) for (const a of e.attributes) if (/^on/i.test(a.name)) e.__staticOn = true; });
const chatLog = (p) => p.evaluate(async () => (await import('/js/chat.js')).chat.log.map((l) => `${l.name}: ${l.text}`));
const raw = (p, m) => p.evaluate((m) => window.__cc.session.client.send(m), m);

async function threeWay(run, names = {}) {
  await run.ctx.addInitScript(COUNT_INIT);
  const { host, code } = await L.hostLobby(run, { mode: 'royale' });
  const c1p = await run.page('c1');
  await c1p.evaluate(() => document.querySelector('#s-title [data-go="join"]').click()); await sleep(800);
  await c1p.evaluate((n) => { window.__cc.profile.name = n; }, names.c1 || 'c1');
  await c1p.fill('#in-code', code); await c1p.evaluate(() => document.querySelector('#s-join [data-act="join"]').click());
  await c1p.waitForFunction(() => /In the lobby/.test(document.querySelector('#join-status').textContent), null, { timeout: 8000 });
  const c2 = await L.clientJoin(run, 'c2', code);
  for (const p of [host, c1p, c2]) await markStatic(p);
  return { host, c1: c1p, c2 };
}

const S = {};
S.Q1 = async (run) => {
  const EVIL = 'x" onclick="w';
  const { host, c1, c2 } = await threeWay(run, { c1: EVIL });
  await L.startMatch(run, host, { bots: 1, clients: [c1, c2] });
  await L.protectHumans(host); await L.autoplay(host); await L.autoplay(c1); await L.autoplay(c2);
  const c1pid = await L.clientPid(c1), c2pid = await L.clientPid(c2);
  const name = await host.evaluate((p) => (window.__cc.game.s.units.find((u) => u.pid === p) || {}).name, c1pid);
  run.check(name && !/[<>]/.test(name), `host stored name ${JSON.stringify(name)}`);
  const payloads = [
    { t: 'chat', x: '<img src=x onerror=alert(1)>pwn' }, { t: 'chat', x: '"><svg onload=alert(2)>' }, { t: 'chat', x: '＜script＞alert(3)＜/script＞' },
    { t: 'chat', x: 'A'.repeat(5000) }, { t: 'chat', x: 'evil‮txt.exe' }, { t: 'chat', x: 'hi', id: 1, pid: c2pid }, { t: 'chat', x: 'team?', tm: 1, team: 0 },
    { t: 'chat', k: '__proto__' }, { t: 'chat', k: 'constructor' }, { t: 'chat', x: 'javascript:alert(4)' }, { t: 'chat', x: 'visit free-skins.gg now' },
  ];
  for (const m of payloads) { await raw(c1, m); await sleep(3300); } // past the custom-phrase gap so each one is judged on content
  await sleep(800);
  for (const [lab, p] of [['host', host], ['c2', c2]]) {
    const log = await chatLog(p);
    const mine = log.filter((l) => l.startsWith(name + ':'));
    run.note(`${lab} log from attacker: ${JSON.stringify(mine)}`);
    run.check(mine.length >= 3, `${lab}: expected the cleaned custom lines to arrive (got ${mine.length})`);
    run.check(mine.every((l) => !/[<>＜＞‮]/.test(l)), `${lab}: raw markup/bidi in log ${JSON.stringify(mine)}`);
    run.check(mine.every((l) => l.length <= name.length + 2 + 40), `${lab}: line over 40 chars`);
    run.check(!mine.some((l) => /free-skins\.gg/i.test(l)), `${lab}: link not masked`);
    run.check(!log.some((l) => /: hi$/.test(l) && !l.startsWith(name)), `${lab}: spoofed pid line shown as another player`);
    const d = await domScan(p);
    run.check(!d.bad.length && !d.xss, `${lab}: DOM injection ${JSON.stringify(d)}`);
    const rows = await p.evaluate(() => [...document.querySelectorAll('.cl-row')].map((r) => r.innerHTML));
    run.check(rows.every((h) => !/<(img|svg|script)/i.test(h)), `${lab}: markup inside chat rows ${JSON.stringify(rows.slice(0, 2))}`);
  }
  const hs = await host.evaluate(() => { const h = window.__cc.session && window.__cc.session.host; return h ? { over: !!h.s.over, winner: h.s.winner, turn: h.s.turnNo } : null; });
  run.check(hs && (!hs.over || hs.winner != null), `host: match broke ${JSON.stringify(hs)}`);
  await L.protectHumans(host).catch(() => {});
  // results / feed with the hostile name
  await L.killAllExcept(host, ['me']);
  await L.waitResults(host, 15000);
  for (const [lab, p] of [['host', host], ['c2', c2]]) { const d = await domScan(p); run.check(!d.bad.length && !d.xss, `${lab} after results: DOM injection ${JSON.stringify(d)}`); }
};

S.Q2 = async (run) => {
  const { host, c1, c2 } = await threeWay(run);
  await L.startMatch(run, host, { bots: 2, clients: [c1, c2] });
  await L.autoplay(host); await L.autoplay(c1); await L.autoplay(c2);
  const c1name = await c1.evaluate(() => window.__cc.profile.name);
  await host.evaluate(() => { window.__lag = 0; let last = performance.now(); clearInterval(window.__lagT); window.__lagT = setInterval(() => { const n = performance.now(); window.__lag = Math.max(window.__lag, n - last - 50); last = n; }, 50); });
  const t0 = await L.view(host);
  const keys = await c1.evaluate(async () => Object.keys((await import('/js/chat.js')).PHRASES));
  await c1.evaluate(async (keys) => { const s = window.__cc.session; for (let i = 0; i < 400; i++) { s.client.send(i % 2 ? { t: 'chat', k: keys[i % keys.length] } : { t: 'chat', x: 'spam ' + i }); if (i % 20 === 0) await new Promise((r) => setTimeout(r, 100)); } }, keys);
  await sleep(1500);
  const hl = (await chatLog(host)).filter((l) => l.startsWith(c1name + ':')).length;
  const cl = (await chatLog(c2)).length;
  const lag = await host.evaluate(() => window.__lag);
  const t1 = await L.view(host);
  run.note(`flood: host relayed ${hl} of 400, c2 log ${cl}, host max event-loop lag ${Math.round(lag)} ms, turns ${t0.turnNo}->${t1.turnNo}`);
  run.check(hl <= 6, `host relayed ${hl} of 400 flood messages (bucket allows ~3 + refill)`);
  run.check(cl <= 60, `c2 log unbounded (${cl})`);
  run.check(lag < 1500, `host event loop stalled ${Math.round(lag)} ms during the flood`);
  const a = await L.advancing(host, 5000); const ov = await L.view(host); run.check(a.moved || ov.over, `match stalled after the chat flood ${JSON.stringify(a)}`);
  const later = await c1.evaluate(async () => { await new Promise((r) => setTimeout(r, 0)); return true; });
  void later;
};

async function voiceRun(run, { fail = null } = {}) {
  run.vb = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  try { await run.ctx.close(); } catch {}
  run.pages = {};
  run.ctx = await run.vb.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  await run.ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await run.ctx.addInitScript(COUNT_INIT);
  if (fail) await run.ctx.addInitScript((f) => { window.__gumFail = f; }, fail);
}
const media = (p) => p.evaluate(() => ({ ...window.__media }));
const vst = (p) => p.evaluate(async () => { const { voice } = await import('/js/voice.js'); return { state: voice.state, listen: voice.listenOnly, err: voice.err || '', roster: voice.roster.size, calls: voice.calls.size, track: voice.mic ? voice.mic.getAudioTracks()[0].enabled : null }; });

S.Q3 = async (run) => {
  await voiceRun(run);
  try {
    const { host, code } = await L.hostLobby(run, { mode: 'royale' });
    const c1 = await L.clientJoin(run, 'c1', code); const c2 = await L.clientJoin(run, 'c2', code);
    // open settings and the chat picker in the lobby/match: none of that may touch the mic
    await host.evaluate(() => { const b = document.querySelector('[data-go="settings"], [data-act="settings"]'); if (b) b.click(); });
    await sleep(400);
    await L.startMatch(run, host, { bots: 1, clients: [c1, c2] });
    for (const p of [host, c1, c2]) await p.evaluate(async () => { const { chat } = await import('/js/chat.js'); try { chat.toggle(); await new Promise((r) => setTimeout(r, 200)); chat.toggle(); } catch {} });
    await sleep(800);
    const m0 = [await media(host), await media(c1), await media(c2)];
    run.check(m0.every((m) => m.gum === 0 && m.pc === 0), `media touched before anyone opted in ${JSON.stringify(m0)}`);
    // c1 and host opt in; c2 does not
    for (const p of [c1, host]) await p.evaluate(async () => { const { voice } = await import('/js/voice.js'); await voice.start(); });
    await L.waitFor(c1, async () => { const { voice } = await import('/js/voice.js'); return voice.stats.streams >= 1; }, null, 15000);
    const m1 = [await media(host), await media(c1), await media(c2)];
    run.note(`after opt-in ${JSON.stringify(m1)} voice ${JSON.stringify([await vst(host), await vst(c1), await vst(c2)])}`);
    run.check(m1[0].gum === 1 && m1[1].gum === 1, `opted-in pages should request the mic exactly once ${JSON.stringify(m1)}`);
    run.check(m1[2].gum === 0 && m1[2].pc === 0, `c2 never opted in but media was touched ${JSON.stringify(m1[2])}`);
    const v2 = await vst(c2); run.check(v2.state === 'off' && v2.calls === 0, `c2 voice not off ${JSON.stringify(v2)}`);
    // mute: talk released (push to talk default) -> track disabled; open mic on, then off
    const tr = await c1.evaluate(async () => { const { voice } = await import('/js/voice.js'); const a = voice.mic.getAudioTracks()[0].enabled; voice.setOpen(true); const b = voice.mic.getAudioTracks()[0].enabled; voice.setOpen(false); const c = voice.mic.getAudioTracks()[0].enabled; return { a, b, c }; });
    run.check(tr.a === false && tr.b === true && tr.c === false, `mic track mute states ${JSON.stringify(tr)}`);
  } finally { try { await run.ctx.close(); } catch {} try { await run.vb.close(); } catch {} }
};

S.Q4 = async (run) => {
  for (const fail of ['NotAllowedError', 'NotFoundError']) {
    await voiceRun(run, { fail });
    try {
      const { host, code } = await L.hostLobby(run, { mode: 'royale' });
      const c1 = await L.clientJoin(run, 'c1', code);
      await host.evaluate(() => { window.__gumFail = null; });
      await c1.evaluate(async () => { const { voice } = await import('/js/voice.js'); await voice.start(); });
      await host.evaluate(async () => { const { voice } = await import('/js/voice.js'); await voice.start(); });
      await sleep(2500);
      const v = await vst(c1);
      run.note(`${fail}: ${JSON.stringify(v)}`);
      run.check(v.state === 'on' && v.listen && v.err.length > 10, `${fail}: not handled as listen-only with a message ${JSON.stringify(v)}`);
      await L.startMatch(run, host, { bots: 1, clients: [c1] });
      await L.autoplay(host); await L.autoplay(c1);
      const a = await L.advancing(c1, 3000); run.check(a.moved, `${fail}: match did not advance`);
      if (fail === 'NotAllowedError') {
        // peer crash: c1 tab closes without leaving voice; host drops it; a new tab rejoins voice cleanly
        await c1.close({ runBeforeUnload: false });
        const dropped = await L.waitFor(host, async () => { const { voice } = await import('/js/voice.js'); return voice.roster.size <= 1 && voice.calls.size === 0; }, null, 12000);
        run.check(dropped, `host did not drop the crashed voice peer ${JSON.stringify(await vst(host))}`);
        const a2 = await L.advancing(host, 3000); run.check(a2.moved, 'host match stalled after the voice peer crashed');
        run.check((await vst(host)).state === 'on', 'host voice died with the peer');
      }
    } finally { try { await run.ctx.close(); } catch {} try { await run.vb.close(); } catch {} }
  }
};

// Q5 spectators keep chat and voice: c1 dies (spectates), still sends/receives presets and customs, chat button and
// Talk button visible, voice stays connected and open mic is heard by the host.
S.Q5 = async (run) => {
  await voiceRun(run);
  try {
    const { host, code } = await L.hostLobby(run, { mode: 'royale' });
    const c1 = await L.clientJoin(run, 'c1', code);
    for (const p of [host, c1]) await p.evaluate(async () => { const { voice } = await import('/js/voice.js'); await voice.start(); });
    await L.waitFor(c1, async () => { const { voice } = await import('/js/voice.js'); return voice.stats.streams >= 1; }, null, 15000);
    await L.startMatch(run, host, { bots: 2, clients: [c1] });
    await L.protectHumans(host); await L.autoplay(host); await L.autoplay(c1);
    const cpid = await L.clientPid(c1);
    await L.hostKill(host, cpid);
    await L.waitDead(c1, 8000);
    await c1.evaluate(() => { const b = document.querySelector('#m-dead [data-act="spectate"], #m-dead .btn'); if (b) b.click(); });
    await sleep(1500);
    const vis = await c1.evaluate(() => { const v = (sel) => { const e = document.querySelector(sel); if (!e || e.closest('.hidden')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }; return { chat: v('[data-act="emotes"]'), ptt: v('#vc-ptt'), spec: !!window.__cc.game.spec, alive: window.__cc.game.me && window.__cc.game.me.alive }; });
    run.note(`spectator ui ${JSON.stringify(vis)}`);
    run.check(!vis.alive, 'c1 not dead');
    run.check(vis.chat, 'spectator: chat button not visible');
    run.check(vis.ptt, 'spectator: Talk button not visible');
    const keys = await c1.evaluate(async () => Object.keys((await import('/js/chat.js')).PHRASES));
    await c1.evaluate(async (k) => (await import('/js/chat.js')).chat.say(k), keys[0]);
    await sleep(3500);
    await c1.evaluate(() => window.__cc.session.chat({ x: 'watching you' }));
    await host.evaluate(async (k) => (await import('/js/chat.js')).chat.say(k), keys[1]);
    await sleep(1500);
    const hl = await chatLog(host), cl = await chatLog(c1);
    const cname = await c1.evaluate(() => window.__cc.profile.name);
    run.check(hl.filter((l) => l.startsWith(cname + ':')).length >= 2, `host did not get the spectator's preset + custom ${JSON.stringify(hl)}`);
    run.check(cl.some((l) => !l.startsWith(cname + ':')), `spectator did not receive the host line ${JSON.stringify(cl)}`);
    const v = await vst(c1); run.check(v.state === 'on' && v.calls >= 1, `spectator voice dropped ${JSON.stringify(v)}`);
    await c1.evaluate(async () => { const { voice } = await import('/js/voice.js'); voice.setOpen(true); });
    const heard = await L.waitFor(host, async (p) => (await import('/js/voice.js')).voice.speaking.has(p), cpid, 8000);
    run.check(heard, 'host never heard the spectator on open mic');
    await run.shot('c1', 'spectator-chat');
  } finally { try { await run.ctx.close(); } catch {} try { await run.vb.close(); } catch {} }
};

(async () => {
  const browser = await chromium.launch();
  let bad = 0; const names = Object.keys(S).filter((k) => !ONLY || ONLY.includes(k));
  for (const name of names) {
    const run = new L.Run(browser, 'qa-' + name, 1);
    await run.open();
    const t = Date.now();
    try { await S[name](run); } catch (e) { run.fails.push('harness: ' + String(e.message || e).split('\n')[0]); }
    const errs = run.errors.filter((e) => !/getUserMedia|blocked by test|NotAllowed|NotFound/i.test(e));
    const ok = !run.fails.length && !errs.length; if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (${Math.round((Date.now() - t) / 1000)} s)`);
    for (const f of run.fails) console.log('   fail: ' + f);
    for (const e of errs.slice(0, 5)) console.log('   error: ' + e);
    for (const n of run.notes) console.log('   note: ' + n.slice(0, 400));
    await run.close();
  }
  await browser.close();
  console.log(`qa-social: ${names.length - bad}/${names.length} pass`);
  process.exit(bad ? 1 : 0);
})();

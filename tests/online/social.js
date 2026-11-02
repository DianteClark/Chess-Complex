// 10.2 (N): quick chat and voice scenarios for the online suite. Registered by scenarios.js.
// Chat: presets, custom phrases, mute, preset-only filter, host rate limit, malicious payloads, team routing.
// Voice: signalling, mesh, push-to-talk indicators, mute, a dropped peer, and a denied microphone. Voice pages
// run in their own Chromium with fake media devices, so the real WebRTC media path is exercised over loopback.
module.exports = function register(S, { L, match, sleep, tap, autoplay }) {
  const chatLog = (p, who) => p.evaluate(async (who) => (await import('/js/chat.js')).chat.log.filter((l) => !who || l.name === who).map((l) => `${l.name}: ${l.text}`), who || null);
  const say = (p, ref) => p.evaluate(async (ref) => (await import('/js/chat.js')).chat.say(ref), ref);
  const raw = (p, m) => p.evaluate((m) => window.__cc.session.client.send(m), m);
  const unitOf = (p, pid) => p.evaluate((pid) => { const u = window.__cc.game.s.units.find((v) => v.pid === pid); return u && { id: u.id, name: u.name, team: u.team }; }, pid);
  const errorsOn = (run) => run.errors.length;

  // C1: presets both ways through the picker UI, bubble on the sender's piece, recent list updated, bots can talk
  S['C1-chat-presets'] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    await autoplay(host, false); await autoplay(c, false);
    const cu = await unitOf(host, cpid);
    await tap(c, '#s-game [data-act="emotes"]');
    run.check(await L.visible(c, '#emote-menu .qc-tabs'), 'c1: quick chat tabs not visible');
    const tabs = await c.evaluate(() => [...document.querySelectorAll('#emote-menu .qc-tab')].map((t) => t.textContent));
    run.check(tabs.includes('Tactics') && tabs.includes('Players') && tabs.includes('Log'), `c1: tabs ${tabs}`);
    await c.evaluate(() => document.querySelector('#emote-menu [data-tab="tactic"]').click()); await sleep(150);
    const n = await c.evaluate(() => document.querySelectorAll('#emote-menu .qc-p').length);
    run.check(n >= 15, `c1: only ${n} tactic phrases`);
    await run.shot('c1', 'picker');
    await c.evaluate(() => document.querySelector('#emote-menu [data-say="t.storm"]').click()); await sleep(700);
    const hl = await chatLog(host);
    run.check(hl.some((l) => l === `${cu.name}: Storm closing`), `host: did not get "Storm closing" ${JSON.stringify(hl)}`);
    const bub = await host.evaluate((id) => window.__cc.game.r.bubbles.some((b) => b.id === id && b.text === 'Storm closing'), cu.id);
    run.check(bub, 'host: no bubble over the sender piece');
    const rec = await c.evaluate(() => window.__cc.profile.chat.recent[0]);
    run.check(rec === 't.storm', `c1: recent[0] is ${rec}`);
    await sleep(1600);
    await say(host, 'k.gg'); await sleep(700);
    const cl = await chatLog(c);
    run.check(cl.some((l) => /: GG$/.test(l)), `c1: did not get host GG ${JSON.stringify(cl)}`);
    // store emote packs still work as phrase packs (legacy wire message too)
    await sleep(1600); await raw(c, { t: 'emote', k: 'gg' }); await sleep(600);
    run.check((await chatLog(host)).filter((l) => l === `${cu.name}: GG`).length >= 1, 'host: legacy emote message not shown');
    // bots speak curated lines only
    const bots = await host.evaluate(() => window.__cc.session.host.s.units.filter((u) => u.bot).map((u) => u.pid));
    const ok = await host.evaluate(async (pid) => { const C = await import('/js/chat.js'); const s = window.__cc.session.host.s; return !!C.hostCheck({}, pid, { k: 'r.nice' }, s) && !C.hostCheck({}, pid, { x: 'free text' }, s); }, bots[0]);
    run.check(ok, 'host: bot preset should pass and bot free text should be refused');
    run.check(!errorsOn(run), 'page errors');
  };

  // C2: custom phrases: written in the customise screen, cleaned on the host, rendered as text only; preset-only filter
  S['C2-chat-custom'] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    await autoplay(host, false); await autoplay(c, false);
    const cu = await unitOf(host, cpid);
    await tap(c, '#s-game [data-act="emotes"]');
    await c.evaluate(() => document.querySelector('#emote-menu [data-qc="custom"]').click()); await sleep(300);
    run.check(await L.visible(c, '#m-chat [data-ci="11"]'), 'c1: 12 custom phrase inputs not shown');
    await c.fill('#m-chat [data-ci="0"]', 'Nice <b>trap</b> lol');
    await c.press('#m-chat [data-ci="0"]', 'Tab'); await sleep(200);
    await c.fill('#m-chat [data-ci="1"]', 'go f u c k yourself <img src=x onerror="window.__pwn=1">');
    await c.press('#m-chat [data-ci="1"]', 'Tab'); await sleep(200);
    const stored = await c.evaluate(() => window.__cc.profile.chat.custom.slice(0, 2));
    run.check(stored[0] === 'Nice trap lol', `c1: stored custom 0 "${stored[0]}"`);
    run.check(!/[<>]/.test(stored[1]) && Array.from(stored[1]).length <= 40, `c1: stored custom 1 "${stored[1]}"`);
    run.check(await c.evaluate(() => !!document.querySelector('#m-chat .qcm-warn')), 'c1: no "Others will see" preview for a masked phrase');
    await run.shot('c1', 'customise');
    await c.evaluate(() => document.querySelector('#qcm-done').click()); await sleep(200);
    await say(c, 'c:0'); await sleep(700);
    let hl = await chatLog(host);
    run.check(hl.includes(`${cu.name}: Nice trap lol`), `host: custom 0 missing ${JSON.stringify(hl)}`);
    await sleep(3200); await say(c, 'c:1'); await sleep(700);
    hl = await chatLog(host, cu.name);
    const last = hl[hl.length - 1] || '';
    run.check(/\* \* \* \*/.test(last) && !/fuck|f u c k/i.test(last), `host: profanity not masked "${last}"`);
    const pwn = await host.evaluate(() => ({ pwn: window.__pwn, img: document.querySelectorAll('img[src="x"]').length }));
    run.check(!pwn.pwn && !pwn.img, `host: markup executed ${JSON.stringify(pwn)}`);
    // preset only: host hides typed phrases from others but still shows presets
    await host.evaluate(async () => { const { settings } = await import('/js/audio.js'); settings.chatPresetOnly = true; });
    const before = (await chatLog(host, cu.name)).length;
    await sleep(3200); await say(c, 'c:0'); await sleep(700);
    run.check((await chatLog(host, cu.name)).length === before, 'host: preset-only did not hide a custom phrase');
    await sleep(1600); await say(c, 'r.wow'); await sleep(700);
    run.check((await chatLog(host, cu.name)).length === before + 1, 'host: preset-only hid a preset phrase');
    await host.evaluate(async () => { const { settings } = await import('/js/audio.js'); settings.chatPresetOnly = false; });
    run.check(!errorsOn(run), 'page errors');
  };

  // C3: per-player mute from the Players tab
  S['C3-chat-mute'] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    await autoplay(host, false); await autoplay(c, false);
    await tap(host, '#s-game [data-act="emotes"]');
    await host.evaluate(() => document.querySelector('#emote-menu [data-tab="players"]').click()); await sleep(200);
    run.check(await L.visible(host, `#emote-menu [data-mute="${cpid}"]`), 'host: no mute button for c1');
    await host.evaluate((pid) => document.querySelector(`#emote-menu [data-mute="${pid}"]`).click(), cpid); await sleep(150);
    await run.shot('host', 'players-tab');
    const cname = (await unitOf(host, cpid)).name;
    const n0 = (await chatLog(host, cname)).length;
    await say(c, 'g.hi'); await sleep(700);
    run.check((await chatLog(host, cname)).length === n0, 'host: muted player still shown');
    run.check((await chatLog(c)).some((l) => /Hello!$/.test(l)), 'c1: own message not shown locally');
    await host.evaluate((pid) => document.querySelector(`#emote-menu [data-mute="${pid}"]`).click(), cpid); await sleep(1600);
    await say(c, 'g.hey'); await sleep(700);
    run.check((await chatLog(host, cname)).length === n0 + 1, 'host: unmuted player not shown');
    run.check(!errorsOn(run), 'page errors');
  };

  // C4: the host enforces the rate limit even when a client bypasses its own UI throttle
  S['C4-chat-ratelimit'] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    await autoplay(host, false); await autoplay(c, false);
    const nm = (await unitOf(host, cpid)).name, count = async () => (await chatLog(host, nm)).length;
    const n0 = await count();
    await c.evaluate(() => { for (const k of ['r.nice', 'r.wow', 'r.ouch', 'r.phew', 'r.lucky']) window.__cc.session.client.send({ t: 'chat', k }); });
    await sleep(900);
    const got = (await count()) - n0;
    run.check(got === 3, `host relayed ${got} of 5 burst lines (expected 3)`);
    const slow = await c.evaluate(() => (window.__toasts || []).some((t) => /Slow down/i.test(t)));
    run.check(slow, 'c1: no "Slow down" feedback');
    // customs: at most one per 3 s
    await sleep(5000);
    await c.evaluate(() => { const s = window.__cc.session.client; s.send({ t: 'chat', x: 'first one' }); s.send({ t: 'chat', x: 'second one' }); });
    await sleep(600);
    const tail = (await chatLog(host, nm)).slice(-1)[0] || '';
    run.check(/first one$/.test(tail), `host: custom throttle tail "${tail}"`);
    // the same line twice inside 8 s is dropped
    await sleep(3200); const n1 = await count();
    await raw(c, { t: 'chat', k: 'k.wp' }); await sleep(1600); await raw(c, { t: 'chat', k: 'k.wp' }); await sleep(600);
    run.check((await count()) - n1 === 1, 'host: duplicate line not dropped');
    // persistent spam earns a 20 s timeout
    await c.evaluate(() => { const s = window.__cc.session.client; for (let i = 0; i < 20; i++) s.send({ t: 'chat', k: 'k.gg' }); });
    await sleep(4600);
    const n2 = await count(); await raw(c, { t: 'chat', k: 'k.ty' }); await sleep(600);
    run.check((await count()) === n2, 'host: spammer not timed out');
    run.check(!errorsOn(run), 'page errors');
  };

  // C5: malicious payloads to the host and from a (simulated) malicious host to a client
  S['C5-chat-malicious'] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    await autoplay(host, false); await autoplay(c, false);
    const hu = await unitOf(host, 'me'), cu = await unitOf(host, cpid);
    const bad = [
      { t: 'chat' }, { t: 'chat', k: '__proto__' }, { t: 'chat', k: 'constructor' }, { t: 'chat', k: 'toString' }, { t: 'chat', k: 123 }, { t: 'chat', k: ['k.gg'] },
      { t: 'chat', x: 'A'.repeat(5000) }, { t: 'chat', x: { toString: 1 } }, { t: 'chat', x: '   ' }, { t: 'chat', x: '<script>' }, { t: 'chat', x: '‮​\u0000' },
      { t: 'chat', a: 'slow' }, { t: 'chat', k: 'k.gg', id: hu.id, pid: 'me', tm: 1 }, null, 'chat', 42,
      { t: 'vc', a: 'join', vid: '<img src=x>' }, { t: 'vc', a: 'join', vid: 'x'.repeat(200) }, { t: 'vc', a: 'talk', on: 1 }, { t: 'vc', a: 'roster', list: [{ pid: 'me', vid: 'evil-peer-1' }] }, { t: 'vc' }, { t: 'vc', a: { x: 1 } },
    ];
    for (const m of bad) { await c.evaluate((m) => window.__cc.session.client.send(m), m); await sleep(30); }
    await sleep(800);
    const hl = await chatLog(host, cu.name);
    run.check(hl.length === 1 && hl[0] === `${cu.name}: GG`, `host log after malicious burst ${JSON.stringify(hl)}`);
    const roster = await host.evaluate(() => [...(window.__cc.session.vc || new Map())].length);
    run.check(roster === 0, `host: voice roster accepted junk (${roster})`);
    run.check(await host.evaluate(() => !!window.__cc.session.host && !window.__cc.session.host.s.over), 'host: match broke');
    // a malicious host: the client re-validates everything it receives
    const r = await c.evaluate(async ([hid, cid]) => {
      const { chat } = await import('/js/chat.js'); const n0 = chat.log.length;
      chat.receive({ t: 'chat', id: hid, pid: 'me', x: '<img src=x onerror="window.__pwn=1">ok' });
      chat.receive({ t: 'chat', id: hid, pid: 'someone-else', k: 'k.gg' });
      chat.receive({ t: 'chat', id: hid, pid: 'me', k: '__proto__' });
      chat.receive({ t: 'chat', id: 99999, pid: 'me', k: 'k.gg' });
      chat.receive({ t: 'chat', id: hid, pid: 'me', x: 'B'.repeat(900) });
      chat.receive(null); chat.receive('x');
      const { voice } = await import('/js/voice.js');
      voice.onMsg({ t: 'vc', a: 'roster', list: [{ pid: 'me', vid: '<bad>' }, { pid: 5, vid: 'abcdefgh' }, 'x', null] });
      return { added: chat.log.slice(n0).map((l) => l.text), img: document.querySelectorAll('img[src="x"]').length, pwn: !!window.__pwn, roster: voice.roster.size };
    }, [hu.id, cu.id]);
    run.check(r.added.length === 1 && r.added[0] === 'ok' && !r.img && !r.pwn, `c1: malicious host payloads ${JSON.stringify(r)}`);
    run.check(r.roster === 0, `c1: junk roster accepted ${r.roster}`);
    run.check(!errorsOn(run), 'page errors');
  };

  // C6: Squads team-only callouts reach teammates only
  S['C6-chat-team'] = async (run) => {
    const { host, cs, cpids } = await match(run, { mode: 'squads', clients: 2, bots: 1 });
    for (const p of [host, ...cs]) await autoplay(p, false);
    const [c1, c2] = cs;
    const t = { host: (await unitOf(host, 'me')).team, c1: (await unitOf(host, cpids[0])).team, c2: (await unitOf(host, cpids[1])).team };
    run.note(`teams ${JSON.stringify(t)}`);
    run.check(t.host === t.c1 && t.c2 !== t.host, `unexpected team layout ${JSON.stringify(t)}`);
    await tap(c1, '#s-game [data-act="emotes"]');
    const tabs = await c1.evaluate(() => [...document.querySelectorAll('#emote-menu .qc-tab')].map((x) => x.textContent));
    run.check(tabs.includes('Squad'), `c1: no Squad tab in Squads ${tabs}`);
    await c1.evaluate(() => document.querySelector('#emote-menu [data-tab="team"]').click()); await sleep(150);
    await c1.evaluate(() => document.querySelector('#emote-menu [data-say="s.revive"]').click()); await sleep(800);
    const h = await chatLog(host), o = await chatLog(c2);
    run.check(h.some((l) => /Revive me$/.test(l)), `host (teammate) missed the team callout ${JSON.stringify(h)}`);
    run.check(!o.some((l) => /Revive me$/.test(l)), `c2 (enemy) received a team callout ${JSON.stringify(o)}`);
    await sleep(1600); await say(c1, 'k.gg'); await sleep(700);
    run.check((await chatLog(c2)).some((l) => /GG$/.test(l)), 'c2: did not get an all-chat line');
    run.check(!errorsOn(run), 'page errors');
  };

  // ---------- voice ----------
  async function voiceCtx(run, { fake = true } = {}) {
    const args = ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'];
    args.push('--use-fake-device-for-media-stream');
    if (fake) args.push('--use-fake-ui-for-media-stream'); // without it (and without the permission) the mic request is denied
    run.vb = await L.chromium.launch({ args });
    try { await run.ctx.close(); } catch {}
    run.ctx = await run.vb.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: fake ? ['microphone'] : [] });
    await run.ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  }
  const vstate = (p) => p.evaluate(async () => { const { voice } = await import('/js/voice.js'); return { state: voice.state, listen: voice.listenOnly, roster: [...voice.roster.keys()], calls: voice.calls.size, streams: voice.stats.streams, speaking: [...voice.speaking], err: voice.err, ptt: !document.querySelector('#vc-ptt').classList.contains('hidden') }; });
  const waitV = (p, fn, arg, ms = 12000) => L.waitFor(p, fn, arg, ms);

  S['V1-voice-mesh'] = async (run) => {
    await voiceCtx(run);
    try {
      const { host, code } = await L.hostLobby(run, { mode: 'royale' });
      const c = await L.clientJoin(run, 'c1', code);
      const cpid = await L.clientPid(c);
      await sleep(400);
      // never auto-enabled
      const s0 = [await vstate(host), await vstate(c)];
      run.check(s0.every((s) => s.state === 'off' && !s.calls), `voice not off by default ${JSON.stringify(s0)}`);
      run.check(await L.visible(c, '#vc-join [data-vc="join"]') && await L.visible(host, '#vc-host [data-vc="join"]'), 'Join Voice not offered in both lobbies');
      await tap(c, '#vc-join [data-vc="join"]');
      run.check(await waitV(host, async (p) => (await import('/js/voice.js')).voice.roster.has(p), cpid, 6000), 'host: roster never listed c1');
      await tap(host, '#vc-host [data-vc="join"]');
      const linked = await waitV(c, async () => { const { voice } = await import('/js/voice.js'); return voice.stats.streams >= 1; }, null, 12000)
        && await waitV(host, async () => { const { voice } = await import('/js/voice.js'); return voice.stats.streams >= 1; }, null, 6000);
      const vs = [await vstate(host), await vstate(c)];
      run.note(`voice after join ${JSON.stringify(vs)}`);
      run.check(linked, 'media streams never arrived on both sides (signalling or loopback WebRTC failed)');
      run.check(vs.every((s) => s.roster.length === 2 && !s.listen), `roster/listen state ${JSON.stringify(vs)}`);
      // push to talk on the lobby Hold to Talk button -> speaking indicator on the host's lobby card
      const box = await c.locator('#vc-join .vc-hold').boundingBox();
      await c.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await c.mouse.down();
      const lit = await waitV(host, (p) => !!document.querySelector(`#host-lobby .pcard[data-pid="${p}"].speaking`), cpid, 3000);
      const micOn = await c.evaluate(async () => { const { voice } = await import('/js/voice.js'); return voice.mic && voice.mic.getAudioTracks()[0].enabled; });
      await run.shot('host', 'voice-speaking');
      await c.mouse.up();
      run.check(lit, 'host: no speaking indicator on c1 lobby card while c1 holds Talk');
      run.check(micOn, 'c1: mic track not enabled while holding Talk');
      const off = await waitV(host, (p) => !document.querySelector(`#host-lobby .pcard[data-pid="${p}"].speaking`), cpid, 3000);
      const micOff = await c.evaluate(async () => { const { voice } = await import('/js/voice.js'); return !voice.mic.getAudioTracks()[0].enabled; });
      run.check(off && micOff, `talk did not stop on release (indicator off ${off}, mic off ${micOff})`);
      // per-player mute and volume
      const g = await host.evaluate(async (p) => { const { voice } = await import('/js/voice.js'); voice.setVolume(p, 0.5); const e = [...voice.calls.values()].find((x) => x.pid === p); const a = e && e.gain ? e.gain.gain.value : null; voice.toggleMute(p); const b = e && e.gain ? e.gain.gain.value : null; voice.toggleMute(p); return { a, b }; }, cpid);
      run.check(g.a > 0.6 && g.a < 0.8 && g.b === 0, `host: volume/mute gains ${JSON.stringify(g)}`);
      // into the match: voice survives, Talk button in the HUD
      await L.startMatch(run, host, { bots: 2, clients: [c] });
      const vm = await vstate(c);
      run.check(vm.state === 'on' && vm.ptt, `c1: voice/talk button after match start ${JSON.stringify(vm)}`);
      await autoplay(host); await autoplay(c);
      // open mic toggle
      await c.evaluate(async () => { const { voice } = await import('/js/voice.js'); voice.setOpen(true); });
      const om = await c.evaluate(async () => { const { voice } = await import('/js/voice.js'); return voice.mic.getAudioTracks()[0].enabled && document.querySelector('#vc-ptt').classList.contains('open'); });
      run.check(om, 'c1: open mic did not enable the track');
      const heard = await waitV(host, async (p) => (await import('/js/voice.js')).voice.speaking.has(p), cpid, 6000);
      run.check(heard, 'host: never showed c1 speaking with open mic (fake device beep through real WebRTC audio)');
      await run.shot('host', 'voice-match');
      await c.evaluate(async () => { const { voice } = await import('/js/voice.js'); voice.setOpen(false); });
      // a peer drops: close the client tab, host drops the call and the match continues
      await c.close();
      const dropped = await waitV(host, async () => { const { voice } = await import('/js/voice.js'); return voice.roster.size === 1 && voice.calls.size === 0; }, null, 8000);
      run.check(dropped, `host: did not drop c1 from voice ${JSON.stringify(await vstate(host))}`);
      const a = await L.advancing(host, 3000); run.check(a.moved, 'host: match stalled after the voice peer dropped');
      await host.evaluate(async () => { const { voice } = await import('/js/voice.js'); voice.stop(); });
      run.check((await vstate(host)).state === 'off', 'host: Leave Voice did not stop voice');
      run.check(!errorsOn(run), 'page errors');
    } finally { try { await run.ctx.close(); } catch {} try { await run.vb.close(); } catch {} }
  };

  S['V2-voice-denied'] = async (run) => {
    await voiceCtx(run, { fake: false });
    try {
      const { host, code } = await L.hostLobby(run, { mode: 'royale' });
      const c = await L.clientJoin(run, 'c1', code);
      await tap(c, '#vc-join [data-vc="join"]');
      await waitV(c, async () => (await import('/js/voice.js')).voice.state === 'on', null, 8000);
      const s = await vstate(c);
      run.note(`denied mic: ${JSON.stringify(s)}`);
      run.check(s.state === 'on' && s.listen && /Microphone|microphone/.test(s.err), `c1: denied mic not handled as listen-only ${JSON.stringify(s)}`);
      run.check(await c.evaluate(() => /Microphone is blocked|Microphone is off|No microphone|cannot use the microphone|cannot share the microphone|using the microphone/.test(document.querySelector('#vc-join').innerText)), 'c1: no clear message in the lobby panel');
      await run.shot('c1', 'voice-denied');
      // the data connection and the game are unaffected
      await L.startMatch(run, host, { bots: 1, clients: [c] });
      await autoplay(host); await autoplay(c);
      const a = await L.advancing(c, 3000); run.check(a.moved, 'c1: match did not advance with a denied mic');
      run.check(!(await vstate(c)).ptt, 'c1: Talk button shown while listen-only');
      run.check(!errorsOn(run), 'page errors');
    } finally { try { await run.ctx.close(); } catch {} try { await run.vb.close(); } catch {} }
  };
};

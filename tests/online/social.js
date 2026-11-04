// 10.2 (N): quick chat and voice scenarios for the online suite. Registered by scenarios.js.
// 10.3 (N): C7 chat strip + history sheet; V2 denied mic and V3 allowed mic through the pre-permission card, both as an
// emulated iPhone Home Screen app (see voiceCtx).
// Chat: presets, custom phrases, mute, preset-only filter, host rate limit, malicious payloads, team routing.
// Voice: signalling, mesh, push-to-talk indicators, mute, a dropped peer, and a denied microphone. Voice pages
// run in their own Chromium with fake media devices, so the real WebRTC media path is exercised over loopback.
module.exports = function register(S, { L, match: match0, sleep, tap, autoplay }) {
  // 15.0: the first open of the picker asks for favourites (C8 covers that); the other chat tests start set up
  const skipSetup = (p) => p.evaluate(async () => { const C = await import('/js/chat.js'); C.ensureChat(window.__cc.profile).setup = true; });
  const match = async (run, o) => { const r = await match0(run, o); for (const p of Object.values(run.pages)) if (!p.isClosed()) await skipSetup(p); return r; };
  const chatLog = (p, who) => p.evaluate(async (who) => (await import('/js/chat.js')).chat.log.filter((l) => !who || l.name === who).map((l) => `${l.name}: ${l.text}`), who || null);
  const say = (p, ref) => p.evaluate(async (ref) => (await import('/js/chat.js')).chat.say(ref), ref);
  const raw = (p, m) => p.evaluate((m) => window.__cc.session.client.send(m), m);
  const unitOf = (p, pid) => p.evaluate((pid) => { const ss = window.__cc.session; if (pid === 'me' && ss && ss.cloud) pid = ss.myPid; /* 17.0 (N2): cloud leader */ const u = window.__cc.game.s.units.find((v) => v.pid === pid); return u && { id: u.id, name: u.name, team: u.team, pid: u.pid }; }, pid);
  const errorsOn = (run) => run.errors.length;

  // C1: presets both ways through the picker UI, bubble on the sender's piece, recent list updated, bots can talk
  S['C1-chat-presets'] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    await autoplay(host, false); await autoplay(c, false);
    const cu = await unitOf(host, cpid);
    await tap(c, '#s-game [data-act="emotes"]');
    run.check(await L.visible(c, '#emote-menu .qc-tabs'), 'c1: quick chat tabs not visible');
    const tabs = await c.evaluate(() => [...document.querySelectorAll('#emote-menu .qc-tab')].map((t) => t.textContent));
    run.check(tabs[0] === 'Favourites' && tabs.includes('All Phrases') && tabs.includes('Players') && tabs.includes('Log'), `c1: tabs ${tabs}`);
    run.check(await c.evaluate(() => document.querySelector('#emote-menu .qc-tab.on').dataset.tab === 'fav' && document.querySelectorAll('#emote-menu .qc-p').length === 8), 'c1: picker did not open on 8 favourites');
    await c.evaluate(() => document.querySelector('#emote-menu [data-tab="all"]').click()); await sleep(150);
    const heads = await c.evaluate(() => [...document.querySelectorAll('#emote-menu .qc-h')].map((h) => h.textContent));
    run.check(heads.includes('Hello') && heads.includes('Tactics') && heads.includes('GG'), `c1: All Phrases sections ${heads}`);
    await c.evaluate(() => document.querySelector('#emote-menu .qc-cat[data-tab="tactic"]').click()); await sleep(150);
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
    const bots = await host.evaluate(() => window.__ccHost().s.units.filter((u) => u.bot).map((u) => u.pid));
    const ok = await host.evaluate(async (pid) => { const C = await import('/js/chat.js'); const s = window.__ccHost().s; return !!C.hostCheck({}, pid, { k: 'r.nice' }, s) && !C.hostCheck({}, pid, { x: 'free text' }, s); }, bots[0]);
    run.check(ok, 'host: bot preset should pass and bot free text should be refused');
    run.check(!errorsOn(run), 'page errors');
  };

  // C8 (15.0): first open asks for favourites (6-10, default 8); the picker then opens on them; Edit Favourites; All Phrases
  S['C8-chat-favourites'] = async (run) => {
    const { host, c } = await match0(run, { bots: 2 });
    await autoplay(host, false); await autoplay(c, false);
    await skipSetup(host);
    const st = () => c.evaluate(() => { const m = document.querySelector('#emote-menu'), q = (s) => m.querySelector(s); return { open: !m.classList.contains('hidden'), pick: m.classList.contains('qc-picking'), head: (q('.qc-pick-h b') || {}).textContent || '', n: (q('.qc-pick-n') || {}).textContent || '', done: q('[data-qc="pick-done"]') ? { dis: q('[data-qc="pick-done"]').disabled, txt: q('[data-qc="pick-done"]').textContent } : null, tab: (q('.qc-tab.on') || { dataset: {} }).dataset.tab, phrases: [...m.querySelectorAll('.qc-body [data-say]')].map((b) => b.dataset.say), setup: window.__cc.profile.chat && window.__cc.profile.chat.setup, fav: window.__cc.profile.chat && window.__cc.profile.chat.fav }; });
    await tap(c, '#s-game [data-act="emotes"]'); await sleep(200);
    let v = await st();
    run.check(v.open && v.pick && /Pick your favourites/.test(v.head), `c1: first open did not ask for favourites ${JSON.stringify(v)}`);
    run.check(v.done && !v.done.dis && v.n === '8 / 10', `c1: chooser should start from the 8 suggested ${JSON.stringify(v)}`);
    await run.shot('c1', 'fav-setup');
    // clear the suggestions, then pick 5 (not enough), then 7
    for (const r of v.fav.filter(Boolean)) await c.evaluate((r) => document.querySelector(`#emote-menu [data-tog="${r}"]`).click(), r);
    const pickList = ['t.king', 't.help', 'r.wow', 'r.clutch', 'x.check', 'k.ggwp', 'g.hi'];
    for (const r of pickList.slice(0, 5)) await c.evaluate((r) => document.querySelector(`#emote-menu [data-tog="${r}"]`).click(), r);
    v = await st(); run.check(v.done.dis && /Pick 1 more/.test(v.done.txt), `c1: Done enabled with 5 ${JSON.stringify(v.done)}`);
    for (const r of pickList.slice(5)) await c.evaluate((r) => document.querySelector(`#emote-menu [data-tog="${r}"]`).click(), r);
    v = await st(); run.check(!v.done.dis && v.n === '7 / 10', `c1: Done should be on with 7 ${JSON.stringify(v)}`);
    await c.evaluate(() => document.querySelector('#emote-menu [data-qc="pick-done"]').click()); await sleep(200);
    v = await st();
    run.check(v.setup && v.tab === 'fav' && JSON.stringify(v.phrases) === JSON.stringify(pickList), `c1: favourites view ${JSON.stringify(v)}`);
    // closing and reopening goes straight to the favourites
    await c.evaluate(() => document.querySelector('#emote-menu [data-qc="close"]').click()); await sleep(150);
    await tap(c, '#s-game [data-act="emotes"]'); await sleep(200);
    v = await st(); run.check(!v.pick && v.tab === 'fav' && v.phrases.length === 7, `c1: reopen ${JSON.stringify(v)}`);
    // 10 is the cap
    await c.evaluate(() => document.querySelector('#emote-menu [data-qc="favs"]').click()); await sleep(150);
    for (const r of ['t.storm', 't.omw', 't.ult', 't.low']) await c.evaluate((r) => document.querySelector(`#emote-menu [data-tog="${r}"]`).click(), r);
    v = await st(); run.check(v.n === '10 / 10', `c1: cap at 10 ${v.n}`);
    await c.evaluate(() => document.querySelector('#emote-menu [data-qc="pick-cancel"]').click()); await sleep(150);
    v = await st(); run.check(v.phrases.length === 7, `c1: cancel changed favourites ${v.phrases.length}`);
    // a favourite says the phrase to the host
    await c.evaluate(() => document.querySelector('#emote-menu [data-say="t.king"]').click()); await sleep(700);
    const hl = await host.evaluate(async () => (await import('/js/chat.js')).chat.log.map((l) => l.text));
    run.check(hl.includes('Go for the King'), `host did not get the favourite ${JSON.stringify(hl)}`);
    // All Phrases: organised by category, chips filter
    await sleep(1600); await tap(c, '#s-game [data-act="emotes"]'); await sleep(150);
    await c.evaluate(() => document.querySelector('#emote-menu [data-tab="all"]').click()); await sleep(150);
    const all = await c.evaluate(() => ({ heads: [...document.querySelectorAll('#emote-menu .qc-h')].map((h) => h.textContent), n: document.querySelectorAll('#emote-menu .qc-body [data-say]').length, chips: [...document.querySelectorAll('#emote-menu .qc-cat')].map((b) => b.textContent) }));
    run.note(`All Phrases: ${all.n} phrases, sections ${all.heads.join('/')}`);
    run.check(all.n >= 70 && all.heads.length >= 5 && all.chips[0] === 'All', `All Phrases view ${JSON.stringify(all)}`);
    await run.shot('c1', 'all-phrases');
    await c.evaluate(() => document.querySelector('#emote-menu .qc-cat[data-tab="thanks"]').click()); await sleep(150);
    const gg = await c.evaluate(() => ({ heads: [...document.querySelectorAll('#emote-menu .qc-h')].map((h) => h.textContent), n: document.querySelectorAll('#emote-menu .qc-body [data-say]').length }));
    run.check(gg.heads.length === 1 && gg.heads[0] === 'GG' && gg.n === 12, `GG chip ${JSON.stringify(gg)}`);
    // the slot count lives in Customise too (6-10)
    const favn = await c.evaluate(async () => { const C = (await import('/js/chat.js')).chat; C.close(); C.openModal(); const m = document.querySelector('#m-chat'); for (let i = 0; i < 6; i++) m.querySelector('[data-favn="-1"]').click(); const a = window.__cc.profile.chat.favN; for (let i = 0; i < 6; i++) m.querySelector('[data-favn="1"]').click(); const b = window.__cc.profile.chat.favN; C.closeModal(); return [a, b, document.querySelectorAll('#qcm-favs .qcm-slot').length]; });
    run.check(favn[0] === 6 && favn[1] === 10 && favn[2] === 10, `Customise slot count ${favn}`);
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
      { t: 'chat', a: 'slow' }, { t: 'chat', k: 'k.gg', id: hu.id, pid: hu.pid, tm: 1 }, null, 'chat', 42,
      { t: 'vc', a: 'join', vid: '<img src=x>' }, { t: 'vc', a: 'join', vid: 'x'.repeat(200) }, { t: 'vc', a: 'talk', on: 1 }, { t: 'vc', a: 'roster', list: [{ pid: 'me', vid: 'evil-peer-1' }] }, { t: 'vc' }, { t: 'vc', a: { x: 1 } },
    ];
    for (const m of bad) { await c.evaluate((m) => window.__cc.session.client.send(m), m); await sleep(30); }
    await sleep(800);
    const hl = await chatLog(host, cu.name);
    run.check(hl.length === 1 && hl[0] === `${cu.name}: GG`, `host log after malicious burst ${JSON.stringify(hl)}`);
    const roster = await host.evaluate(() => [...(window.__cc.session.vc || new Map())].length);
    run.check(roster === 0, `host: voice roster accepted junk (${roster})`);
    run.check(await host.evaluate(() => !!window.__ccHost() && !window.__ccHost().s.over), 'host: match broke');
    // a malicious host: the client re-validates everything it receives
    const r = await c.evaluate(async ([hid, cid]) => {
      const { chat } = await import('/js/chat.js'); const n0 = chat.log.length;
      const hp = (window.__cc.game.s.units.find((u) => u.id === hid) || {}).pid || 'me'; // 'me' on PeerJS, the leader's seat id in the cloud
      chat.receive({ t: 'chat', id: hid, pid: hp, x: '<img src=x onerror="window.__pwn=1">ok' });
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
    await c1.evaluate(() => document.querySelector('#emote-menu [data-tab="all"]').click()); await sleep(150); // 15.0: categories are chips in All Phrases
    const chips = await c1.evaluate(() => [...document.querySelectorAll('#emote-menu .qc-cat')].map((x) => x.textContent));
    run.check(chips.includes('Squad'), `c1: no Squad category in Squads ${chips}`);
    await c1.evaluate(() => document.querySelector('#emote-menu .qc-cat[data-tab="team"]').click()); await sleep(150);
    await c1.evaluate(() => document.querySelector('#emote-menu [data-say="s.revive"]').click()); await sleep(800);
    const h = await chatLog(host), o = await chatLog(c2);
    run.check(h.some((l) => /Revive me$/.test(l)), `host (teammate) missed the team callout ${JSON.stringify(h)}`);
    run.check(!o.some((l) => /Revive me$/.test(l)), `c2 (enemy) received a team callout ${JSON.stringify(o)}`);
    await sleep(1600); await say(c1, 'k.gg'); await sleep(700);
    run.check((await chatLog(c2)).some((l) => /GG$/.test(l)), 'c2: did not get an all-chat line');
    run.check(!errorsOn(run), 'page errors');
  };

  // C7 (10.3): the chat strip (last 3 lines) and the full history sheet: colours, fade, HUD clearance, timestamps,
  // team marks, stick-to-bottom + "new messages" pill, plain text, 300-line cap, unread badge, mute, landscape, spectating
  S['C7-chat-log'] = async (run) => {
    const { host, c, cpid } = await match(run, { mode: 'squads', bots: 2 });
    await autoplay(host, false); await autoplay(c, false);
    const hu = await unitOf(host, 'me'), cu = await unitOf(host, cpid);
    const recv = (list) => c.evaluate(async (list) => { const { chat } = await import('/js/chat.js'); for (const m of list) chat.receive(m); }, list);
    const sheet = () => c.evaluate(() => { const s = document.querySelector('#chat-sheet'), l = s.querySelector('.cs-list'); return { open: !s.classList.contains('hidden'), rows: l.querySelectorAll('.cs-row').length, bottom: l.scrollHeight - l.scrollTop - l.clientHeight < 24, top: l.scrollTop, pill: !s.querySelector('.cs-new').classList.contains('hidden'), last: (l.lastElementChild || {}).textContent || '', rect: s.getBoundingClientRect().toJSON() }; });
    const badge = () => c.evaluate(() => { const b = document.querySelector('.emote-btn .qc-badge'); return b ? b.textContent : ''; });
    for (const k of ['g.hi', 't.storm', 'r.nice', 'k.wp']) { await say(host, k); await sleep(1600); }
    await c.waitForFunction(() => !document.querySelector('#chat-log').classList.contains('yield'), null, { timeout: 8000 }).catch(() => {});
    const st = await c.evaluate(() => { const L = document.querySelector('#chat-log'); const rows = [...L.querySelectorAll('.cl-row')]; return { n: rows.length, txt: rows.map((r) => r.textContent), color: rows.map((r) => r.querySelector('b').style.color), op: rows.map((r) => +getComputedStyle(r).opacity), rect: L.getBoundingClientRect().toJSON() }; });
    run.note(`strip ${JSON.stringify(st.txt)} opacity ${st.op}`);
    run.check(st.n === 3 && /Storm closing$/.test(st.txt[0]) && /Well played$/.test(st.txt[2]), `strip should show the last 3 lines ${JSON.stringify(st.txt)}`);
    run.check(st.color.every((x) => x), 'strip: sender names not coloured');
    run.check(st.op[0] < st.op[2], `strip: older lines not faded ${st.op}`);
    const hud = await c.evaluate(() => { const r = (s) => { const e = document.querySelector(s); return e && e.offsetParent ? e.getBoundingClientRect().toJSON() : null; }; return { hb: r('.hud-bottom'), ult: r('#ult-btn'), top: r('.hud-top') }; });
    const hit = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    run.check(!hit(st.rect, hud.hb) && !hit(st.rect, hud.ult) && !hit(st.rect, hud.top), `strip overlaps the HUD ${JSON.stringify({ strip: st.rect, ...hud })}`);
    await run.shot('c1', 'chat-strip');
    // tap the strip -> history sheet with timestamps
    await tap(c, '#chat-log .cl-row:last-child').catch(() => c.evaluate(() => document.querySelector('#chat-log .cl-row:last-child').click()));
    await sleep(300);
    let sh = await sheet();
    run.check(sh.open && sh.rows >= 4, `tapping the strip did not open the full log ${JSON.stringify(sh)}`);
    run.check(await c.evaluate(() => [...document.querySelectorAll('#chat-sheet .cs-row time')].every((t) => /\d/.test(t.textContent))), 'sheet: rows without timestamps');
    // a team-only line is marked
    await say(c, 's.revive'); await sleep(900);
    run.check(await c.evaluate(() => !!document.querySelector('#chat-sheet .cs-row.tm .qc-tm')), 'sheet: team-only line not marked');
    // stick to the bottom, then the "new messages" pill when scrolled up
    await recv(Array.from({ length: 40 }, (_, i) => ({ t: 'chat', id: hu.id, pid: hu.pid, k: i % 2 ? 'r.nice' : 'r.wow' }))); await sleep(200);
    sh = await sheet(); run.check(sh.bottom && !sh.pill, `sheet did not stay at the bottom ${JSON.stringify(sh)}`);
    await c.evaluate(() => { document.querySelector('#chat-sheet .cs-list').scrollTop = 0; }); await sleep(150);
    await recv([{ t: 'chat', id: hu.id, pid: hu.pid, k: 'k.gg' }]); await sleep(200);
    sh = await sheet(); run.check(sh.pill && sh.top < 40, `scrolled-up sheet jumped or showed no pill ${JSON.stringify(sh)}`);
    await run.shot('c1', 'chat-sheet');
    await c.evaluate(() => document.querySelector('#chat-sheet .cs-new').click()); await sleep(700);
    sh = await sheet(); run.check(sh.bottom && !sh.pill, `pill did not scroll to the newest line ${JSON.stringify(sh)}`);
    // custom text renders as plain text only
    await recv([{ t: 'chat', id: hu.id, pid: hu.pid, x: '<img src=x onerror="window.__pwn=1">hello there' }]); await sleep(150);
    sh = await sheet();
    run.check(/hello there$/.test(sh.last) && !(await c.evaluate(() => window.__pwn || document.querySelectorAll('#chat-sheet img, #chat-log img').length)), `sheet: custom text not plain ${sh.last}`);
    // the history is capped at 300 lines
    await recv(Array.from({ length: 320 }, (_, i) => ({ t: 'chat', id: hu.id, pid: hu.pid, k: ['r.nice', 'r.wow', 'r.ouch'][i % 3] })));
    const cap = await c.evaluate(async () => ({ log: (await import('/js/chat.js')).chat.log.length, rows: document.querySelectorAll('#chat-sheet .cs-row').length }));
    run.check(cap.log === 300 && cap.rows <= 300, `history cap ${JSON.stringify(cap)}`);
    // strip off + sheet closed -> unread badge; opening the log clears it
    await c.evaluate(() => document.querySelector('#chat-sheet [data-cs="strip"]').click());
    await c.evaluate(() => document.querySelector('#chat-sheet [data-cs="close"]').click()); await sleep(300);
    run.check(!(await sheet()).open && !(await badge()), 'sheet did not close, or a badge for lines already read');
    await recv([{ t: 'chat', id: hu.id, pid: hu.pid, k: 'g.hey' }, { t: 'chat', id: hu.id, pid: hu.pid, k: 'g.ready' }]); await sleep(400);
    run.check((await badge()) === '2', `unread badge "${await badge()}" (expected 2)`);
    run.check(await c.evaluate(() => document.querySelector('#chat-log').classList.contains('yield')), 'strip still shown with Hide Chat Strip on');
    await tap(c, '#s-game [data-act="emotes"]');
    run.check(await c.evaluate(() => /Log \(2\)/.test(document.querySelector('#emote-menu [data-tab="log"]').textContent)), 'Log tab has no unread count');
    await c.evaluate(() => document.querySelector('#emote-menu [data-tab="log"]').click()); await sleep(300);
    run.check((await sheet()).open && !(await badge()), 'Log tab did not open the sheet or clear the badge');
    await c.evaluate(() => document.querySelector('#chat-sheet [data-cs="strip"]').click());
    run.check(await c.evaluate(async () => !(await import('/js/audio.js')).settings.chatStripOff), 'strip toggle did not turn back on');
    // muting a player hides their lines in the sheet and the strip
    await c.evaluate(() => document.querySelector('#chat-sheet [data-cs="close"]').click());
    await tap(c, '#s-game [data-act="emotes"]');
    await c.evaluate(() => document.querySelector('#emote-menu [data-tab="players"]').click()); await sleep(150);
    await c.evaluate((hp) => document.querySelector(`#emote-menu [data-mute="${hp}"]`).click(), hu.pid); await sleep(150); // 'me' on PeerJS, the leader's seat id in the cloud
    await c.evaluate(() => document.querySelector('#emote-menu [data-qc="close"]').click());
    const hn = hu.name;
    const muted = await c.evaluate((hn) => ({ strip: [...document.querySelectorAll('#chat-log .cl-row b')].filter((b) => b.textContent === hn).length }), hn);
    await c.evaluate(async () => (await import('/js/chat.js')).chat.openSheet()); await sleep(200);
    const mutedSheet = await c.evaluate((hn) => [...document.querySelectorAll('#chat-sheet .cs-row b')].filter((b) => b.textContent === hn).length, hn);
    run.check(!muted.strip && !mutedSheet, `muted player's lines still shown (strip ${muted.strip}, sheet ${mutedSheet})`);
    await c.evaluate(async () => { const { chat } = await import('/js/chat.js'); chat.muted.clear(); chat.renderStrip(); chat.renderSheet(); });
    // landscape: the sheet sits left of the HUD column
    await c.setViewportSize({ width: 844, height: 390 }); await sleep(600);
    const land = await c.evaluate(() => { const s = document.querySelector('#chat-sheet').getBoundingClientRect(), h = document.querySelector('.hud-bottom').getBoundingClientRect(); return { s: s.toJSON(), hudLeft: h.left, W: innerWidth, H: innerHeight }; });
    run.check(land.s.right <= land.hudLeft + 1 && land.s.top >= 0 && land.s.bottom <= land.H, `landscape sheet overlaps the HUD column ${JSON.stringify(land)}`);
    await run.shot('c1', 'chat-sheet-landscape');
    await c.evaluate(() => document.querySelector('#chat-sheet [data-cs="close"]').click()); await sleep(300);
    const sl = await c.evaluate(() => { const L = document.querySelector('#chat-log').getBoundingClientRect(), h = document.querySelector('.hud-bottom').getBoundingClientRect(); return { right: L.right, hudLeft: h.left, n: document.querySelectorAll('#chat-log .cl-row').length }; });
    run.check(sl.n && sl.right <= sl.hudLeft, `landscape strip overlaps the HUD column ${JSON.stringify(sl)}`);
    await c.setViewportSize({ width: 390, height: 844 }); await sleep(500);
    // spectating: strip and log still work
    await L.hostKill(host, cpid);
    await c.waitForFunction(() => document.querySelector('#s-game').classList.contains('spectating'), null, { timeout: 8000 }).catch(() => {});
    await sleep(1500);
    // a downed Squads player may wait on a revive instead of the results card: start spectating directly then
    await c.evaluate(() => { const b = document.querySelector('#btn-keepspec'); if (b && b.offsetParent) b.click(); else { document.querySelector('#m-results').classList.add('hidden'); window.__cc.game.startSpectate(); } }); await sleep(600);
    await recv([{ t: 'chat', id: hu.id, pid: hu.pid, k: 'k.ty' }]); await sleep(400);
    const sp = await c.evaluate(() => ({ spec: document.querySelector('#s-game').classList.contains('spectating'), rows: [...document.querySelectorAll('#chat-log .cl-row')].map((r) => r.textContent) }));
    run.note(`spectating ${JSON.stringify(sp)}`);
    run.check(sp.spec && sp.rows.some((t) => /Thanks!$/.test(t)), `spectator strip missed a line ${JSON.stringify(sp)}`);
    await c.evaluate(async () => (await import('/js/chat.js')).chat.openSheet()); await sleep(200);
    run.check((await sheet()).open, 'spectator could not open the log');
    await run.shot('c1', 'chat-sheet-spectating');
    run.check(!errorsOn(run), 'page errors');
  };

  // ---------- voice ----------
  // fake: auto-accept the mic prompt; grant: permission already granted (no prompt, permissions.query = granted);
  // ios: an iPhone Home Screen web app as far as Chromium can fake one (iPhone UA, navigator.standalone, CDP
  // display-mode emulation where the build supports it, a Safari 16.4+ navigator.audioSession stub), plus hooks that
  // record whether getUserMedia ran inside the click and which audio session type was set at that moment.
  // deny: the user taps Don't Allow (headless Chromium has no prompt UI and would answer NotSupportedError instead)
  async function voiceCtx(run, { fake = true, grant = fake, ios = false, deny = false } = {}) {
    const args = ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'];
    args.push('--use-fake-device-for-media-stream');
    if (fake) args.push('--use-fake-ui-for-media-stream'); // without it (and without the permission) the mic request is denied
    run.vb = await L.chromium.launch({ args });
    try { await run.ctx.close(); } catch {}
    const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
    if (grant) opts.permissions = ['microphone']; // an empty list would make Playwright report every permission as denied
    if (ios) opts.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    run.ctx = await run.vb.newContext(opts);
    await run.ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await run.ctx.addInitScript(([ios, deny]) => {
      let depth = 0; window.__gum = [];
      addEventListener('click', () => { depth++; }, true); addEventListener('click', () => { depth = Math.max(0, depth - 1); }, false);
      if (ios) {
        let type = 'auto'; const hist = (window.__asHist = []);
        const AS = { get type() { return type; }, set type(v) { if (['auto', 'playback', 'ambient', 'transient', 'transient-solo', 'play-and-record'].includes(v)) { type = v; hist.push(v); } } };
        Object.defineProperty(Navigator.prototype, 'audioSession', { get: () => AS, configurable: true });
        Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
      }
      const md = navigator.mediaDevices; if (!md) return; const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => { window.__gum.push({ inClick: depth > 0, as: navigator.audioSession ? navigator.audioSession.type : null }); return deny ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : orig(c); };
    }, [ios, deny]);
    if (ios) {
      const np = run.ctx.newPage.bind(run.ctx);
      run.ctx.newPage = async () => { const p = await np(); try { const cdp = await run.ctx.newCDPSession(p); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }); } catch {} return p; };
    }
  }
  const vstate = (p) => p.evaluate(async () => { const { voice } = await import('/js/voice.js'); return { state: voice.state, listen: voice.listenOnly, roster: [...voice.roster.keys()], calls: voice.calls.size, streams: voice.stats.streams, speaking: [...voice.speaking], err: voice.err, ptt: !document.querySelector('#vc-ptt').classList.contains('hidden') }; });
  // polls with evaluate (which awaits async predicates); page.waitForFunction treats a returned Promise as truthy
  const waitV = async (p, fn, arg, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await p.evaluate(fn, arg)) return true; } catch {} await sleep(150); } return false; };

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
      const g = await host.evaluate(async (p) => { const { voice } = await import('/js/voice.js'); voice.setVolume(p, 0.5); const e = [...voice.calls.values()].find((x) => x.pid === p); const a = e && e.el ? (e.el.muted ? 0 : e.el.volume) : null; voice.toggleMute(p); const b = e && e.el ? (e.el.muted ? 0 : e.el.volume) : null; voice.toggleMute(p); return { a, b }; }, cpid); // 15.2: voices play through their <audio> element
      run.check(g.a === 0.5 && g.b === 0, `host: volume/mute levels ${JSON.stringify(g)}`);
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

  const card = (p) => p.evaluate(() => { const m = document.querySelector('#m-mic'); return m && { open: !m.classList.contains('hidden'), h: m.querySelector('h3').textContent, text: m.innerText, allow: m.querySelector('#mic-allow').textContent, steps: m.querySelectorAll('.mic-deny li').length }; });
  const gum = (p) => p.evaluate(() => ({ calls: window.__gum.slice(), as: navigator.audioSession ? navigator.audioSession.type : null, hist: (window.__asHist || []).slice(), memo: JSON.parse(localStorage.getItem('cc_mic') || 'null') }));

  // V2: mic denied, as an iPhone Home Screen app: the pre-permission card first, the system prompt only from Allow
  // (inside the tap, in play-and-record), listen-only with Home Screen steps, Turn On Mic, the denied card next time
  S['V2-voice-denied'] = async (run) => {
    await voiceCtx(run, { fake: true, grant: false, ios: true, deny: true });
    try {
      const { host, code } = await L.hostLobby(run, { mode: 'royale' });
      const c = await L.clientJoin(run, 'c1', code);
      run.note(`ctx ${await c.evaluate(async () => (await import('/js/voice.js')).micCtx())}`);
      await tap(c, '#vc-join [data-vc="join"]'); await sleep(300);
      let k = await card(c), g = await gum(c);
      run.check(k && k.open && /Your mic is only live while you hold Talk/.test(k.text) && /Home Screen/.test(k.text) && k.allow === 'Allow Microphone', `c1: no pre-permission card ${JSON.stringify(k)}`);
      run.check(!g.calls.length, 'c1: microphone requested before Allow Microphone');
      await run.shot('c1', 'mic-card');
      await tap(c, '#mic-allow');
      await waitV(c, async () => (await import('/js/voice.js')).voice.state === 'on', null, 8000);
      const s = await vstate(c); g = await gum(c);
      run.note(`denied mic: ${JSON.stringify(s)} gum ${JSON.stringify(g)}`);
      run.check(g.calls[0] && g.calls[0].inClick && g.calls[0].as === 'play-and-record', `c1: getUserMedia not called inside the tap in play-and-record ${JSON.stringify(g.calls)}`);
      run.check(g.as === 'playback', `c1: audio session not restored to playback after the denial (${g.as})`);
      run.check(g.memo && g.memo.state === 'denied' && g.memo.ctx === 'ios-app', `c1: denial not remembered ${JSON.stringify(g.memo)}`);
      run.check(s.state === 'on' && s.listen && /Microphone|microphone/.test(s.err), `c1: denied mic not handled as listen-only ${JSON.stringify(s)}`);
      const panel = await c.evaluate(() => document.querySelector('#vc-join').innerText);
      run.check(/Microphone is off for the Home Screen app/.test(panel) && /Settings > Apps > Safari > Microphone/.test(panel) && /swipe the game away/.test(panel), `c1: no Home Screen steps in the lobby panel: ${panel}`);
      run.check(/Microphone: (Blocked|Will ask)/.test(panel), `c1: no microphone state in the panel: ${panel}`);
      run.check(await L.visible(c, '#vc-join [data-vc="mic"]'), 'c1: no Turn On Mic retry');
      await run.shot('c1', 'voice-denied');
      await tap(c, '#vc-join [data-vc="mic"]'); await sleep(600);
      g = await gum(c); run.check(g.calls.length === 2 && g.calls[1].inClick, `c1: Turn On Mic did not ask again from the tap ${JSON.stringify(g.calls)}`);
      // next time: the denied card with the steps, and Listen Only joins without asking
      await tap(c, '#vc-join [data-vc="leave"]'); await sleep(300);
      await tap(c, '#vc-join [data-vc="join"]'); await sleep(300);
      k = await card(c);
      run.check(k.open && k.h === 'Microphone is blocked' && k.steps >= 3 && k.allow === 'Try Again', `c1: denied card ${JSON.stringify(k)}`);
      await run.shot('c1', 'mic-card-denied');
      await tap(c, '#mic-listen');
      await waitV(c, async () => (await import('/js/voice.js')).voice.state === 'on', null, 8000);
      const s2 = await vstate(c); g = await gum(c);
      run.check(s2.listen && g.calls.length === 2 && !(await card(c)).open, `c1: Listen Only ${JSON.stringify({ s2, n: g.calls.length })}`);
      // the data connection and the game are unaffected
      await L.startMatch(run, host, { bots: 1, clients: [c] });
      await autoplay(host); await autoplay(c);
      const a = await L.advancing(c, 3000); run.check(a.moved, 'c1: match did not advance with a denied mic');
      run.check(!(await vstate(c)).ptt, 'c1: Talk button shown while listen-only');
      run.check(!errorsOn(run), 'page errors');
    } finally { try { await run.ctx.close(); } catch {} try { await run.vb.close(); } catch {} }
  };

  // V3: mic allowed from the card (iPhone Home Screen app, prompt auto-accepted); remembered, so the next Join goes
  // straight to the system prompt; Settings > Microphone shows the state and Test Microphone drives a live meter
  S['V3-voice-mic-card'] = async (run) => {
    await voiceCtx(run, { fake: true, grant: false, ios: true });
    try {
      const { host, code } = await L.hostLobby(run, { mode: 'royale' });
      const c = await L.clientJoin(run, 'c1', code);
      run.note(`permission before: ${await c.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state)}`);
      await tap(c, '#vc-join [data-vc="join"]'); await sleep(300);
      run.check((await card(c)).open, 'c1: no pre-permission card the first time');
      await tap(c, '#mic-allow');
      await waitV(c, async () => { const { voice } = await import('/js/voice.js'); return voice.state === 'on' && !!voice.mic; }, null, 8000);
      let s = await vstate(c), g = await gum(c);
      run.check(s.state === 'on' && !s.listen && s.ptt, `c1: voice not on with a mic after Allow ${JSON.stringify(s)}`);
      run.check(g.calls.length === 1 && g.calls[0].inClick && g.calls[0].as === 'play-and-record' && g.as === 'play-and-record', `c1: mic request/audio session ${JSON.stringify(g)}`);
      run.check(g.memo && g.memo.state === 'granted', `c1: grant not remembered ${JSON.stringify(g.memo)}`);
      const panel = await c.evaluate(() => document.querySelector('#vc-join .vc-perm').textContent);
      run.note(`panel state: ${panel}`);
      run.check(/Microphone: (Allowed|Will ask)/.test(panel), `c1: panel state "${panel}"`);
      await tap(c, '#vc-join [data-vc="leave"]'); await sleep(300);
      g = await gum(c); run.check(g.as === 'playback', `c1: Leave Voice left the session in ${g.as}`);
      // remembered: no card again, the system prompt comes straight from Join (iPhone asks each launch: a toast says so)
      await tap(c, '#vc-join [data-vc="join"]'); await sleep(300);
      run.check(!(await card(c)).open, 'c1: pre-permission card shown again after the mic was allowed');
      await waitV(c, async () => (await import('/js/voice.js')).voice.state === 'on', null, 8000);
      g = await gum(c); run.check(g.calls.length === 2 && g.calls[1].inClick, `c1: second Join did not ask from the tap ${JSON.stringify(g.calls)}`);
      await tap(c, '#vc-join [data-vc="leave"]'); await sleep(300);
      // Settings > Chat and Voice > Microphone
      await c.evaluate(() => document.querySelector('[data-act="settings"]').click()); await sleep(400);
      await c.evaluate(() => document.querySelector('#mic-row').scrollIntoView({ block: 'center' })); await sleep(200);
      const row = await c.evaluate(() => ({ state: document.querySelector('#mic-state').textContent, btns: [...document.querySelectorAll('#mic-row button')].filter((b) => !b.hidden).map((b) => b.textContent) }));
      run.note(`settings row ${JSON.stringify(row)}`);
      run.check(row.btns.includes('Test Microphone') && /Allowed|Will ask/.test(row.state), `settings: microphone row ${JSON.stringify(row)}`);
      await tap(c, '#mic-row [data-mic-act="test"]');
      const moved = await waitV(c, () => { const i = document.querySelector('#mic-meter i'); return !document.querySelector('#mic-meter').hidden && parseFloat(i.style.width) > 3; }, null, 6000);
      await run.shot('c1', 'settings-mic-test');
      run.check(moved, 'settings: level meter never moved with the fake microphone');
      g = await gum(c); run.check(g.calls.length === 3 && g.calls[2].inClick, `settings: Test Microphone did not ask from the tap ${JSON.stringify(g.calls)}`);
      await tap(c, '#mic-row [data-mic-act="test"]'); await sleep(300);
      const after = await c.evaluate(() => ({ note: document.querySelector('#mic-note').textContent, meter: document.querySelector('#mic-meter').hidden, live: window.__ccTestLive }));
      g = await gum(c);
      run.check(/microphone works/.test(after.note) && after.meter && g.as === 'playback', `settings: Stop Test ${JSON.stringify({ ...after, as: g.as })}`);
      await c.evaluate(() => document.querySelector('[data-act="close-settings"]').click());
      run.check(!errorsOn(run), 'page errors');
    } finally { try { await run.ctx.close(); } catch {} try { await run.vb.close(); } catch {} }
  };
};

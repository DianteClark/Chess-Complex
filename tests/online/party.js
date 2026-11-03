// 15.0 (N): parties, the two owner bugs, and auto-reconnect. Registered by scenarios.js.
// P1 party cycle: match -> results -> Back to Party (everyone) -> ready states -> leader changes mode -> next match.
// P2 bug (a): the leader leaves after the match; members' lobby must clear at once, on results and in the lobby.
// P3 bug (b): Siege to wave 5 (state passes PeerJS's 16300 byte JSON limit): the friend keeps receiving states (chunked),
//    then drops off the network: the host bot-plays the seat, the friend reconnects by itself with its token and carries on.
// P4 reconnect in the party lobby and leader-only controls.
module.exports = function register(S, { L, match, sleep, tap, autoplay }) {
  const { view, waitFor, waitResults } = L;
  const net = (p, cfg) => p.evaluate(async (cfg) => { const N = (await import('/js/net.js')).NET; Object.assign(N, cfg || {}); return { ...N.stats }; }, cfg || null);
  const party = (p) => p.evaluate(() => {
    const s = window.__cc.session, q = (sel) => document.querySelector(sel);
    return {
      screen: (q('.screen.active') || {}).id, mode: s && s.mode, gm: s && (s.gameMode || (s.party && s.party.mode)),
      start: q('#btn-start-host') ? { dis: q('#btn-start-host').disabled, txt: q('#btn-start-host').textContent.trim() } : null,
      ready: q('#btn-ready') ? { hidden: q('#btn-ready').classList.contains('hidden'), dis: q('#btn-ready').disabled, txt: q('#btn-ready').textContent.trim() } : null,
      cards: [...document.querySelectorAll('#host-lobby li, #join-lobby li')].filter((li) => li.closest('.screen.active')).map((li) => li.querySelector('em').textContent.trim()),
      joinPanel: !q('#join-lobby-panel').classList.contains('hidden'), joinRows: document.querySelectorAll('#join-lobby li').length,
      joinStatus: q('#join-status').textContent, inParty: q('#s-join').classList.contains('in-party'),
      rematch: { hidden: q('#btn-rematch').classList.contains('hidden'), txt: q('#btn-rematch').textContent.trim() },
      banner: !!q('#net-banner') && !q('#net-banner').classList.contains('hidden'),
      toasts: (window.__toasts || []).slice(-4),
    };
  });

  S['P1-party-cycle'] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    await L.killAllExcept(host, ['me']);
    run.check(await waitResults(host), 'host: no results'); run.check(await waitResults(c), 'c1: no results');
    await sleep(1200);
    let hp = await party(host), cp = await party(c);
    run.check(!hp.rematch.hidden && hp.rematch.txt === 'Back to Party', `host results button ${JSON.stringify(hp.rematch)}`);
    run.check(!cp.rematch.hidden && cp.rematch.txt === 'Back to Party', `c1 results button ${JSON.stringify(cp.rematch)}`);
    await tap(host, '#btn-rematch'); await sleep(600);
    hp = await party(host);
    run.check(hp.screen === 's-host', `host: Back to Party -> ${hp.screen}`);
    run.check(hp.cards.includes('On results') && hp.start.dis, `host: member still on results should block Start ${JSON.stringify(hp)}`);
    await tap(c, '#btn-rematch'); await sleep(600);
    cp = await party(c); hp = await party(host);
    run.check(cp.screen === 's-join' && cp.joinPanel && cp.inParty && cp.joinRows === 4, `c1: party lobby ${JSON.stringify(cp)}`);
    run.check(cp.ready && !cp.ready.hidden && !cp.ready.dis && /Ready Up/.test(cp.ready.txt), `c1: Ready button ${JSON.stringify(cp.ready)}`);
    run.check(hp.cards.includes('Not ready') && hp.start.dis && /Waiting for/.test(hp.start.txt), `host: Start should wait for c1 ${JSON.stringify(hp.start)} ${hp.cards}`);
    await run.shot('host', 'party-lobby'); await run.shot('c1', 'party-lobby');
    // leader switches to Co-op Siege (4 seats fit) and picks a location if any exist
    await host.evaluate(() => document.querySelector('#party-opts [data-party="group"][data-v="coop"]').click()); await sleep(400);
    const loc = await host.evaluate(() => { const b = [...document.querySelectorAll('#party-opts [data-party="loc"]')].find((x) => x.dataset.v !== 'random'); if (b) b.click(); return b ? b.dataset.v : null; }); await sleep(400);
    hp = await party(host); cp = await party(c);
    run.check(['siege', 'gauntlet'].includes(hp.gm), `host: co-op group did not pick a co-op mode (${hp.gm})`);
    run.check(cp.gm === hp.gm, `c1 sees mode ${cp.gm}, leader picked ${hp.gm}`);
    // members cannot drive the leader's controls
    run.check(await c.evaluate(() => !document.querySelector('#join-party-opts [data-party="mode"]')), 'c1: member view has mode buttons');
    await tap(c, '#btn-ready'); await sleep(500);
    hp = await party(host); cp = await party(c);
    run.check(cp.ready.txt === 'Ready' && hp.cards.includes('Ready') && !hp.start.dis, `ready did not reach the leader ${JSON.stringify({ c: cp.ready, h: hp.start, cards: hp.cards })}`);
    await tap(c, '#btn-ready'); await sleep(400); hp = await party(host);
    run.check(hp.start.dis, 'host: un-ready did not block Start again');
    await tap(c, '#btn-ready'); await sleep(400);
    await tap(host, '#btn-start-host');
    run.check(await waitFor(c, () => window.__cc.game.s && !window.__cc.game.s.over && document.querySelector('.screen.active').id === 's-game', null, 8000), 'c1: did not enter the next party match');
    const st = await c.evaluate(() => ({ mode: window.__cc.game.s.mode, loc: window.__cc.game.s.location || null, siege: !!window.__cc.game.s.siege }));
    run.note(`next match: ${JSON.stringify(st)} (leader picked location ${loc})`);
    run.check(st.mode === hp.gm && st.siege, `c1: next match is ${st.mode}, expected ${hp.gm}`);
    if (loc) run.check(st.loc === loc, `c1: location ${st.loc}, leader picked ${loc}`);
    // ready resets for the match after this one
    const rd = await host.evaluate(() => window.__cc.session.party.ready.size);
    run.check(rd === 0, `host: ready set not cleared at start (${rd})`);
  };

  // Bug (a): after the match the leader goes to the menu. Members must not be left in a dead lobby.
  for (const where of ['results', 'lobby']) S[`P2-leader-leaves-${where}`] = async (run) => {
    const { host, c } = await match(run, { bots: 2 });
    await L.killAllExcept(host, ['me']);
    run.check(await waitResults(host), 'host: no results'); run.check(await waitResults(c), 'c1: no results');
    await sleep(1000);
    if (where === 'lobby') { await tap(host, '#btn-rematch'); await tap(c, '#btn-rematch'); await sleep(500); run.check((await party(c)).joinRows === 4, 'c1: not in the party lobby'); }
    if (where === 'lobby') await tap(host, '#s-host [data-act="leave-lobby"]'); else await tap(host, '#m-results [data-act="to-title"]');
    await sleep(1200);
    let cp = await party(c);
    run.note(`c1 after leader left (${where}): ${JSON.stringify({ screen: cp.screen, status: cp.joinStatus, toasts: cp.toasts, rematch: cp.rematch })}`);
    run.check(!cp.joinPanel && cp.joinRows === 0 && !cp.inParty, `c1: party lobby not cleared ${JSON.stringify(cp)}`);
    run.check(/party has closed/i.test(cp.joinStatus) || cp.toasts.some((t) => /party has closed/i.test(t)), `c1: no clear message ${JSON.stringify(cp)}`);
    if (where === 'results') run.check(cp.rematch.hidden, 'c1: Back to Party still offered after the party closed');
    run.check(await c.evaluate(() => !window.__cc.session || !window.__cc.session.client.reconnecting), 'c1: tries to reconnect to a party that closed');
    // the join screen is clean afterwards (old bug: stale rows and "In the lobby.")
    if (cp.screen === 's-game') await tap(c, '#m-results [data-act="to-title"]');
    else await tap(c, '#s-join [data-act="leave-lobby"]');
    await sleep(800); await tap(c, '#s-title [data-go="join"]'); await sleep(600);
    cp = await party(c);
    run.check(cp.screen === 's-join' && !cp.joinPanel && cp.joinRows === 0 && !/In the lobby/.test(cp.joinStatus), `c1: join screen shows a stale lobby ${JSON.stringify(cp)}`);
    await run.shot('c1', 'join-after');
  };

  // Bug (b): a friend in Siege at wave 5. States grow past 16300 bytes; then the friend's network drops.
  S['P3-siege-wave5-reconnect'] = async (run) => {
    const { host, c, cpid } = await match(run, { mode: 'siege', bots: 2 });
    for (const p of [host, c]) await net(p, { dead: 8000, retry: 1000, hb: 1500 });
    await autoplay(host, false); await autoplay(c, false);
    // AI drives both humans so the run gets to wave 5 quickly; the host's protect loop keeps them alive
    await host.evaluate(async (cp) => { const E = await import('/js/engine.js'); const h = window.__cc.session.host; h.fast = true; h.setBot('me'); h.setBot(cp); clearInterval(window.__pt); window.__pt = setInterval(() => { for (const u of h.s.units) if (u.alive && u.kind === 'player' && u.hp < E.stats(u).maxHp * 0.7) u.hp = E.stats(u).maxHp; }, 30); }, cpid);
    // natural play to wave 5 when the box is fast enough; otherwise (after 3 minutes, at least wave 2) grow the state the
    // way later waves do, with spent Hollows piling up in s.units, until it is past the 16300 byte channel limit
    const t0 = Date.now(); let st;
    const siegeSt = () => host.evaluate(() => { const s = window.__cc.session.host.s; return { over: s.over, wave: s.siege.wave, turn: s.turnNo, units: s.units.length, bytes: JSON.stringify({ t: 'state', state: s, ev: [], dl: -1 }).length }; });
    while (Date.now() - t0 < 6 * 60000) { st = await siegeSt(); if (st.wave >= 5 || st.over || (st.wave >= 2 && Date.now() - t0 > 3 * 60000)) break; await sleep(1000); }
    run.note(`siege reached ${JSON.stringify(st)} in ${Math.round((Date.now() - t0) / 1000)}s`);
    run.check(!st.over && st.wave >= 2, `siege did not get going ${JSON.stringify(st)}`);
    if (st.wave < 5) {
      await host.evaluate(() => { const s = window.__cc.session.host.s; const tpl = s.units.find((u) => u.kind === 'hollow') || s.units.find((u) => u.kind !== 'player'); let n = 0; while (JSON.stringify(s).length < 19000 && n++ < 60) s.units.push({ ...structuredClone(tpl), id: s.nextId++, alive: false, hp: 0, x: 0, y: 0 }); });
      st = await siegeSt(); run.note(`padded with spent Hollows to wave-5 size: ${JSON.stringify(st)}`);
    }
    await sleep(2500);
    const hs = await net(host), ct = await c.evaluate(() => window.__cc.game.s.turnNo), ht = await host.evaluate(() => window.__cc.session.host.s.turnNo);
    run.note(`host net stats ${JSON.stringify(hs)}; turn host ${ht} c1 ${ct}`);
    run.check(hs.maxMsg >= 16300 && hs.chunked > 0, `no state over the PeerJS limit was sent chunked ${JSON.stringify(hs)}`);
    run.check(hs.tooBig === 0, `${hs.tooBig} messages were over the channel limit`);
    run.check(Math.abs(ht - ct) <= 3, `c1 stopped receiving states (host turn ${ht}, c1 turn ${ct})`);
    const logs = async () => run.note(`net log host: ${(await host.evaluate(async () => (await import('/js/net.js')).NET.log.join(' | ')))} || c1: ${(await c.evaluate(async () => (await import('/js/net.js')).NET.log.join(' | ')))}`);
    if (run.fails.length) await logs();
    const cv = await view(c); run.check(cv.screen === 's-game' && !cv.modals.includes('m-results'), `c1 left the match ${cv.screen} [${cv.modals}]`);
    // hand c1 back, then cut it off the network without a goodbye
    await host.evaluate((cp) => { const h = window.__cc.session.host, u = h.s.units.find((v) => v.pid === cp); u.bot = false; h.fast = false; h.schedule(); }, cpid);
    await autoplay(c, true, 300);
    const gen = await c.evaluate(() => window.__cc.game.gen);
    await c.evaluate(async () => (await import('/js/net.js')).NET.drop(30000));
    const botted = await waitFor(host, (cp) => { const u = window.__cc.session.host.s.units.find((v) => v.pid === cp); return u && u.bot; }, cpid, 90000);
    run.check(botted, 'host: dropped friend was not handed to a bot');
    run.check(await waitFor(c, () => { const b = document.querySelector('#net-banner'); return b && !b.classList.contains('hidden') && /Reconnecting/.test(b.textContent); }, null, 60000), 'c1: no Reconnecting banner while offline');
    await run.shot('c1', 'reconnecting');
    const feed = await host.evaluate(() => document.querySelector('#h-feed').textContent);
    run.check(/lost connection/i.test(feed), `host feed: "${feed}"`);
    const t1 = await host.evaluate(() => window.__cc.session.host.s.turnNo); await sleep(8000);
    run.check((await host.evaluate(() => window.__cc.session.host.s.turnNo)) > t1, 'host: match stalled while the friend was away');
    const back = await waitFor(host, (cp) => { const s = window.__cc.session; const u = s.host.s.units.find((v) => v.pid === cp); return u && !u.bot && s.conns.has(cp); }, cpid, 120000);
    run.check(back, 'c1 did not reconnect by itself');
    await waitFor(c, () => { const b = document.querySelector('#net-banner'); return !b || b.classList.contains('hidden'); }, null, 30000);
    const synced = async () => { const h = await host.evaluate(() => window.__cc.session.host.s.turnNo), k = await c.evaluate(() => window.__cc.game.s.turnNo); return Math.abs(h - k) <= 3; };
    for (let i = 0; i < 20 && !(await synced()); i++) await sleep(1500);
    const after = await c.evaluate(() => ({ gen: window.__cc.game.gen, pid: window.__cc.session.myPid, screen: document.querySelector('.screen.active').id, turn: window.__cc.game.s.turnNo, results: !document.querySelector('#m-results').classList.contains('hidden'), banner: !!document.querySelector('#net-banner') && !document.querySelector('#net-banner').classList.contains('hidden') }));
    const ht2 = await host.evaluate(() => window.__cc.session.host.s.turnNo);
    run.note(`c1 after reconnect ${JSON.stringify(after)} host turn ${ht2}`);
    run.check(after.pid === cpid && after.screen === 's-game' && !after.results, `c1 not back in its seat ${JSON.stringify(after)}`);
    run.check(after.gen === gen, 'c1 restarted the match intro instead of carrying on');
    await logs();
    run.check(!after.banner, 'c1: reconnecting banner still up');
    run.check(Math.abs(ht2 - after.turn) <= 3, `c1 out of sync after reconnect (host ${ht2}, c1 ${after.turn})`);
    const a = await L.advancing(c, 3000); run.check(a.moved, `c1: match not advancing after reconnect ${JSON.stringify(a)}`);
    await run.shot('c1', 'reconnected');
  };

  // 15.2 (N): owner bug "game froze after our second match using the party system". Three party matches in a row
  // (host + c1 + 2 bots). Match 1 skips the intro the way startMatch does; matches 2 and 3 play the real intro hold
  // (no go(), no skip, the host not in fast mode) so a stale intro timer / turn clock / handler from the last match
  // shows up. Each match must advance on both screens, reach results on both, and the party must come back.
  // P5b: the member is knocked out first each match, opens results and goes Back to Party while the match still runs
  // (benched), taps through the intro of match 2 and uses Skip intro on match 3.
  for (const vr of ['a', 'b']) S[`P5${vr}-party-three-matches`] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    const state = (p) => p.evaluate(() => { const g = window.__cc.game, s = window.__cc.session; return { screen: (document.querySelector('.screen.active') || {}).id, turn: g.s ? g.s.turnNo : null, over: g.s ? !!g.s.over : null, v: g.s ? g.s.v : null, results: !document.querySelector('#m-results').classList.contains('hidden'), introOn: window.__cc.intro.on, hostTurn: s && s.host ? s.host.s.turnNo : null, introUntil: s && s.host ? s.host.introUntil : null, gen: g.gen }; });
    for (let k = 1; k <= 3; k++) {
      if (k > 1) {
        // real intro on both screens: wait for it, then the first turns must come
        const s0 = { h: await state(host), c: await state(c) };
        run.note(`match ${k} start ${JSON.stringify(s0)}`);
        await autoplay(host); await autoplay(c); await L.protectHumans(host);
        if (vr === 'b') {
          await sleep(1500);
          if (k === 2) for (let i = 0; i < 6; i++) { await c.evaluate(() => { const t = document.querySelector('#intro-tap'); if (t) t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); await sleep(700); }
          else await c.evaluate(() => { const t = document.querySelector('#intro-skip'); if (t) t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
        }
        const okH = await waitFor(host, () => !window.__cc.intro.on && window.__cc.game.s && window.__cc.game.s.turnNo > 1, null, 30000);
        const okC = await waitFor(c, () => !window.__cc.intro.on && window.__cc.game.s && window.__cc.game.s.turnNo > 1, null, 30000);
        if (!okH || !okC) run.note(`match ${k} after intro ${JSON.stringify({ h: await state(host), c: await state(c) })}`);
        run.check(okH, `match ${k}: host never got past the intro into turns`);
        run.check(okC, `match ${k}: c1 never got past the intro into turns`);
      }
      for (const [l, p] of [['host', host], ['c1', c]]) { const a = await L.advancing(p, 4000); run.check(a.moved, `match ${k}: ${l} turns did not advance ${JSON.stringify(a)} ${JSON.stringify(await state(p))}`); }
      const ht = await host.evaluate(() => window.__cc.session.host.s.turnNo), ct = await c.evaluate(() => window.__cc.game.s.turnNo);
      run.check(Math.abs(ht - ct) <= 4, `match ${k}: c1 out of sync (host ${ht}, c1 ${ct})`);
      if (vr === 'b') {
        await L.hostKill(host, cpid);
        if (!run.check(await L.waitDead(c, 15000), `match ${k}: c1 dead modal never appeared`)) run.note(`c1 ${JSON.stringify(await state(c))} me ${JSON.stringify(await c.evaluate(() => { const m = window.__cc.game.me; return m && { alive: m.alive, place: m.place }; }))}`);
        await tap(c, '#m-dead [data-act="results"]'); await sleep(600);
        run.check(await waitResults(c, 5000), `match ${k}: c1 See Results did not open results`);
        await tap(c, '#btn-rematch'); await sleep(600);
        run.check((await party(c)).screen === 's-join', `match ${k}: c1 benched Back to Party failed`);
        await sleep(2500); // the match plays on without c1 for a bit
        const a = await L.advancing(host, 3000); const hOver = await host.evaluate(() => window.__cc.session.host.s.over); run.check(a.moved || hOver, `match ${k}: host stalled after c1 left for the lobby ${JSON.stringify(a)}`);
        if (!a.moved) run.note('stall diag ' + JSON.stringify(await host.evaluate(() => { const h = window.__cc.session.host, s = h.s, u = s.units.find((q) => q.id === s.active); return { over: s.over, active: u && { pid: u.pid, kind: u.kind, alive: u.alive, bot: !!u.isBot, name: u.name }, introUntil: h.introUntil, fast: h.fast, deadline: h.deadline && h.deadline - Date.now(), screen: document.querySelector('.screen.active').id, humans: s.units.filter((q) => q.kind === 'player' && !q.isBot).map((q) => [q.pid, q.alive]) }; })));
        await L.killAllExcept(host, ['me']);
        run.check(await waitResults(host, 15000), `match ${k}: host no results`);
        await sleep(1200);
        if (k === 3) break;
        await tap(host, '#btn-rematch'); await sleep(500);
        run.check((await party(host)).screen === 's-host', `match ${k}: host not back in the party`);
        await autoplay(host, false); await autoplay(c, false);
        await tap(c, '#btn-ready'); await sleep(400);
        run.check(await waitFor(host, () => !document.querySelector('#btn-start-host').disabled, null, 5000), `match ${k}: Start never enabled ${JSON.stringify(await party(host))}`);
        await tap(host, '#btn-start-host');
        for (const [l, p] of [['host', host], ['c1', c]]) run.check(await waitFor(p, () => window.__cc.game.s && !window.__cc.game.s.over && document.querySelector('.screen.active').id === 's-game', null, 8000), `match ${k + 1}: ${l} did not enter`);
        continue;
      }
      await L.killAllExcept(host, ['me']);
      run.check(await waitResults(host, 15000), `match ${k}: host no results`); run.check(await waitResults(c, 15000), `match ${k}: c1 no results`);
      await sleep(1200);
      if (k === 3) break;
      // match 1: leader taps Back to Party first; match 2: the member does
      const order = k === 1 ? [host, c] : [c, host];
      for (const p of order) { await tap(p, '#btn-rematch'); await sleep(500); }
      let hp = await party(host), cp = await party(c);
      run.check(hp.screen === 's-host' && cp.screen === 's-join' && cp.inParty, `match ${k}: not both back in the party ${hp.screen} ${cp.screen}`);
      await autoplay(host, false); await autoplay(c, false);
      await tap(c, '#btn-ready'); await sleep(400);
      run.check(await waitFor(host, () => !document.querySelector('#btn-start-host').disabled, null, 5000), `match ${k}: Start never enabled`);
      await tap(host, '#btn-start-host');
      for (const [l, p] of [['host', host], ['c1', c]]) run.check(await waitFor(p, () => window.__cc.game.s && !window.__cc.game.s.over && document.querySelector('.screen.active').id === 's-game', null, 8000), `match ${k + 1}: ${l} did not enter`);
    }
    run.check((await L.clientPid(c)) === cpid, 'c1 changed seat across matches');
  };

  // P5c (reproduces the owner's freeze): the member goes Back to Party, its link drops and reconnects (phone screen off
  // while waiting) while the leader is still on the old match (live or on results). Before 15.2 the reconnect resumed
  // the old match on the member's screen: a finished board with no results and no way back. Then a second match.
  for (const when of ['live', 'over']) S[`P5c-benched-reconnect-${when}`] = async (run) => {
    const { host, c, cpid } = await match(run, { bots: 2 });
    for (const p of [host, c]) await net(p, { dead: 4000, retry: 1000, hb: 1000 });
    await L.hostKill(host, cpid);
    run.check(await L.waitDead(c, 15000), 'c1: dead modal never appeared');
    await tap(c, '#m-dead [data-act="results"]'); await sleep(600);
    await tap(c, '#btn-rematch'); await sleep(600);
    if (when === 'over') { await L.killAllExcept(host, ['me']); run.check(await waitResults(host, 15000), 'host: no results'); await sleep(800); }
    await c.evaluate(async () => (await import('/js/net.js')).NET.drop(1500));
    await sleep(9000);
    let cp = await party(c);
    run.check(cp.screen === 's-join' && cp.inParty, `c1 pulled out of the party lobby by the reconnect ${JSON.stringify(cp)}`);
    if (when === 'live') { await L.killAllExcept(host, ['me']); run.check(await waitResults(host, 15000), 'host: no results'); await sleep(800); }
    await tap(host, '#btn-rematch'); await sleep(800);
    cp = await party(c);
    run.check(cp.screen === 's-join' && cp.ready && !cp.ready.hidden && !cp.ready.dis, `c1 cannot ready up for the next match ${JSON.stringify(cp)}`);
    await tap(c, '#btn-ready'); await sleep(400);
    run.check(await waitFor(host, () => !document.querySelector('#btn-start-host').disabled, null, 5000), 'host: Start never enabled');
    await tap(host, '#btn-start-host');
    run.check(await waitFor(c, () => window.__cc.game.s && !window.__cc.game.s.over && document.querySelector('.screen.active').id === 's-game', null, 8000), 'c1: did not enter match 2');
    await host.evaluate(() => { const h = window.__cc.session.host; h.fast = true; h.go(); });
    await autoplay(host); await autoplay(c);
    const a = await L.advancing(c, 5000); run.check(a.moved, `c1: match 2 not advancing ${JSON.stringify(a)}`);
    await L.killAllExcept(host, ['me']);
    run.check(await waitResults(c, 15000), 'c1: no results in match 2');
  };
  // A link that drops right as the match ends: the reconnect resends the final state without its 'over' event.
  S['P5d-over-without-event'] = async (run) => {
    const { host, c } = await match(run, { bots: 2 });
    // c1 misses the state carrying 'over' (simulated), then gets the final state again the way a reconnect sends it
    await c.evaluate(() => { const g = window.__cc.game, o = g.onMsg.bind(g); g.onMsg = (m) => { if (m.t === 'state' && (m.ev || []).some((e) => e.e === 'over')) return; o(m); }; });
    await L.killAllExcept(host, ['me']);
    run.check(await waitResults(host, 15000), 'host: no results');
    await host.evaluate(() => window.__cc.session.host.publish([]));
    run.check(await waitResults(c, 10000), 'c1: final state without the over event left it on a dead board');
  };

  // Reconnect while waiting in the party lobby, plus leader-only rules (members cannot start or change options).
  S['P4-lobby-reconnect'] = async (run) => {
    const { host, code } = await L.hostLobby(run);
    const c = await L.clientJoin(run, 'c1', code);
    for (const p of [host, c]) await net(p, { dead: 4000, retry: 1000, hb: 1000 });
    await tap(c, '#btn-ready'); await sleep(400);
    let hp = await party(host); run.check(hp.cards.includes('Ready'), `host: c1 not shown ready ${hp.cards}`);
    // forged leader-only messages from a member are ignored
    await c.evaluate(() => window.__cc.session.client.send({ t: 'act', a: { type: 'end' } }));
    const pid0 = await L.clientPid(c);
    await c.evaluate(async () => (await import('/js/net.js')).NET.drop());
    const noticed = await waitFor(c, () => /Reconnecting/.test(document.querySelector('#join-status').textContent), null, 12000);
    const cp = await party(c); run.note(`c1 while cut off: ${JSON.stringify({ status: cp.joinStatus, banner: cp.banner })}`);
    run.check(noticed, 'c1 never noticed the drop');
    run.check(await waitFor(c, () => /In the lobby/.test(document.querySelector('#join-status').textContent), null, 20000), 'c1 did not reconnect by itself');
    run.check(await waitFor(host, () => window.__cc.session.players.length === 2 && window.__cc.session.conns.size === 1, null, 10000), 'c1 not back in the party after the drop');
    await sleep(800);
    const back = await party(c); hp = await party(host);
    run.note(`c1 back: ${JSON.stringify({ status: back.joinStatus, rows: back.joinRows, pid: await L.clientPid(c), was: pid0 })}`);
    run.check(back.joinRows === 2 && back.inParty && !back.banner, `c1 lobby after reconnect ${JSON.stringify(back)}`);
    run.check((await L.clientPid(c)) === pid0, 'c1 came back in a new seat instead of its own');
    run.check(hp.cards.includes('Ready') && (await party(c)).ready.txt === 'Ready', `c1 lost its ready state over the drop ${hp.cards}`);
    // a deliberate leave frees the seat at once (no 20 s hold)
    const c2 = await L.clientJoin(run, 'c2', code); await sleep(400);
    await tap(c2, '#s-join [data-act="leave-lobby"]'); await sleep(900);
    run.check((await host.evaluate(() => window.__cc.session.players.length)) === 2, 'host: c2 still seated after leaving on purpose');
    await L.startMatch(run, host, { clients: [c] });
    run.check((await view(c)).screen === 's-game', 'c1: did not start after reconnecting in the lobby');
  };
};

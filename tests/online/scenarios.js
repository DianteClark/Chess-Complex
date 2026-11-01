// Chess Complex online lifecycle scenario matrix.
// Usage: node tests/online/scenarios.js [--iters 3] [--par 3] [--only S2b-host,S4c]
// Requires: `python3 -m http.server 8141` running in the repo root, and Playwright installed.
const L = require('./lib');
const fs = require('fs');
const { sleep, tap, view, autoplay, hostKill, killAllExcept, advancing, waitResults, waitDead, waitFor } = L;

// ---------- fixtures ----------
async function match(run, { mode = 'royale', clients = 1, bots = 6, auto = true, protect = true } = {}) {
  const { host, code } = await L.hostLobby(run, { mode });
  const cs = [];
  for (let i = 0; i < clients; i++) cs.push(await L.clientJoin(run, 'c' + (i + 1), code));
  await L.startMatch(run, host, { bots, clients: cs });
  const cpids = []; for (const c of cs) cpids.push(await L.clientPid(c));
  run.before = {}; for (const [k, p] of Object.entries(run.pages)) run.before[k] = await view(p);
  if (auto) { await autoplay(host); for (const c of cs) await autoplay(c); }
  if (protect) await L.protectHumans(host);
  return { host, cs, c: cs[0], cpid: cpids[0], cpids, code };
}
// Exactly-once reward check: results visible, then nothing changes for 6s more (the 'over' event re-fires showResults at +4.8s).
async function rewardsOnce(run, label) {
  const p = run.pages[label]; const a = await view(p); await sleep(6000); const b = await view(p);
  const before = run.before[label];
  run.check(a.marks === b.marks && a.played === b.played, `${label}: rewards changed after results were shown (${a.marks}->${b.marks})`);
  run.check(b.played - before.played === 1, `${label}: match recorded ${b.played - before.played} times (expected 1)`);
  run.note(`${label}: marks +${b.marks - before.marks}, games +${(b.games || 0) - (before.games || 0)}`);
}
async function expectAdvancing(run, label, ms = 4000, msg = '') {
  const a = await advancing(run.pages[label], ms);
  run.check(a.moved, `${label}: turns did not advance (${a.from}->${a.to}) ${msg}`);
  return a;
}
async function finish(run, host, keep) { await killAllExcept(host, keep); }
async function dieAndModal(run, host, label, pid) {
  await hostKill(host, pid);
  const ok = await waitDead(run.pages[label]);
  run.check(ok, `${label}: Eliminated modal never appeared`);
  await run.shot(label, 'dead');
}
async function screenIs(run, label, screen, extra = '') {
  const v = await view(run.pages[label]);
  run.check(v.screen === screen, `${label}: ended on ${v.screen} [${v.modals}] expected ${screen} ${extra}`);
  return v;
}

// Press Menu on results. If a confirm dialog appears, record it and answer `answer` ('yes'|'no').
async function pressMenu(run, label, answer = 'yes') {
  const p = run.pages[label];
  await tap(p, '#m-results [data-act="to-title"]'); await sleep(400);
  const cf = await p.evaluate(() => { const m = document.querySelector('#m-confirm'); return m && !m.classList.contains('hidden') ? document.querySelector('#cf-title').textContent + ' | ' + document.querySelector('#cf-body').textContent : null; });
  if (cf) { run.note(`${label}: confirm shown: "${cf}" -> ${answer}`); await run.shot(label, 'confirm'); await tap(p, answer === 'yes' ? '#cf-yes' : '#cf-no'); await sleep(1200); }
  else await sleep(1200);
  return cf;
}

// ---------- scenarios ----------
const S = {};

// 1. Dies -> Spectate -> match continues -> both see results
for (const who of ['host', 'client']) S[`S1-${who}-spectate`] = async (run) => {
  const { host, c, cpid } = await match(run);
  const dl = who === 'host' ? 'host' : 'c1', dpid = who === 'host' ? 'me' : cpid, other = who === 'host' ? 'c1' : 'host';
  await dieAndModal(run, host, dl, dpid);
  await tap(run.pages[dl], '#m-dead [data-act="spectate"]');
  const v = await view(run.pages[dl]); run.check(!v.modals.includes('m-dead'), `${dl}: dead modal still open after Spectate`);
  await expectAdvancing(run, dl, 3000, 'while spectating'); await expectAdvancing(run, other, 3000);
  await run.shot(dl, 'spectating');
  await finish(run, host, [who === 'host' ? cpid : 'me']);
  run.check(await waitResults(run.pages[dl]), `${dl}: no results at match end`);
  run.check(await waitResults(run.pages[other]), `${other}: no results at match end`);
  await run.shot(dl, 'results'); await run.shot(other, 'results');
  await rewardsOnce(run, dl); run.before[other] && await rewardsOnce(run, other);
  const hv = await view(host); run.check(hv.rematchVisible, 'host: Play Again hidden after normal end');
};

// 2. Dies -> See Results -> (a) stay, (b) Menu, (c) Play Again
for (const who of ['host', 'client']) for (const sub of ['a-stay', 'b-menu', 'c-again']) S[`S2${sub}-${who}`] = async (run) => {
  const { host, c, cpid } = await match(run);
  const dl = who === 'host' ? 'host' : 'c1', dpid = who === 'host' ? 'me' : cpid, other = who === 'host' ? 'c1' : 'host';
  const dp = run.pages[dl], op = run.pages[other];
  await dieAndModal(run, host, dl, dpid);
  await tap(dp, '#m-dead [data-act="results"]');
  let v = await view(dp);
  run.check(v.modals.includes('m-results'), `${dl}: results modal did not open`);
  run.note(`${dl} results title "${v.rTitle}", Play Again ${v.rematchVisible ? 'visible' : 'hidden'}`);
  await run.shot(dl, 'results-early');
  if (sub === 'a-stay') {
    await expectAdvancing(run, other, 4000, 'after dead player opened results');
    await finish(run, host, [who === 'host' ? cpid : 'me']);
    run.check(await waitResults(op), `${other}: no results at match end`);
    await sleep(5500); v = await view(dp);
    run.check(v.modals.includes('m-results'), `${dl}: results closed unexpectedly`);
    if (who === 'host') run.check(v.rematchVisible, 'host: after match ended, Play Again on the early-opened results is still hidden (cannot rematch the group)');
    await run.shot(dl, 'after-end'); await run.shot(other, 'after-end');
    await rewardsOnce(run, dl);
  } else if (sub === 'b-menu') {
    const cf = await pressMenu(run, dl, 'no');
    if (cf) {
      // "Keep spectating": match must still be alive for everyone
      const sv = await view(dp); run.check(sv.screen === 's-game', `${dl}: Stay/Keep spectating left the game screen (${sv.screen})`);
      await expectAdvancing(run, other, 3000, 'after host chose to stay');
      await expectAdvancing(run, dl, 2000, 'host after choosing to stay');
      await run.shot(dl, 'stayed');
      run.check(!sv.modals.includes('m-results') && await L.visible(dp, '#spec-bar'), `${dl}: confirm button says "Keep spectating" but host is left on the results screen [${sv.modals}]`);
      if (!(await L.visible(dp, '#m-results [data-act="to-title"]'))) { await tap(dp, '#spec-bar [data-act="results"]').catch(() => {}); }
      await pressMenu(run, dl, 'yes');
    } else if (who === 'host') run.check(false, 'host: no warning before Menu ends the live match for every client');
    await screenIs(run, dl, 's-title');
    const ov = await view(op);
    run.note(`${other} after ${dl} left: screen=${ov.screen} modals=[${ov.modals}] title="${ov.rTitle}" toasts=${JSON.stringify(ov.toasts)}`);
    await run.shot(other, 'after-other-menu'); await run.shot(dl, 'after-menu');
    if (who === 'client') {
      const feed = await op.evaluate(() => document.querySelector('#h-feed').textContent);
      run.note(`host feed after dead client left: "${feed}"`);
      run.check(!/takes over/.test(feed), `host: feed says a bot "takes over" for an already-eliminated client: "${feed}"`);
      await expectAdvancing(run, other, 4000, `after ${dl} pressed Menu`);
    }
    else if (!cf) run.check(!ov.modals.includes('m-results'), `${other}: match ended for them when ${dl} pressed Menu (results "${ov.rTitle}", toasts ${JSON.stringify(ov.toasts)})`);
    else run.check(ov.modals.includes('m-results') && (/\bhost\b/i.test(ov.rTitle || '') || ov.toasts.some((t) => /\bhost\b/i.test(t))), `${other}: no clear feedback after host confirmed leaving`);
    if (who === 'host' && ov.modals.includes('m-results')) run.check(ov.rTitle !== 'Forfeit', `${other}: results say "Forfeit" although the HOST left (client did not forfeit)`);
  } else {
    if (v.rematchVisible) { await tap(dp, '#btn-rematch'); await sleep(1000); v = await view(dp); run.note(`${dl} pressed Play Again -> ${v.screen} [${v.modals}] toasts ${JSON.stringify(v.toasts)}`); }
    else run.note(`${dl}: Play Again not offered while match is live`);
    await expectAdvancing(run, other, 4000, `after ${dl} looked for Play Again`);
    await finish(run, host, [who === 'host' ? cpid : 'me']);
    run.check(await waitResults(op), `${other}: no results at match end`);
    await sleep(5500); v = await view(dp);
    run.note(`${dl} after match end: Play Again ${v.rematchVisible ? 'visible' : 'hidden'}`);
    if (who === 'host') run.check(v.rematchVisible, 'host: Play Again never becomes available on the early results screen after the match ends');
    await run.shot(dl, 'after-end');
  }
};

// 2d. Dies -> See Results -> Spectate (new Keep Spectating button) -> match end -> results
for (const who of ['host', 'client']) S[`S2d-keepspec-${who}`] = async (run) => {
  const { host, cpid } = await match(run);
  const dl = who === 'host' ? 'host' : 'c1', other = who === 'host' ? 'c1' : 'host', dp = run.pages[dl];
  await dieAndModal(run, host, dl, who === 'host' ? 'me' : cpid);
  await tap(dp, '#m-dead [data-act="results"]');
  if (!run.check(await L.visible(dp, '#btn-keepspec'), `${dl}: results screen offers no way back to spectating`)) return;
  await tap(dp, '#btn-keepspec');
  const v = await view(dp); run.check(!v.modals.includes('m-results') && await L.visible(dp, '#spec-bar'), `${dl}: not spectating after Spectate [${v.modals}]`);
  await expectAdvancing(run, dl, 3000, 'spectating from results'); await expectAdvancing(run, other, 2000);
  await run.shot(dl, 'keepspec');
  if (await L.visible(dp, '#spec-bar [data-act="spec-next"]')) { await tap(dp, '#spec-bar [data-act="spec-next"]'); await tap(dp, '#spec-bar [data-act="spec-prev"]'); }
  await finish(run, host, [who === 'host' ? cpid : 'me']);
  run.check(await waitResults(dp), `${dl}: no final results`); run.check(await waitResults(run.pages[other]), `${other}: no final results`);
  await sleep(5500);
  const f = await view(dp); run.check(!f.modals.includes('m-confirm'), `${dl}: stray confirm`);
  if (who === 'host') run.check(f.rematchVisible, 'host: Play Again hidden on final results after spectating');
  await run.shot(dl, 'final'); await rewardsOnce(run, dl);
};

// 3. Alive player forfeits via pause menu
for (const who of ['host', 'client']) S[`S3-forfeit-${who}`] = async (run) => {
  const { host, c, cpid } = await match(run);
  const fl = who === 'host' ? 'host' : 'c1', other = who === 'host' ? 'c1' : 'host', fp = run.pages[fl];
  await tap(fp, '#s-game [data-act="menu"]');
  await tap(fp, '#m-menu [data-act="forfeit"]');
  const v = await view(fp); run.check(v.modals.includes('m-results') && v.rTitle === 'Forfeit', `${fl}: forfeit results "${v.rTitle}" [${v.modals}]`);
  await run.shot(fl, 'forfeit');
  await sleep(800);
  const bot = (await L.pids(host)).find((u) => u.pid === (who === 'host' ? 'me' : cpid));
  run.check(bot && bot.bot, `${fl}: forfeited unit not handed to AI`);
  await expectAdvancing(run, other, 4000, 'after forfeit');
  const after = await view(fp); run.check(after.played - run.before[fl].played === 1, `${fl}: forfeit recorded ${after.played - run.before[fl].played} times`);
  // Then the forfeiter presses Menu - does it kill everyone's match?
  run.note(`${fl} forfeit results: keep-spectating ${await L.visible(fp, '#btn-keepspec') ? 'offered' : 'not offered'}`);
  const cf = await pressMenu(run, fl, 'yes');
  const ov = await view(run.pages[other]);
  if (who === 'host' && !cf) run.check(false, 'host: forfeit then Menu ends the match for clients with no warning');
  if (who === 'client' || !cf) run.check(!ov.modals.includes('m-results'), `${other}: match ended when forfeiting ${fl} pressed Menu ("${ov.rTitle}", ${JSON.stringify(ov.toasts)})`);
  else { run.note(`${other} after host forfeit+confirm: "${ov.rTitle}" ${JSON.stringify(ov.toasts)}`); run.check(ov.rTitle !== 'Forfeit', `${other}: results say "Forfeit" although the HOST left`); }
  await run.shot(other, 'after-forfeiter-menu');
  if (!ov.modals.includes('m-results') && !(await view(run.pages[other])).over) await expectAdvancing(run, other, 3000, 'after forfeiter Menu');
};

// 4. Tab close / reload
S['S4a-client-close'] = async (run) => {
  const { host, c, cpid } = await match(run);
  await c.close(); await sleep(1500);
  const u = (await L.pids(host)).find((x) => x.pid === cpid);
  run.check(u && u.bot, 'host: closed client not handed to AI (pagehide/bye not delivered)');
  await expectAdvancing(run, 'host', 5000, 'after client tab close');
  await finish(run, host, ['me']); run.check(await waitResults(host), 'host: no results');
  await rewardsOnce(run, 'host');
};
S['S4b-client-reload'] = async (run) => {
  const { host, c, cpid, code } = await match(run);
  await c.reload({ waitUntil: 'load' }); await c.waitForFunction(() => window.__cc);
  await c.evaluate(() => { window.__toasts = []; const t = document.querySelector('#toast'); new MutationObserver(() => { if (t.textContent) window.__toasts.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true }); });
  await sleep(1200);
  const u = (await L.pids(host)).find((x) => x.pid === cpid);
  run.check(u && u.bot, 'host: reloaded client not handed to AI');
  await expectAdvancing(run, 'host', 4000, 'after client reload');
  const cv = await view(c); run.note(`client after reload: ${cv.screen}`);
  await L.clientJoin(run, 'c1', code, { expect: 'none' });
  const rv = await view(c); run.note(`client rejoin attempt: "${rv.joinStatus}" screen ${rv.screen}`);
  run.check(rv.screen === 's-game', `c1: cannot rejoin the running match after reload ("${rv.joinStatus}")`);
  await run.shot('c1', 'rejoin');
};
S['S4c-host-close'] = async (run) => {
  const { host, c } = await match(run);
  run.before.c1 = await view(c);
  await host.close(); await sleep(1500);
  const v = await view(c);
  run.check(v.modals.includes('m-results'), `c1: no feedback after host closed (${v.screen} [${v.modals}])`);
  run.note(`c1 after host close: "${v.rTitle}" toasts ${JSON.stringify(v.toasts)} marks +${v.marks - run.before.c1.marks}`);
  run.check(v.rTitle !== 'Forfeit', `c1: results say "Forfeit" although the HOST closed the tab`);
  await run.shot('c1', 'host-closed');
  await rewardsOnce(run, 'c1');
  await tap(c, '#m-results [data-act="to-title"]'); await screenIs(run, 'c1', 's-title');
};

// 5. Normal end -> host Play Again
S['S5a-rematch'] = async (run) => {
  const { host, c } = await match(run);
  await finish(run, host, ['me']);
  run.check(await waitResults(host), 'host: no results'); run.check(await waitResults(c), 'c1: no results');
  await sleep(1500);
  const cv = await view(c); run.note(`c1 results: Play Again ${cv.rematchVisible ? 'visible' : 'hidden'}`);
  await tap(host, '#btn-rematch');
  const hv = await view(host); run.check(hv.screen === 's-host' && hv.players === 8, `host: rematch lobby ${hv.screen} players ${hv.players}`);
  await sleep(800); const cv2 = await view(c); run.note(`c1 while host is in rematch lobby: ${cv2.screen} [${cv2.modals}]`);
  await run.shot('c1', 'waiting-rematch');
  const before = await view(c);
  await tap(host, '#btn-start-host');
  const ok = await waitFor(c, (t) => window.__cc.game.s && !window.__cc.game.s.over && window.__cc.game.s.turnNo < 50 && document.querySelector('#m-results').classList.contains('hidden'), null, 8000);
  run.check(ok, 'c1: did not enter the rematch');
  await host.evaluate(() => { window.__cc.session.host.fast = true; }); await sleep(3500);
  await autoplay(host); await autoplay(c);
  await expectAdvancing(run, 'c1', 3000, 'in rematch');
  run.before = { host: await view(host), c1: await view(c) };
  await finish(run, host, [await L.clientPid(c)]);
  run.check(await waitResults(c), 'c1: no rematch results');
  await rewardsOnce(run, 'c1'); await rewardsOnce(run, 'host');
};
S['S5b-rematch-one-left'] = async (run) => {
  const { host, cs, code } = await match(run, { clients: 2, bots: 5 });
  await finish(run, host, ['me']);
  for (const p of [host, ...cs]) run.check(await waitResults(p), 'no results on a page');
  await tap(cs[1], '#m-results [data-act="to-title"]'); await sleep(800);
  await tap(host, '#btn-rematch'); await sleep(500);
  const hv = await view(host); run.check(hv.players === 7, `host rematch lobby has ${hv.players} players (expected 7 after c2 left)`);
  await tap(host, '#btn-start-host');
  run.check(await waitFor(cs[0], () => window.__cc.game.s && !window.__cc.game.s.over && window.__cc.game.s.turnNo < 50 && document.querySelector('#m-results').classList.contains('hidden'), null, 8000), 'c1: did not enter rematch');
  const c2 = await view(cs[1]); run.check(c2.screen === 's-title', `c2 (left) pulled back into game: ${c2.screen}`);
  // c2 tries to rejoin same code while rematch is live
  await L.clientJoin(run, 'c2', code, { expect: 'none' });
  run.note(`c2 rejoin during rematch: "${(await view(cs[1])).joinStatus}"`);
};

// 6. Duel and Blitz
for (const who of ['host', 'client']) S[`S6-duel-${who}-dies`] = async (run) => {
  const { host, c, cpid } = await match(run, { mode: 'duel', bots: 0 });
  const dl = who === 'host' ? 'host' : 'c1', other = who === 'host' ? 'c1' : 'host';
  await hostKill(host, who === 'host' ? 'me' : cpid);
  run.check(await waitResults(run.pages[dl], 9000), `${dl}: no results after duel loss`);
  run.check(await waitResults(run.pages[other], 9000), `${other}: no results after duel win`);
  const a = await view(run.pages[dl]), b = await view(run.pages[other]);
  run.check(b.rTitle === 'Checkmate', `${other}: winner title "${b.rTitle}"`);
  run.note(`duel: loser "${a.rTitle}", winner "${b.rTitle}", host Play Again ${(await view(host)).rematchVisible}`);
  await run.shot(dl, 'duel-results'); await run.shot(other, 'duel-results');
  await rewardsOnce(run, dl); await rewardsOnce(run, other);
};
for (const who of ['host', 'client']) S[`S6-blitz-${who}-spectate`] = async (run) => {
  const { host, c, cpid } = await match(run, { mode: 'blitz', auto: false });
  const dl = who === 'host' ? 'host' : 'c1', other = who === 'host' ? 'c1' : 'host';
  await dieAndModal(run, host, dl, who === 'host' ? 'me' : cpid);
  await tap(run.pages[dl], '#m-dead [data-act="spectate"]');
  // survivor is idle: the 15s Blitz timer must keep the match moving
  const a = await advancing(run.pages[dl], 20000);
  run.check(a.moved && a.to - a.from >= 8, `${dl}: blitz match stalled while ${other} idle (${a.from}->${a.to})`);
  const tos = await run.pages[other].evaluate(() => window.__toasts.filter((t) => /Time ran out/.test(t)).length);
  run.note(`blitz: ${other} timed out ${tos}x in 20s`);
  await finish(run, host, [who === 'host' ? cpid : 'me']);
  run.check(await waitResults(run.pages[dl]), `${dl}: no results`); run.check(await waitResults(run.pages[other]), `${other}: no results`);
  await rewardsOnce(run, dl);
};

// 7. Lobby: full, kick, rejoin
S['S7-lobby-full-kick-rejoin'] = async (run) => {
  const { host, code } = await L.hostLobby(run, { mode: 'duel' });
  const c1 = await L.clientJoin(run, 'c1', code);
  const c2 = await L.clientJoin(run, 'c2', code, { expect: 'none' });
  const c3 = await L.clientJoin(run, 'c3', code, { expect: 'none' });
  for (const l of ['c2', 'c3']) { const v = await view(run.pages[l]); run.check(/full/.test(v.joinStatus), `${l}: expected full, got "${v.joinStatus}"`); run.note(`${l}: "${v.joinStatus}"`); }
  let hv = await view(host); run.check(hv.players === 2, `host lobby ${hv.players} players`);
  await run.shot('c2', 'full');
  // kick c1
  const kickPid = await host.evaluate(() => window.__cc.session.players[1].pid);
  await tap(host, `[data-kick="${kickPid}"]`); await sleep(800);
  const k = await view(c1); run.note(`c1 after kick: "${k.joinStatus}", stale lobby rows ${k.joinLobby}`);
  run.check(!/full/.test(k.joinStatus), `c1: kicked player told "${k.joinStatus}" (misleading)`);
  await run.shot('c1', 'kicked');
  hv = await view(host); run.check(hv.players === 1, `host lobby after kick ${hv.players}`);
  // c2 retries and gets in
  await L.clientJoin(run, 'c2', code);
  // c2 leaves and rejoins with the same code
  await tap(c2, '#s-join [data-act="leave-lobby"]'); await sleep(800);
  hv = await view(host); run.check(hv.players === 1, `host lobby after c2 left ${hv.players}`);
  await L.clientJoin(run, 'c2', code);
  hv = await view(host); run.check(hv.players === 2, `host lobby after rejoin ${hv.players}`);
  // kicked c1 rejoins
  const c1v = await L.clientJoin(run, 'c1', code, { expect: 'none' }); const v1 = await view(c1v);
  run.note(`c1 rejoin while full: "${v1.joinStatus}"`);
  await L.startMatch(run, host, { clients: [c2] });
  run.check((await view(c2)).screen === 's-game', 'c2: did not start duel');
};


// ---------- 5.0: Squads and Siege ----------
// Team-aware elimination: mirrors engine kill() for Squads/Siege (soul when a teammate lives, team placement, shared victory).
async function teamKill(host, pid, { soul = true } = {}) {
  return host.evaluate(async ([pid, soul]) => {
    if (window.__protect) window.__protect.delete(pid);
    const E = await import('/js/engine.js'); const h = window.__cc.session.host, s = h.s;
    const v = s.units.find((u) => u.pid === pid && u.kind === 'player'); if (!v || !v.alive || s.over) return false;
    v.alive = false; v.hp = 0;
    const ev = [{ e: 'death', id: v.id, by: null, x: v.x, y: v.y, cause: null }];
    const mates = s.units.filter((w) => w.kind === 'player' && w.alive && E.ally(w, v));
    if (s.siege) {
      v.place = 0;
      if (E.alivePlayers(s).length) { if (soul) { s.items.push({ x: v.x, y: v.y, k: 'soul', n: 1, id: v.id, team: v.team, exp: s.round + 3 }); ev.push({ e: 'soul', id: v.id, x: v.x, y: v.y }); } }
      else { s.over = true; s.winner = null; s.items = s.items.filter((i) => i.k !== 'soul'); for (const p of s.units) if (p.kind === 'player') p.place = 2; ev.push({ e: 'over', winner: null, siege: true, wave: s.siege.wave }); }
    } else {
      if (mates.length) { v.place = 0; if (soul) { s.items.push({ x: v.x, y: v.y, k: 'soul', n: 1, id: v.id, team: v.team, exp: s.round + 3 }); ev.push({ e: 'soul', id: v.id, x: v.x, y: v.y }); } }
      else { const place = E.teamsAlive(s).size + 1; for (const w of s.units) if (w.kind === 'player' && (w === v || (v.team != null && w.team === v.team))) w.place = place; s.items = s.items.filter((i) => !(i.k === 'soul' && i.team === v.team)); }
      const left = E.teamsAlive(s);
      if (left.size <= 1) { const alive = E.alivePlayers(s); s.over = true; s.winner = alive[0] ? alive[0].id : null; for (const w of s.units) if (w.kind === 'player' && alive[0] && (w === alive[0] || E.ally(w, alive[0]))) w.place = 1; ev.push({ e: 'over', winner: s.winner, team: alive[0] ? alive[0].team : null }); }
    }
    if (!s.over && s.active === v.id) E.nextTurn(s, ev);
    s.v++; h.publish(ev); h.schedule();
    return true;
  }, [pid, soul]);
}
const lobbyTags = (p, sel) => p.evaluate((sel) => [...document.querySelectorAll(sel + ' .team-tag')].map((t) => t.textContent), sel);
const deadView = (p) => p.evaluate(() => ({ open: !document.querySelector('#m-dead').classList.contains('hidden'), title: document.querySelector('#m-dead h3').textContent, results: !document.querySelector('#m-dead [data-act="results"]').classList.contains('hidden'), body: document.querySelector('#m-dead').innerText.replace(/\s+/g, ' ').trim() }));
// "Can this dead player open results right now?" - any visible results entry point, or results already open.
const canOpenResults = (p) => p.evaluate(() => {
  const vis = (sel) => { const e = document.querySelector(sel); if (!e || e.closest('.hidden')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return { deadBtn: vis('#m-dead [data-act="results"]'), specBtn: vis('#spec-bar [data-act="results"]'), open: !document.querySelector('#m-results').classList.contains('hidden') };
});
const mySoul = (p) => p.evaluate(() => { const g = window.__cc.game; return !!(g.s && g.me && g.s.items.some((i) => i.k === 'soul' && i.id === g.me.id)); });

// 8. Squads: host + friend are Team 1 with 6 bots. Friend dies -> Downed, spectates, cannot open results while the host lives -> team wins -> both see Squad Victory.
S['S8-squads-team-spectate'] = async (run) => {
  const { host, code } = await L.hostLobby(run, { mode: 'squads' });
  const c = await L.clientJoin(run, 'c1', code);
  for (let i = 0; i < 6; i++) await tap(host, '[data-act="add-bot"]');
  await sleep(500);
  const tags = await lobbyTags(c, '#join-lobby');
  const label = await c.evaluate(() => document.querySelector('#join-lobby-panel .lbl').textContent);
  run.note(`c1 lobby: "${label}" tags ${JSON.stringify(tags)}`);
  run.check(tags.length === 8 && tags[0] === 'Team 1' && tags[1] === 'Team 1' && tags[7] === 'Team 4', `c1: lobby team labels wrong ${JSON.stringify(tags)}`);
  run.check(/Squads/.test(label), `c1: lobby label "${label}" does not name Squads`);
  await run.shot('c1', 'lobby');
  await L.startMatch(run, host, { clients: [c] });
  const cpid = await L.clientPid(c);
  run.before = { host: await view(host), c1: await view(c) };
  const teams = await host.evaluate((cp) => { const s = window.__cc.session.host.s; const t = (pid) => s.units.find((u) => u.pid === pid).team; return { host: t('me'), c1: t(cp), mode: s.mode, teams: s.teams }; }, cpid);
  run.check(teams.teams === 2 && teams.host === teams.c1, `host and c1 not on the same team ${JSON.stringify(teams)}`);
  const hud = await c.evaluate(() => document.querySelector('#h-alive').innerText);
  run.check(/HostH/i.test(hud), `c1: HUD does not show teammate HostH ("${hud}")`);
  await autoplay(host); await autoplay(c); await L.protectHumans(host);
  // friend goes down
  await teamKill(host, cpid);
  run.check(await waitDead(c), 'c1: Downed modal never appeared');
  let d = await deadView(c);
  run.note(`c1 dead modal: "${d.body}"`);
  run.check(d.title === 'Downed', `c1: dead modal title "${d.title}" (expected Downed while soul is up)`);
  run.check(!d.results, 'c1: See Results offered while teammate is alive');
  await run.shot('c1', 'downed');
  await tap(c, '#m-dead [data-act="spectate"]');
  run.check(await L.visible(c, '#spec-bar'), 'c1: not spectating after Spectate');
  let cr = await canOpenResults(c); run.check(!cr.specBtn && !cr.open, `c1: can open results while spectating with teammate alive ${JSON.stringify(cr)}`);
  await expectAdvancing(run, 'c1', 3000, 'while downed teammate spectates');
  await run.shot('c1', 'spectating');
  // wait for the soul to resolve (fade after 3 rounds, or a revive)
  await waitFor(c, () => { const g = window.__cc.game; return g.me.alive || !g.s.items.some((i) => i.k === 'soul' && i.id === g.me.id); }, null, 30000);
  const cv = await view(c); run.note(`c1 soul resolved: alive=${cv.alive}`);
  if (!cv.alive) {
    await sleep(800);
    cr = await canOpenResults(c); d = await deadView(c);
    run.check(!cr.specBtn && !cr.deadBtn && !cr.open, `c1: after soul faded (host alive) results reachable ${JSON.stringify(cr)} modal "${d.body}"`);
    await run.shot('c1', 'soul-faded');
  }
  // finish: eliminate every other team
  const others = (await L.pids(host)).filter((u) => u.pid !== 'me' && u.pid !== cpid);
  for (const u of others) { await teamKill(host, u.pid, { soul: false }); await sleep(80); }
  run.check(await waitResults(host), 'host: no final results'); run.check(await waitResults(c), 'c1: no final results');
  await sleep(1500);
  const hv = await view(host), fv = await view(c);
  const hp = await host.textContent('#r-place'), cpl = await c.textContent('#r-place');
  run.note(`final: host "${hv.rTitle}" / "${hp}", c1 "${fv.rTitle}" / "${cpl}"`);
  run.check(hv.rTitle === 'Squad Victory', `host: final title "${hv.rTitle}"`);
  run.check(fv.rTitle === 'Squad Victory', `c1: final title "${fv.rTitle}" (team won, should share the victory)`);
  run.check(/teams/i.test(hp) && /teams/i.test(cpl), `placement text lacks "teams": host "${hp}" c1 "${cpl}"`);
  run.check(hv.rematchVisible, 'host: Play Again hidden after squads end');
  await run.shot('host', 'results'); await run.shot('c1', 'results');
  await rewardsOnce(run, 'host'); await rewardsOnce(run, 'c1');
};

// 8b. Squads: whole friend team wiped while other teams fight on -> results become available mid-match.
S['S8b-squads-team-out'] = async (run) => {
  const { host, c, cpid } = await match(run, { mode: 'squads', bots: 6 });
  await teamKill(host, cpid, { soul: false });
  run.check(await waitDead(c), 'c1: dead modal never appeared');
  let cr = await canOpenResults(c); run.check(!cr.deadBtn, `c1: results offered while host teammate lives ${JSON.stringify(cr)}`);
  await tap(c, '#m-dead [data-act="spectate"]');
  await teamKill(host, 'me', { soul: false });
  run.check(await waitDead(host), 'host: dead modal never appeared');
  await sleep(800);
  const hv = await view(host);
  run.check(!hv.over, 'match ended although 3 teams remain');
  cr = await canOpenResults(c); const hd = await deadView(host);
  run.note(`after team wiped: c1 ${JSON.stringify(cr)}; host modal "${hd.body}"`);
  run.check(cr.specBtn || cr.deadBtn, `c1: no way to open results after own team is out ${JSON.stringify(cr)}`);
  run.check(hd.results, 'host: See Results hidden after own team is out');
  await expectAdvancing(run, 'c1', 3000, 'after team 1 is out');
  await tap(host, '#m-dead [data-act="results"]');
  const r = await view(host); run.note(`host early results: "${r.rTitle}" ${await host.textContent('#r-place')}`);
  await run.shot('host', 'team-out-results');
  await finish(run, host, []);
  run.check(await waitResults(c), 'c1: no final results');
};

// 9. Siege co-op: host + friend + 1 bot ally. Friend downed -> no results while the siege runs; then seats go to the AI and the siege plays out to the end.
S['S9-siege-coop'] = async (run) => {
  const { host, code } = await L.hostLobby(run, { mode: 'siege' });
  const c = await L.clientJoin(run, 'c1', code);
  await tap(host, '[data-act="add-bot"]'); await sleep(400);
  const tags = await lobbyTags(c, '#join-lobby');
  const label = await c.evaluate(() => document.querySelector('#join-lobby-panel .lbl').textContent);
  run.note(`c1 lobby: "${label}" tags ${JSON.stringify(tags)}`);
  run.check(/Siege/.test(label) && tags.length === 3 && tags.every((t) => t === 'Ally'), `c1: siege lobby label/tags wrong "${label}" ${JSON.stringify(tags)}`);
  await L.startMatch(run, host, { clients: [c] });
  const cpid = await L.clientPid(c);
  run.before = { host: await view(host), c1: await view(c) };
  const sg = await c.evaluate(() => ({ siege: window.__cc.game.s.siege, hud: document.querySelector('#h-alive').innerText }));
  run.check(sg.siege && sg.siege.waves >= 1, `c1: no siege state ${JSON.stringify(sg)}`);
  await autoplay(host); await autoplay(c);
  // protect every defender so the run reaches the final wave deterministically
  await host.evaluate(async () => { const E = await import('/js/engine.js'); window.__protect = new Set(window.__cc.session.host.s.units.filter((u) => u.kind === 'player').map((u) => u.pid)); clearInterval(window.__pt); window.__pt = setInterval(() => { const h = window.__cc.session && window.__cc.session.host; if (!h) return; for (const u of h.s.units) if (u.alive && window.__protect.has(u.pid) && u.hp < E.stats(u).maxHp * 0.6) u.hp = E.stats(u).maxHp; }, 30); });
  await sleep(1500);
  await teamKill(host, cpid);
  if (!(await waitDead(c))) {
    const st = await c.evaluate(() => { const g = window.__cc.game; return { alive: g.me.alive, soul: g.s.items.some((i) => i.k === 'soul' && i.id === g.me.id), feed: document.querySelector('#h-feed').innerText.replace(/\s+/g, ' ') }; });
    run.note(`c1 downed then back before the modal showed: ${JSON.stringify(st)}`);
    run.check(st.alive, 'c1: siege dead modal never appeared and c1 is not alive');
    if (st.alive) { await teamKill(host, cpid, { soul: false }); run.check(await waitDead(c), 'c1: siege dead modal never appeared (no soul)'); }
  }
  const d = await deadView(c); run.note(`c1 siege dead modal: "${d.body}"`);
  run.check(!d.results, 'c1: See Results offered during a live siege');
  await tap(c, '#m-dead [data-act="spectate"]');
  let cr = await canOpenResults(c); run.check(!cr.specBtn && !cr.open, `c1: results reachable while the siege runs ${JSON.stringify(cr)}`);
  await run.shot('c1', 'siege-spectate');
  // hand both human seats to the AI and let the siege play out
  await autoplay(host, false); await autoplay(c, false);
  await host.evaluate((cp) => { const h = window.__cc.session.host; h.fast = true; h.setBot('me'); h.setBot(cp); }, cpid);
  let last = -1; const t0 = Date.now();
  while (Date.now() - t0 < 9 * 60000) {
    const st = await host.evaluate(() => { const s = window.__cc.session.host.s; return { over: s.over, wave: s.siege.wave, round: s.round }; });
    if (st.wave !== last) { last = st.wave; run.note(`wave ${st.wave} at round ${st.round} (${Math.round((Date.now() - t0) / 1000)}s)`); }
    if (st.over) break;
    await sleep(1000);
  }
  run.check(await waitResults(host, 15000), 'host: no siege results'); run.check(await waitResults(c, 15000), 'c1: no siege results');
  await sleep(1500);
  const out = {}; for (const [l, p] of [['host', host], ['c1', c]]) out[l] = { title: await p.textContent('#r-title'), place: await p.textContent('#r-place'), stat: await p.evaluate(() => document.querySelector('#r-stats').innerText.replace(/\s+/g, ' ')) };
  run.note(`siege results ${JSON.stringify(out)}`);
  for (const l of ['host', 'c1']) {
    run.check(out[l].title === 'The Line Held', `${l}: siege title "${out[l].title}"`);
    run.check(/Survived (\d+) of \1 waves/i.test(out[l].place), `${l}: siege text "${out[l].place}"`);
    run.check(/Hollows/i.test(out[l].stat), `${l}: siege stats do not count Hollows "${out[l].stat}"`);
  }
  await run.shot('host', 'siege-results'); await run.shot('c1', 'siege-results');
  await rewardsOnce(run, 'host'); await rewardsOnce(run, 'c1');
};

// ---------- runner ----------
(async () => {
  const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const iters = +arg('--iters', 3), par = +arg('--par', 3), only = arg('--only', '');
  const names = Object.keys(S).filter((n) => !only || only.split(',').some((o) => n.startsWith(o)));
  const jobs = []; for (const n of names) for (let i = 1; i <= iters; i++) jobs.push([n, i]);
  const fp = () => require('child_process').execSync(`cd ${process.env.CC_SRC || require('path').resolve(__dirname, '../..')} && cat js/*.js index.html | md5sum`).toString().slice(0, 8);
  const fp0 = fp(); console.log('source fingerprint', fp0);
  const browser = await L.chromium.launch();
  const results = [];
  const worker = async () => {
    while (jobs.length) {
      const [n, i] = jobs.shift(); const run = new L.Run(browser, n, i); const t0 = Date.now();
      try { await run.open(); await S[n](run); } catch (e) { run.fails.push('EXCEPTION ' + e.message.split('\n')[0]); for (const l of Object.keys(run.pages)) await run.shot(l, 'exception'); }
      for (const [lbl, pg] of Object.entries(run.pages)) for (const b of pg.__blocked || []) run.notes.push(`BLOCKED-TAP [${lbl}] ${b}`);
      const f = fp(); if (f !== fp0) run.notes.push(`SOURCE CHANGED during run (${fp0} -> ${f})`);
      const r = { name: n, iter: i, src: f, ok: !run.fails.length && !run.errors.length, fails: run.fails, errors: run.errors, notes: run.notes, ms: Date.now() - t0 };
      results.push(r); console.log(`${r.ok ? 'PASS' : 'FAIL'} ${n} #${i} (${(r.ms / 1000).toFixed(0)}s)${r.ok ? '' : '\n   ' + [...r.fails, ...r.errors].join('\n   ')}${r.notes.length ? '\n   . ' + r.notes.join('\n   . ') : ''}`);
      await run.close();
    }
  };
  await Promise.all(Array.from({ length: par }, worker));
  await browser.close();
  fs.writeFileSync(require('path').join(require('os').tmpdir(), (process.env.CC_TAG || 'results') + '.json'), JSON.stringify(results, null, 1));
  console.log('\n==== SUMMARY ====');
  for (const n of names) { const rs = results.filter((r) => r.name === n); console.log(`${rs.every((r) => r.ok) ? 'PASS' : 'FAIL'} ${n}  ${rs.filter((r) => r.ok).length}/${rs.length}`); }
})();

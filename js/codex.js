// Codex: skill breakdowns with shape diagrams generated from the real rules engine.
import { PIECES, ABILITIES, PASSIVES, EVOLVE_COST, honeCost, COMBOS, DISCOVERIES, WORLD_EVENTS, ATTUNE, STAT_GAIN } from './data.js';
import { abilityOptions, legalMoves } from './engine.js';
import { drawPiece, pieceIcon } from './pieces.js';

const ORDER = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const TARGETS = { shove: [[1, 0]], pickpocket: [[1, 0]], transpose: [[2, -2]], castling: [[0, -3]], execute: [[2, 1]], charge: [[0, -3]], siege: [[0, -4]] };

function synthState(piece, abilityId) {
  const tiles = []; for (let i = 0; i < 256; i++) tiles.push({ t: 'floor' });
  const u = { id: 1, kind: 'player', pid: 'x', piece, hone: {}, pts: { hp: 0, atk: 0, def: 0, spd: 0 }, passive: 'regen', equips: {}, x: 8, y: 8, hp: 100, cd: { sig: 0, eq: 0 }, buffs: [], alive: true, attune: 0, ult: 100, mark: null, shards: 0, momentum: 0 };
  if (piece === 'king') u.kingStats = { hp: 150, atk: 20, def: 12, spd: 8 };
  const units = [u];
  (TARGETS[abilityId] || []).forEach(([dx, dy], i) => units.push({ id: 10 + i, kind: 'hollow', dummy: true, piece: 'hollow', x: 8 + dx, y: 8 + dy, hp: 40, hpMax: 40, cd: {}, buffs: [], alive: true, hone: {}, shards: 0 }));
  if (abilityId === 'blink') u.mark = { x: 6, y: 6 };
  const s = { tiles, units, items: [], storm: { ring: 0, crack: false }, turn: { moved: false, acted: false, extraMoves: 0 }, active: 1, seed: 1 };
  return { s, u };
}
function slotFor(piece, id) {
  const P = PIECES[piece];
  if (P.attack === id) return 'atk'; if (P.sig === id) return 'sig'; if (P.ult === id) return 'ult'; return 'eq';
}

const cache = new Map();
export function diagram(piece, abilityId, px = 108, skin = 'ivory') {
  const key = piece + abilityId + px + skin;
  if (cache.has(key)) return cache.get(key);
  const { s, u } = synthState(piece, abilityId);
  let tiles = [], show = [], anchor = null, util = false, moves = [];
  if (abilityId === 'move') moves = legalMoves(s, u);
  else {
    const slot = slotFor(piece, abilityId);
    if (slot === 'eq') u.equips[piece] = abilityId;
    const opts = abilityOptions(s, u, slot);
    const best = opts.find((o) => o.hits && o.hits.length) || opts.find((o) => o.anchor.y < 8 && o.anchor.x === 8) || opts[0];
    for (const o of opts) tiles.push(...o.tiles);
    if (best) { show = best.tiles; anchor = best.anchor; util = !(best.mult > 0); }
  }
  const pts = [...tiles, ...moves, ...s.units.filter((v) => v !== u), ...(u.mark ? [u.mark] : [])];
  const maxd = pts.reduce((m, p) => Math.max(m, Math.abs(p.x - 8), Math.abs(p.y - 8)), 1);
  const W = Math.min(11, Math.max(5, 2 * maxd + 3)), C = (W - 1) / 2;
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = px * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const t = px / W;
  const inWin = (p) => Math.abs(p.x - 8) <= C && Math.abs(p.y - 8) <= C;
  const toPx = (p) => [(p.x - 8 + C) * t, (p.y - 8 + C) * t];
  for (let yy = 0; yy < W; yy++) for (let xx = 0; xx < W; xx++) { x.fillStyle = (xx + yy) % 2 ? '#1c1928' : '#2a2638'; x.fillRect(xx * t, yy * t, t, t); }
  const fill = (list, col) => { x.fillStyle = col; for (const p of list) if (inWin(p)) { const [a, b] = toPx(p); x.fillRect(a + 1, b + 1, t - 2, t - 2); } };
  if (moves.length) fill(moves, 'rgba(93,200,255,0.55)');
  fill(tiles, util ? 'rgba(180,140,255,0.16)' : 'rgba(255,90,90,0.16)');
  fill(show, util ? 'rgba(180,140,255,0.7)' : 'rgba(255,80,80,0.72)');
  if (anchor && inWin(anchor) && !(anchor.x === 8 && anchor.y === 8)) { const [a, b] = toPx(anchor); x.strokeStyle = '#ffe3a1'; x.lineWidth = 1.5; x.strokeRect(a + 1.5, b + 1.5, t - 3, t - 3); }
  for (const v of s.units) if (v.kind === 'hollow' && inWin(v)) { const [a, b] = toPx(v); x.fillStyle = '#a7a4d6'; x.beginPath(); x.arc(a + t / 2, b + t / 2, t * 0.28, 0, Math.PI * 2); x.fill(); }
  if (u.mark) { const [a, b] = toPx(u.mark); x.strokeStyle = '#c9a6ff'; x.setLineDash([2, 2]); x.beginPath(); x.arc(a + t / 2, b + t / 2, t * 0.35, 0, Math.PI * 2); x.stroke(); x.setLineDash([]); }
  if (util && show.length === 1 && show[0].x === 8 && show[0].y === 8) { x.strokeStyle = '#c9a6ff'; x.lineWidth = 2; x.beginPath(); x.arc(C * t + t / 2, C * t + t / 2, t * 0.75, 0, Math.PI * 2); x.stroke(); x.globalAlpha = 0.5; x.beginPath(); x.arc(C * t + t / 2, C * t + t / 2, t * 1.05, 0, Math.PI * 2); x.stroke(); x.globalAlpha = 1; }
  x.save(); x.translate(C * t + t / 2, C * t + t * 0.92); x.scale(t * 1.05, t * 1.05); drawPiece(x, piece, skin, {}); x.restore();
  x.strokeStyle = 'rgba(214,176,92,0.35)'; x.lineWidth = 1; x.strokeRect(0.5, 0.5, px - 1, px - 1);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

const TAG = { atk: 'Attack', sig: 'Signature', eq: 'Equippable', ult: 'Ultimate' };
function abilityRow(piece, id, slot, skin) {
  const A = ABILITIES[id];
  const cd = slot === 'ult' ? 'Charge 100' : A.cd ? `Cooldown ${A.cd}` : slot === 'atk' ? 'Every turn' : '';
  return `<div class="cx-ab"><img src="${diagram(piece, id, 96, skin)}" alt=""><div><div class="cx-ab-h"><b>${A.name}</b><span class="tag t-${slot}">${TAG[slot]}</span>${A.free ? '<span class="tag t-free">Free</span>' : ''}</div><p>${A.desc}</p><em>${cd}${A.honed ? ` - Honed: ${A.honed}` : ''}</em></div></div>`;
}

export function renderCodex(tab, el, profile) {
  const skin = profile.skin || 'ivory';
  if (tab === 'pieces') {
    el.innerHTML = ORDER.map((pc) => {
      const P = PIECES[pc];
      const cost = pc === 'pawn' ? 'Starting piece' : pc === 'king' ? 'Claim the Crown' : `Evolve: ${EVOLVE_COST[P.tier]} shards`;
      const stats = pc === 'king' ? 'Your stats x1.1 HP, +2 ATK, +1 DEF, slower. Heals 3% per turn.' : `Base: HP ${P.hp} - ATK ${P.atk} - DEF ${P.def} - SPD ${P.spd} (your build adds on top)`;
      const rows = [abilityRow(pc, P.attack, 'atk', skin), abilityRow(pc, P.sig, 'sig', skin), ...P.equips.map((e) => abilityRow(pc, e, 'eq', skin)), abilityRow(pc, P.ult, 'ult', skin)].join('');
      return `<details class="cx-piece" ${pc === 'pawn' ? 'open' : ''}><summary><img src="${pieceIcon(pc, skin, null, 56)}" alt=""><div><b>${P.name}</b><span>${cost}</span></div><i class="chev"></i></summary>
        <div class="cx-body"><div class="cx-move"><img src="${diagram(pc, 'move', 96, skin)}" alt=""><div><b>Movement</b><p>${P.moveDesc}</p><em>${stats}</em></div></div>${rows}</div></details>`;
    }).join('') + `<p class="hint center">Blue tiles: where you can move. Red: what an attack hits. Purple: utility. The gold box is the tile you tap.</p>`;
  } else if (tab === 'passives') {
    el.innerHTML = `<div class="panel"><div class="lbl">Base Abilities</div>${Object.values(PASSIVES).map((p) => `<div class="cx-line"><b>${p.name}</b><p>${p.desc}</p></div>`).join('')}</div>
      <div class="panel"><div class="lbl">Stat Points</div><div class="cx-line"><p>You get 10 points for your Pawn build. Each point: +${STAT_GAIN.hp} HP, +${STAT_GAIN.atk} ATK, +${STAT_GAIN.def} DEF or +${STAT_GAIN.spd} SPD. Points carry into every piece. SPD above 12 counts for half.</p></div></div>
      <div class="panel"><div class="lbl">Damage</div><div class="cx-line"><p>Damage = ATK x ability power x 30 / (30 + DEF), with a small random spread. 10% of hits are critical for x1.5. Previews show the range before crits.</p></div></div>`;
  } else if (tab === 'board') {
    el.innerHTML = `
      <div class="panel"><div class="lbl">Attunement</div><div class="cx-line"><p>Every shard you collect permanently adds +${ATTUNE.hp * 100}% HP, +${ATTUNE.atk * 100}% ATK and +${ATTUNE.def * 100}% DEF, plus +1 SPD every ${ATTUNE.spdEvery} shards, up to ${ATTUNE.max}. Spending shards never removes it. Every 5 adds a crystal orbiting your piece.</p></div></div>
      <div class="panel"><div class="lbl">Promotion</div><div class="cx-line"><p>Pawn to Knight or Bishop: ${EVOLVE_COST[2]}. To Rook: ${EVOLVE_COST[3]}. To Queen: ${EVOLVE_COST[4]}. Hone instead: ${honeCost(0)}, ${honeCost(1)}, then ${honeCost(2)} shards, +15% stats each and a stronger Signature from the first level.</p></div></div>
      <div class="panel"><div class="lbl">The Storm</div><div class="cx-line"><p>From round 5 the outer ring cracks, then collapses a round later, every 3 rounds. The void burns 20% max HP per turn. When the board is fully closed, everyone burns 6% per turn.</p></div></div>
      <div class="panel"><div class="lbl">The Crown</div><div class="cx-line"><p>Appears at the centre on round 7. The holder becomes the King: more HP, healing every turn, single steps, and a new ultimate. Kill the King and the Crown drops where they fell.</p></div></div>
      <div class="panel"><div class="lbl">World Events</div>${Object.values(WORLD_EVENTS).map((w) => `<div class="cx-line"><b>${w.name}</b><p>${w.desc}.</p></div>`).join('')}<p class="hint">One hits every third round, starting on round 3.</p></div>
      <div class="panel"><div class="lbl">Terrain</div>
        <div class="cx-line"><b>Walls</b><p>Block movement, slides and most shots.</p></div>
        <div class="cx-line"><b>Rubble</b><p>Blocks until broken (2 hits). Rook Ramparts are sturdier rubble.</p></div>
        <div class="cx-line"><b>Crates</b><p>Break in one hit. Usually a shard, sometimes a potion or haste.</p></div>
        <div class="cx-line"><b>Brambles</b><p>Stop sliding pieces and cost initiative to step on.</p></div>
        <div class="cx-line"><b>Shrines</b><p>Heal 40% once, then recharge for 4 rounds.</p></div>
        <div class="cx-line"><b>Hollows</b><p>Neutral ghosts that guard shard caches. They wake up when you get close and drop 2 shards.</p></div></div>`;
  } else if (tab === 'combos') {
    const found = profile.discovered || [];
    el.innerHTML = `<p class="hint center">A few starting ideas. The best combos are yours to find.</p>
      ${COMBOS.map((c) => `<div class="cx-combo"><div class="cx-combo-h"><b>${c.name}</b>${c.pieces.map((p) => `<span class="tag">${p}</span>`).join('')}</div><p>${c.text}</p></div>`).join('')}
      <div class="lbl" style="margin-top:18px">Secret Discoveries <span class="pts">${found.length}/${Object.keys(DISCOVERIES).length}</span></div>
      <div class="cx-secrets">${Object.entries(DISCOVERIES).map(([k, d]) => found.includes(k) ? `<div class="sec found"><b>${d.name}</b><p>${d.desc}</p></div>` : `<div class="sec"><b>???</b><p>${d.hint}</p></div>`).join('')}</div>
      <p class="hint center">Each discovery pays 60 Marks the first time.</p>`;
  }
}

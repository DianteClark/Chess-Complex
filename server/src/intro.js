// 17.0 (S1): how long the server holds the first turn back while every screen plays the match intro.
// Mirrors main.js game.introBrief/introPlan/introDelay and announcer.js INTRO/introMs (those modules touch the DOM,
// so they cannot be bundled here). If D changes INTRO timings or the briefing rows, update this file too.
import { MODES, MUTATORS, WORLD_EVENTS, PASSIVES } from '../../js/data.js';
import { LOCATIONS } from '../../js/locations.js';

export const INTRO = { ct: 2500, spin: 3100, hold: 2500, brief: 6500, perRow: 1500, gap: 300, fly: 1950, net: 600 }; // 17.0 (D2): longer briefing (was brief 3200, perRow 500), same as announcer.js INTRO

export function introRows(s) {
  let rows = 0;
  if (s.mutator && s.mutator !== 'none' && MUTATORS[s.mutator]) rows++;
  const LOC = s.location && LOCATIONS[s.location];
  if (LOC && LOC.events && !(s.custom && s.custom.events === false) && Object.keys(LOC.events).some((k) => WORLD_EVENTS[k])) rows++;
  if (s.mirrorBuild && PASSIVES[s.mirrorBuild.passive]) rows++;
  return { loc: !!LOC, rows };
}

// online hold in ms (0 when the match has no intro)
export function introHold(s) {
  if (!s || s.tutorial || s.v !== 0 || s.over || !MODES[s.mode]) return 0;
  const { loc, rows } = introRows(s);
  let t = INTRO.ct + INTRO.gap;
  if (s.location) t += INTRO.spin + INTRO.hold + INTRO.gap;
  if (loc || rows) t += INTRO.brief + INTRO.perRow * Math.max(0, rows - 1) + INTRO.gap;
  return t + INTRO.fly + INTRO.net;
}

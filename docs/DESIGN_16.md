# Chess Complex 16.0: "Tactics" (lead spec, A0)

15.2 made turns round-based (every unit acts once per round, highest SPD first) and gave SPD a second job, the
Speed Edge (+/-3% damage per SPD point vs the target, cap 15%). The player loved it. 16.0 extends the same idea:
every stat and the turn order itself become decisions. Rules must be one sentence each, visible on screen when they
fire, and deterministic (seeded rand only).

## 1. Stat identities (engine: Gameplay)
Every stat keeps its base effect and gets one named secondary rule.

| Stat | Name | Rule |
|---|---|---|
| SPD | Speed Edge | (shipped) +/-3% damage per SPD point over/under the target, cap 15%. |
| ATK | Overkill | Damage past what a hit needed to eliminate a piece spills 50% into the nearest enemy of the attacker adjacent to the victim (one hop, never chains, no Overkill from Overkill, storm/hazard kills excluded). |
| DEF | Guard | A single hit can never take more than (60 - DEF)% of your max HP, floor 35%. (DEF 5 -> 55%, DEF 14 -> 46%, DEF 20+ -> 40/35%). Applies to players and the King; not to Hollows/bosses; not to storm/burn/poison ticks. |
| HP | Second Wind | Once per match, the first time a hit leaves you below 25% max HP (and alive), heal 10% max HP + 1 per HP stat point at once. |

Events: `{e:'overkill', id: killerId, from: victimId, to: splashTargetId, dmg}`, `{e:'guard', id, saved}` (saved = damage prevented, only when > 0), `{e:'secondwind', id, heal}`.

## 2. Turn-order tactics (engine: Gameplay)
- **Hold**: new action `{type:'hold'}`. Legal on your turn before you have moved or acted, once per round. You go to
  the end of this round's queue (after every unit still waiting, held units keep their own order by SPD). Cost: your
  next round starts 3 SPD later (gauge -30). Bots: use it when they cannot reach anything worthwhile this turn and an
  enemy that could threaten them acts after them (simple heuristic, rare). Event `{e:'hold', id}`.
- **Shard Interest**: at the start of each round, every player gains +1 shard for every 5 held (max +2). Event
  `{e:'interest', id, n}` (one per player who got any). Banking for a Queen is now a real plan.
- **Tempo abilities**: 4 new equips (one each for Knight, Bishop, Rook, Queen; pawn optional) built on the turn order,
  e.g. Seize (act first next round), Hourglass (target acts last next round + Slow), Anchor, Time Fracture. Gameplay
  owns names/numbers; they need unlock prices like the 15.0 equips, ABILITIES entries, desc, bot use. Event for the
  order change `{e:'tempo', id, k:'first'|'last'}` plus existing events.
- predictOrder must reflect Hold and Reversal.

## 3. New location: Clockwork Spire (Location designer)
9th World Tour location, theme: a giant clock tower, brass gears, pendulums, ticking. Must match the other 8 in the
data model (locations.js), wheel, briefing card, backdrop art (js/backdrops/spire.js, same perf rules as 15.1: cached
layers, 1:1 copies), weather (drifting brass sparks / dust in light shafts), music theme (music.js) and sounds.
- Hazard **Cogwheels** (`t:'cog'` tiles in rings of 4 around a hub): at the end of each round, a piece standing on a cog
  is carried one step clockwise to the next cog tile if it is free. Event `{e:'cog', moves:[{id, fx, fy, x, y}]}`.
- Signature event **Reversal**: telegraphed one round ahead (like the other signature events, s.locWarn); for that one
  round the order is reversed: slowest SPD acts first (Speed Edge unchanged). State `s.reversal = round`; events
  `{e:'reversal', on:true|false}`.

## 4. UI (UI director)
- Hold button in the action bar (hourglass), only enabled when legal; long-press help like the others.
- Turn strip: round divider between this round and next, a held marker, a "REVERSED" tag during Reversal.
- Callouts through the director lanes (no stacking): OVERKILL (with splash amount), GUARDED, SECOND WIND, +N INTEREST
  (subtle, own HUD shard counter tick, not a banner), HOLD, REVERSAL.
- Stat identity text in: loadout stat points rows, Codex stat panel, How to Play, tooltips/inspect. Tutorial: one line.
- Shard HUD: show "+1 next round" interest preview.

## 5. FX + Audio (VFX/Audio)
Effects and sounds for every new event: overkill spill (arc from victim to splash target), guard (shield clang, cap
flash), second wind (green updraft), interest (coin tick), hold (hourglass flip), reversal (clock rewind sweep across
the board), cog moves (gear grind), tempo abilities. Respect reduced motion and the 15.1 perf budget.

## Hard rules
docs/V10_BRIEF.md applies: Edit tool only on shared files, never git checkout/reset/stash/commit/push, coordinate in
docs/V10_NOTES.md (append-only, prefix your role code), keep 390x844 and 844x390 working, 11px text / 40px targets.

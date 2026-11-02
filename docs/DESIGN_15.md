# Chess Complex 15.0 design spec (lead: A0). Source of truth for every specialist.

Goal: the biggest update yet. Combat depth (status effects, new abilities, unlocks, Ascension, pawn promotions, boss King), the World Tour (locations with their own backdrops, weather, music, hazards and events, chosen by a wheel), parties that stay together between matches, and another round of juice and polish across UI and art. Owner decisions are final; open details are yours to decide well and document in `docs/V10_NOTES.md`.

## 1. Status effects (engine: Combat engineer)
State: `u.status = [{ k, t, n?, src? }]` (t = turns left, counts down at the affected unit's turn start). Events: `{e:'status', id, k, on:true|false, t, n}`, damage ticks as `{e:'dmg', id, n, dot:k}`.
| k | effect | default turns |
|---|---|---|
| burn | 6% max HP at turn start | 2 |
| poison | 3% max HP per stack at turn start, up to 3 stacks; healing halved | 3 |
| freeze | cannot move this turn (can act) | 1 |
| stun | cannot act this turn (can move) | 1 |
| slow | -3 SPD | 2 |
| shield | absorbs n damage before HP | 2 |
| haste | +3 SPD | 2 |
Fire removes freeze; freeze removes burn. King is not immune (it's a boss, not a god). Bots must account for statuses. Sources: abilities, passives, hazards, world events, locations.

## 2. Abilities and unlocks (Combat engineer; prices with Store designer)
- Add at least 6 new base abilities (passives) and at least 10 new equippable abilities (2 per piece), many built on status effects.
- Each PASSIVES/ABILITIES entry may carry `unlock: <marks>`; missing = free. Starting kit: exactly 5 free base abilities (regen, thorns, scavenger, momentum, first) and the first 2 equips of each piece. Everything else costs 400-1500 Marks (sidegrades, never strict upgrades). Unlocks live in `profile.unlocked` (array of `passive:<id>` / `ability:<id>`); Daily/Mirror builds, bots and the tutorial ignore locks.

## 3. Pieces, King, Ascension, pawns (Combat engineer; art by Character artist; VFX)
- Queen costs 11 total from a Pawn: `EVOLVE_COST = { 2: 2, 3: 4, 4: 5 }`.
- **Ascension:** honing a piece to level 3 makes it "Ascended" (Ascended Knight, Archbishop, Fortress Rook, Empress Queen): a piece-specific passive plus an empowered ultimate, so keeping a Knight or Bishop is a real endgame plan next to the Rook.
- **Pawn line:** two pawn-only promotions, `veteran` (Pawn +3) then `champion` (+5 more): still pawn-shaped and single-stepping, with strong stats, their own signature and ultimate. Riding the pawn to the end must be viable.
- **Boss King:** no extra damage taken, normal ultimate charge. Telegraph: one round before the Crown spawns, everyone sees where it will land (marker plus callout) so it's a race. The King becomes a raid boss: big HP pool with a boss bar visible to all, a royal aura, and phases at 66% and 33% HP (a free shockwave plus a short enrage). Weakness to strategy: slow single steps, and **Exposed**: each different attacker that hits the King in a round stacks -DEF until its next turn, so ganging up works. Target: King wins about 40% of bot Royale matches. It should feel threatening to let others have it, and beatable with teamwork.

## 4. World Tour: locations (World engineer; backdrops by Environment artists; music by Audio)
`js/locations.js` exports `LOCATIONS` (id, name, blurb, weather ids, hazard pool, event pool and weights, music theme, backdrop id, default board look) and pure helpers. At match start the host picks a location deterministically from the seed (Daily: location of the day; Custom lobby: host may pick). `s.location = id`. The location drives hazards (replacing today's random mutator roll), event pool, weather and music. The player's equipped store board is drawn over the location as the board surface; weather, music, background scenery and events always stay the location's.
| id | name | weather | hazards | signature events |
|---|---|---|---|---|
| citadel | Frost Citadel | snow | ice | Blizzard (freeze) |
| forge | Volcanic Forge | embers, ash | lava, geysers | Eruption (burn) |
| temple | Sunken Temple | rain | geysers, portals | Flood (slow) |
| gardens | Royal Gardens | petals, leaves | brambles, conveyor-free | Bloom (heal), Royal Bounty |
| ruins | Desert Ruins | sand | crumble | Sandstorm (vision), Earthquake |
| works | Iron Works | ash, fog | conveyor | War Drums, Overcharge |
| rift | Astral Rift | stars, void | portals, rift | Mana Surge, Gravity Well |
| bog | Witchwood Bog | fog | new poison pools | Toxic Fog (poison), Restless Dead |
Event shape for the reveal: `{e:'location', id}` on the first state. A spinning **location wheel** plays in the match intro (UI by Front-end designer, art by Environment artist 2), landing on the host-chosen location.

## 5. Modes regrouped (World engineer + Front-end)
Groups: **Competitive** (Royale, Blitz, Duel, Squads), **Co-op** (Siege, Gauntlet), **Party** (King of the Hill, Chaos), **Challenge** (Daily, which absorbs Mirror: everyone gets the same build of the day), and **Custom** (host lobby options: mode, location or random, mirror builds, hazards on/off, storm speed, bots). `MODES[id].group`. Remove `mirror` as its own mode (keep old ids loading safely).

## 6. Parties and online (Social engineer)
A party is a lobby that survives matches: when a match ends everyone returns to the party lobby (results, then Back to Party); the leader picks group/mode/location/bots/rules and starts; members ready up. Fix: lobby not clearing when the host leaves; a friend disconnecting mid-Siege (wave 5) must be able to rejoin automatically (and a dropped player's seat is bot-played meanwhile). No friends list yet.

## 7. UX and front end
- Default camera: 8x8 tiles around your piece (like a chessboard); second zoom level shows the whole board; a toggle button plus pinch (Rendering + Input).
- Name tags sit just above the piece, not two tiles up (Rendering).
- Title: level, title and XP bar under the logo where "10" is now (Front-end). The top-left chip opens the profile, where you edit name, title, avatar piece and skin, banner colour (Front-end + Store).
- Loadout: presets plus a **Custom** card with 3 named slots (Front-end).
- Quick chat opens to the player's favourites (6-10, default 8), with an organised "All phrases" view; first open asks the player to pick favourites (Social).
- Royal Pass: premium Crown Path track bought with **3000 Marks** per season (Store).
- Menu slowdown after leaving some modes: find and fix leaks (Rendering + QA).
- Mic crackle on the speaker's own device the whole time the mic is on (Audio + Social).

## 8. Release
Version 15.0 with a sequel-style reveal ("15") for returning players, What's New and CHANGELOG by A0.

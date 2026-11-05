# Chess Complex

**Play now: https://chess-complex.chesscomplex.workers.dev** (the original GitHub Pages copy at https://dianteclark.github.io/Chess-Complex/ still works and offers a one-tap move with your progress)

A turn-based chess battle royale for up to 8 players. Everyone starts as a Pawn on a 16x16 board. Collect Promotion Shards, evolve your piece, outlast the storm, and be the last piece standing.

## Features
- **Round-based turns:** every piece acts once per round, fastest SPD first. Every stat has an edge: Speed Edge (SPD), Overkill (ATK), Guard (DEF), Second Wind (HP). Hold your turn to act last.
- **Hybrid builds:** pick a preset or spend 10 points across HP / ATK / DEF / SPD, choose a base ability, and equip one active ability for every piece.
- **Fixed evolution path:** Pawn, then Knight or Bishop, then Rook, then Queen. Or Hone your current piece (+15% stats and a stronger signature) to stay your favourite piece all game.
- **Signature + equipped abilities with AOE shapes:** Knight T-Strike, Bishop Transpose, Rook Battering Charge, Queen Royal Decree, and more.
- **Living board:** walls, breakable rubble and crates, brambles, healing shrines, and Hollows that guard shard caches.
- **The storm:** the outer ring cracks and collapses every few rounds, then sudden death.
- **The Crown:** appears on round 7. Whoever takes it becomes King. Topple the King and the Crown shatters into 4 shards.
- **Online:** Quick Play and Browse for public matches, or friend codes for private parties, all running on a Cloudflare server (phone-hosted play as a fallback). Cloud save with transfer codes, leaderboards (Crown Rating, weekly Seasons, a server-verified Daily) and shareable replays.
- **Armory:** earn Marks every match and unlock piece sets, board themes (Marble Court, Neon Grid, Ember Forge, Moonlit Garden) and finishers (Inferno, Thunderclap, Void Rift, Midas Touch) that play when you eliminate someone.
- **Progression:** XP and levels with titles from Recruit to Legend; every level-up pays out Marks.
- **Juice:** hit-stop, slow-motion eliminations, camera punches, lunging attacks, per-ability VFX, shattering pieces, collapsing storm tiles, damage previews with KO markers, kill streak callouts, emotes, haptics and a generative soundtrack that intensifies as the match closes in.

## What's in 17.x
- **Cloud:** online matches, parties and Quick Play run on Cloudflare (Workers + Durable Objects) with lockstep sync; cloud saves without sign-up, transfer codes, leaderboards, replays, voice relay and an /admin stats page. Setup: docs/SETUP_CLOUDFLARE.md.
- **Readable combat:** one action line per turn with a tap-open Match Log, merged damage numbers, callouts saved for headline moments.

## What's in 16.0
- **Tactics:** stat edges, Hold, Shard Interest, four tempo abilities, and the Clockwork Spire location with Cogwheels and Reversal.

## What's in 15.0
- **World Tour:** 8 locations with their own scenery, weather, music, hazards and events, chosen by a wheel.
- **Raid-boss King**, **status effects**, **Ascension** and the **pawn line** so every piece can win, plus 17 new abilities with Marks unlocks.
- **Parties** that stay together between matches, automatic reconnects, a **Royal Pass** for Marks, profiles, custom build slots and an 8x8 starting zoom.

## What's in 10.0
- **Four new modes:** King of the Hill, Chaos, Gauntlet and Mirror Match, plus new world events, hazards, Siege enemies and a third boss.
- **A sequel-grade presentation:** new piece art, lit 3D-feeling boards with weather, rebuilt effects and 11 new finishers, an adaptive soundtrack, new sound design, and a Director that keeps every callout in its own lane.
- **A rebuilt Store and Season 3:** Mythic rarity, 25 piece sets, 13 boards, 14 trails, Collections, a 40-tier Crown Path, daily streaks and a Profile screen.

## What's in 5.0
- **Squads:** teams of two with no friendly fire, a Bond bonus for sticking together, and revives from a fallen teammate's soul.
- **Siege:** co-op for 1-4 players against eight waves of hunting Hollows, with Colossus bosses on waves 4 and 8.
- **Map hazards:** Magma Rift, Frostbite and Warpgates.
- **Five new abilities and two new base abilities**, an **Announcer**, **Play of the Match** replays and **Piece Mastery**.
- **Season 2: The Middlegame** with new piece sets, a board and a finisher.
- **Balance:** the Crown shatters into 4 shards when the King falls (one King per match), so the King now wins about 30% of bot games instead of about 50%. All four presets land between 23% and 28%.

## What's in 3.0
- **Full promotion ladder:** see every rung and climb several at once.
- **The Store:** a daily Featured shop, Bundles, rarity tiers, item reveals, Trails and Emote packs, plus 11 new cosmetics.
- **Showtime:** contender reveals, results podium and a title-screen showcase.

## What's in 2.0
- **Four modes:** Battle Royale, Blitz, Duel and a seeded Daily Challenge.
- **Crown Path:** a free 30-tier season track with exclusive cosmetics and titles. **Trophies:** 21 achievements.
- **Learning:** an interactive tutorial, a Codex with shape diagrams generated from the rules engine, a danger-zone overlay, post-match recaps and secret combo discoveries.
- **Accessibility and comfort:** graphics quality, reduced motion, one-tap attacks, colorblind colours, larger text, backup codes.
- **Installable:** add it to your Home Screen for a full-screen app that works offline in solo.

See [CHANGELOG.md](CHANGELOG.md) for everything, and [docs/ROADMAP.md](docs/ROADMAP.md) for the commercial plan.

## How online play works
GitHub Pages only serves static files, so matches are peer to peer over WebRTC using [PeerJS](https://peerjs.com). The host's browser runs the authoritative game; the friend code is the host's room ID. If a player disconnects, a bot takes over their piece. A few strict networks (some school or corporate Wi-Fi) block direct peer connections; mobile data or home Wi-Fi usually works.

## Development
No build step. Serve the folder with any static server:

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Add `?net=local` to test online play between two tabs of the same browser without a network.

Balance simulation (bot-only matches):

```
node tools/sim.mjs 200      # Battle Royale balance stats
node tools/modesim.mjs      # every mode terminates, average lengths
```

## Project layout
- `js/data.js` - pieces, abilities, passives, presets, skins
- `js/engine.js` - rules engine, map generation, turn order, storm, AI
- `js/render.js`, `js/pieces.js` - canvas renderer and vector piece art
- `js/net.js` - friend-code rooms and the authoritative match host
- `js/main.js` - menus, loadout, armory, HUD, sessions
- `js/store.js` - store catalog, daily featured offers, bundles, item previews
- `js/progression.js` - Crown Path, trophies, career stats, daily challenge seeding
- `js/tutorial.js`, `js/codex.js` - guided lessons and the Codex
- `js/audio.js` - synthesised sound effects

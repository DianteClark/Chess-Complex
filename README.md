# Chess Complex

**Play now: https://dianteclark.github.io/Chess-Complex/**

A turn-based chess battle royale for up to 8 players. Everyone starts as a Pawn on a 16x16 board. Collect Promotion Shards, evolve your piece, outlast the storm, and be the last piece standing.

## Features
- **Speed-based turns:** every piece has a speed meter, so faster builds act more often (with diminishing returns past 12 SPD).
- **Hybrid builds:** pick a preset or spend 10 points across HP / ATK / DEF / SPD, choose a base ability, and equip one active ability for every piece.
- **Fixed evolution path:** Pawn, then Knight or Bishop, then Rook, then Queen. Or Hone your current piece (+15% stats and a stronger signature) to stay your favourite piece all game.
- **Signature + equipped abilities with AOE shapes:** Knight T-Strike, Bishop Transpose, Rook Battering Charge, Queen Royal Decree, and more.
- **Living board:** walls, breakable rubble and crates, brambles, healing shrines, and Hollows that guard shard caches.
- **The storm:** the outer ring cracks and collapses every few rounds, then sudden death.
- **The Crown:** appears on round 7. Whoever takes it becomes King until someone takes it from them.
- **Online friend codes:** host a room, share a 5-letter code or invite link, fill empty seats with bots.
- **Armory:** earn Marks every match and unlock piece sets, board themes (Marble Court, Neon Grid, Ember Forge, Moonlit Garden) and finishers (Inferno, Thunderclap, Void Rift, Midas Touch) that play when you eliminate someone.
- **Progression:** XP and levels with titles from Recruit to Legend; every level-up pays out Marks.
- **Juice:** hit-stop, slow-motion eliminations, camera punches, lunging attacks, per-ability VFX, shattering pieces, collapsing storm tiles, damage previews with KO markers, kill streak callouts, emotes, haptics and a generative soundtrack that intensifies as the match closes in.

## v1.2 highlights
- **Shard Attunement:** every shard you collect permanently boosts HP, ATK and DEF (and SPD every 6), up to 30, even after spending. Orbiting crystals show your attunement tier.
- **Ultimates:** charge by dealing and taking damage, then unleash a cinematic piece ultimate (En Passant, Fork, Excommunicate, Castling, Checkmate Nova, Divine Right).
- **World events** every third round: Shard Rain, Meteor Storm, Blood Moon, Supply Drop.
- **Daily quests**, career stats, bot difficulty, victory cinematic with fireworks, per-board weather, new cosmetics (Crimson Regalia, Celestial, Astral Sanctum, Starfall).
- **Installable app:** add to your Home Screen for a full-screen app with its own icon. Works offline for solo play.

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
node tools/sim.mjs 200
```

## Project layout
- `js/data.js` - pieces, abilities, passives, presets, skins
- `js/engine.js` - rules engine, map generation, turn order, storm, AI
- `js/render.js`, `js/pieces.js` - canvas renderer and vector piece art
- `js/net.js` - friend-code rooms and the authoritative match host
- `js/main.js` - menus, loadout, armory, HUD
- `js/audio.js` - synthesised sound effects

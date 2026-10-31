# Chess Complex: Commercial Roadmap

Written for the v2.0 release (October 2026). It summarizes the market research and the technical gaps between the current free web build and a paid product.

## Where we stand
- Mobile-first web game / PWA on GitHub Pages. No accounts; progress lives in local storage, with backup codes.
- Friend-code multiplayer is peer to peer (PeerJS). The host's browser runs the match.
- Monetization: none yet. All cosmetics are earned with Marks or the free Crown Path.

## Competitive landscape (short)
- **Chess Arena** (Millions of Monsters): announced as a free-to-play, real-time, 40-player chess battle royale on PC. It is the closest pitch to ours. Our angle: turn-based, mobile-first, evolution through shards, short sessions.
- **Premium chess roguelikes** (Shotgun King, Pawnbarian, Chessarama) sell at $6-10 on PC. Players praise the novelty of the twist and complain about luck, shallow content and unclear rules on mobile.
- **TFT / auto chess** shows that seasons, ranked play and rotating modes keep players coming back, and that cosmetics alone are a thin revenue line on mobile.

## Before charging money
1. **Server-authoritative matches.** Peer to peer cannot stop cheating, so public matchmaking, ranked play and any paid economy need a server. The engine (`js/engine.js`) is already pure and deterministic, so it can run on a server unchanged. Recommended host: Cloudflare Durable Objects with WebSockets (about $5 a month at launch scale). Colyseus is an alternative.
2. **Accounts and cloud save.** Supabase or Firebase, with Apple and Google sign-in. Marks, unlocks and purchase receipts must live on the server once real money is involved.
3. **Name clearance.** No conflicting "Chess Complex" game was found in a quick search, but that is not clearance. Run USPTO/EUIPO searches (classes 9 and 41), plus store, domain and social-handle checks, before investing in branding.
4. **Custom domain.** Required for the Google Play TWA (`/.well-known/assetlinks.json`) and good for the brand anyway.

## Monetization (cosmetic only, never pay to win)
- **Supporter Pack** ($2.99-4.99): an exclusive piece set, a bonus Marks bundle and a supporter title.
- **Crown Path premium track** ($4.99 a season), alongside the existing free track.
- **Cosmetic bundles** ($0.99-4.99): piece sets, boards and finishers.
- Shards, evolutions and stats stay in-match only and are never sold.
- Plan for 1-3% of players paying. The stores take 15% under the small-business programs.

## Platforms
- **Android:** Trusted Web Activity via Bubblewrap. Needs the custom domain. In-app purchases must use Play Billing.
- **iOS:** Capacitor shell with the game files bundled in the app, plus native touches (push notifications, share sheet, haptics) to clear guideline 4.2. Digital goods must use Apple in-app purchase.
- **Steam:** Electron with steamworks.js for achievements and cloud save. Premium around $7.99, or free with supporter DLC.
- **Web portals** (CrazyGames, Poki): ad revenue share and extra reach. Check exclusivity terms first.

## Next features, by impact
1. Online quick match with bots filling empty seats, built on the server above.
2. Ranked seasons with a ladder and badges.
3. Replays and shareable highlight cards for wins and finishers.
4. A guided first match: 4 players, no timer, a coach popup the first time each thing happens.
5. Async play-by-notification matches with long turn timers.
6. Limited-time modes on a rotation.

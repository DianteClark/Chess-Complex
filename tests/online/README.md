# Online lifecycle suite

25 scenarios covering host and client deaths, spectating, results, forfeits, tab closes, reloads and rejoining, rematches, Duel and Blitz variants, lobby full/kick/rejoin, and 5.0 modes: Squads (S8: team labels, Downed/soul, no results while a teammate lives, shared Squad Victory; S8b: whole team out mid-match) and Siege co-op (S9: downed player cannot open results, seats handed to the AI, both see "The Line Held"). Pages talk over `?net=local` (BroadcastChannel), so no network is needed.

```
python3 -m http.server 8141 &          # from the repo root
node tests/online/scenarios.js --iters 2
node tests/online/scenarios.js --only S2b-menu-host,S7-lobby-full-kick-rejoin --iters 1
```

Needs Playwright (`npm i playwright`). Screenshots go to your temp folder under `cc-online-shots`.

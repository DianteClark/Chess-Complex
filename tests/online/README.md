# Online lifecycle suite

22 scenarios covering host and client deaths, spectating, results, forfeits, tab closes, reloads and rejoining, rematches, Duel and Blitz variants, and lobby full/kick/rejoin. Pages talk over `?net=local` (BroadcastChannel), so no network is needed.

```
python3 -m http.server 8141 &          # from the repo root
node tests/online/scenarios.js --iters 2
node tests/online/scenarios.js --only S2b-menu-host,S7-lobby-full-kick-rejoin --iters 1
```

Needs Playwright (`npm i playwright`). Screenshots go to your temp folder under `cc-online-shots`.

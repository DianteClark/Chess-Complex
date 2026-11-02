#!/bin/bash
# Q 15.0: run every suite sequentially, one log per suite, plus a summary line per suite.
# Usage: tests/run-all.sh <tag> [suite ...]     (default: all suites; logs in /tmp/q15/<tag>/)
# Suites: fuzz chat stormeng q15eng smoke layout tap storm cam director chatlog mic social perf leak q15ui online
# Env: CC_URL (default http://localhost:8123/), PAR (online --par, default 1), BASE_URL (perf baseline, default :8125 = 10.3)
cd "$(dirname "$0")/.." || exit 1
TAG=${1:-run}; shift
OUT=/tmp/q15/$TAG; mkdir -p "$OUT"
export NODE_PATH=$(npm root -g)
URL=${CC_URL:-http://localhost:8123/}
export CC_URL=$URL
BASE_URL=${BASE_URL:-http://localhost:8125/}
SUITES=${*:-fuzz chat stormeng q15eng smoke layout tap storm cam director chatlog mic social perf leak q15ui online}
run() { # name, cmd...
  local n=$1; shift; local t0=$(date +%s)
  timeout ${TMO:-2400} "$@" > "$OUT/$n.log" 2>&1; local rc=$?
  echo "$(date +%H:%M) $n rc=$rc $(( $(date +%s) - t0 ))s :: $(grep -E 'pass|PASS|FAIL|fail|HELD|accuracy|summary' "$OUT/$n.log" | tail -1 | cut -c1-160)" | tee -a "$OUT/SUMMARY"
}
for s in $SUITES; do case $s in
  fuzz) run fuzz node tests/fuzz/engine-fuzz.mjs --matches 20 ;;
  chat) run chat node tests/chat/chat-unit.mjs ;;
  stormeng) run stormeng node tests/storm/storm-engine.mjs ;;
  q15eng) run q15eng node tests/q15/engine15.mjs ;;
  smoke) run smoke node tests/smoke/smoke.cjs --vp phone --out "$OUT/smoke" ;;
  layout) run layout node tests/layout/crawl.cjs --vp phone --out "$OUT/layout" ;;
  tap) run tap node tests/tap/tap-bench.cjs --url "$URL" --tag "$TAG" ${TAPARGS:---trials 25 --zoom min,default,fit} ;;
  storm) run storm node tests/storm/storm-browser.cjs --url "$URL" ;;
  cam) run cam node tests/camera/cam.cjs --url "$URL" --matches 1 --secs 60 ;;
  director) run director node tests/director/overlap.cjs --url "$URL" --secs 90 --tag "$TAG" ;;
  chatlog) run chatlog node tests/chatlog/chatlog.cjs --url "$URL" ;;
  mic) run mic node tests/mic/mic.cjs --url "$URL" ;;
  social) run social node tests/social/qa-social.cjs --url "$URL" ;;
  perf) run perf node tests/perf/perf.cjs --urls "$BASE_URL,$URL" --rounds 2 --no-leak ;;
  leak) run leak node tests/q15/leak.cjs --urls "$BASE_URL,$URL" ;;
  q15ui) run q15ui node tests/q15/ui15.cjs --url "$URL" ;;
  online) (cd tests/online && run online node scenarios.js --iters 1 --par ${PAR:-1}) ;;
esac; done
echo "done $(date +%H:%M)" >> "$OUT/SUMMARY"

#!/bin/bash
# Aura 3.0 — full unit test suite runner.
# Usage: bash scripts/a3_run_units.sh   → rc 0 iff every suite passes.
cd "$(dirname "$0")/.." || exit 1
FAIL=0
run_node () {  # plain node strip-types suites (alias-free imports)
  node --experimental-strip-types "$1" > /tmp/a3_unit_out.txt 2>&1
  rc=$?; report "$1" $rc
}
run_tsx () {   # suites importing @/-aliased modules (tsx + app tsconfig)
  npx tsx --tsconfig tsconfig.app.json "$1" > /tmp/a3_unit_out.txt 2>&1
  rc=$?; report "$1" $rc
}
report () {
  local name; name=$(basename "$1"); local rc=$2
  if [ $rc -ne 0 ]; then
    echo "FAIL $name (rc=$rc)"; tail -5 /tmp/a3_unit_out.txt; FAIL=1
  else
    echo "PASS $name"
  fi
}
for t in scripts/queue_engine.test.ts scripts/a3_radio_music.test.ts scripts/phase1_unit.test.ts scripts/phase2_unit.test.ts \
         scripts/phase3_core.test.ts scripts/phase4_audius.test.ts scripts/phase5_radio.test.ts \
         scripts/phase6_unit.test.ts scripts/phase7_smart.test.ts scripts/phase8_smartqueue.test.ts \
         scripts/phase9_artistalbum.test.ts scripts/phase10_history.test.ts scripts/phase11_queue.test.ts \
         scripts/v2161_cache.test.ts scripts/a3_domain.test.ts scripts/a3_fx.test.ts; do
  run_node "$t"
done
for t in scripts/a3_fx_store.test.ts scripts/v32_studio.test.ts; do
  run_tsx "$t"
done
exit $FAIL

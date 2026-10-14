#!/bin/bash
# Aura 3.0 — full regression battery (all runtime suites, production build).
# Usage: bash scripts/a3_battery.sh   → rc 0 iff every suite passes.
cd "$(dirname "$0")/.." || exit 1
FAIL=0
run () { # run <timeout> <script>
  local to=$1; shift
  timeout "$to" "$@" > /tmp/a3_bat_out.txt 2>&1
  local rc=$?
  local name; name=$(basename "${@: -1}")
  if [ $rc -ne 0 ]; then
    echo "FAIL $name (rc=$rc)"; tail -4 /tmp/a3_bat_out.txt; FAIL=1
  else
    echo "PASS $name  ($(grep -oE '[0-9]+/[0-9]+ checks passed' /tmp/a3_bat_out.txt | tail -1))"
  fi
}
run 420 python3 scripts/p1_func_test.py
run 420 python3 scripts/p2_func_test.py
run 420 python3 scripts/p4_func_test.py
run 420 python3 scripts/p5_func_test.py
run 420 python3 scripts/p6_func_test.py
run 420 python3 scripts/p7_func_test.py
run 420 python3 scripts/p8_func_test.py
run 420 python3 scripts/p9_func_test.py
run 420 python3 scripts/p10_func_test.py
run 420 python3 scripts/p11_func_test.py
run 420 python3 scripts/p12_func_test.py
run 420 python3 scripts/v212_func_test.py
run 420 python3 scripts/v212_electron_test.py
run 420 python3 scripts/p15_perf_probe.py
run 420 python3 scripts/v2161_explore_test.py
run 420 python3 scripts/a3_theme_test.py
run 420 python3 scripts/a3_w10_test.py
run 420 python3 scripts/a3_w11_test.py
run 420 python3 scripts/a3_w12_test.py
run 420 python3 scripts/a3_w13_test.py
exit $FAIL

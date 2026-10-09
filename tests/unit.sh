#!/usr/bin/env bash
# Runs every plugin's unit suite (plugins/<name>/tests/run.sh) and exits 0 only
# if all of them pass. Suites that call the Claude API (tests/e2e.sh) are not
# run here. tests/validate.sh C14 fails for a plugin that has no tests/run.sh.
set -u

cd "$(dirname "$0")/.." || exit 2

status=0
for suite in plugins/*/tests/run.sh; do
  [ -f "$suite" ] || continue
  echo "== $suite"
  bash "$suite" || status=1
  echo
done
exit "$status"

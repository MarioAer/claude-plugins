#!/usr/bin/env bash
# Scaffold for `claude plugin eval --scaffold`: generates the benchmark corpus into the run's
# empty workspace, which is the current directory.
set -euo pipefail
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/gen-corpus.sh" "$PWD"

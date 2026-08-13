#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.temp/build-runs"
LOG_ROOT="${TSUMO_RUST_LOG_DIR:-$(mktemp -d "$ROOT/.temp/build-runs/rust-XXXXXXXX")}"
mkdir -p "$LOG_ROOT"

packages=(engine cli tests)
pids=()

for package in "${packages[@]}"; do
  cargo build --manifest-path "$ROOT/packages/$package/out/rust/Cargo.toml" --locked \
    >"$LOG_ROOT/$package.log" 2>&1 &
  pids+=("$!")
done

failed=0
for index in "${!packages[@]}"; do
  package="${packages[$index]}"
  if wait "${pids[$index]}"; then
    status="PASS"
  else
    status="FAIL"
    failed=1
  fi
  echo "=== rust $package: $status ==="
  cat "$LOG_ROOT/$package.log"
done

echo "Rust build logs: $LOG_ROOT"
test "$failed" -eq 0

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.temp/build-runs"
LOG_ROOT="${TSUMO_RUST_LOG_DIR:-$(mktemp -d "$ROOT/.temp/build-runs/rust-XXXXXXXX")}"
mkdir -p "$LOG_ROOT"

export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
/usr/bin/time -v cargo build --manifest-path "$ROOT/Cargo.toml" --workspace --locked \
  >"$LOG_ROOT/workspace.log" 2>&1
cat "$LOG_ROOT/workspace.log"
echo "Rust build logs: $LOG_ROOT"

#!/usr/bin/env bash
# Full verification gate for a fresh checkout. Generated sources are rebuilt
# twice to prove determinism, then the native Rust workspace, compiled Tsonic
# tests, CLI end-to-end tests, clippy, and release binary are verified.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/.temp/verification-runs"
VERIFY_ROOT="$(mktemp -d "$ROOT/.temp/verification-runs/run-XXXXXXXX")"
echo "Verification artifacts: $VERIFY_ROOT"

generated_manifest() {
  find \
    packages/engine/out/rust \
    packages/cli/out/rust \
    packages/tests/out/rust \
    -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum
}

echo "=== architecture contract ==="
node --test test/architecture-contract.test.mjs 2>&1 | tee "$VERIFY_ROOT/architecture.log"

echo "=== tsonic generation pass 1 ==="
TSONIC_PHASE_TIMINGS=1 \
TSUMO_BUILD_LOG_DIR="$VERIFY_ROOT/tsonic-pass-1" \
bash scripts/build-tsonic.sh
generated_manifest >"$VERIFY_ROOT/generated-pass-1.sha256"

echo "=== tsonic generation pass 2 ==="
TSONIC_PHASE_TIMINGS=1 \
TSUMO_BUILD_LOG_DIR="$VERIFY_ROOT/tsonic-pass-2" \
bash scripts/build-tsonic.sh
generated_manifest >"$VERIFY_ROOT/generated-pass-2.sha256"
diff -u "$VERIFY_ROOT/generated-pass-1.sha256" "$VERIFY_ROOT/generated-pass-2.sha256" \
  | tee "$VERIFY_ROOT/generated-determinism.diff"

echo "=== authored Rust formatting ==="
cargo fmt --package tsumo-platform --check 2>&1 | tee "$VERIFY_ROOT/cargo-fmt.log"

echo "=== Rust workspace build ==="
TSUMO_RUST_LOG_DIR="$VERIFY_ROOT/rust" bash scripts/build-rust.sh

echo "=== Rust workspace tests ==="
cargo test --workspace --locked 2>&1 | tee "$VERIFY_ROOT/cargo-test.log"

echo "=== compiled Tsonic tests ==="
TSUMO_TEST_ROOT="$VERIFY_ROOT/compiled-test-runs" \
  "$ROOT/target/debug/tsumo-tests" 2>&1 | tee "$VERIFY_ROOT/compiled-tests.log"

echo "=== node e2e tests ==="
node --test "test/**/*.test.mjs" 2>&1 | tee "$VERIFY_ROOT/node-e2e.log"

echo "=== clippy ==="
cargo clippy --workspace --all-targets --locked -- -D warnings \
  2>&1 | tee "$VERIFY_ROOT/clippy.log"

echo "=== release build + output equivalence ==="
cargo build -p tsumo --release --locked 2>&1 | tee "$VERIFY_ROOT/release-build.log"
"$ROOT/target/release/tsumo" --help >"$VERIFY_ROOT/release-help.txt"
DEBUG_OUT="$VERIFY_ROOT/debug-site"
RELEASE_OUT="$VERIFY_ROOT/release-site"
SOURCE_DATE_EPOCH=1767225600 \
  "$ROOT/target/debug/tsumo" build \
  --source "$ROOT/examples/basic-blog" --destination "$DEBUG_OUT"
SOURCE_DATE_EPOCH=1767225600 \
  "$ROOT/target/release/tsumo" build \
  --source "$ROOT/examples/basic-blog" --destination "$RELEASE_OUT"
diff \
  <(cd "$DEBUG_OUT" && find . -type f -print0 | sort -z | xargs -0 sha256sum) \
  <(cd "$RELEASE_OUT" && find . -type f -print0 | sort -z | xargs -0 sha256sum) \
  | tee "$VERIFY_ROOT/release-output-diff.log"
test "$(find "$RELEASE_OUT" -type f | wc -l)" -eq 21

echo "ALL VERIFICATIONS PASSED"

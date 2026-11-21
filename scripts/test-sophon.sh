#!/bin/bash
# Run the Swift sidecar tests and export LLVM coverage without building the app.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/sophon_server/swift"
REPORT="$ROOT/coverage/sophon"
SCRATCH="${SOPHON_TEST_SCRATCH:-$SOURCE/.build-tests}"
mkdir -p "$REPORT"
ARGS=(--package-path "$SOURCE" --scratch-path "$SCRATCH")
SOPHON_TEST_PRODUCTS="$(swift build "${ARGS[@]}" --show-bin-path)"
export SOPHON_TEST_PRODUCTS
# The CLI transport tests also contribute subprocess coverage.
swift test "${ARGS[@]}" --force-resolved-versions --enable-code-coverage | tee "$REPORT/tests.log"
PROFILE="$SOPHON_TEST_PRODUCTS/codecov/default.profdata"
COVERAGE_ARGS=()
for target in SophonClientv3Tests HYPAPIClientTests SophonClientv3PackageTests; do
  binary="$SOPHON_TEST_PRODUCTS/$target.xctest/Contents/MacOS/$target"
  if [ -x "$binary" ]; then COVERAGE_ARGS+=(-object "$binary"); fi
done
if [ "${#COVERAGE_ARGS[@]}" -eq 0 ]; then
  echo "Cannot locate Swift coverage test binaries" >&2
  exit 1
fi
xcrun llvm-cov export -summary-only -instr-profile "$PROFILE"   "${COVERAGE_ARGS[@]}" > "$REPORT/coverage.json"

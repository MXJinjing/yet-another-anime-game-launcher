#!/bin/bash
# Run all Python test styles from a clean checkout without building the app.
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/sophon_server"
uv sync --locked
uv run --locked python -m grpc_tools.protoc -I . --python_out=. manifest.proto manifest_ldiff.proto
case "$(uname -m)" in
  arm64) SOPHON_TEST_ARCH=arm64 ;;
  x86_64) SOPHON_TEST_ARCH=x64 ;;
  *) echo "Sophon tests require macOS arm64 or x64" >&2; exit 1 ;;
esac
CREATED_HPATCHZ=0
if [ ! -e hpatchz ]; then
  cp "../sidecar/$SOPHON_TEST_ARCH/hpatchz/hpatchz" hpatchz
  CREATED_HPATCHZ=1
fi
trap 'if [ "$CREATED_HPATCHZ" = 1 ]; then rm -f hpatchz; fi' EXIT
mkdir -p ../coverage/sophon
uv run --locked coverage run -m pytest -q --junitxml=../coverage/sophon/junit.xml test_*.py
uv run --locked coverage html
uv run --locked coverage json
uv run --locked coverage xml
uv run --locked coverage report

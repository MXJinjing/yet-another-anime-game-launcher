#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR"
TARGET_ARCH="${SOPHON_ARCH:-arm64}"
case "$TARGET_ARCH" in arm64|x64) ;; *) echo "Unsupported SOPHON_ARCH: $TARGET_ARCH" >&2; exit 1 ;; esac
SOPHON_ENV="$SCRIPT_DIR/sophon_server/.venv"
SOPHON_PYTHON_SPEC="cpython-3.13.14-macos-aarch64-none"
if [ "$TARGET_ARCH" = x64 ]; then
  SOPHON_ENV="$SCRIPT_DIR/sophon_server/.venv-x64"
  SOPHON_PYTHON_SPEC="cpython-3.13.14-macos-x86_64-none"
fi
if [ -z "${SOPHON_PYTHON:-}" ]; then
  UV_PROJECT_ENVIRONMENT="$SOPHON_ENV" uv sync --project "$SCRIPT_DIR/sophon_server" --locked --python "$SOPHON_PYTHON_SPEC"
  SOPHON_PYTHON="$SOPHON_ENV/bin/python"
fi
"$SOPHON_PYTHON" "$SCRIPT_DIR/sophon_server/build.py" --arch "$TARGET_ARCH" --python "$SOPHON_PYTHON"

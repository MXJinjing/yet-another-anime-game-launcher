#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR"

TARGET_ARCH="${SOPHON_ARCH:-arm64}"
case "$TARGET_ARCH" in
  arm64|x64) ;;
  *)
    echo "ERROR: Unsupported SOPHON_ARCH: ${TARGET_ARCH}" >&2
    exit 1
    ;;
esac

OUTPUT_DIR="./build"
if [ "$TARGET_ARCH" = "x64" ]; then
  OUTPUT_DIR="./build-x64"
  SOPHON_PYTHON="${SOPHON_PYTHON:-$PWD/sophon_server/.venv-x64/bin/python}"
  if [ ! -x "$SOPHON_PYTHON" ]; then
    echo "Creating x86_64 Python environment for Sophon..."
    command -v uv >/dev/null || {
      echo "ERROR: uv is required to create the x64 Sophon environment" >&2
      exit 1
    }
    uv python install cpython-3.13.14-macos-x86_64-none
    UV_PROJECT_ENVIRONMENT="$PWD/sophon_server/.venv-x64" \
      uv sync --project "$PWD/sophon_server" \
        --python cpython-3.13.14-macos-x86_64-none
    SOPHON_PYTHON="$PWD/sophon_server/.venv-x64/bin/python"
  fi
fi

cp "./sidecar/${TARGET_ARCH}/hpatchz/hpatchz" ./sophon_server/hpatchz

curl -sSL https://github.com/protocolbuffers/protobuf/releases/download/v31.1/protoc-31.1-osx-universal_binary.zip > protobuf.zip
unzip -o -j protobuf.zip bin/protoc -d bin
rm protobuf.zip

pushd sophon_server
../bin/protoc --python_out=. *.proto
if [[ -n "${SOPHON_PYTHON:-}" ]]; then
  if [ ! -x "$SOPHON_PYTHON" ]; then
    echo "ERROR: SOPHON_PYTHON is not executable: $SOPHON_PYTHON" >&2
    exit 1
  fi
  NUITKA_CACHE_DIR=./.cache "$SOPHON_PYTHON" -m nuitka \
    --warn-implicit-exceptions \
    --warn-unusual-code \
    --standalone \
    --python-flag=isolated \
    --include-data-files=./hpatchz=./hpatchz \
    --output-filename=sophon-server \
    --output-dir="$OUTPUT_DIR" \
    --assume-yes-for-downloads \
    server.py
else
  uv sync
  NUITKA_CACHE_DIR=./.cache uv run nuitka \
    --warn-implicit-exceptions \
    --warn-unusual-code \
    --standalone \
    --python-flag=isolated \
    --include-data-files=./hpatchz=./hpatchz \
    --output-filename=sophon-server \
    --output-dir="$OUTPUT_DIR" \
    --assume-yes-for-downloads \
    server.py
fi
rm ./hpatchz
popd

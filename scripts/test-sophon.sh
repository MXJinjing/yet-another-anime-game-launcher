#!/bin/bash
# Run all Python test styles from a clean checkout without building the app.
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/sophon_server"
python3 "$ROOT_DIR/scripts/sync-sophon.py" --verify-lock
uv sync --locked
uv run --locked python -m grpc_tools.protoc -I proto --python_out=src proto/manifest.proto proto/manifest_ldiff.proto
mkdir -p ../coverage/sophon
uv run --locked coverage run -m pytest -q --junitxml=../coverage/sophon/junit.xml tests
uv run --locked coverage html
uv run --locked coverage json
uv run --locked coverage xml
uv run --locked coverage report

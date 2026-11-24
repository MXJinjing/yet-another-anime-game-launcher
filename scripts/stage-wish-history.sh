#!/bin/bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "${2:-$(uname -m)}" in
  arm64) arch=arm64; target=arm64-apple-macos11.0 ;;
  x64|x86_64) arch=x64; target=x86_64-apple-macos10.15 ;;
  *) echo "Unsupported wish history architecture" >&2; exit 1 ;;
esac
destination="$1/sidecar/$arch/wish-history"
mkdir -p "$(dirname "$destination")"
swiftc -O -parse-as-library -target "$target" "$root/native/wish-history.swift" -o "$destination"

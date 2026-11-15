#!/bin/bash
set -euo pipefail
case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) echo "Unsupported Sophon development architecture" >&2; exit 1 ;;
esac
SOPHON_ARCH="$arch" ./build-sophon.sh
destination="$1/sidecar/$arch/sophon-swift"
mkdir -p "$destination"
rsync -rlptu "sophon_server/dist/$arch/" "$destination/"

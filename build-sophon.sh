#!/bin/bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET_ARCH="${SOPHON_ARCH:-arm64}"
case "$TARGET_ARCH" in
  arm64) triple=arm64-apple-macosx13.0 ;;
  x64) triple=x86_64-apple-macosx13.0 ;;
  *) echo "Unsupported SOPHON_ARCH: $TARGET_ARCH" >&2; exit 1 ;;
esac

SOURCE="$ROOT/sophon_server/swift"
SCRATCH="${SOPHON_BUILD_SCRATCH:-$SOURCE/.build-release}"
DEST="$ROOT/sophon_server/dist/$TARGET_ARCH"
swift build --package-path "$SOURCE" --scratch-path "$SCRATCH" --force-resolved-versions \
  --triple "$triple" --configuration release --product SophonCLI -j "${SOPHON_BUILD_JOBS:-6}"
BIN="$(swift build --package-path "$SOURCE" --scratch-path "$SCRATCH" \
  --triple "$triple" --configuration release --show-bin-path)"
mkdir -p "$DEST"
install -m 755 "$BIN/SophonCLI" "$DEST/SophonCLI"
install -m 644 "$SOURCE/LICENSE" "$DEST/LICENSE"
xcrun swift-stdlib-tool --copy --platform macosx \
  --scan-executable "$DEST/SophonCLI" --destination "$DEST"
xcrun lipo -verify_arch "${triple%%-*}" "$DEST/SophonCLI"

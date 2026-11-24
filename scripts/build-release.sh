#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)"
cd "$ROOT"

ARCH="${YAAGL_BUILD_ARCH:-arm64}"
VERSION="${YAAGL_VERSION:-1.1.0}"
export YAAGL_VERSION="$VERSION"
case "$ARCH" in
  arm64|x64|universal) ;;
  *)
    echo "ERROR: Unsupported YAAGL_BUILD_ARCH: ${ARCH}" >&2
    exit 1
    ;;
esac

PREVIEW="${YAAGL_DEVELOPMENT_PREVIEW:-0}"
if [ "$PREVIEW" = 1 ] && [ "$ARCH" != arm64 ]; then
  echo "The development preview is only available for arm64." >&2
  exit 1
fi

CHANNELS=(hk4ecn hk4eos mhyos mhycn all hkrpgcn hkrpgos bh3glb cbjq cbjqcn napos napcn)
BH3_GLOBAL_SUFFIX="$(node -p 'require("./src/constants/yaaglm-config.secret.json").bh3GlobalSuffix')"
APP_NAMES=(
  "Yaaglm GI CN"
  "Yaaglm GI OS"
  "Yaaglm OS"
  "Yaaglm CN"
  "Yaagl"
  "Yaaglm HSR"
  "Yaaglm HSR OS"
  "Yaaglm $BH3_GLOBAL_SUFFIX"
  "Yaaglm SCZ OS"
  "Yaaglm SCZ"
  "Yaaglm ZZZ OS"
  "Yaaglm ZZZ"
)

OUT="$ROOT/release-assets/$ARCH"
rm -rf "$OUT"
mkdir -p "$OUT"

CONFIG_BACKUP="$(mktemp "${TMPDIR:-/tmp}/yaaglm-release-config.XXXXXX")"
cp neutralino.config.json "$CONFIG_BACKUP"
restore_config() {
  mv -f "$CONFIG_BACKUP" neutralino.config.json
}
trap restore_config EXIT

node -e '
  const fs = require("fs");
  const path = "neutralino.config.json";
  const config = JSON.parse(fs.readFileSync(path, "utf8"));
  config.version = process.env.YAAGL_VERSION;
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
'

for i in "${!CHANNELS[@]}"; do
  channel="${CHANNELS[$i]}"
  app="${APP_NAMES[$i]}"
  if [ "$PREVIEW" = 1 ]; then
    [ "$channel" = mhycn ] || continue
    app="$app Development"
  fi
  echo "=== Building ${ARCH}: ${channel} ==="

  YAAGL_CHANNEL_CLIENT="$channel" \
    YAAGL_BUILD_ARCH="$ARCH" \
    node build-app.js

  dot="$(printf '%s' "$app" | tr ' ' '.')"
  bash scripts/create-release-dmg.sh "release/$ARCH/$app.app" "$OUT/$dot-$ARCH.dmg"
  tar -czf "$OUT/$dot.app-$ARCH.tar.gz" -C "release/$ARCH" "$app.app"

  if [ "$ARCH" = "universal" ]; then
    tar -czf "$OUT/$dot.app.tar.gz" -C "release/$ARCH" "$app.app"
  fi
done

echo "Release assets ready in ${OUT}"

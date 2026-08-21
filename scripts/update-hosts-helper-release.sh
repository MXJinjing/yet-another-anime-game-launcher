#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)"
cd "$ROOT"

HELPER_REPO="${HELPER_REPO:-MXJinjing/yaaglm-hosts-helper}"
HELPER_RELEASE="${HELPER_RELEASE:-latest}"

if [ "$HELPER_RELEASE" = "latest" ]; then
  BASE_URL="https://github.com/${HELPER_REPO}/releases/latest/download"
else
  BASE_URL="https://github.com/${HELPER_REPO}/releases/download/${HELPER_RELEASE}"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/yaaglm-helper-release.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

download() {
  echo "Downloading ${BASE_URL}/$1"
  curl -fL --retry 3 -sS -o "$TMP/$1" "$BASE_URL/$1"
}

download yaaglm-hosts-helper-arm64
download yaaglm-hosts-helper-arm64.sha256
download yaaglm-hosts-helper-x86_64
download yaaglm-hosts-helper-x86_64.sha256
download install.sh
download uninstall.sh

(cd "$TMP" && shasum -a 256 -c yaaglm-hosts-helper-arm64.sha256 yaaglm-hosts-helper-x86_64.sha256)

file "$TMP/yaaglm-hosts-helper-arm64" | grep -q "arm64"
file "$TMP/yaaglm-hosts-helper-x86_64" | grep -q "x86_64"

mkdir -p sidecar/arm64/yaaglm-hosts-helper sidecar/x64/yaaglm-hosts-helper
install -m 0755 "$TMP/yaaglm-hosts-helper-arm64" sidecar/arm64/yaaglm-hosts-helper/yaaglm-hosts-helper
install -m 0755 "$TMP/yaaglm-hosts-helper-x86_64" sidecar/x64/yaaglm-hosts-helper/yaaglm-hosts-helper
install -m 0755 "$TMP/install.sh" sidecar/yaaglm-hosts-helper/install.sh
install -m 0755 "$TMP/uninstall.sh" sidecar/yaaglm-hosts-helper/uninstall.sh

echo "Updated hosts helper from ${HELPER_REPO} release ${HELPER_RELEASE}"

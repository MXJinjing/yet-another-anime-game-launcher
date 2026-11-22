#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)"
cd "$ROOT"

HELPER_REPO="${HELPER_REPO:-MXJinjing/yaaglm-hosts-helper}"
HELPER_RELEASE="${HELPER_RELEASE:-latest}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/yaaglm-helper-release.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Unauthenticated api.github.com calls from shared runner IPs are routinely
# rejected with 403 (rate limit exceeded), so authenticate whenever a token is
# available and keep the redirect below as a fallback.
gh_curl() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -sS -L --retry 3 --retry-all-errors \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" "$@"
  else
    curl -sS -L --retry 3 --retry-all-errors \
      -H "Accept: application/vnd.github+json" "$@"
  fi
}

if [ "$HELPER_RELEASE" = "latest" ]; then
  RELEASE_API="https://api.github.com/repos/${HELPER_REPO}/releases/latest"
  RELEASE_JSON="${TMP}/latest-release.json"
  RELEASE_CODE="$(gh_curl -o "$RELEASE_JSON" -w '%{http_code}' "$RELEASE_API" || true)"
  HELPER_RELEASE=""
  if [ "$RELEASE_CODE" = "200" ]; then
    HELPER_RELEASE="$(sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' "$RELEASE_JSON" | head -n 1)"
  else
    echo "GitHub API returned HTTP ${RELEASE_CODE:-unknown} for ${RELEASE_API}" >&2
    head -c 400 "$RELEASE_JSON" 2>/dev/null >&2 || true
    echo >&2
  fi
  if [ -z "$HELPER_RELEASE" ]; then
    # github.com/releases/latest redirects to the tag page and is not subject to
    # the anonymous API quota.
    EFFECTIVE_URL="$(curl -sS -I -L --retry 3 --retry-all-errors -o /dev/null -w '%{url_effective}' \
      "https://github.com/${HELPER_REPO}/releases/latest" 2>/dev/null || true)"
    case "$EFFECTIVE_URL" in
      */releases/tag/*) HELPER_RELEASE="${EFFECTIVE_URL##*/releases/tag/}" ;;
    esac
  fi
  [ -n "$HELPER_RELEASE" ] || {
    echo "Unable to determine helper release from ${RELEASE_API}" >&2
    exit 1
  }
fi
BASE_URL="https://github.com/${HELPER_REPO}/releases/download/${HELPER_RELEASE}"

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

mkdir -p sidecar/arm64/yaaglm-hosts-helper sidecar/x64/yaaglm-hosts-helper sidecar/yaaglm-hosts-helper
install -m 0755 "$TMP/yaaglm-hosts-helper-arm64" sidecar/arm64/yaaglm-hosts-helper/yaaglm-hosts-helper
install -m 0755 "$TMP/yaaglm-hosts-helper-x86_64" sidecar/x64/yaaglm-hosts-helper/yaaglm-hosts-helper
install -m 0755 "$TMP/install.sh" sidecar/yaaglm-hosts-helper/install.sh
install -m 0755 "$TMP/uninstall.sh" sidecar/yaaglm-hosts-helper/uninstall.sh
printf '%s\n' "${HELPER_RELEASE#v}" > sidecar/yaaglm-hosts-helper/VERSION

echo "Updated hosts helper from ${HELPER_REPO} release ${HELPER_RELEASE}"

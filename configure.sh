#!/bin/sh

set -eu

base64 -d -i ./src/clients/secret.b64 -o ./src/clients/secret.ts

EXTERNAL="./external"

rm -rf "$EXTERNAL"
mkdir -p "$EXTERNAL/hk4e"
mkdir -p "$EXTERNAL/bh3/glb/diffs"
mkdir -p "$EXTERNAL/bh3/glb/files"
# mkdir -p "$EXTERNAL/hkrpg/cn/diffs"
# mkdir -p "$EXTERNAL/hkrpg/cn/files"
mkdir -p "$EXTERNAL/hkrpg/os/diffs"
mkdir -p "$EXTERNAL/hkrpg/os/files"

# mkdir -p "$EXTERNAL/hk4e"
# mkdir -p ./tmp
# git clone $(echo "aHR0cHM6Ly9ub3RhYnVnLm9yZy9Lcm9jay9kYXduCg==" | base64 --decode) ./tmp
# cp -R ./tmp/410/patch_files/. "$EXTERNAL/hk4e"
# rm -rf ./tmp
# git clone $(echo "aHR0cHM6Ly9ub3RhYnVnLm9yZy9ta3JzeW0xL2R1c2s=" | base64 --decode) ./tmp
# cp -R ./tmp/glb/diffs/. "$EXTERNAL/bh3/glb/diffs"
# cp -R ./tmp/glb/files/. "$EXTERNAL/bh3/glb/files"
# rm -rf ./tmp
# git clone $(echo "aHR0cHM6Ly9ub3RhYnVnLm9yZy9ta3JzeW0xL2FzdHJh" | base64 --decode) ./tmp
# cp -R ./tmp/cn/diffs/. "$EXTERNAL/hkrpg/cn/diffs"
# cp -R ./tmp/cn/files/. "$EXTERNAL/hkrpg/cn/files"
# cp -R ./tmp/os/diffs/. "$EXTERNAL/hkrpg/os/diffs"
# cp -R ./tmp/os/files/. "$EXTERNAL/hkrpg/os/files"
# rm -rf ./tmp
# pushd "$EXTERNAL/hk4e"
# for file in * ; do echo "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/bh3/glb/diffs"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/bh3/glb/files/Generated"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/bh3/glb/files"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/hkrpg/cn/diffs"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/hkrpg/cn/files/Generated"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/hkrpg/cn/files"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/hkrpg/os/diffs"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/hkrpg/os/files/Generated"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd
# pushd "$EXTERNAL/hkrpg/os/files"
# for file in * ; do mv "$file" "$(basename $file | base64 )"."${file##*.}" ; done
# popd

# The launcher depends on macOS window features that only exist in the
# MXJinjing/yaagl-neutralinojs fork. Never silently fall back to another
# Neutralino runtime: a compatible RPC surface alone is not sufficient.
YAAGL_NEU_REPO="MXJinjing/yaagl-neutralinojs"
YAAGL_NEU_TAG="${YAAGL_NEU_TAG:-latest}"

# GitHub API calls are unauthenticated here and subject to a 60 req/h rate
# limit per IP. GitHub-hosted runners share egress IPs, so api.github.com can
# answer 403 even when the release exists. Resolve the latest tag through the
# plain /releases/latest redirect instead (no API, no rate limit), and keep
# the API only as a best-effort lookup for the release commit marker.
yaagl_neu_api() {
  if [ -n "${GH_TOKEN:-}" ]; then
    curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$1"
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$1"
  else
    curl -fsSL "$1"
  fi
}

yaagl_neu_resolve_latest_tag() {
  # /releases/latest redirects (302) to /releases/tag/<tag>; keep the final URL.
  YAAGL_NEU_LOCATION=$(curl -fsSL -o /dev/null -w '%{url_effective}' \
    "https://github.com/${YAAGL_NEU_REPO}/releases/latest") || return 1
  YAAGL_NEU_TAG=${YAAGL_NEU_LOCATION##*/}
  [ -n "$YAAGL_NEU_TAG" ] || return 1
}

yaagl_neu_resolve_commit() {
  # Best-effort: the commit marker is verified when available, skipped otherwise.
  YAAGL_NEU_COMMIT=""
  YAAGL_NEU_RELEASE_JSON=$(yaagl_neu_api \
    "https://api.github.com/repos/${YAAGL_NEU_REPO}/releases/tags/${YAAGL_NEU_TAG}" 2>/dev/null) || return 0
  YAAGL_NEU_COMMIT=$(printf '%s' "$YAAGL_NEU_RELEASE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("target_commitish",""))' 2>/dev/null) || YAAGL_NEU_COMMIT=""
  return 0
}

yaagl_neu_resolve_release() {
  if [ "$YAAGL_NEU_TAG" = "latest" ]; then
    yaagl_neu_resolve_latest_tag || return 1
  fi
  yaagl_neu_resolve_commit
  YAAGL_NEU_ARCHIVE="neutralinojs-${YAAGL_NEU_TAG}.zip"
  YAAGL_NEU_URL="https://github.com/${YAAGL_NEU_REPO}/releases/download/${YAAGL_NEU_TAG}/${YAAGL_NEU_ARCHIVE}"
  YAAGL_NEU_SHA_URL="https://github.com/${YAAGL_NEU_REPO}/releases/download/${YAAGL_NEU_TAG}/SHA256SUMS"
}

yaagl_neu_sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

yaagl_neu_expect_hash() {
  if [ ! -f "$1" ]; then
    echo "Missing Neutralino file: $1" >&2
    return 1
  fi
  YAAGL_NEU_ACTUAL_HASH=$(yaagl_neu_sha256 "$1")
  if [ "$YAAGL_NEU_ACTUAL_HASH" != "$2" ]; then
    echo "Neutralino checksum mismatch: $1" >&2
    return 1
  fi
}

yaagl_neu_verify_checksums() {
  YAAGL_NEU_SUMS=$1
  shift
  for YAAGL_NEU_FILE in "$@"; do
    YAAGL_NEU_BASENAME=$(basename "$YAAGL_NEU_FILE")
    YAAGL_NEU_EXPECTED=$(awk -v file="$YAAGL_NEU_BASENAME" '$2 == file {print $1}' "$YAAGL_NEU_SUMS")
    if [ -z "$YAAGL_NEU_EXPECTED" ]; then
      echo "Missing checksum for $YAAGL_NEU_BASENAME in $YAAGL_NEU_SUMS" >&2
      return 1
    fi
    yaagl_neu_expect_hash "$YAAGL_NEU_FILE" "$YAAGL_NEU_EXPECTED" || return 1
  done
}

yaagl_neu_verify_capabilities() {
  YAAGL_NEU_DIR=$1
  YAAGL_NEU_X64="$YAAGL_NEU_DIR/neutralino-mac_x64"
  YAAGL_NEU_ARM64="$YAAGL_NEU_DIR/neutralino-mac_arm64"
  YAAGL_NEU_UNIVERSAL="$YAAGL_NEU_DIR/neutralino-mac_universal"

  for YAAGL_NEU_BINARY in \
    "$YAAGL_NEU_X64" "$YAAGL_NEU_ARM64" "$YAAGL_NEU_UNIVERSAL"; do
    if [ ! -x "$YAAGL_NEU_BINARY" ]; then
      echo "Neutralino binary is missing or not executable: $YAAGL_NEU_BINARY" >&2
      return 1
    fi
    if [ -n "$YAAGL_NEU_COMMIT" ]; then
      YAAGL_NEU_COMMIT_MARKERS="$YAAGL_NEU_COMMIT"
    else
      echo "Warning: release commit unavailable; skipping commit marker verification" >&2
      YAAGL_NEU_COMMIT_MARKERS=""
    fi
    for YAAGL_NEU_MARKER in \
      transparentTitleBar titleBarDragHeight \
      filesystem.removeFile filesystem.moveFile filesystem.copyFile \
      $YAAGL_NEU_COMMIT_MARKERS; do
      if ! strings "$YAAGL_NEU_BINARY" | grep -qFx "$YAAGL_NEU_MARKER"; then
        echo "Neutralino capability marker missing from $YAAGL_NEU_BINARY: $YAAGL_NEU_MARKER" >&2
        return 1
      fi
    done
  done

  if [ "$(lipo -archs "$YAAGL_NEU_X64")" != "x86_64" ]; then
    echo "Invalid x64 Neutralino architecture" >&2
    return 1
  fi
  if [ "$(lipo -archs "$YAAGL_NEU_ARM64")" != "arm64" ]; then
    echo "Invalid arm64 Neutralino architecture" >&2
    return 1
  fi
  YAAGL_NEU_UNIVERSAL_ARCHS=$(lipo -archs "$YAAGL_NEU_UNIVERSAL")
  case "$YAAGL_NEU_UNIVERSAL_ARCHS" in
    "x86_64 arm64"|"arm64 x86_64") ;;
    *)
      echo "Invalid universal Neutralino architectures: $YAAGL_NEU_UNIVERSAL_ARCHS" >&2
      return 1
      ;;
  esac
}

yaagl_neu_verify_release() {
  yaagl_neu_verify_capabilities "$1" || return 1
}

yaagl_neu_download_release() {
  YAAGL_NEU_DOWNLOAD_DIR=$1
  YAAGL_NEU_DOWNLOADED_ARCHIVE="$YAAGL_NEU_DOWNLOAD_DIR/$YAAGL_NEU_ARCHIVE"
  YAAGL_NEU_DOWNLOADED_SUMS="$YAAGL_NEU_DOWNLOAD_DIR/SHA256SUMS"
  echo "Downloading verified Neutralino fork release $YAAGL_NEU_TAG..."
  curl -fsSL "$YAAGL_NEU_SHA_URL" -o "$YAAGL_NEU_DOWNLOADED_SUMS" || return 1
  curl -fsSL "$YAAGL_NEU_URL" -o "$YAAGL_NEU_DOWNLOADED_ARCHIVE" || return 1
  yaagl_neu_verify_checksums "$YAAGL_NEU_DOWNLOADED_SUMS" "$YAAGL_NEU_DOWNLOADED_ARCHIVE" || return 1
  mkdir -p "$YAAGL_NEU_DOWNLOAD_DIR/runtime"
  unzip -q "$YAAGL_NEU_DOWNLOADED_ARCHIVE" -d "$YAAGL_NEU_DOWNLOAD_DIR/runtime" || return 1
  yaagl_neu_verify_checksums "$YAAGL_NEU_DOWNLOADED_SUMS" \
    "$YAAGL_NEU_DOWNLOAD_DIR/runtime/neutralino-mac_x64" \
    "$YAAGL_NEU_DOWNLOAD_DIR/runtime/neutralino-mac_arm64" \
    "$YAAGL_NEU_DOWNLOAD_DIR/runtime/neutralino-mac_universal" || return 1
  yaagl_neu_verify_release "$YAAGL_NEU_DOWNLOAD_DIR/runtime" || return 1
}

yaagl_neu_install_runtime() {
  mkdir -p bin
  for YAAGL_NEU_NAME in neutralino-mac_x64 neutralino-mac_arm64 neutralino-mac_universal; do
    install -m 0755 "$1/$YAAGL_NEU_NAME" "bin/.$YAAGL_NEU_NAME.yaagl-new"
  done
  for YAAGL_NEU_NAME in neutralino-mac_x64 neutralino-mac_arm64 neutralino-mac_universal; do
    mv "bin/.$YAAGL_NEU_NAME.yaagl-new" "bin/$YAAGL_NEU_NAME"
  done
}

yaagl_neu_resolve_release || {
  echo "Unable to resolve the latest MXJinjing Neutralino fork release." >&2
  exit 1
}

if yaagl_neu_verify_release bin >/dev/null 2>&1; then
  echo "Using verified Neutralino fork release $YAAGL_NEU_TAG"
else
  YAAGL_NEU_TMP=$(mktemp -d "${TMPDIR:-/tmp}/yaagl-neutralino.XXXXXX")
  trap 'rm -rf "$YAAGL_NEU_TMP"' EXIT
  if yaagl_neu_download_release "$YAAGL_NEU_TMP"; then
    YAAGL_NEU_READY_DIR="$YAAGL_NEU_TMP/runtime"
  else
    echo "Unable to obtain the latest MXJinjing Neutralino fork release." >&2
    exit 1
  fi
  yaagl_neu_install_runtime "$YAAGL_NEU_READY_DIR"
  yaagl_neu_verify_capabilities bin
  echo "Installed verified Neutralino fork $YAAGL_NEU_TAG"
fi

curl -sSL https://github.com/neutralinojs/neutralino.js/releases/download/v3.9.0/neutralino.js > neutralino.js

# The yaagl-neutralinojs fork server uses the legacy filesystem API names
# (removeFile/moveFile/copyFile); the v3.9.0 client already exposes them, so
# no remap is needed.

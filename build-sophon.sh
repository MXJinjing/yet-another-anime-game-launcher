#!/bin/bash
# Fetch the SophonCLI release named in sophon.release.
# Set SOPHON_FROM_SOURCE=1 to compile the local sophon_server/swift mirror instead.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET_ARCH="${SOPHON_ARCH:-arm64}"
case "$TARGET_ARCH" in
  arm64)
    triple=arm64-apple-macosx13.0
    lipo_arch=arm64
    ;;
  x64)
    triple=x86_64-apple-macosx13.0
    lipo_arch=x86_64
    ;;
  *)
    echo "Unsupported SOPHON_ARCH: $TARGET_ARCH" >&2
    exit 1
    ;;
esac
DEST="$ROOT/sophon_server/dist/$TARGET_ARCH"

build_from_source() {
  local source="$ROOT/sophon_server/swift"
  local scratch="${SOPHON_BUILD_SCRATCH:-$source/.build-release}"
  local bin
  swift build --package-path "$source" --scratch-path "$scratch" --force-resolved-versions \
    --triple "$triple" --configuration release --product SophonCLI -j "${SOPHON_BUILD_JOBS:-6}"
  bin="$(swift build --package-path "$source" --scratch-path "$scratch" \
    --triple "$triple" --configuration release --show-bin-path)"
  mkdir -p "$DEST"
  install -m 755 "$bin/SophonCLI" "$DEST/SophonCLI"
  install -m 644 "$source/LICENSE" "$DEST/LICENSE"
  xcrun swift-stdlib-tool --copy --platform macosx \
    --scan-executable "$DEST/SophonCLI" --destination "$DEST"
  xcrun lipo -verify_arch "$lipo_arch" "$DEST/SophonCLI"
  printf 'source\n' > "$DEST/VERSION"
}

download_release() {
  local release_file="$ROOT/sophon.release"
  local repository="" tag="" line key value
  local archive="SophonCLI-darwin-${TARGET_ARCH}.tar.gz"
  local tmp base token
  [ -f "$release_file" ] || {
    echo "Missing $release_file" >&2
    exit 1
  }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "" | \#*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      repository) repository="$value" ;;
      tag) tag="$value" ;;
      *)
        echo "Unknown Sophon release field: $key" >&2
        exit 1
        ;;
    esac
  done < "$release_file"
  case "$repository" in
    [A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*) ;;
    *)
      echo "Invalid Sophon repository: ${repository}" >&2
      exit 1
      ;;
  esac
  case "$repository" in
    */*/* | *..*)
      echo "Invalid Sophon repository: ${repository}" >&2
      exit 1
      ;;
  esac
  case "$tag" in
    v[0-9A-Za-z._+-]*) ;;
    *)
      echo "Invalid Sophon release tag: ${tag}" >&2
      exit 1
      ;;
  esac
  case "$tag" in
    *[!0-9A-Za-z._+-]*)
      echo "Invalid Sophon release tag: ${tag}" >&2
      exit 1
      ;;
  esac

  base="https://github.com/${repository}/releases/download/${tag}"
  token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/yaaglm-sophon.XXXXXX")"
  trap 'rm -rf "$tmp"' RETURN
  echo "Downloading ${base}/${archive}"
  curl_args=(-fL --retry 3 -sS)
  if [ -n "$token" ]; then
    curl_args+=(-H "Authorization: Bearer ${token}")
  fi
  curl "${curl_args[@]}" -o "$tmp/SHA256SUMS" "${base}/SHA256SUMS"
  curl "${curl_args[@]}" -o "$tmp/$archive" "${base}/${archive}"
  grep -E "^[0-9a-f]{64}  ${archive}$" "$tmp/SHA256SUMS" > "$tmp/${archive}.sha256"
  [ "$(wc -l < "$tmp/${archive}.sha256" | tr -d ' ')" = "1" ] || {
    echo "SHA256SUMS has no single entry for ${archive}" >&2
    exit 1
  }
  (cd "$tmp" && shasum -a 256 -c "${archive}.sha256")
  rm -rf "$DEST"
  mkdir -p "$DEST"
  tar -C "$DEST" -xzf "$tmp/$archive"
  [ -x "$DEST/SophonCLI" ] || {
    echo "SophonCLI is missing from ${archive}" >&2
    exit 1
  }
  xcrun lipo -verify_arch "$lipo_arch" "$DEST/SophonCLI"
  printf '%s\n' "$tag" > "$DEST/VERSION"
  echo "Installed ${repository} ${tag} for ${TARGET_ARCH}"
}

if [ "${SOPHON_FROM_SOURCE:-}" = "1" ]; then
  build_from_source
else
  download_release
fi

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
YAAGL_NEU_TAG="v4.11.0-yaagl.2"
YAAGL_NEU_COMMIT="d7e7c6deae143248f383f5adff715499ca15b31a"
YAAGL_NEU_ARCHIVE="neutralinojs-${YAAGL_NEU_TAG}.zip"
YAAGL_NEU_URL="https://github.com/MXJinjing/yaagl-neutralinojs/releases/download/${YAAGL_NEU_TAG}/${YAAGL_NEU_ARCHIVE}"
YAAGL_NEU_ARCHIVE_SHA256="c607ce5cab6fed311781a8c449117f94077e2f54a1f1424cc1dd086121cc7840"
# These hashes correspond to the locally built MXJinjing fork with the
# x86_64 objc_msgSend_stret fix for CGRect-returning messages. Rebuild it
# from source via YAAGL_NEUTRALINO_SOURCE when bin/ is missing.
YAAGL_NEU_X64_SHA256="6f2ee284b5d67c53af92c783ad6ffa7079410fa9bba93ba17b1d2128645945f9"
YAAGL_NEU_ARM64_SHA256="963ac3ac891dbcb81b7641ff95079aa468e5ac549b77e89a4bf2aee3ed215ef8"
YAAGL_NEU_UNIVERSAL_SHA256="ef936a3397b4a34d8c9d0249facf855cadc045149d53637ae9a3f599e12d8d38"

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
    for YAAGL_NEU_MARKER in \
      transparentTitleBar titleBarDragHeight \
      filesystem.removeFile filesystem.moveFile filesystem.copyFile \
      "$YAAGL_NEU_COMMIT"; do
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
  yaagl_neu_expect_hash "$1/neutralino-mac_x64" "$YAAGL_NEU_X64_SHA256" || return 1
  yaagl_neu_expect_hash "$1/neutralino-mac_arm64" "$YAAGL_NEU_ARM64_SHA256" || return 1
  yaagl_neu_expect_hash "$1/neutralino-mac_universal" "$YAAGL_NEU_UNIVERSAL_SHA256" || return 1
}

yaagl_neu_download_release() {
  YAAGL_NEU_DOWNLOAD_DIR=$1
  YAAGL_NEU_DOWNLOADED_ARCHIVE="$YAAGL_NEU_DOWNLOAD_DIR/$YAAGL_NEU_ARCHIVE"
  echo "Downloading verified Neutralino fork release $YAAGL_NEU_TAG..."
  curl -fsSL "$YAAGL_NEU_URL" -o "$YAAGL_NEU_DOWNLOADED_ARCHIVE" || return 1
  yaagl_neu_expect_hash "$YAAGL_NEU_DOWNLOADED_ARCHIVE" "$YAAGL_NEU_ARCHIVE_SHA256" || return 1
  mkdir -p "$YAAGL_NEU_DOWNLOAD_DIR/runtime"
  unzip -q "$YAAGL_NEU_DOWNLOADED_ARCHIVE" -d "$YAAGL_NEU_DOWNLOAD_DIR/runtime" || return 1
  yaagl_neu_verify_release "$YAAGL_NEU_DOWNLOAD_DIR/runtime" || return 1
}

yaagl_neu_build_from_source() {
  YAAGL_NEU_BUILD_DIR=$1
  YAAGL_NEU_SOURCE=${YAAGL_NEUTRALINO_SOURCE:-}
  if [ -z "$YAAGL_NEU_SOURCE" ] || [ ! -d "$YAAGL_NEU_SOURCE/.git" ]; then
    return 1
  fi

  YAAGL_NEU_ORIGIN=$(git -C "$YAAGL_NEU_SOURCE" remote get-url origin 2>/dev/null || true)
  case "$YAAGL_NEU_ORIGIN" in
    git@github.com:MXJinjing/yaagl-neutralinojs.git|\
    https://github.com/MXJinjing/yaagl-neutralinojs|\
    https://github.com/MXJinjing/yaagl-neutralinojs.git) ;;
    *)
      echo "YAAGL_NEUTRALINO_SOURCE is not the MXJinjing fork: $YAAGL_NEU_ORIGIN" >&2
      return 1
      ;;
  esac
  if ! git -C "$YAAGL_NEU_SOURCE" cat-file -e "$YAAGL_NEU_COMMIT^{commit}" 2>/dev/null; then
    echo "Pinned Neutralino commit is unavailable in YAAGL_NEUTRALINO_SOURCE: $YAAGL_NEU_COMMIT" >&2
    return 1
  fi

  YAAGL_NEU_WORKTREE="$YAAGL_NEU_BUILD_DIR/source"
  if ! git -C "$YAAGL_NEU_SOURCE" worktree add --detach "$YAAGL_NEU_WORKTREE" "$YAAGL_NEU_COMMIT"; then
    return 1
  fi
  YAAGL_NEU_BUILD_STATUS=0
  (
    cd "$YAAGL_NEU_WORKTREE"
    export MACOSX_DEPLOYMENT_TARGET=11.0
    export CXX="clang++ -ObjC++"
    ./scripts/bz.py --target_arch x64
    ./scripts/bz.py --target_arch arm64
    lipo bin/neutralino-mac_x64 bin/neutralino-mac_arm64 \
      -create -output bin/neutralino-mac_universal
  ) || YAAGL_NEU_BUILD_STATUS=$?
  if [ "$YAAGL_NEU_BUILD_STATUS" -eq 0 ]; then
    mkdir -p "$YAAGL_NEU_BUILD_DIR/runtime"
    for YAAGL_NEU_NAME in neutralino-mac_x64 neutralino-mac_arm64 neutralino-mac_universal; do
      cp "$YAAGL_NEU_WORKTREE/bin/$YAAGL_NEU_NAME" "$YAAGL_NEU_BUILD_DIR/runtime/$YAAGL_NEU_NAME" || YAAGL_NEU_BUILD_STATUS=$?
      chmod 0755 "$YAAGL_NEU_BUILD_DIR/runtime/$YAAGL_NEU_NAME" || YAAGL_NEU_BUILD_STATUS=$?
    done
  fi
  git -C "$YAAGL_NEU_SOURCE" worktree remove --force "$YAAGL_NEU_WORKTREE" >/dev/null 2>&1 || true
  if [ "$YAAGL_NEU_BUILD_STATUS" -ne 0 ]; then
    echo "Failed to build the pinned Neutralino fork source" >&2
    return "$YAAGL_NEU_BUILD_STATUS"
  fi
  yaagl_neu_verify_capabilities "$YAAGL_NEU_BUILD_DIR/runtime"
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

if yaagl_neu_verify_release bin >/dev/null 2>&1; then
  echo "Using verified Neutralino fork release $YAAGL_NEU_TAG"
else
  YAAGL_NEU_TMP=$(mktemp -d "${TMPDIR:-/tmp}/yaagl-neutralino.XXXXXX")
  trap 'rm -rf "$YAAGL_NEU_TMP"' EXIT
  if yaagl_neu_download_release "$YAAGL_NEU_TMP"; then
    YAAGL_NEU_READY_DIR="$YAAGL_NEU_TMP/runtime"
  elif [ -n "${YAAGL_NEUTRALINO_SOURCE:-}" ] && yaagl_neu_build_from_source "$YAAGL_NEU_TMP"; then
    YAAGL_NEU_READY_DIR="$YAAGL_NEU_TMP/runtime"
  elif git clone --quiet --filter=blob:none \
      "https://github.com/MXJinjing/yaagl-neutralinojs.git" \
      "$YAAGL_NEU_TMP/source-clone" \
    && YAAGL_NEUTRALINO_SOURCE="$YAAGL_NEU_TMP/source-clone" \
      yaagl_neu_build_from_source "$YAAGL_NEU_TMP"; then
    YAAGL_NEU_READY_DIR="$YAAGL_NEU_TMP/runtime"
  else
    echo "Unable to obtain the verified MXJinjing Neutralino fork." >&2
    echo "Retry the release download, or explicitly set:" >&2
    echo "  YAAGL_NEUTRALINO_SOURCE=/path/to/MXJinjing/yaagl-neutralinojs ./configure.sh" >&2
    exit 1
  fi
  yaagl_neu_install_runtime "$YAAGL_NEU_READY_DIR"
  yaagl_neu_verify_capabilities bin
  echo "Installed verified Neutralino fork $YAAGL_NEU_TAG"
fi

curl -sSL https://github.com/neutralinojs/neutralino.js/releases/download/v3.9.0/neutralino.js > neutralino.js

# The yaagl-neutralinojs fork server (v4.11.0) implements the legacy
# filesystem API names (removeFile/moveFile/copyFile), while the stock
# neutralino.js 3.x client sends the new names (remove/move/copy).
# Remap the client's method names so they match the fork server.
python3 - <<'PY'
import sys

path = "neutralino.js"
with open(path, encoding="utf-8") as f:
    s = f.read()

for old, new in (
    ('l("filesystem.remove",', 'l("filesystem.removeFile",'),
    ('l("filesystem.move",', 'l("filesystem.moveFile",'),
    ('l("filesystem.copy",', 'l("filesystem.copyFile",'),
):
    if old in s:
        s = s.replace(old, new, 1)
    elif new not in s:
        sys.exit(f"pattern not found in {path}: {old}")

with open(path, "w", encoding="utf-8") as f:
    f.write(s)

print("OK: remapped filesystem method names in neutralino.js")
PY

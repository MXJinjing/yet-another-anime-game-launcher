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

# Neutralinojs runtime (patched fork: transparent macOS titlebar with traffic
# lights). The binaries in ./bin are built from the yaagl-neutralinojs fork
# (github.com/MXJinjing/yaagl-neutralinojs). Keep them; only download the
# stock 3Shain release as a fallback for fresh checkouts.
if [ ! -f bin/neutralino-mac_arm64 ]; then
  curl -sSL https://github.com/3Shain/neutralinojs/releases/download/v4.11.0-1/neutralinojs-v4.11.0.zip > neu.zip
  unzip -o -d bin neu.zip
  rm neu.zip
  echo "WARNING: downloaded the stock 3Shain Neutralino binary; rebuild from"
  echo "         the yaagl-neutralinojs fork to get the transparent titlebar."
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

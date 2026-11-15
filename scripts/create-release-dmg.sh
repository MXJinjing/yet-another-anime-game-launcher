#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ] || [ ! -d "$1" ] || [[ "$1" != *.app || "$2" != *.dmg ]]; then
  echo "Usage: bash scripts/create-release-dmg.sh <source.app> <output.dmg>" >&2
  exit 1
fi

app="$1"
output="$2"
app_name="${app##*/}"
work_dir="$(mktemp -d "$(dirname -- "$output")/.yaaglm-dmg.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

payload="$work_dir/payload"
image="$work_dir/installer.dmg"
mkdir "$payload"
ditto "$app" "$payload/$app_name"
ln -s /Applications "$payload/Applications"

hdiutil create -quiet -format UDZO -fs HFS+ -volname "${app_name%.app}" \
  -srcfolder "$payload" "$image"
hdiutil verify -quiet "$image"
mv -f "$image" "$output"

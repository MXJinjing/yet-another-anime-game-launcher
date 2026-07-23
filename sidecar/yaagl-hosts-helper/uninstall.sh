#!/bin/sh
set -eu

HELPER_DST="/Library/PrivilegedHelperTools/yaagl-hosts-helper"
PLIST_DST="/Library/LaunchDaemons/com.3shain.yaagl.hosts-helper.plist"
SOCKET_PATH="/var/run/yaagl-hosts-helper.sock"

if [ "$(id -u)" != "0" ]; then
  echo "uninstall.sh must run as root" >&2
  exit 1
fi

launchctl bootout system "$PLIST_DST" >/dev/null 2>&1 || true
rm -f "$HELPER_DST" "$PLIST_DST" "$SOCKET_PATH"

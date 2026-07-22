#!/bin/sh
set -eu

HELPER_SRC="${1:-}"
HELPER_DST="/Library/PrivilegedHelperTools/yaagl-hosts-helper"
PLIST_DST="/Library/LaunchDaemons/com.3shain.yaagl.hosts-helper.plist"

if [ "$(id -u)" != "0" ]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

if [ ! -x "$HELPER_SRC" ]; then
  echo "helper binary is missing or not executable: $HELPER_SRC" >&2
  exit 1
fi

mkdir -p "/Library/PrivilegedHelperTools"
install -o root -g wheel -m 0755 "$HELPER_SRC" "$HELPER_DST"

cat > "$PLIST_DST" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.3shain.yaagl.hosts-helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Library/PrivilegedHelperTools/yaagl-hosts-helper</string>
    <string>--daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/yaagl-hosts-helper.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/yaagl-hosts-helper.log</string>
</dict>
</plist>
PLIST

chown root:wheel "$PLIST_DST"
chmod 0644 "$PLIST_DST"

launchctl bootout system "$PLIST_DST" >/dev/null 2>&1 || true
launchctl bootstrap system "$PLIST_DST"
launchctl kickstart -k system/com.3shain.yaagl.hosts-helper

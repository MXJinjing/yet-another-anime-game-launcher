#!/bin/sh
# uninstall.sh -- remove one bundle_id from the privileged hosts-helper registry.
#
# Usage: uninstall.sh <bundle_id>
#
# Must run as root.  Removes the bundle's registry row and its user-side token
# file; if the registry becomes empty (or did not exist), performs a full
# uninstall of the daemon (helper binary, plist and socket).
#
# Registry writes are serialized with flock(2).  macOS ships no flock(1)
# binary, so the lock is acquired with /usr/bin/python3 + fcntl.flock on
# /var/db/yaaglm-hosts-helper.lock and the registry is replaced atomically via
# a temporary file + rename.
#
# Exit codes: 0 success / 1 error.

set -eu

REGISTRY="/var/db/yaaglm-hosts-helper.registry"
LOCK_FILE="/var/db/yaaglm-hosts-helper.lock"
HELPER_DST="/Library/PrivilegedHelperTools/yaaglm-hosts-helper"
PLIST_DST="/Library/LaunchDaemons/com.3shain.yaaglm.hosts-helper.plist"
SOCKET_PATH="/var/run/yaaglm-hosts-helper.sock"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <bundle_id>" >&2
  exit 1
fi
bundle_id="$1"

# ---- must run as root -------------------------------------------------------
if [ "$(id -u)" != "0" ]; then
  echo "uninstall.sh must run as root" >&2
  exit 1
fi

# ---- registry update (flock(2) via python3; macOS has no flock(1)) -----------
# Removes the bundle_id row and its token file, writes the registry back
# atomically, and prints 1 when a full daemon uninstall should follow.
out="$(/usr/bin/python3 - "$LOCK_FILE" "$REGISTRY" "$bundle_id" <<'PY'
import fcntl, os, sys, tempfile

def fail(msg):
    sys.stderr.write("uninstall.sh: %s\n" % msg)
    sys.exit(1)

lock_file, registry_file, bundle_id = sys.argv[1:4]

try:
    lock_fd = open(lock_file, "a+")
except OSError as e:
    fail("cannot open lock file %s: %s" % (lock_file, e))
fcntl.flock(lock_fd, fcntl.LOCK_EX)

registry_existed = os.path.exists(registry_file)
token_path = ""
found = False
lines = []
if registry_existed:
    try:
        with open(registry_file, "r") as rf:
            for raw in rf:
                line = raw.rstrip("\n")
                if line.strip() == "" or line.lstrip().startswith("#"):
                    lines.append(line)
                    continue
                fields = line.split("|")
                if fields and fields[0] == bundle_id:
                    found = True
                    if len(fields) >= 6:
                        tp = fields[5].strip()
                        if tp.startswith("/") and tp != "/":
                            token_path = tp
                    continue
                lines.append(line)
    except OSError as e:
        fail("cannot read registry %s: %s" % (registry_file, e))

if found:
    if token_path:
        try:
            os.unlink(token_path)
        except FileNotFoundError:
            pass
        except OSError as e:
            fail("cannot remove token file %s: %s" % (token_path, e))
    try:
        fd, tmp_reg = tempfile.mkstemp(dir=os.path.dirname(registry_file), prefix=".yaaglm-registry-")
        with os.fdopen(fd, "w") as wf:
            wf.write("\n".join(lines))
            if lines:
                wf.write("\n")
        os.chmod(tmp_reg, 0o600)
        os.chown(tmp_reg, 0, 0)
        os.rename(tmp_reg, registry_file)
    except OSError as e:
        fail("cannot update registry %s: %s" % (registry_file, e))

# Full uninstall when the registry is empty or was never created.
non_comment = [l for l in lines if l.strip() and not l.lstrip().startswith("#")]
full_uninstall = 1 if (not registry_existed or not non_comment) else 0

try:
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
except OSError:
    pass
lock_fd.close()

print(full_uninstall)
sys.exit(0)
PY
)" || {
  echo "uninstall.sh: failed to update registry" >&2
  exit 1
}

full_uninstall="$(printf '%s\n' "$out" | /usr/bin/head -1)"

# ---- full daemon uninstall when the registry is empty ------------------------
if [ "$full_uninstall" = "1" ]; then
  /bin/launchctl bootout system "$PLIST_DST" >/dev/null 2>&1 || true
  /bin/rm -f "$HELPER_DST" "$PLIST_DST" "$SOCKET_PATH"
fi

exit 0

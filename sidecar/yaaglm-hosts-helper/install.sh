#!/bin/sh
# install.sh -- register one trusted app bundle with the privileged hosts-helper.
#
# Usage: install.sh --bundle <appBundlePath> --helper <helperBinaryInBundle> [--re-register]
#
# Must run as root. A bundle is trusted only when it is a real directory
# containing Contents/Info.plist and Contents/Resources/build-manifest.json,
# and the bundle dir / Info.plist / launcher binary / helper binary are all
# non-symlinks, owned consistently by either root or the current console user,
# with no group/other write bits. Binary hashes are always computed from disk
# (shasum -a 256), never taken from the manifest.
#
# Registry writes are serialized with flock(2).  macOS ships no flock(1)
# binary, so the lock is acquired with /usr/bin/python3 + fcntl.flock on
# /var/db/yaaglm-hosts-helper.lock and the registry is replaced atomically via
# a temporary file + rename.
#
# Exit codes: 0 success (idempotent no-op included) / 1 error / 2 untrusted bundle.

set -eu

REGISTRY="/var/db/yaaglm-hosts-helper.registry"
LOCK_FILE="/var/db/yaaglm-hosts-helper.lock"
HELPER_DST="/Library/PrivilegedHelperTools/yaaglm-hosts-helper"
PLIST_DST="/Library/LaunchDaemons/com.3shain.yaaglm.hosts-helper.plist"
LABEL="com.3shain.yaaglm.hosts-helper"

usage() {
  echo "Usage: $0 --bundle <appBundlePath> --helper <helperBinaryInBundle> [--re-register]" >&2
}

# ---- argument parsing -------------------------------------------------------
bundle_path=""
helper_src=""
force_reregister="0"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --bundle)
      if [ "$#" -lt 2 ]; then
        echo "install.sh: --bundle requires a value" >&2
        exit 1
      fi
      bundle_path="$2"
      shift 2
      ;;
    --helper)
      if [ "$#" -lt 2 ]; then
        echo "install.sh: --helper requires a value" >&2
        exit 1
      fi
      helper_src="$2"
      shift 2
      ;;
    --re-register)
      force_reregister="1"
      shift
      ;;
    *)
      echo "install.sh: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$bundle_path" ] || [ -z "$helper_src" ]; then
  echo "install.sh: --bundle and --helper are required" >&2
  usage
  exit 1
fi

# ---- must run as root -------------------------------------------------------
if [ "$(id -u)" != "0" ]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

# ---- trust gate (any failure -> exit 2) -------------------------------------
INFO_PLIST="$bundle_path/Contents/Info.plist"
MANIFEST="$bundle_path/Contents/Resources/build-manifest.json"

trust_fail() {
  echo "untrusted bundle: $*" >&2
  exit 2
}

trust_check_path() {
  # $1 = label, $2 = path
  label="$1"
  path="$2"
  [ -e "$path" ] || trust_fail "$label not found: $path"
  if [ -L "$path" ]; then
    trust_fail "$label is a symbolic link: $path"
  fi
  owner="$(/usr/bin/stat -f %u "$path" 2>/dev/null)" || trust_fail "cannot stat $label: $path"
  [ "$owner" = "$TRUSTED_OWNER_UID" ] || trust_fail "$label owner uid is $owner, expected $TRUSTED_OWNER_UID: $path"
  perm="$(/usr/bin/stat -f %Lp "$path" 2>/dev/null)" || trust_fail "cannot stat $label: $path"
  if [ $(( 0$perm & 0022 )) -ne 0 ]; then
    trust_fail "$label is group/other-writable (mode $perm): $path"
  fi
}

[ -d "$bundle_path" ] || trust_fail "app bundle is not a directory: $bundle_path"
[ -f "$INFO_PLIST" ] || trust_fail "missing Contents/Info.plist: $INFO_PLIST"
[ -f "$MANIFEST" ] || trust_fail "missing Contents/Resources/build-manifest.json: $MANIFEST"

# The privileged script is launched by the console user through an administrator
# authorization prompt. Keep accepting root-owned bundles, but also accept a
# bundle owned by that console user so a normal drag-and-drop installation does
# not fail the trust gate. All trusted inputs below must have the same owner.
console_uid="$(/usr/bin/stat -f %u /dev/console 2>/dev/null || true)"
bundle_owner="$(/usr/bin/stat -f %u "$bundle_path" 2>/dev/null || true)"
if [ "$bundle_owner" = "0" ]; then
  TRUSTED_OWNER_UID="0"
elif [ -n "$console_uid" ] && [ "$console_uid" != "0" ] && [ "$bundle_owner" = "$console_uid" ]; then
  TRUSTED_OWNER_UID="$console_uid"
else
  trust_fail "app bundle owner uid is $bundle_owner; expected root or console user uid $console_uid"
fi

# Manifest values are used only for version/appName/launcherPath.  Hashes are
# always computed from disk below; manifest hashes are never trusted.
read_manifest_key() {
  /usr/bin/plutil -extract "$1" raw -o - "$MANIFEST" 2>/dev/null || true
}
VERSION="$(read_manifest_key version)"
APP_NAME="$(read_manifest_key appName)"
LAUNCHER_PATH="$(read_manifest_key launcherPath)"

[ -n "$VERSION" ] || trust_fail "build-manifest.json has no version"
[ -n "$APP_NAME" ] || trust_fail "build-manifest.json has no appName"
[ -n "$LAUNCHER_PATH" ] || trust_fail "build-manifest.json has no launcherPath"

case "$APP_NAME" in
  ""|"."|".."|*/*) trust_fail "invalid appName: $APP_NAME" ;;
esac

case "$LAUNCHER_PATH" in
  ""|/*|".."|"../"*|*"/../"*|*"/..")
    trust_fail "launcherPath escapes the bundle: $LAUNCHER_PATH" ;;
esac

case "$VERSION" in
  *[!A-Za-z0-9.+-]*|"") trust_fail "version has invalid characters: $VERSION" ;;
esac
if [ "${#VERSION}" -gt 64 ]; then
  trust_fail "version too long: $VERSION"
fi

LAUNCHER_BIN="$bundle_path/Contents/$LAUNCHER_PATH"

trust_check_path "app bundle" "$bundle_path"
trust_check_path "Contents/Info.plist" "$INFO_PLIST"
trust_check_path "launcher binary" "$LAUNCHER_BIN"
trust_check_path "helper binary" "$helper_src"

# ---- bundle id ---------------------------------------------------------------
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$INFO_PLIST" 2>/dev/null || true)"
[ -n "$BUNDLE_ID" ] || trust_fail "cannot read CFBundleIdentifier from Info.plist"
case "$BUNDLE_ID" in
  *[!A-Za-z0-9.-]*|"") trust_fail "CFBundleIdentifier has invalid characters: $BUNDLE_ID" ;;
esac
if [ "${#BUNDLE_ID}" -gt 128 ]; then
  trust_fail "CFBundleIdentifier too long: $BUNDLE_ID"
fi

# ---- hashes (computed from disk, never trusted from the manifest) ------------
launcher_sha="$(/usr/bin/shasum -a 256 "$LAUNCHER_BIN" | /usr/bin/awk '{print $1}')"
helper_sha="$(/usr/bin/shasum -a 256 "$helper_src" | /usr/bin/awk '{print $1}')"

# ---- idempotent helper install -----------------------------------------------
mkdir -p "/Library/PrivilegedHelperTools"

need_install=0
if [ ! -f "$HELPER_DST" ]; then
  need_install=1
else
  installed_sha="$(/usr/bin/shasum -a 256 "$HELPER_DST" 2>/dev/null | /usr/bin/awk '{print $1}' || true)"
  if [ "$installed_sha" != "$helper_sha" ]; then
    need_install=1
  fi
fi

if [ "$need_install" -eq 1 ]; then
  /usr/bin/install -o root -g wheel -m 0755 "$helper_src" "$HELPER_DST"
  verified_sha="$(/usr/bin/shasum -a 256 "$HELPER_DST" | /usr/bin/awk '{print $1}')"
  if [ "$verified_sha" != "$helper_sha" ]; then
    echo "install.sh: verification of installed helper failed" >&2
    exit 1
  fi
fi

# ---- launchd plist (idempotent) ----------------------------------------------
cat > "$PLIST_DST" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.3shain.yaaglm.hosts-helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Library/PrivilegedHelperTools/yaaglm-hosts-helper</string>
    <string>--daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/yaaglm-hosts-helper.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/yaaglm-hosts-helper.log</string>
</dict>
</plist>
PLIST
/usr/sbin/chown root:wheel "$PLIST_DST"
/bin/chmod 0644 "$PLIST_DST"

/bin/launchctl bootout system "$PLIST_DST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap system "$PLIST_DST"
/bin/launchctl kickstart -k system/$LABEL

# ---- console user and user-side token path -----------------------------------
console_user="$(/usr/bin/stat -f %Su /dev/console 2>/dev/null || true)"
if [ -z "$console_user" ] || [ "$console_user" = "root" ]; then
  token_owner="root"
else
  token_owner="$console_user"
fi
home_dir="$(/usr/bin/dscl . -read "/Users/$token_owner" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}' || true)"
if [ -z "$home_dir" ]; then
  home_dir="/Users/$token_owner"
fi
token_dir="$home_dir/Library/Application Support/$APP_NAME/tokens"
token_path="$token_dir/$BUNDLE_ID.token"

# ---- registry upsert (flock(2) via python3; macOS has no flock(1)) ------------
# Locked section: decide reuse/generate token, write the user token file (dir
# 0700, file 0600, owned by the console user), then atomically upsert the row.
if ! /usr/bin/python3 - "$LOCK_FILE" "$REGISTRY" "$BUNDLE_ID" "$VERSION" "$launcher_sha" "$helper_sha" "$token_path" "$token_owner" "$force_reregister" <<'PY'
import fcntl, os, pwd, subprocess, sys, tempfile

def fail(msg):
    sys.stderr.write("install.sh: %s\n" % msg)
    sys.exit(1)

lock_file, registry_file, bundle_id, version, launcher_sha, client_sha, token_path, token_owner, force_reregister = sys.argv[1:10]

if len(token_path) > 1024:
    fail("token path too long: %s" % token_path)

try:
    pw = pwd.getpwnam(token_owner)
except KeyError:
    try:
        pw = pwd.getpwnam("root")
    except KeyError:
        fail("cannot resolve owner for token file: %s" % token_owner)
uid, gid = pw.pw_uid, pw.pw_gid
token_dir = os.path.dirname(token_path)

try:
    lock_fd = open(lock_file, "a+")
except OSError as e:
    fail("cannot open lock file %s: %s" % (lock_file, e))
fcntl.flock(lock_fd, fcntl.LOCK_EX)

token = None
lines = []
try:
    with open(registry_file, "r") as rf:
        for raw in rf:
            line = raw.rstrip("\n")
            if line.strip() == "" or line.lstrip().startswith("#"):
                lines.append(line)
                continue
            fields = line.split("|")
            if fields and fields[0] == bundle_id:
                # --re-register always rotates the token; a plain install keeps
                # the existing secret so other clients with the same token path
                # do not need to be re-registered.
                if force_reregister != "1" and len(fields) >= 5 and fields[4]:
                    token = fields[4]
                continue  # row replaced below
            lines.append(line)
except FileNotFoundError:
    pass
except OSError as e:
    fail("cannot read registry %s: %s" % (registry_file, e))

if token is None:
    try:
        token = subprocess.check_output(
            ["/usr/bin/openssl", "rand", "-hex", "32"], text=True
        ).strip()
    except Exception as e:
        fail("cannot generate token: %s" % e)
    if len(token) != 64:
        fail("generated token has unexpected length")

# Write the user-side token file while still holding the lock so the on-disk
# token always matches the row we commit below.  Directory 0700, file 0600,
# owned by the console user.
try:
    os.makedirs(token_dir, mode=0o700, exist_ok=True)
    os.chmod(token_dir, 0o700)
    os.chown(token_dir, uid, gid)
except OSError as e:
    fail("cannot prepare token directory %s: %s" % (token_dir, e))

tmp_token = token_path + ".tmp"
try:
    fd = os.open(tmp_token, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, (token + "\n").encode("utf-8"))
    finally:
        os.close(fd)
    os.chmod(tmp_token, 0o600)
    os.chown(tmp_token, uid, gid)
    os.rename(tmp_token, token_path)
except OSError as e:
    fail("cannot write token file %s: %s" % (token_path, e))

# Upsert the registry row (bundle_id|version|launcher_sha256|client_sha256|token|token_path).
lines.append("|".join([bundle_id, version, launcher_sha, client_sha, token, token_path]))
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

try:
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
except OSError:
    pass
lock_fd.close()
sys.exit(0)
PY
then
  echo "install.sh: failed to register $BUNDLE_ID" >&2
  exit 1
fi

echo "install.sh: registered $BUNDLE_ID"
exit 0

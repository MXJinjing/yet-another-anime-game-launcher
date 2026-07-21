import { join } from "path-browserify";
import { CommonUpdateProgram } from "../../../common-update-ui";
import { Server } from "../../../constants";
import {
  mkdirp,
  removeFile,
  writeFile,
  resolve,
  log,
  exec,
  utf16le,
  writeBinary,
  getKeyOrDefault,
  rawString,
  setKey,
} from "../../../utils";
import { Wine } from "../../../wine";
import { Config } from "@config";
import { putLocal, patchProgram, patchRevertProgram } from "../patch";
import { CN_BLOCK_URL, OS_BLOCK_URL } from "../../secret";
import hk4eHDRGlobalReg from "../../../constants/hk4e_hdr_os.reg?raw";
import hk4eHDRCnReg from "../../../constants/hk4e_hdr_cn.reg?raw";
import { gt } from "semver";

const HDR_REGISTRY_FILES = {
  hk4e_global: hk4eHDRGlobalReg,
  hk4e_cn: hk4eHDRCnReg,
} as const;

async function applyHDRRegistry({
  wine,
  server,
}: {
  wine: Wine;
  server: Server;
}) {
  const regContent =
    HDR_REGISTRY_FILES[server.id as keyof typeof HDR_REGISTRY_FILES];
  if (!regContent) return;

  const regPath = resolve("./hk4e_enable_hdr.reg");
  await writeFile(regPath, regContent);
  try {
    await wine.exec("regedit", [wine.toWinePath(regPath)], {}, "/dev/null");
  } finally {
    await removeFile(regPath);
  }
}

async function applyResolutionRegistry(
  wine: Wine,
  server: Server,
  config: Config
) {
  let key = "HKEY_CURRENT_USER\\Software\\\x6d\x69\x48\x6f\x59\x6f\\";
  if (server.id === "hk4e_cn") {
    key += "\u539f\u795e";
  } else if (server.id === "hk4e_global") {
    key += "\x47\x65\x6e\x73\x68\x69\x6e\x20\x49\x6d\x70\x61\x63\x74";
  } else {
    return;
  }

  const width = Number(config.resolutionWidth);
  const height = Number(config.resolutionHeight);
  if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
    return;
  }

  const lines = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[${key}]`,
    `"Screenmanager Is Fullscreen mode_h3981298716"=dword:00000000`,
    `"Screenmanager Resolution Width_h182942802"=dword:${width
      .toString(16)
      .padStart(8, "0")}`,
    `"Screenmanager Resolution Height_h2627697771"=dword:${height
      .toString(16)
      .padStart(8, "0")}`,
  ];

  const path = resolve("./hk4e_resolution.reg");
  await writeBinary(path, utf16le(lines.join("\r\n")));
  try {
    await wine.exec("regedit", [wine.toWinePath(path)], {}, "/dev/null");
  } finally {
    await removeFile(path);
  }
}

const BLOCK_ALL_NET_MARKER_KEY = "block_all_net_active";
const PF_STATE_MARKER_KEY = "pf_was_enabled";
const PF_RULES_FILE = "/tmp/yaagl_block_all.pf";
const PF_WATCHER_SCRIPT = "/tmp/yaagl_block_all_watcher.sh";
// Seconds of game-runtime after which to release the pf block.
const PF_RELEASE_AFTER_SECONDS = 25;

async function isPfCleanupNeeded(): Promise<boolean> {
  const marker = await getKeyOrDefault(BLOCK_ALL_NET_MARKER_KEY, "NOTFOUND");
  return marker === "1";
}

// Wraps a string in single quotes for safe shell interpolation.
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

async function disableAllNetBlock(): Promise<void> {
  // Best-effort restore of original pf state. Each sudo call is independent
  // and tolerates failure (e.g. user denied the password prompt).
  try {
    await exec(["sudo", "pfctl", "-d"], {}, false);
  } catch {
    // ignore — pf may already be disabled, or sudo failed
  }
  try {
    await exec(["sudo", "pfctl", "-F", "all"], {}, false);
  } catch {
    // ignore
  }
  try {
    await exec(["sudo", "pfctl", "-f", "/etc/pf.conf"], {}, false);
  } catch {
    // ignore — user's /etc/pf.conf may be unreadable; rules remain flushed
  }
  try {
    const wasEnabled = await getKeyOrDefault(PF_STATE_MARKER_KEY, "0");
    if (wasEnabled === "1") {
      await exec(["sudo", "pfctl", "-e"], {}, false);
    }
  } catch {
    // ignore
  }
  // Clear the saved state so a stale "1" can never cause us to re-enable pf
  // on a future launch where pf was never enabled by the user in the first place.
  try {
    await setKey(PF_STATE_MARKER_KEY, null);
  } catch {
    // ignore
  }
  try {
    await removeFile(PF_RULES_FILE);
  } catch {
    // ignore
  }
}

export async function disableAllNetBlockExternal(): Promise<void> {
  return disableAllNetBlock();
}

// Builds the auto-release watcher shell script.
//
// The watcher polls every 2 seconds (up to 30 iterations = ~60s) for the game
// process. Once the game has been running for >= PF_RELEASE_AFTER_SECONDS,
// it releases the pf block. If the game never starts / never reaches the
// threshold, the watcher falls back to releasing after the polling budget
// is exhausted.
//
// `ps -o etime=` on macOS emits one of:
//   `mm:ss`           — elapsed <  1 hour
//   `hh:mm:ss`        — elapsed <  1 day
//   `dd-hh:mm:ss`    — elapsed >= 1 day
// We use awk with field separators `[-:]` and switch on field count so we
// correctly compute total elapsed seconds in every case. The previous
// implementation used a `case` whose first pattern `*-*|*:*` matched every
// non-trivial etime string (because every mm:ss contains `:`), making the
// 25-second threshold branch unreachable.
function buildWatcherScript(gameExecutable: string): string {
  return (
    [
      `#!/bin/sh`,
      `PF_RULES_FILE=${shellSingleQuote(PF_RULES_FILE)}`,
      `GAME_EXE=${shellSingleQuote(gameExecutable)}`,
      `MIN_SECS=${PF_RELEASE_AFTER_SECONDS}`,
      `MAX_POLLS=30`,
      `RELEASED=0`,
      `i=0`,
      `while [ "$i" -lt "$MAX_POLLS" ]; do`,
      `  sleep 2`,
      `  GAME_PID=$(pgrep -f "$GAME_EXE" 2>/dev/null | head -1)`,
      `  if [ -n "$GAME_PID" ]; then`,
      `    ELAPSED=$(ps -o etime= -p "$GAME_PID" 2>/dev/null | tr -d ' ')`,
      `    [ -z "$ELAPSED" ] && ELAPSED="0"`,
      `    SECS=$(echo "$ELAPSED" | awk -F'[-:]' '{ n=NF; if(n==0){print 0} else if(n==1){print $1+0} else if(n==2){print $1*60+$2} else if(n==3){print $1*3600+$2*60+$3} else if(n==4){print $1*86400+$2*3600+$3*60+$4} else {print 0} }')`,
      `    SECS=$(echo "$SECS" | tr -d ' \\n')`,
      `    [ -z "$SECS" ] && SECS=0`,
      `    if [ "$SECS" -ge "$MIN_SECS" ] 2>/dev/null; then`,
      `      sudo pfctl -d 2>/dev/null`,
      `      sudo pfctl -F all 2>/dev/null`,
      `      sudo pfctl -f /etc/pf.conf 2>/dev/null`,
      `      rm -f "$PF_RULES_FILE" 2>/dev/null`,
      `      RELEASED=1`,
      `      exit 0`,
      `    fi`,
      `  fi`,
      `  i=$((i + 1))`,
      `done`,
      `# Timeout fallback: release after polling budget exhausted`,
      `if [ "$RELEASED" -eq 0 ]; then`,
      `  sudo pfctl -d 2>/dev/null`,
      `  sudo pfctl -F all 2>/dev/null`,
      `  sudo pfctl -f /etc/pf.conf 2>/dev/null`,
      `  rm -f "$PF_RULES_FILE" 2>/dev/null`,
      `fi`,
    ].join("\n") + "\n"
  );
}

async function enableAllNetBlockAutoRelease(
  gameExecutable: string
): Promise<boolean> {
  // The pf rules file we load as the MAIN ruleset (not an anchor), plus
  // a pass-through for loopback so unrelated localhost traffic keeps working
  // during the brief block window.
  await writeFile(
    PF_RULES_FILE,
    "pass out quick on lo0 all\nblock drop out all\n"
  );

  // Detect whether pf was originally enabled by the user so cleanup can
  // restore that state. If our previous block is still active (e.g. crashed
  // launch), we must NOT trust the "Enabled" status we see — it was set by us.
  const previousMarker = await getKeyOrDefault(
    BLOCK_ALL_NET_MARKER_KEY,
    "NOTFOUND"
  );
  let wasEnabled = false;
  if (previousMarker !== "1") {
    try {
      const st = await exec(["sudo", "pfctl", "-s", "info"], {}, false);
      const out = `${st.stdOut || ""}\n${st.stdErr || ""}`;
      if (/^Status:\s+Enabled/im.test(out)) {
        wasEnabled = true;
      }
    } catch {
      // pf status check failed (sudo denied / not in sudoers): assume pf was
      // disabled. This is the macOS default, so we won't try to re-enable on
      // cleanup.
    }
  }
  await setKey(PF_STATE_MARKER_KEY, wasEnabled ? "1" : "0");

  // Load our rules into the MAIN pf ruleset and enable pf.
  //
  // We deliberately do NOT use a pf anchor here. Anchor rules are only
  // evaluated when the main ruleset references the anchor (e.g. via an
  // `anchor "com.yaagl.block_all"` line in /etc/pf.conf). The default macOS
  // pf.conf has no such reference, so anchor-based blocking would silently
  // be a no-op — the game would still reach its servers and the user would
  // assume the block was working when it was not. Loading directly into the
  // main ruleset works regardless of the user's existing pf.conf.
  try {
    await exec(["sudo", "pfctl", "-f", PF_RULES_FILE, "-e"], {}, false);
  } catch {
    // sudo failed (user denied, no TTY, or sudoers not configured)
    return false;
  }

  // Spawn the auto-release watcher detached so it survives a launcher exit
  // and can still release the block if Yaagl is closed mid-launch.
  await writeFile(PF_WATCHER_SCRIPT, buildWatcherScript(gameExecutable));
  await exec(
    [
      "bash",
      "-c",
      `nohup sh ${shellSingleQuote(PF_WATCHER_SCRIPT)} >/dev/null 2>&1 &`,
    ],
    {},
    false
  );
  return true;
}

export async function* launchGameProgram({
  gameDir,
  gameExecutable,
  wine,
  config,
  server,
}: {
  gameDir: string;
  gameExecutable: string;
  wine: Wine;
  config: Config;
  server: Server;
}): CommonUpdateProgram {
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "PATCHING"];

  await wine.setProps(config);
  if (config.hk4eEnableHDR) {
    await applyHDRRegistry({ wine, server });
  }

  if (config.resolutionCustom) {
    await applyResolutionRegistry(wine, server, config);
  }
  await wine.waitUntilServerOff();

  const cmd = `@echo off
cd "%~dp0"
copy "${wine.toWinePath(
    join(gameDir, atob("SG9Zb0tQcm90ZWN0LnN5cw=="))
  )}" "%WINDIR%\\system32\\"
cd /d "${wine.toWinePath(gameDir)}"
"${wine.toWinePath(
    join(gameDir, gameExecutable)
  )}" -platform_type CLOUD_THIRD_PARTY_PC -is_cloud 1`;
  await writeFile(resolve("config.bat"), cmd);
  yield* patchProgram(gameDir, wine, server, config);
  await mkdirp(resolve("./logs"));
  const yaaglDir = resolve("./");

  // Enable pf block-all-net before launching the game
  if (config.blockAllNet) {
    const pfOk = await enableAllNetBlockAutoRelease(gameExecutable);
    if (!pfOk) {
      yield ["setStateText", "REVERT_PATCHING"];
      await removeFile(resolve("config.bat"));
      yield* patchRevertProgram(gameDir, wine, server, config);
      return;
    }
    await setKey(BLOCK_ALL_NET_MARKER_KEY, "1");
  }

  try {
    yield ["setStateText", "GAME_RUNNING"];
    const logfile = resolve(`./logs/game_${Date.now()}.log`);

    if (config.blockNet) {
      const tmpScriptPath = "/tmp/yaagl_network_block_script.sh";
      const blockUrl = server.id == "hk4e_global" ? OS_BLOCK_URL : CN_BLOCK_URL;

      const commands = [
        `#!/bin/sh`,

        `HOSTS_FILE="/etc/hosts"`,
        `ENTRY="0.0.0.0 ${blockUrl}"`,
        `PAD_START="# Temporarily Added by Yaagl"`,
        `PAD_END="# End of section"`,

        `if ! grep -qF "$ENTRY" "$HOSTS_FILE"; then`,
        `sudo bash -c "echo -e '$PAD_START\n$ENTRY\n$PAD_END' >> '/etc/hosts'"`,
        `fi`,
        `sleep 10`,
        `sudo sed -i.bak "/$PAD_START/,/$PAD_END/d" "$HOSTS_FILE"`,

        `rm ${tmpScriptPath}`,
      ];

      await writeFile(tmpScriptPath, commands.join("\n"));
      await exec(
        [
          "osascript",
          "-e",
          `do shell script "source ${tmpScriptPath} > /dev/null 2>&1 &" with administrator privileges`,
        ],
        {},
        false
      );
    }

    await wine.exec2(
      config.steamPatch ? "C:\\windows\\system32\\steam.exe" : "cmd",
      config.steamPatch
        ? [wine.toWinePath(join(gameDir, gameExecutable))]
        : ["/c", `${wine.toWinePath(resolve("./config.bat"))} `],
      {
        MTL_HUD_ENABLED: config.metalHud ? "1" : "",
        WINEDLLOVERRIDES: "",
        WINE_ENABLE_TIMEOUT_FIX: config.timeoutFix ? "1" : "0",
        ...(wine.attributes.renderBackend == "dxmt"
          ? {
              WINEESYNC: "1",
              DXMT_LOG_PATH: yaaglDir,
              DXMT_CONFIG: "d3d11.preferredMaxFrameRate=60;",
              DXMT_CONFIG_FILE: join(yaaglDir, "dxmt.conf"),
              GST_PLUGIN_FEATURE_RANK: "atdec:MAX,avdec_h264:MAX",
            }
          : {
              WINEESYNC: "1",
            }),
        ...(config.proxyEnabled
          ? {
              HTTP_PROXY: config.proxyHost,
              HTTPS_PROXY: config.proxyHost,
            }
          : {}),
      },
      logfile
    );
    await wine.waitUntilServerOff();
    if (config.hk4eEnableHDR) {
      await revertHDRRegistry({ wine, server });
    }
    if (config.resolutionCustom) {
      await revertResolutionRegistry(wine, server);
    }
  } catch (e: unknown) {
    // it seems game crashed?
    await log(String(e));
  }

  // await removeFile(resolve("bWh5cHJvdDJfcnVubmluZy5yZWcK.reg"));
  await removeFile(resolve("config.bat"));

  // Safety cleanup: disable pf block if still active
  if (config.blockAllNet && (await isPfCleanupNeeded())) {
    await disableAllNetBlock();
    await setKey(BLOCK_ALL_NET_MARKER_KEY, null);
  }

  yield ["setStateText", "REVERT_PATCHING"];
  yield* patchRevertProgram(gameDir, wine, server, config);
}

async function revertHDRRegistry({
  wine,
  server,
}: {
  wine: Wine;
  server: Server;
}) {
  let key = "HKEY_CURRENT_USER\\Software\\\x6d\x69\x48\x6f\x59\x6f\\";
  if (server.id === "hk4e_cn") {
    key += "\u539f\u795e";
  } else if (server.id === "hk4e_global") {
    key += "\x47\x65\x6e\x73\x68\x69\x6e\x20\x49\x6d\x70\x61\x63\x74";
  } else {
    return;
  }

  const reg = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[${key}]`,
    `"WINDOWS_HDR_ON_h3132281285"=-`,
  ];

  const path = resolve("./hk4e_revert_hdr.reg");
  await writeBinary(path, utf16le(reg.join("\r\n")));
  try {
    await wine.exec("regedit", [wine.toWinePath(path)], {}, "/dev/null");
  } catch (e) {
    // ignore
  } finally {
    await removeFile(path);
  }
}

async function revertResolutionRegistry(wine: Wine, server: Server) {
  let key = "HKEY_CURRENT_USER\\Software\\\x6d\x69\x48\x6f\x59\x6f\\";
  if (server.id === "hk4e_cn") {
    key += "\u539f\u795e";
  } else if (server.id === "hk4e_global") {
    key += "\x47\x65\x6e\x73\x68\x69\x6e\x20\x49\x6d\x70\x61\x63\x74";
  } else {
    return;
  }

  const lines = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[${key}]`,
    `"Screenmanager Is Fullscreen mode_h3981298716"=-`,
    `"Screenmanager Resolution Width_h182942802"=-`,
    `"Screenmanager Resolution Height_h2627697771"=-`,
  ];

  const path = resolve("./hk4e_revert_resolution.reg");
  await writeBinary(path, utf16le(lines.join("\r\n")));
  try {
    await wine.exec("regedit", [wine.toWinePath(path)], {}, "/dev/null");
  } catch (e) {
    // ignore
  } finally {
    await removeFile(path);
  }
}

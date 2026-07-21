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
} from "../../../utils";
import { Wine } from "../../../wine";
import { Config } from "@config";
import {
  putLocal,
  patchProgram,
  patchRevertProgram,
  applyMhypBaseReplacement,
  revertMhypBaseReplacement,
} from "../patch";
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
  // Workaround #4: replace mhypbase.dll with user-supplied older version.
  // Runs every launch (outside the `patched` storage gate) so users can
  // change the path in Settings and have it take effect on the next launch
  // without resetting the one-time patch state.
  await applyMhypBaseReplacement(gameDir, config);
  await mkdirp(resolve("./logs"));
  const yaaglDir = resolve("./");
  try {
    yield ["setStateText", "GAME_RUNNING"];
    const logfile = resolve(`./logs/game_${Date.now()}.log`);

    if (config.blockNet) {
      const blockUrl = server.id == "hk4e_global" ? OS_BLOCK_URL : CN_BLOCK_URL;
      const helperPath = "/Users/Shared/yaagl-block-net-helper.sh";

      // Self-contained helper — no internal sudo calls: it is designed to
      // be invoked AS root (via sudo or osascript). The helper:
      //   1. Adds IPv4 + IPv6 hosts entries
      //   2. Sleeps for the configured duration
      //   3. Removes the entries
      //   4. Deletes itself
      const commands = [
        `#!/bin/sh`,
        `HOSTS_FILE="/etc/hosts"`,
        `ENTRY4="0.0.0.0 ${blockUrl}"`,
        `ENTRY6="::1 ${blockUrl}"`,
        `PAD_START="# Temporarily Added by Yaagl"`,
        `PAD_END="# End of section"`,
        ``,
        `if ! grep -qF "$ENTRY4" "$HOSTS_FILE"; then`,
        `  printf '%s\\n' "$PAD_START" "$ENTRY4" "$ENTRY6" "$PAD_END" >> "$HOSTS_FILE"`,
        `fi`,
        `sleep ${config.blockNetDuration}`,
        `sed -i.bak "/$PAD_START/,/$PAD_END/d" "$HOSTS_FILE"`,
        `rm -f "$0"`,
      ];

      await writeFile(helperPath, commands.join("\n"));

      // Tier 1: try passwordless sudo (requires one-time NOPASSWD setup).
      // `sudo -n` = non-interactive → fails immediately if no NOPASSWD.
      let ran = false;
      try {
        await exec(["bash", "-c", `sudo -n sh '${helperPath}' &`], {}, false);
        ran = true;
      } catch {
        // sudo -n failed — fall back to osascript
      }

      // Tier 2: osascript GUI password dialog (always works, no setup).
      if (!ran) {
        try {
          await exec(
            [
              "osascript",
              "-e",
              `do shell script "sh '${helperPath}' > /dev/null 2>&1 &" with administrator privileges`,
            ],
            {},
            false
          );
        } catch {
          // User cancelled the dialog — no blocking this launch
        }
      }
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

import { join } from "path-browserify";
import {
  CommonProgressUICommand,
  CommonUpdateProgram,
} from "../../../common-update-ui";
import { Server } from "../../../constants";
import {
  mkdirp,
  removeFile,
  writeFile,
  resolve,
  log,
  utf16le,
  writeBinary,
} from "../../../utils";
import { Wine } from "../../../wine";
import { Config } from "@config";
import { normalizeHttpProxy } from "@config/proxy";
import {
  putLocal,
  patchProgram,
  patchRevertProgram,
  applyMhypBaseReplacement,
  revertMhypBaseReplacement,
} from "../patch";
import { CN_BLOCK_URL, OS_BLOCK_URL } from "../../secret";
import {
  blockPrivilegedHosts,
  legacyBlockHosts,
} from "../../../privileged-hosts";
import hk4eHDRGlobalReg from "../../../constants/hk4e_hdr_os.reg?raw";
import hk4eHDRCnReg from "../../../constants/hk4e_hdr_cn.reg?raw";
import { gt } from "semver";

const HDR_REGISTRY_FILES = {
  hk4e_global: hk4eHDRGlobalReg,
  hk4e_cn: hk4eHDRCnReg,
} as const;

function* launchStep(
  progress: number,
  message: string
): Generator<CommonProgressUICommand> {
  yield ["setProgress", progress];
  yield ["setRawStateText", message];
}

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

async function applyDisplayModeRegistry(
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

  const lines = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[${key}]`,
    `"Screenmanager Is Fullscreen mode_h3981298716"=dword:${
      config.resolutionCustom ? "00000000" : "00000001"
    }`,
  ];

  if (config.resolutionCustom) {
    const width = Number(config.resolutionWidth);
    const height = Number(config.resolutionHeight);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      return;
    }
    lines.push(
      `"Screenmanager Resolution Width_h182942802"=dword:${width
        .toString(16)
        .padStart(8, "0")}`,
      `"Screenmanager Resolution Height_h2627697771"=dword:${height
        .toString(16)
        .padStart(8, "0")}`
    );
  } else {
    lines.push(
      `"Screenmanager Resolution Width_h182942802"=-`,
      `"Screenmanager Resolution Height_h2627697771"=-`
    );
  }

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

  yield* launchStep(3, "启动准备：写入 Wine 显示与键盘配置");
  await wine.setProps(config);
  if (config.hk4eEnableHDR) {
    yield* launchStep(8, "启动准备：写入 HDR 注册表配置");
    await applyHDRRegistry({ wine, server });
  } else {
    yield* launchStep(8, "启动准备：跳过 HDR 注册表配置");
  }

  yield* launchStep(12, "启动准备：写入分辨率/全屏注册表配置");
  await applyDisplayModeRegistry(wine, server, config);
  yield* launchStep(16, "启动准备：等待 Wine 配置进程退出");
  await wine.waitUntilServerOff();

  yield* launchStep(20, "启动准备：生成游戏启动脚本 config.bat");
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
  yield* patchProgram(gameDir, wine, server, config, { start: 22, end: 62 });
  // Workaround #4 is intentionally temporary: install the user-provided
  // mhypbase.dll only for this launch, then restore the original afterward.
  yield* launchStep(64, "启动准备：检查并应用 mhypbase.dll 临时替换");
  const mhypBaseReplaced = await applyMhypBaseReplacement(gameDir, config);
  yield* launchStep(68, "启动准备：创建游戏日志目录");
  await mkdirp(resolve("./logs"));
  const yaaglDir = resolve("./");
  try {
    yield* launchStep(72, "启动准备：准备游戏日志文件");
    const logfile = resolve(`./logs/game_${Date.now()}.log`);

    if (config.blockNet) {
      yield* launchStep(76, "启动准备：临时屏蔽游戏联网检测域名");
      const blockUrl = server.id == "hk4e_global" ? OS_BLOCK_URL : CN_BLOCK_URL;
      const hosts: [string, string][] = [
        [blockUrl, "0.0.0.0"],
        [blockUrl, "::1"],
      ];
      await blockPrivilegedHosts(hosts, config.blockNetDuration, () =>
        legacyBlockHosts(hosts, config.blockNetDuration)
      );
    } else {
      yield* launchStep(76, "启动准备：跳过联网检测域名屏蔽");
    }

    yield* launchStep(
      82,
      `启动游戏：通过 ${
        config.steamPatch ? "Steam 补丁入口" : "cmd 启动脚本"
      } 拉起 ${gameExecutable}`
    );
    yield ["setStateText", "GAME_RUNNING"];
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
              HTTP_PROXY: normalizeHttpProxy(config.proxyHost),
              HTTPS_PROXY: normalizeHttpProxy(config.proxyHost),
            }
          : {}),
      },
      logfile
    );
    yield* launchStep(90, "游戏进程已退出：等待 Wine 服务关闭");
    await wine.waitUntilServerOff();
    if (config.hk4eEnableHDR) {
      yield* launchStep(92, "启动清理：还原 HDR 注册表配置");
      await revertHDRRegistry({ wine, server });
    }
  } catch (e: unknown) {
    // it seems game crashed?
    await log(String(e));
    yield* launchStep(90, `游戏启动进程返回异常：${String(e)}`);
  }

  // await removeFile(resolve("bWh5cHJvdDJfcnVubmluZy5yZWcK.reg"));
  yield* launchStep(93, "启动清理：还原分辨率/全屏注册表配置");
  await revertResolutionRegistry(wine, server);
  if (mhypBaseReplaced) {
    yield* launchStep(95, "启动清理：还原 mhypbase.dll");
    await revertMhypBaseReplacement(gameDir);
  } else {
    yield* launchStep(95, "启动清理：无需还原 mhypbase.dll");
  }
  yield* launchStep(97, "启动清理：删除临时启动脚本 config.bat");
  await removeFile(resolve("config.bat"));
  yield ["setStateText", "REVERT_PATCHING"];
  yield ["setProgress", 98];
  yield* patchRevertProgram(gameDir, wine, server, config);
  yield* launchStep(100, "启动清理：补丁还原完成");
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

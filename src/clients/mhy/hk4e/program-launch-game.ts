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
  yield* launchStep(2, "启动阶段：开始准备运行环境");

  yield* launchStep(5, "启动阶段：应用 Wine 启动参数");
  await wine.setProps(config);
  if (config.hk4eEnableHDR) {
    yield* launchStep(8, "启动阶段：写入 HDR 注册表配置");
    await applyHDRRegistry({ wine, server });
  }

  yield* launchStep(10, "启动阶段：写入显示模式注册表配置");
  await applyDisplayModeRegistry(wine, server, config);
  yield* launchStep(14, "启动阶段：等待 Wine 服务空闲");
  await wine.waitUntilServerOff();

  yield* launchStep(18, "启动阶段：生成游戏启动脚本");
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
  yield* launchStep(22, "启动阶段：正在应用补丁");
  yield* patchProgram(gameDir, wine, server, config, { start: 22, end: 62 });
  // Workaround #4 is intentionally temporary: install the user-provided
  // mhypbase.dll only for this launch, then restore the original afterward.
  yield* launchStep(64, "启动阶段：检查 mhypbase.dll 临时替换");
  const mhypBaseReplaced = await applyMhypBaseReplacement(gameDir, config);
  yield* launchStep(67, "启动阶段：准备游戏日志目录");
  await mkdirp(resolve("./logs"));
  const yaaglDir = resolve("./");
  try {
    yield* launchStep(72, "启动阶段：准备启动游戏进程");
    const logfile = resolve(`./logs/game_${Date.now()}.log`);

    if (config.blockNet) {
      yield* launchStep(76, "启动阶段：应用断网启动 hosts 规则");
      const blockUrl = server.id == "hk4e_global" ? OS_BLOCK_URL : CN_BLOCK_URL;
      const hosts: [string, string][] = [
        [blockUrl, "0.0.0.0"],
        [blockUrl, "::1"],
      ];
      await blockPrivilegedHosts(hosts, config.blockNetDuration, () =>
        legacyBlockHosts(hosts, config.blockNetDuration)
      );
    }

    yield* launchStep(82, "启动阶段：启动游戏进程");
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
    yield* launchStep(88, "启动阶段：等待游戏 Wine 服务退出");
    await wine.waitUntilServerOff();
    if (config.hk4eEnableHDR) {
      yield* launchStep(90, "启动阶段：还原 HDR 注册表配置");
      await revertHDRRegistry({ wine, server });
    }
  } catch (e: unknown) {
    // it seems game crashed?
    await log(String(e));
  }

  // await removeFile(resolve("bWh5cHJvdDJfcnVubmluZy5yZWcK.reg"));
  yield* launchStep(92, "启动阶段：还原显示模式注册表配置");
  await revertResolutionRegistry(wine, server);
  if (mhypBaseReplaced) {
    yield* launchStep(94, "启动阶段：还原 mhypbase.dll");
    await revertMhypBaseReplacement(gameDir);
  }
  yield* launchStep(96, "启动阶段：删除临时启动脚本");
  await removeFile(resolve("config.bat"));
  yield* launchStep(97, "启动阶段：正在还原补丁");
  yield* patchRevertProgram(gameDir, wine, server, config);
  yield* launchStep(100, "启动阶段：游戏启动流程完成");
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

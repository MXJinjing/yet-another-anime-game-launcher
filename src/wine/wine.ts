import {
  exec as unixExec,
  exec2 as unixExec2,
  getKey,
  log,
  setKey,
  arrayFind,
  getCPUInfo,
  build,
  generateRandomString,
  stats,
  resolve,
  writeFile,
} from "@utils";
import { dirname, join } from "path-browserify";
import { WineDistribution } from "./distro";

export async function createWine(options: {
  prefix: string;
  distro: WineDistribution;
}) {
  const loaderBin = await getCorrectWineBinary();

  async function cmd(command: string, args: string[]) {
    return await exec("cmd", [command, ...args]);
  }

  async function exec(
    program: string,
    args: string[],
    env?: { [key: string]: string },
    log_file: string | undefined = undefined
  ) {
    return await unixExec(
      program == "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      {
        ...getEnvironmentVariables(),
        ...(env ?? {}),
      },
      false,
      log_file
    );
  }

  async function exec2(
    program: string,
    args: string[],
    env?: { [key: string]: string },
    log_file: string | undefined = undefined
  ) {
    return await unixExec2(
      program == "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      {
        ...getEnvironmentVariables(),
        ...(env ?? {}),
      },
      false,
      log_file
    );
  }

  async function waitUntilServerOff() {
    return await unixExec2([join(dirname(loaderBin), "wineserver"), "-w"], {
      ...getEnvironmentVariables(),
    });
  }

  // Kill every wine process attached to this prefix. This is invoked on
  // launcher close to guarantee no leftover services.exe / winedevice.exe /
  // rpcss.exe processes outlive the launcher — otherwise the next launch
  // hangs at 'PATCHING' because wineserver refuses to enter the prefix
  // while these ghosts are still attached.
  //
  // Implementation notes:
  //  - `wineserver -k` sends SIGKILL to every wine process in the prefix;
  //    this is the canonical way to tear down a wine tree cleanly. We add
  //    `|| true` so the call never throws on the cleanup path.
  //  - The preceding `wineserver -w` (with a 0-timeout-ish pragma) is not
  //    required; `wineserver -k` is itself synchronous enough for our purpose.
  //  - We deliberately do NOT pkill by name (`services.exe`, `winedevice.exe`)
  //    because other wine applications on the host (e.g. Parallels,
  //    com.tencent.yybmac) would be caught by such a broad pattern.
  //    Scoping by WINEPREFIX is the safe way.
  async function killAll() {
    const wineserver = join(dirname(loaderBin), "wineserver");
    try {
      await unixExec(
        [wineserver, "-k", "-9"],
        { ...getEnvironmentVariables() },
        false,
        "/dev/null"
      );
    } catch {
      // ignore — best-effort cleanup; wineserver may be gone already
    }
  }

  function toWinePath(absPath: string) {
    return "Z:" + `${absPath}`.replaceAll("/", "\\");
  }

  function getEnvironmentVariables() {
    return {
      WINEDEBUG: "fixme-all,err-unwind,+timestamp",
      WINEPREFIX: options.prefix,
    };
  }

  async function openCmdWindow({ gameDir }: { gameDir: string }) {
    return await unixExec2(
      [
        `osascript`,
        "-e",
        [
          "tell",
          "app",
          '"Terminal"',
          "to",
          "do",
          "script",
          `"${build([loaderBin, "cmd"], {
            ...getEnvironmentVariables(),
            WINEPATH: toWinePath(gameDir),
          })
            .replaceAll("\\", "\\\\")
            .replaceAll('"', '\\"')}"`,
        ].join(" "),
        "-e",
        ["tell", "app", '"Terminal"', "to", "activate"].join(" "),
      ],
      {},
      false,
      "/dev/null"
    );
  }

  let netbiosname: string;
  try {
    netbiosname = await getKey("wine_netbiosname");
  } catch {
    netbiosname = `DESKTOP-${generateRandomString(7)}`; // exactly 15 chars
    await setKey("wine_netbiosname", netbiosname);
  }

  async function setProps(props: { retina: boolean; leftCmd: boolean }) {
    const cmd = `@echo off
cd "%~dp0"
reg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v RetinaMode /t REG_SZ /d ${
      props.retina ? "y" : "n"
    } /f
reg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v LeftCommandIsCtrl /t REG_SZ /d ${
      props.leftCmd ? "y" : "n"
    } /f
`;
    await writeFile(resolve("winedrv_config.bat"), cmd);
    await exec(
      "cmd",
      ["/c", `${toWinePath(resolve("./winedrv_config.bat"))}`],
      {},
      "/dev/null"
    );
    await waitUntilServerOff();
  }

  async function setNVExtension() {
    const cmd = `@echo off
cd "%~dp0"
reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f
reg add "HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Services\\nvlddmkm" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f
reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global\\NGXCore" /v FullPath /t REG_SZ /d "C:\\Windows\\System32" /f
`;
    await writeFile(resolve("winedrv_config.bat"), cmd);
    await exec(
      "cmd",
      ["/c", `${toWinePath(resolve("./winedrv_config.bat"))}`],
      {},
      "/dev/null"
    );
    await waitUntilServerOff();
  }

  return {
    exec,
    exec2,
    waitUntilServerOff,
    killAll,
    cmd,
    toWinePath,
    prefix: options.prefix,
    openCmdWindow,
    setProps,
    setNVExtension,
    attributes: {
      ...options.distro.attributes,
    },
  };
}

export async function getCorrectWineBinary() {
  try {
    // use wine64 if it is presented
    // in newer version of wine (esp. WoW64 mode), only one binary `bin/wine` exists
    await stats("./wine/bin/wine64");
    return resolve("./wine/bin/wine64");
  } catch {
    return resolve("./wine/bin/wine");
  }
}

export type Wine = ReturnType<typeof createWine> extends Promise<infer T>
  ? T
  : never;

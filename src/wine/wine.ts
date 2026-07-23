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
  fileOrDirExists,
  removeFileIfExists,
  rmrf_dangerously,
} from "@utils";
import { dirname, join } from "path-browserify";
import type { WineDistribution, WineDistributionAttributes } from "./distro";

export function getWineInstallDir(distroId: string) {
  return resolve(`./wines/${distroId}`);
}

export function getActiveWineDir(distroId: string) {
  return getWineInstallDir(distroId);
}

export async function isWineDistroInstalled(distroId: string) {
  return (
    (await fileOrDirExists(join(getWineInstallDir(distroId), "bin", "wine"))) ||
    (await fileOrDirExists(join(getWineInstallDir(distroId), "bin", "wine64")))
  );
}

export async function uninstallWineDistro(distroId: string) {
  let activeDistroId: string | undefined;
  try {
    activeDistroId = await getKey("wine_tag");
  } catch {
    activeDistroId = undefined;
  }
  if (activeDistroId == distroId) {
    throw new Error(`Cannot uninstall active Wine distribution: ${distroId}`);
  }

  const wineBinaryDir = getWineInstallDir(distroId);
  await rmrf_dangerously(wineBinaryDir);
  await rmrf_dangerously(`${wineBinaryDir}.installing`);
  for (const ext of ["xz", "gz"]) {
    await removeFileIfExists(`./wine-${distroId}.tar.${ext}`);
    await removeFileIfExists(`./wine-${distroId}.tar.${ext}.aria2`);
  }
}

export async function ensureActiveWineCompatLink(distroId: string) {
  const activeWineDir = getActiveWineDir(distroId);
  await unixExec(["mkdir", "-p", resolve("./wines")]);
  await unixExec(["rm", "-rf", resolve("./wine")]);
  await unixExec(["ln", "-s", activeWineDir, resolve("./wine")]);
}

export async function createWine(options: {
  prefix: string;
  distro: WineDistribution;
}) {
  let loaderBin = await getCorrectWineBinary(options.distro.id);

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

  async function waitUntilServerOff(timeoutMs = 15_000) {
    const waitPromise = unixExec2(
      [join(dirname(loaderBin), "wineserver"), "-w"],
      {
        ...getEnvironmentVariables(),
      }
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        waitPromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error(`wineserver -w timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
        }),
      ]);
    } catch (e) {
      await log(String(e));
      await log(
        "wineserver wait timed out; asking before killing stale wine processes"
      );
      waitPromise.catch(() => undefined);
      const staleProcesses = await listStaleWineProcesses();
      const confirmed = await confirmKillStaleWineProcesses(staleProcesses);
      if (!confirmed) {
        await log("User declined to kill stale wine processes");
        throw new Error("User declined to kill stale wine processes");
      }
      await log("User confirmed killing stale wine processes");
      await killAll();
      return await unixExec2([join(dirname(loaderBin), "wineserver"), "-w"], {
        ...getEnvironmentVariables(),
      });
    } finally {
      if (timeout != undefined) {
        clearTimeout(timeout);
      }
    }
  }

  type StaleWineProcess = {
    pid: string;
    name: string;
    command: string;
  };

  function processName(command: string) {
    const executable = command.trim().split(/\s+/)[0] ?? "";
    return executable.split("/").pop() || executable || "unknown";
  }

  function summarizeCommand(command: string) {
    return command.length > 180 ? `${command.slice(0, 177)}...` : command;
  }

  async function listStaleWineProcesses(): Promise<StaleWineProcess[]> {
    try {
      const ret = await unixExec(["ps", "-axo", "pid=,command="]);
      const wineBinDir = dirname(loaderBin);
      const candidates = ret.stdOut
        .split("\n")
        .map(line => {
          const match = line.match(/^\s*(\d+)\s+(.+)$/);
          if (!match) return null;
          const [, pid, command] = match;
          return {
            pid,
            name: processName(command),
            command,
          };
        })
        .filter((process): process is StaleWineProcess => {
          if (!process) return false;
          const command = process.command.toLowerCase();
          return (
            process.command.includes(options.prefix) ||
            process.command.includes(wineBinDir) ||
            command.includes("wine") ||
            command.includes("wineserver")
          );
        });

      return candidates;
    } catch (e) {
      await log(`Failed to list stale wine processes: ${String(e)}`);
      return [];
    }
  }

  async function confirmKillStaleWineProcesses(
    processes: StaleWineProcess[]
  ): Promise<boolean> {
    const processList =
      processes.length > 0
        ? processes
            .map(
              process =>
                `PID ${process.pid} - ${process.name}\n${summarizeCommand(
                  process.command
                )}`
            )
            .join("\n\n")
        : "未能找到明确的 Wine 相关进程，但当前 Wine prefix 仍在等待退出。";

    const out = await Neutralino.os.showMessageBox(
      "Wine 进程未退出",
      [
        `启动器等待 Wine 退出已超过 15 秒。`,
        `继续启动前需要结束当前 Wine prefix 下的残留进程。`,
        ``,
        `将处理的进程候选：`,
        processList,
        ``,
        `是否继续并结束这些 Wine 进程？`,
      ].join("\n"),
      "YES_NO",
      "WARNING"
    );

    return out == "YES";
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

  const attributes: Partial<WineDistributionAttributes> = {
    ...options.distro.attributes,
  };

  async function setDistribution(distro: WineDistribution) {
    for (const key of Object.keys(attributes) as Array<
      keyof WineDistributionAttributes
    >) {
      delete attributes[key];
    }
    Object.assign(attributes, distro.attributes);
    await ensureActiveWineCompatLink(distro.id);
    loaderBin = await getCorrectWineBinary(distro.id);
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
    setDistribution,
    attributes,
  };
}

export async function getCorrectWineBinary(distroId?: string) {
  const wineDir = distroId ? getWineInstallDir(distroId) : resolve("./wine");
  try {
    // use wine64 if it is presented
    // in newer version of wine (esp. WoW64 mode), only one binary `bin/wine` exists
    await stats(join(wineDir, "bin", "wine64"));
    return join(wineDir, "bin", "wine64");
  } catch {
    return join(wineDir, "bin", "wine");
  }
}

export type Wine = ReturnType<typeof createWine> extends Promise<infer T>
  ? T
  : never;

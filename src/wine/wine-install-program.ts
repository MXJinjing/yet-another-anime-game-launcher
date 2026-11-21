import { Aria2 } from "@aria2";
import { TaskFailedError, type TaskProgram } from "@tasks/task-program";
import {
  fileOrDirExists,
  removeFile,
  removeFileIfExists,
  resolve,
} from "@platform/neutralino";
import { tar_extract, tar_extract_directory } from "@runtime/archive";
import { generateRandomString } from "@runtime/binary";
import { exec } from "@runtime/command-runner";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";
import { rmrf_dangerously, xattrRemove } from "@runtime/macos-filesystem";
import { setKey } from "@runtime/storage";
import { isAuthorizationCancelledError } from "@runtime/authorization";
import {
  DownloadFailedError,
  isDownloadCancelledError,
} from "../download/control";
import { ENSURE_HOSTS } from "../system/ensure-hosts";
import { ensureHosts } from "../system/hosts";
import { getAuthorizationPrompt } from "../locale/authorization";
import {
  createWine,
  ensureActiveWineCompatLink,
  getWineInstallDir,
  isWineDistroInstalled,
  type Wine,
} from "./wine";
import { installMediaFoundation } from "./mf";
import { WineDistribution } from "./distro";
import {
  assertD3DMetalHostSupported,
  D3DMETAL_RUNTIME_ID,
  isD3DMetalRuntimePrepared,
  prepareD3DMetalWine,
  requireD3DMetalLicense,
  verifyD3DMetalArchive,
} from "./d3dmetal";
import { addCertsToWine } from "./cert";
import {
  createWinePrefixInitializationLog,
  PrefixInitializationFailedError,
} from "./prefix-initialization-log";

/**
 * Returns the install task. Rendering it is the composition layer's concern.
 */
export function createWineInstallProgram({
  aria2,
  wineAbsPrefix,
  wineDistro,
}: {
  aria2: Aria2;
  wineAbsPrefix: string;
  wineDistro: WineDistribution;
}): TaskProgram {
  return installWineEnvironmentProgram({
    aria2,
    wineAbsPrefix,
    wineDistro,
    activate: true,
  });
}

type WineInstallOptions = {
  aria2: Aria2;
  wineAbsPrefix: string;
  wineDistro: WineDistribution;
  activate?: boolean;
  finishMessage?: boolean;
  downloadKey?: string;
  /** Ask before an existing, populated prefix is deleted and retried. */
  confirmPrefixReset?: (prefix: string) => Promise<boolean>;
  /** Deletes a prefix the user agreed to reset. */
  removePrefix?: (path: string) => Promise<unknown>;
};

export type WinePrefixResetConfirmation = (prefix: string) => Promise<boolean>;

/** Default reset prompt; the launcher owns the window it is shown in. */
export const confirmWinePrefixReset: WinePrefixResetConfirmation =
  async prefix => {
    const out = await Neutralino.os.showMessageBox(
      "Wine 环境初始化失败",
      [
        "当前 Wine prefix 已包含数据，自动删除会丢失其中的游戏与系统设置。",
        `Prefix: ${prefix}`,
        ``,
        "是否重置该 prefix 并重试？",
        "选择“否”将取消本次任务，现有数据会保留。",
      ].join("\n"),
      "YES_NO",
      "WARNING"
    );
    return out == "YES";
  };

let d3dMetalInstallationActive = false;

export async function* installWineEnvironmentProgram(
  options: WineInstallOptions
): TaskProgram {
  if (options.wineDistro.id !== D3DMETAL_RUNTIME_ID) {
    yield* installWineBinariesAndConfigure(options);
    return;
  }
  // A launcher-global task can pause per-game downloads. Reject overlapping
  // requests instead of waiting on a transfer the scheduler has paused.
  if (d3dMetalInstallationActive) {
    throw new TaskFailedError(
      "D3DMetal Wine installation is already in progress"
    );
  }
  d3dMetalInstallationActive = true;
  try {
    yield* installWineBinariesAndConfigure(options);
  } finally {
    d3dMetalInstallationActive = false;
  }
}

async function* installWineBinariesAndConfigure({
  aria2,
  wineAbsPrefix,
  wineDistro,
  activate = true,
  finishMessage = true,
  downloadKey,
  confirmPrefixReset,
  removePrefix,
}: WineInstallOptions): TaskProgram {
  const wineBinaryDir = getWineInstallDir(wineDistro.id);
  const isD3DMetal = wineDistro.id === D3DMETAL_RUNTIME_ID;
  const wineBinaryTmpDir = `${wineBinaryDir}.installing`;
  const installedBefore = await isWineDistroInstalled(wineDistro.id);

  // System-supplied Wine is never downloaded, extracted, patched, or
  // quarantine-modified by the launcher. Configuration below only updates
  // the launcher-owned Wine prefix.
  if (wineDistro.systemWineRoot) {
    if (!installedBefore) {
      // The user's system Wine vanished between discovery and use. Selecting
      // another installed distribution is the launcher settings flow's job;
      // fail only this task so the launcher stays usable.
      throw new TaskFailedError(
        `System Wine is no longer available: ${wineDistro.displayName}. Select another installed Wine distribution and retry.`
      );
    }
    if (!activate) {
      if (finishMessage) yield ["setStateText", "INSTALL_DONE"];
      return;
    }
    yield* configureWineEnvironmentProgram({
      aria2,
      wineAbsPrefix,
      wineDistro,
      confirmPrefixReset,
      removePrefix,
    });
    return;
  }

  if (!installedBefore) {
    if (isD3DMetal) {
      await assertD3DMetalHostSupported();
      await requireD3DMetalLicense();
    }
    yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
    const isXZ = wineDistro.remoteUrl.endsWith(".xz");
    const wineTarPath = resolve(
      `./wine-${wineDistro.id}.tar.${isXZ ? "xz" : "gz"}`
    );
    try {
      for await (const progress of aria2.doStreamingDownload({
        uri: wineDistro.remoteUrl,
        absDst: wineTarPath,
        ...(wineDistro.checksum ? { checksum: wineDistro.checksum } : {}),
        downloadKey,
      })) {
        yield [
          "setProgress",
          Number(
            (progress.completedLength * BigInt(100)) / progress.totalLength
          ),
        ];
        yield [
          "setStateText",
          "DOWNLOADING_ENVIRONMENT_SPEED",
          formatDownloadSpeed(Number(progress.downloadSpeed)),
          `${humanFileSize(Number(progress.completedLength))}`,
          `${humanFileSize(Number(progress.totalLength))}`,
          downloadPercent(progress.completedLength, progress.totalLength),
        ];
      }
    } catch (error) {
      if (isDownloadCancelledError(error)) {
        // Restore the original Wine environment: drop the partial download
        // and any half-extracted directory so a retry starts clean.
        await removeFileIfExists(wineTarPath);
        await rmrf_dangerously(wineBinaryTmpDir);
      }
      throw error;
    }
    // aria2 can reuse completed results without rechecking the file on disk.
    if (isD3DMetal) {
      try {
        await verifyD3DMetalArchive(wineTarPath);
      } catch (error) {
        await removeFileIfExists(wineTarPath);
        throw new DownloadFailedError(String(error));
      }
    } else if (wineDistro.checksum) {
      const { stdOut } = await exec([
        "/usr/bin/shasum",
        "-a",
        "256",
        wineTarPath,
      ]);
      const actualChecksum = stdOut.trim().split(/\s+/, 1)[0];
      if (`sha-256=${actualChecksum}` !== wineDistro.checksum) {
        await removeFileIfExists(wineTarPath);
        throw new DownloadFailedError(
          `Wine archive checksum mismatch: ${wineDistro.displayName}`
        );
      }
    }
    yield ["setStateText", "EXTRACT_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    await rmrf_dangerously(wineBinaryTmpDir);
    await exec(["mkdir", "-p", wineBinaryTmpDir]);
    try {
      if (wineDistro.attributes.winePath) {
        await tar_extract_directory(
          wineTarPath,
          wineBinaryTmpDir,
          wineDistro.attributes.winePath,
          isXZ
        );
      } else {
        await tar_extract(wineTarPath, wineBinaryTmpDir);
      }
      yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
      yield ["setUndeterminedProgress"];
      if (isD3DMetal) {
        await prepareD3DMetalWine(wineBinaryTmpDir);
        if (!(await isD3DMetalRuntimePrepared(wineBinaryTmpDir))) {
          throw new TaskFailedError("D3DMetal Wine preparation is incomplete");
        }
      }
      await prepareWineBinaries(wineBinaryTmpDir);
    } catch (error) {
      if (!isD3DMetal) throw error;
      await rmrf_dangerously(wineBinaryTmpDir);
      if (
        error instanceof TaskFailedError ||
        isAuthorizationCancelledError(error)
      )
        throw error;
      throw new TaskFailedError(String(error));
    }
    await removeFile(wineTarPath);
    await rmrf_dangerously(wineBinaryDir);
    await exec(["mv", wineBinaryTmpDir, wineBinaryDir]);
  }

  if (!isD3DMetal && installedBefore && activate) {
    yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    await prepareWineBinaries(wineBinaryDir);
  }

  if (!activate) {
    if (finishMessage) {
      yield ["setStateText", "INSTALL_DONE"];
    }
    return;
  }

  yield* configureWineEnvironmentProgram({
    aria2,
    wineAbsPrefix,
    wineDistro,
    confirmPrefixReset,
    removePrefix,
  });
}

async function prepareWineBinaries(directory: string) {
  await addCertsToWine(directory);
  await xattrRemove(
    "com.apple.quarantine",
    directory,
    await getAuthorizationPrompt("AUTHORIZATION_PROMPT_REMOVE_QUARANTINE")
  );
}

/** True when the prefix exists and already holds files. */
async function prefixHasData(prefix: string) {
  if (!(await fileOrDirExists(prefix))) return false;
  try {
    const { stdOut } = await exec(["ls", "-A", prefix]);
    return stdOut.trim().length > 0;
  } catch {
    // Unknown contents: treat the prefix as user data and never delete it
    // without asking.
    return true;
  }
}

async function runWinePrefixInitialization(wine: Wine) {
  const runStep = await createWinePrefixInitializationLog();
  try {
    await runStep("wineboot", logFile =>
      wine.exec("wineboot", ["-u"], {}, logFile)
    );
    await runStep("winecfg", logFile =>
      wine.exec("winecfg", ["-v", "win10"], {}, logFile)
    );
  } catch (error) {
    throw new PrefixInitializationFailedError(
      runStep.directory,
      runStep.logFiles,
      error
    );
  }
}

/**
 * Initialize the prefix, recovering once. A fresh (missing or empty) prefix
 * only contains this attempt's half-built files, so it is safe to delete and
 * retry. An existing populated prefix is user data: delete it only after an
 * explicit confirmation, and otherwise fail the task with the Wine logs.
 */
async function initializeWinePrefix({
  wine,
  wineAbsPrefix,
  confirmPrefixReset,
  removePrefix,
}: {
  wine: Wine;
  wineAbsPrefix: string;
  confirmPrefixReset: WinePrefixResetConfirmation;
  removePrefix: (path: string) => Promise<unknown>;
}) {
  const populated = await prefixHasData(wineAbsPrefix);
  try {
    await runWinePrefixInitialization(wine);
    return;
  } catch (error) {
    if (populated) {
      // Keep the user's data unless they explicitly choose to reset it.
      if (!(await confirmPrefixReset(wineAbsPrefix))) throw error;
    }
    await removePrefix(wineAbsPrefix);
  }
  await runWinePrefixInitialization(wine);
}

export async function* configureWineEnvironmentProgram({
  aria2,
  wineAbsPrefix,
  wineDistro,
  beforeActivate,
  confirmPrefixReset = confirmWinePrefixReset,
  removePrefix = rmrf_dangerously,
}: {
  aria2: Aria2;
  wineAbsPrefix: string;
  wineDistro: WineDistribution;
  beforeActivate?: () => Promise<void>;
  confirmPrefixReset?: WinePrefixResetConfirmation;
  removePrefix?: (path: string) => Promise<unknown>;
}): TaskProgram {
  yield ["setUndeterminedProgress"];
  await ensureHosts(ENSURE_HOSTS);

  const wine = await createWine({
    prefix: wineAbsPrefix,
    distro: wineDistro,
  });
  await initializeWinePrefix({
    wine,
    wineAbsPrefix,
    confirmPrefixReset,
    removePrefix,
  });

  if (
    String(import.meta.env["YAAGL_CHANNEL_CLIENT"]).startsWith("bh3") ||
    String(import.meta.env["YAAGL_CHANNEL_CLIENT"]).startsWith("cbjq")
  ) {
    yield* installMediaFoundation(aria2, wine);
  }

  await beforeActivate?.();
  await ensureActiveWineCompatLink(wineDistro.id);
  await setKey("wine_tag", wineDistro.id);
  await setKey("wine_update_url", null);
  await setKey("wine_update_tag", null);
  const netbiosname = `DESKTOP-${generateRandomString(7)}`; // exactly 15 chars
  await setKey("wine_netbiosname", netbiosname);
  await setKey("wine_state", "ready");
  yield ["setStateText", "INSTALL_DONE"];
}

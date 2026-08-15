import { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { removeFile, removeFileIfExists, resolve } from "@platform/neutralino";
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
import { isDownloadCancelledError } from "../download/control";
import { ENSURE_HOSTS } from "../clients/secret";
import { ensureHosts } from "../system/hosts";
import {
  createWine,
  ensureActiveWineCompatLink,
  getWineInstallDir,
  isWineDistroInstalled,
} from "./wine";
import { installMediaFoundation } from "./mf";
import { WineDistribution } from "./distro";
import { addCertsToWine } from "./cert";

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

export async function* installWineEnvironmentProgram({
  aria2,
  wineAbsPrefix,
  wineDistro,
  activate = true,
  finishMessage = true,
}: {
  aria2: Aria2;
  wineAbsPrefix: string;
  wineDistro: WineDistribution;
  activate?: boolean;
  finishMessage?: boolean;
}): TaskProgram {
  const wineBinaryDir = getWineInstallDir(wineDistro.id);
  const wineBinaryTmpDir = `${wineBinaryDir}.installing`;
  const installedBefore = await isWineDistroInstalled(wineDistro.id);

  if (!installedBefore) {
    yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
    const isXZ = wineDistro.remoteUrl.endsWith(".xz");
    const wineTarPath = resolve(
      `./wine-${wineDistro.id}.tar.${isXZ ? "xz" : "gz"}`
    );
    try {
      for await (const progress of aria2.doStreamingDownload({
        uri: wineDistro.remoteUrl,
        absDst: wineTarPath,
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
    yield ["setStateText", "EXTRACT_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    await rmrf_dangerously(wineBinaryTmpDir);
    await exec(["mkdir", "-p", wineBinaryTmpDir]);
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
    await removeFile(wineTarPath);
    await rmrf_dangerously(wineBinaryDir);
    await exec(["mv", wineBinaryTmpDir, wineBinaryDir]);
  }

  if (!installedBefore || activate) {
    yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    await addCertsToWine(wineBinaryDir);
    await xattrRemove("com.apple.quarantine", wineBinaryDir);
  }

  if (!activate) {
    if (finishMessage) {
      yield ["setStateText", "INSTALL_DONE"];
    }
    return;
  }

  yield* configureWineEnvironmentProgram({ aria2, wineAbsPrefix, wineDistro });
}

export async function* configureWineEnvironmentProgram({
  aria2,
  wineAbsPrefix,
  wineDistro,
}: {
  aria2: Aria2;
  wineAbsPrefix: string;
  wineDistro: WineDistribution;
}): TaskProgram {
  yield ["setUndeterminedProgress"];
  await ensureHosts(ENSURE_HOSTS);

  const wine = await createWine({
    prefix: wineAbsPrefix,
    distro: wineDistro,
  });
  await wine.exec("wineboot", ["-u"], {}, "/dev/null");
  await wine.exec("winecfg", ["-v", "win10"], {}, "/dev/null");

  if (
    String(import.meta.env["YAAGL_CHANNEL_CLIENT"]).startsWith("bh3") ||
    String(import.meta.env["YAAGL_CHANNEL_CLIENT"]).startsWith("cbjq")
  ) {
    yield* installMediaFoundation(aria2, wine);
  }

  await ensureActiveWineCompatLink(wineDistro.id);
  await setKey("wine_state", "ready");
  await setKey("wine_tag", wineDistro.id);
  await setKey("wine_update_url", null);
  await setKey("wine_update_tag", null);
  const netbiosname = `DESKTOP-${generateRandomString(7)}`; // exactly 15 chars
  await setKey("wine_netbiosname", netbiosname);
  yield ["setStateText", "INSTALL_DONE"];
}

import { Aria2 } from "@aria2";
import { CommonUpdateProgram, createCommonUpdateUI } from "@common-update-ui";
import { Locale } from "@locale";
import {
  rmrf_dangerously,
  humanFileSize,
  formatDownloadSpeed,
  downloadPercent,
  tar_extract,
  removeFile,
  xattrRemove,
  setKey,
  exec,
  generateRandomString,
  resolve,
  tar_extract_directory,
} from "@utils";
import { ENSURE_HOSTS } from "../clients/secret";
import { ensureHosts } from "../hosts";
import {
  createWine,
  ensureActiveWineCompatLink,
  getWineInstallDir,
  isWineDistroInstalled,
} from "./wine";
import { installMediaFoundation } from "./mf";
import { WineDistribution } from "./distro";
import { addCertsToWine } from "./cert";

export async function createWineInstallProgram({
  aria2,
  wineAbsPrefix,
  wineDistro,
  locale,
}: {
  aria2: Aria2;
  locale: Locale;
  wineAbsPrefix: string;
  wineDistro: WineDistribution;
}) {
  return createCommonUpdateUI(locale, () =>
    installWineEnvironmentProgram({
      aria2,
      wineAbsPrefix,
      wineDistro,
      activate: true,
    })
  );
}

export async function* installWineEnvironmentProgram({
  aria2,
  wineAbsPrefix,
  wineDistro,
  activate = true,
}: {
  aria2: Aria2;
  wineAbsPrefix: string;
  wineDistro: WineDistribution;
  activate?: boolean;
}): CommonUpdateProgram {
  const wineBinaryDir = getWineInstallDir(wineDistro.id);
  const wineBinaryTmpDir = `${wineBinaryDir}.installing`;

  if (!(await isWineDistroInstalled(wineDistro.id))) {
    yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
    const isXZ = wineDistro.remoteUrl.endsWith(".xz");
    const wineTarPath = resolve(
      `./wine-${wineDistro.id}.tar.${isXZ ? "xz" : "gz"}`
    );
    for await (const progress of aria2.doStreamingDownload({
      uri: wineDistro.remoteUrl,
      absDst: wineTarPath,
    })) {
      yield [
        "setProgress",
        Number((progress.completedLength * BigInt(100)) / progress.totalLength),
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

  if (!activate) {
    yield ["setStateText", "INSTALL_DONE"];
    return;
  }

  yield ["setStateText", "CONFIGURING_ENVIRONMENT"];

  await addCertsToWine(wineBinaryDir);
  await xattrRemove("com.apple.quarantine", wineBinaryDir);

  yield ["setStateText", "CONFIGURING_ENVIRONMENT"];

  yield ["setUndeterminedProgress"];
  await ensureHosts(ENSURE_HOSTS);

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
}): CommonUpdateProgram {
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

import { Aria2 } from "@aria2";
import { configEntries, createConfigStore } from "@config";
import {
  getGithubErrorStatus,
  Github,
  GithubReleaseInfo,
} from "../integrations/github";
import { gt } from "semver";
import { CURRENT_YAAGL_VERSION } from "../constants";
import { log } from "../logging/logger";
import { env, removeFile, resolve } from "../platform/neutralino";
import { tar_extract_directory } from "../runtime/archive";
import {
  forceMove,
  mkdirp,
  rmrf_dangerously,
} from "../runtime/macos-filesystem";
import type { TaskProgram } from "../tasks/task-program";

const owner = "MXJinjing";
const repo = "yet-another-anime-game-launcher";
export async function createUpdater({
  github,
  aria2,
  automatic = true,
}: {
  github: Github;
  aria2: Aria2;
  automatic?: boolean;
}) {
  if (automatic) {
    const autoUpdateEnabled =
      (await createConfigStore().read(configEntries.autoUpdateEnabled)) ?? true;
    if (!autoUpdateEnabled) {
      return {
        latest: true,
      } as const;
    }
  }

  if (CURRENT_YAAGL_VERSION === "development") {
    return {
      latest: true,
    } as const;
  }
  try {
    let updateVersion = "";
    if (
      import.meta.env["YAAGL_CHANNEL_CLIENT"] &&
      import.meta.env["YAAGL_CHANNEL_CLIENT"] != "hk4euniversal"
    ) {
      updateVersion = import.meta.env["YAAGL_CHANNEL_CLIENT"];
    } else if ((await env("YAAGL_OS")) == "1") {
      updateVersion = "hk4eos";
    } else {
      updateVersion = "hk4ecn";
    }
    const latest: GithubReleaseInfo = (await github.api(
      `/repos/${owner}/${repo}/releases/latest`
    )) as GithubReleaseInfo;
    const update_neu = `resources_${updateVersion}.neu`;
    const neu = latest.assets.find(x => x.name == update_neu);

    // Determine app bundle name based on updateVersion
    let appBundleName = "";
    switch (updateVersion) {
      case "hk4ecn":
        appBundleName = "Yaaglm.app.tar.gz";
        break;
      case "hk4eos":
        appBundleName = "Yaaglm.OS.app.tar.gz";
        break;
      case "bh3glb":
        appBundleName = "Yaaglm.Honkai.Global.app.tar.gz";
        break;
      case "hkrpgcn":
        appBundleName = "Yaaglm.HSR.app.tar.gz";
        break;
      case "hkrpgos":
        appBundleName = "Yaaglm.HSR.OS.app.tar.gz";
        break;
      case "napcn":
        appBundleName = "Yaaglm.ZZZ.app.tar.gz";
        break;
      case "napos":
        appBundleName = "Yaaglm.ZZZ.OS.app.tar.gz";
        break;
    }
    const sidecar = latest.assets.find(x => x.name == appBundleName);

    if (gt(latest.tag_name, CURRENT_YAAGL_VERSION) && neu !== undefined) {
      return {
        latest: false,
        downloadUrl: neu.browser_download_url,
        sidecarDownloadUrl: sidecar?.browser_download_url,
        version: latest.tag_name,
        description: latest.body,
      } as const;
    }
    return {
      latest: true,
    } as const;
  } catch (error) {
    await log(`Launcher update check failed: ${String(error)}`);
    return {
      latest: undefined,
      errorStatus: getGithubErrorStatus(error),
    } as const;
  }
}

export type Updater = ReturnType<typeof createUpdater> extends Promise<infer T>
  ? T
  : never;

export async function* downloadProgram(
  aria2: Aria2,
  url: string,
  sidecarUrl?: string
): TaskProgram {
  yield ["setStateText", "DOWNLOADING_UPDATE_FILE"];
  if (sidecarUrl) {
    for await (const progress of aria2.doStreamingDownload({
      uri: sidecarUrl,
      absDst: resolve("./sidecar.tar.gz"),
    })) {
      yield [
        "setProgress",
        Number((progress.completedLength * BigInt(50)) / progress.totalLength),
      ];
    }
    await rmrf_dangerously("./sidecar");
    await mkdirp("./sidecar");
    let topLevelDir = sidecarUrl.split("/").pop()?.replace(".tar.gz", "") || "";

    if (topLevelDir === "Yaaglm.app") topLevelDir = "Yaaglm.app";
    if (topLevelDir === "Yaaglm.OS.app") topLevelDir = "Yaaglm OS.app";
    if (topLevelDir === "Yaaglm.Honkai.Global.app")
      topLevelDir = "Yaaglm Honkai Global.app";
    if (topLevelDir === "Yaaglm.HSR.app") topLevelDir = "Yaaglm HSR.app";
    if (topLevelDir === "Yaaglm.HSR.OS.app") topLevelDir = "Yaaglm HSR OS.app";
    if (topLevelDir === "Yaaglm.ZZZ.app") topLevelDir = "Yaaglm ZZZ.app";
    if (topLevelDir === "Yaaglm.ZZZ.OS.app") topLevelDir = "Yaaglm ZZZ OS.app";

    await tar_extract_directory(
      "./sidecar.tar.gz",
      "./sidecar",
      `${topLevelDir}/Contents/Resources/sidecar`,
      false
    );

    await removeFile("./sidecar.tar.gz");
  }

  for await (const progress of aria2.doStreamingDownload({
    uri: url,
    absDst: resolve("./resources.neu.update"),
  })) {
    yield [
      "setProgress",
      sidecarUrl
        ? 50 +
          Number((progress.completedLength * BigInt(50)) / progress.totalLength)
        : Number(
            (progress.completedLength * BigInt(100)) / progress.totalLength
          ),
    ];
  }

  yield ["setUndeterminedProgress"];
  await forceMove("./resources.neu.update", "./resources.neu");
}

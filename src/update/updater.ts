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

const SIDECAR_APP_BUNDLES: Record<string, string> = {
  hk4ecn: "Yaaglm.app.tar.gz",
  hk4eos: "Yaaglm.GI.OS.app.tar.gz",
  bh3glb: "Yaaglm.Honkai.Global.app.tar.gz",
  hkrpgcn: "Yaaglm.HSR.app.tar.gz",
  hkrpgos: "Yaaglm.HSR.OS.app.tar.gz",
  napcn: "Yaaglm.ZZZ.app.tar.gz",
  napos: "Yaaglm.ZZZ.OS.app.tar.gz",
  mhycn: "Yaaglm.CN.app.tar.gz",
  mhyos: "Yaaglm.OS.app.tar.gz",
  cbjq: "Yaaglm.SCZ.OS.app.tar.gz",
  cbjqcn: "Yaaglm.SCZ.app.tar.gz",
};

const SIDECAR_TOP_LEVEL_DIRS: Record<string, string> = {
  "Yaaglm.app": "Yaaglm.app",
  "Yaaglm.GI.OS.app": "Yaaglm GI OS.app",
  "Yaaglm.Honkai.Global.app": "Yaaglm Honkai Global.app",
  "Yaaglm.HSR.app": "Yaaglm HSR.app",
  "Yaaglm.HSR.OS.app": "Yaaglm HSR OS.app",
  "Yaaglm.ZZZ.app": "Yaaglm ZZZ.app",
  "Yaaglm.ZZZ.OS.app": "Yaaglm ZZZ OS.app",
  "Yaaglm.CN.app": "Yaaglm CN.app",
  "Yaaglm.OS.app": "Yaaglm OS.app",
  "Yaaglm.SCZ.OS.app": "Yaaglm SCZ OS.app",
  "Yaaglm.SCZ.app": "Yaaglm SCZ.app",
};

export function getSidecarAppBundleName(updateVersion: string): string {
  return SIDECAR_APP_BUNDLES[updateVersion] ?? "";
}

export function getSidecarTopLevelDir(sidecarUrl: string): string {
  const archiveBase =
    sidecarUrl.split("/").pop()?.replace(/\.tar\.gz$/, "") ?? "";
  return SIDECAR_TOP_LEVEL_DIRS[archiveBase] ?? archiveBase;
}

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
    const appBundleName = getSidecarAppBundleName(updateVersion);
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
    const topLevelDir = getSidecarTopLevelDir(sidecarUrl);

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

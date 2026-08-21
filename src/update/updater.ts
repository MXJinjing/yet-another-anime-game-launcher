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
import { formatDownloadSpeed, humanFileSize } from "@runtime/format";
import { DownloadCancelledError } from "../download/control";
import { env, removeFile, resolve } from "../platform/neutralino";
import { tar_extract } from "../runtime/archive";
import { exec } from "../runtime/command-runner";
import { wait } from "../runtime/async";
import { DEV_UPDATE_INFO } from "./dev-mock";
import {
  cp,
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

/**
 * Stream-scheduler key used to tag launcher self-update downloads so the
 * window-close flow can identify and cancel them (mirroring how the
 * game-close flow stops game processes before exiting).
 */
export const UPDATE_DOWNLOAD_KEY = "launcher-update";

export function getSidecarAppBundleName(updateVersion: string): string {
  return SIDECAR_APP_BUNDLES[updateVersion] ?? "";
}

export function getSidecarTopLevelDir(sidecarUrl: string): string {
  const archiveBase =
    sidecarUrl
      .split("/")
      .pop()
      ?.replace(/\.tar\.gz$/, "") ?? "";
  return SIDECAR_TOP_LEVEL_DIRS[archiveBase] ?? archiveBase;
}

const UPDATE_EXTRACT_DIR = "./.update-app";

/**
 * Applies the release app shipped in the downloaded archive:
 *  1. extracts the full .app bundle once;
 *  2. mirrors it into the running .app path with rsync --delete, so after the
 *     update the app folder is byte-for-byte identical to the released app and
 *     the next launch's parameterized rsync has no old files left to re-merge;
 *  3. deletes the old sidecar in the launcher working directory and copies the
 *     new sidecar in its place (the old sidecar is never mixed with the new);
 *  4. refreshes build-manifest.json and icon.icns in the working directory.
 *
 * The bundle is replaced first: if a later working-dir step fails, the next
 * launch re-syncs the (now current) bundle Resources over the working dir and
 * still ends up consistent. Falls back to an administrator prompt when the
 * bundle is not writable by the current user (e.g. /Applications is
 * root-owned).
 */
export async function applyReleaseApp(
  archivePath: string,
  topLevelDir: string
): Promise<void> {
  // Failures propagate: a release that cannot be applied must abort the update
  // instead of leaving a half-updated launcher behind.
  await rmrf_dangerously(UPDATE_EXTRACT_DIR);
  try {
    await mkdirp(UPDATE_EXTRACT_DIR);
    await tar_extract(archivePath, UPDATE_EXTRACT_DIR);
    const newBundle = `${UPDATE_EXTRACT_DIR}/${topLevelDir}`;
    const newResources = `${newBundle}/Contents/Resources`;

    // Sanity check the archive layout before touching anything on disk.
    await exec(["test", "-f", `${newResources}/build-manifest.json`]);

    const bundlePath = await env("YAAGL_BUNDLE_PATH");
    if (bundlePath) {
      // Trailing slashes make rsync mirror the new bundle's contents into the
      // existing bundle path instead of nesting a directory inside it.
      // --checksum (not just the size+mtime quick check) makes the mirror
      // byte-for-byte exact even if old and new files share size/mtime.
      const sync = [
        "rsync",
        "-a",
        "--checksum",
        "--delete",
        `${newBundle}/`,
        `${bundlePath}/`,
      ];
      try {
        await exec(sync);
      } catch (error) {
        await log(
          `App bundle replacement without privileges failed (${String(
            error
          )}); retrying with administrator privileges`
        );
        await exec(sync, {}, true);
      }
      await log(`Replaced app bundle at ${bundlePath} with ${topLevelDir}`);
    } else {
      await log("YAAGL_BUNDLE_PATH is unset; skipping app bundle replacement");
    }

    // Replace the working-dir sidecar wholesale: the old sidecar is deleted
    // first so it can never be mixed with the new sidecar.
    await rmrf_dangerously("./sidecar");
    await mkdirp("./sidecar");
    await exec(["rsync", "-a", `${newResources}/sidecar/`, "./sidecar/"]);

    // Refresh the other app-managed resources the launcher reads at startup
    // (hosts-helper registration/version checks use the manifest).
    await cp(`${newResources}/build-manifest.json`, "./build-manifest.json");
    await cp(`${newResources}/icon.icns`, "./icon.icns");
  } finally {
    await rmrf_dangerously(UPDATE_EXTRACT_DIR);
  }
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
        aheadOfLatest: false,
      } as const;
    }
  }

  if (CURRENT_YAAGL_VERSION === "development") {
    // Developer builds have no auto-update, so the startup check must not nag.
    // A manual "check for update" still returns fixed data (no network) so the
    // update UI can be exercised for development.
    if (automatic) {
      return {
        latest: true,
        aheadOfLatest: false,
      } as const;
    }
    return {
      latest: false,
      ...DEV_UPDATE_INFO,
    } as const;
  }
  const currentVersion = CURRENT_YAAGL_VERSION;
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

    if (gt(latest.tag_name, currentVersion) && neu !== undefined) {
      return {
        latest: false,
        downloadUrl: neu.browser_download_url,
        sidecarDownloadUrl: sidecar?.browser_download_url,
        version: latest.tag_name,
        description: latest.body,
      } as const;
    }
    if (gt(currentVersion, latest.tag_name)) {
      // The local build is newer than the newest published release.
      return {
        latest: true,
        aheadOfLatest: true,
      } as const;
    }
    return {
      latest: true,
      aheadOfLatest: false,
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

/** Throws DownloadCancelledError when the caller has aborted the update. */
function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DownloadCancelledError();
}

export async function* downloadProgram(
  aria2: Aria2,
  url: string,
  sidecarUrl?: string,
  signal?: AbortSignal
): TaskProgram {
  if (CURRENT_YAAGL_VERSION === "development") {
    // Development builds run the update UI on fixed data; simulate progress
    // instead of downloading anything or touching the real filesystem.
    yield ["setStateText", "DOWNLOADING_UPDATE_FILE"];
    const mockTotal = 256 * 1024 * 1024;
    for (const pct of [0, 25, 50, 75, 100]) {
      assertNotAborted(signal);
      yield ["setProgress", pct];
      yield [
        "setDownloadStats",
        {
          speed: 15 * 1024 * 1024,
          downloaded: (mockTotal * pct) / 100,
          total: mockTotal,
          fileName: "development://mock-update",
        },
      ];
      await wait(250);
    }
    yield ["setUndeterminedProgress"];
    return;
  }
  yield ["setStateText", "DOWNLOADING_UPDATE_FILE"];
  if (sidecarUrl) {
    for await (const progress of aria2.doStreamingDownload({
      uri: sidecarUrl,
      absDst: resolve("./sidecar.tar.gz"),
      downloadKey: UPDATE_DOWNLOAD_KEY,
    })) {
      yield [
        "setProgress",
        Number((progress.completedLength * BigInt(50)) / progress.totalLength),
      ];
      yield [
        "setDownloadStats",
        {
          speed: Number(progress.downloadSpeed),
          downloaded: Number(progress.completedLength),
          total: Number(progress.totalLength),
          fileName: "sidecar.tar.gz",
        },
      ];
    }
    assertNotAborted(signal);
    const topLevelDir = getSidecarTopLevelDir(sidecarUrl);
    // Replace the whole .app bundle and the working-dir app resources
    // (sidecar + manifest + icon) from the release archive, so after the
    // update neither the bundle nor the working directory can mix old and
    // new files.
    await applyReleaseApp("./sidecar.tar.gz", topLevelDir);

    assertNotAborted(signal);
    await removeFile("./sidecar.tar.gz");
  }

  assertNotAborted(signal);

  for await (const progress of aria2.doStreamingDownload({
    uri: url,
    absDst: resolve("./resources.neu.update"),
    downloadKey: UPDATE_DOWNLOAD_KEY,
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
    yield [
      "setDownloadStats",
      {
        speed: Number(progress.downloadSpeed),
        downloaded: Number(progress.completedLength),
        total: Number(progress.totalLength),
        fileName: "resources.neu",
      },
    ];
  }

  assertNotAborted(signal);
  yield ["setUndeterminedProgress"];
  await forceMove("./resources.neu.update", "./resources.neu");
}

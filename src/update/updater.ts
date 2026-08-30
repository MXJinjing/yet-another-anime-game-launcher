import { Aria2 } from "@aria2";
import { configEntries, createConfigStore } from "@config";
import {
  getGithubErrorStatus,
  Github,
  GithubReleaseInfo,
} from "../integrations/github";
import { gt, lt } from "semver";
import { CURRENT_YAAGL_VERSION } from "../constants";
import { log } from "../logging/logger";
import { formatDownloadSpeed, humanFileSize } from "@runtime/format";
import { DownloadCancelledError } from "../download/control";
import {
  env,
  readFile,
  removeFile,
  resolve,
  resolveResource,
} from "../platform/neutralino";
import { tar_extract } from "../runtime/archive";
import { exec } from "../runtime/command-runner";
import { wait } from "../runtime/async";
import { DEV_UPDATE_INFO } from "./dev-mock";
import { mkdirp, rmrf_dangerously } from "../runtime/macos-filesystem";
import type { TaskProgram } from "../tasks/task-program";

const owner = "MXJinjing";
const repo = "yet-another-anime-game-launcher";

const RELEASE_APP_ARCHIVES: Record<string, string> = {
  hk4ecn: "Yaaglm.GI.CN.app.tar.gz",
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

const RELEASE_APP_TOP_LEVEL_DIRS: Record<string, string> = {
  "Yaaglm.GI.CN.app": "Yaaglm GI CN.app",
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

export function getReleaseAppArchiveName(updateVersion: string): string {
  return RELEASE_APP_ARCHIVES[updateVersion] ?? "";
}

export function getReleaseAppTopLevelDir(appUrl: string): string {
  const archiveBase =
    appUrl
      .split("/")
      .pop()
      ?.replace(/\.tar\.gz$/, "") ?? "";
  return RELEASE_APP_TOP_LEVEL_DIRS[archiveBase] ?? archiveBase;
}

/** Resolves the channel used to pick the release assets for this build. */
export async function resolveUpdateChannel(): Promise<string> {
  if (
    import.meta.env["YAAGL_CHANNEL_CLIENT"] &&
    import.meta.env["YAAGL_CHANNEL_CLIENT"] != "hk4euniversal"
  ) {
    return import.meta.env["YAAGL_CHANNEL_CLIENT"];
  }
  if ((await env("YAAGL_OS")) == "1") return "hk4eos";
  return "hk4ecn";
}

/**
 * Detects whether a previous (older, buggy) hot update left this install
 * half-applied: the running frontend is already the current version, but the
 * installed app bundle still reports the previous version.
 */
export async function isUpdateHalfApplied(): Promise<boolean> {
  if (CURRENT_YAAGL_VERSION === "development") return false;
  const expected = CURRENT_YAAGL_VERSION;

  try {
    const raw = await readFile(resolveResource("./build-manifest.json"));
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version == "string" && lt(parsed.version, expected)) {
      await log(
        `Half-applied update detected: bundle manifest is ${parsed.version}, running version ${expected}`
      );
      return true;
    }
  } catch {
    // Missing or unreadable bundle manifest is handled by the trusted-bundle check.
  }
  return false;
}

/**
 * Returns the release app archive URL for a specific release tag, so the
 * launcher can re-apply its own version after a half-applied update. Returns
 * undefined when the archive is missing.
 */
export async function getReleaseAssetsForVersion(
  github: Github,
  version: string
): Promise<{ appDownloadUrl: string } | undefined> {
  try {
    const updateVersion = await resolveUpdateChannel();
    const release = (await github.api(
      `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(version)}`
    )) as GithubReleaseInfo;
    const appArchiveName = getReleaseAppArchiveName(updateVersion);
    const appArchive = release.assets.find(x => x.name == appArchiveName);
    if (!appArchive) return undefined;
    return { appDownloadUrl: appArchive.browser_download_url };
  } catch (error) {
    await log(
      `Failed to fetch release assets for ${version}: ${String(error)}`
    );
    return undefined;
  }
}

const UPDATE_EXTRACT_DIR = "./.update-app";

/**
 * Applies the release app shipped in the downloaded archive:
 *  1. extracts the full .app bundle once;
 *  2. mirrors it into the running .app path with rsync --delete, so the
 *     installed bundle contains the complete released app;
 *  3. leaves Application Support user data untouched; resources.neu, sidecar,
 *     manifest, and the icon are loaded directly from the app bundle.
 *
 * The bundle is replaced first. Falls back to an administrator prompt when the
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
    await exec(["test", "-f", `${newResources}/resources.neu`]);

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
    const updateVersion = await resolveUpdateChannel();
    const latest: GithubReleaseInfo = (await github.api(
      `/repos/${owner}/${repo}/releases/latest`
    )) as GithubReleaseInfo;
    const appArchiveName = getReleaseAppArchiveName(updateVersion);
    const appArchive = latest.assets.find(x => x.name == appArchiveName);

    const latestVersion =
      typeof latest.tag_name === "string" ? latest.tag_name : undefined;
    if (latestVersion && gt(latestVersion, currentVersion) && appArchive !== undefined) {
      return {
        latest: false,
        appDownloadUrl: appArchive.browser_download_url,
        version: latest.tag_name,
        description: latest.body,
      } as const;
    }
    if (latestVersion && gt(currentVersion, latestVersion)) {
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
  appUrl: string,
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
  for await (const progress of aria2.doStreamingDownload({
    uri: appUrl,
    absDst: resolve("./update-app.tar.gz"),
    downloadKey: UPDATE_DOWNLOAD_KEY,
  })) {
    yield [
      "setProgress",
      Number((progress.completedLength * BigInt(100)) / progress.totalLength),
    ];
    yield [
      "setDownloadStats",
      {
        speed: Number(progress.downloadSpeed),
        downloaded: Number(progress.completedLength),
        total: Number(progress.totalLength),
        fileName: "update-app.tar.gz",
      },
    ];
  }

  assertNotAborted(signal);
  yield ["setUndeterminedProgress"];
  const topLevelDir = getReleaseAppTopLevelDir(appUrl);
  await applyReleaseApp("./update-app.tar.gz", topLevelDir);
  assertNotAborted(signal);
  await removeFile("./update-app.tar.gz");
}

import type { Locale } from "@locale";
import { log } from "../logging/logger";
import { env, openDir } from "../platform/neutralino";
import { exec } from "../runtime/command-runner";

type ExecResult = { stdOut: string };

export interface GameInstallationDependencies {
  openFolderDialog?: (title: string) => Promise<string>;
  getHome?: () => Promise<string>;
  exec?: (command: string[]) => Promise<ExecResult>;
  log?: (message: string) => Promise<unknown>;
}

function isForbiddenHomeDirectory(path: string, home: string): boolean {
  const normalizedHome = home.replace(/\/+$/, "");
  if (!normalizedHome || !path.startsWith(normalizedHome + "/")) {
    return false;
  }

  const relativePath = path.slice(normalizedHome.length + 1);
  const firstSegment = relativePath.split("/")[0];
  return ["Desktop", "Downloads", "Documents"].includes(firstSegment);
}

function containsOnlyAsciiPathSegments(path: string): boolean {
  return path
    .split("/")
    .slice(1)
    .every(segment =>
      [...segment].every(character => {
        const code = character.charCodeAt(0);
        return code > 0 && code <= 0x7f;
      })
    );
}

/**
 * Prompts until the user selects an absolute ASCII path outside the protected
 * home directories. Cancellation deliberately returns an empty string.
 */
export async function selectGameInstallationDirectory(
  locale: Locale,
  dependencies: GameInstallationDependencies = {}
): Promise<string> {
  const openFolderDialog =
    dependencies.openFolderDialog ?? (title => openDir(title));
  const getHome = dependencies.getHome ?? (() => env("HOME"));
  const writeLog = dependencies.log ?? log;
  const home = await getHome();
  await writeLog("HOME:" + home);

  for (;;) {
    const path = await openFolderDialog(locale.get("SELECT_INSTALLATION_DIR"));
    if (!path) {
      return "";
    }
    if (!path.startsWith("/")) {
      await locale.alert("PATH_INVALID", "PLEASE_SELECT_A_DIR");
      continue;
    }
    if (isForbiddenHomeDirectory(path, home)) {
      await locale.alert("PATH_INVALID", "PATH_INVALID_FORBIDDEN_DIR");
      continue;
    }
    if (!containsOnlyAsciiPathSegments(path)) {
      await locale.alert("PATH_INVALID", "PATH_INVALID_ASCII_ONLY");
      continue;
    }
    return path;
  }
}

/**
 * Returns the directory size in bytes, or null when `du` cannot provide a
 * parseable value. This makes unavailable filesystems a display concern rather
 * than a fatal settings error.
 */
export async function getGameInstallationDirectorySize(
  path: string,
  dependencies: GameInstallationDependencies = {}
): Promise<number | null> {
  const run =
    dependencies.exec ??
    (async command => (await exec(command, {}, false)) as ExecResult);
  try {
    const result = await run(["du", "-sk", path]);
    const sizeInKiB = Number(result.stdOut.trim().split(/\s+/)[0]);
    return Number.isFinite(sizeInKiB) && sizeInKiB >= 0
      ? sizeInKiB * 1024
      : null;
  } catch {
    return null;
  }
}

/**
 * Compatibility adapter for callers that still own the folder-dialog wiring.
 */
export async function createGameInstallationDirectorySanitizer({
  openFolderDialog,
  locale,
}: {
  openFolderDialog: () => Promise<string>;
  locale: Locale;
}) {
  return {
    selectPath: () =>
      selectGameInstallationDirectory(locale, {
        openFolderDialog: () => openFolderDialog(),
      }),
  };
}

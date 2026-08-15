import { join, resolve as resolvePath } from "path-browserify";
import {
  readDirectory,
  removeDirectory,
  removeFile,
  stats,
} from "../platform/neutralino";

export interface GameUninstallationDependencies {
  readDirectory?: typeof readDirectory;
  removeDirectory?: typeof removeDirectory;
  removeFile?: typeof removeFile;
  stats?: typeof stats;
}

/**
 * Returns a canonical game directory path when it is safe to operate on, or
 * null when the path points at a dangerous or otherwise invalid location.
 */
export function normalizeGameInstallDir(
  path: string,
  home: string
): string | null {
  if (!path || !path.startsWith("/") || path.includes("\0")) {
    return null;
  }

  const normalizedPath = resolvePath(path);
  const normalizedHome = home ? resolvePath(home) : "";
  const segments = normalizedPath.split("/").filter(Boolean);

  if (
    normalizedPath === "/" ||
    normalizedPath === normalizedHome ||
    segments.length < 2
  ) {
    return null;
  }

  return normalizedPath;
}

async function clearDirectoryContents(
  directory: string,
  dependencies: Required<GameUninstallationDependencies>
): Promise<void> {
  const entries = await dependencies.readDirectory(directory);
  for (const entry of entries) {
    const child = join(directory, entry.entry);
    if (entry.type === "DIRECTORY") {
      await clearDirectoryContents(child, dependencies);
      await dependencies.removeDirectory(child);
    } else {
      await dependencies.removeFile(child);
    }
  }
}

/**
 * Removes the contents of a validated game directory while preserving the
 * directory itself. The caller must validate the path first.
 */
export async function clearGameInstallDirectory(
  normalizedPath: string,
  injectedDependencies: GameUninstallationDependencies = {}
): Promise<void> {
  const dependencies: Required<GameUninstallationDependencies> = {
    readDirectory: injectedDependencies.readDirectory ?? readDirectory,
    removeDirectory: injectedDependencies.removeDirectory ?? removeDirectory,
    removeFile: injectedDependencies.removeFile ?? removeFile,
    stats: injectedDependencies.stats ?? stats,
  };
  const metadata = await dependencies.stats(normalizedPath);
  if (!metadata.isDirectory) {
    throw new Error(`Game install path is not a directory: ${normalizedPath}`);
  }
  await clearDirectoryContents(normalizedPath, dependencies);
}

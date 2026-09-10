import { dirname, join } from "path-browserify";
import { fileOrDirExists, resolve } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { cp, mkdirp, rmrf_dangerously } from "@runtime/macos-filesystem";
import { log } from "../logging/logger";
import type { Wine } from "./wine";

/**
 * Describes the parts of a Wine prefix that belong to one game: its registry
 * keys (plus the shared device fingerprint key) and its per-user data
 * directories. Keeping this set small lets the launcher move a game between
 * the global prefix and its own prefix in both directions.
 */
export type WineUserDataDescriptor = {
  /** HKEY_CURRENT_USER subkeys, using Windows separators. */
  registryKeys: string[];
  /** Prefix-relative paths; `*` matches a `drive_c/users` entry. */
  prefixDirs: string[];
};

async function defaultListUsers(prefix: string) {
  try {
    const result = await exec(["ls", join(prefix, "drive_c", "users")]);
    return result.stdOut
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
  } catch (error) {
    await log(`Failed to list Wine prefix users: ${String(error)}`);
    return [];
  }
}

async function defaultCopyDir(source: string, target: string) {
  await rmrf_dangerously(target);
  await mkdirp(dirname(target));
  await cp(source, target);
}

/**
 * Move a game's registry keys and data directories between two prefixes.
 * Missing keys/directories are skipped; failures are logged so a game can
 * still start instead of being blocked by a partial migration.
 */
export async function migrateWineUserData({
  sourceWine,
  targetWine,
  descriptor,
  workDir = resolve("./.tmp/wine-migration"),
  listUsers = defaultListUsers,
  copyDir = defaultCopyDir,
}: {
  sourceWine: Pick<Wine, "prefix" | "exec" | "toWinePath">;
  targetWine: Pick<Wine, "prefix" | "exec" | "toWinePath">;
  descriptor: WineUserDataDescriptor;
  workDir?: string;
  listUsers?: (prefix: string) => Promise<string[]>;
  copyDir?: (source: string, target: string) => Promise<unknown>;
}): Promise<void> {
  await mkdirp(workDir);
  let index = 0;
  for (const key of descriptor.registryKeys) {
    const file = join(workDir, `wine-user-data-${index++}.reg`);
    const wineFile = sourceWine.toWinePath(file);
    try {
      const exported = await sourceWine.exec(
        "reg",
        ["export", key, wineFile],
        {},
        "/dev/null"
      );
      if (exported.exitCode != 0) continue;
      await targetWine.exec("reg", ["import", wineFile], {}, "/dev/null");
    } catch (error) {
      await log(`Wine registry migration skipped (${key}): ${String(error)}`);
    }
  }
  for (const relative of descriptor.prefixDirs) {
    for (const user of await listUsers(sourceWine.prefix)) {
      const path = relative.replaceAll("*", user);
      const source = join(sourceWine.prefix, path);
      if (!(await fileOrDirExists(source))) continue;
      const target = join(targetWine.prefix, path);
      try {
        await copyDir(source, target);
      } catch (error) {
        await log(
          `Wine user data migration skipped (${path}): ${String(error)}`
        );
      }
    }
  }
}

import { gt, valid } from "semver";
import { isGameVersionUnreadableError } from "./launch-errors";

export function readGameVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsedVersion = valid(value);
  return parsedVersion && parsedVersion !== "0.0.0" ? value : null;
}

export function requireGameVersion(value: unknown): string {
  const version = readGameVersion(value);
  if (!version) throw new Error("Invalid game version in online manifest");
  return version;
}

export function isNewerGameVersion(candidate: unknown, installed: unknown) {
  const target = readGameVersion(candidate);
  const current = readGameVersion(installed);
  return !!target && !!current && gt(target, current);
}

/**
 * Classify an installed-version read so clients can degrade to "version
 * unavailable" instead of aborting the launch or the whole task.
 *
 * `missing` means the files to read are not there (likely not installed);
 * `unavailable` means the files exist but the version cannot be parsed.
 */
export type InstalledVersionRead =
  | { status: "version"; version: string }
  | { status: "unavailable" }
  | { status: "missing"; error: unknown };

export async function readInstalledGameVersion(
  read: () => Promise<unknown>
): Promise<InstalledVersionRead> {
  try {
    const version = readGameVersion(await read());
    return version ? { status: "version", version } : { status: "unavailable" };
  } catch (error) {
    return isGameVersionUnreadableError(error)
      ? { status: "unavailable" }
      : { status: "missing", error };
  }
}

import { gt, valid } from "semver";

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

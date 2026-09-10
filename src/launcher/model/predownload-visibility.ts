import { gt, valid } from "semver";

export function showPredownloadAfterDeletion(
  completed: boolean | undefined,
  installed: boolean,
  targetVersion: string,
  gameVersion: string
) {
  return (
    completed === false &&
    installed &&
    !!valid(targetVersion) &&
    !!valid(gameVersion) &&
    gt(targetVersion, gameVersion)
  );
}

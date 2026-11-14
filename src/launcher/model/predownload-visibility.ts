import { isNewerGameVersion } from "../../clients/game-version";

export function showPredownloadAfterDeletion(
  completed: boolean | undefined,
  installed: boolean,
  targetVersion: string,
  gameVersion: string
) {
  return (
    completed === false &&
    installed &&
    isNewerGameVersion(targetVersion, gameVersion)
  );
}

import { isNewerGameVersion } from "../../clients/game-version";

export function resolvePredownloadVisibility(
  completedVersion: string | undefined,
  prompted: boolean,
  installed: boolean,
  targetVersion: string,
  gameVersion: string
) {
  if (!installed || !isNewerGameVersion(targetVersion, gameVersion))
    return "hidden";
  if (completedVersion === targetVersion) return "completed";
  return prompted || completedVersion !== undefined ? "available" : "hidden";
}

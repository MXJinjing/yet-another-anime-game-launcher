import type { DownloadControlState } from "@download/control";

export type PrimaryLauncherAction =
  | "none"
  | "pause-download"
  | "resume-download"
  | "initialize-wine"
  | "install"
  | "continue-install"
  | "update"
  | "launch";

/** Pure decision policy for the primary launcher action. */
export function resolvePrimaryLauncherAction({
  download,
  gameTaskBusy,
  wineInstalled,
  installState,
  updateRequired,
  runtimeReady,
}: {
  download: DownloadControlState;
  gameTaskBusy: boolean;
  wineInstalled: boolean;
  installState: string;
  updateRequired: boolean;
  runtimeReady: boolean;
}): PrimaryLauncherAction {
  if (download.active) {
    if (download.actionPending) return "none";
    if (download.pauseRequested || download.paused) {
      return download.canResume ? "resume-download" : "none";
    }
    return download.canPause ? "pause-download" : "none";
  }
  if (gameTaskBusy) return "none";
  if (!wineInstalled) return "initialize-wine";
  if (installState !== "INSTALLED") return "install";
  if (!runtimeReady) return "continue-install";
  return updateRequired ? "update" : "launch";
}

export function resolveIntegrityAction(updateRequired: boolean) {
  return updateRequired ? "prompt-update" : "check-integrity";
}

import {
  createUnavailableAria2,
  startAria2Service,
  type Aria2,
} from "../download/aria2-service";
import { setDownloadServiceUnavailable } from "../download/service-status";
import { log } from "../logging/logger";
import { pushStartupNotice } from "../runtime/startup-notices";

export type DownloadServiceBootDependencies = {
  start: () => Promise<Aria2>;
  createUnavailable: (reason?: string) => Aria2;
  reportUnavailable: (reason: string) => void | Promise<void>;
};

const defaultDependencies: DownloadServiceBootDependencies = {
  start: startAria2Service,
  createUnavailable: createUnavailableAria2,
  reportUnavailable: async reason => {
    setDownloadServiceUnavailable(reason);
    pushStartupNotice("download-service-unavailable", reason);
    await log(
      `Download service unavailable; continuing without install/update/predownload: ${reason}`
    );
  },
};

/**
 * Boots the aria2 download service, degrading to a facade when it cannot start.
 *
 * Installed games only need Wine, so a failed download service must not stop
 * the launcher. The facade keeps composition (Wine, updater, launcher) intact;
 * install/update/predownload then fail as ordinary task errors and the startup
 * banner explains the reduced feature set.
 */
export async function startDownloadService(
  dependencies: Partial<DownloadServiceBootDependencies> = {}
): Promise<Aria2> {
  const { start, createUnavailable, reportUnavailable } = {
    ...defaultDependencies,
    ...dependencies,
  };
  try {
    return await start();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await reportUnavailable(reason);
    return createUnavailable(reason);
  }
}

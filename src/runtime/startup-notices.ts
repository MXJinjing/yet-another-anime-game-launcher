/**
 * Launcher-scoped notices raised while booting.
 *
 * Startup failures that have a usable degraded outcome (for example a download
 * service that could not start, or an acceleration prefix that was disabled)
 * are recorded here instead of terminating the process. The composition root
 * renders them once the main screen is mounted, so the reason stays visible
 * without blocking the user.
 */
export type StartupNoticeId =
  | "download-service-unavailable"
  | "github-prefix-disabled";

export type StartupNotice = {
  id: StartupNoticeId;
  /** Optional technical detail shown under the localized explanation. */
  detail?: string;
};

const notices = new Map<StartupNoticeId, StartupNotice>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function pushStartupNotice(id: StartupNoticeId, detail?: string) {
  notices.set(id, { id, detail });
  emit();
}

export function dismissStartupNotice(id: StartupNoticeId) {
  if (notices.delete(id)) emit();
}

export function getStartupNotices(): StartupNotice[] {
  return [...notices.values()];
}

export function subscribeStartupNotices(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: restore the module to a clean boot state. */
export function resetStartupNotices() {
  notices.clear();
  emit();
}

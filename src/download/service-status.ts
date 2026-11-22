/**
 * Availability of the local download service (aria2).
 *
 * When aria2 cannot start, the launcher keeps running: install, update and
 * predownload become unavailable, while already-installed games can still be
 * launched. Feature code reads this flag instead of assuming the service is
 * always present.
 */
let available = true;
let unavailableReason: string | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function isDownloadServiceAvailable(): boolean {
  return available;
}

export function getDownloadServiceUnavailableReason(): string | undefined {
  return unavailableReason;
}

export function setDownloadServiceUnavailable(reason?: string) {
  available = false;
  unavailableReason = reason;
  emit();
}

export function markDownloadServiceAvailable() {
  available = true;
  unavailableReason = undefined;
  emit();
}

export function subscribeDownloadServiceStatus(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: restore the module to a clean boot state. */
export function resetDownloadServiceStatus() {
  markDownloadServiceAvailable();
}

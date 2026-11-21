export const LAUNCHER_LOG_TAB = "launcher";

/** Short tab title. Colliding file names keep enough parent folders to differ. */
export function gameLogTabLabel(
  path: string,
  paths: readonly string[]
): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return path;
  for (let count = 1; count <= parts.length; count++) {
    const label = parts.slice(-count).join("/");
    const collisions = paths.filter(item => {
      const itemParts = item.split("/").filter(Boolean);
      return itemParts.slice(-count).join("/") === label;
    });
    if (collisions.length <= 1) return label;
  }
  return path;
}

export function openMonitoredPaths(
  discovered: readonly string[],
  closed: ReadonlySet<string>
): string[] {
  return discovered.filter(path => !closed.has(path));
}

export function closeMonitoredPath(
  closed: ReadonlySet<string>,
  path: string
): Set<string> {
  const next = new Set(closed);
  next.add(path);
  return next;
}

export function reopenMonitoredPath(
  closed: ReadonlySet<string>,
  path: string
): Set<string> {
  const next = new Set(closed);
  next.delete(path);
  return next;
}

export function selectionAfterClose(
  selected: string,
  openPaths: readonly string[]
): string {
  if (selected === LAUNCHER_LOG_TAB || openPaths.includes(selected)) {
    return selected;
  }
  return openPaths[0] ?? LAUNCHER_LOG_TAB;
}

import { isAbsolute, normalize } from "path-browserify";

export const LAUNCHER_LOG_TAB = "launcher";
const TAB_WIDTH = 145;

/** Keep the active file next to the launcher even under tight width. */
export function layoutLogTabs(
  monitored: readonly string[],
  closed: ReadonlySet<string>,
  selected: string,
  trackWidth: number
) {
  const slots = Math.max(1, Math.floor(trackWidth / TAB_WIDTH) - 1);
  const open = openMonitoredPaths(monitored, closed);
  const visible = open.slice(0, slots);
  if (open.includes(selected) && !visible.includes(selected)) {
    visible[visible.length - 1] = selected;
  }
  return {
    visible,
    folded: monitored.filter(path => !visible.includes(path)),
  };
}

export async function validatePickedLogPaths(
  picked: readonly string[],
  isFile: (path: string) => Promise<boolean>
) {
  const paths = [...new Set(picked.filter(isAbsolute).map(normalize))];
  const valid = await Promise.all(
    paths.map(async path => {
      try {
        return await isFile(path);
      } catch {
        return false;
      }
    })
  );
  return paths.filter((_, index) => valid[index]);
}

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

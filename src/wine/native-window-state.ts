import { basename } from "path-browserify";
import { log } from "../logging/logger";
import { resolveSidecarPath } from "@platform/neutralino/sidecar";
import { exec2 } from "@runtime/command-runner";

export type NativeWineProcess = {
  pid: string;
  name: string;
  command: string;
};

export type NativeWineWindow = {
  pid: string;
  windowId: number;
  layer: number;
  onScreen: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
  title: string;
};

function executableName(value: string) {
  return basename(value.trim().replaceAll("\\", "/")).toLowerCase();
}

/** Parse native Wine processes whose command begins with a Windows executable. */
export function parseNativeWineProcesses(output: string): NativeWineProcess[] {
  const processes: NativeWineProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const command = match[2];
    const executable = command.match(
      /^((?:[a-z]:[\\/].+?|[^\\/\s]+)\.exe)(?:\s|$)/i
    )?.[1];
    if (!executable) continue;
    processes.push({
      pid: match[1],
      name: executableName(executable),
      command,
    });
  }
  return processes;
}

function parseFiniteNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseWindowProbeOutput(output: string): NativeWineWindow[] {
  const windows: NativeWineWindow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split("\t");
    if (fields[0] !== "WINDOW" || !/^\d+$/.test(fields[1] ?? "")) continue;
    const [windowId, layer, onScreen, x, y, width, height, alpha] = fields
      .slice(2, 10)
      .map(parseFiniteNumber);
    if (
      windowId == undefined ||
      layer == undefined ||
      onScreen == undefined ||
      x == undefined ||
      y == undefined ||
      width == undefined ||
      height == undefined ||
      alpha == undefined
    ) {
      continue;
    }
    windows.push({
      pid: fields[1],
      windowId,
      layer,
      onScreen: onScreen === 1,
      x,
      y,
      width,
      height,
      alpha,
      title: fields.slice(10).join("\t"),
    });
  }
  return windows;
}

const minimumApplicationWindowWidth = 160;
const minimumApplicationWindowHeight = 100;

function hasApplicationWindowSize(window: NativeWineWindow) {
  return (
    window.width >= minimumApplicationWindowWidth &&
    window.height >= minimumApplicationWindowHeight
  );
}

export function createApplicationWindowTracker() {
  const trackedWindowIds = new Set<number>();

  return {
    update(windows: NativeWineWindow[]) {
      // Window names are hidden without Screen Recording permission. Learn the
      // identity only from a substantial window that was actually on screen.
      for (const window of windows) {
        if (
          window.onScreen &&
          window.alpha > 0 &&
          hasApplicationWindowSize(window)
        ) {
          trackedWindowIds.add(window.windowId);
        }
      }

      const hasApplicationWindow = windows.some(
        window =>
          trackedWindowIds.has(window.windowId) &&
          window.alpha > 0 &&
          hasApplicationWindowSize(window) &&
          // A minimized Wine window remains at layer 0 while off screen. Wine
          // exit residue moves the tracked main window to a nonzero layer and
          // then off screen. Treat an on-screen transition as alive so window
          // animations cannot start the exit grace period.
          (window.layer === 0 || window.onScreen)
      );

      return {
        hasApplicationWindow,
        trackedWindowIds: [...trackedWindowIds].sort(
          (left, right) => left - right
        ),
      };
    },
  };
}

function windowSnapshotFingerprint(
  nativePids: string[],
  windows: NativeWineWindow[],
  hasApplicationWindow: boolean,
  trackedWindowIds: number[]
) {
  return JSON.stringify({
    nativePids: [...nativePids].sort(),
    hasApplicationWindow,
    trackedWindowIds,
    windows: [...windows].sort((left, right) => left.windowId - right.windowId),
  });
}

export function createNativeGameWindowState(executable: string) {
  const target = executableName(executable);
  let probePath: Promise<string> | undefined;
  let probeUnavailable = false;
  let previousSnapshot: string | undefined;
  const applicationWindowTracker = createApplicationWindowTracker();

  async function writeSnapshot(
    nativePids: string[],
    windows: NativeWineWindow[],
    hasApplicationWindow: boolean,
    trackedWindowIds: number[]
  ) {
    const snapshot = windowSnapshotFingerprint(
      nativePids,
      windows,
      hasApplicationWindow,
      trackedWindowIds
    );
    if (snapshot === previousSnapshot) return;
    previousSnapshot = snapshot;
    await log(
      `Native game window state changed: target=${target} ` +
        `hasApplicationWindow=${hasApplicationWindow} snapshot=${snapshot}`
    );
  }

  return async (): Promise<boolean | undefined> => {
    let nativePids: string[];
    try {
      const processTable = await exec2(
        ["ps", "ax", "-o", "pid=,command="],
        undefined,
        false,
        undefined,
        { timeoutMs: 2_000 }
      );
      nativePids = parseNativeWineProcesses(processTable.stdOut)
        .filter(process => process.name === target)
        .map(process => process.pid);
      if (nativePids.length === 0) return undefined;
    } catch {
      return undefined;
    }

    if (probeUnavailable) return undefined;
    try {
      probePath ??= resolveSidecarPath("window-probe/window-probe");
      const result = await exec2(
        [await probePath, ...nativePids],
        undefined,
        false,
        undefined,
        { timeoutMs: 2_000 }
      );
      const windows = parseWindowProbeOutput(result.stdOut);
      const { hasApplicationWindow, trackedWindowIds } =
        applicationWindowTracker.update(windows);
      await writeSnapshot(
        nativePids,
        windows,
        hasApplicationWindow,
        trackedWindowIds
      );
      return hasApplicationWindow;
    } catch (error) {
      // The probe is an optional enhancement. Process-only monitoring remains
      // authoritative when the helper is unavailable or window lookup fails.
      probeUnavailable = true;
      await log(`Native game window probe unavailable: ${String(error)}`);
      return undefined;
    }
  };
}

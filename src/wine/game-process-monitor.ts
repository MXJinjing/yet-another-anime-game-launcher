import { basename } from "path-browserify";
import { log } from "../logging/logger";

export type WineProcess = {
  pid: string;
  name: string;
  command?: string;
};

export type GameProcessMonitorState = "started" | "timed-out" | "unknown";
export type GameProcessExitState = "exited" | "crashed" | "unknown";

export type GameProcessMonitor = {
  listProcesses: () => Promise<WineProcess[]>;
  isRunning: () => Promise<boolean>;
  waitForStart: (options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    queryTimeoutMs?: number;
    initialDelayMs?: number;
  }) => Promise<GameProcessMonitorState>;
  waitForExit: (options?: {
    missingSamples?: number;
    pollIntervalMs?: number;
    crashThresholdMs?: number;
    queryTimeoutMs?: number;
    missingWindowSamples?: number;
    missingWindowGraceMs?: number;
  }) => Promise<GameProcessExitState>;
};

export type GameProcessMonitorOptions = {
  executable: string;
  listProcesses: () => Promise<WineProcess[]>;
  pinProcessIdsOnStart?: boolean;
  exitOnWindowClose?: boolean;
  getWindowState?: () => Promise<boolean | undefined>;
  onWindowClosed?: () => Promise<unknown>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => Promise<unknown> | unknown;
};

function executableName(value: string) {
  const normalized = value.trim().replaceAll("\\", "/");
  return basename(normalized).toLowerCase();
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field.trim());
  return fields;
}

/** Parse `tasklist /fo csv /nh` output without relying on localized headers. */
export function parseTasklistCsv(output: string): WineProcess[] {
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(parseCsvLine)
    .filter(fields => /^\d+$/.test(fields[1] ?? ""))
    .map(fields => ({
      name: fields[0] ?? "",
      pid: fields[1] ?? "",
    }));
}

/** Parse the process table emitted by `winedbg --command "info proc"`. */
export function parseWinedbgProcesses(output: string): WineProcess[] {
  const processes: WineProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:0x)?([0-9a-f]+)\s+(.+?)\s*$/i);
    if (!match || !/[a-z]/i.test(match[2])) continue;
    processes.push({ pid: match[1], name: match[2] });
  }
  return processes;
}

function normalizeWineExecutablePath(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/\/+/g, "/").toLowerCase();
}

/** Parse macOS `ps` output, including DXMT's direct Windows-executable form. */
export function parseMacWineProcesses(
  output: string,
  loaderPath: string,
  gamePath?: string
): WineProcess[] {
  const normalizedLoader = loaderPath.trim();
  if (normalizedLoader.length === 0) return [];
  const loaderPaths = [`${normalizedLoader}-preloader`, normalizedLoader];
  const driveCIndex = gamePath?.toLowerCase().indexOf("/drive_c/") ?? -1;
  const expectedGamePaths = gamePath
    ? [
        normalizeWineExecutablePath(`Z:${gamePath}`),
        normalizeWineExecutablePath(gamePath),
        ...(driveCIndex >= 0
          ? [
              normalizeWineExecutablePath(
                `C:${gamePath.slice(driveCIndex + 8)}`
              ),
            ]
          : []),
      ]
    : [];
  const processes: WineProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const command = match[2];
    const loaderMatch = loaderPaths
      .map(path => ({ path, index: command.indexOf(path) }))
      .find(({ index }) => index === 0);
    let executable: string | undefined;
    if (loaderMatch) {
      const { path: matchedLoader, index: loaderIndex } = loaderMatch;
      const before = command[loaderIndex - 1];
      const after = command[loaderIndex + matchedLoader.length];
      if (before != undefined && !/[\s'"]/.test(before)) continue;
      if (after != undefined && !/[\s'"]/.test(after)) continue;
      const argumentsText = command.slice(loaderIndex + matchedLoader.length);
      const executableMatch =
        argumentsText.match(
          /(?:^|\s)(?:"([^"]+\.exe)"|((?:[a-z]:[\\/].+?)\.exe))(?:\s|$)/i
        ) ??
        argumentsText.match(
          /(?:^|\s)(?:"([^"]+\.exe)"|([^\s]+\.exe))(?:\s|$)/i
        );
      executable = executableMatch?.[1] ?? executableMatch?.[2];
    } else if (expectedGamePaths.length > 0) {
      // DXMT exposes the Windows executable itself as the macOS process
      // command. Require its full path so another installation or a Steam
      // wrapper mentioning the game in its arguments is not mistaken for it.
      const executableMatch = command.match(
        /^(?:"([^"]+\.exe)"|((?:[a-z]:[\\/].+?)\.exe))(?:\s|$)/i
      );
      const directExecutable = executableMatch?.[1] ?? executableMatch?.[2];
      if (
        directExecutable &&
        expectedGamePaths.includes(
          normalizeWineExecutablePath(directExecutable)
        )
      ) {
        executable = directExecutable;
      }
    }
    if (!executable) continue;
    if (
      expectedGamePaths.length > 0 &&
      !expectedGamePaths.includes(normalizeWineExecutablePath(executable))
    ) {
      continue;
    }
    processes.push({ pid: match[1], name: executable, command });
  }
  return processes;
}

export function createGameProcessMonitor(
  options: GameProcessMonitorOptions
): GameProcessMonitor {
  const target = executableName(options.executable);
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const now = options.now ?? (() => Date.now());
  const writeLog = options.log ?? log;
  let startedAt: number | undefined;
  let startedProcessIds: Set<string> | undefined;
  let sawApplicationWindow = false;

  async function listProcesses(queryTimeoutMs = 10_000) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        options.listProcesses(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Wine process enumeration timed out after ${queryTimeoutMs}ms`
                )
              ),
            queryTimeoutMs
          );
        }),
      ]);
    } finally {
      if (timeout != undefined) clearTimeout(timeout);
    }
  }

  async function matchingProcesses(queryTimeoutMs?: number) {
    return (await listProcesses(queryTimeoutMs)).filter(
      process => executableName(process.name) === target
    );
  }

  async function isRunning() {
    // A freshly selected Wine distribution may still be updating the prefix
    // (wineboot) on its first query, which can exceed the enumeration budget.
    // That must never abort a launch with a hard error.
    try {
      return (await matchingProcesses()).length > 0;
    } catch (error) {
      await writeLog(
        `Wine process pre-check unavailable, continuing launch: ${String(
          error
        )}`
      );
      return false;
    }
  }

  async function waitForStart({
    timeoutMs = 45_000,
    pollIntervalMs = 500,
    queryTimeoutMs = 10_000,
    initialDelayMs = 750,
  }: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    queryTimeoutMs?: number;
    initialDelayMs?: number;
  } = {}) {
    const deadline = now() + timeoutMs;
    let unavailableSamples = 0;
    let seenSamples = 0;
    let previousStartPids = new Set<string>();
    if (initialDelayMs > 0) {
      await sleep(Math.min(initialDelayMs, Math.max(0, deadline - now())));
    }
    while (now() <= deadline) {
      try {
        const remainingMs = Math.max(1, deadline - now());
        const processes = await matchingProcesses(
          Math.min(queryTimeoutMs, remainingMs)
        );
        if (processes.length > 0) {
          const currentPids = new Set(processes.map(process => process.pid));
          const continuingPids = processes
            .map(process => process.pid)
            .filter(pid => previousStartPids.has(pid));
          if (
            options.pinProcessIdsOnStart &&
            seenSamples > 0 &&
            continuingPids.length === 0
          ) {
            seenSamples = 0;
          }
          if (
            options.exitOnWindowClose &&
            options.getWindowState &&
            (await options.getWindowState())
          ) {
            sawApplicationWindow = true;
          }
          if (seenSamples === 0) startedAt = now();
          seenSamples++;
          // Require two observations so a short-lived helper process cannot
          // make the launcher restore patches while the game is starting.
          if (seenSamples >= 2) {
            if (options.pinProcessIdsOnStart) {
              startedProcessIds = new Set(continuingPids);
            }
            await writeLog(
              `Game process detected: ${target} (${processes
                .map(process => process.pid)
                .join(", ")})`
            );
            return "started" as const;
          }
          previousStartPids = currentPids;
        } else {
          seenSamples = 0;
          previousStartPids.clear();
        }
        unavailableSamples = 0;
      } catch (error) {
        unavailableSamples++;
        await writeLog(
          `Game process monitor query failed (${unavailableSamples}): ${String(
            error
          )}`
        );
        if (unavailableSamples >= 3) return "unknown" as const;
      }
      if (now() >= deadline) break;
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
    }
    return "timed-out" as const;
  }

  async function waitForExit({
    missingSamples = 3,
    pollIntervalMs = 1_000,
    crashThresholdMs = 5_000,
    queryTimeoutMs = 10_000,
    missingWindowSamples = 3,
    missingWindowGraceMs = 2_000,
  }: {
    missingSamples?: number;
    pollIntervalMs?: number;
    crashThresholdMs?: number;
    queryTimeoutMs?: number;
    missingWindowSamples?: number;
    missingWindowGraceMs?: number;
  } = {}) {
    if (options.pinProcessIdsOnStart && !startedProcessIds) {
      await writeLog(`Game process identity was not established: ${target}`);
      return "unknown" as const;
    }
    let missing = 0;
    let unavailable = 0;
    let firstMissingAt: number | undefined;
    let missingWindow = 0;
    let firstMissingWindowAt: number | undefined;
    while (missing < missingSamples) {
      try {
        const allProcesses = await matchingProcesses(queryTimeoutMs);
        const pinnedIds = startedProcessIds;
        const processes = pinnedIds
          ? allProcesses.filter(process => pinnedIds.has(process.pid))
          : allProcesses;
        if (pinnedIds && allProcesses.length > 0 && processes.length === 0) {
          await writeLog(
            `Game process identity changed while waiting for exit: ${target}`
          );
          return "unknown" as const;
        }
        unavailable = 0;
        if (processes.length === 0) {
          if (missing === 0) firstMissingAt = now();
          missing++;
        } else {
          missing = 0;
          firstMissingAt = undefined;
          const hasWindow = options.exitOnWindowClose
            ? await options.getWindowState?.()
            : undefined;
          if (hasWindow === true) {
            sawApplicationWindow = true;
            missingWindow = 0;
            firstMissingWindowAt = undefined;
          } else if (hasWindow === false && sawApplicationWindow) {
            if (missingWindow === 0) firstMissingWindowAt = now();
            missingWindow++;
            const missingFor = Math.max(
              0,
              now() - (firstMissingWindowAt ?? now())
            );
            if (
              missingWindow >= missingWindowSamples &&
              missingFor >= missingWindowGraceMs
            ) {
              await writeLog(
                `Game application window closed while process remains: ${target}`
              );
              await options.onWindowClosed?.();
              firstMissingAt = firstMissingWindowAt;
              break;
            }
          } else if (hasWindow == undefined) {
            missingWindow = 0;
            firstMissingWindowAt = undefined;
          }
        }
      } catch (error) {
        unavailable++;
        await writeLog(
          `Game process monitor query failed while waiting for exit (${unavailable}): ${String(
            error
          )}`
        );
        // Unknown is never treated as exited. A failed ps query cannot prove
        // that the game process has disappeared.
        if (unavailable >= 3) return "unknown" as const;
      }
      if (missing < missingSamples) await sleep(pollIntervalMs);
    }
    const runningDurationMs =
      startedAt == undefined || firstMissingAt == undefined
        ? undefined
        : Math.max(0, firstMissingAt - startedAt);
    if (
      runningDurationMs != undefined &&
      runningDurationMs < crashThresholdMs
    ) {
      await writeLog(
        `Game process crashed: ${target} (ran for ${runningDurationMs}ms)`
      );
      return "crashed" as const;
    }
    await writeLog(`Game process exited: ${target}`);
    return "exited" as const;
  }

  return {
    listProcesses,
    isRunning,
    waitForStart,
    waitForExit,
  };
}

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
    return (await matchingProcesses()).length > 0;
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
          if (options.getWindowState && (await options.getWindowState())) {
            sawApplicationWindow = true;
          }
          if (seenSamples === 0) startedAt = now();
          seenSamples++;
          // Require two observations so a short-lived helper process cannot
          // make the launcher restore patches while the game is starting.
          if (seenSamples >= 2) {
            await writeLog(
              `Game process detected: ${target} (${processes
                .map(process => process.pid)
                .join(", ")})`
            );
            return "started" as const;
          }
        } else {
          seenSamples = 0;
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
    let missing = 0;
    let unavailable = 0;
    let firstMissingAt: number | undefined;
    let missingWindow = 0;
    let firstMissingWindowAt: number | undefined;
    while (missing < missingSamples) {
      try {
        const processes = await matchingProcesses(queryTimeoutMs);
        unavailable = 0;
        if (processes.length === 0) {
          if (missing === 0) firstMissingAt = now();
          missing++;
        } else {
          missing = 0;
          firstMissingAt = undefined;
          const hasWindow = await options.getWindowState?.();
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
        // Unknown is never treated as exited. This protects a running game
        // when both tasklist and the fallback process source are unavailable.
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

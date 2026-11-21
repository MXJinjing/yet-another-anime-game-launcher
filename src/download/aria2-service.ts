import {
  createAria2Retry,
  type Aria2,
  type Aria2Endpoint,
} from "../integrations/aria2";
import { log } from "../logging/logger";
import { appendFile } from "../platform/neutralino/filesystem";
import { resolve } from "../platform/neutralino/path";
import { resolveSidecarPath } from "../platform/neutralino/sidecar";
import { rawString } from "../platform/shell/command-builder";
import { exec, spawn } from "../runtime/command-runner";
import { addTerminationHook } from "../runtime/lifecycle";
import { timeout } from "../runtime/async";
import { DownloadFailedError } from "./control";

export type Aria2ServiceOptions = {
  port?: number;
  sessionPath?: string;
  binaryPath?: string;
  startupTimeoutMs?: number;
};

/**
 * The local download service could not be started or reconnected.
 *
 * It extends `DownloadFailedError` so task orchestration reports it as an
 * ordinary failed download: only that task stops, the launcher keeps running
 * (installed games do not need aria2).
 */
export class DownloadServiceUnavailableError extends DownloadFailedError {
  constructor(message = "Download service is unavailable", cause?: unknown) {
    super(message);
    this.name = "DownloadServiceUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

// Keep aria2 and Sophon in disjoint pools so their first random choices can
// never collide within the same launcher instance.
const PORT_MIN = 40000;
const PORT_MAX = 49999;
const ATTEMPT_TIMEOUT_MS = 3000;

/** Starts the local aria2 sidecar and owns its shutdown hook. App composition
 * can call this instead of duplicating process lifecycle setup. */
export async function startAria2Service(
  options: Aria2ServiceOptions = {}
): Promise<Aria2> {
  const instanceId = randomHex(8);
  const configuredPort = options.port;
  const sessionPath = resolve(
    options.sessionPath ?? `./aria2.session.${instanceId}`
  );
  const binaryPath =
    options.binaryPath ?? (await resolveSidecarPath("aria2/aria2c"));
  const startupTimeoutMs = options.startupTimeoutMs ?? 15000;
  await appendFile(sessionPath, "");

  // Tracks the most recently spawned aria2 so the shutdown hook always targets
  // the live process even if a failed start attempt is retried or reconnected.
  let aria2Pid: number | undefined;
  addTerminationHook(async () => {
    const pid = aria2Pid;
    if (pid == null) return true;
    aria2Pid = undefined;
    await log(`killing process ${pid}`);
    try {
      await exec(["kill", String(pid)]);
    } catch {
      await log("killing process failed?");
    }
    return true;
  });

  async function spawnAria2Setup(): Promise<{
    port: number;
    secret: string;
    pid: number;
  }> {
    const port = configuredPort ?? randomPort();
    const secret = randomHex(16);
    const parentPid = (await exec(["echo", rawString("$PPID")])).stdOut.split(
      "\n"
    )[0];
    const { pid } = await spawn([
      binaryPath,
      "-d",
      "/",
      "--no-conf",
      "--max-concurrent-downloads=1",
      "--enable-rpc",
      `--rpc-listen-port=${port}`,
      "--rpc-listen-all=true",
      "--rpc-allow-origin-all",
      "--rpc-secret",
      secret,
      "--input-file",
      sessionPath,
      "--save-session",
      sessionPath,
      "--pause",
      "true",
      "--stop-with-process",
      parentPid,
    ]);
    aria2Pid = pid;
    return { port, secret, pid };
  }

  async function killProcess(pid: number) {
    try {
      await exec(["kill", String(pid)]);
    } catch {
      // The process already exited (e.g. it failed to bind the port).
    }
  }

  // Mid-download RPC loss recovery: kill the stale process and start a fresh
  // one on a new port. `createAria2` retries this callback once, so a single
  // transient failure cannot fail the download.
  async function reconnectAria2(): Promise<Aria2Endpoint> {
    const stalePid = aria2Pid;
    if (stalePid != null) {
      aria2Pid = undefined;
      await killProcess(stalePid);
    }
    const { port, secret } = await spawnAria2Setup();
    return { host: "127.0.0.1", port, secret };
  }

  // Each launcher owns an authenticated aria2 instance. A secret prevents a
  // failed bind from accidentally connecting to another launcher's RPC server.
  const deadline = Date.now() + startupTimeoutMs;
  let lastError: unknown = new Error("aria2 did not start");
  while (Date.now() < deadline) {
    let attempt: { port: number; secret: string; pid: number };
    try {
      attempt = await spawnAria2Setup();
    } catch (error) {
      // A missing/non-executable sidecar will not appear by waiting, so fail
      // fast with the same typed error the app degrades on.
      throw new DownloadServiceUnavailableError(
        `Failed to launch the download service: ${String(error)}`,
        error
      );
    }
    try {
      const aria2 = await Promise.race([
        createAria2Retry({
          host: "127.0.0.1",
          port: attempt.port,
          secret: attempt.secret,
          reconnect: reconnectAria2,
        }),
        timeout(
          Math.min(ATTEMPT_TIMEOUT_MS, Math.max(500, deadline - Date.now()))
        ),
      ]);
      await log(`Launched aria2 version ${aria2.version.version}`);
      return aria2;
    } catch (error) {
      lastError = error;
      await log(`aria2 startup failed (${String(error)}); retrying`);
      await killProcess(attempt.pid);
    }
  }
  await log(
    `aria2 failed to start within ${startupTimeoutMs}ms: ${String(lastError)}`
  );
  throw new DownloadServiceUnavailableError(
    "Failed to start download service. Please restart the application.",
    lastError
  );
}

/**
 * A stand-in used when aria2 could not start. Version/shutdown are harmless so
 * callers can still construct Wine and the launcher; every download attempt
 * fails with `DownloadServiceUnavailableError`, which the task runner already
 * reports without exiting.
 */
export function createUnavailableAria2(reason?: string): Aria2 {
  return {
    version: { version: "unavailable", enabledFeatures: [] },
    shutdown: async () => "",
    async *doStreamingDownload() {
      throw new DownloadServiceUnavailableError(
        reason ?? "Download service is unavailable"
      );
    },
  };
}

function randomPort(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return PORT_MIN + (values[0] % (PORT_MAX - PORT_MIN + 1));
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(16).padStart(2, "0")).join(
    ""
  );
}

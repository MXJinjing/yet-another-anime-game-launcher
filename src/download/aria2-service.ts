import { createAria2Retry, type Aria2 } from "../integrations/aria2";
import { log } from "../logging/logger";
import { appendFile } from "../platform/neutralino/filesystem";
import { resolve } from "../platform/neutralino/path";
import { resolveSidecarPath } from "../platform/neutralino/sidecar";
import { rawString } from "../platform/shell/command-builder";
import { exec, spawn } from "../runtime/command-runner";
import { addTerminationHook } from "../runtime/lifecycle";
import { timeout } from "../runtime/async";

export type Aria2ServiceOptions = {
  port?: number;
  sessionPath?: string;
  binaryPath?: string;
  startupTimeoutMs?: number;
};

const DEFAULT_PORT = 6868;
const ATTEMPT_TIMEOUT_MS = 3000;

/** Starts the local aria2 sidecar and owns its shutdown hook. App composition
 * can call this instead of duplicating process lifecycle setup. */
export async function startAria2Service(
  options: Aria2ServiceOptions = {}
): Promise<Aria2> {
  const port = options.port ?? DEFAULT_PORT;
  const sessionPath = resolve(options.sessionPath ?? "./aria2.session");
  const binaryPath =
    options.binaryPath ?? (await resolveSidecarPath("aria2/aria2c"));
  const startupTimeoutMs = options.startupTimeoutMs ?? 15000;
  await appendFile(sessionPath, "");

  // Tracks the most recently spawned aria2 so the shutdown hook always targets
  // the live process even if a failed start attempt is retried.
  let aria2Pid: number | undefined;
  addTerminationHook(async () => {
    if (aria2Pid == null) return true;
    await log(`killing process ${aria2Pid}`);
    try {
      await exec(["kill", String(aria2Pid)]);
    } catch {
      await log("killing process failed?");
    }
    return true;
  });

  // After a dev restart (`Neutralino.app.restartProcess()`) or during the
  // production relaunch hand-off, the previous instance's aria2 may still be
  // holding port 6868 for a moment. Retry the spawn + RPC handshake instead
  // of failing the whole boot when the first bind/connect attempt races.
  const deadline = Date.now() + startupTimeoutMs;
  let lastError: unknown = new Error("aria2 did not start");
  while (Date.now() < deadline) {
    const parentPid = (await exec(["echo", rawString("$PPID")])).stdOut.split(
      "\n"
    )[0];
    const { pid } = await spawn([
      binaryPath,
      "-d",
      "/",
      "--no-conf",
      "--enable-rpc",
      `--rpc-listen-port=${port}`,
      "--rpc-listen-all=true",
      "--rpc-allow-origin-all",
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
    try {
      const aria2 = await Promise.race([
        createAria2Retry({ host: "127.0.0.1", port }),
        timeout(
          Math.min(
            ATTEMPT_TIMEOUT_MS,
            Math.max(500, deadline - Date.now())
          )
        ),
      ]);
      await log(`Launched aria2 version ${aria2.version.version}`);
      return aria2;
    } catch (error) {
      lastError = error;
      await log(`aria2 startup failed (${String(error)}); retrying`);
      try {
        await exec(["kill", String(pid)]);
      } catch {
        // The process already exited (e.g. it failed to bind the port).
      }
    }
  }
  await log(
    `aria2 failed to start within ${startupTimeoutMs}ms: ${String(lastError)}`
  );
  throw new Error(
    "Failed to start download service. Please restart the application."
  );
}

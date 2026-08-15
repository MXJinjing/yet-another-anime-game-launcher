import { createAria2Retry, type Aria2 } from "../integrations/aria2";
import { log } from "../logging/logger";
import { appendFile } from "../platform/neutralino/filesystem";
import { resolve } from "../platform/neutralino/path";
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

/** Starts the local aria2 sidecar and owns its shutdown hook. App composition
 * can call this instead of duplicating process lifecycle setup. */
export async function startAria2Service(
  options: Aria2ServiceOptions = {}
): Promise<Aria2> {
  const port = options.port ?? 6868;
  const sessionPath = resolve(options.sessionPath ?? "./aria2.session");
  await appendFile(sessionPath, "");
  const parentPid = (await exec(["echo", rawString("$PPID")])).stdOut.split(
    "\n"
  )[0];
  const { pid } = await spawn([
    options.binaryPath ?? "./sidecar/aria2/aria2c",
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
  addTerminationHook(async () => {
    await log(`killing process ${pid}`);
    try {
      await exec(["kill", String(pid)]);
    } catch {
      await log("killing process failed?");
    }
    return true;
  });
  const aria2 = await Promise.race([
    createAria2Retry({ host: "127.0.0.1", port }),
    timeout(options.startupTimeoutMs ?? 15000),
  ]).catch(() =>
    Promise.reject(
      new Error(
        "Failed to start download service. Please restart the application."
      )
    )
  );
  await log(`Launched aria2 version ${aria2.version.version}`);
  return aria2;
}

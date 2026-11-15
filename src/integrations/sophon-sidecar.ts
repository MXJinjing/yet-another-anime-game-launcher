import { log } from "../logging/logger";
import { spawnProcess, updateSpawnedProcess } from "../platform/neutralino";
import { resolveSidecarPath } from "../platform/neutralino/sidecar";
import { build, rawString } from "../platform/shell";
import { exec } from "../runtime/command-runner";
import { resolve } from "../platform/neutralino/path";
import { readSophonSettings } from "./sophon-settings";
import { SophonClient, type SophonRegion } from "./sophon";

const host = "127.0.0.1";
const healthOptions = { logFailures: false, timeoutMs: 500 };
type SidecarEndpoint = { id: number; port: number; token: string };
let sidecar: SidecarEndpoint | undefined;
let connecting: Promise<SidecarEndpoint> | undefined;

async function startSidecar(): Promise<SidecarEndpoint> {
  const { debugLogging } = await readSophonSettings();
  const binary = await resolveSidecarPath("sophon-swift/SophonCLI");
  const parent = (await exec(["echo", rawString("$PPID")])).stdOut.trim();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port = 50000 + Math.floor(Math.random() * 15535);
    const { id, pid } = await spawnProcess(
      build([
        "exec",
        binary,
        "rpc",
        "--transport",
        "http",
        "--port",
        String(port),
        "--token",
        token,
        "--allow-origin",
        window.location.origin,
        ...(debugLogging
          ? ["--log-file", resolve("sophon.log"), "--log-level", "debug"]
          : []),
        "--parent-pid",
        parent,
      ])
    );
    const client = new SophonClient(host, port, "os", token);
    for (let attempt = 0; attempt < 10 && Date.now() < deadline; attempt++) {
      if (await client.healthCheck(healthOptions)) {
        return { id, port, token };
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await exec(["kill", String(pid)]).catch(() => undefined);
  }
  throw new Error("Failed to start the Swift Sophon sidecar");
}

async function connectSidecar() {
  if (sidecar) {
    const { id, port, token } = sidecar;
    const client = new SophonClient(host, port, "os", token);
    if (await client.healthCheck({ ...healthOptions, timeoutMs: 2000 })) {
      return sidecar;
    }
    sidecar = undefined;
    await updateSpawnedProcess(id, "exit").catch(() => undefined);
  }
  sidecar = await startSidecar();
  return sidecar;
}

export async function getSophonClient(region: SophonRegion) {
  connecting ??= connectSidecar()
    .catch(error => {
      void log(String(error));
      throw error;
    })
    .finally(() => {
      connecting = undefined;
    });
  const { port, token } = await connecting;
  return new SophonClient(host, port, region, token);
}

import { log } from "../logging/logger";
import { spawnProcess } from "../platform/neutralino";
import { resolveSidecarPath } from "../platform/neutralino/sidecar";
import { build, rawString } from "../platform/shell";
import { exec } from "../runtime/command-runner";
import { SophonClient, type SophonRegion } from "./sophon";

const host = "127.0.0.1";
let sidecar: Promise<{ port: number; token: string }> | undefined;

async function startSidecar() {
  const binary = await resolveSidecarPath("sophon-swift/SophonCLI");
  const parent = (await exec(["echo", rawString("$PPID")])).stdOut.trim();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port = 50000 + Math.floor(Math.random() * 15535);
    const { pid } = await spawnProcess(
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
        "--parent-pid",
        parent,
      ])
    );
    const client = new SophonClient(host, port, "os", token);
    for (let attempt = 0; attempt < 10 && Date.now() < deadline; attempt++) {
      if (await client.healthCheck({ logFailures: false, timeoutMs: 500 })) {
        return { port, token };
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await exec(["kill", String(pid)]).catch(() => undefined);
  }
  throw new Error("Failed to start the Swift Sophon sidecar");
}

export async function getSophonClient(region: SophonRegion) {
  sidecar ??= startSidecar().catch(error => {
    sidecar = undefined;
    void log(String(error));
    throw error;
  });
  const { port, token } = await sidecar;
  return new SophonClient(host, port, region, token);
}

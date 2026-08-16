import { resolve } from "../../platform/neutralino";
import { resolveSidecarPath } from "../../platform/neutralino/sidecar";
import { exec } from "../command-runner";

export async function md5(path: string): Promise<string> {
  const result = await exec(["md5", "-q", resolve(path)]);
  return result.stdOut.split("\n")[0];
}

export async function xdelta3(
  originalFile: string,
  patchFile: string,
  targetFile: string
) {
  return exec([
    await resolveSidecarPath("xdelta/xdelta3"),
    "-d",
    "-s",
    originalFile,
    patchFile,
    targetFile,
  ]);
}

export async function hpatchz(
  originalFile: string,
  patchFile: string,
  targetFile: string
) {
  return exec([
    await resolveSidecarPath("hpatchz/hpatchz"),
    "-f",
    originalFile,
    patchFile,
    targetFile,
  ]);
}

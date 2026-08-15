import { resolve } from "../../platform/neutralino";
import { exec } from "../command-runner";

export async function md5(path: string): Promise<string> {
  const result = await exec(["md5", "-q", resolve(path)]);
  return result.stdOut.split("\n")[0];
}

export function xdelta3(
  originalFile: string,
  patchFile: string,
  targetFile: string
) {
  return exec([
    resolve("./sidecar/xdelta/xdelta3"),
    "-d",
    "-s",
    originalFile,
    patchFile,
    targetFile,
  ]);
}

export function hpatchz(
  originalFile: string,
  patchFile: string,
  targetFile: string
) {
  return exec([
    resolve("./sidecar/hpatchz/hpatchz"),
    "-f",
    originalFile,
    patchFile,
    targetFile,
  ]);
}

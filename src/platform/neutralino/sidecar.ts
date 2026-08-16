import { getRuntimeArch } from "./arch";
import { resolve } from "./path";

export async function resolveSidecarPath(relativePath: string) {
  const arch = await getRuntimeArch();
  return resolve(`./sidecar/${arch}/${relativePath}`);
}

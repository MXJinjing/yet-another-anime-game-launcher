import { getRuntimeArch } from "./arch";
import { resolveResource } from "./path";

export async function resolveSidecarPath(relativePath: string) {
  const arch = await getRuntimeArch();
  return resolveResource(`./sidecar/${arch}/${relativePath}`);
}

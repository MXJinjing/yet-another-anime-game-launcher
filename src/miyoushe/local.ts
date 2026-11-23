import {
  resolve,
  resolveResource,
  readFile,
  writeFile,
  removeFileIfExists,
} from "@platform/neutralino";
import { build } from "@platform/shell";
import type { AccountBridge } from "./account";
import { exportUigf, parseUigf, type GachaArchive } from "./uigf";

const archivePath = "miyoushe-uigf-v4.2.json";

export const usingMiyoushePrototype =
  import.meta.env.MODE === "development" &&
  import.meta.env.YAAGL_MIYOUSHE_PROTOTYPE === "1";

export const runMiyoushePrototype: AccountBridge = async (
  action,
  args = []
) => {
  try {
    const helper = resolveResource("sidecar/miyoushe-prototype");
    const result = await Neutralino.os.execCommand(
      build([helper, resolve(archivePath), action, ...args]),
      {}
    );
    if (result.exitCode !== 0) return { state: "unavailable" };
    return JSON.parse(result.stdOut);
  } catch {
    return { state: "unavailable" };
  }
};

export async function readGachaArchive(): Promise<GachaArchive> {
  const entries = await Neutralino.filesystem.readDirectory(resolve("."));
  if (!entries.some(entry => entry.entry === archivePath)) return {};
  return parseUigf(await readFile(archivePath));
}

export async function saveGachaArchive(archive: GachaArchive) {
  const temp = `${archivePath}.${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  try {
    await writeFile(temp, exportUigf(archive));
    // Same-directory rename replaces the archive atomically.
    const result = await Neutralino.os.execCommand(
      build(["/bin/mv", "-f", resolve(temp), resolve(archivePath)]),
      {}
    );
    if (result.exitCode !== 0)
      throw new Error("Could not replace pull archive");
  } finally {
    await removeFileIfExists(temp);
  }
}

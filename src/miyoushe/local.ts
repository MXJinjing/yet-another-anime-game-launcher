import {
  resolve,
  resolveResource,
  readFile,
  writeFile,
  removeFileIfExists,
} from "@platform/neutralino";
import { build } from "@platform/shell";
import type { AccountBridge } from "./account";
import {
  exportUigf,
  mergeGachaArchives,
  parseUigf,
  type GachaArchive,
} from "./uigf";

const archivePath = "miyoushe-uigf-v4.2.json";
const radiancePath = "miyoushe-radiance.json";
let radianceWrite = Promise.resolve();

export async function readRadianceMarks(): Promise<string[]> {
  try {
    const keys: unknown = JSON.parse(await readFile(radiancePath));
    return Array.isArray(keys)
      ? keys.filter(
          (key): key is string =>
            typeof key === "string" && /^\d{1,19}:\d{1,19}$/.test(key)
        )
      : [];
  } catch {
    return [];
  }
}

export function toggleRadianceMark(key: string) {
  const write = radianceWrite.then(async () => {
    const marks = new Set(await readRadianceMarks());
    if (marks.has(key)) marks.delete(key);
    else marks.add(key);
    const updated = [...marks];
    await replaceLocalFile(radiancePath, JSON.stringify(updated));
    return updated;
  });
  radianceWrite = write.then(
    () => undefined,
    () => undefined
  );
  return write;
}

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
  return parseUigf(await readFile(archivePath), true);
}

let archiveWrite = Promise.resolve();

export function mergeLocalArchive(incoming: GachaArchive) {
  const write = archiveWrite.then(async () => {
    const merged = mergeGachaArchives(await readGachaArchive(), incoming);
    await replaceLocalFile(archivePath, exportUigf(merged, true));
    return merged;
  });
  archiveWrite = write.then(
    () => undefined,
    () => undefined
  );
  return write;
}

export async function replaceLocalFile(path: string, contents: string) {
  const temp = `${path}.${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  try {
    await writeFile(temp, contents);
    // Same-directory rename replaces the archive atomically.
    const result = await Neutralino.os.execCommand(
      build(["/bin/mv", "-f", resolve(temp), resolve(path)]),
      {}
    );
    if (result.exitCode !== 0) throw new Error("Could not replace local data");
  } finally {
    await removeFileIfExists(temp);
  }
}

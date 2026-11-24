import {
  resolve,
  readFile,
  writeFile,
  removeFileIfExists,
} from "@platform/neutralino";
import { build } from "@platform/shell";
import type { PullGame } from "./games";
import {
  exportUigf,
  mergeGachaArchives,
  parseUigf,
  type GachaArchive,
} from "./uigf";

const archivePath = "pull-analysis-uigf-v4.2.json";
const radiancePath = "pull-analysis-radiance.json";
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

function updateRadianceMarks(update: (marks: Set<string>) => boolean) {
  const write = radianceWrite.then(async () => {
    const marks = new Set(await readRadianceMarks());
    const changed = update(marks);
    const updated = [...marks];
    if (changed) await replaceLocalFile(radiancePath, JSON.stringify(updated));
    return updated;
  });
  radianceWrite = write.then(
    () => undefined,
    () => undefined
  );
  return write;
}

export function toggleRadianceMark(key: string) {
  return updateRadianceMarks(marks => {
    if (!marks.delete(key)) marks.add(key);
    return true;
  });
}

export function removeRadianceMarks(uid: string) {
  return updateRadianceMarks(marks => {
    const count = marks.size;
    for (const mark of marks) {
      if (mark.startsWith(`${uid}:`)) marks.delete(mark);
    }
    return marks.size !== count;
  });
}

export async function readGachaArchive(): Promise<GachaArchive> {
  const entries = await Neutralino.filesystem.readDirectory(resolve("."));
  if (!entries.some(entry => entry.entry === archivePath)) return {};
  return parseUigf(await readFile(archivePath), true);
}

let archiveWrite = Promise.resolve();

function updateLocalArchive(update: (current: GachaArchive) => GachaArchive) {
  const write = archiveWrite.then(async () => {
    const current = await readGachaArchive();
    const updated = update(current);
    if (updated !== current)
      await replaceLocalFile(archivePath, exportUigf(updated, true));
    return updated;
  });
  archiveWrite = write.then(
    () => undefined,
    () => undefined
  );
  return write;
}

export function mergeLocalArchive(incoming: GachaArchive) {
  return updateLocalArchive(current => {
    const updatedAt = Date.now();
    const updated = Object.fromEntries(
      Object.entries(incoming).map(([game, accounts]) => [
        game,
        accounts.map(account => ({ ...account, updatedAt })),
      ])
    );
    return mergeGachaArchives(current, updated);
  });
}

export function removeLocalPullAccount(game: PullGame, uid: string) {
  return updateLocalArchive(current => {
    const accounts = current[game];
    if (!accounts?.some(account => account.uid === uid)) return current;
    const remaining = accounts.filter(account => account.uid !== uid);
    const updated = { ...current };
    if (remaining.length) updated[game] = remaining;
    else delete updated[game];
    return updated;
  });
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

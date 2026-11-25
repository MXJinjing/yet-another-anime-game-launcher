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

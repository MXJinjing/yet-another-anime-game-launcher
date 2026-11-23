import {
  resolve,
  resolveResource,
  readFile,
  writeFile,
  removeFileIfExists,
  onSpawnedProcess,
  offSpawnedProcess,
  spawnProcess,
  updateSpawnedProcess,
} from "@platform/neutralino";
import { build } from "@platform/shell";
import type { MiyousheGame } from "./games";
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

export const usingMiyoushePrototype =
  import.meta.env.MODE === "development" &&
  import.meta.env.YAAGL_MIYOUSHE_PROTOTYPE === "1";

const helperUnavailable = { state: "unavailable" } as const;

export type RequestMiyousheHelper = <T>(
  action: string,
  args?: readonly string[],
  stdIn?: string
) => Promise<T | typeof helperUnavailable>;

export function createMiyousheSessionHelper(onClose: () => void) {
  let id: number | undefined;
  let closed = false;
  let watching = false;
  let output = "";
  let receive: ((reply: object) => void) | undefined;
  let pending = Promise.resolve();

  function close() {
    if (closed) return;
    closed = true;
    receive?.(helperUnavailable);
    if (watching) void offSpawnedProcess(handleEvent).catch(() => undefined);
    if (id !== undefined)
      void updateSpawnedProcess(id, "exit").catch(() => undefined);
    onClose();
  }

  const handleEvent: Neutralino.events.Handler<
    Neutralino.os.SpawnProcessResult
  > = event => {
    if (!event || closed || id === undefined || event.detail.id !== id) return;
    if (event.detail.action === "exit") close();
    if (event.detail.action !== "stdOut" || !receive) return;
    output += event.detail.data;
    try {
      const newline = output.indexOf("\n");
      if (newline === -1) return;
      const reply = JSON.parse(output.slice(0, newline));
      if (typeof reply?.state !== "string") throw new Error("Invalid reply");
      receive(reply);
    } catch {
      close();
    }
  };

  async function start() {
    await onSpawnedProcess(handleEvent);
    if (closed) {
      await offSpawnedProcess(handleEvent);
      return;
    }
    watching = true;
    id = (
      await spawnProcess(
        build([
          "exec",
          resolveResource("sidecar/miyoushe-prototype"),
          "session",
        ])
      )
    ).id;
    if (closed) await updateSpawnedProcess(id, "exit");
  }

  function request<T>(
    action: string,
    args: readonly string[] = [],
    input?: string
  ) {
    const result = pending.then(async () => {
      if (closed) return helperUnavailable;
      try {
        if (id === undefined) await start();
        if (closed || id === undefined) return helperUnavailable;
        const processId = id;
        return await new Promise<object>(resolve => {
          const timeout = setTimeout(close, 210_000);
          receive = reply => {
            clearTimeout(timeout);
            receive = undefined;
            output = "";
            resolve(reply);
          };
          void updateSpawnedProcess(
            processId,
            "stdIn",
            JSON.stringify({ action, args, input }) + "\n"
          ).catch(close);
        });
      } catch {
        close();
        return helperUnavailable;
      }
    });
    pending = result.then(
      () => undefined,
      () => undefined
    );
    return result as Promise<T | typeof helperUnavailable>;
  }

  return { request, close };
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

export function removeLocalPullAccount(game: MiyousheGame, uid: string) {
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

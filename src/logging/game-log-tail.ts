import { join } from "path-browserify";
import { readFile, stats } from "../platform/neutralino";
import type { GameLogLocation } from "../channel-client";

/**
 * Real-time tail of a game's own text logs inside a Wine prefix or install
 * directory. Each client records its known locations in `src/clients/` so
 * debug mode does not assume that every game uses Unity's output_log.txt.
 */

export type GameLogLineHandler = (line: string) => void;
/** @deprecated Use GameLogLineHandler. Kept for callers of the old helper. */
export type UnityLogLineHandler = GameLogLineHandler;

const DEFAULT_POLL_INTERVAL_MS = 800;
const DEFAULT_PATH_SCAN_INTERVAL_MS = 5000;
const DEFAULT_MAX_LINES_PER_POLL = 200;
const DEFAULT_LOOKBACK_LINES = 40;
const MAX_RECURSIVE_DEPTH = 6;

type TailState = {
  /** Character offset of the last consumed position (JS string length). */
  offset: number;
  /** Byte size seen at the last poll, used only to skip unchanged files. */
  lastBytes: number;
  /** First characters of the file at the last poll (replacement detection). */
  fingerprint: string;
  /** Whether the file's history has already been seeded into the viewer. */
  seeded: boolean;
  /** Trailing partial line waiting for the next chunk. */
  pending: string;
};

function hasAllowedExtension(path: string, extensions?: readonly string[]) {
  if (!extensions || extensions.length === 0) return true;
  const lowerPath = path.toLowerCase();
  return extensions.some(extension =>
    lowerPath.endsWith(extension.toLowerCase())
  );
}

async function findWineUserDirectories(prefix: string): Promise<string[]> {
  const usersRoot = join(prefix, "drive_c", "users");
  try {
    const entries = await Neutralino.filesystem.readDirectory(usersRoot);
    return entries
      .filter(entry => entry.type === "DIRECTORY")
      .map(entry => join(usersRoot, entry.entry));
  } catch {
    // The users directory may not exist yet (fresh prefix).
    return [];
  }
}

async function findRecursiveLogFiles(
  root: string,
  extensions: readonly string[] | undefined,
  depth = 0
): Promise<string[]> {
  if (depth > MAX_RECURSIVE_DEPTH) return [];

  let entries;
  try {
    entries = await Neutralino.filesystem.readDirectory(root);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.entry);
    if (entry.type === "DIRECTORY") {
      found.push(...(await findRecursiveLogFiles(path, extensions, depth + 1)));
    } else if (hasAllowedExtension(path, extensions)) {
      found.push(path);
    }
  }
  return found;
}

async function findLegacyUnityLogFiles(prefix: string): Promise<string[]> {
  const users = await findWineUserDirectories(prefix);
  const found: string[] = [];
  for (const user of users) {
    found.push(
      ...(await findRecursiveLogFiles(user, ["output_log.txt"], 0))
    );
  }
  return found;
}

export async function findGameLogFiles({
  prefix,
  gameDir,
  locations,
  existingOnly = false,
}: {
  prefix: string;
  gameDir: string;
  locations: readonly GameLogLocation[];
  existingOnly?: boolean;
}): Promise<string[]> {
  const users = await findWineUserDirectories(prefix);
  const found: string[] = [];

  for (const location of locations) {
    const roots =
      location.root === "wine-user"
        ? users
        : [location.root === "game-install" ? gameDir : prefix];
    for (const root of roots) {
      if (!root) continue;
      const path = join(root, location.path);
      if (location.recursive) {
        found.push(
          ...(await findRecursiveLogFiles(path, location.extensions, 0))
        );
      } else if (existingOnly) {
        try {
          if ((await stats(path)).isFile) found.push(path);
        } catch {
          // The game may create this file after the next poll.
        }
      } else {
        // Keep configured paths even before the file exists. This allows the
        // tailer to observe a log created after debug mode has started.
        found.push(path);
      }
    }
  }

  return [...new Set(found)];
}

export function createGameLogTail(options: {
  prefix: string;
  gameDir?: string;
  locations?: readonly GameLogLocation[];
  onLine: GameLogLineHandler;
  pollIntervalMs?: number;
  maxLinesPerPoll?: number;
  lookbackLines?: number;
}): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxLinesPerPoll = options.maxLinesPerPoll ?? DEFAULT_MAX_LINES_PER_POLL;
  const lookbackLines = options.lookbackLines ?? DEFAULT_LOOKBACK_LINES;
  const locations = options.locations ?? [];

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let paths: string[] = [];
  let lastPathScan = 0;
  const states = new Map<string, TailState>();

  function emit(lines: string[]) {
    for (const line of lines) {
      if (stopped) return;
      // Wine logs may use CRLF; strip the trailing CR for clean output.
      options.onLine(line.replace(/\r$/, ""));
    }
  }

  async function pollFile(path: string) {
    let stat;
    try {
      stat = await stats(path);
    } catch {
      return; // file not available (yet)
    }

    let state = states.get(path);
    if (!state) {
      state = {
        offset: 0,
        lastBytes: -1,
        fingerprint: "",
        seeded: false,
        pending: "",
      };
      states.set(path, state);
    }

    // Many games rewrite their log file on every launch.
    if (stat.size < state.lastBytes) {
      state.offset = 0;
      state.lastBytes = -1;
      state.fingerprint = "";
      state.pending = "";
      state.seeded = false;
    }
    if (stat.size === state.lastBytes && state.seeded) return;
    state.lastBytes = stat.size;

    let text: string;
    try {
      text = await readFile(path);
    } catch {
      return;
    }

    if (text.length < state.offset) {
      // Same as above but detected through the character length.
      state.offset = 0;
      state.fingerprint = "";
      state.pending = "";
      state.seeded = false;
    } else if (state.offset > 0) {
      // The file can be replaced between polls without shrinking first
      // (same-size or larger rewrite). Compare the head of the file to catch
      // that and restart cleanly instead of emitting a garbled slice.
      const head = text.slice(0, 64);
      if (state.fingerprint === "" || head !== state.fingerprint) {
        state.offset = 0;
        state.fingerprint = head;
        state.pending = "";
        state.seeded = false;
      }
    }

    if (!state.seeded) {
      // Seed the viewer with recent history so it is not empty on connect.
      const recent = text.split("\n").filter(line => line.length > 0);
      state.offset = text.length;
      state.fingerprint = text.slice(0, 64);
      state.seeded = true;
      if (recent.length > 0) {
        emit(recent.slice(-lookbackLines));
      }
      return;
    }

    const slice = text.slice(state.offset);
    state.offset = text.length;
    state.pending += slice;
    const parts = state.pending.split("\n");
    state.pending = parts.pop() ?? "";
    if (parts.length === 0) return;

    const lines = parts.filter(line => line.length > 0);
    if (lines.length === 0) return;
    if (lines.length > maxLinesPerPoll) {
      emit([
        `... ${lines.length - maxLinesPerPoll} more log lines truncated ...`,
      ]);
      emit(lines.slice(-maxLinesPerPoll));
    } else {
      emit(lines);
    }
  }

  async function refreshPaths() {
    const discovered =
      locations.length > 0
        ? await findGameLogFiles({
            prefix: options.prefix,
            gameDir: options.gameDir ?? "",
            locations,
          })
        : await findLegacyUnityLogFiles(options.prefix);
    paths = [...new Set([...paths, ...discovered])];
    lastPathScan = Date.now();
  }

  async function poll() {
    if (stopped) return;
    try {
      if (
        paths.length === 0 ||
        Date.now() - lastPathScan >= DEFAULT_PATH_SCAN_INTERVAL_MS
      ) {
        await refreshPaths();
      }
      for (const path of paths) {
        if (stopped) return;
        await pollFile(path);
      }
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void poll(), pollIntervalMs);
      }
    }
  }

  void poll();

  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/**
 * Wait for the configured game log and open it with macOS's default app.
 * This intentionally does not use the launcher logger or runtime-log store.
 */
export function openGameLogFile(options: {
  prefix: string;
  gameDir?: string;
  locations?: readonly GameLogLocation[];
  pollIntervalMs?: number;
}): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const locations = options.locations ?? [];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll() {
    if (stopped) return;
    const paths =
      locations.length > 0
        ? await findGameLogFiles({
            prefix: options.prefix,
            gameDir: options.gameDir ?? "",
            locations,
            existingOnly: true,
          })
        : await findLegacyUnityLogFiles(options.prefix);
    const path = paths[0];
    if (path) {
      try {
        await Neutralino.os.open(`file://${encodeURI(path)}`);
      } catch {
        // Opening the file is best-effort; do not add an entry to launcher log.
      }
      return;
    }
    if (!stopped) timer = setTimeout(() => void poll(), pollIntervalMs);
  }

  void poll();

  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/** @deprecated Use createGameLogTail. */
export const createUnityLogTail = createGameLogTail;

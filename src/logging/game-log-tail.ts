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
  /** Byte size seen when the file was last read successfully. */
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
    } else if (entry.type === "FILE" && hasAllowedExtension(path, extensions)) {
      found.push(path);
    }
  }
  return found;
}

export async function findGameLogFiles({
  prefix,
  gameDir,
  locations,
}: {
  prefix: string;
  gameDir: string;
  locations: readonly GameLogLocation[];
}): Promise<string[]> {
  const users = locations.some(location => location.root === "wine-user")
    ? await findWineUserDirectories(prefix)
    : [];
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
      } else {
        try {
          if ((await stats(path)).isFile) found.push(path);
        } catch {
          // The next discovery pass can pick up files created after launch.
        }
      }
    }
  }

  return [...new Set(found)];
}

type GameLogTarget = {
  prefix: string;
  gameDir?: string;
  locations?: readonly GameLogLocation[];
};

type LogTailOptions = {
  onLine: GameLogLineHandler;
  /** Attribute each emitted line to the file that produced it. */
  onFileLine?: (path: string, line: string) => void;
  /** The combined set of discovered game logs and manually tracked paths. */
  onPaths?: (paths: string[]) => void;
  pollIntervalMs?: number;
  maxLinesPerPoll?: number;
  lookbackLines?: number;
};

export function createLogFileTail(
  options: LogTailOptions & {
    /** Return the same object until a new game session starts. */
    getGameTarget: () => GameLogTarget | undefined;
    /** Absolute paths selected by the user. */
    getManualPaths: () => readonly string[];
  }
): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxLinesPerPoll = options.maxLinesPerPoll ?? DEFAULT_MAX_LINES_PER_POLL;
  const lookbackLines = options.lookbackLines ?? DEFAULT_LOOKBACK_LINES;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gameTarget: GameLogTarget | undefined;
  let publishedTarget: GameLogTarget | undefined | null = null;
  let paths: string[] = [];
  let lastPathScan = 0;
  const autoPaths = new Set<string>();
  const states = new Map<string, TailState>();

  function emit(path: string, lines: string[], isActive: () => boolean) {
    for (const line of lines) {
      if (!isActive()) return;
      // Wine logs may use CRLF; strip the trailing CR for clean output.
      const clean = line.replace(/\r$/, "");
      options.onLine(clean);
      if (isActive()) options.onFileLine?.(path, clean);
    }
  }

  async function pollFile(path: string, isActive: () => boolean) {
    let stat;
    try {
      stat = await stats(path);
    } catch {
      return; // file not available (yet)
    }
    if (!isActive() || !stat.isFile) return;

    let state = states.get(path);
    if (state?.seeded && stat.size === state.lastBytes) return;

    let text: string;
    try {
      text = await readFile(path);
    } catch {
      return;
    }
    if (!isActive()) return;

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

    // Games can truncate or replace their logs between polls. Compare only
    // the known prefix so appending to a short log does not reseed its history.
    if (
      stat.size < state.lastBytes ||
      text.length < state.offset ||
      !text.startsWith(state.fingerprint)
    ) {
      state.offset = 0;
      state.pending = "";
      state.seeded = false;
    }
    state.lastBytes = stat.size;
    state.fingerprint = text.slice(0, 64);

    if (!state.seeded) {
      // Seed the viewer with recent history so it is not empty on connect.
      const recent = text.split("\n").filter(line => line.length > 0);
      state.offset = text.length;
      state.seeded = true;
      if (recent.length > 0) {
        emit(path, recent.slice(-lookbackLines), isActive);
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
      emit(
        path,
        [`... ${lines.length - maxLinesPerPoll} more log lines truncated ...`],
        isActive
      );
      emit(path, lines.slice(-maxLinesPerPoll), isActive);
    } else {
      emit(path, lines, isActive);
    }
  }

  async function poll() {
    if (stopped) return;
    const target = options.getGameTarget();
    const isCurrent = () => !stopped && options.getGameTarget() === target;
    try {
      if (target !== gameTarget) {
        gameTarget = target;
        autoPaths.clear();
        const manualPaths = new Set(options.getManualPaths());
        for (const path of states.keys()) {
          if (!manualPaths.has(path)) states.delete(path);
        }
      }
      if (
        target &&
        (autoPaths.size === 0 ||
          Date.now() - lastPathScan >= DEFAULT_PATH_SCAN_INTERVAL_MS)
      ) {
        const discovered = await findGameLogFiles({
          prefix: target.prefix,
          gameDir: target.gameDir ?? "",
          locations: target.locations ?? [],
        });
        if (!isCurrent()) return;
        for (const path of discovered) autoPaths.add(path);
        lastPathScan = Date.now();
      }

      const tracked = new Set([...autoPaths, ...options.getManualPaths()]);
      for (const path of states.keys()) {
        if (!tracked.has(path)) states.delete(path);
      }
      const next = [...tracked];
      const changed =
        next.length !== paths.length ||
        next.some((path, index) => path !== paths[index]);
      // Consumers may clear automatic paths on a session change, even when
      // the new session ends up discovering the exact same set of files.
      const sessionChanged =
        publishedTarget !== null && publishedTarget !== target;
      paths = next;
      publishedTarget = target;
      if (changed || sessionChanged) options.onPaths?.([...paths]);

      for (const path of paths) {
        if (!isCurrent()) return;
        await pollFile(
          path,
          () =>
            isCurrent() &&
            (autoPaths.has(path) || options.getManualPaths().includes(path))
        );
      }
    } finally {
      if (!stopped) {
        // The target may have changed while filesystem work was in flight.
        timer = setTimeout(() => void poll(), isCurrent() ? pollIntervalMs : 0);
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

export function createGameLogTail(
  options: GameLogTarget & LogTailOptions
): () => void {
  const { prefix, gameDir, locations, ...tailOptions } = options;
  const target = { prefix, gameDir, locations };
  return createLogFileTail({
    ...tailOptions,
    getGameTarget: () => target,
    getManualPaths: () => [],
  });
}

/** @deprecated Use createGameLogTail. */
export const createUnityLogTail = createGameLogTail;

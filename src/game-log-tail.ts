import { join } from "path-browserify";
import { readFile, stats } from "./utils";

/**
 * Real-time tail of the game's Unity log (`output_log.txt`) inside a Wine
 * prefix. Unity writes:
 *
 *   <prefix>/drive_c/users/<user>/AppData/LocalLow/<company>/<product>/output_log.txt
 *
 * The path varies per user/company/product, so we locate all candidates under
 * the prefix's users directory and tail whichever one actually grows (only the
 * running game's log gets appended, so dead candidates simply stay silent).
 *
 * Used by the launcher's "debug mode": when enabled, the game launches and the
 * log viewer opens with this stream feeding it in real time.
 */

export type UnityLogLineHandler = (line: string) => void;

const DEFAULT_POLL_INTERVAL_MS = 800;
const DEFAULT_MAX_LINES_PER_POLL = 200;
const DEFAULT_LOOKBACK_LINES = 40;

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

async function findUnityLogFiles(prefix: string): Promise<string[]> {
  const start = join(prefix, "drive_c", "users");
  const found: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > 6) return;
    let entries;
    try {
      entries = await Neutralino.filesystem.readDirectory(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.entry);
      if (entry.type === "DIRECTORY") {
        await walk(path, depth + 1);
      } else if (entry.entry === "output_log.txt") {
        found.push(path);
      }
    }
  }

  try {
    await walk(start, 0);
  } catch {
    // The users directory may not exist yet (fresh prefix).
  }
  return found;
}

export function createUnityLogTail(options: {
  prefix: string;
  onLine: UnityLogLineHandler;
  pollIntervalMs?: number;
  maxLinesPerPoll?: number;
  lookbackLines?: number;
}): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxLinesPerPoll = options.maxLinesPerPoll ?? DEFAULT_MAX_LINES_PER_POLL;
  const lookbackLines = options.lookbackLines ?? DEFAULT_LOOKBACK_LINES;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let paths: string[] = [];
  const states = new Map<string, TailState>();

  function emit(lines: string[]) {
    for (const line of lines) {
      if (stopped) return;
      // Wine's Unity may write CRLF; strip the trailing CR for clean output.
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

    // The file shrank: Unity rewrites output_log.txt on every launch.
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

  async function poll() {
    if (stopped) return;
    try {
      if (paths.length === 0) {
        paths = await findUnityLogFiles(options.prefix);
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

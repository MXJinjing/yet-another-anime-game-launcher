import {
  consumeLauncherLogText,
  gameTailIdentity,
  parentPidFromArgs,
  parseLogWindowSession,
  posixSignalCommand,
  seedLauncherLog,
  type LogWindowGameTarget,
  type LogWindowSession,
  type ParsedLogLine,
} from "./log-window-protocol";

export interface LogWindowClientDependencies {
  args: readonly string[];
  readSession: () => Promise<string | undefined>;
  exec: (command: string) => Promise<{ exitCode: number }>;
  readFile: (path: string) => Promise<string>;
  stats: (path: string) => Promise<{ size: number }>;
  focus: () => Promise<void>;
  exit: () => Promise<void>;
  onSession: (session: LogWindowSession) => void;
  onLauncherLines: (lines: ParsedLogLine[]) => void;
  onGameReset: () => void;
  startGameTail: (game: LogWindowGameTarget) => () => void;
  pollMs?: number;
  parentMissesBeforeExit?: number;
}

export function createLogWindowClient(deps: LogWindowClientDependencies) {
  const pollMs = deps.pollMs ?? 800;
  const missesBeforeExit = deps.parentMissesBeforeExit ?? 2;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seenNonce = -1;
  let parentMisses = 0;
  let sessionParentPid: number | undefined;
  let launcherPath = "";
  let launcherOffset = 0;
  let launcherPending = "";
  let launcherBytes = -1;
  let launcherSeeded = false;
  let gameKey = "";
  let stopGameTail: (() => void) | undefined;

  async function parentStillAlive() {
    const parentPid = parentPidFromArgs(deps.args) ?? sessionParentPid;
    const command = parentPid ? posixSignalCommand(parentPid, "0") : undefined;
    if (!command) return true;
    try {
      return (await deps.exec(command)).exitCode === 0;
    } catch {
      return false;
    }
  }

  async function pollLauncher(path: string) {
    if (path !== launcherPath) {
      launcherPath = path;
      launcherOffset = 0;
      launcherPending = "";
      launcherBytes = -1;
      launcherSeeded = false;
    }
    let stat: { size: number };
    try {
      stat = await deps.stats(path);
    } catch {
      return;
    }
    if (launcherSeeded && stat.size === launcherBytes) return;
    let text: string;
    try {
      text = await deps.readFile(path);
    } catch {
      return;
    }
    if (
      !launcherSeeded ||
      text.length < launcherOffset ||
      stat.size < launcherBytes
    ) {
      const seeded = seedLauncherLog(text);
      launcherOffset = seeded.offset;
      launcherPending = seeded.pending;
      launcherBytes = stat.size;
      launcherSeeded = true;
      if (seeded.entries.length > 0) deps.onLauncherLines(seeded.entries);
      return;
    }
    const consumed = consumeLauncherLogText(
      launcherPending,
      text.slice(launcherOffset)
    );
    launcherOffset = text.length;
    launcherPending = consumed.pending;
    launcherBytes = stat.size;
    if (consumed.entries.length > 0) deps.onLauncherLines(consumed.entries);
  }

  function restartGameTail(game: LogWindowGameTarget | undefined) {
    const key = gameTailIdentity(game);
    if (key === gameKey) return;
    stopGameTail?.();
    stopGameTail = undefined;
    gameKey = key;
    deps.onGameReset();
    if (game) stopGameTail = deps.startGameTail(game);
  }

  async function tick() {
    if (stopped) return;
    const text = await deps.readSession();
    const session = text ? parseLogWindowSession(text) : undefined;
    if (session) sessionParentPid = session.parentPid;
    if (!(await parentStillAlive())) {
      parentMisses += 1;
      if (parentMisses >= missesBeforeExit) {
        stopped = true;
        await deps.exit();
        return;
      }
    } else {
      parentMisses = 0;
    }
    if (!session || stopped) return;
    deps.onSession(session);
    if (session.focusNonce !== seenNonce) {
      const shouldFocus = seenNonce >= 0;
      seenNonce = session.focusNonce;
      if (shouldFocus) {
        try {
          await deps.focus();
        } catch {
          // The window may already be focused.
        }
      }
    }
    await pollLauncher(session.launcherLogPath);
    restartGameTail(session.game);
  }

  async function run() {
    try {
      await tick();
    } finally {
      if (!stopped) timer = setTimeout(() => void run(), pollMs);
    }
  }

  void run();

  return () => {
    stopped = true;
    stopGameTail?.();
    stopGameTail = undefined;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

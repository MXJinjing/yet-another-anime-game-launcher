import type { GameLogLocation } from "../channel-client";
import { normalizeLogWindowAccent } from "./log-window-accent";

/**
 * Independent log window.
 *
 * External viewers are a poor fit: Console.app is a shared system app we must
 * not kill, and bundled viewers cannot present launcher and game logs as tabs
 * while exiting with this process. Neutralino.window.create starts an isolated
 * window process. The launcher kills that pid on exit, and the window also
 * exits if its parent pid disappears.
 */

export const LOG_WINDOW_FLAG = "--yaagl-window=logs";
export const LOG_WINDOW_PARENT_PREFIX = "--yaagl-parent-pid=";
export const LOG_WINDOW_SESSION_KEY = "yaagl_log_window";
export const LOG_WINDOW_SESSION_FILE = "yaaglm-log-window.json";
export const LOG_WINDOW_URL = "/";
export const MAX_LOG_WINDOW_LINES = 2000;
export const LAUNCHER_LOG_SEED_LINES = 200;

export type LogWindowTab = "launcher" | "game";
export type ParsedLogLevel = "INFO" | "WARNING" | "ERROR";

export interface LogWindowGameTarget {
  prefix: string;
  gameDir: string;
  locations: readonly GameLogLocation[];
  generation: number;
}

export interface LogWindowSession {
  parentPid: number;
  windowPid?: number;
  tab: LogWindowTab;
  focusNonce: number;
  launcherLogPath: string;
  /** Launcher theme accent, forwarded so the window matches the app. */
  accent?: string;
  game?: LogWindowGameTarget;
}

export interface ParsedLogLine {
  time: string;
  level: ParsedLogLevel;
  message: string;
}

export interface LogWindowCreateRequest {
  url: string;
  processArgs: string;
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  hidden: false;
  resizable: true;
  maximizable: true;
  borderless: false;
  enableInspector: false;
  exitProcessOnClose: true;
  useSavedState: false;
}

const LAUNCHER_LINE = /^\[([^\]]+)\] \[(INFO|WARNING|ERROR)\] ?(.*)$/;

export function splitLaunchArgs(args: readonly string[]): string[] {
  return args.flatMap(arg => arg.split(/\s+/).filter(Boolean));
}

export function isLogWindowArgs(args: readonly string[] | undefined): boolean {
  if (!args) return false;
  return splitLaunchArgs(args).includes(LOG_WINDOW_FLAG);
}

export function parentPidFromArgs(
  args: readonly string[] | undefined
): number | undefined {
  if (!args) return undefined;
  for (const arg of splitLaunchArgs(args)) {
    if (!arg.startsWith(LOG_WINDOW_PARENT_PREFIX)) continue;
    return positiveInteger(arg.slice(LOG_WINDOW_PARENT_PREFIX.length));
  }
  return undefined;
}

export function logWindowProcessArgs(parentPid: number): string | undefined {
  if (!isPositiveInteger(parentPid)) return undefined;
  return `${LOG_WINDOW_FLAG} ${LOG_WINDOW_PARENT_PREFIX}${parentPid}`;
}

export function logWindowCreateRequest(
  parentPid: number
): LogWindowCreateRequest | undefined {
  const processArgs = logWindowProcessArgs(parentPid);
  if (!processArgs) return undefined;
  return {
    url: LOG_WINDOW_URL,
    processArgs,
    title: "Live Logs",
    width: 980,
    height: 680,
    minWidth: 640,
    minHeight: 420,
    hidden: false,
    resizable: true,
    maximizable: true,
    borderless: false,
    enableInspector: false,
    exitProcessOnClose: true,
    useSavedState: false,
  };
}

export function posixSignalCommand(
  pid: number,
  signal: "0" | "KILL"
): string | undefined {
  if (!isPositiveInteger(pid)) return undefined;
  return `/bin/kill -${signal} ${pid}`;
}

/**
 * Inspects the recorded window process instead of signalling it.
 *
 * Neutralino spawns the window with a background `execCommand`, and the core
 * never waits for that child. A closed window therefore stays a zombie for as
 * long as the launcher runs, and `kill -0` keeps reporting it as alive, which
 * used to make the window impossible to reopen. `ps` exposes both the process
 * state and the arguments, so a zombie or a recycled pid is no longer mistaken
 * for a live log window.
 */
export function logWindowProcessStateCommand(pid: number): string | undefined {
  if (!isPositiveInteger(pid)) return undefined;
  return `/bin/ps -p ${pid} -ww -o stat= -o command=`;
}

export function isLogWindowProcessRunning(
  output: string | undefined,
  parentPid: number
): boolean {
  if (!output) return false;
  const line = output.trim();
  if (line === "") return false;
  const [state, ...rest] = line.split(/\s+/);
  if (!state || state.startsWith("Z")) return false;
  const command = rest.join(" ");
  return (
    command.includes(LOG_WINDOW_FLAG) &&
    command.includes(`${LOG_WINDOW_PARENT_PREFIX}${parentPid}`)
  );
}

export function parseLauncherLogLine(line: string): ParsedLogLine | undefined {
  const match = LAUNCHER_LINE.exec(line.replace(/\r$/, ""));
  if (!match) return undefined;
  return {
    time: match[1],
    level: match[2] as ParsedLogLevel,
    message: match[3],
  };
}

export function consumeLauncherLogText(
  pending: string,
  text: string
): { entries: ParsedLogLine[]; pending: string } {
  const parts = `${pending}${text}`.split("\n");
  const nextPending = parts.pop() ?? "";
  const entries: ParsedLogLine[] = [];
  for (const part of parts) {
    const parsed = parseLauncherLogLine(part);
    if (parsed) entries.push(parsed);
  }
  return { entries, pending: nextPending };
}

export function seedLauncherLog(
  text: string,
  maxLines = LAUNCHER_LOG_SEED_LINES
): { entries: ParsedLogLine[]; offset: number; pending: string } {
  const lines = text.split("\n");
  const pending = text.endsWith("\n") ? "" : lines.pop() ?? "";
  if (text.endsWith("\n")) lines.pop();
  const entries = lines
    .slice(-maxLines)
    .map(parseLauncherLogLine)
    .filter((entry): entry is ParsedLogLine => entry !== undefined);
  return { entries, offset: text.length, pending };
}

export function appendCapped<T>(
  current: readonly T[],
  incoming: readonly T[],
  max = MAX_LOG_WINDOW_LINES
): T[] {
  if (incoming.length === 0) return [...current];
  const combined = [...current, ...incoming];
  return combined.length <= max ? combined : combined.slice(-max);
}

export function parseLogWindowSession(
  text: string
): LogWindowSession | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<LogWindowSession>;
  const parentPid = positiveInteger(raw.parentPid);
  if (!parentPid) return undefined;
  if (raw.tab !== "launcher" && raw.tab !== "game") return undefined;
  if (!Number.isInteger(raw.focusNonce)) return undefined;
  if (typeof raw.launcherLogPath !== "string" || raw.launcherLogPath === "") {
    return undefined;
  }
  const session: LogWindowSession = {
    parentPid,
    tab: raw.tab,
    focusNonce: raw.focusNonce as number,
    launcherLogPath: raw.launcherLogPath,
  };
  if (raw.windowPid !== undefined) {
    const windowPid = positiveInteger(raw.windowPid);
    if (!windowPid) return undefined;
    session.windowPid = windowPid;
  }
  const accent = normalizeLogWindowAccent(raw.accent);
  if (accent) session.accent = accent;
  const game = normalizeGameTarget(raw.game);
  if (game) session.game = game;
  return session;
}

export function serializeLogWindowSession(session: LogWindowSession): string {
  return JSON.stringify(session);
}

export function chooseLogWindowSession(
  texts: Array<string | undefined>
): LogWindowSession | undefined {
  let best: LogWindowSession | undefined;
  for (const text of texts) {
    if (!text) continue;
    const session = parseLogWindowSession(text);
    if (!session) continue;
    if (!best || session.focusNonce >= best.focusNonce) best = session;
  }
  return best;
}

export function withFocusedTab(
  session: LogWindowSession,
  tab: LogWindowTab,
  game?: LogWindowGameTarget
): LogWindowSession {
  return {
    ...session,
    tab,
    focusNonce: session.focusNonce + 1,
    game: game ?? session.game,
  };
}

export function gameTailIdentity(
  game: LogWindowGameTarget | undefined
): string {
  if (!game) return "";
  return `${game.generation}\0${game.prefix}\0${game.gameDir}`;
}

function positiveInteger(value: unknown): number | undefined {
  const pid = typeof value === "number" ? value : Number(value);
  return isPositiveInteger(pid) ? pid : undefined;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function normalizeGameTarget(value: unknown): LogWindowGameTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<LogWindowGameTarget>;
  if (typeof raw.prefix !== "string" || typeof raw.gameDir !== "string") {
    return undefined;
  }
  if (!Number.isInteger(raw.generation)) return undefined;
  const locations = normalizeLocations(raw.locations);
  if (!locations) return undefined;
  return {
    prefix: raw.prefix,
    gameDir: raw.gameDir,
    generation: raw.generation as number,
    locations,
  };
}

function normalizeLocations(value: unknown): GameLogLocation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const locations: GameLogLocation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const location = item as Partial<GameLogLocation>;
    if (
      location.root !== "wine-user" &&
      location.root !== "wine-prefix" &&
      location.root !== "game-install"
    ) {
      return undefined;
    }
    if (typeof location.path !== "string") return undefined;
    locations.push({
      root: location.root,
      path: location.path,
      ...(location.recursive ? { recursive: true } : {}),
      ...(Array.isArray(location.extensions)
        ? {
            extensions: location.extensions.filter(
              (extension): extension is string => typeof extension === "string"
            ),
          }
        : {}),
    });
  }
  return locations;
}

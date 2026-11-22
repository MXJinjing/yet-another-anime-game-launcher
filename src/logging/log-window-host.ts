import { execCommand } from "../platform/neutralino/process";
import { addBeforeCloseApp } from "../platform/neutralino/system";
import { getRuntimeLogFilePath } from "./log-file";
import { logerror } from "./logger";
import { normalizeLogWindowAccent } from "./log-window-accent";
import {
  isLogWindowProcessRunning,
  logWindowCreateRequest,
  logWindowProcessStateCommand,
  parseLogWindowSession,
  posixSignalCommand,
  serializeLogWindowSession,
  withFocusedTab,
  type LogWindowGameTarget,
  type LogWindowSession,
  type LogWindowTab,
} from "./log-window-protocol";
import {
  readSharedLogWindowSession,
  writeSharedLogWindowSession,
} from "./log-window-store";

export interface LogWindowGameRequest {
  prefix: string;
  gameDir: string;
  locations: LogWindowGameTarget["locations"];
}

export interface LogWindowHostDependencies {
  parentPid: number;
  launcherLogPath: string;
  readSession: () => Promise<string | undefined>;
  writeSession: (text: string) => Promise<void>;
  createWindow: (processArgs: string) => Promise<{ pid: number }>;
  exec: (command: string) => Promise<{ exitCode: number; stdOut?: string }>;
  /** Resolved launcher accent; the log window mirrors the app theme. */
  accent?: () => Promise<string>;
}

export function createLogWindowHost(deps: LogWindowHostDependencies) {
  let chain = Promise.resolve();
  let gameGeneration = 0;

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function read(): Promise<LogWindowSession | undefined> {
    const text = await deps.readSession();
    return text ? parseLogWindowSession(text) : undefined;
  }

  async function write(session: LogWindowSession) {
    await deps.writeSession(serializeLogWindowSession(session));
  }

  async function alive(pid: number | undefined) {
    const command =
      pid === undefined ? undefined : logWindowProcessStateCommand(pid);
    if (!command) return false;
    try {
      const result = await deps.exec(command);
      if (result.exitCode !== 0) return false;
      return isLogWindowProcessRunning(result.stdOut, deps.parentPid);
    } catch {
      return false;
    }
  }

  function blank(
    tab: LogWindowTab,
    game?: LogWindowGameTarget
  ): LogWindowSession {
    return {
      parentPid: deps.parentPid,
      tab,
      focusNonce: 0,
      launcherLogPath: deps.launcherLogPath,
      game,
    };
  }

  async function accent(): Promise<string | undefined> {
    if (!deps.accent) return undefined;
    try {
      return normalizeLogWindowAccent(await deps.accent());
    } catch {
      return undefined;
    }
  }

  async function open(tab: LogWindowTab, game?: LogWindowGameTarget) {
    const current = (await read()) ?? blank(tab, game);
    const nextGame = game ?? current.game;
    const launcherAccent = await accent();
    const focused = withFocusedTab(
      {
        ...current,
        parentPid: deps.parentPid,
        launcherLogPath: deps.launcherLogPath,
        ...(launcherAccent ? { accent: launcherAccent } : {}),
      },
      tab,
      nextGame
    );
    if (await alive(current.windowPid)) {
      await write({ ...focused, windowPid: current.windowPid });
      return;
    }
    await write({ ...focused, windowPid: undefined });
    const request = logWindowCreateRequest(deps.parentPid);
    if (!request) throw new Error("Invalid launcher process id");
    const created = await deps.createWindow(request.processArgs);
    if (!Number.isInteger(created.pid) || created.pid <= 0) {
      throw new Error("Log window did not return a process id");
    }
    const latest = (await read()) ?? focused;
    await write({
      ...latest,
      parentPid: deps.parentPid,
      launcherLogPath: deps.launcherLogPath,
      windowPid: created.pid,
    });
  }

  return {
    open(tab: LogWindowTab = "launcher") {
      return enqueue(() => open(tab));
    },
    publishGame(game: LogWindowGameRequest) {
      return enqueue(async () => {
        gameGeneration += 1;
        await open("game", {
          ...game,
          generation: gameGeneration,
        });
      });
    },
    close() {
      return enqueue(async () => {
        const current = await read();
        const command = current?.windowPid
          ? posixSignalCommand(current.windowPid, "KILL")
          : undefined;
        if (command && (await alive(current?.windowPid))) {
          try {
            await deps.exec(command);
          } catch {
            // The child also exits when the parent pid disappears.
          }
        }
        if (!current) return;
        const { windowPid: _removed, ...rest } = current;
        await write(rest);
      });
    },
  };
}

let host: ReturnType<typeof createLogWindowHost> | undefined;
let lifecycleInstalled = false;
let accentProvider: (() => Promise<string>) | undefined;

export function getLogWindowHost() {
  if (!host) {
    const parentPid = Number(typeof NL_PID === "undefined" ? "" : NL_PID);
    host = createLogWindowHost({
      parentPid,
      launcherLogPath: getRuntimeLogFilePath(),
      readSession: async () => {
        const session = await readSharedLogWindowSession();
        return session ? serializeLogWindowSession(session) : undefined;
      },
      writeSession: async text => {
        const session = parseLogWindowSession(text);
        if (!session)
          throw new Error("Refusing to save an invalid log session");
        await writeSharedLogWindowSession(session);
      },
      createWindow: async processArgs => {
        const request = logWindowCreateRequest(parentPid);
        if (!request) throw new Error("Invalid launcher process id");
        const info = await Neutralino.window.create(request.url, {
          title: request.title,
          width: request.width,
          height: request.height,
          minWidth: request.minWidth,
          minHeight: request.minHeight,
          hidden: request.hidden,
          resizable: request.resizable,
          maximizable: request.maximizable,
          borderless: request.borderless,
          enableInspector: request.enableInspector,
          exitProcessOnClose: request.exitProcessOnClose,
          useSavedState: request.useSavedState,
          processArgs,
        });
        return { pid: info.pid };
      },
      exec: command => execCommand(command),
      accent: () => (accentProvider ? accentProvider() : Promise.resolve("")),
    });
  }
  return host;
}

/**
 * The launcher passes its theme colour provider here; the log window cannot
 * import the settings layer itself.
 */
export function installLogWindowLifecycle(accent?: () => Promise<string>) {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  if (accent) accentProvider = accent;
  addBeforeCloseApp(() => getLogWindowHost().close());
}

export async function openLogWindow(
  tab: LogWindowTab = "launcher",
  game?: LogWindowGameRequest
) {
  try {
    const current = getLogWindowHost();
    if (game) await current.publishGame(game);
    else await current.open(tab);
  } catch (error) {
    await logerror(`Unable to open log window: ${String(error)}`);
    throw error;
  }
}

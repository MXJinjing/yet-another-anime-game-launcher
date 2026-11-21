import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { createGameLogTail, findGameLogFiles } from "./game-log-tail";
import { inferUnityLogLevel } from "./runtime-log";
import { createLocale, type Locale } from "../locale";
import { execCommand } from "../platform/neutralino/process";
import { build } from "../platform/shell";
import { createLogWindowClient } from "./log-window-client";
import {
  appendCapped,
  type LogWindowSession,
  type LogWindowTab,
  type ParsedLogLine,
} from "./log-window-protocol";
import { readSharedLogWindowSession } from "./log-window-store";
import "./log-window.css";

function displayTime(stamp: string) {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  return date.toLocaleTimeString();
}

function lineText(entry: ParsedLogLine) {
  return `[${entry.time}] [${entry.level}] ${entry.message}`;
}

export async function startLogWindow() {
  const locale = await createLocale();
  try {
    await Neutralino.window.setTitle(locale.get("LOG_VIEWER_TITLE"));
    await Neutralino.window.show();
  } catch {
    // The native window may already be visible.
  }
  const root = document.getElementById("root");
  if (!root) return;
  render(() => <LogWindowApp locale={locale} />, root);
}

function LogWindowApp(props: { locale: Locale }) {
  const [tab, setTab] = createSignal<LogWindowTab>("launcher");
  const [session, setSession] = createSignal<LogWindowSession>();
  const [launcherLines, setLauncherLines] = createSignal<ParsedLogLine[]>([]);
  const [gameLines, setGameLines] = createSignal<ParsedLogLine[]>([]);
  const [followScroll, setFollowScroll] = createSignal(true);
  const [pending, setPending] = createSignal(0);
  let consoleEl: HTMLDivElement | undefined;
  let stickToBottom = true;
  let appliedNonce = -1;

  const activeLines = () =>
    tab() === "launcher" ? launcherLines() : gameLines();

  function rememberLines(current: ParsedLogLine[], incoming: ParsedLogLine[]) {
    if (!stickToBottom) setPending(count => count + incoming.length);
    return appendCapped(current, incoming);
  }

  function scrollToLatest() {
    stickToBottom = true;
    setPending(0);
    setFollowScroll(true);
    queueMicrotask(() => {
      if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
    });
  }

  onMount(() => {
    const stop = createLogWindowClient({
      args: typeof NL_ARGS === "undefined" ? [] : NL_ARGS,
      readSession: async () => {
        const current = await readSharedLogWindowSession();
        return current ? JSON.stringify(current) : undefined;
      },
      exec: command => execCommand(command),
      readFile: path => Neutralino.filesystem.readFile(path),
      stats: async path => {
        const info = await Neutralino.filesystem.getStats(path);
        return { size: info.size };
      },
      focus: async () => {
        await Neutralino.window.show();
        await Neutralino.window.focus();
      },
      exit: () => Neutralino.app.killProcess(),
      onSession: next => {
        setSession(next);
        if (next.focusNonce !== appliedNonce) {
          appliedNonce = next.focusNonce;
          setTab(next.tab);
        }
      },
      onLauncherLines: lines => {
        setLauncherLines(current => rememberLines(current, lines));
      },
      onGameReset: () => setGameLines([]),
      startGameTail: game =>
        createGameLogTail({
          prefix: game.prefix,
          gameDir: game.gameDir,
          locations: game.locations,
          onLine: line => {
            const entry: ParsedLogLine = {
              time: new Date().toISOString(),
              level: inferUnityLogLevel(line),
              message: line,
            };
            setGameLines(current => rememberLines(current, [entry]));
          },
        }),
    });
    onCleanup(stop);
  });

  createEffect(() => {
    activeLines();
    if (!stickToBottom) return;
    queueMicrotask(() => {
      if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
    });
  });

  function onConsoleScroll() {
    if (!consoleEl) return;
    const distance =
      consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight;
    stickToBottom = distance < 24;
    if (stickToBottom) setPending(0);
    setFollowScroll(stickToBottom);
  }

  async function copyLogs() {
    await Neutralino.clipboard.writeText(
      activeLines().map(lineText).join("\n")
    );
  }

  async function openActiveFile() {
    const current = session();
    if (!current) return;
    if (tab() === "launcher") {
      await execCommand(build(["open", current.launcherLogPath]), {});
      return;
    }
    if (!current.game) return;
    const paths = await findGameLogFiles({
      prefix: current.game.prefix,
      gameDir: current.game.gameDir,
      locations: current.game.locations,
      existingOnly: true,
    });
    if (paths[0]) await execCommand(build(["open", paths[0]]), {});
  }

  return (
    <div class="log-window">
      <header class="log-window-header">
        <h1 class="log-window-title">{props.locale.get("LOG_VIEWER_TITLE")}</h1>
        <label class="log-window-follow">
          <input
            type="checkbox"
            checked={followScroll()}
            onChange={event => {
              const next = event.currentTarget.checked;
              setFollowScroll(next);
              stickToBottom = next;
              if (next) scrollToLatest();
            }}
          />
          {props.locale.get("LOG_VIEWER_FOLLOW_SCROLL")}
        </label>
      </header>
      <div class="log-window-tabs" role="tablist">
        <button
          class="log-window-tab"
          type="button"
          role="tab"
          aria-selected={tab() === "launcher"}
          onClick={() => setTab("launcher")}
        >
          {props.locale.get("LOG_VIEWER_TAB_LAUNCHER")}
          <span class="log-window-count">{launcherLines().length}</span>
        </button>
        <button
          class="log-window-tab"
          type="button"
          role="tab"
          aria-selected={tab() === "game"}
          onClick={() => setTab("game")}
        >
          {props.locale.get("LOG_VIEWER_TAB_GAME")}
          <span class="log-window-count">{gameLines().length}</span>
        </button>
      </div>
      <div class="log-viewer-shell">
        <div
          class="log-viewer-console"
          ref={consoleEl}
          onScroll={onConsoleScroll}
          on:contextmenu={event => event.stopPropagation()}
        >
          <For
            each={activeLines()}
            fallback={
              <div class="log-viewer-empty">
                {tab() === "launcher"
                  ? props.locale.get("LOG_VIEWER_EMPTY")
                  : props.locale.get("LOG_VIEWER_GAME_EMPTY")}
              </div>
            }
          >
            {entry => (
              <div class="log-viewer-line" data-level={entry.level}>
                <span class="log-viewer-time">{displayTime(entry.time)}</span>
                <span
                  class={`log-viewer-level log-viewer-level--${entry.level.toLowerCase()}`}
                >
                  {entry.level}
                </span>
                <span class="log-viewer-message">{entry.message}</span>
              </div>
            )}
          </For>
        </div>
      </div>
      <footer class="log-window-footer">
        <button
          class="log-window-jump"
          type="button"
          style={{ display: pending() === 0 ? "none" : "inline-flex" }}
          onClick={scrollToLatest}
        >
          {props.locale.get("LOG_VIEWER_JUMP")}
        </button>
        <div class="log-window-actions">
          <button
            class="log-window-action"
            type="button"
            onClick={() => void copyLogs()}
          >
            {props.locale.get("LOG_VIEWER_COPY")}
          </button>
          <button
            class="log-window-action"
            type="button"
            disabled={tab() === "game" && !session()?.game}
            onClick={() => void openActiveFile()}
          >
            {props.locale.get("LOG_VIEWER_OPEN_FILE")}
          </button>
        </div>
      </footer>
    </div>
  );
}

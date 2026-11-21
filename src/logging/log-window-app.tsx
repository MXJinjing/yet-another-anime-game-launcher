import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { render } from "solid-js/web";
import { createGameLogTail } from "./game-log-tail";
import { inferUnityLogLevel } from "./runtime-log";
import { createLocale, type Locale } from "../locale";
import { execCommand } from "../platform/neutralino/process";
import { build } from "../platform/shell";
import { createLogWindowClient } from "./log-window-client";
import {
  closeMonitoredPath,
  gameLogTabLabel,
  LAUNCHER_LOG_TAB,
  openMonitoredPaths,
  reopenMonitoredPath,
  selectionAfterClose,
} from "./log-window-files";
import {
  appendCapped,
  type LogWindowSession,
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
  const [session, setSession] = createSignal<LogWindowSession>();
  const [selected, setSelected] = createSignal(LAUNCHER_LOG_TAB);
  const [launcherLines, setLauncherLines] = createSignal<ParsedLogLine[]>([]);
  const [monitored, setMonitored] = createSignal<string[]>([]);
  const [closed, setClosed] = createSignal<ReadonlySet<string>>(new Set());
  const [linesByPath, setLinesByPath] = createSignal<
    Record<string, ParsedLogLine[]>
  >({});
  const [followScroll, setFollowScroll] = createSignal(true);
  const [pending, setPending] = createSignal(0);
  const [menuOpen, setMenuOpen] = createSignal(false);
  let consoleEl: HTMLDivElement | undefined;
  let stickToBottom = true;
  let appliedNonce = -1;
  let preferGame = false;

  const openPaths = () => openMonitoredPaths(monitored(), closed());
  const activeLines = () => {
    const current = selected();
    if (current === LAUNCHER_LOG_TAB) return launcherLines();
    return linesByPath()[current] ?? [];
  };

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

  function selectTab(id: string) {
    if (id === LAUNCHER_LOG_TAB) preferGame = false;
    setSelected(id);
    setMenuOpen(false);
    setPending(0);
  }

  function closeFile(path: string) {
    const nextClosed = closeMonitoredPath(closed(), path);
    setClosed(nextClosed);
    setSelected(current =>
      selectionAfterClose(current, openMonitoredPaths(monitored(), nextClosed))
    );
  }

  function openFile(path: string) {
    setClosed(current => reopenMonitoredPath(current, path));
    setSelected(path);
    setMenuOpen(false);
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
          if (next.tab === "game") {
            preferGame = true;
            const first = openPaths()[0];
            if (first) setSelected(first);
          } else {
            preferGame = false;
            setSelected(LAUNCHER_LOG_TAB);
          }
        }
      },
      onLauncherLines: lines => {
        setLauncherLines(current => rememberLines(current, lines));
      },
      onGameReset: () => {
        setMonitored([]);
        setClosed(new Set<string>());
        setLinesByPath({});
        if (selected() !== LAUNCHER_LOG_TAB) setSelected(LAUNCHER_LOG_TAB);
      },
      startGameTail: game =>
        createGameLogTail({
          prefix: game.prefix,
          gameDir: game.gameDir,
          locations: game.locations,
          onLine: () => undefined,
          onPaths: paths => setMonitored(paths),
          onFileLine: (path, line) => {
            const entry: ParsedLogLine = {
              time: new Date().toISOString(),
              level: inferUnityLogLevel(line),
              message: line,
            };
            setLinesByPath(current => ({
              ...current,
              [path]: rememberLines(current[path] ?? [], [entry]),
            }));
            setMonitored(current =>
              current.includes(path) ? current : [...current, path]
            );
          },
        }),
    });
    onCleanup(stop);
  });

  createEffect(() => {
    const paths = openPaths();
    if (!preferGame || paths.length === 0) return;
    if (!paths.includes(selected())) setSelected(paths[0]);
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
    const current = selected();
    const path =
      current === LAUNCHER_LOG_TAB ? session()?.launcherLogPath : current;
    if (path) await execCommand(build(["open", path]), {});
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
        <div
          class="log-window-tab"
          role="tab"
          aria-selected={selected() === LAUNCHER_LOG_TAB}
        >
          <button
            class="log-window-tab-main"
            type="button"
            onClick={() => selectTab(LAUNCHER_LOG_TAB)}
          >
            {props.locale.get("LOG_VIEWER_TAB_LAUNCHER")}
            <span class="log-window-count">{launcherLines().length}</span>
          </button>
        </div>
        <For each={openPaths()}>
          {path => (
            <div
              class="log-window-tab"
              role="tab"
              aria-selected={selected() === path}
              title={path}
            >
              <button
                class="log-window-tab-main"
                type="button"
                onClick={() => selectTab(path)}
              >
                {gameLogTabLabel(path, monitored())}
                <span class="log-window-count">
                  {linesByPath()[path]?.length ?? 0}
                </span>
              </button>
              <button
                class="log-window-tab-close"
                type="button"
                aria-label={props.locale.get("LOG_VIEWER_CLOSE_TAB")}
                title={props.locale.get("LOG_VIEWER_CLOSE_TAB")}
                onClick={() => closeFile(path)}
              >
                ×
              </button>
            </div>
          )}
        </For>
        <div class="log-window-menu">
          <button
            class="log-window-add"
            type="button"
            aria-expanded={menuOpen()}
            onClick={() => setMenuOpen(open => !open)}
          >
            {props.locale.get("LOG_VIEWER_MONITORED")}
          </button>
          <Show when={menuOpen()}>
            <div class="log-window-file-menu" role="menu">
              <Show
                when={monitored().length > 0}
                fallback={
                  <div class="log-window-file-empty">
                    {props.locale.get("LOG_VIEWER_NO_MONITORED_FILES")}
                  </div>
                }
              >
                <For each={monitored()}>
                  {path => {
                    const opened = () => !closed().has(path);
                    return (
                      <div class="log-window-file-row" title={path}>
                        <span class="log-window-file-name">
                          {gameLogTabLabel(path, monitored())}
                        </span>
                        <button
                          class="log-window-file-toggle"
                          type="button"
                          onClick={() =>
                            opened() ? closeFile(path) : openFile(path)
                          }
                        >
                          {opened()
                            ? props.locale.get("LOG_VIEWER_CLOSE_TAB")
                            : props.locale.get("LOG_VIEWER_REOPEN_TAB")}
                        </button>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <Show when={selected() !== LAUNCHER_LOG_TAB}>
        <div class="log-window-path" title={selected()}>
          {selected()}
        </div>
      </Show>
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
                {selected() === LAUNCHER_LOG_TAB
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
            disabled={selected() !== LAUNCHER_LOG_TAB && !selected()}
            onClick={() => void openActiveFile()}
          >
            {props.locale.get("LOG_VIEWER_OPEN_FILE")}
          </button>
        </div>
      </footer>
    </div>
  );
}

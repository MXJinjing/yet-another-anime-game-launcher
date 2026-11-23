import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal, render } from "solid-js/web";
import { createLogFileTail } from "./game-log-tail";
import { inferUnityLogLevel } from "./runtime-log";
import { createLocale, type Locale } from "../locale";
import { execCommand } from "../platform/neutralino/process";
import { installWindowDrag } from "../platform/neutralino/window-drag";
import { build } from "../platform/shell";
import {
  DEFAULT_LOG_WINDOW_ACCENT,
  logWindowAccentText,
  normalizeLogWindowAccent,
} from "./log-window-accent";
import { createLogWindowClient } from "./log-window-client";
import {
  closeMonitoredPath,
  gameLogTabLabel,
  LAUNCHER_LOG_TAB,
  layoutLogTabs,
  openMonitoredPaths,
  reopenMonitoredPath,
  selectionAfterClose,
  validatePickedLogPaths,
} from "./log-window-files";
import {
  logWindowMenuPlacement,
  type LogWindowMenuPlacement,
} from "./log-window-menu";
import {
  appendCapped,
  type LogWindowGameTarget,
  type LogWindowSession,
  type ParsedLogLine,
} from "./log-window-protocol";
import { readSharedLogWindowSession } from "./log-window-store";
import {
  nextLogWindowTheme,
  readLogWindowTheme,
  writeLogWindowTheme,
  type LogWindowTheme,
} from "./log-window-theme";
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
  const [locale, theme] = await Promise.all([
    createLocale(),
    readLogWindowTheme(),
  ]);
  try {
    await Neutralino.window.setTitle(locale.get("LOG_VIEWER_TITLE"));
    await Neutralino.window.show();
  } catch {
    // The native window may already be visible.
  }
  const root = document.getElementById("root");
  if (!root) return;
  render(() => <LogWindowApp locale={locale} initialTheme={theme} />, root);
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 15.3A8.6 8.6 0 0 1 8.7 3.5a8.6 8.6 0 1 0 11.8 11.8Z" />
    </svg>
  );
}

function LogWindowApp(props: { locale: Locale; initialTheme: LogWindowTheme }) {
  const [session, setSession] = createSignal<LogWindowSession>();
  const [gameTarget, setGameTarget] = createSignal<LogWindowGameTarget>();
  const [manualPaths, setManualPaths] = createSignal<string[]>([]);
  const [trackWidth, setTrackWidth] = createSignal(0);
  const [picking, setPicking] = createSignal(false);
  const [pickFailed, setPickFailed] = createSignal(false);
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
  const [menuPlacement, setMenuPlacement] =
    createSignal<LogWindowMenuPlacement>();
  const [theme, setTheme] = createSignal<LogWindowTheme>(props.initialTheme);
  const accent = () =>
    normalizeLogWindowAccent(session()?.accent) ?? DEFAULT_LOG_WINDOW_ACCENT;
  let consoleEl: HTMLDivElement | undefined;
  let tabStripEl: HTMLDivElement | undefined;
  let tabTrackEl: HTMLDivElement | undefined;
  let overflowEl: HTMLButtonElement | undefined;
  let menuEl: HTMLDivElement | undefined;
  let stickToBottom = true;
  let appliedNonce = -1;
  let preferGame = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const tabs = createMemo(() =>
    layoutLogTabs(monitored(), closed(), selected(), trackWidth())
  );
  const firstAutoFile = () =>
    openMonitoredPaths(monitored(), closed()).find(
      path => !manualPaths().includes(path)
    );
  const activeLines = () => {
    const current = selected();
    if (current === LAUNCHER_LOG_TAB) return launcherLines();
    return linesByPath()[current] ?? [];
  };
  const accentText = () => logWindowAccentText(accent());
  const themeLabel = () =>
    theme() === "dark"
      ? props.locale.get("LOG_VIEWER_THEME_TO_LIGHT")
      : props.locale.get("LOG_VIEWER_THEME_TO_DARK");

  function toggleTheme() {
    const next = nextLogWindowTheme(theme());
    setTheme(next);
    void writeLogWindowTheme(next);
  }

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
    preferGame = false;
    setSelected(id);
    setMenuOpen(false);
    setPending(0);
  }

  function focusSelectedTab() {
    queueMicrotask(() => {
      tabTrackEl
        ?.querySelector<HTMLButtonElement>(
          '[aria-selected="true"] .log-window-tab-main'
        )
        ?.focus();
    });
  }

  function closeFile(path: string) {
    const nextClosed = closeMonitoredPath(closed(), path);
    setClosed(nextClosed);
    setSelected(current =>
      selectionAfterClose(current, openMonitoredPaths(monitored(), nextClosed))
    );
  }

  function openFile(path: string) {
    batch(() => {
      setClosed(current => reopenMonitoredPath(current, path));
      selectTab(path);
    });
    focusSelectedTab();
  }

  async function pickFiles() {
    if (picking()) return;
    setMenuOpen(false);
    setPickFailed(false);
    setPicking(true);
    try {
      const picked = await Neutralino.os.showOpenDialog(
        props.locale.get("LOG_VIEWER_PICK_FILE"),
        { multiSelections: true }
      );
      if (disposed || picked.length === 0) return;
      const paths = await validatePickedLogPaths(
        picked,
        async path => (await Neutralino.filesystem.getStats(path)).isFile
      );
      if (disposed) return;
      if (paths.length === 0) {
        setPickFailed(true);
        return;
      }
      const launcherPath = session()?.launcherLogPath;
      const additional = paths.filter(path => path !== launcherPath);
      batch(() => {
        setManualPaths(current => [...new Set([...current, ...additional])]);
        setMonitored(current => [...new Set([...current, ...additional])]);
        setClosed(current => {
          const next = new Set(current);
          for (const path of additional) next.delete(path);
          return next;
        });
        selectTab(paths[0] === launcherPath ? LAUNCHER_LOG_TAB : paths[0]);
      });
      focusSelectedTab();
    } catch {
      if (!disposed) setPickFailed(true);
    } finally {
      if (!disposed) setPicking(false);
    }
  }

  function placeMenu() {
    const button = overflowEl;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const next = logWindowMenuPlacement(
      { top: rect.top, right: rect.right, bottom: rect.bottom },
      { width: window.innerWidth, height: window.innerHeight }
    );
    const current = menuPlacement();
    if (
      current &&
      current.right === next.right &&
      current.top === next.top &&
      current.bottom === next.bottom &&
      current.maxHeight === next.maxHeight
    ) {
      return;
    }
    setMenuPlacement(next);
  }

  function toggleMenu() {
    if (menuOpen()) {
      setMenuOpen(false);
      return;
    }
    placeMenu();
    setMenuOpen(true);
    queueMicrotask(() => {
      menuEl
        ?.querySelector<HTMLButtonElement>(".log-window-file-select")
        ?.focus();
    });
  }

  function menuStyle() {
    const placement = menuPlacement();
    return {
      right: `${placement?.right ?? 0}px`,
      ...(placement?.top !== undefined ? { top: `${placement.top}px` } : {}),
      ...(placement?.bottom !== undefined
        ? { bottom: `${placement.bottom}px` }
        : {}),
      "max-height": `${placement?.maxHeight ?? 0}px`,
      "--lw-accent": accent(),
      "--lw-accent-text": accentText(),
    };
  }

  onMount(() => {
    onCleanup(
      installWindowDrag({
        regions: () => (tabStripEl ? [{ element: tabStripEl }] : []),
      })
    );
  });

  onMount(() => {
    // The popup lives in a portal, so closing on outside clicks and keeping it
    // anchored cannot rely on bubbling through the tab strip.
    const onPointerDown = (event: PointerEvent) => {
      if (!menuOpen()) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (overflowEl?.contains(target) || menuEl?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen()) {
        setMenuOpen(false);
        overflowEl?.focus();
      }
    };
    const reposition = () => {
      if (menuOpen()) placeMenu();
    };
    const measureTrack = () => setTrackWidth(tabTrackEl?.clientWidth ?? 0);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measureTrack);
    if (tabTrackEl) observer?.observe(tabTrackEl);
    measureTrack();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("resize", measureTrack);
    window.addEventListener("scroll", reposition, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("resize", measureTrack);
      observer?.disconnect();
      window.removeEventListener("scroll", reposition, true);
    });
  });

  onMount(() => {
    const stopFiles = createLogFileTail({
      getGameTarget: gameTarget,
      getManualPaths: manualPaths,
      onLine: () => undefined,
      onPaths: paths =>
        setMonitored([...new Set([...paths, ...manualPaths()])]),
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
      },
    });
    onCleanup(stopFiles);

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
          preferGame = next.tab === "game";
          const first = preferGame ? firstAutoFile() : undefined;
          setSelected(first ?? LAUNCHER_LOG_TAB);
        }
      },
      onLauncherLines: lines => {
        setLauncherLines(current => rememberLines(current, lines));
      },
      onGameChange: game => {
        const manual = manualPaths();
        batch(() => {
          setGameTarget(game);
          setMonitored([...manual]);
          setClosed(
            current => new Set(manual.filter(path => current.has(path)))
          );
          setLinesByPath(current =>
            Object.fromEntries(manual.map(path => [path, current[path] ?? []]))
          );
          if (!manual.includes(selected())) setSelected(LAUNCHER_LOG_TAB);
        });
      },
    });
    onCleanup(stop);
  });

  createEffect(() => {
    const first = firstAutoFile();
    if (preferGame && first && selected() === LAUNCHER_LOG_TAB) {
      setSelected(first);
    }
  });

  createEffect(() => {
    if (menuOpen() && tabs().folded.length === 0) {
      setMenuOpen(false);
      focusSelectedTab();
    }
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
    <div
      class="log-window"
      data-theme={theme()}
      style={{ "--lw-accent": accent(), "--lw-accent-text": accentText() }}
    >
      <div class="log-window-panel">
        <div class="log-window-tabs" ref={tabStripEl}>
          <div class="log-window-tab-track" role="tablist" ref={tabTrackEl}>
            <div
              class="log-window-tab"
              role="tab"
              aria-selected={selected() === LAUNCHER_LOG_TAB}
              title={props.locale.get("LOG_VIEWER_TAB_LAUNCHER")}
            >
              <button
                class="log-window-tab-main"
                type="button"
                onClick={() => selectTab(LAUNCHER_LOG_TAB)}
              >
                <span class="log-window-tab-label">
                  {props.locale.get("LOG_VIEWER_TAB_LAUNCHER")}
                </span>
                <span class="log-window-count">{launcherLines().length}</span>
              </button>
            </div>
            <For each={tabs().visible}>
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
                    <span class="log-window-tab-label">
                      {gameLogTabLabel(path, monitored())}
                    </span>
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
                    <svg
                      viewBox="0 0 12 12"
                      width="10"
                      height="10"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      aria-hidden="true"
                    >
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </div>
              )}
            </For>
          </div>
          <div class="log-window-tools">
            <button
              class="log-window-overflow"
              type="button"
              ref={overflowEl}
              disabled={tabs().folded.length === 0}
              style={{
                visibility: tabs().folded.length === 0 ? "hidden" : "visible",
              }}
              aria-label={props.locale.get("LOG_VIEWER_MONITORED")}
              title={props.locale.get("LOG_VIEWER_MONITORED")}
              aria-haspopup="dialog"
              aria-controls={menuOpen() ? "log-window-folded-tabs" : undefined}
              aria-expanded={menuOpen()}
              onClick={toggleMenu}
            >
              <svg
                viewBox="0 0 12 12"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m3 4.5 3 3 3-3" />
              </svg>
              <span class="log-window-overflow-count" aria-hidden="true">
                {tabs().folded.length}
              </span>
            </button>
            <button
              class="log-window-add"
              type="button"
              disabled={picking()}
              aria-label={props.locale.get("LOG_VIEWER_PICK_FILE")}
              title={props.locale.get("LOG_VIEWER_PICK_FILE")}
              onClick={() => void pickFiles()}
            >
              <svg
                viewBox="0 0 12 12"
                width="11"
                height="11"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M6 2.5v7M2.5 6h7" />
              </svg>
            </button>
            <button
              class="log-window-theme"
              type="button"
              aria-label={themeLabel()}
              title={themeLabel()}
              onClick={toggleTheme}
            >
              {theme() === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
        <Show when={pickFailed()}>
          <div class="log-window-picker-error" role="alert">
            {props.locale.get("LOG_VIEWER_PICK_FAILED")}
          </div>
        </Show>
        <section class="log-window-surface">
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
                    <span class="log-viewer-time">
                      {displayTime(entry.time)}
                    </span>
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
        </section>
        <footer class="log-window-footer">
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
          <div class="log-window-actions">
            <button
              class="log-window-jump"
              type="button"
              style={{ display: pending() === 0 ? "none" : "inline-flex" }}
              onClick={scrollToLatest}
            >
              {props.locale.get("LOG_VIEWER_JUMP")}
            </button>
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
      <Show when={menuOpen()}>
        <Portal>
          <div
            class="log-window-portal log-window-file-menu"
            id="log-window-folded-tabs"
            role="dialog"
            aria-label={props.locale.get("LOG_VIEWER_MONITORED")}
            ref={menuEl}
            data-theme={theme()}
            style={menuStyle()}
          >
            <div class="log-window-file-heading">
              {props.locale.get("LOG_VIEWER_MONITORED")}
            </div>
            <For each={tabs().folded}>
              {path => (
                <div class="log-window-file-row" title={path}>
                  <button
                    class="log-window-file-select"
                    type="button"
                    onClick={() => openFile(path)}
                  >
                    <span class="log-window-file-name">
                      {gameLogTabLabel(path, monitored())}
                    </span>
                  </button>
                  <Show when={!closed().has(path)}>
                    <button
                      class="log-window-file-toggle"
                      type="button"
                      onClick={() => closeFile(path)}
                    >
                      {props.locale.get("LOG_VIEWER_CLOSE_TAB")}
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

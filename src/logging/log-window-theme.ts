export type LogWindowTheme = "dark" | "light";

/**
 * The log window keeps its own appearance so it can stay readable next to a
 * game. The choice lives in Neutralino storage, which every window process
 * shares, so reopening the window restores the last theme.
 */
export const LOG_WINDOW_THEME_KEY = "yaagl_log_window_theme";

export function normalizeLogWindowTheme(value: unknown): LogWindowTheme {
  return value === "light" ? "light" : "dark";
}

export function nextLogWindowTheme(theme: LogWindowTheme): LogWindowTheme {
  return theme === "dark" ? "light" : "dark";
}

export async function readLogWindowTheme(): Promise<LogWindowTheme> {
  try {
    return normalizeLogWindowTheme(
      await Neutralino.storage.getData(LOG_WINDOW_THEME_KEY)
    );
  } catch {
    return "dark";
  }
}

export async function writeLogWindowTheme(theme: LogWindowTheme) {
  try {
    await Neutralino.storage.setData(LOG_WINDOW_THEME_KEY, theme);
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
}

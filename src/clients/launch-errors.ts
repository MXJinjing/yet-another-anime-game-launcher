/**
 * Client-level launch failures that the launcher can turn into a recoverable
 * outcome. Keeping them here lets every channel share the same identity
 * checks instead of matching error message strings.
 */

/**
 * The target executable is still running in the game's Wine prefix.
 *
 * A launch must never kill processes on its own: the user is asked first.
 */
export class GameAlreadyRunningError extends Error {
  constructor(readonly executablePath: string) {
    super(`The game executable is already running: ${executablePath}`);
    this.name = "GameAlreadyRunningError";
  }
}

export function isGameAlreadyRunningError(
  error: unknown
): error is GameAlreadyRunningError {
  return error instanceof GameAlreadyRunningError;
}

/** The installed game version could not be parsed from its files. */
export class GameVersionUnreadableError extends Error {
  constructor(message = "Unable to read the installed game version") {
    super(message);
    this.name = "GameVersionUnreadableError";
  }
}

export function isGameVersionUnreadableError(
  error: unknown
): error is GameVersionUnreadableError {
  return error instanceof GameVersionUnreadableError;
}

/**
 * Represents a failure to establish or maintain a network connection
 * (e.g. the Sophon sidecar cannot reach the game's API servers, or the
 * launcher cannot reach its update server).
 *
 * These are recoverable, user-facing failures: callers should surface a
 * friendly notice (via the notification service) and let the user retry,
 * rather than treating them as fatal and exiting the app.
 */
export class ConnectionError extends Error {
  constructor(message = "Connection failed") {
    super(message);
    this.name = "ConnectionError";
  }
}

export function isConnectionError(error: unknown): error is ConnectionError {
  return error instanceof ConnectionError;
}

const CONNECTION_ERROR_PATTERNS = [
  /urlopen error/i,
  /unexpected_eof_while_reading/i,
  /\bssl\b/i,
  /\btls\b/i,
  /connection (refused|reset|closed|aborted|timed out)/i,
  /failed to (connect|fetch)/i,
  /could not connect/i,
  /cannot connect/i,
  /websocket connection error/i,
  /getaddrinfo failed/i,
  /name or service not known/i,
  /no route to host/i,
  /network (error|is unreachable|unreachable)/i,
  /remote end closed connection/i,
  /\btimed?\s*out\b/i,
];

/**
 * Best-effort detection of connection/network failures surfaced as plain
 * error strings (e.g. exceptions forwarded from the Python Sophon sidecar,
 * such as `urlopen error [SSL: ...]`).
 */
export function isConnectionErrorMessage(message: string): boolean {
  return CONNECTION_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

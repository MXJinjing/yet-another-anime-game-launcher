/**
 * A recoverable failure to establish or maintain a network connection.
 * Callers should present a retryable, user-facing error instead of treating it
 * as a fatal launcher failure.
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
 * Best-effort detection for connection failures forwarded as plain strings,
 * including errors emitted by the Sophon sidecar.
 */
export function isConnectionErrorMessage(message: string): boolean {
  return CONNECTION_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

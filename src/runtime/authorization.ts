export function isAuthorizationCancelledError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:用户已取消|user\s+cancell?ed)/i.test(message);
}

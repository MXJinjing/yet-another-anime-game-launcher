import { join } from "path-browserify";

export function resolve(path: string): string {
  if (!path.startsWith("/")) {
    path = join(
      import.meta.env.PROD
        ? window.NL_PATH
        : join(window.NL_CWD, window.NL_PATH),
      path
    );
    if (!path.startsWith("/") || path == "/") {
      throw new Error("Assertation failed " + path);
    }
  }
  return path;
}

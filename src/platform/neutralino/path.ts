import { isAbsolute, join } from "path-browserify";

export function resolve(path: string): string {
  if (!isAbsolute(path)) {
    const { NL_CWD, NL_PATH } = window;
    // The packaged launcher supplies an absolute resource path and runs
    // from Application Support. Local neu run uses a relative staging path.
    const dataDir = isAbsolute(NL_PATH) ? NL_CWD : join(NL_CWD, NL_PATH);
    path = join(dataDir, path);
    if (!isAbsolute(path) || path === "/") {
      throw new Error("Assertation failed " + path);
    }
  }
  return path;
}

export function resolveResource(path: string): string {
  if (!isAbsolute(path)) {
    const { NL_CWD, NL_PATH } = window;
    const resourceDir = isAbsolute(NL_PATH) ? NL_PATH : join(NL_CWD, NL_PATH);
    path = join(resourceDir, path);
  }
  if (!isAbsolute(path) || path === "/") {
    throw new Error("Assertation failed " + path);
  }
  return path;
}

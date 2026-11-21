import { isAbsolute, join } from "path-browserify";
import { env, resolve } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { getKeyOrDefault, setKey } from "@runtime/storage";

export type WineBinaryRootMode = "launcher" | "shared" | "custom";

export const WINE_BINARY_ROOT_MODE_KEY = "wine_binary_root_mode";
export const WINE_BINARY_ROOT_CUSTOM_KEY = "wine_binary_root_custom";
export const SHARED_WINE_BINARY_ROOT = join(".local", "yaaglm-wines");

const MODES = new Set<WineBinaryRootMode>(["launcher", "shared", "custom"]);

let cachedRoot: string | undefined;

export function parseWineBinaryRootMode(value: string | undefined) {
  return MODES.has(value as WineBinaryRootMode)
    ? (value as WineBinaryRootMode)
    : "launcher";
}

export function resolveWineBinaryRoot(input: {
  mode: WineBinaryRootMode;
  launcherDataDir: string;
  homeDir: string;
  customDir?: string;
}) {
  if (input.mode === "shared" && input.homeDir.startsWith("/")) {
    return join(input.homeDir, SHARED_WINE_BINARY_ROOT);
  }
  if (
    input.mode === "custom" &&
    input.customDir &&
    isAbsolute(input.customDir) &&
    input.customDir !== "/"
  ) {
    return input.customDir;
  }
  return join(input.launcherDataDir, "wines");
}

export function currentWineBinaryRoot() {
  return cachedRoot ?? resolve("./wines");
}

export function setCachedWineBinaryRoot(root: string) {
  cachedRoot = root;
}

async function homeDir() {
  const home = await env("HOME");
  return home.startsWith("/") ? home : "";
}

export async function readWineBinaryRootSetting() {
  const [modeValue, customDir] = await Promise.all([
    getKeyOrDefault(WINE_BINARY_ROOT_MODE_KEY, "launcher"),
    getKeyOrDefault(WINE_BINARY_ROOT_CUSTOM_KEY, ""),
  ]);
  const mode = parseWineBinaryRootMode(modeValue);
  const launcherDataDir = resolve(".");
  const root = resolveWineBinaryRoot({
    mode,
    launcherDataDir,
    homeDir: await homeDir(),
    customDir,
  });
  return { mode, customDir, launcherDataDir, root };
}

export async function loadWineBinaryRoot() {
  const setting = await readWineBinaryRootSetting();
  setCachedWineBinaryRoot(setting.root);
  return setting;
}

export async function saveWineBinaryRoot(input: {
  mode: WineBinaryRootMode;
  customDir?: string;
}) {
  if (
    input.mode === "custom" &&
    (!input.customDir ||
      !isAbsolute(input.customDir) ||
      input.customDir === "/")
  ) {
    throw new Error("Wine runtime directory is not absolute");
  }
  const current = await readWineBinaryRootSetting();
  const next = resolveWineBinaryRoot({
    mode: input.mode,
    launcherDataDir: current.launcherDataDir,
    homeDir: await homeDir(),
    customDir: input.customDir,
  });
  await exec(["mkdir", "-p", next]);
  await setKey(WINE_BINARY_ROOT_MODE_KEY, input.mode);
  if (input.mode === "custom" && input.customDir) {
    await setKey(WINE_BINARY_ROOT_CUSTOM_KEY, input.customDir);
  }
  setCachedWineBinaryRoot(next);
  return next;
}

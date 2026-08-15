import { execCommand } from "../platform/neutralino/process";
import { env, exit, restart } from "../platform/neutralino/system";

const hooks: Array<(forced: boolean) => Promise<boolean>> = [];

export function addTerminationHook(fn: (forced: boolean) => Promise<boolean>) {
  hooks.push(fn);
  const len = hooks.length;
  return () => {
    if (hooks.length !== len) throw new Error("Unexpected behavior!");
    hooks.pop();
  };
}

export async function GLOBAL_onClose(forced: boolean) {
  for (const hook of [...hooks].reverse()) {
    if (!(await hook(forced)) && !forced) return false;
  }
  return true;
}

export async function shutdown() {
  for (const hook of [...hooks].reverse()) await hook(true);
}

export async function _safeRelaunch() {
  await shutdown();
  if (import.meta.env.PROD) {
    const app = await env("PATH_LAUNCH");
    await execCommand(`open "${app}"`, { background: true });
    exit(0);
  } else {
    restart();
  }
}

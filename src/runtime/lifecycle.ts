import { execCommand } from "../platform/neutralino/process";
import { env, exit, restart } from "../platform/neutralino/system";
import { wait } from "./async";

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
    // `-n` forces a brand-new instance even while the current process is
    // still registered as running; a plain `open` may only activate the old
    // instance, after which exit() would leave the launcher closed instead of
    // restarting into the freshly updated resources.neu. Give the new
    // instance a short head start before the old process (and its aria2 child
    // holding port 6868) exits, so the relaunch does not fail on startup.
    await execCommand(`open -n "${app}"`, { background: true });
    await wait(1000);
    exit(0);
  } else {
    // Mirror the production relaunch hand-off: give the current aria2 a
    // moment to release port 6868 before the restarted instance tries to
    // bind it, so the relaunch does not fail on startup.
    await wait(500);
    restart();
  }
}

import type { Wine } from "../../wine";

/** The subset of the Wine API needed to stop a prefix before relaunching. */
export type ForceStopWine = Pick<Wine, "killAll" | "waitForWineServerExit">;

/**
 * Stop a running game's Wine prefix, then launch again.
 *
 * `wineserver -k` returns before the processes it signals have disappeared, so
 * launching immediately would scan the prefix, still see the dying processes,
 * and fail again with "the game is already running". Waiting for this prefix's
 * server to settle first makes the user's force-stop decision take effect.
 * The wait is bounded and best effort: a timeout must not block the relaunch.
 */
export async function forceStopThenLaunch(
  wine: ForceStopWine,
  launch: () => Promise<void>,
  waitTimeoutMs = 5_000
): Promise<void> {
  await wine.killAll();
  await wine.waitForWineServerExit({ timeoutMs: waitTimeoutMs });
  await launch();
}

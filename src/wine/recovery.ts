import { getWineDistributions, type WineDistribution } from "./distro";
import { isWineDistroInstalled } from "./wine";

/**
 * Answers "is this distribution usable right now?".
 *
 * Injected so the recovery decision can be tested without touching the
 * filesystem.
 */
export type WineInstalledProbe = (distroId: string) => Promise<boolean>;

const defaultProbe: WineInstalledProbe = distroId =>
  isWineDistroInstalled(distroId);

/**
 * Every distribution whose Wine binaries are actually present on disk.
 *
 * Best effort on purpose: this runs during a degraded boot, so a failed
 * listing or probe means "not installed" rather than a failed launcher.
 */
export async function listInstalledWineDistributions(
  list: () => Promise<WineDistribution[]> = getWineDistributions,
  probe: WineInstalledProbe = defaultProbe
): Promise<WineDistribution[]> {
  const distributions = await list().catch(() => []);
  const installed = await Promise.all(
    distributions.map(distro => probe(distro.id).catch(() => false))
  );
  return distributions.filter((_distro, index) => installed[index]);
}

export type WineRecoveryPlan =
  | { kind: "none" }
  | { kind: "choose"; missing: string; installed: WineDistribution[] };

/**
 * Decides whether the user must choose a Wine distribution.
 *
 * A selected Wine can disappear underneath the launcher: system Wine is
 * uninstalled, or a channel's tag no longer matches the shipped list. The
 * existing initialization flow can download a fresh Wine, but when a usable
 * distribution already exists on disk the user should be asked instead of
 * being pushed into another download. Everything else -- a healthy Wine, a
 * pending distribution update, or nothing installed at all -- keeps the
 * ordinary flow, which is why those cases resolve to "none" here.
 */
export function planWineRecovery({
  wineReady,
  currentDistroId,
  installed,
}: {
  wineReady: boolean;
  currentDistroId: string;
  installed: WineDistribution[];
}): WineRecoveryPlan {
  if (wineReady) return { kind: "none" };
  if (installed.some(distro => distro.id === currentDistroId)) {
    // The selected distribution is still on disk, so "not ready" means a
    // pending update or an unfinished setup rather than a vanished Wine.
    return { kind: "none" };
  }
  const usable = installed.filter(distro => distro.id !== currentDistroId);
  if (usable.length === 0) return { kind: "none" };
  return { kind: "choose", missing: currentDistroId, installed: usable };
}

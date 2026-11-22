import { log } from "../logging/logger";
import {
  checkWineEnvironment,
  resolveRecommendedWineDistro,
  type WineStatus,
} from "../wine";

export type WineStatusResolverDependencies = {
  check: (defaultWineDistroTag: string) => Promise<WineStatus>;
  fallback: () => WineStatus;
};

const defaultDependencies: WineStatusResolverDependencies = {
  check: checkWineEnvironment,
  fallback: () => ({
    wineReady: false,
    wineDistribution: resolveRecommendedWineDistro(),
  }),
};

/**
 * Reads the Wine environment without letting a check failure abort boot.
 *
 * `checkWineEnvironment` throws when the channel's default distribution tag is
 * unknown (for example a build whose Wine list changed). Falling back to the
 * recommended distribution with `wineReady: false` shows the normal Wine
 * initialization UI instead of a fatal error; the user can still repair or
 * download the environment from there.
 */
export async function resolveWineStatus(
  defaultWineDistroTag: string,
  dependencies: Partial<WineStatusResolverDependencies> = {}
): Promise<WineStatus> {
  const { check, fallback } = { ...defaultDependencies, ...dependencies };
  try {
    return await check(defaultWineDistroTag);
  } catch (error) {
    await log(
      `Wine environment check failed; falling back to the recommended Wine: ${String(
        error
      )}`
    );
    return fallback();
  }
}

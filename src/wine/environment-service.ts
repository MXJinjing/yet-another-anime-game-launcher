import type { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { rmrf_dangerously } from "@runtime";
import { checkWine } from "./distro";
import type { WineDistribution, WineStatus } from "./distro";
import {
  configureWineEnvironmentProgram,
  installWineEnvironmentProgram,
} from "./wine-install-program";
import { isWineDistroInstalled, uninstallWineDistro, type Wine } from "./wine";

export type WineEnvironmentServiceDependencies = {
  checkWine: (defaultWineDistroTag: string) => Promise<WineStatus>;
  isWineDistroInstalled: (distroId: string) => Promise<boolean>;
  uninstallWineDistro: (distroId: string) => Promise<void>;
  installWineEnvironmentProgram: typeof installWineEnvironmentProgram;
  configureWineEnvironmentProgram: typeof configureWineEnvironmentProgram;
  removePrefix: (path: string) => Promise<unknown>;
};

const defaultDependencies: WineEnvironmentServiceDependencies = {
  checkWine,
  isWineDistroInstalled,
  uninstallWineDistro,
  installWineEnvironmentProgram,
  configureWineEnvironmentProgram,
  removePrefix: rmrf_dangerously,
};

export async function checkWineEnvironment(
  defaultWineDistroTag: string
): Promise<WineStatus> {
  return defaultDependencies.checkWine(defaultWineDistroTag);
}

/**
 * Owns Wine-prefix lifecycle operations without coupling them to the app UI.
 * The app supplies its existing Wine instance and signal setter during composition.
 */
export function createWineEnvironmentService({
  aria2,
  wine,
  wineAbsPrefix,
  setWineInstalled,
  dependencies = defaultDependencies,
}: {
  aria2: Aria2;
  wine: Wine;
  wineAbsPrefix: string;
  setWineInstalled: (installed: boolean) => void;
  dependencies?: WineEnvironmentServiceDependencies;
}) {
  async function reset() {
    await wine.killAll();
    await dependencies.removePrefix(wineAbsPrefix);
    setWineInstalled(false);
  }

  async function* initialize(wineDistro: WineDistribution): TaskProgram {
    yield* dependencies.installWineEnvironmentProgram({
      aria2,
      wineAbsPrefix,
      wineDistro,
      activate: false,
      finishMessage: false,
    });
    yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    yield* dependencies.configureWineEnvironmentProgram({
      aria2,
      wineAbsPrefix,
      wineDistro,
    });
    await wine.setDistribution(wineDistro);
    setWineInstalled(true);
  }

  async function* enable(wineDistro: WineDistribution): TaskProgram {
    if (!(await dependencies.isWineDistroInstalled(wineDistro.id))) {
      yield* dependencies.installWineEnvironmentProgram({
        aria2,
        wineAbsPrefix,
        wineDistro,
        activate: false,
        finishMessage: false,
      });
    }
    yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    yield* dependencies.configureWineEnvironmentProgram({
      aria2,
      wineAbsPrefix,
      wineDistro,
    });
    await wine.setDistribution(wineDistro);
    setWineInstalled(true);
  }

  async function* uninstall(wineDistro: WineDistribution): TaskProgram {
    yield ["setStateText", "UNINSTALLING_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    await dependencies.uninstallWineDistro(wineDistro.id);
    yield ["setStateText", "INSTALL_DONE"];
  }

  return { reset, initialize, enable, uninstall };
}

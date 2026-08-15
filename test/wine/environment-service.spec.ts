import { describe, expect, it, vi } from "vitest";
import type { TaskProgram } from "@tasks/task-program";
import {
  createWineEnvironmentService,
  type WineEnvironmentServiceDependencies,
} from "@wine/environment-service";

const distro = {
  id: "test-wine",
  displayName: "Test Wine",
  remoteUrl: "https://example.invalid/wine.tar.gz",
  attributes: {},
};

async function collect(program: AsyncGenerator<unknown>) {
  const commands: unknown[] = [];
  for await (const command of program) commands.push(command);
  return commands;
}

function createHarness(installed = false) {
  const installWineEnvironmentProgram = vi.fn(async function* (
    _options: Parameters<
      WineEnvironmentServiceDependencies["installWineEnvironmentProgram"]
    >[0]
  ): TaskProgram {
    yield ["setProgress", 12];
  });
  const configureWineEnvironmentProgram = vi.fn(async function* (
    _options: Parameters<
      WineEnvironmentServiceDependencies["configureWineEnvironmentProgram"]
    >[0]
  ): TaskProgram {
    yield ["setProgress", 99];
  });
  const setWineInstalled = vi.fn();
  const wine = {
    killAll: vi.fn(async () => undefined),
    setDistribution: vi.fn(async () => undefined),
  };
  const dependencies = {
    checkWine: vi.fn(),
    isWineDistroInstalled: vi.fn(async () => installed),
    uninstallWineDistro: vi.fn(async () => undefined),
    installWineEnvironmentProgram,
    configureWineEnvironmentProgram,
    removePrefix: vi.fn(async () => undefined),
  };
  const service = createWineEnvironmentService({
    aria2: {} as never,
    wine: wine as never,
    wineAbsPrefix: "/prefix",
    setWineInstalled,
    dependencies,
  });
  return { service, wine, dependencies, setWineInstalled };
}

describe("wine environment service", () => {
  it("resets the prefix after terminating Wine", async () => {
    const { service, wine, dependencies, setWineInstalled } = createHarness();
    await service.reset();
    expect(wine.killAll.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.removePrefix.mock.invocationCallOrder[0]
    );
    expect(dependencies.removePrefix).toHaveBeenCalledWith("/prefix");
    expect(setWineInstalled).toHaveBeenCalledWith(false);
  });

  it("installs before configuring an unavailable distribution", async () => {
    const { service, dependencies, wine, setWineInstalled } =
      createHarness(false);
    await expect(collect(service.enable(distro))).resolves.toEqual([
      ["setProgress", 12],
      ["setStateText", "CONFIGURING_ENVIRONMENT"],
      ["setUndeterminedProgress"],
      ["setProgress", 99],
    ]);
    expect(dependencies.installWineEnvironmentProgram).toHaveBeenCalledWith(
      expect.objectContaining({ activate: false, finishMessage: false })
    );
    expect(wine.setDistribution).toHaveBeenCalledWith(distro);
    expect(setWineInstalled).toHaveBeenCalledWith(true);
  });

  it("does not install an already available distribution", async () => {
    const { service, dependencies } = createHarness(true);
    await collect(service.enable(distro));
    expect(dependencies.installWineEnvironmentProgram).not.toHaveBeenCalled();
    expect(dependencies.configureWineEnvironmentProgram).toHaveBeenCalledOnce();
  });
});

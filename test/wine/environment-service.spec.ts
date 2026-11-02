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
    waitForWineServerExit: vi.fn(async () => true),
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

  it("rejects an unavailable distribution without changing the prefix", async () => {
    const { service, dependencies, wine, setWineInstalled } =
      createHarness(false);
    await expect(collect(service.enable(distro))).rejects.toThrow(
      "Wine distribution has not been downloaded"
    );
    expect(dependencies.installWineEnvironmentProgram).not.toHaveBeenCalled();
    expect(dependencies.configureWineEnvironmentProgram).not.toHaveBeenCalled();
    expect(wine.killAll).not.toHaveBeenCalled();
    expect(wine.setDistribution).not.toHaveBeenCalled();
    expect(setWineInstalled).not.toHaveBeenCalled();
  });

  it("stops the old Wine server before configuring an available distribution", async () => {
    const { service, dependencies, wine } = createHarness(true);
    await collect(service.enable(distro));
    expect(dependencies.installWineEnvironmentProgram).not.toHaveBeenCalled();
    expect(dependencies.configureWineEnvironmentProgram).toHaveBeenCalledOnce();
    expect(wine.killAll).toHaveBeenCalledOnce();
    expect(wine.waitForWineServerExit).toHaveBeenCalledWith({
      timeoutMs: 5_000,
    });
    expect(wine.killAll.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.configureWineEnvironmentProgram.mock.invocationCallOrder[0]
    );
    expect(wine.waitForWineServerExit.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.configureWineEnvironmentProgram.mock.invocationCallOrder[0]
    );
  });
});

describe("Wine shutdown failure", () => {
  it.each(["enable", "reset"] as const)(
    "does not mutate the environment after %s times out",
    async action => {
      const { service, wine, dependencies, setWineInstalled } =
        createHarness(true);
      wine.waitForWineServerExit.mockResolvedValue(false);
      await expect(
        action === "reset" ? service.reset() : collect(service.enable(distro))
      ).rejects.toThrow("Wine server did not exit");
      expect(dependencies.removePrefix).not.toHaveBeenCalled();
      expect(
        dependencies.configureWineEnvironmentProgram
      ).not.toHaveBeenCalled();
      expect(wine.setDistribution).not.toHaveBeenCalled();
      expect(setWineInstalled).not.toHaveBeenCalled();
    }
  );
});

describe("Wine environment tasks", () => {
  it("initializes and marks ready only after configuration and selection", async () => {
    const { service, dependencies, wine, setWineInstalled } = createHarness();
    await collect(service.initialize(distro));
    expect(dependencies.installWineEnvironmentProgram).toHaveBeenCalledWith(
      expect.objectContaining({ activate: false, finishMessage: false })
    );
    expect(wine.setDistribution).toHaveBeenCalledWith(distro);
    expect(wine.setDistribution.mock.invocationCallOrder[0]).toBeLessThan(
      setWineInstalled.mock.invocationCallOrder[0]
    );
    expect(setWineInstalled).toHaveBeenCalledWith(true);
  });
  it("preserves installation state when configuration fails", async () => {
    const { service, dependencies, wine, setWineInstalled } = createHarness();
    dependencies.configureWineEnvironmentProgram.mockImplementation(
      async function* () {
        throw new Error("configuration failed");
      }
    );
    await expect(collect(service.initialize(distro))).rejects.toThrow(
      "configuration failed"
    );
    expect(wine.setDistribution).not.toHaveBeenCalled();
    expect(setWineInstalled).not.toHaveBeenCalled();
  });
  it("downloads without activating the distribution", async () => {
    const { service, dependencies, wine, setWineInstalled } = createHarness();
    await collect(service.download(distro, "game"));
    expect(dependencies.installWineEnvironmentProgram).toHaveBeenCalledWith(
      expect.objectContaining({ activate: false, downloadKey: "game" })
    );
    expect(wine.setDistribution).not.toHaveBeenCalled();
    expect(setWineInstalled).not.toHaveBeenCalled();
  });
  it("does not report uninstall completion when removing the distribution fails", async () => {
    const { service, dependencies } = createHarness();
    dependencies.uninstallWineDistro.mockRejectedValueOnce(new Error("busy"));
    await expect(collect(service.uninstall(distro))).rejects.toThrow("busy");
    const commands = await collect(service.uninstall(distro));
    expect(commands.at(-1)).toEqual(["setStateText", "INSTALL_DONE"]);
    expect(dependencies.uninstallWineDistro).toHaveBeenCalledWith(distro.id);
  });
});

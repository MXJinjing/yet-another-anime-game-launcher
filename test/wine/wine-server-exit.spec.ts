import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: vi.fn(async () => false),
  getCPUInfo: vi.fn(async () => ({ arch: "arm64" })),
  removeFileIfExists: vi.fn(async () => undefined),
  resolve: vi.fn((path: string) =>
    path.startsWith("/") ? path : `/test/${path}`
  ),
  stats: vi.fn(async () => {
    throw new Error("not found");
  }),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("@runtime/command-runner", () => ({
  exec: vi.fn(async () => ({ exitCode: 0, stdOut: "", stdErr: "" })),
  exec2: vi.fn(async () => ({ exitCode: 0, stdOut: "", stdErr: "" })),
}));

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(async () => {
    throw new Error("missing");
  }),
  setKey: vi.fn(async () => undefined),
}));

import { fileOrDirExists } from "@platform/neutralino";
import { exec2 } from "@runtime/command-runner";
import { createWine } from "@wine/wine";

describe("Wine server shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fileOrDirExists).mockResolvedValue(false);
  });

  it("treats a missing wineserver binary as already stopped", async () => {
    const wine = await createWine({
      prefix: "/tmp/yaaglm-test-prefix",
      distro: {
        id: "test-wine",
        displayName: "Test Wine",
        remoteUrl: "https://example.invalid/wine.tar.xz",
        attributes: { renderBackend: "dxmt", winePath: "wine" },
      },
    });

    await expect(wine.waitForWineServerExit()).resolves.toBe(true);
    expect(exec2).not.toHaveBeenCalled();
  });
});

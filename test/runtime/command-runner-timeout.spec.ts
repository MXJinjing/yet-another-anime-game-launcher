import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/macos", () => ({
  runInSudo: (command: string) => command,
}));

vi.mock("@platform/neutralino", () => ({
  execCommand: vi.fn(),
  offSpawnedProcess: vi.fn(async () => undefined),
  onSpawnedProcess: vi.fn(async () => undefined),
  spawnProcess: vi.fn(async () => ({ id: 7, pid: 700 })),
  updateSpawnedProcess: vi.fn(async () => undefined),
}));

import * as processMocks from "@platform/neutralino";
import { exec2 } from "@runtime/command-runner";

describe("spawned command timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("terminates a spawned query that does not produce an exit event", async () => {
    vi.useFakeTimers();
    const result = exec2(["wine", "tasklist"], undefined, false, undefined, {
      timeoutMs: 100,
    });
    const rejection = expect(result).rejects.toThrow(
      "Command timed out after 100ms"
    );

    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(processMocks.updateSpawnedProcess).toHaveBeenCalledWith(7, "exit");
    expect(processMocks.offSpawnedProcess).toHaveBeenCalledOnce();
  });
});

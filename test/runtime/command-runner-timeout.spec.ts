import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/macos", () => ({
  runInSudo: (command: string, _prompt: string) => command,
}));

vi.mock("@platform/neutralino", () => ({
  execCommand: vi.fn(),
  offSpawnedProcess: vi.fn(async () => undefined),
  onSpawnedProcess: vi.fn(async () => undefined),
  spawnProcess: vi.fn(async () => ({ id: 7, pid: 700 })),
  updateSpawnedProcess: vi.fn(async () => undefined),
}));

import * as processMocks from "@platform/neutralino";
import { CommandFailedError, exec, exec2 } from "@runtime/command-runner";

describe("command failure reporting", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws a typed error for a non-zero exit of exec", async () => {
    vi.mocked(processMocks.execCommand).mockResolvedValueOnce({
      pid: 1,
      exitCode: 3,
      stdOut: "partial",
      stdErr: "broken",
    });

    const failure = exec(["false"]);
    await expect(failure).rejects.toBeInstanceOf(CommandFailedError);
    await expect(failure).rejects.toMatchObject({
      exitCode: 3,
      stdOut: "partial",
      stdErr: "broken",
    });
    await expect(failure).rejects.toThrow("Command return non-zero code (3)");
  });
});

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

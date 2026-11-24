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

  it("closes stdin and reports stderr chunks before the result", async () => {
    const onStdErr = vi.fn();
    const inputClosed = new Promise<void>(done => {
      vi.mocked(processMocks.updateSpawnedProcess)
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(async () => done());
    });
    const result = exec2(["helper"], undefined, false, undefined, {
      stdIn: "{}",
      onStdErr,
    });
    await inputClosed;
    expect(processMocks.updateSpawnedProcess).toHaveBeenNthCalledWith(
      2,
      7,
      "stdInEnd"
    );
    expect(processMocks.updateSpawnedProcess).toHaveBeenNthCalledWith(
      1,
      7,
      "stdIn",
      "{}"
    );
    const handle = vi.mocked(processMocks.onSpawnedProcess).mock.calls[0][0];
    const emit = (action: "stdErr" | "stdOut" | "exit", data: string) =>
      handle({
        detail: { id: 7, pid: 700, action, data },
      } as CustomEvent<Neutralino.os.SpawnProcessResult>);
    emit("stdErr", "progress");
    expect(onStdErr).toHaveBeenCalledWith("progress");
    emit("stdOut", "{}");
    emit("exit", "0");
    await expect(result).resolves.toMatchObject({
      stdOut: "{}",
      stdErr: "progress",
    });
    expect(processMocks.offSpawnedProcess).toHaveBeenCalledWith(handle);
  });
});

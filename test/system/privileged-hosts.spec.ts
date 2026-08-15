import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.fn(async () => ({
  exitCode: 0,
  pid: 1,
  stdErr: "",
  stdOut: "",
}));
const writeFile = vi.fn(async (_path: string, _data: string) => undefined);

vi.mock("@runtime/command-runner", () => ({
  exec,
}));

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
  warn: vi.fn(async () => undefined),
}));

vi.mock("@platform/shell", () => ({
  rawString: (value: string) => ({ _rawString_: value }),
}));

vi.mock("@platform/neutralino", () => ({
  resolve: (value: string) => value,
  writeFile,
}));

import { legacyBlockHosts } from "@system/privileged-hosts";

describe("legacy privileged hosts fallback", () => {
  beforeEach(() => {
    exec.mockClear();
    writeFile.mockClear();
  });

  it("treats an empty hosts list as a safe no-op", async () => {
    await legacyBlockHosts([], 20);
    expect(writeFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("writes validated entries as single-quoted data without nested sudo", async () => {
    await legacyBlockHosts(
      [
        ["example.com", "0.0.0.0"],
        ["api.example.com", "::1"],
      ],
      20
    );

    expect(writeFile).toHaveBeenCalledOnce();
    const script = writeFile.mock.calls[0][1];
    expect(script).toContain("ENTRY_0='0.0.0.0 example.com'");
    expect(script).toContain("ENTRY_1='::1 api.example.com'");
    expect(script).not.toContain("sudo bash -c");
    expect(exec).toHaveBeenCalledOnce();
  });

  it("rejects shell syntax before writing or requesting privileges", async () => {
    await expect(
      legacyBlockHosts([["$(touch${IFS}/tmp/owned)", "0.0.0.0"]], 20)
    ).rejects.toThrow("Invalid hosts entry");
    expect(writeFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, 0, 1.5, 3601])(
    "rejects invalid TTL %s",
    async ttl => {
      await expect(
        legacyBlockHosts([["example.com", "0.0.0.0"]], ttl)
      ).rejects.toThrow("Invalid hosts block TTL");
      expect(writeFile).not.toHaveBeenCalled();
    }
  );
});

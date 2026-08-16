import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.fn(async () => ({
  exitCode: 0,
  pid: 1,
  stdErr: "",
  stdOut: "",
}));
const env = vi.fn(async () => undefined as string | undefined);
const readFile = vi.fn(async () => "");
const writeFile = vi.fn(async () => undefined);

vi.mock("@runtime/command-runner", () => ({ exec }));
vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
  warn: vi.fn(async () => undefined),
}));
vi.mock("@platform/shell", () => ({
  rawString: (value: string) => ({ _rawString_: value }),
}));
vi.mock("@platform/neutralino", () => ({
  resolve: (value: string) => value,
  env,
  readFile,
  writeFile,
}));

describe("development Hosts Helper disablement", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("bypasses helper calls and uses the legacy fallback", async () => {
    const { ensurePrivilegedHosts, getPrivilegedHostsHelperStatus } =
      await import("@system/privileged-hosts");
    const fallback = vi.fn(async () => undefined);

    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(exec).not.toHaveBeenCalled();
    expect(await getPrivilegedHostsHelperStatus()).toBe("disabled");
  });

  it("does not allow install or uninstall operations", async () => {
    const {
      installPrivilegedHostsHelper,
      uninstallPrivilegedHostsHelper,
      getPrivilegedHostsHelperTokenRecoveryState,
    } = await import("@system/privileged-hosts");

    await expect(installPrivilegedHostsHelper()).rejects.toThrow(
      "disabled in development"
    );
    await expect(uninstallPrivilegedHostsHelper()).rejects.toThrow(
      "disabled in development"
    );
    await expect(getPrivilegedHostsHelperTokenRecoveryState()).resolves.toBe(
      "disabled"
    );
    expect(exec).not.toHaveBeenCalled();
  });
});

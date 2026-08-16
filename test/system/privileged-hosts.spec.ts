import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.fn(
  async (
    _cmd: string[],
    _env?: Record<string, string>,
    _sudo?: boolean
  ) => ({
    exitCode: 0,
    pid: 1,
    stdErr: "",
    stdOut: "",
  })
);
const writeFile = vi.fn(async (_path: string, _data: string) => undefined);
const env = vi.fn(async (_key: string): Promise<string | undefined> => undefined);
const readFile = vi.fn(async (_path: string) => "");

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
  env,
  readFile,
}));

const HELPER_BINARY = "./sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper";
const INSTALL_SCRIPT = "./sidecar/yaaglm-hosts-helper/install.sh";
const UNINSTALL_SCRIPT = "./sidecar/yaaglm-hosts-helper/uninstall.sh";
const BUNDLE_PATH = "/Applications/Yaaglm.app";
const BUNDLE_ID = "com.3shain.yaaglm.cn";
const VERSION = "1.0.0";
const TOKEN_PATH = "./tokens/com.3shain.yaaglm.cn.token";

const manifest = {
  bundleId: BUNDLE_ID,
  version: VERSION,
  appName: "Yaaglm",
  launcherPath: "MacOS/Yaaglm",
  launcherSha256: "ab".repeat(32),
  clientSha256: "cd".repeat(32),
  helperSha256: "ef".repeat(32),
};

function okResult(stdOut = "OK 1.0.0\n") {
  return { exitCode: 0, pid: 1, stdErr: "", stdOut };
}

function helperError(code: string) {
  return new Error(
    `Command return non-zero code (12) \n${HELPER_BINARY} --request ${BUNDLE_ID} ${VERSION} status --token-file ${TOKEN_PATH}\nStdOut:\n${code}\nStdErr:\n`
  );
}

function makeTrusted() {
  env.mockImplementation(async key =>
    key == "YAAGL_BUNDLE_PATH" ? BUNDLE_PATH : undefined
  );
  readFile.mockImplementation(async path =>
    path == "./build-manifest.json" ? JSON.stringify(manifest) : ""
  );
}

function callsFor(substr: string) {
  return exec.mock.calls.filter(call =>
    call[0].some((arg: string) => arg.includes(substr))
  );
}

// Each test imports a fresh module instance so the module-level "tampered"
// flag does not leak between tests.
async function loadModule() {
  return await import("@system/privileged-hosts");
}

function resetMocks() {
  vi.resetModules();
  vi.resetAllMocks();
  exec.mockResolvedValue(okResult());
  writeFile.mockResolvedValue(undefined);
  env.mockResolvedValue(undefined);
  readFile.mockResolvedValue("");
}

describe("legacy privileged hosts fallback", () => {
  beforeEach(resetMocks);

  it("treats an empty hosts list as a safe no-op", async () => {
    const { legacyBlockHosts } = await loadModule();
    await legacyBlockHosts([], 20);
    expect(writeFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("writes validated entries as single-quoted data without nested sudo", async () => {
    const { legacyBlockHosts } = await loadModule();
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
    const { legacyBlockHosts } = await loadModule();
    await expect(
      legacyBlockHosts([["$(touch${IFS}/tmp/owned)", "0.0.0.0"]], 20)
    ).rejects.toThrow("Invalid hosts entry");
    expect(writeFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, 0, 1.5, 3601])(
    "rejects invalid TTL %s",
    async ttl => {
      const { legacyBlockHosts } = await loadModule();
      await expect(
        legacyBlockHosts([["example.com", "0.0.0.0"]], ttl)
      ).rejects.toThrow("Invalid hosts block TTL");
      expect(writeFile).not.toHaveBeenCalled();
    }
  );
});

describe("untrusted runtime identity", () => {
  beforeEach(resetMocks);

  it("falls back to legacy without helper or install calls when YAAGL_BUNDLE_PATH is missing", async () => {
    const { ensurePrivilegedHosts } = await loadModule();
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).toHaveBeenCalledOnce();
    expect(exec).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("falls back to legacy when build-manifest.json is unreadable", async () => {
    env.mockResolvedValue(BUNDLE_PATH);
    readFile.mockRejectedValue(new Error("ENOENT"));
    const { ensurePrivilegedHosts } = await loadModule();
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).toHaveBeenCalledOnce();
    expect(exec).not.toHaveBeenCalled();
  });

  it("reports untrusted status without touching the helper", async () => {
    const { getPrivilegedHostsHelperStatus } = await loadModule();
    expect(await getPrivilegedHostsHelperStatus()).toBe("untrusted");
    expect(exec).not.toHaveBeenCalled();
  });

  it("refuses install without any install call", async () => {
    const { installPrivilegedHostsHelper } = await loadModule();
    await expect(installPrivilegedHostsHelper()).rejects.toThrow(
      "not trusted"
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("refuses uninstall without any install call", async () => {
    const { uninstallPrivilegedHostsHelper } = await loadModule();
    await expect(uninstallPrivilegedHostsHelper()).rejects.toThrow(
      "not trusted"
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("runPrivilegedHosts falls back directly when untrusted", async () => {
    const { runPrivilegedHosts } = await loadModule();
    const fallback = vi.fn(async () => undefined);
    await runPrivilegedHosts(
      ["--request", BUNDLE_ID, VERSION, "status", "--token-file", TOKEN_PATH],
      fallback
    );
    expect(fallback).toHaveBeenCalledOnce();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("trusted helper arguments", () => {
  beforeEach(() => {
    resetMocks();
    makeTrusted();
  });

  it("passes bundle id, version, action and token file path to the helper", async () => {
    const { ensurePrivilegedHosts } = await loadModule();
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).not.toHaveBeenCalled();

    const statusCall = callsFor("status")[0];
    expect(statusCall).toBeDefined();
    expect(statusCall[0]).toEqual([
      HELPER_BINARY,
      "--request",
      BUNDLE_ID,
      VERSION,
      "status",
      "--token-file",
      TOKEN_PATH,
    ]);

    const ensureCall = callsFor("ensure")[0];
    expect(ensureCall).toBeDefined();
    expect(ensureCall[0]).toEqual([
      HELPER_BINARY,
      "--request",
      BUNDLE_ID,
      VERSION,
      "ensure",
      "0.0.0.0",
      "example.com",
      "--token-file",
      TOKEN_PATH,
    ]);
    // Non-sudo helper requests are not wrapped in an administrator prompt.
    expect(ensureCall[2]).toBeUndefined();
  });

  it("passes ttl then ip/domain pairs for block", async () => {
    const { blockPrivilegedHosts } = await loadModule();
    await blockPrivilegedHosts(
      [["example.com", "0.0.0.0"]],
      15,
      vi.fn(async () => undefined)
    );
    const blockCall = callsFor("block")[0];
    expect(blockCall).toBeDefined();
    expect(blockCall[0]).toEqual([
      HELPER_BINARY,
      "--request",
      BUNDLE_ID,
      VERSION,
      "block",
      "15",
      "0.0.0.0",
      "example.com",
      "--token-file",
      TOKEN_PATH,
    ]);
  });

  it("passes unblock without extra args", async () => {
    const { unblockPrivilegedHosts } = await loadModule();
    await unblockPrivilegedHosts();
    const unblockCall = callsFor("unblock")[0];
    expect(unblockCall).toBeDefined();
    expect(unblockCall[0]).toEqual([
      HELPER_BINARY,
      "--request",
      BUNDLE_ID,
      VERSION,
      "unblock",
      "--token-file",
      TOKEN_PATH,
    ]);
  });

  it("never puts token content into any exec argument", async () => {
    const { ensurePrivilegedHosts } = await loadModule();
    await ensurePrivilegedHosts(
      [
        ["example.com", "0.0.0.0"],
        ["api.example.com", "::1"],
      ],
      vi.fn(async () => undefined)
    );
    expect(exec).toHaveBeenCalled();
    for (const call of exec.mock.calls) {
      expect(
        call[0].some((arg: string) => /^[0-9a-f]{64}$/.test(arg))
      ).toBe(false);
    }
    for (const call of exec.mock.calls) {
      const args = call[0] as string[];
      if (args.includes("--request")) {
        const tokenIndex = args.indexOf("--token-file");
        expect(tokenIndex).toBeGreaterThan(0);
        expect(args[tokenIndex + 1]).toBe(TOKEN_PATH);
      }
    }
  });

  it("reports running when STATUS responds OK", async () => {
    const { getPrivilegedHostsHelperStatus } = await loadModule();
    expect(await getPrivilegedHostsHelperStatus()).toBe("running");
  });

  it("installs with bundle and helper paths through sudo", async () => {
    const { installPrivilegedHostsHelper } = await loadModule();
    await installPrivilegedHostsHelper();
    const installCalls = callsFor("install.sh");
    expect(installCalls).toHaveLength(1);
    expect(installCalls[0][0]).toEqual([
      "/bin/sh",
      INSTALL_SCRIPT,
      "--bundle",
      BUNDLE_PATH,
      "--helper",
      HELPER_BINARY,
    ]);
    expect(installCalls[0][2]).toBe(true);
  });

  it("uninstalls with the bundle id through sudo", async () => {
    const { uninstallPrivilegedHostsHelper } = await loadModule();
    await uninstallPrivilegedHostsHelper();
    const uninstallCalls = callsFor("uninstall.sh");
    expect(uninstallCalls).toHaveLength(1);
    expect(uninstallCalls[0][0]).toEqual([
      "/bin/sh",
      UNINSTALL_SCRIPT,
      BUNDLE_ID,
    ]);
    expect(uninstallCalls[0][2]).toBe(true);
  });
});

describe("ensureHelperReady dispatch", () => {
  beforeEach(() => {
    resetMocks();
    makeTrusted();
  });

  it("reinstalls and retries once on ERR_UNREGISTERED", async () => {
    const { ensurePrivilegedHosts } = await loadModule();
    exec
      .mockResolvedValueOnce(okResult()) // test -x helper
      .mockRejectedValueOnce(helperError("ERR_UNREGISTERED")); // STATUS
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).not.toHaveBeenCalled();

    const installCalls = callsFor("install.sh");
    expect(installCalls).toHaveLength(1);
    expect(installCalls[0][0]).toEqual([
      "/bin/sh",
      INSTALL_SCRIPT,
      "--bundle",
      BUNDLE_PATH,
      "--helper",
      HELPER_BINARY,
    ]);
    expect(installCalls[0][2]).toBe(true);

    // STATUS was retried once after the install.
    expect(callsFor("status")).toHaveLength(2);
    expect(callsFor("ensure")).toHaveLength(1);
  });

  it("reinstalls and retries once on ERR_VERSION_MISMATCH", async () => {
    const { ensurePrivilegedHosts } = await loadModule();
    exec
      .mockResolvedValueOnce(okResult()) // test -x helper
      .mockRejectedValueOnce(helperError("ERR_VERSION_MISMATCH")); // STATUS
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).not.toHaveBeenCalled();
    expect(callsFor("install.sh")).toHaveLength(1);
    expect(callsFor("status")).toHaveLength(2);
    expect(callsFor("ensure")).toHaveLength(1);
  });

  it("reinstalls and retries once when STATUS reports a drifted version", async () => {
    const { ensurePrivilegedHosts } = await loadModule();
    exec
      .mockResolvedValueOnce(okResult()) // test -x helper
      .mockResolvedValueOnce(okResult("OK 0.9.0\n")) // STATUS: drifted
      .mockResolvedValueOnce(okResult()) // install.sh
      .mockResolvedValueOnce(okResult("OK 1.0.0\n")); // retried STATUS
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).not.toHaveBeenCalled();
    expect(callsFor("install.sh")).toHaveLength(1);
    expect(callsFor("status")).toHaveLength(2);
    expect(callsFor("ensure")).toHaveLength(1);
  });

  it("does not reinstall on ERR_TAMPERED and marks the helper as tampered", async () => {
    const { ensurePrivilegedHosts, getPrivilegedHostsHelperStatus } =
      await loadModule();
    exec
      .mockResolvedValueOnce(okResult()) // test -x helper
      .mockRejectedValueOnce(helperError("ERR_TAMPERED")); // STATUS
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).toHaveBeenCalledOnce();
    expect(callsFor("install.sh")).toHaveLength(0);
    expect(await getPrivilegedHostsHelperStatus()).toBe("tampered");

    // Subsequent attempts must not contact the helper or re-register.
    exec.mockClear();
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(exec).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it.each(["ERR_UNAUTHORIZED", "ERR_RATE_LIMITED"])(
    "falls back without reinstalling on %s",
    async code => {
      const { ensurePrivilegedHosts } = await loadModule();
      exec
        .mockResolvedValueOnce(okResult()) // test -x helper
        .mockRejectedValueOnce(helperError(code)); // STATUS
      const fallback = vi.fn(async () => undefined);
      await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
      expect(fallback).toHaveBeenCalledOnce();
      expect(callsFor("install.sh")).toHaveLength(0);
    }
  );

  it("falls back when the bundled helper binary is missing without compiling", async () => {
    const { ensurePrivilegedHosts } = await loadModule();
    exec.mockRejectedValue(
      new Error(
        "Command return non-zero code (127) \n/bin/sh: test: command not found"
      )
    );
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).toHaveBeenCalledOnce();
    expect(exec.mock.calls.some(call => call[0][0] == "cc")).toBe(false);
    expect(callsFor("install.sh")).toHaveLength(0);
  });

  it("falls back when the retried STATUS still reports a drifted version", async () => {
    const { ensurePrivilegedHosts } = await loadModule();
    exec
      .mockResolvedValueOnce(okResult()) // test -x helper
      .mockResolvedValueOnce(okResult("OK 0.9.0\n")) // STATUS: drifted
      .mockResolvedValueOnce(okResult()) // install.sh
      .mockResolvedValueOnce(okResult("OK 0.9.0\n")); // retried STATUS still drifted
    const fallback = vi.fn(async () => undefined);
    await ensurePrivilegedHosts([["example.com", "0.0.0.0"]], fallback);
    expect(fallback).toHaveBeenCalledOnce();
    expect(callsFor("install.sh")).toHaveLength(1);
  });
});

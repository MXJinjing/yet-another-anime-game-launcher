import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async (_path: string) => "");
const ensurePrivilegedHosts = vi.fn(async () => undefined);
const legacyEnsureHosts = vi.fn(async () => undefined);

vi.mock("@platform/neutralino", () => ({ readFile }));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));
vi.mock("@platform/shell", () => ({ rawString: (value: string) => value }));
vi.mock("@locale/authorization", () => ({
  getAuthorizationPrompt: vi.fn(async () => undefined),
}));
vi.mock("@logging/logger", () => ({ warn: vi.fn() }));
vi.mock("@system/privileged-hosts", () => ({
  ensurePrivilegedHosts,
  legacyEnsureHosts,
}));

describe("ensureHosts", () => {
  beforeEach(() => {
    readFile.mockReset();
    ensurePrivilegedHosts.mockClear();
    legacyEnsureHosts.mockClear();
  });

  it("defines both IPv4 and IPv6 rules for every persistent host", async () => {
    const { ENSURE_HOSTS } = await import("@system/ensure-hosts");
    const domains = [...new Set(ENSURE_HOSTS.map(([domain]) => domain))];
    for (const domain of domains) {
      expect(ENSURE_HOSTS).toContainEqual([domain, "0.0.0.0"]);
      expect(ENSURE_HOSTS).toContainEqual([domain, "::1"]);
    }
  });

  it("does not refresh an unchanged persistent section", async () => {
    const hosts = [
      "127.0.0.1 localhost\n",
      "# Added by Yaaglm\n",
      "# Warning: any content in this section will be overwritten\n",
      "0.0.0.0 example.com\n",
      "::1 example.com\n",
      "# End of section\n",
    ].join("");
    readFile.mockResolvedValue(hosts);

    const { ensureHosts } = await import("@system/hosts");
    await ensureHosts([
      ["example.com", "0.0.0.0"],
      ["example.com", "::1"],
    ]);

    expect(ensurePrivilegedHosts).not.toHaveBeenCalled();
    expect(legacyEnsureHosts).not.toHaveBeenCalled();
  });
});

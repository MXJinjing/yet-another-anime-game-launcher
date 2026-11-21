import { beforeEach, describe, expect, it, vi } from "vitest";

// The control module only needs the prefix probe here; rendering is out of
// scope, so the UI kit (and its browser-only scroll-lock side effect) stays
// out of this test process entirely.
vi.mock("@hope-ui/solid", () => ({
  Box: () => null,
  Button: () => null,
  Input: () => null,
  Text: () => null,
}));

vi.mock("@src/integrations/github", async () => {
  const actual = await vi.importActual<
    typeof import("@src/integrations/github")
  >("@src/integrations/github");
  return { ...actual, testGithubPrefix: vi.fn() };
});

import { testGithubPrefix } from "@src/integrations/github";
import { probeGithubPrefix } from "@src/settings/controls/download/github-accelerated-prefix";

describe("GitHub acceleration prefix setting", () => {
  beforeEach(() => {
    vi.mocked(testGithubPrefix).mockReset();
  });

  it("reports an invalid prefix without probing it", async () => {
    await expect(probeGithubPrefix("not a url")).resolves.toBe("invalid");
    expect(testGithubPrefix).not.toHaveBeenCalled();
  });

  it("contains a failed probe instead of letting it escape the settings screen", async () => {
    vi.mocked(testGithubPrefix).mockRejectedValueOnce(new Error("timeout"));

    await expect(probeGithubPrefix("https://proxy.example")).resolves.toBe(
      "failed"
    );
  });

  it("reports a reachable prefix as connected", async () => {
    vi.mocked(testGithubPrefix).mockResolvedValueOnce(undefined);

    await expect(probeGithubPrefix("https://proxy.example")).resolves.toBe(
      "connected"
    );
    expect(testGithubPrefix).toHaveBeenCalledWith("https://proxy.example");
  });
});

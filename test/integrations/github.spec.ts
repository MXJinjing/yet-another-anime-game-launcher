import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(async () => null),
  setKey: vi.fn(async () => undefined),
  globalStorage: {
    getKey: vi.fn(async () => null),
    getKeyOrDefault: vi.fn(async () => null),
    setKey: vi.fn(async () => undefined),
  },
}));
vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
  warn: vi.fn(async () => undefined),
  logerror: vi.fn(async () => undefined),
}));

import { globalStorage } from "@runtime/storage";
import {
  applyGithubPrefix,
  createGithubEndpoint,
  DEFAULT_GITHUB_PREFIX,
  GithubRequestError,
  getGithubErrorStatus,
  configureGithubEndpoint,
  normalizeGithubPrefix,
  testGithubPrefix,
} from "@src/integrations/github";
import {
  getStartupNotices,
  resetStartupNotices,
} from "@src/runtime/startup-notices";

const TEST_GITHUB_PREFIX = "https://proxy.example/";

describe("GitHub acceleration prefix", () => {
  beforeEach(() => {
    resetStartupNotices();
    vi.mocked(globalStorage.getKey).mockReset();
    vi.mocked(globalStorage.getKey).mockResolvedValue(null);
    vi.unstubAllGlobals();
    configureGithubEndpoint({
      enabled: false,
      prefix: TEST_GITHUB_PREFIX,
    });
  });

  it("normalizes a proxy root and adds a trailing slash", () => {
    expect(normalizeGithubPrefix(" https://proxy.example/gh ")).toBe(
      "https://proxy.example/gh/"
    );
    expect(normalizeGithubPrefix("https://proxy.example/gh?x=1")).toBeNull();
  });

  it("only prefixes GitHub URLs when enabled", () => {
    const githubUrl = "https://github.com/hunshcn/gh-proxy";
    const otherUrl = "https://example.com/file.zip";

    expect(applyGithubPrefix(githubUrl)).toBe(githubUrl);
    expect(applyGithubPrefix(otherUrl)).toBe(otherUrl);

    configureGithubEndpoint({ enabled: true, prefix: TEST_GITHUB_PREFIX });
    expect(applyGithubPrefix(githubUrl)).toBe(
      `${TEST_GITHUB_PREFIX}${githubUrl}`
    );
    expect(applyGithubPrefix(otherUrl)).toBe(otherUrl);
  });

  it("does not prefix an already accelerated URL twice", () => {
    configureGithubEndpoint({ enabled: true, prefix: TEST_GITHUB_PREFIX });
    const accelerated = `${TEST_GITHUB_PREFIX}https://github.com/file.zip`;

    expect(applyGithubPrefix(accelerated)).toBe(accelerated);
  });

  it("preserves an HTTP status code for update failure notifications", () => {
    const error = new GithubRequestError(
      503,
      "Service Unavailable",
      "https://api.github.com"
    );

    expect(getGithubErrorStatus(error)).toBe(503);
    expect(getGithubErrorStatus(new Error("network failure"))).toBeUndefined();
  });

  it("tests the configured prefix through the GitHub API endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);

    await testGithubPrefix("https://proxy.example");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://proxy.example/https://api.github.com/octocat"
    );
    vi.unstubAllGlobals();
  });

  it("disables acceleration instead of throwing on an invalid prefix", () => {
    const result = configureGithubEndpoint({
      enabled: true,
      prefix: "not a url",
    });

    expect(result).toBe(DEFAULT_GITHUB_PREFIX);
    expect(applyGithubPrefix("https://api.github.com/repos")).toBe(
      "https://api.github.com/repos"
    );
    expect(getStartupNotices()).toEqual([
      { id: "github-prefix-disabled", detail: "invalid prefix: not a url" },
    ]);
  });

  it("boots against api.github.com when the stored prefix is invalid", async () => {
    vi.mocked(globalStorage.getKey).mockImplementation(async (key: string) => {
      if (key === "config_github_accelerated_prefix_enabled") return "true";
      if (key === "config_github_accelerated_prefix") return "ftp://proxy";
      return null;
    });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      url: "https://api.github.com/repos/example",
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const github = await createGithubEndpoint();

    await expect(github.api("/repos/example")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/example"
    );
    expect(getStartupNotices().map(notice => notice.id)).toContain(
      "github-prefix-disabled"
    );
  });

  it("falls back to the direct API once and drops the prefix for the session", async () => {
    configureGithubEndpoint({ enabled: true, prefix: TEST_GITHUB_PREFIX });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 502,
        statusText: "Bad Gateway",
        url: `${TEST_GITHUB_PREFIX}https://api.github.com/repos/example`,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        url: "https://api.github.com/repos/example",
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const github = await createGithubEndpoint();
    // createGithubEndpoint re-applies the stored (disabled) configuration, so
    // enable acceleration again for the request under test.
    configureGithubEndpoint({ enabled: true, prefix: TEST_GITHUB_PREFIX });

    await expect(github.api("/repos/example")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/example"
    );
    // Session-scoped: the next URL is no longer accelerated.
    expect(applyGithubPrefix("https://api.github.com/repos/other")).toBe(
      "https://api.github.com/repos/other"
    );
    expect(getStartupNotices().map(notice => notice.id)).toContain(
      "github-prefix-disabled"
    );
  });

  it("surfaces the accelerated request error when the direct fallback also fails", async () => {
    configureGithubEndpoint({ enabled: true, prefix: TEST_GITHUB_PREFIX });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 504,
      statusText: "Gateway Timeout",
      url: `${TEST_GITHUB_PREFIX}https://api.github.com/repos/example`,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const github = await createGithubEndpoint();
    configureGithubEndpoint({ enabled: true, prefix: TEST_GITHUB_PREFIX });

    const failure = github.api("/repos/example");
    await expect(failure).rejects.toBeInstanceOf(GithubRequestError);
    await expect(failure).rejects.toMatchObject({ status: 504 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

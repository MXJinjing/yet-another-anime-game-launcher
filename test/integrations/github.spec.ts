import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyGithubPrefix,
  GithubRequestError,
  getGithubErrorStatus,
  configureGithubEndpoint,
  DEFAULT_GITHUB_PREFIX,
  normalizeGithubPrefix,
  testGithubPrefix,
} from "@src/integrations/github";

describe("GitHub acceleration prefix", () => {
  beforeEach(() => {
    configureGithubEndpoint({
      enabled: false,
      prefix: DEFAULT_GITHUB_PREFIX,
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

    configureGithubEndpoint({ enabled: true, prefix: DEFAULT_GITHUB_PREFIX });
    expect(applyGithubPrefix(githubUrl)).toBe(
      `${DEFAULT_GITHUB_PREFIX}${githubUrl}`
    );
    expect(applyGithubPrefix(otherUrl)).toBe(otherUrl);
  });

  it("does not prefix an already accelerated URL twice", () => {
    configureGithubEndpoint({ enabled: true, prefix: DEFAULT_GITHUB_PREFIX });
    const accelerated = `${DEFAULT_GITHUB_PREFIX}https://github.com/file.zip`;

    expect(applyGithubPrefix(accelerated)).toBe(accelerated);
  });

  it("preserves an HTTP status code for update failure notifications", () => {
    const error = new GithubRequestError(503, "Service Unavailable", "https://api.github.com");

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
});

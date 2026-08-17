import { configEntries, createConfigStore } from "@config";
import { log } from "../logging/logger";
import { timeout } from "../runtime/async";

export const DEFAULT_GITHUB_PREFIX = "https://ghp.3shain.uk/";
const GITHUB_API_URL = "https://api.github.com/octocat";

export class GithubRequestError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly url: string
  ) {
    super(`Request failed: ${status} ${statusText} (${url})`);
    this.name = "GithubRequestError";
  }
}

export function getGithubErrorStatus(error: unknown): number | undefined {
  return error instanceof GithubRequestError ? error.status : undefined;
}
const GITHUB_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
]);

type GithubEndpointConfig = {
  enabled: boolean;
  prefix: string;
};

let githubEndpointConfig: GithubEndpointConfig = {
  enabled: false,
  prefix: DEFAULT_GITHUB_PREFIX,
};

/**
 * Normalizes the proxy root used by gh-proxy-compatible endpoints.
 * The proxy root must be a plain HTTP(S) URL without query parameters or a
 * fragment; the trailing slash is added for URL concatenation.
 */
export function normalizeGithubPrefix(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol != "http:" && parsed.protocol != "https:") {
      return null;
    }
    if (!parsed.hostname || parsed.search || parsed.hash) return null;

    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function configureGithubEndpoint(config: {
  enabled: boolean;
  prefix: string;
}): string {
  const prefix = normalizeGithubPrefix(config.prefix);
  if (!prefix) {
    throw new Error("Invalid GitHub acceleration prefix");
  }

  githubEndpointConfig = {
    enabled: config.enabled,
    prefix,
  };
  return prefix;
}

function isGithubUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol == "http:" || parsed.protocol == "https:") &&
      GITHUB_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** Applies the currently configured prefix without changing the source URL. */
export function applyGithubPrefix(url: string): string {
  if (!githubEndpointConfig.enabled || !isGithubUrl(url)) return url;
  if (url.startsWith(githubEndpointConfig.prefix)) return url;
  return `${githubEndpointConfig.prefix}${url}`;
}

async function checkGithubEndpoint(prefix: string): Promise<void> {
  const response = await Promise.race([
    fetch(`${prefix}${GITHUB_API_URL}`),
    timeout(5000),
  ]);
  if (response.status < 200 || response.status >= 400) {
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}`
    );
  }
}

export async function testGithubPrefix(value: string): Promise<void> {
  const prefix = normalizeGithubPrefix(value);
  if (!prefix) {
    throw new Error("Invalid GitHub acceleration prefix");
  }
  await checkGithubEndpoint(prefix);
}

export async function createGithubEndpoint() {
  const store = createConfigStore();
  const enabled =
    (await store.read(configEntries.githubAcceleratedPrefixEnabled)) ?? false;
  const storedPrefix =
    (await store.read(configEntries.githubAcceleratedPrefix)) ??
    DEFAULT_GITHUB_PREFIX;
  const prefix = normalizeGithubPrefix(storedPrefix) ?? DEFAULT_GITHUB_PREFIX;

  configureGithubEndpoint({ enabled, prefix });
  await log(
    githubEndpointConfig.enabled
      ? `Using github proxy ${githubEndpointConfig.prefix}`
      : "Github acceleration is disabled"
  );

  function api(path: `/${string}`): Promise<unknown> {
    return fetch(applyGithubPrefix(`https://api.github.com${path}`)).then(x => {
      if (x.status == 200 || x.status == 301 || x.status == 302) {
        return x.json();
      }
      return Promise.reject(
        new GithubRequestError(x.status, x.statusText, x.url)
      );
    });
  }

  function acceleratedPath(path: string) {
    return applyGithubPrefix(path);
  }

  return {
    api,
    acceleratedPath,
  };
}

export type Github = ReturnType<typeof createGithubEndpoint> extends Promise<
  infer T
>
  ? T
  : never;

export interface GithubReleaseInfo {
  url: string;
  html_url: string;
  assets_url: string;
  id: number;
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string;
  author: unknown;
  assets: GithubReleaseAssetsInfo[];
}

export interface GithubReleaseAssetsInfo {
  url: string;
  browser_download_url: string;
  id: number;
  name: string;
  content_type: string;
}

export type GithubReleases = GithubReleaseInfo[];

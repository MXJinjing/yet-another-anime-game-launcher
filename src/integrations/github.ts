import { configEntries, createConfigStore } from "@config";
import { log } from "../logging/logger";
import { timeout } from "../runtime/async";
import { pushStartupNotice } from "../runtime/startup-notices";

/** GitHub acceleration is opt-in; no proxy endpoint is selected by default. */
export const DEFAULT_GITHUB_PREFIX = "";
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

/**
 * Applies the acceleration configuration.
 *
 * Acceleration only decorates a connection that already works against GitHub,
 * so this never throws: an unusable prefix disables acceleration and boot
 * continues against api.github.com. The reason is logged once and raised as a
 * startup notice so the degradation stays visible without blocking startup.
 */
export function configureGithubEndpoint(config: {
  enabled: boolean;
  prefix: string;
}): string {
  const normalized = normalizeGithubPrefix(config.prefix);
  if (config.enabled && !normalized) {
    void log(
      `Invalid GitHub acceleration prefix "${config.prefix}"; acceleration disabled`
    );
    pushStartupNotice(
      "github-prefix-disabled",
      `invalid prefix: ${config.prefix || "(empty)"}`
    );
  }

  githubEndpointConfig = {
    enabled: config.enabled && normalized !== null,
    prefix: normalized ?? DEFAULT_GITHUB_PREFIX,
  };
  return githubEndpointConfig.prefix;
}

/** Drops acceleration for the rest of the session without touching settings. */
function disableGithubAcceleration(reason: string) {
  if (!githubEndpointConfig.enabled) return;
  githubEndpointConfig = { enabled: false, prefix: DEFAULT_GITHUB_PREFIX };
  void log(`GitHub acceleration disabled for this session: ${reason}`);
  pushStartupNotice("github-prefix-disabled", reason);
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

/**
 * Applies the currently configured prefix without changing the source URL.
 * A prefix is only prepended when acceleration is enabled AND the stored
 * prefix is still a valid proxy root, so a partially applied configuration
 * can never produce a malformed request URL.
 */
export function applyGithubPrefix(url: string): string {
  const { enabled, prefix } = githubEndpointConfig;
  if (!enabled || !prefix || !isGithubUrl(url)) return url;
  if (normalizeGithubPrefix(prefix) !== prefix) return url;
  if (url.startsWith(prefix)) return url;
  return `${prefix}${url}`;
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
  // Hand the raw value over: configureGithubEndpoint owns validation so an
  // invalid stored prefix is reported exactly once and never aborts boot.
  configureGithubEndpoint({ enabled, prefix: storedPrefix });
  await log(
    githubEndpointConfig.enabled
      ? `Using github proxy ${githubEndpointConfig.prefix}`
      : "Github acceleration is disabled"
  );

  async function request(url: string): Promise<unknown> {
    const response = await fetch(url);
    if (
      response.status == 200 ||
      response.status == 301 ||
      response.status == 302
    ) {
      return response.json();
    }
    return Promise.reject(
      new GithubRequestError(response.status, response.statusText, response.url)
    );
  }

  async function api(path: `/${string}`): Promise<unknown> {
    const directUrl = `https://api.github.com${path}`;
    const acceleratedUrl = applyGithubPrefix(directUrl);
    if (acceleratedUrl === directUrl) return request(directUrl);

    try {
      return await request(acceleratedUrl);
    } catch (error) {
      // A failing accelerator is not a launcher failure: retry GitHub
      // directly once and keep the session usable.
      await log(
        `GitHub request through the acceleration prefix failed (${String(
          error
        )}); retrying directly`
      );
      try {
        const result = await request(directUrl);
        disableGithubAcceleration(`request through ${acceleratedUrl} failed`);
        return result;
      } catch {
        // Both paths failed: surface the accelerated-path error unchanged so
        // callers keep treating it as a recoverable update-check failure.
        throw error;
      }
    }
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

import { Config } from "@config/config-def";
import {
  isValidHostDomain,
  isValidHostIp,
  validateHostEntries,
} from "../../system/hosts-validation";

declare module "@config/config-def" {
  interface Config {
    blockNetHostsText: string;
  }
}

export interface BlockHost {
  domain: string;
  ip: string;
}

export const OPEN_GLOBAL_SETTINGS_EVENT = "yaaglm:open-global-settings";

export function parseBlockHostsText(text: string): BlockHost[] {
  const lines = text.split(/\r?\n/);
  const hosts: BlockHost[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const [domain, ip] = parts;
    if (
      parts.length !== 2 ||
      !isValidHostDomain(domain) ||
      !isValidHostIp(ip)
    ) {
      throw new Error(
        `Invalid block hosts entry on line ${
          i + 1
        }: expected "domain ip", got "${line}"`
      );
    }
    hosts.push({ domain, ip });
  }
  return hosts;
}

export function getDefaultBlockHostsText(defaultHosts: BlockHost[]): string {
  return defaultHosts.map(({ domain, ip }) => `${domain} ${ip}`).join("\n");
}

export function buildBlockHosts(
  config: Config,
  defaultHosts: BlockHost[]
): [string, string][] {
  const text = config.blockNetHostsText;
  if (text == null) {
    const hosts = defaultHosts.map(
      ({ domain, ip }) => [domain, ip] as [string, string]
    );
    validateHostEntries(hosts);
    return hosts;
  }
  return parseBlockHostsText(text).map(
    ({ domain, ip }) => [domain, ip] as [string, string]
  );
}

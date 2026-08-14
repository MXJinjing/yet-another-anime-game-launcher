import { Config } from "@config/config-def";

declare module "@config/config-def" {
  interface Config {
    blockNetHostsText: string;
  }
}

export interface BlockHost {
  domain: string;
  ip: string;
}

export const OPEN_GLOBAL_SETTINGS_EVENT = "yaagl:open-global-settings";

const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_PATTERN =
  /^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::)$/;

function isValidDomain(domain: string) {
  return domain.length > 0 && domain.length <= 253;
}

function isValidIp(ip: string) {
  return IPV4_PATTERN.test(ip) || IPV6_PATTERN.test(ip);
}

export function parseBlockHostsText(text: string): BlockHost[] {
  const lines = text.split(/\r?\n/);
  const hosts: BlockHost[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const [domain, ip] = parts;
    if (parts.length !== 2 || !isValidDomain(domain) || !isValidIp(ip)) {
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
    return defaultHosts.map(
      ({ domain, ip }) => [domain, ip] as [string, string]
    );
  }
  return parseBlockHostsText(text).map(
    ({ domain, ip }) => [domain, ip] as [string, string]
  );
}

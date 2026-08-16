import { isValidHostDomain, isValidHostIp } from "@system/hosts-validation";

export interface BlockHostRule {
  enabled: boolean;
  domain: string;
}

const BLOCK_HOST_IPV4 = "0.0.0.0";
const BLOCK_HOST_IPV6 = "::1";

type LegacyBlockHost = {
  domain: string;
  ip: string;
};

function normalizeBlockHostRules(rules: BlockHostRule[]): BlockHostRule[] {
  const normalized = new Map<string, BlockHostRule>();
  for (const rule of rules) {
    if (
      !rule ||
      typeof rule.enabled != "boolean" ||
      typeof rule.domain != "string"
    ) {
      throw new Error("Invalid block hosts rule");
    }
    const domain = rule.domain.trim();
    const previous = normalized.get(domain);
    if (previous) {
      previous.enabled ||= rule.enabled;
    } else {
      normalized.set(domain, { enabled: rule.enabled, domain });
    }
  }
  return [...normalized.values()];
}

function parseLegacyBlockHostsText(text: string): LegacyBlockHost[] {
  const lines = text.split(/\r?\n/);
  const hosts: LegacyBlockHost[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const [domain, ip] = parts;
    if (parts.length != 2 || !isValidHostDomain(domain) || !isValidHostIp(ip)) {
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

export function parseBlockHostRulesText(text: string): BlockHostRule[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("Invalid block hosts rules JSON");
    }
    return normalizeBlockHostRules(parsed as BlockHostRule[]);
  }
  return normalizeBlockHostRules(
    parseLegacyBlockHostsText(text).map(({ domain }) => ({
      enabled: true,
      domain,
    }))
  );
}

export function serializeBlockHostRules(rules: BlockHostRule[]): string {
  return JSON.stringify(normalizeBlockHostRules(rules));
}

export function serializeEnabledBlockHostsText(rules: BlockHostRule[]): string {
  return rules
    .filter(rule => rule.enabled && isValidHostDomain(rule.domain.trim()))
    .flatMap(({ domain }) => {
      const normalizedDomain = domain.trim();
      return [
        `${normalizedDomain} ${BLOCK_HOST_IPV4}`,
        `${normalizedDomain} ${BLOCK_HOST_IPV6}`,
      ];
    })
    .join("\n");
}

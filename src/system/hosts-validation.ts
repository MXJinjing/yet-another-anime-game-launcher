export type HostEntry = [domain: string, ip: string];

const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_PATTERN =
  /^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::)$/;

export function isValidHostDomain(domain: string): boolean {
  if (domain.length == 0 || domain.length > 253) return false;
  const withoutRootDot = domain.endsWith(".") ? domain.slice(0, -1) : domain;
  if (!withoutRootDot) return false;
  return withoutRootDot.split(".").every(label => {
    return (
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
    );
  });
}

export function isValidHostIp(ip: string): boolean {
  return IPV4_PATTERN.test(ip) || IPV6_PATTERN.test(ip);
}

export function validateHostEntries(hosts: HostEntry[]): void {
  if (!Array.isArray(hosts) || hosts.length > 64) {
    throw new Error("Invalid hosts entry count");
  }
  for (const entry of hosts) {
    if (
      !Array.isArray(entry) ||
      entry.length != 2 ||
      typeof entry[0] != "string" ||
      typeof entry[1] != "string"
    ) {
      throw new Error("Invalid hosts entry");
    }
    const [domain, ip] = entry;
    if (!isValidHostDomain(domain) || !isValidHostIp(ip)) {
      throw new Error(`Invalid hosts entry: ${domain} ${ip}`);
    }
  }
}

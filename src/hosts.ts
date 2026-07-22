import { ensurePrivilegedHosts, legacyEnsureHosts } from "./privileged-hosts";

export async function ensureHosts(hosts: [string, string][]) {
  await ensurePrivilegedHosts(hosts, () => legacyEnsureHosts(hosts));
}

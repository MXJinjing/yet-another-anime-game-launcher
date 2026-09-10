import { hostsWriteCommand } from "./hosts-write";
import { readFile } from "../platform/neutralino";
import { exec } from "../runtime/command-runner";
import { getAuthorizationPrompt } from "../locale/authorization";
import { warn } from "../logging/logger";
import { ensurePrivilegedHosts, legacyEnsureHosts } from "./privileged-hosts";

const YAAGL_START = "# Added by Yaagl";
const YAAGLM_START = "# Added by Yaaglm";
const SECTION_END = "# End of section";
const WARNING = "# Warning: any content in this section will be overwritten";

function splitLines(content: string) {
  return content.includes("\r\n") ? content.split("\r\n") : content.split("\n");
}

function removeOwnedSections(lines: string[], marker: string) {
  const result: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] !== marker) {
      result.push(lines[index]);
      continue;
    }
    while (index + 1 < lines.length && lines[index] !== SECTION_END) index++;
  }
  return result;
}

function expectedSection(hosts: [string, string][]) {
  return [
    YAAGLM_START,
    WARNING,
    ...hosts.map(([domain, ip]) => `${ip} ${domain}`),
    SECTION_END,
  ];
}

function hasExpectedSection(lines: string[], hosts: [string, string][]) {
  const start = lines.indexOf(YAAGLM_START);
  if (start < 0) return false;
  let end = start;
  while (end < lines.length && lines[end] !== SECTION_END) end++;
  if (end >= lines.length) return false;
  return (
    lines.slice(start, end + 1).join("\n") === expectedSection(hosts).join("\n")
  );
}

/** Repairs blocks left by older launchers when the app starts. */
export async function reconcileStartupHosts(hosts: [string, string][]) {
  const content = await readFile("/etc/hosts");
  const original = splitLines(content);
  const withoutYaagl = removeOwnedSections(original, YAAGL_START);
  const yaaglmStart = withoutYaagl.indexOf(YAAGLM_START);
  let next = withoutYaagl;
  if (yaaglmStart >= 0) {
    let end = yaaglmStart;
    while (end < next.length && next[end] !== SECTION_END) end++;
    const existing = next.slice(yaaglmStart, end + 1);
    const expected = expectedSection(hosts);
    if (existing.join("\n") === expected.join("\n")) {
      next = withoutYaagl;
    } else {
      next = [
        ...withoutYaagl.slice(0, yaaglmStart),
        ...expected,
        ...withoutYaagl.slice(Math.min(end + 1, withoutYaagl.length)),
      ];
    }
  }
  if (next.join("\n") === original.join("\n")) return false;
  await exec(
    hostsWriteCommand(next.join("\n")),
    {},
    await getAuthorizationPrompt("AUTHORIZATION_PROMPT_RECONCILE_HOSTS")
  );
  return true;
}

export async function ensureHosts(hosts: [string, string][]) {
  // Migrate blocks written by older launchers before asking the helper to
  // reconcile the current persistent rules.
  try {
    const content = await readFile("/etc/hosts");
    const original = splitLines(content);
    await reconcileStartupHosts(hosts);
    const reconciled = splitLines(await readFile("/etc/hosts"));
    if (
      hasExpectedSection(reconciled, hosts) &&
      original.join("\n") === reconciled.join("\n")
    ) {
      return;
    }
  } catch (error) {
    await warn(
      `Hosts startup migration failed; continuing with helper: ${String(error)}`
    );
  }
  await ensurePrivilegedHosts(hosts, async () => {
    await legacyEnsureHosts(hosts);
  });
}

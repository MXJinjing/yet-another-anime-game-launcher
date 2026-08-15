import { log, warn } from "../logging/logger";
import { resolve, writeFile } from "../platform/neutralino";
import { rawString } from "../platform/shell";
import { exec } from "../runtime/command-runner";
import { validateHostEntries } from "./hosts-validation";
import type { HostEntry } from "./hosts-validation";

export type { HostEntry } from "./hosts-validation";

const helperPath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper");
const helperSourcePath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper.c");
const installScriptPath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/install.sh");
const uninstallScriptPath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/uninstall.sh");
const installedHelperPath = "/Library/PrivilegedHelperTools/yaaglm-hosts-helper";
const installedPlistPath =
  "/Library/LaunchDaemons/com.3shain.yaaglm.hosts-helper.plist";

export type PrivilegedHostsHelperStatus =
  | "running"
  | "installed-stopped"
  | "not-installed"
  | "error";

function helperArgs(
  action: "ensure" | "block",
  hosts: HostEntry[],
  ttl?: number
) {
  const pairs = hosts.flatMap(([domain, ip]) => [ip, domain]);
  if (action == "block") {
    return ["--request", "block", String(ttl ?? 20), ...pairs];
  }
  return ["--request", "ensure", ...pairs];
}

async function requestHelper(args: string[]) {
  return await exec([helperPath(), ...args]);
}

async function helperAvailable() {
  try {
    await requestHelper(["--request", "status"]);
    return true;
  } catch {
    return false;
  }
}

async function ensureLocalHelperBinary() {
  try {
    await exec(["test", "-x", helperPath()]);
    return;
  } catch {
    await warn(
      "YAAGLM privileged hosts helper binary is missing; trying to build it locally"
    );
  }
  await exec(["cc", helperSourcePath(), "-o", helperPath()]);
  await exec(["chmod", "0755", helperPath()]);
}

async function installHelper() {
  await ensureLocalHelperBinary();
  await log("Installing YAAGLM privileged hosts helper");
  await exec(["/bin/sh", installScriptPath(), helperPath()], {}, true);
}

async function ensureHelperReady() {
  if (await helperAvailable()) return;
  await installHelper();
  await requestHelper(["--request", "status"]);
}

export async function runPrivilegedHosts(
  args: string[],
  fallback: () => Promise<void>
) {
  try {
    await ensureHelperReady();
    await requestHelper(args);
  } catch (e) {
    await warn(
      `YAAGLM privileged hosts helper unavailable; falling back to administrator prompt. ${String(
        e
      )}`
    );
    await fallback();
  }
}

export async function ensurePrivilegedHosts(
  hosts: HostEntry[],
  fallback: () => Promise<void>
) {
  validateHostEntries(hosts);
  await runPrivilegedHosts(helperArgs("ensure", hosts), fallback);
}

export async function blockPrivilegedHosts(
  hosts: HostEntry[],
  ttl: number,
  fallback: () => Promise<void>
) {
  validateHostEntries(hosts);
  validateBlockTtl(ttl);
  await runPrivilegedHosts(helperArgs("block", hosts, ttl), fallback);
}

export async function unblockPrivilegedHosts() {
  await requestHelper(["--request", "unblock"]);
}

export async function getPrivilegedHostsHelperStatus(): Promise<PrivilegedHostsHelperStatus> {
  try {
    if (await helperAvailable()) return "running";
    await exec(["test", "-x", installedHelperPath]);
    await exec(["test", "-f", installedPlistPath]);
    return "installed-stopped";
  } catch {
    try {
      await exec(["test", "-e", installedHelperPath]);
      return "error";
    } catch {
      return "not-installed";
    }
  }
}

export async function installPrivilegedHostsHelper() {
  await installHelper();
}

export async function uninstallPrivilegedHostsHelper() {
  await log("Uninstalling YAAGLM privileged hosts helper");
  await exec(["/bin/sh", uninstallScriptPath()], {}, true);
}

function validateBlockTtl(ttl: number) {
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) {
    throw new Error(`Invalid hosts block TTL: ${ttl}`);
  }
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function legacyBlockHosts(hosts: HostEntry[], ttl: number) {
  validateHostEntries(hosts);
  if (hosts.length == 0) return;
  validateBlockTtl(ttl);
  const tmpScriptPath = `/tmp/yaaglm_network_block_script_${Date.now()}.sh`;
  const entries = hosts.map(([domain, ip], index) => {
    return `ENTRY_${index}=${shellSingleQuote(`${ip} ${domain}`)}`;
  });
  const appendEntries = hosts.map((_, index) => {
    return `$ENTRY_${index}`;
  });

  const commands = [
    `#!/bin/sh`,
    `HOSTS_FILE='/etc/hosts'`,
    ...entries,
    `PAD_START='# Temporarily Added by Yaaglm'`,
    `PAD_END='# End of section'`,
    `if ! grep -qF "$ENTRY_0" "$HOSTS_FILE"; then`,
    `printf '%s\\n' "$PAD_START" ${appendEntries
      .map(entry => `"${entry}"`)
      .join(" ")} "$PAD_END" >> "$HOSTS_FILE"`,
    `fi`,
    `sleep ${ttl}`,
    `sed -i.bak "/$PAD_START/,/$PAD_END/d" "$HOSTS_FILE"`,
    `rm ${shellSingleQuote(tmpScriptPath)}`,
  ];

  await writeFile(tmpScriptPath, commands.join("\n"));
  await exec(
    [
      "osascript",
      "-e",
      `do shell script "source ${tmpScriptPath} > /dev/null 2>&1 &" with administrator privileges`,
    ],
    {},
    false
  );
}

export async function legacyEnsureHosts(hosts: HostEntry[]) {
  validateHostEntries(hosts);
  const content = await Neutralino.filesystem.readFile("/etc/hosts");
  const lines =
    content.indexOf("\r\n") >= 0 ? content.split("\r\n") : content.split("\n");
  let start = 0;
  while (start < lines.length && lines[start] != "# Added by Yaaglm") {
    start++;
  }
  let end = start;
  while (end < lines.length && lines[end] != "# End of section") {
    end++;
  }
  const newContentPre = lines.filter((_, index) => index < start);
  const newContentPost = lines.filter((_, index) => index > end);
  const newContent = [
    ...newContentPre,
    "# Added by Yaaglm",
    "# Warning: any content in this section will be overwritten",
    ...hosts.map(([domain, ip]) => `${ip} ${domain}`),
    "# End of section",
    ...(newContentPost.length ? newContentPost : [""]),
  ];
  await exec(
    ["printf", newContent.join("\n"), rawString(">"), "/etc/hosts"],
    {},
    true
  );
}

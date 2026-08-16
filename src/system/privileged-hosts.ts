import { log, warn } from "../logging/logger";
import { env, readFile, resolve, writeFile } from "../platform/neutralino";
import { rawString } from "../platform/shell";
import { exec } from "../runtime/command-runner";
import { validateHostEntries } from "./hosts-validation";
import type { HostEntry } from "./hosts-validation";

export type { HostEntry } from "./hosts-validation";

const helperPath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper");
const installScriptPath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/install.sh");
const uninstallScriptPath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/uninstall.sh");
const manifestPath = () => resolve("./build-manifest.json");
const tokenPath = (bundleId: string) => resolve(`./tokens/${bundleId}.token`);
const installedHelperPath = "/Library/PrivilegedHelperTools/yaaglm-hosts-helper";
const installedPlistPath =
  "/Library/LaunchDaemons/com.3shain.yaaglm.hosts-helper.plist";

export type PrivilegedHostsHelperStatus =
  | "running"
  | "installed-stopped"
  | "not-installed"
  | "error"
  | "untrusted"
  | "tampered";

type HostsHelperAction = "status" | "ensure" | "block" | "unblock";

interface BuildManifest {
  bundleId: string;
  version: string;
  appName: string;
}

interface HostsHelperContext {
  trusted: boolean;
  bundlePath: string | undefined;
  manifest: BuildManifest | undefined;
}

const HELPER_ERROR_PATTERN =
  /ERR_(UNREGISTERED|VERSION_MISMATCH|TAMPERED|UNAUTHORIZED|RATE_LIMITED)/;

let tampered = false;

function parseHelperError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.match(HELPER_ERROR_PATTERN)?.[1];
}

function tamperedError() {
  return new Error("检测到启动器被篡改，已拒绝使用 hosts 助手");
}

async function loadManifest(): Promise<BuildManifest | undefined> {
  try {
    const raw = await readFile(manifestPath());
    const parsed = JSON.parse(raw) as Partial<BuildManifest>;
    if (
      typeof parsed.bundleId == "string" &&
      parsed.bundleId.length > 0 &&
      typeof parsed.version == "string" &&
      parsed.version.length > 0 &&
      typeof parsed.appName == "string" &&
      parsed.appName.length > 0
    ) {
      return {
        bundleId: parsed.bundleId,
        version: parsed.version,
        appName: parsed.appName,
      };
    }
  } catch {
    // unreadable or malformed manifest => untrusted
  }
  return undefined;
}

async function getHostsHelperContext(): Promise<HostsHelperContext> {
  const bundlePath = await env("YAAGL_BUNDLE_PATH");
  if (!bundlePath) {
    return { trusted: false, bundlePath: undefined, manifest: undefined };
  }
  const manifest = await loadManifest();
  return { trusted: manifest != undefined, bundlePath, manifest };
}

function hostPairs(hosts: HostEntry[]): string[] {
  return hosts.flatMap(([domain, ip]) => [ip, domain]);
}

function helperArgs(
  bundleId: string,
  version: string,
  action: HostsHelperAction,
  args: string[]
): string[] {
  return [
    "--request",
    bundleId,
    version,
    action,
    ...args,
    "--token-file",
    tokenPath(bundleId),
  ];
}

async function requestHelper(args: string[]) {
  try {
    return await exec([helperPath(), ...args]);
  } catch (error) {
    if (parseHelperError(error) == "TAMPERED") {
      tampered = true;
    }
    throw error;
  }
}

async function requestStatus(ctx: HostsHelperContext): Promise<string> {
  const ret = await requestHelper(
    helperArgs(ctx.manifest!.bundleId, ctx.manifest!.version, "status", [])
  );
  const line = (ret.stdOut ?? "").split("\n")[0].trim();
  const match = line.match(/^OK\s+(\S+)/);
  if (!match) {
    throw new Error(`Unexpected hosts helper STATUS response: ${line}`);
  }
  return match[1];
}

async function ensureLocalHelperBinary() {
  await exec(["test", "-x", helperPath()]);
}

async function installHelper(ctx: HostsHelperContext) {
  await log("Installing YAAGLM privileged hosts helper");
  await exec(
    [
      "/bin/sh",
      installScriptPath(),
      "--bundle",
      ctx.bundlePath!,
      "--helper",
      helperPath(),
    ],
    {},
    true
  );
}

async function ensureHelperReady(ctx: HostsHelperContext) {
  if (tampered) {
    throw tamperedError();
  }
  await ensureLocalHelperBinary();
  try {
    const registeredVersion = await requestStatus(ctx);
    if (registeredVersion == ctx.manifest!.version) return;
    await installHelper(ctx);
  } catch (error) {
    const code = parseHelperError(error);
    if (code == "TAMPERED") {
      throw tamperedError();
    }
    if (code != "UNREGISTERED" && code != "VERSION_MISMATCH") {
      throw error;
    }
    await installHelper(ctx);
  }
  // Retry once after (re)install.
  try {
    const registeredVersion = await requestStatus(ctx);
    if (registeredVersion != ctx.manifest!.version) {
      throw new Error(
        `YAAGLM hosts helper registered version ${registeredVersion} does not match manifest version ${ctx.manifest!.version}`
      );
    }
  } catch (error) {
    if (parseHelperError(error) == "TAMPERED") {
      throw tamperedError();
    }
    throw error;
  }
}

async function untrustedFallback(fallback: () => Promise<void>) {
  await warn(
    "YAAGLM privileged hosts helper unavailable (untrusted launcher bundle); falling back to legacy hosts management"
  );
  await fallback();
}

export async function runPrivilegedHosts(
  args: string[],
  fallback: () => Promise<void>
) {
  await runPrivilegedHostsWithContext(
    await getHostsHelperContext(),
    args,
    fallback
  );
}

async function runPrivilegedHostsWithContext(
  ctx: HostsHelperContext,
  args: string[],
  fallback: () => Promise<void>
) {
  if (!ctx.trusted) {
    await untrustedFallback(fallback);
    return;
  }
  try {
    await ensureHelperReady(ctx);
    await requestHelper(args);
  } catch (error) {
    await warn(
      `YAAGLM privileged hosts helper unavailable; falling back to administrator prompt. ${String(
        error
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
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    await untrustedFallback(fallback);
    return;
  }
  await runPrivilegedHostsWithContext(
    ctx,
    helperArgs(
      ctx.manifest!.bundleId,
      ctx.manifest!.version,
      "ensure",
      hostPairs(hosts)
    ),
    fallback
  );
}

export async function blockPrivilegedHosts(
  hosts: HostEntry[],
  ttl: number,
  fallback: () => Promise<void>
) {
  validateHostEntries(hosts);
  validateBlockTtl(ttl);
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    await untrustedFallback(fallback);
    return;
  }
  await runPrivilegedHostsWithContext(
    ctx,
    helperArgs(
      ctx.manifest!.bundleId,
      ctx.manifest!.version,
      "block",
      [String(ttl), ...hostPairs(hosts)]
    ),
    fallback
  );
}

export async function unblockPrivilegedHosts() {
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    await warn(
      "YAAGLM privileged hosts helper unavailable (untrusted launcher bundle); ignoring unblock request"
    );
    return;
  }
  await requestHelper(
    helperArgs(ctx.manifest!.bundleId, ctx.manifest!.version, "unblock", [])
  );
}

async function helperAvailable(ctx: HostsHelperContext) {
  try {
    await requestHelper(
      helperArgs(ctx.manifest!.bundleId, ctx.manifest!.version, "status", [])
    );
    return true;
  } catch {
    return false;
  }
}

export async function getPrivilegedHostsHelperStatus(): Promise<PrivilegedHostsHelperStatus> {
  if (tampered) return "tampered";
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) return "untrusted";
  try {
    if (await helperAvailable(ctx)) return "running";
  } catch {
    // fall through to installed-state detection
  }
  if (tampered) return "tampered";
  try {
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
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    throw new Error(
      "Cannot install YAAGLM hosts helper: launcher bundle is not trusted"
    );
  }
  await installHelper(ctx);
}

export async function uninstallPrivilegedHostsHelper() {
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    throw new Error(
      "Cannot uninstall YAAGLM hosts helper: launcher bundle is not trusted"
    );
  }
  await log("Uninstalling YAAGLM privileged hosts helper");
  await exec(
    ["/bin/sh", uninstallScriptPath(), ctx.manifest!.bundleId],
    {},
    true
  );
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

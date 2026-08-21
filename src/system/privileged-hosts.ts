import { CURRENT_YAAGL_VERSION } from "@constants";
import { log, warn } from "../logging/logger";
import {
  env,
  getRuntimeArch,
  readFile,
  resolve,
  writeFile,
} from "../platform/neutralino";
import { resolveSidecarPath } from "../platform/neutralino/sidecar";
import { rawString } from "../platform/shell";
import { exec } from "../runtime/command-runner";
import { validateHostEntries } from "./hosts-validation";
import type { HostEntry } from "./hosts-validation";

export type { HostEntry } from "./hosts-validation";

const helperPath = () =>
  resolveSidecarPath("yaaglm-hosts-helper/yaaglm-hosts-helper");
const installScriptPath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/install.sh");
const uninstallScriptPath = () =>
  resolve("./sidecar/yaaglm-hosts-helper/uninstall.sh");
const manifestPath = () => resolve("./build-manifest.json");
const tokenPath = (bundleId: string) => resolve(`./tokens/${bundleId}.token`);
const installedHelperPath =
  "/Library/PrivilegedHelperTools/yaaglm-hosts-helper";
const installedPlistPath =
  "/Library/LaunchDaemons/com.3shain.yaaglm.hosts-helper.plist";
export type PrivilegedHostsHelperStatus =
  | "running"
  | "installed-stopped"
  | "registration-conflict"
  | "not-installed"
  | "error"
  | "untrusted"
  | "tampered"
  | "disabled";

export function isPrivilegedHostsHelperStatusRepairable(
  status: PrivilegedHostsHelperStatus
) {
  return (
    status == "registration-conflict" ||
    status == "installed-stopped" ||
    status == "error"
  );
}

type HostsHelperAction = "status" | "ensure" | "block" | "unblock";

interface BuildManifest {
  bundleId: string;
  version: string;
  appName: string;
  helperSha256?: string;
  helperSha256ByArch?: Partial<Record<"arm64" | "x64", string>>;
}

interface HostsHelperContext {
  trusted: boolean;
  bundlePath: string | undefined;
  manifest: BuildManifest | undefined;
}

const HELPER_ERROR_PATTERN =
  /ERR_(UNREGISTERED|VERSION_MISMATCH|TAMPERED|UNAUTHORIZED|RATE_LIMITED)/;

let tampered = false;

export function isPrivilegedHostsHelperDisabledForDevelopment() {
  return CURRENT_YAAGL_VERSION === "development";
}

export type PrivilegedHostsHelperTokenRecoveryState =
  | "disabled"
  | "untrusted"
  | "not-needed"
  | "token-present"
  | "token-missing";

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
        helperSha256:
          typeof parsed.helperSha256 == "string" &&
          parsed.helperSha256.length > 0
            ? parsed.helperSha256
            : undefined,
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
    return await exec([await helperPath(), ...args]);
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
  await exec(["test", "-x", await helperPath()]);
}

async function installHelper(ctx: HostsHelperContext, reRegister = false) {
  await log("Installing YAAGLM privileged hosts helper");
  const helper = await helperPath();
  // Sanity check: the shipped binary should match what the build recorded in
  // build-manifest.json (the helper source lives in a separate project, so the
  // sidecar binary is a committed artifact that could drift).
  if (ctx.manifest?.helperSha256) {
    try {
      const out = await exec(["shasum", "-a", "256", helper]);
      const actual = (out.stdOut ?? "").trim().split(/\s+/)[0];
      const expected =
        ctx.manifest.helperSha256ByArch?.[await getRuntimeArch()] ??
        ctx.manifest.helperSha256;
      if (actual != expected) {
        await warn(
          `YAAGLM hosts helper binary hash ${actual} does not match build manifest ${expected}; installing anyway (stale sidecar binary?)`
        );
      }
    } catch {
      // hash check is best-effort
    }
  }
  const installArgs = [
    "/bin/sh",
    installScriptPath(),
    "--bundle",
    ctx.bundlePath!,
    "--helper",
    helper,
  ];
  if (reRegister) installArgs.push("--re-register");
  await exec(installArgs, {}, true);
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
        `YAAGLM hosts helper registered version ${registeredVersion} does not match manifest version ${
          ctx.manifest!.version
        }`
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
  if (isPrivilegedHostsHelperDisabledForDevelopment()) {
    await fallback();
    return;
  }
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
  if (isPrivilegedHostsHelperDisabledForDevelopment()) {
    await fallback();
    return;
  }
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
  if (isPrivilegedHostsHelperDisabledForDevelopment()) {
    await fallback();
    return;
  }
  validateBlockTtl(ttl);
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    await untrustedFallback(fallback);
    return;
  }
  await runPrivilegedHostsWithContext(
    ctx,
    helperArgs(ctx.manifest!.bundleId, ctx.manifest!.version, "block", [
      String(ttl),
      ...hostPairs(hosts),
    ]),
    fallback
  );
}

export async function unblockPrivilegedHosts() {
  if (isPrivilegedHostsHelperDisabledForDevelopment()) return;
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

interface StatusDiagnostics {
  code?: string;
  tokenFileUnreadable?: boolean;
}

async function requestStatusDiagnostics(
  ctx: HostsHelperContext
): Promise<StatusDiagnostics> {
  try {
    const registeredVersion = await requestStatus(ctx);
    return registeredVersion == ctx.manifest!.version
      ? { code: "OK" }
      : { code: "OK_VERSION_MISMATCH" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: parseHelperError(error),
      tokenFileUnreadable: message.includes("cannot read token file"),
    };
  }
}

async function helperAvailable(ctx: HostsHelperContext) {
  return (await requestStatusDiagnostics(ctx)).code == "OK";
}

function isRegistrationConflictCode(code: string | undefined) {
  return (
    code == "UNREGISTERED" ||
    code == "VERSION_MISMATCH" ||
    code == "UNAUTHORIZED" ||
    code == "OK_VERSION_MISMATCH"
  );
}

export async function getPrivilegedHostsHelperStatus(): Promise<PrivilegedHostsHelperStatus> {
  if (isPrivilegedHostsHelperDisabledForDevelopment()) return "disabled";
  if (tampered) return "tampered";
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) return "untrusted";
  const diagnostics = await requestStatusDiagnostics(ctx);
  if (diagnostics.code == "OK") return "running";
  if (diagnostics.code == "TAMPERED") return "tampered";
  if (isRegistrationConflictCode(diagnostics.code)) {
    return "registration-conflict";
  }
  if (tampered) return "tampered";
  try {
    await exec(["test", "-x", installedHelperPath]);
    await exec(["test", "-f", installedPlistPath]);
    // A missing or unreadable token is a registration conflict too: the helper
    // files are present, but install.sh must run to provision a fresh token.
    return diagnostics.tokenFileUnreadable
      ? "registration-conflict"
      : "installed-stopped";
  } catch {
    try {
      await exec(["test", "-e", installedHelperPath]);
      return "error";
    } catch {
      return "not-installed";
    }
  }
}

export async function getPrivilegedHostsHelperVersion(): Promise<
  string | undefined
> {
  if (isPrivilegedHostsHelperDisabledForDevelopment()) return undefined;
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) return undefined;
  try {
    await ensureLocalHelperBinary();
    return await requestStatus(ctx);
  } catch {
    return undefined;
  }
}

export async function getPrivilegedHostsHelperTokenRecoveryState(): Promise<PrivilegedHostsHelperTokenRecoveryState> {
  if (isPrivilegedHostsHelperDisabledForDevelopment()) return "disabled";
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) return "untrusted";

  let tokenPresent = false;
  try {
    await exec(["test", "-s", tokenPath(ctx.manifest!.bundleId)]);
    tokenPresent = true;
  } catch {
    tokenPresent = false;
  }
  if (tokenPresent) return "token-present";

  let installed = false;
  try {
    await exec(["test", "-e", installedHelperPath]);
    installed = true;
  } catch {
    // helper binary may be absent while the plist remains
  }
  try {
    await exec(["test", "-e", installedPlistPath]);
    installed = true;
  } catch {
    // no launchd registration
  }
  return installed ? "token-missing" : "not-needed";
}

export async function installPrivilegedHostsHelper() {
  if (isPrivilegedHostsHelperDisabledForDevelopment()) {
    throw new Error("Hosts helper is disabled in development builds");
  }
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    throw new Error(
      "Cannot install YAAGLM hosts helper: launcher bundle is not trusted"
    );
  }
  await installHelper(ctx);
}

export async function uninstallPrivilegedHostsHelper() {
  if (isPrivilegedHostsHelperDisabledForDevelopment()) {
    throw new Error("Hosts helper is disabled in development builds");
  }
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

export async function reRegisterPrivilegedHostsHelper() {
  if (isPrivilegedHostsHelperDisabledForDevelopment()) {
    throw new Error("Hosts helper is disabled in development builds");
  }
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    throw new Error(
      "Cannot re-register YAAGLM hosts helper: launcher bundle is not trusted"
    );
  }
  await log("Re-registering YAAGLM privileged hosts helper");
  // --re-register replaces only this bundle's registry row and rotates the
  // token inside install.sh, so other registered channels are never touched.
  await installHelper(ctx, true);
  const diagnostics = await requestStatusDiagnostics(ctx);
  if (diagnostics.code != "OK") {
    throw new Error(
      `YAAGLM hosts helper re-registration failed (status: ${String(
        diagnostics.code
      )})`
    );
  }
}

/**
 * Detects whether the version registered by the installed privileged
 * hosts-helper daemon is older than the current build manifest and upgrades it
 * when needed (installing the new helper binary and updating the registration).
 *
 * The upgrade uses a plain install (no `--re-register`), so all of the
 * helper's persistent data is preserved: the existing token and registry row
 * are kept (install.sh only rotates the token with `--re-register`), and only
 * the version/hashes in the registry row plus the daemon binary are refreshed.
 */
export async function upgradePrivilegedHostsHelperIfNeeded() {
  if (isPrivilegedHostsHelperDisabledForDevelopment()) return;
  const ctx = await getHostsHelperContext();
  if (!ctx.trusted) {
    await warn(
      "YAAGLM hosts helper upgrade skipped: launcher bundle is not trusted"
    );
    return;
  }
  try {
    await ensureLocalHelperBinary();
  } catch (error) {
    await log(
      `YAAGLM hosts helper local binary missing; skipping upgrade: ${String(
        error
      )}`
    );
    return;
  }
  let needsUpgrade = false;
  try {
    const registeredVersion = await requestStatus(ctx);
    if (registeredVersion == ctx.manifest!.version) {
      await log("YAAGLM hosts helper is already up to date");
      return;
    }
    await log(
      `YAAGLM hosts helper version mismatch (installed=${registeredVersion}, expected=${
        ctx.manifest!.version
      }); upgrading`
    );
    needsUpgrade = true;
  } catch (error) {
    const code = parseHelperError(error);
    if (code != "UNREGISTERED" && code != "VERSION_MISMATCH") {
      await log(
        `YAAGLM hosts helper version check failed; skipping upgrade: ${String(
          error
        )}`
      );
      return;
    }
    await log(
      `YAAGLM hosts helper is unregistered or stale (${String(
        code
      )}); installing`
    );
    needsUpgrade = true;
  }
  if (!needsUpgrade) return;
  // Plain install preserves the token and registry row; only the daemon binary
  // and version/hash fields are refreshed.
  await installHelper(ctx);
  const diagnostics = await requestStatusDiagnostics(ctx);
  if (diagnostics.code != "OK") {
    throw new Error(
      `YAAGLM hosts helper upgrade failed (status: ${String(diagnostics.code)})`
    );
  }
  await log(`YAAGLM hosts helper upgraded to ${ctx.manifest!.version}`);
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

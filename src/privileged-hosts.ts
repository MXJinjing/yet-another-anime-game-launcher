import { exec, log, rawString, resolve, warn, writeFile } from "./utils";

export type HostEntry = [domain: string, ip: string];

const helperPath = () =>
  resolve("./sidecar/yaagl-hosts-helper/yaagl-hosts-helper");
const helperSourcePath = () =>
  resolve("./sidecar/yaagl-hosts-helper/yaagl-hosts-helper.c");
const installScriptPath = () =>
  resolve("./sidecar/yaagl-hosts-helper/install.sh");

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
      "YAAGL privileged hosts helper binary is missing; trying to build it locally"
    );
  }
  await exec(["cc", helperSourcePath(), "-o", helperPath()]);
  await exec(["chmod", "0755", helperPath()]);
}

async function installHelper() {
  await ensureLocalHelperBinary();
  await log("Installing YAAGL privileged hosts helper");
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
      `YAAGL privileged hosts helper unavailable; falling back to administrator prompt. ${String(
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
  await runPrivilegedHosts(helperArgs("ensure", hosts), fallback);
}

export async function blockPrivilegedHosts(
  hosts: HostEntry[],
  ttl: number,
  fallback: () => Promise<void>
) {
  await runPrivilegedHosts(helperArgs("block", hosts, ttl), fallback);
}

export async function unblockPrivilegedHosts() {
  await requestHelper(["--request", "unblock"]);
}

export async function legacyBlockHosts(hosts: HostEntry[], ttl: number) {
  const tmpScriptPath = `/tmp/yaagl_network_block_script_${Date.now()}.sh`;
  const entries = hosts.map(([domain, ip], index) => {
    return `ENTRY_${index}="${ip} ${domain}"`;
  });
  const appendEntries = hosts.map((_, index) => {
    return `$ENTRY_${index}`;
  });

  const commands = [
    `#!/bin/sh`,
    `HOSTS_FILE="/etc/hosts"`,
    ...entries,
    `PAD_START="# Temporarily Added by Yaagl"`,
    `PAD_END="# End of section"`,
    `if ! grep -qF "$ENTRY_0" "$HOSTS_FILE"; then`,
    `sudo bash -c "printf '%s\\n' '$PAD_START' ${appendEntries
      .map(entry => `"${entry}"`)
      .join(" ")} '$PAD_END' >> '$HOSTS_FILE'"`,
    `fi`,
    `sleep ${ttl}`,
    `sudo sed -i.bak "/$PAD_START/,/$PAD_END/d" "$HOSTS_FILE"`,
    `rm ${tmpScriptPath}`,
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
  const content = await Neutralino.filesystem.readFile("/etc/hosts");
  const lines =
    content.indexOf("\r\n") >= 0 ? content.split("\r\n") : content.split("\n");
  let start = 0;
  while (start < lines.length && lines[start] != "# Added by Yaagl") {
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
    "# Added by Yaagl",
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

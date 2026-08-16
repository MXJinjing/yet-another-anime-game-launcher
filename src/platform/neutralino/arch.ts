let cachedArch: Promise<"arm64" | "x64"> | undefined;

export function getRuntimeArch(): Promise<"arm64" | "x64"> {
  cachedArch ??= detectRuntimeArch();
  return cachedArch;
}

async function detectRuntimeArch(): Promise<"arm64" | "x64"> {
  try {
    const ret = await Neutralino.os.execCommand("uname -m", {});
    const machine = ret.stdOut.trim().toLowerCase();
    if (machine == "arm64" || machine == "aarch64") return "arm64";
    if (machine == "x86_64" || machine == "amd64") return "x64";
  } catch {
    // fall through to the Neutralino API
  }
  try {
    const arch = await Neutralino.computer.getArch();
    if (arch == "x64") return "x64";
    if (arch == "arm") return "arm64";
  } catch {
    // fall through
  }
  return "arm64";
}

import { stats } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { getKey, setKey } from "@runtime/storage";
import { dirname, join } from "path-browserify";

export const GPTK_WINE_ID = "gptk3-system";
export const CUSTOM_WINE_BINARY_KEY = "config_custom_wine_binary";

export type CustomWineEntry = { name: string; binary: string };

const systemWineRoots = new Map<string, string>();

export function registerSystemWineRoot(id: string, root: string) {
  systemWineRoots.set(id, root);
  return root;
}

export function getRegisteredSystemWineRoot(id: string) {
  return systemWineRoots.get(id);
}

export async function readCustomWineEntries(): Promise<CustomWineEntry[]> {
  const value = await getKey(CUSTOM_WINE_BINARY_KEY).catch(() => "[]");
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const entries: CustomWineEntry[] = [];
      const binaries = new Set<string>();
      for (const item of parsed) {
        const entry =
          item &&
          typeof item == "object" &&
          typeof (item as CustomWineEntry).name == "string" &&
          typeof (item as CustomWineEntry).binary == "string"
            ? (item as CustomWineEntry)
            : undefined;
        if (entry && !binaries.has(entry.binary)) {
          binaries.add(entry.binary);
          entries.push(entry);
        }
      }
      return entries;
    }
  } catch {
    // Custom Wine entries must be stored as a JSON object list.
  }
  return [];
}

export async function writeCustomWineEntries(entries: CustomWineEntry[]) {
  await setKey(CUSTOM_WINE_BINARY_KEY, JSON.stringify(entries));
}

export function getCustomWineId(root: string) {
  let hash = 0;
  for (let i = 0; i < root.length; i++) {
    hash = (hash * 31 + root.charCodeAt(i)) >>> 0;
  }
  return `custom-wine-${hash.toString(36)}`;
}

export async function findConfiguredWine(
  binary: string
): Promise<{ binary: string; root: string } | undefined> {
  if (!binary.trim()) return undefined;
  try {
    const executable = await resolveWineExecutable(binary);
    const root = dirname(dirname(executable));
    await stats(join(root, "bin", "wineserver"));
    return { binary: executable, root };
  } catch {
    return undefined;
  }
}

async function resolveWineExecutable(candidate: string) {
  const executable = (
    await exec([
      "/usr/bin/perl",
      "-MCwd=realpath",
      "-e",
      "print realpath($ARGV[0])",
      candidate,
    ])
  ).stdOut.trim();
  await stats(executable);
  return executable;
}

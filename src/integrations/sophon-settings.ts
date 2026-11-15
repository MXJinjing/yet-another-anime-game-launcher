import { join, normalize } from "path-browserify";
import { getKeyOrDefault, setKey, type Storage } from "@runtime/storage";
import { formatString } from "@runtime/format";
import { sophonDownloaderText } from "../locale/sophon-downloader";

export interface SophonSettings {
  downloads: number;
  writes: number;
  checks: number;
  postProcessors: number;
  maxRetries: number;
  retryInterval: number;
  maxCachedFileHandles: number;
  memoryMiB: number;
  diskGiB: number;
  diskCacheEnabled: boolean;
  entryLimit: number;
  ioPolicy: "parallel" | "serialized";
  writeMode: "temporary" | "in-place";
  preserveState: boolean;
  debugLogging: boolean;
}

export const sophonDefaults: SophonSettings = {
  downloads: 8,
  writes: 4,
  checks: 8,
  postProcessors: 4,
  maxRetries: 10,
  retryInterval: 5,
  maxCachedFileHandles: 512,
  memoryMiB: 1024,
  diskGiB: 10,
  diskCacheEnabled: true,
  entryLimit: 500,
  ioPolicy: "parallel",
  writeMode: "temporary",
  preserveState: true,
  debugLogging: false,
};

export const sophonNumberSettings = [
  { key: "downloads", min: 1, max: 16 },
  { key: "checks", min: 1, max: 16 },
  { key: "postProcessors", min: 1, max: 16 },
  { key: "writes", min: 1, max: 16 },
  { key: "memoryMiB", min: 0, max: 16384 },
  { key: "diskGiB", min: 1, max: 1024 },
  { key: "entryLimit", min: 2, max: 4096 },
  { key: "maxCachedFileHandles", min: 1, max: 4096 },
  { key: "maxRetries", min: 0, max: 20 },
  { key: "retryInterval", min: 0, max: 60 },
] as const;

export function sophonSettingsError(
  settings: SophonSettings,
  text = sophonDownloaderText("en")
): string {
  for (const field of sophonNumberSettings) {
    const value = settings[field.key];
    if (
      !Number.isSafeInteger(value) ||
      value < field.min ||
      value > field.max
    ) {
      return formatString(text.rangeError, [
        text[field.key],
        String(field.min),
        String(field.max),
      ]);
    }
  }
  if (!["parallel", "serialized"].includes(settings.ioPolicy))
    return text.ioError;
  if (!["temporary", "in-place"].includes(settings.writeMode))
    return text.writeModeError;
  if (
    settings.maxCachedFileHandles <
    (settings.ioPolicy === "serialized" ? 1 : settings.writes)
  )
    return text.handlesError;
  for (const key of [
    "diskCacheEnabled",
    "preserveState",
    "debugLogging",
  ] as const) {
    if (typeof settings[key] !== "boolean") return text.invalidError;
  }
  if (!settings.diskCacheEnabled && settings.writeMode === "in-place")
    return text.diskRequired;
  if (!settings.diskCacheEnabled && settings.memoryMiB === 0)
    return text.memoryError;
  return "";
}

const SOPHON_SETTINGS_KEY = "config_sophon";
export const SOPHON_PREDOWNLOAD_DIRECTORY_KEY = "sophon_predownload_directory";
// Records the location of a predownload already started, independently of the preference.
export const SOPHON_PREDOWNLOAD_ROOT_KEY = "sophon_predownload_root";

async function readStoredSettings(): Promise<
  Partial<SophonSettings> & { predownloadDirectory?: unknown }
> {
  try {
    const stored: unknown = JSON.parse(
      await getKeyOrDefault(SOPHON_SETTINGS_KEY, "{}")
    );
    if (stored && typeof stored === "object" && !Array.isArray(stored))
      return stored;
  } catch {
    // Defaults also apply to unreadable settings.
  }
  return {};
}

function isAbsolutePredownloadDirectory(value: unknown): value is string {
  return (
    typeof value === "string" && value.startsWith("/") && !value.includes("\0")
  );
}

export async function readSophonPredownloadDirectory(storage: Storage) {
  try {
    const configured = await storage.getKey(SOPHON_PREDOWNLOAD_DIRECTORY_KEY);
    return isAbsolutePredownloadDirectory(configured) ? configured : "";
  } catch {
    const { predownloadDirectory } = await readStoredSettings();
    return isAbsolutePredownloadDirectory(predownloadDirectory)
      ? predownloadDirectory
      : "";
  }
}

export async function saveSophonPredownloadDirectory(
  storage: Storage,
  directory: string
) {
  if (directory !== "" && !isAbsolutePredownloadDirectory(directory))
    throw new Error(sophonDownloaderText("en").pathError);
  // An empty preference overrides an inherited directory from older versions.
  await storage.setKey(SOPHON_PREDOWNLOAD_DIRECTORY_KEY, directory);
}

export async function readSophonSettings(): Promise<SophonSettings> {
  let initial = { ...sophonDefaults };
  try {
    const { predownloadDirectory: _legacyDirectory, ...saved } =
      await readStoredSettings();
    const stored = { ...sophonDefaults, ...saved };
    for (const field of sophonNumberSettings) {
      const value = stored[field.key];
      stored[field.key] = Number.isFinite(value)
        ? Math.max(field.min, Math.min(field.max, Math.trunc(value)))
        : sophonDefaults[field.key];
    }
    stored.maxCachedFileHandles = Math.max(
      stored.maxCachedFileHandles,
      stored.ioPolicy === "serialized" ? 1 : stored.writes
    );
    if (!sophonSettingsError(stored)) initial = stored;
  } catch {
    // Use defaults if stored settings cannot be read.
  }
  return initial;
}

export async function saveSophonSettings(value: SophonSettings) {
  const error = sophonSettingsError(value);
  if (error) throw new Error(error);
  // Preserve the old preference as a fallback for games without a saved choice.
  const { predownloadDirectory } = await readStoredSettings();
  await setKey(
    SOPHON_SETTINGS_KEY,
    JSON.stringify(
      isAbsolutePredownloadDirectory(predownloadDirectory)
        ? { ...value, predownloadDirectory }
        : value
    )
  );
}

export async function sophonPredownloadPath(
  root: string,
  gameDirectory: string
) {
  if (!isAbsolutePredownloadDirectory(root)) return undefined;
  const path = normalize(gameDirectory).replace(/\/+$/, "");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(path)
  );
  const id = Array.from(new Uint8Array(hash), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return join(root, `yaaglm-sophon-${id}`);
}

export function sophonOperationSettings(settings: SophonSettings) {
  return {
    downloads: settings.downloads,
    writes: settings.writes,
    checks: settings.checks,
    postProcessors: settings.postProcessors,
    maxRetries: settings.maxRetries,
    retryInterval: settings.retryInterval,
    maxCachedFileHandles: settings.maxCachedFileHandles,
    transfer: {
      memoryLimit: settings.memoryMiB * 1024 ** 2,
      diskLimit: settings.diskGiB * 1024 ** 3,
      diskCacheEnabled: settings.diskCacheEnabled,
      entryLimit: settings.entryLimit,
      ioPolicy: settings.ioPolicy,
      writeMode: settings.writeMode,
      preserveState: settings.preserveState,
    },
  };
}

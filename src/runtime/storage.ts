import { join } from "path-browserify";
import {
  readFile,
  removeFile,
  writeFile,
} from "../platform/neutralino/filesystem";
import { env } from "../platform/neutralino/system";
import { exec } from "./command-runner";

let storageNamespace: string | undefined;

function storageKeyHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function shouldNamespaceStorageKey(key: string) {
  return (
    key == "game_install_dir" ||
    key == "hoyoplay_bg" ||
    key == "patched" ||
    key == "predownloaded_all" ||
    key.startsWith("predownloaded_") ||
    key == "left_cmd" ||
    key == "config_retina" ||
    key == "config_block_net" ||
    key == "config_block_net_duration" ||
    key == "config_block_net_hosts" ||
    key == "config_runtime_replacements" ||
    key == "config_hk4e_enable_hdr" ||
    key == "config_metalfx_enable" ||
    key == "config_metalfx_factor" ||
    key == "config_mhypbase_replacement_path" ||
    key == "config_patch_off" ||
    key == "config_preferred_max_fps" ||
    key == "config_resolution_custom" ||
    key == "config_resolution_width" ||
    key == "config_resolution_height" ||
    key == "config_steam_patch" ||
    key == "config_timeout_fix" ||
    key == "config_vsync_disable" ||
    key == "config_workaround4" ||
    key == "config_proxyEnabled" ||
    key == "config_proxyHost" ||
    key == "config_metalHud"
  );
}

function oldYaaglmStorageAppsForNamespace(namespace: string | undefined) {
  switch (namespace) {
    case "hpgenshin":
      return ["Yaaglm OS", "Yaaglm"];
    case "hphsr":
      return ["Yaaglm HSR OS", "Yaaglm HSR"];
    case "hpzzz":
      return ["Yaaglm ZZZ OS", "Yaaglm ZZZ"];
    case "hpcngenshin":
      return ["Yaaglm"];
    case "hpcnhsr":
      return ["Yaaglm HSR"];
    case "hpcnzzz":
      return ["Yaaglm ZZZ"];
    default:
      return undefined;
  }
}

function getNeutralinoStorageKey(key: string) {
  const namespacedKey =
    storageNamespace && shouldNamespaceStorageKey(key)
      ? `${storageNamespace}_${key}`
      : key;
  const validKey = namespacedKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (validKey.length <= 50) return validKey;
  const namespace = storageNamespace
    ? storageNamespace.replace(/[^a-zA-Z0-9_-]/g, "_")
    : "k";
  return `${namespace}_${storageKeyHash(validKey)}`.slice(0, 50);
}

function assertStorageKeyFormat(key: string) {
  if (!/^[a-zA-Z-_0-9]{1,50}$/.test(key)) {
    throw new Error(
      `Invalid storage key format. The key should match regex: ^[a-zA-Z-_0-9]{1,50}$ (${key})`
    );
  }
}

async function getOldYaaglStorageFile(appName: string, key: string) {
  assertStorageKeyFormat(key);
  return join(
    await env("HOME"),
    "Library",
    "Application Support",
    appName,
    ".storage",
    `${key}.neustorage`
  );
}

async function getOldYaaglStorageValue(appNames: string[], key: string) {
  for (const appName of appNames) {
    try {
      return await readFile(await getOldYaaglStorageFile(appName, key));
    } catch {
      // Try the next compatible old app storage location.
    }
  }
  throw new Error(`Unable to find storage key: ${key}`);
}

async function setOldYaaglStorageValue(
  appName: string,
  key: string,
  value: string | null
) {
  const path = await getOldYaaglStorageFile(appName, key);
  const storageDir = join(
    await env("HOME"),
    "Library",
    "Application Support",
    appName,
    ".storage"
  );
  await exec(["mkdir", "-p", storageDir]);
  if (value === null) {
    try {
      await removeFile(path);
    } catch {
      // Already unset.
    }
    return;
  }
  await writeFile(path, value);
}

function getOldYaaglStorageRoute(key: string) {
  return storageNamespace && shouldNamespaceStorageKey(key)
    ? oldYaaglmStorageAppsForNamespace(storageNamespace)
    : undefined;
}

export function getActiveStorageNamespace() {
  return storageNamespace;
}

let namespaceQueue: Promise<void> = Promise.resolve();

function enqueueNamespaceBlock<T>(run: () => Promise<T>): Promise<T> {
  const result = namespaceQueue.then(run);
  namespaceQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function withStorageNamespace<T>(
  namespace: string,
  fn: () => Promise<T>
): Promise<T> {
  return enqueueNamespaceBlock(async () => {
    const previous = storageNamespace;
    storageNamespace = namespace;
    try {
      return await fn();
    } finally {
      storageNamespace = previous;
    }
  });
}

export function activateStorageNamespace(
  namespace: string
): Promise<() => void> {
  return enqueueNamespaceBlock(async () => {
    const previous = storageNamespace;
    storageNamespace = namespace;
    return () => {
      storageNamespace = previous;
    };
  });
}

export async function getKey(key: string): Promise<string> {
  const oldApps = getOldYaaglStorageRoute(key);
  if (oldApps) return getOldYaaglStorageValue(oldApps, key);
  return Neutralino.storage.getData(getNeutralinoStorageKey(key));
}

export async function getKeyOrDefault(key: string, defaultValue: string) {
  try {
    return await getKey(key);
  } catch {
    return defaultValue;
  }
}

export async function setKey(key: string, value: string | null) {
  const oldApps = getOldYaaglStorageRoute(key);
  if (oldApps) return setOldYaaglStorageValue(oldApps[0], key, value);
  return Neutralino.storage.setData(getNeutralinoStorageKey(key), value);
}

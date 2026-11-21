import { dirname, join } from "path-browserify";
import {
  readFile,
  removeFile,
  writeFile,
} from "../platform/neutralino/filesystem";
import { resolve } from "../platform/neutralino/path";
import { env } from "../platform/neutralino/system";
import { exec } from "./command-runner";

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
    key == "hyp_bg" ||
    key == "patched" ||
    key == "predownloaded_all" ||
    key == "sophon_predownload_root" ||
    key == "sophon_predownload_target" ||
    key == "sophon_predownload_directory" ||
    key.startsWith("predownloaded_") ||
    key == "left_cmd" ||
    key == "config_retina" ||
    key == "config_block_net" ||
    key == "config_block_net_duration" ||
    key == "config_block_net_hosts" ||
    key == "config_runtime_replacements" ||
    key == "config_custom_environment_variables" ||
    key == "config_exit_on_window_close" ||
    key == "config_hk4e_enable_hdr" ||
    key == "config_metalfx_enable" ||
    key == "config_metalfx_factor" ||
    key == "config_mhypbase_replacement_path" ||
    key == "config_patch_off" ||
    key == "config_preferred_max_fps" ||
    key == "config_dxmt_refresh_rate" ||
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
    case "hpbh3":
      return ["Yaaglm Honkai Global"];
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

function getNeutralinoStorageKey(key: string, namespace?: string) {
  const namespacedKey =
    namespace && shouldNamespaceStorageKey(key) ? `${namespace}_${key}` : key;
  const validKey = namespacedKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (validKey.length <= 50) return validKey;
  const validNamespace = namespace
    ? namespace.replace(/[^a-zA-Z0-9_-]/g, "_")
    : "k";
  return `${validNamespace}_${storageKeyHash(validKey)}`.slice(0, 50);
}

function getCurrentStorageFile(key: string, namespace?: string) {
  return join(
    ".storage",
    `${getNeutralinoStorageKey(key, namespace)}.neustorage`
  );
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

function getOldYaaglStorageRoute(key: string, namespace?: string) {
  if (
    !namespace ||
    !shouldNamespaceStorageKey(key) ||
    key === "sophon_predownload_directory"
  )
    return undefined;
  const oldApps = oldYaaglmStorageAppsForNamespace(namespace);
  // Keep new DXMT preferences in the current game's scope; the old FPS
  // key still follows the compatibility route for migration.
  return key === "config_dxmt_refresh_rate" ? oldApps?.slice(0, 1) : oldApps;
}

export type Storage = {
  readonly namespace?: string;
  getKey(key: string): Promise<string>;
  getKeyOrDefault(key: string, defaultValue: string): Promise<string>;
  setKey(key: string, value: string | null): Promise<void>;
};

/** Creates an immutable storage view for one launcher scope. */
export function createStorage(namespace?: string): Storage {
  return {
    namespace,
    async getKey(key: string) {
      const oldApps = getOldYaaglStorageRoute(key, namespace);
      if (oldApps) {
        const apps =
          key === "sophon_predownload_root" ||
          key === "sophon_predownload_target"
            ? oldApps.slice(0, 1)
            : oldApps;
        return getOldYaaglStorageValue(apps, key);
      }
      return readFile(getCurrentStorageFile(key, namespace));
    },
    async getKeyOrDefault(key: string, defaultValue: string) {
      try {
        return await this.getKey(key);
      } catch {
        return defaultValue;
      }
    },
    async setKey(key: string, value: string | null) {
      const oldApps = getOldYaaglStorageRoute(key, namespace);
      if (oldApps) return setOldYaaglStorageValue(oldApps[0], key, value);
      const path = getCurrentStorageFile(key, namespace);
      if (value === null) {
        try {
          await removeFile(path);
        } catch {
          // Already unset.
        }
        return;
      }
      // neu run keeps its cwd at the repo root while NL_PATH points at the
      // staging directory. A relative mkdir would miss the directory writeFile
      // actually uses, and Neutralino does not create missing parents.
      await exec(["mkdir", "-p", dirname(resolve(path))]);
      await writeFile(path, value);
    },
  };
}

export const globalStorage = createStorage();

export async function getKey(key: string): Promise<string> {
  return globalStorage.getKey(key);
}

export async function getKeyOrDefault(key: string, defaultValue: string) {
  return globalStorage.getKeyOrDefault(key, defaultValue);
}

export async function setKey(key: string, value: string | null) {
  return globalStorage.setKey(key, value);
}

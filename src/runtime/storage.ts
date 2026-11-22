import { dirname, join } from "path-browserify";
import {
  readFile,
  removeFile,
  writeFile,
} from "../platform/neutralino/filesystem";
import { resolve } from "../platform/neutralino/path";
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
    key == "config_nap_metalfx_enable" ||
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

export type Storage = {
  readonly namespace?: string;
  getKey(key: string): Promise<string>;
  getKeyOrDefault(key: string, defaultValue: string): Promise<string>;
  setKey(key: string, value: string | null): Promise<void>;
};

/** Creates an immutable storage view for one launcher scope. */
export function createStorage(namespace?: string): Storage {
  const writeValue = async (key: string, value: string) => {
    const path = getCurrentStorageFile(key, namespace);
    // neu run keeps its cwd at the repo root while NL_PATH points at the
    // staging directory. A relative mkdir would miss the directory writeFile
    // actually uses, and Neutralino does not create missing parents.
    await exec(["mkdir", "-p", dirname(resolve(path))]);
    await writeFile(path, value);
  };

  return {
    namespace,
    async getKey(key: string) {
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
      const path = getCurrentStorageFile(key, namespace);
      if (value === null) {
        try {
          await removeFile(path);
        } catch {
          // Already unset.
        }
        return;
      }
      await writeValue(key, value);
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

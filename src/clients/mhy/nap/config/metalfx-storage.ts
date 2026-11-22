import { configEntries, createConfigStore, type ConfigStore } from "@config";
import {
  METALFX_FACTOR_DEFAULT,
  normalizeMetalFxFactor,
} from "@config/metalfx-factor";
import { globalStorage, type Storage } from "@runtime/storage";

export const NAP_METALFX_CONFIG_KEY = "config_nap_metalfx_enable";

/** Reads the ZZZ MetalFX switch from the current game scope. */
export async function readNapMetalFxEnabled(storage: Storage = globalStorage) {
  try {
    return (await storage.getKey(NAP_METALFX_CONFIG_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function writeNapMetalFxEnabled(
  storage: Storage,
  enabled: boolean
) {
  await storage.setKey(NAP_METALFX_CONFIG_KEY, enabled ? "true" : "false");
}

/**
 * Reads the upscale factor ZZZ hands to DXMT. It shares the key of the other
 * clients, so it is already scoped to the current game.
 */
export async function readNapMetalFxFactor(
  store: ConfigStore = createConfigStore(globalStorage)
) {
  try {
    return normalizeMetalFxFactor(
      (await store.read(configEntries.metalFxFactor)) ?? METALFX_FACTOR_DEFAULT
    );
  } catch {
    return METALFX_FACTOR_DEFAULT;
  }
}

export async function writeNapMetalFxFactor(
  store: ConfigStore,
  factor: number
) {
  const normalized = normalizeMetalFxFactor(factor);
  await store.write(configEntries.metalFxFactor, normalized);
  return normalized;
}

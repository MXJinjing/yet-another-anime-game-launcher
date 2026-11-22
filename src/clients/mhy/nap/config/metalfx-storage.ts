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

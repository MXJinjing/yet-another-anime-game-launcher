import { booleanCodec, type Config, type ConfigStore } from "@config";
import type { ConfigEntry } from "@config/config-entry";

const entries = {
  steamPatch: { key: "config_steam_patch", ...booleanCodec },
  timeoutFix: { key: "config_timeout_fix", ...booleanCodec },
  blockNet: { key: "config_block_net", ...booleanCodec },
} satisfies Record<string, ConfigEntry<boolean>>;

type Setting = keyof typeof entries;
type GameSettings = Partial<Record<Setting, boolean>>;
const controls = new WeakMap<
  Partial<Config>,
  Partial<Record<Setting, (value: boolean) => void>>
>();

export function bindRecommendedSetting(
  config: Partial<Config>,
  setting: Setting,
  syncControl: (value: boolean) => void
) {
  const bound = controls.get(config) ?? {};
  bound[setting] = syncControl;
  controls.set(config, bound);
}

export function getRecommendedGameSettings(channelId: string): GameSettings {
  if (channelId.startsWith("hk4e") || channelId.startsWith("nap")) {
    return { steamPatch: true, timeoutFix: true, blockNet: false };
  }
  if (channelId.startsWith("hkrpg")) return { blockNet: true };
  return {};
}

export async function applyRecommendedGameSettings(
  store: ConfigStore,
  channelId: string,
  config?: Partial<Config>
) {
  const preset = getRecommendedGameSettings(channelId);
  for (const setting of Object.keys(preset) as Setting[]) {
    const value = preset[setting];
    if (value === undefined) continue;
    const entry = entries[setting];
    if ((await store.read(entry)) !== value) await store.write(entry, value);
    if (config) {
      config[setting] = value;
      controls.get(config)?.[setting]?.(value);
    }
  }
}

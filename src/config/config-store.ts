import { globalStorage, type Storage } from "../runtime/storage";
import type { ConfigEntry } from "./config-entry";
import { validateConfigKey, validateConfigValue } from "./config-validation";

export interface ConfigStore {
  read<T>(entry: ConfigEntry<T>): Promise<T | undefined>;
  write<T>(entry: ConfigEntry<T>, value: T): Promise<void>;
  remove<T>(entry: ConfigEntry<T>): Promise<void>;
}

export function createConfigStore(storage: Storage = globalStorage): ConfigStore {
  return {
    async read<T>(entry: ConfigEntry<T>) {
      validateConfigKey(entry.key);
      try {
        const value = await storage.getKey(entry.key);
        return value == null ? entry.defaultValue : entry.parse(value);
      } catch {
        return entry.defaultValue;
      }
    },
    async write<T>(entry: ConfigEntry<T>, value: T) {
      validateConfigKey(entry.key);
      const serialized = entry.serialize(value);
      validateConfigValue(serialized);
      await storage.setKey(entry.key, serialized);
    },
    async remove<T>(entry: ConfigEntry<T>) {
      validateConfigKey(entry.key);
      await storage.setKey(entry.key, null);
    },
  };
}

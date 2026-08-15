/** A typed, serializable configuration value backed by Neutralino storage. */
export interface ConfigEntry<T> {
  key: string;
  defaultValue?: T;
  parse(value: string): T;
  serialize(value: T): string;
}

export function defineConfigEntry<T>(entry: ConfigEntry<T>): ConfigEntry<T> {
  return entry;
}

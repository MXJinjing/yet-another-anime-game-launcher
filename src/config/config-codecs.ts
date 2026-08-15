import type { ConfigEntry } from "./config-entry";

export const stringCodec = {
  parse: (value: string) => value,
  serialize: (value: string) => value,
};

export const booleanCodec = {
  parse: (value: string) => value === "true",
  serialize: (value: boolean) => (value ? "true" : "false"),
};

export const finiteNumberCodec = {
  parse: (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error("Configuration value is not a finite number");
    }
    return parsed;
  },
  serialize: (value: number) => String(value),
};

export function withDefault<T>(
  key: string,
  defaultValue: T,
  codec: Pick<ConfigEntry<T>, "parse" | "serialize">
): ConfigEntry<T> {
  return { key, defaultValue, ...codec };
}

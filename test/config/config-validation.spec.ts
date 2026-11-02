import { describe, expect, it } from "vitest";
import {
  validateConfigKey,
  validateConfigValue,
} from "@config/config-validation";
import {
  booleanCodec,
  finiteNumberCodec,
  stringCodec,
  withDefault,
} from "@config/config-codecs";
import { normalizeHttpProxy } from "@config/proxy";

describe("configuration validation and codecs", () => {
  it.each(["a", "config_download-limit_1", "a".repeat(50)])(
    "accepts safe keys: %s",
    key => expect(() => validateConfigKey(key)).not.toThrow()
  );
  it.each(["", "a".repeat(51), "../file", "a/b", "a\n", "a\0", "键"])(
    "rejects unsafe keys: %s",
    key =>
      expect(() => validateConfigKey(key)).toThrow("Invalid configuration key")
  );
  it.each([null, "", "text\nwith Unicode 中文"])(
    "accepts storable values",
    value => expect(() => validateConfigValue(value)).not.toThrow()
  );
  it("rejects NUL bytes", () => {
    expect(() => validateConfigValue("a\0b")).toThrow("NUL");
  });
  it("round trips strings and booleans without truthy coercion", () => {
    expect(stringCodec.parse(stringCodec.serialize("false 中文"))).toBe(
      "false 中文"
    );
    for (const value of [true, false])
      expect(booleanCodec.parse(booleanCodec.serialize(value))).toBe(value);
    expect(booleanCodec.parse("TRUE")).toBe(false);
    expect(booleanCodec.parse("1")).toBe(false);
  });
  it.each(["NaN", "Infinity", "-Infinity", "invalid"])(
    "rejects non-finite numbers: %s",
    value =>
      expect(() => finiteNumberCodec.parse(value)).toThrow("finite number")
  );
  it.each([0, -1, 1.25])("round trips finite numbers", value => {
    expect(finiteNumberCodec.parse(finiteNumberCodec.serialize(value))).toBe(
      value
    );
  });
  it("preserves a typed default and codec", () => {
    const entry = withDefault("download_limit", 10, finiteNumberCodec);
    expect(entry.defaultValue).toBe(10);
    expect(entry.parse("12.5")).toBe(12.5);
    expect(entry.serialize(12.5)).toBe("12.5");
  });
  it.each([
    ["  ", ""],
    [" proxy.local:8080 ", "http://proxy.local:8080"],
    ["https://proxy.local", "https://proxy.local"],
    ["HTTP://proxy.local", "HTTP://proxy.local"],
  ])("normalizes a configured HTTP proxy", (input, output) => {
    expect(normalizeHttpProxy(input)).toBe(output);
  });
});

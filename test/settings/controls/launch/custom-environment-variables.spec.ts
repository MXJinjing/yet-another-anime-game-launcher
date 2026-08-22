import { describe, expect, it } from "vitest";
import {
  getCustomEnvironmentVariables,
  parseCustomEnvironmentVariables,
  serializeCustomEnvironmentVariables,
} from "@src/config/custom-environment-variables";

describe("custom environment variables", () => {
  it("keeps only valid persisted rows", () => {
    expect(
      parseCustomEnvironmentVariables([
        { enabled: true, key: "FOO", value: "bar" },
        { enabled: false, key: "DISABLED", value: "value" },
        { enabled: true, key: "BROKEN" },
      ])
    ).toEqual([
      { enabled: true, key: "FOO", value: "bar" },
      { enabled: false, key: "DISABLED", value: "value" },
    ]);
  });

  it("serializes rows without dropping disabled entries", () => {
    const entries = [
      { enabled: true, key: "FOO", value: "bar" },
      { enabled: false, key: "DISABLED", value: "value" },
    ];
    expect(
      parseCustomEnvironmentVariables(
        JSON.parse(serializeCustomEnvironmentVariables(entries))
      )
    ).toEqual(entries);
  });

  it("returns enabled variables and ignores blank keys", () => {
    expect(
      getCustomEnvironmentVariables({
        customEnvironmentVariablesEnabled: true,
        customEnvironmentVariables: [
          { enabled: true, key: " FOO ", value: "bar" },
          { enabled: false, key: "DISABLED", value: "ignored" },
          { enabled: true, key: " ", value: "ignored" },
          { enabled: true, key: "FOO", value: "later" },
        ],
      })
    ).toEqual({ FOO: "bar" });
  });

  it("does not return variables when the setting is disabled", () => {
    expect(
      getCustomEnvironmentVariables({
        customEnvironmentVariablesEnabled: false,
        customEnvironmentVariables: [
          { enabled: true, key: "FOO", value: "bar" },
        ],
      })
    ).toEqual({});
  });
});

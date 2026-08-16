import { describe, expect, it } from "vitest";
import {
  parseBlockHostRulesText,
  serializeBlockHostRules,
  serializeEnabledBlockHostsText,
} from "@src/settings/controls/launch/block-hosts";

describe("block hosts settings conversion", () => {
  it("converts legacy defaults into unique URL rows", () => {
    expect(
      parseBlockHostRulesText(
        "example.com 0.0.0.0\nexample.com ::1\napi.example.com 0.0.0.0"
      )
    ).toEqual([
      { enabled: true, domain: "example.com" },
      { enabled: true, domain: "api.example.com" },
    ]);
  });

  it("stores disabled rows separately from the launch hosts text", () => {
    const rules = [
      { enabled: true, domain: "example.com" },
      { enabled: false, domain: "disabled.example" },
    ];
    expect(parseBlockHostRulesText(serializeBlockHostRules(rules))).toEqual(
      rules
    );
    expect(serializeEnabledBlockHostsText(rules)).toBe(
      "example.com 0.0.0.0\nexample.com ::1"
    );
  });

  it("writes both IPv4 and IPv6 entries for each enabled URL", () => {
    expect(
      serializeEnabledBlockHostsText([
        { enabled: true, domain: "one.example" },
        { enabled: true, domain: "two.example" },
      ])
    ).toBe(
      "one.example 0.0.0.0\none.example ::1\ntwo.example 0.0.0.0\ntwo.example ::1"
    );
  });

  it("keeps invalid entries in the table without emitting unsafe hosts text", () => {
    const rules = [
      { enabled: true, domain: "not a domain" },
      { enabled: false, domain: "also-not-a-domain" },
    ];
    expect(serializeEnabledBlockHostsText(rules)).toBe("");
    expect(parseBlockHostRulesText(serializeBlockHostRules(rules))).toEqual(
      rules
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  buildBlockHosts,
  parseBlockHostsText,
} from "@src/clients/mhy/block-hosts";

describe("block hosts validation", () => {
  it("keeps an empty custom hosts list as a valid no-op", () => {
    expect(parseBlockHostsText("\n  \n")).toEqual([]);
  });

  it("accepts normal hostnames with IPv4 and IPv6 addresses", () => {
    expect(
      parseBlockHostsText(
        "example.com 0.0.0.0\napi.example.com. ::1\nxn--fiqs8s.example 127.0.0.1"
      )
    ).toEqual([
      { domain: "example.com", ip: "0.0.0.0" },
      { domain: "api.example.com.", ip: "::1" },
      { domain: "xn--fiqs8s.example", ip: "127.0.0.1" },
    ]);
  });

  it.each([
    "$(touch${IFS}/tmp/owned)",
    "`id`",
    'bad"domain',
    "bad'domain",
    "bad;domain",
    "bad&domain",
    "bad|domain",
    "bad/domain",
    "-example.com",
    "example-.com",
    "example..com",
  ])("rejects unsafe or invalid domain %s", domain => {
    expect(() => parseBlockHostsText(`${domain} 0.0.0.0`)).toThrow();
  });

  it("validates default hosts instead of bypassing the parser", () => {
    expect(() =>
      buildBlockHosts({ blockNetHostsText: undefined } as never, [
        { domain: "$(id)", ip: "0.0.0.0" },
      ])
    ).toThrow();
  });
});

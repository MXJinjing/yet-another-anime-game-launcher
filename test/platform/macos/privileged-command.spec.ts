import { describe, expect, it } from "vitest";
import { runInSudo } from "@platform/macos/privileged-command";

describe("runInSudo", () => {
  it("shows the supplied operation purpose in the authorization prompt", () => {
    expect(runInSudo("/usr/bin/true", 'Update the launcher "app".')).toBe(
      'osascript -e do\\ shell\\ script\\ \\"/usr/bin/true\\"\\ with\\ administrator\\ privileges\\ with\\ prompt\\ \\"Update\\ the\\ launcher\\ \\\\\\"app\\\\\\".\\"'
    );
  });
});

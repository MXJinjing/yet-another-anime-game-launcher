import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "@platform/shell";
import { hostsWriteCommand } from "@system/hosts-write";

describe("hosts replacement", () => {
  it("preserves literal formats, Unicode, newlines and shell syntax", () => {
    const dir = mkdtempSync(join(tmpdir(), "hosts-write-"));
    try {
      const path = join(dir, "hosts");
      writeFileSync(path, "original");
      const content =
        "# 100% ready 中文 'quote' $(exit 9) `exit 8` \\n\n127.0.0.1\tlocalhost\n";
      execFileSync("/bin/sh", ["-c", build(hostsWriteCommand(content, path))]);
      expect(readFileSync(path, "utf8")).toBe(content);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("keeps the original hosts file if preparing the replacement fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "hosts-write-failure-"));
  try {
    const path = join(dir, "hosts");
    writeFileSync(path, "original\n");
    // Force mktemp to fail without touching the original file.
    const command = build(hostsWriteCommand("replacement", path));
    expect(() =>
      execFileSync("/bin/sh", ["-c", command], {
        env: { PATH: "/nonexistent" },
        stdio: "pipe",
      })
    ).toThrow();
    expect(readFileSync(path, "utf8")).toBe("original\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

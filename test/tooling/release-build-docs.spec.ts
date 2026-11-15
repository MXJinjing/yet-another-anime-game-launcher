import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each(["README.md", "docs/README.zh-CN.md", "docs/RELEASE_BUILD.zh-CN.md"])(
  "documents the existing batch release command for each architecture in %s",
  file => {
    const root = new URL("../../", import.meta.url);
    const text = readFileSync(new URL(file, root), "utf8");
    const commands = [
      ...text.matchAll(/^YAAGL_BUILD_ARCH=(\S+) bash (\S+)$/gm),
    ];
    expect(commands.map(([, architecture]) => architecture)).toEqual([
      "arm64",
      "x64",
      "universal",
    ]);
    for (const script of new Set(commands.map(([, , path]) => path))) {
      execFileSync("bash", ["-n", fileURLToPath(new URL(script, root))]);
    }
  }
);

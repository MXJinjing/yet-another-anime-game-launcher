import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const buildScript = readFileSync(resolve(__dirname, "../build-app.js"), "utf8");

describe("parameterized launcher resource sync", () => {
  it("runs from Application Support but loads resources from the app", () => {
    expect(buildScript).toContain('cd "$APST_DIR"');
    expect(buildScript).toContain('--path="$CONTENTS_DIR/Resources"');
    expect(buildScript).toContain("export YAAGL_BUNDLE_PATH=");
  });

  it("does not copy or delete app resources in Application Support", () => {
    expect(buildScript).not.toContain("rsync -rlptu --delete");
    expect(buildScript).not.toContain('"$APST_DIR/sidecar"');
    expect(buildScript).not.toContain('"$APST_DIR/resources.neu"');
    expect(buildScript).not.toContain('rm -rf "$APST_DIR"');
    expect(buildScript).not.toContain('rm -rf "$APST_DIR/.storage"');
  });
});

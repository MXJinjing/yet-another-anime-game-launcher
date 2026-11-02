import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Run the repository's ESM entrypoint directly, including on the CI Node version.
const script = new URL("../../scripts/check-coverage.mjs", import.meta.url)
  .href;
function evaluate(source: string) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { checkThresholds, sophonSummary } from ${JSON.stringify(
          script
        )}; ${source}`,
      ],
      { encoding: "utf8" }
    )
  );
}
describe("coverage policy", () => {
  it("accepts the exact threshold", () => {
    expect(
      evaluate(
        "console.log(JSON.stringify(checkThresholds({total:{lines:80},files:{}},{global:{lines:80},files:{}})))"
      )
    ).toEqual([]);
  });
  it("rejects lowered coverage and missing required files", () => {
    const failures = evaluate(
      'console.log(JSON.stringify(checkThresholds({total:{lines:79},files:{}},{global:{lines:80},files:{"required.ts":{lines:90}}})))'
    );
    expect(failures).toHaveLength(2);
    expect(failures[1]).toContain("missing");
  });
  it("rejects malformed metric values", () => {
    expect(
      evaluate(
        'console.log(JSON.stringify(checkThresholds({total:{lines:"100"},files:{}},{global:{lines:80},files:{}})))'
      )
    ).toHaveLength(1);
  });
  it("computes Python line coverage separately from the combined percentage", () => {
    const summary = evaluate(
      "console.log(JSON.stringify(sophonSummary({totals:{covered_lines:8,num_statements:10,covered_branches:1,num_branches:4,percent_covered:64},files:{}})))"
    );
    expect(summary.total).toEqual({ lines: 80, branches: 25 });
  });
  it("fails when the coverage report is missing", () => {
    const directory = mkdtempSync(join(tmpdir(), "yaaglm-coverage-policy-"));
    try {
      mkdirSync(join(directory, "test"));
      writeFileSync(
        join(directory, "test/coverage-thresholds.json"),
        JSON.stringify({ frontend: { global: { lines: 80 }, files: {} } })
      );
      expect(() =>
        execFileSync(
          process.execPath,
          [resolve("scripts/check-coverage.mjs"), "frontend"],
          { cwd: directory, stdio: "pipe" }
        )
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

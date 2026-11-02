import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** Fail closed when a required file or metric is absent or malformed. */
export function checkThresholds(summary, policy) {
  const failures = [];
  const check = (name, metrics, required) => {
    for (const [metric, minimum] of Object.entries(required)) {
      const actual = metrics?.[metric];
      if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
        throw new Error(`Invalid coverage threshold for ${name}: ${metric}`);
      }
      if (!Number.isFinite(actual) || actual < minimum) {
        failures.push(
          `${name}: ${metric} ${actual ?? "missing"}% < ${minimum}%`
        );
      }
    }
  };
  check("global", summary.total, policy.global);
  for (const [file, required] of Object.entries(policy.files)) {
    check(file, summary.files[file], required);
  }
  return failures;
}

export function frontendSummary(report, root) {
  const metrics = value =>
    Object.fromEntries(
      ["lines", "statements", "branches", "functions"].map(key => [
        key,
        value?.[key]?.pct,
      ])
    );
  return {
    total: metrics(report.total),
    files: Object.fromEntries(
      Object.entries(report)
        .filter(([name]) => name !== "total")
        .map(([name, value]) => [
          relative(root, name).replaceAll("\\", "/"),
          metrics(value),
        ])
    ),
  };
}

export function sophonSummary(report) {
  const pct = (covered, total) => {
    if (
      !Number.isFinite(covered) ||
      !Number.isFinite(total) ||
      total < 0 ||
      covered < 0 ||
      covered > total
    )
      return undefined;
    return total === 0 ? 100 : (covered / total) * 100;
  };
  const metrics = value => ({
    lines: pct(value?.covered_lines, value?.num_statements),
    branches: pct(value?.covered_branches, value?.num_branches),
  });
  return {
    total: metrics(report.totals),
    files: Object.fromEntries(
      Object.entries(report.files).map(([name, value]) => [
        name,
        metrics(value.summary),
      ])
    ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const kind = process.argv[2];
    if (kind !== "frontend" && kind !== "sophon")
      throw new Error("Usage: node scripts/check-coverage.mjs frontend|sophon");
    const root = process.cwd();
    const policy = JSON.parse(
      readFileSync(resolve(root, "test/coverage-thresholds.json"), "utf8")
    )[kind];
    const file =
      kind === "frontend"
        ? "coverage/frontend/coverage-summary.json"
        : "coverage/sophon/coverage.json";
    const report = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    const summary =
      kind === "frontend"
        ? frontendSummary(report, root)
        : sophonSummary(report);
    const failures = checkThresholds(summary, policy);
    if (failures.length) throw new Error(failures.join("\n"));
    console.log(`${kind}: all coverage thresholds passed`);
    console.log(JSON.stringify(summary.total));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

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

export function swiftSummary(report, root) {
  const data = report.data?.[0];
  if (
    report.type !== "llvm.coverage.json.export" ||
    report.data?.length !== 1 ||
    !Array.isArray(data.files)
  ) {
    throw new Error("Invalid Swift coverage export");
  }
  const files = {};
  const totals = {
    lines: { count: 0, covered: 0 },
    regions: { count: 0, covered: 0 },
  };
  const base = resolve(root, "sophon_server/swift");
  for (const file of data.files) {
    const name = relative(base, file.filename).replaceAll("\\", "/");
    if (!name.startsWith("Sources/") || name.endsWith(".pb.swift")) continue;
    if (files[name]) throw new Error(`Duplicate Swift coverage entry: ${name}`);
    files[name] = {};
    for (const key of ["lines", "regions"]) {
      const { count, covered } = file.summary?.[key] ?? {};
      if (
        !Number.isSafeInteger(count) ||
        !Number.isSafeInteger(covered) ||
        count < 0 ||
        covered < 0 ||
        covered > count
      ) {
        throw new Error(`Invalid Swift ${key} coverage for ${name}`);
      }
      files[name][key] = count ? (covered / count) * 100 : 100;
      totals[key].count += count;
      totals[key].covered += covered;
    }
  }
  if (!totals.lines.count || !totals.regions.count) {
    throw new Error("Swift coverage contains no handwritten source");
  }
  return {
    total: Object.fromEntries(
      Object.entries(totals).map(([key, { count, covered }]) => [
        key,
        (covered / count) * 100,
      ])
    ),
    files,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const kind = process.argv[2];
    if (!["frontend", "sophon", "swift"].includes(kind))
      throw new Error("Usage: node scripts/check-coverage.mjs frontend|sophon|swift");
    const root = process.cwd();
    const policy = JSON.parse(
      readFileSync(resolve(root, "test/coverage-thresholds.json"), "utf8")
    )[kind];
    const file =
      kind === "frontend"
        ? "coverage/frontend/coverage-summary.json"
        : kind === "swift"
        ? "coverage/sophon/coverage.json"
        : "coverage/sophon-python/coverage.json";
    const report = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    const summary =
      kind === "frontend"
        ? frontendSummary(report, root)
        : kind === "swift"
        ? swiftSummary(report, root)
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

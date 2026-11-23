import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const upstreamPayload = "src/clients/secret.b64";
const launcherPayload = "src/constants/yaaglm-config.b64";

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 ** 2,
  });
}

function normalize(text) {
  return text.normalize("NFKC").toLowerCase();
}

function findAddedNames(diff, containsName) {
  const locations = new Set();
  let source = "";
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      source = "";
    } else if (line.startsWith("+++ ") && !inHunk) {
      source = line.slice(4);
    } else if (line.startsWith("@@ ")) {
      inHunk = true;
    } else if (inHunk && line.startsWith("+") && containsName(line.slice(1))) {
      locations.add(containsName(source) ? "a changed file" : source);
    }
  }

  return [...locations].map(
    source => `Use neutral names in additions to ${source}.`
  );
}

const [baseRef, headRef] = process.argv.slice(2);
if (!baseRef || !headRef) {
  console.error("Usage: node scripts/check-channel-branding.mjs <base> <head>");
  process.exit(2);
}

const head = git(
  "rev-parse",
  "--verify",
  "--end-of-options",
  `${headRef}^{commit}`
).trim();
const baseCommit = git(
  "rev-parse",
  "--verify",
  "--end-of-options",
  `${baseRef}^{commit}`
).trim();
const base = git("merge-base", baseCommit, head).trim();
const payload = Buffer.from(
  git("show", `${head}:${launcherPayload}`),
  "base64"
);
const { brandingTerms } = JSON.parse(payload.toString("utf8"));
if (
  !Array.isArray(brandingTerms) ||
  !brandingTerms.length ||
  brandingTerms.some(term => typeof term !== "string" || !term.trim())
) {
  throw new Error(
    "The launcher payload must contain a nonempty branding terms list."
  );
}
const names = brandingTerms.map(normalize);
const containsName = value => {
  const normalized = normalize(value);
  return names.some(name => normalized.includes(name));
};

const violations = [];
if (
  git(
    "diff",
    "--name-only",
    "--no-renames",
    base,
    head,
    "--",
    upstreamPayload
  ).trim()
) {
  violations.push(
    "Keep the upstream payload byte-for-byte unchanged. Put launcher additions in the Yaaglm payload."
  );
}

violations.push(
  ...findAddedNames(
    git(
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "--unified=0",
      base,
      head,
      "--",
      ".",
      ":(exclude)sophon_server/**",
      `:(exclude)${upstreamPayload}`,
      `:(exclude)${launcherPayload}`
    ),
    containsName
  )
);

for (const commit of git("rev-list", `${base}..${head}`)
  .trim()
  .split("\n")
  .filter(Boolean)) {
  if (containsName(git("show", "-s", "--format=%B", commit))) {
    violations.push(`Use neutral names in commit ${commit.slice(0, 12)}.`);
  }
}

if (
  process.env.GITHUB_EVENT_NAME === "pull_request" &&
  process.env.GITHUB_EVENT_PATH
) {
  const { pull_request: pr } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")
  );
  if (containsName(pr.title))
    violations.push("Use neutral names in the pull request title.");
  if (containsName(pr.body ?? ""))
    violations.push("Use neutral names in the pull request description.");
}

if (violations.length) {
  for (const message of violations) console.error(message);
  process.exitCode = 1;
} else {
  console.log("Channel naming and configuration checks passed.");
}

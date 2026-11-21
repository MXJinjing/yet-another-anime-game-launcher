# Tests, coverage, and main protection

Run the frontend tests with pnpm and Node.js. Install dependencies with `pnpm install --frozen-lockfile`. The frontend also needs the ignored channel configuration: `base64 -d -i src/clients/secret.b64 -o src/clients/secret.ts` on macOS, or the equivalent decode on Linux. Tests mock platform operations and do not require a running launcher, Neutralino, or real game downloads. Swift and the legacy Python API are not part of CI.

| Command                  | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `pnpm test`              | All frontend unit and regression tests, once                  |
| `pnpm run test:watch`    | Frontend tests in watch mode                                  |
| `pnpm run test:coverage` | Frontend tests, full-source coverage, and coverage thresholds |
| `pnpm run test:sophon`   | Optional local Swift mirror tests; not a CI gate              |
| `pnpm run test:sophon-python` | Optional local legacy API tests; not a CI gate           |
| `pnpm run test:all`      | Frontend coverage plus the optional local Sophon suites       |

The Swift suite uses local fixtures for manifest browsing, file selection, integrity, transfer recovery, and JSON-RPC. Export `SOPHON_LIVE_TESTS=1` to opt into the upstream tests that contact the public game APIs. The legacy API suite uses uv and the existing Python coverage policy.

The checks above do not build the app. Follow AGENTS.md for when local type, lint, and format checks are permitted.

## Coverage policy

Frontend coverage includes every executable TypeScript and TSX module under `src/`, including unexecuted files. Only declarations, secrets, and generated/runtime directories are excluded. Solid transforms are mapped back to their source files. Swift coverage includes handwritten source for the CLI, API client and transfer engine. The legacy Python coverage policy remains in effect.

`test/coverage-thresholds.json` defines the full-source baseline and separate thresholds for critical files. `scripts/check-coverage.mjs` fails for insufficient coverage, missing required files, missing reports, or malformed metrics. New baseline values should reflect tests that exercise behavior; increase the values when adding coverage. Keep untested source in the denominator.

CI enforces the frontend minimum only. The Swift and legacy Python minimums below apply to the optional local commands, not to pull requests.

| Scope    | Lines | Statements    | Branches | Functions     |
| -------- | ----- | ------------- | -------- | ------------- |
| Frontend | 27%   | 26%           | 30%      | 17%           |
| Legacy Python Sophon | 68%   | Same as lines | 48% | Not collected |
| Swift Sophon | 68% | 58% LLVM regions | | |

Fourteen frontend files also have independent line and branch thresholds, covering download orchestration, Wine selection and installation, process monitoring, self-updates, binary operations, and task execution. Swift also has dedicated thresholds for file selection, task controls, install, patch, download cache and RPC transport. These gates preserve the tested baseline; the remaining interface and channel-specific logic still needs additional tests.

Reports are ignored by Git:

- `coverage/frontend/index.html`: frontend source-level report.
- `coverage/frontend/coverage-summary.json`: machine-readable frontend metrics.
- `coverage/sophon/coverage.json` and `tests.log`: Swift LLVM coverage and test output.
- `coverage/sophon-python/html/index.html`, `coverage.json`, and `junit.xml`: legacy Python reports.

Python coverage.py's default total combines executed statements and branch destinations. The policy computes lines and branches separately, so its line percentage differs from that combined total.

## CI and release gates

`.github/workflows/tests.yaml` is shared by PR checks, main builds, and tag releases. It runs frontend code checks and the frontend coverage policy on `ubuntu-latest`, then uploads that report. It does not compile, test, or synchronize the Sophon source mirror. Unit tests prepare their configuration without downloading the full Neutralino runtime.

The PR workflow also supports merge queues and manual runs. It skips the frontend job only when a pull request changes nothing outside `sophon_server/`. Its final job is named `check`; it runs with `always()` and succeeds when the required frontend tests succeeded, or when those tests were not required. Failed, cancelled, or missing required tests cannot silently produce a successful gate. Keep this job name stable because main protection requires it.

Manual main builds and release packaging jobs depend on the shared tests. A failing test or coverage policy prevents packaging and draft release publication. Pushing or merging to `main`, and pushing a tag, does not automatically run Build Main or Build Release. Start Build Release from the Actions tab on the tested `main` commit. Leave the version empty to use `package.json`, or enter a new tag in the form. The workflow creates that tag when the draft release is published.

## Remote main protection

The fork's active repository ruleset is [Protect main](https://github.com/MXJinjing/yet-another-anime-game-launcher/rules/26380803). Its reproducible configuration is `.github/main-protection.json`:

- Updates go through PRs.
- The `check` status must come from GitHub Actions (app ID 15368).
- The PR must be tested against the latest main.
- Review conversations must be resolved.
- Force pushes and branch deletion are blocked.
- The bypass list is empty, including for administrators.

Approval from another person is optional (`required_approving_review_count: 0`), allowing a sole maintainer to merge after checks pass. Repository administrators can still edit the ruleset itself.

The rule is managed independently from workflow files. Workflow changes must pass the protected PR checks before they become the default CI configuration.

An administrator can inspect or update the existing rule with:

```sh
gh api repos/MXJinjing/yet-another-anime-game-launcher/rulesets/26380803
gh api --method PUT repos/MXJinjing/yet-another-anime-game-launcher/rulesets/26380803 \
  --input .github/main-protection.json
```

See [GitHub's rules API](https://docs.github.com/en/rest/repos/rules) for the configuration fields. The API read-back is sufficient to verify enforcement without attempting a destructive push.

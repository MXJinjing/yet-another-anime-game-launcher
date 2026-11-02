# Tests, coverage, and main protection

Run the tests on macOS with pnpm, Node.js, and uv installed. Install frontend dependencies with `pnpm install --frozen-lockfile`. The frontend also needs the ignored channel configuration: `base64 -d -i src/clients/secret.b64 -o src/clients/secret.ts`. Tests mock platform operations and do not require a running launcher or real game downloads.

| Command                  | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `pnpm test`              | All frontend unit and regression tests, once                  |
| `pnpm run test:watch`    | Frontend tests in watch mode                                  |
| `pnpm run test:coverage` | Frontend tests, full-source coverage, and coverage thresholds |
| `pnpm run test:sophon`   | Python tests, coverage, and coverage thresholds               |
| `pnpm run test:all`      | Both coverage suites and all coverage thresholds              |

`test:sophon` installs the locked Python development dependencies, generates the ignored protobuf modules with the locked compiler, and temporarily stages the correct hpatchz binary from `sidecar/`. It preserves an existing hpatchz and removes only the file it staged. It uses pytest to collect both unittest classes and free test functions. The sidecar currently imports macOS system libraries, so these tests run on macOS.

The checks above do not build the app. Follow AGENTS.md for when local type, lint, and format checks are permitted.

## Coverage policy

Frontend coverage includes every executable TypeScript and TSX module under `src/`, including unexecuted files. Only declarations, secrets, and generated/runtime directories are excluded. Solid transforms are mapped back to their source files. Python coverage includes all eight sidecar business modules and excludes tests, generated protobuf code, virtual environments, and build directories.

`test/coverage-thresholds.json` defines the full-source baseline and separate thresholds for critical files. `scripts/check-coverage.mjs` fails for insufficient coverage, missing required files, missing reports, or malformed metrics. New baseline values should reflect tests that exercise behavior; increase the values when adding coverage. Keep untested source in the denominator.

Current global minimums:

| Scope    | Lines | Statements    | Branches | Functions     |
| -------- | ----- | ------------- | -------- | ------------- |
| Frontend | 27%   | 26%           | 30%      | 17%           |
| Sophon   | 68%   | Same as lines | 48%      | Not collected |

Fourteen frontend files also have independent line and branch thresholds, covering download orchestration, Wine selection and installation, process monitoring, self-updates, binary operations, and task execution. Four Python modules have independent thresholds. These gates preserve the tested baseline; the remaining interface and channel-specific logic still needs additional tests.

Reports are ignored by Git:

- `coverage/frontend/index.html`: frontend source-level report.
- `coverage/frontend/coverage-summary.json`: machine-readable frontend metrics.
- `coverage/sophon/html/index.html`: Python source-level report.
- `coverage/sophon/coverage.json`: Python line and branch metrics.
- `coverage/sophon/junit.xml`: Python test results.

Python coverage.py's default total combines executed statements and branch destinations. The policy computes lines and branches separately, so its line percentage differs from that combined total.

## CI and release gates

`.github/workflows/tests.yaml` is shared by PR checks, main builds, and tag releases. It runs frontend code checks and both coverage suites, and uploads the two coverage reports. Unit tests prepare their configuration without downloading the full Neutralino runtime.

The PR workflow also supports merge queues and manual runs. Its final job is named `check`; it runs with `always()` and succeeds only if the shared test workflow succeeded. Failed, cancelled, or skipped tests cannot silently produce a successful gate. Keep this job name stable because main protection requires it.

Manual main builds and tag packaging jobs depend on the shared tests. A failing test or coverage policy prevents packaging and draft release publication. Pushing or merging to main does not automatically run Build Main. Use its workflow_dispatch entrypoint for a manual build; version tags still trigger Build Release.

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

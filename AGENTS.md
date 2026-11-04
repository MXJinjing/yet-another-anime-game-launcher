# Repository Guidelines

## Project Overview
Yaaglm (Yet Another Anime Game Launcher Modified) is a macOS desktop launcher built with Neutralinojs, a SolidJS + TypeScript (Vite) UI, and a Python "Sophon" sidecar server. Each supported game/region is a channel selected at build time via the `YAAGL_CHANNEL_CLIENT` environment variable.

## Project Structure & Module Organization
- `src/` — Frontend source (TS/TSX): `clients/` per-channel game configs; `config/` launcher settings; `launcher/` game library, launch, and task-queue logic; `utils/` helpers with co-located tests; `locale/`, `icons/`, `assets/` for i18n, icons, and static assets.
- `sophon_server/` — Python sidecar (uv-managed; `pyproject.toml`, `uv.lock`).
- `sidecar/` — bundled binaries (aria2, 7z, hpatchz, xdelta, built Sophon server).
- `bin/`, `external/`, `dist/`, `dev/` — generated artifacts; gitignored, never commit them.
- Root scripts: `configure.sh`, `build-app.js`, `build-all.sh`, `build-sophon.sh`.

## Build, Test, and Development Commands
- `pnpm install` — install dependencies.
- `./configure.sh` — one-time setup: decodes the channel secret and fetches Neutralinojs binaries.
- `pnpm dev` — Vite dev server; `pnpm start` — build and run the default (`hk4ecn`) channel; `pnpm run start-<channel>` for others.
- `pnpm build` / `pnpm run build-<channel>` — production builds; `node build-app.js` / `./build-all.sh` — package release `.app` bundles.
- `pnpm exec tsc` — type check; `pnpm run lint` — ESLint over `src`; `pnpm run format` / `format-check` — Prettier write/check.
- `pnpm exec vitest` — run unit tests; `pnpm run precommit` — tsc + lint + format-check.

## Coding Style & Naming Conventions
- TypeScript in strict mode; SolidJS components are PascalCase, files are kebab-case (`command-builder.ts`).
- Prettier defaults (semicolons, double quotes, no arrow parens) in `.prettierrc`; ESLint config in `.eslintrc`.
- Import through tsconfig path aliases: `@config/*`, `@locale/*`, `@utils`, `@constants`, `@aria2`, `@wine`, `@sophon`.

## Testing Guidelines
- Vitest (configured in `vite.config.ts`); co-locate tests as `src/**/*.spec.ts` next to the code they cover, run in a Node environment.

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`, `style:`; scope game-specific fixes (e.g., `fix(hk4e):`).
- Never mention real game or company names in commits, issues, or PRs — use "The Anime Game" / "The Anime Company".
- PRs to `main` must pass CI (`ci-pr.yaml` / `tests.yaml`: type check, lint, format, frontend tests, Python tests, and coverage policies), including the required `check` status. Link the related issue, describe the change, and add screenshots for UI changes.
- Support questions belong on Discord; file issues only for technical problems with logs and system info.

## Required Branch and PR Workflow (IMPORTANT)

1. Start every new task that changes repository files (including documentation, tests, configuration, and CI) on a new `codex/<task>` branch based on the latest remote `main`: `git fetch fork main`, then `git switch -c codex/<task> fork/main`. Keep follow-up fixes for that task on the same branch until its PR is merged. Do not make or commit changes directly on local `main`, and do not reuse an already merged task branch for a new task. Preserve unrelated working changes; do not reset or discard them to switch branches.
2. Use the `fork` remote and target `MXJinjing/yet-another-anime-game-launcher`. The `upstream` remote is for reading upstream changes; do not push there or open a PR there unless explicitly requested.
3. Make the requested changes and run appropriate tests. Use `pnpm run test:coverage` for frontend behavior, `pnpm run test:sophon` for sidecar behavior, or `pnpm run test:all` for both. Follow the local verification timing below; documentation-only changes do not require rebuilding the app.
4. Review the diff and commit only files belonging to the task. Keep secrets, generated artifacts, reports, and unrelated files out of the commit. Push the task branch with `git push -u fork codex/<task>` and open a PR targeting the fork's `main`, for example `gh pr create --repo MXJinjing/yet-another-anime-game-launcher --base main --head codex/<task>`. Describe the final change and its validation in the PR.
5. Wait for both shared test jobs and the required `check` status to succeed. Queued, missing, failed, cancelled, or skipped tests are not a pass. Fix failures on the PR branch and let CI run again. If `main` advances, update the branch and wait for checks against the updated code.
6. Merge through the protected PR after checks pass, matching the verified PR head (for example with `gh pr merge --merge --match-head-commit <verified-head-sha>`). Never push directly to `main`, use an administrator bypass, disable protection, or weaken coverage gates to get a change merged. After merging, fetch `fork/main` and fast-forward local `main`; do not force-reset local work.
7. For a requested release, create a new version tag on the merged, tested commit and push only that tag to trigger `Build Release`. Keep `Build Main` manual-only: merging or pushing to `main` must not automatically start a packaging build unless the user explicitly asks to restore that behavior.

## Security & Configuration Tips
- `secret.ts` and `*.secret.ts` are gitignored; regenerate with `./configure.sh`. Never commit secrets or tokens.
- Add a new game as a file in `src/clients/`, then register its channel in `build-all.sh`.

## Verification Timing (IMPORTANT)
- Do NOT automatically run local `pnpm exec tsc`, `pnpm run lint`, or `pnpm run format-check` right after modifying code.
- Only run these local checks when the user explicitly asks to build (`pnpm build`, `pnpm run build-<channel>`, `node build-app.js`, `./build-all.sh`, or similar), immediately before the build.
- This timing restriction applies to local checks. Automatic PR and release CI must always run their configured checks and coverage policies.

## Shared Sophon source maintenance

- Keep source-copy integration; do not convert Sophon to a Git submodule.
- The canonical shared server lives in the sibling `sophon` repository (`MXJinjing/sophon`). Implement shared fixes there first, commit them, then run `python3 scripts/sync-sophon.py --source ../sophon --apply` here.
- `sophon_server/upstream-lock.json` pins the source commit and SHA-256 hashes. Use `--check` to verify synchronization; `--apply` refuses divergent local shared edits that have not been backported.
- Copy only shared server source, protobuf schemas, license and server tests. Keep launcher UI, build adapters, dependency/test configuration, README and `test_launcher_*.py` local. Generated protobuf, environments, caches, build outputs and the standalone release packaging test are excluded.
- Update the API references in both repositories for shared protocol changes. Commit the refreshed revision lock with each source synchronization.

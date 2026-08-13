# Repository Guidelines

## Project Overview
Yaagl (Yet Another Anime Game Launcher) is a macOS desktop launcher built with Neutralinojs, a SolidJS + TypeScript (Vite) UI, and a Python "Sophon" sidecar server. Each supported game/region is a channel selected at build time via the `YAAGL_CHANNEL_CLIENT` environment variable.

## Project Structure & Module Organization
- `src/` — Frontend source (TS/TSX): `clients/` per-channel game configs; `config/` launcher settings; `launcher/` game library, launch, and task-queue logic; `utils/` helpers with co-located tests; `locale/`, `icons/`, `assets/` for i18n, icons, and static assets.
- `sophon_server/` — Python sidecar (uv-managed; `pyproject.toml`, `uv.lock`).
- `sidecar/` — bundled binaries (aria2, 7z, hpatchz, xdelta, built Sophon server).
- `bin/`, `external/`, `dist/`, `yaaglwd*/` — generated artifacts; gitignored, never commit them.
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
- PRs to `main` must pass CI (`ci-pr.yaml`: tsc, format-check, lint). Link the related issue, describe the change, and add screenshots for UI changes.
- Support questions belong on Discord; file issues only for technical problems with logs and system info.

## Security & Configuration Tips
- `secret.ts` and `*.secret.ts` are gitignored; regenerate with `./configure.sh`. Never commit secrets or tokens.
- Add a new game as a file in `src/clients/`, then register its channel in `build-all.sh`.

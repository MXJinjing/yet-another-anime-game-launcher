import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** The architecture suite lives outside production and audits only src/. */
const srcRoot = resolve(process.cwd(), "src");

type SourceFile = {
  path: string;
  source: string;
};

const aliases: Readonly<Record<string, string>> = {
  "@config": "config/index.ts",
  "@download": "download/index.ts",
  "@logging": "logging/index.ts",
  "@locale": "locale/index.ts",
  "@platform": "platform/index.ts",
  "@runtime": "runtime/index.ts",
  "@services": "services/index.ts",
  "@settings": "settings/index.ts",
  "@sophon": "integrations/sophon.ts",
  "@tasks": "tasks/index.ts",
  "@wine": "wine/index.ts",
  "@aria2": "integrations/aria2.ts",
};

const temporaryBoundaryExceptions = [
  {
    source: "src/wine/cert.ts",
    target: "src/clients/secret",
  },
  {
    source: "src/wine/wine-install-program.ts",
    target: "src/clients/secret",
  },
] as const;

const removedCompatibilityPaths = [
  "src/utils/command-builder.ts",
  "src/utils/connection-error.ts",
  "src/utils/helper.ts",
  "src/utils/index.ts",
  "src/utils/neu.ts",
  "src/utils/theme-color.ts",
  "src/utils/unix.ts",
  "src/notifications/task-notifications.ts",
  "src/update/common-update-ui.tsx",
  "src/download/download-budget.ts",
  "src/download/download-control.ts",
  "src/download/download-queue.ts",
  "src/download/download-task.ts",
  "src/download/downloadable-resource.ts",
] as const;

function sourceFiles(directory = srcRoot): SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || entry.name.endsWith(".spec.ts")) {
      return [];
    }
    return [
      {
        path: relative(process.cwd(), entryPath),
        source: readFileSync(entryPath, "utf8"),
      },
    ];
  });
}

function importSources(source: string): string[] {
  const sources: string[] = [];
  const expression =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'\"]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(expression)) sources.push(match[1]);
  return sources;
}

function normalizeInternalImport(
  filePath: string,
  source: string
): string | null {
  if (source.startsWith(".")) {
    return posix
      .resolve("/", posix.dirname(filePath), source)
      .replace(/^\//, "");
  }

  for (const [alias, destination] of Object.entries(aliases)) {
    if (source === alias) return `src/${destination}`;
    if (source.startsWith(`${alias}/`)) {
      return `src/${destination.replace(
        /\/index\.(?:ts|tsx)$/,
        ""
      )}/${source.slice(alias.length + 1)}`;
    }
  }
  return null;
}

function layerFor(path: string): number | null {
  const normalized = path.replace(/^src\//, "");
  if (normalized.startsWith("platform/")) return 0;
  if (normalized.startsWith("runtime/") || normalized.startsWith("logging/"))
    return 1;
  if (
    normalized.startsWith("locale/") ||
    normalized.startsWith("config/") ||
    normalized.startsWith("services/") ||
    normalized === "tasks/task-program" ||
    normalized === "tasks/task-program.ts"
  ) {
    return 2;
  }
  if (
    normalized.startsWith("integrations/") ||
    normalized.startsWith("download/") ||
    normalized.startsWith("system/")
  ) {
    return 3;
  }
  if (
    normalized.startsWith("wine/") ||
    normalized.startsWith("update/") ||
    normalized === "tasks/task-runner" ||
    normalized === "tasks/task-runner.ts" ||
    normalized === "tasks/task-notifications" ||
    normalized === "tasks/task-notifications.ts"
  ) {
    return 4;
  }
  if (
    normalized.startsWith("clients/") ||
    normalized.startsWith("settings/") ||
    normalized.startsWith("modals/") ||
    normalized === "tasks/task-progress-screen" ||
    normalized === "tasks/task-progress-screen.ts"
  ) {
    return 5;
  }
  if (normalized.startsWith("launcher/")) return 6;
  if (normalized === "app.tsx" || normalized === "app.ts") return 7;
  if (normalized === "index.tsx" || normalized === "index.ts") return 8;
  return null;
}

function exceptionFor(source: string, target: string): boolean {
  return temporaryBoundaryExceptions.some(
    exception =>
      exception.source === source && target.startsWith(exception.target)
  );
}

describe("source import architecture", () => {
  const productionFiles = sourceFiles();

  it("keeps imports flowing toward the composition root", () => {
    const violations: string[] = [];
    for (const file of productionFiles) {
      const sourceLayer = layerFor(file.path);
      if (sourceLayer === null) continue;
      for (const imported of importSources(file.source)) {
        const target = normalizeInternalImport(file.path, imported);
        if (!target || exceptionFor(file.path, target)) {
          continue;
        }
        const targetLayer = layerFor(target);
        if (targetLayer !== null && targetLayer > sourceLayer) {
          violations.push(
            `${file.path} (L${sourceLayer}) -> ${target} (L${targetLayer})`
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the task progress view independent from channel clients", () => {
    const taskProgressScreen = productionFiles.find(
      file => file.path === "src/tasks/task-progress-screen.tsx"
    );
    expect(taskProgressScreen).toBeDefined();
    const imports = importSources(taskProgressScreen?.source ?? "")
      .map(source =>
        normalizeInternalImport("src/tasks/task-progress-screen.tsx", source)
      )
      .filter((source): source is string => source !== null);
    expect(imports.some(source => source.startsWith("src/clients/"))).toBe(
      false
    );
  });

  it("keeps service orchestration capabilities behind injected interfaces", () => {
    const serviceImports = productionFiles
      .filter(file => file.path.startsWith("src/services/"))
      .flatMap(file =>
        importSources(file.source).map(source => ({
          file: file.path,
          target: normalizeInternalImport(file.path, source),
        }))
      );

    const forbidden = serviceImports.filter(
      ({ target }) =>
        target !== null &&
        (target.startsWith("src/download/") ||
          target.startsWith("src/modals/") ||
          target.startsWith("src/launcher/"))
    );
    expect(forbidden).toEqual([]);

    const closeController = productionFiles.find(
      file => file.path === "src/services/window-close-controller.ts"
    )?.source;
    expect(closeController).toContain("hasActiveDownloads: () => boolean");
    expect(closeController).toContain("hideWindow: () => Promise<void>");
    expect(closeController).toContain("exit: () => Promise<void>");

    const installationService = productionFiles.find(
      file => file.path === "src/services/game-installation.ts"
    )?.source;
    expect(installationService).toContain("openFolderDialog?:");
  });

  it("documents every direct Wine-to-client secret dependency as a temporary exception", () => {
    const secretImports = productionFiles
      .filter(file => file.path.startsWith("src/wine/"))
      .flatMap(file =>
        importSources(file.source)
          .map(source => ({
            source: file.path,
            target: normalizeInternalImport(file.path, source),
          }))
          .filter(
            (edge): edge is { source: string; target: string } =>
              edge.target?.startsWith("src/clients/secret") ?? false
          )
      );
    const undocumented = secretImports.filter(
      edge => !exceptionFor(edge.source, edge.target)
    );
    expect(undocumented).toEqual([]);
  });

  it("keeps removed compatibility paths and aliases from returning", () => {
    expect(
      removedCompatibilityPaths.filter(path =>
        existsSync(resolve(process.cwd(), path))
      )
    ).toEqual([]);

    const tsconfig = readFileSync(
      resolve(process.cwd(), "tsconfig.json"),
      "utf8"
    );
    expect(tsconfig).not.toContain('"@utils"');
    expect(tsconfig).not.toContain('"@common-update-ui"');

    const imports = productionFiles.flatMap(file => importSources(file.source));
    expect(
      imports.filter(
        source => source === "@utils" || source.startsWith("@utils/")
      )
    ).toEqual([]);
    expect(
      imports.filter(
        source =>
          source === "@common-update-ui" ||
          source.includes("common-update-ui") ||
          source.includes("launcher/domain")
      )
    ).toEqual([]);
  });
});

import { fileOrDirExists, resolve, stats } from "@platform/neutralino";
import { join } from "path-browserify";
import { exec } from "@runtime/command-runner";
import { getKey, setKey } from "@runtime/storage";
import { warn } from "@logging/logger";
import {
  ensureActiveWineCompatLink,
  getWineInstallDir,
  isWineDistroInstalled,
} from "./wine";
import {
  type CustomWineEntry,
  findConfiguredWine,
  getCustomWineId,
  GPTK_WINE_ID,
  readCustomWineEntries,
  registerSystemWineRoot,
} from "./system-wine";
import {
  D3DMETAL_ARCHIVE_SHA256,
  D3DMETAL_RUNTIME_ID,
  D3DMETAL_RUNTIME_URL,
} from "./d3dmetal";

export interface WineDistributionAttributes {
  renderBackend: "dxmt" | "d3dmetal";
  supportsD3d12: boolean;
  winePath: string; // Path to the wine directory inside the archive
}

export function isWineRuntimeReady(
  attributes: Partial<WineDistributionAttributes>,
  dxmtInstalled: boolean
) {
  return attributes.renderBackend !== "dxmt" || dxmtInstalled;
}

export interface WineDistribution {
  id: string;
  displayName: string;
  remoteUrl: string;
  checksum?: `sha-256=${string}`;
  attributes: Partial<WineDistributionAttributes>;
  /** A Wine root supplied by a system application rather than downloaded. */
  systemWineRoot?: string;
  /** The persisted entry selected for a user-managed local Wine. */
  customWine?: CustomWineEntry;
}

const GPTK_APP_PATH = "/Applications/Game Porting Toolkit.app";
const GPTK_WINE_ROOT = `${GPTK_APP_PATH}/Contents/Resources/wine`;

export const RECOMMENDED_WINE_DISTRO_ID =
  "11.0-1-crossover-signed-experimental";

const RECOMMENDED_WINE_DISTRO: WineDistribution = {
  id: RECOMMENDED_WINE_DISTRO_ID,
  displayName: "Wine 11.0-1 Crossover (signed, experimental)",
  remoteUrl:
    "https://github.com/yaagl/anime-game-wine/releases/download/wine-crossover-11.0-1-signed/wine-crossover-11.0-1-osx64-signed.tar.xz",
  checksum:
    "sha-256=89fa7e90fb626523a90d5867a03c6be785d017176739c6320a3b86c7838c3a35",
  attributes: {
    renderBackend: "dxmt",
    winePath: "wine",
  },
};

export function resolveRecommendedWineDistro(): WineDistribution {
  return RECOMMENDED_WINE_DISTRO;
}

const YAAGL_BUILTIN_WINE: WineDistribution[] = [
  RECOMMENDED_WINE_DISTRO,
  {
    id: "11.0-dxmt-signed-with-patches",
    displayName: "Wine 11.0 DXMT (signed, with patches)",
    remoteUrl:
      "https://github.com/yaagl/anime-game-wine/releases/download/wine-11.0-signed/wine-devel-11.0-osx64-signed.tar.xz",
    checksum:
      "sha-256=4ebba536115e937c3826fa5808dbed50cd5e91c8454999b54cbe0cd2a43d8b4c",
    attributes: {
      renderBackend: "dxmt",
      winePath: "wine",
    },
  },
  {
    id: "11.8-dxmt-signed-experimental",
    displayName: "Wine 11.8 DXMT (signed, experimental)",
    remoteUrl:
      "https://github.com/yaagl/anime-game-wine/releases/download/wine-11.8-signed/wine-devel-11.8-osx64-signed.tar.xz",
    checksum:
      "sha-256=42430b7e8398642d7121e7cbac0aa03ce7312b4500e4ddf7eb75a7c8f2407a9c",
    attributes: {
      renderBackend: "dxmt",
      winePath: "wine",
    },
  },
  {
    id: "11.4-dxmt-signed",
    displayName: "Wine 11.4 DXMT (signed)",
    remoteUrl:
      "https://github.com/dawn-winery/dawn-signed/releases/download/wine-gcenx-11.4-osx64/wine-devel-11.4-osx64-signed.tar.xz",
    attributes: {
      renderBackend: "dxmt",
      winePath: "wine-devel-11.4-osx64-signed/Contents/Resources/wine",
    },
  },
  {
    id: "11.0-dxmt-signed",
    displayName: "Wine 11.0 DXMT (signed)",
    remoteUrl:
      "https://github.com/dawn-winery/dawn-signed/releases/download/wine-stable-gcenx-11.0-osx64/wine-stable-11.0-osx64-signed.tar.xz",
    attributes: {
      renderBackend: "dxmt",
      winePath: "Wine Stable.app/Contents/Resources/wine",
    },
  },

  {
    id: D3DMETAL_RUNTIME_ID,
    displayName: "Wine 11.17 D3DMetal (GPTK 4.0b2, experimental)",
    remoteUrl: D3DMETAL_RUNTIME_URL,
    checksum: `sha-256=${D3DMETAL_ARCHIVE_SHA256}`,
    attributes: {
      renderBackend: "d3dmetal",
      supportsD3d12: true,
      winePath: "wine",
    },
  },
  {
    id: "9.9-dxmt",
    displayName: "Wine 9.9 DXMT",
    remoteUrl:
      "https://github.com/3Shain/wine/releases/download/v9.9-mingw/wine.tar.gz",
    attributes: {
      renderBackend: "dxmt",
    },
  },
];

export async function getWineDistributions(): Promise<WineDistribution[]> {
  const gptk = await getSystemGPTKWineDistribution();
  const customWines = await getCustomWineDistributions();
  return [...(gptk ? [gptk] : []), ...customWines, ...YAAGL_BUILTIN_WINE];
}

/**
 * GPTK is installed as an application bundle, so it must be detected rather
 * than treated as an archive-managed Wine distribution. The application's
 * Info.plist version is used so all GPTK releases are accepted and labelled
 * with the version that is actually installed.
 */
async function getSystemGPTKWineDistribution(): Promise<WineDistribution | null> {
  try {
    await stats(`${GPTK_WINE_ROOT}/bin/wine64`);
    const version = (
      await exec([
        "/usr/bin/plutil",
        "-extract",
        "CFBundleShortVersionString",
        "raw",
        `${GPTK_APP_PATH}/Contents/Info.plist`,
      ])
    ).stdOut.trim();
    if (!version) return null;

    return {
      id: GPTK_WINE_ID,
      displayName: `Game Porting Toolkit ${version}`,
      remoteUrl: "",
      attributes: { renderBackend: "d3dmetal", supportsD3d12: true },
      systemWineRoot: registerSystemWineRoot(GPTK_WINE_ID, GPTK_WINE_ROOT),
    };
  } catch {
    return null;
  }
}

async function getCustomWineDistributions(): Promise<WineDistribution[]> {
  const entries = await readCustomWineEntries();
  const wines = await Promise.all(
    entries.map(async entry => ({
      entry,
      wine: await findConfiguredWine(entry.binary),
    }))
  );
  const roots = new Set<string>();
  const distributions: WineDistribution[] = [];
  for (const { entry, wine } of wines) {
    if (!wine || wine.root == GPTK_WINE_ROOT || roots.has(wine.root)) {
      continue;
    }
    roots.add(wine.root);
    const id = getCustomWineId(wine.root);
    const hasD3DMetal = await fileOrDirExists(
      join(wine.root, "lib/external/D3DMetal.framework/D3DMetal")
    );
    distributions.push({
      id,
      displayName: entry.name,
      remoteUrl: "",
      attributes: hasD3DMetal
        ? { renderBackend: "d3dmetal", supportsD3d12: true }
        : {},
      systemWineRoot: registerSystemWineRoot(id, wine.root),
      customWine: entry,
    });
  }
  return distributions;
}

export type WineStatus =
  | {
      wineReady: false;
      wineDistribution: WineDistribution;
    }
  | {
      wineReady: true;
      wineDistribution: WineDistribution;
    };

/**
 * Reads the persisted Wine state for the distribution selected by the channel.
 * The channel owns this default, so Wine never imports client registration/UI.
 */
export async function checkWine(
  defaultWineDistroTag: string
): Promise<WineStatus> {
  const wine_versions = await getWineDistributions();
  const defaultDistro = wine_versions.find(x => x.id == defaultWineDistroTag);
  if (!defaultDistro) {
    // A channel can name a distribution that this build no longer ships.
    // Treat it as "Wine not installed" and offer the recommended build, so
    // boot shows the existing initialization flow instead of exiting.
    await warn(
      `can not find default wine version: ${defaultWineDistroTag}; falling back to ${RECOMMENDED_WINE_DISTRO_ID}`
    );
    return {
      wineReady: false,
      wineDistribution: resolveRecommendedWineDistro(),
    };
  }
  try {
    const wineState = await getKey("wine_state");
    if (wineState == "update") {
      const update_wine_tag = await getKey("wine_update_tag");
      const wineDistribution =
        wine_versions.find(x => x.id == update_wine_tag) ?? defaultDistro;
      return {
        wineReady: false,
        wineDistribution,
      } as const;
    }
    if (wineState != "ready") {
      return {
        wineReady: false,
        wineDistribution: defaultDistro,
      };
    }
    const currrent_wine_tag = await getKey("wine_tag");
    const wineDistribution = wine_versions.find(x => x.id == currrent_wine_tag);
    if (wineDistribution) {
      await migrateLegacyWineDir(currrent_wine_tag);
      const wineReady = await isWineDistroInstalled(currrent_wine_tag);
      if (wineReady) {
        await ensureActiveWineCompatLink(currrent_wine_tag);
        return { wineReady: true, wineDistribution } as const;
      }
      return {
        wineReady: false,
        wineDistribution,
      };
    } else {
      // Force re-install for unknown wine version
      return {
        wineReady: false,
        wineDistribution: defaultDistro,
      };
    }
  } catch (e) {
    await migrateLegacyWineDir(defaultDistro.id);
    if (
      (await getKey("wine_state").catch(() => undefined)) == "ready" &&
      (await isWineDistroInstalled(defaultDistro.id))
    ) {
      await ensureActiveWineCompatLink(defaultDistro.id);
      await setKey("wine_tag", defaultDistro.id);
      return {
        wineReady: true,
        wineDistribution: defaultDistro,
      };
    }
    return {
      wineReady: false,
      wineDistribution: defaultDistro,
    } as const;
  }
}

async function migrateLegacyWineDir(distroId: string) {
  if (
    distroId === D3DMETAL_RUNTIME_ID ||
    distroId === GPTK_WINE_ID ||
    distroId.startsWith("custom-wine-")
  )
    return;
  const legacyWineDir = resolve("./wine");
  const versionedWineDir = getWineInstallDir(distroId);
  if (await isWineDistroInstalled(distroId)) return;
  if (!(await fileOrDirExists(legacyWineDir))) return;
  try {
    await exec(["test", "-L", legacyWineDir]);
    return;
  } catch {
    // Not a symlink: this is the legacy single-version Wine directory.
  }
  await exec(["mkdir", "-p", resolve("./wines")]);
  await exec(["mv", legacyWineDir, versionedWineDir]);
}

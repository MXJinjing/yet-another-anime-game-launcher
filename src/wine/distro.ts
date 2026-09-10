import { fileOrDirExists, resolve, stats } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { getKey, setKey } from "@runtime/storage";
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

export interface WineDistributionAttributes {
  renderBackend: "dxmt";
  winePath: string; // Path to the wine directory inside the archive
}

export interface WineDistribution {
  id: string;
  displayName: string;
  remoteUrl: string;
  attributes: Partial<WineDistributionAttributes>;
  /** A Wine root supplied by a system application rather than downloaded. */
  systemWineRoot?: string;
  /** The persisted entry selected for a user-managed local Wine. */
  customWine?: CustomWineEntry;
}

const GPTK_APP_PATH = "/Applications/Game Porting Toolkit.app";
const GPTK_WINE_ROOT = `${GPTK_APP_PATH}/Contents/Resources/wine`;

const YAAGL_BUILTIN_WINE: WineDistribution[] = [
  {
    id: "11.0-1-crossover-signed-experimental",
    displayName: "Wine 11.0-1 Crossover (signed, experimental)",
    remoteUrl:
      "https://github.com/yaagl/anime-game-wine/releases/download/wine-crossover-11.0-1-signed/wine-crossover-11.0-1-osx64-signed.tar.xz",
    attributes: {
      renderBackend: "dxmt",
      winePath: "wine",
    },
  },
  {
    id: "11.0-dxmt-signed-with-patches",
    displayName: "Wine 11.0 DXMT (signed, with patches)",
    remoteUrl:
      "https://github.com/yaagl/anime-game-wine/releases/download/wine-11.0-signed/wine-devel-11.0-osx64-signed.tar.xz",
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
      attributes: {},
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
  return wines.flatMap(({ entry, wine }) => {
    if (!wine || wine.root == GPTK_WINE_ROOT || roots.has(wine.root)) {
      return [];
    }
    roots.add(wine.root);
    const id = getCustomWineId(wine.root);
    return [
      {
        id,
        displayName: entry.name,
        remoteUrl: "",
        attributes: {},
        systemWineRoot: registerSystemWineRoot(id, wine.root),
        customWine: entry,
      },
    ];
  });
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
    throw new Error(
      "can not find default wine version: " + defaultWineDistroTag
    );
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

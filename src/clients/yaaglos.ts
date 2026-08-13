// Merged "Yaagl OS" channel: the three mihoyo global servers share one
// launcher UI (see src/launcher/multi-game.tsx). The actual per-game clients
// are created from their individual client modules; this stub exists so the
// channel-switcher build (vite.config.ts) and src/wine/distro.ts can resolve
// the merged channel as a regular client entry.
import { createClient as createGenshinOsClient } from "./hk4eos";
import type { CreateClientOptions } from "./shared";
import s from "../assets/Nahida.cr.png";

export const DEFAULT_WINE_DISTRO_URL =
  "https://github.com/yaagl/anime-game-wine/releases/download/wine-crossover-11.0-1-signed/wine-crossover-11.0-1-osx64-signed.tar.xz";
export const DEFAULT_WINE_DISTRO_TAG = "11.0-1-crossover-signed-experimental";

export function createClient(options: CreateClientOptions) {
  // The merged launcher builds its own per-game clients; keep this stub
  // functional (delegating to Genshin OS) so nothing breaks if some code
  // path still resolves the default channel client.
  return createGenshinOsClient(options);
}

export const UPDATE_UI_IMAGE = s;

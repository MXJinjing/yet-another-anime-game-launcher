// Merged "Yaaglm CN" channel: the three mihoyo CN servers share one launcher
// UI (see src/launcher/multi-game.tsx). The actual per-game clients are
// created from their individual client modules; this stub exists so the
// channel-switcher build (vite.config.ts) and src/wine/distro.ts can resolve
// the merged channel as a regular client entry.
import { createClient as createGenshinCnClient } from "./hk4ecn";
import type { CreateClientOptions } from "./shared";
import s from "../assets/Nahida.cr.png";

export const DEFAULT_WINE_DISTRO_URL =
  "https://github.com/3Shain/wine/releases/download/v9.9-mingw/wine.tar.gz";
export const DEFAULT_WINE_DISTRO_TAG = "11.0-dxmt-signed-with-patches";

export function createClient(options: CreateClientOptions) {
  // The merged launcher builds its own per-game clients; keep this stub
  // functional (delegating to Genshin CN) so nothing breaks if some code
  // path still resolves the default channel client.
  return createGenshinCnClient(options);
}

export const UPDATE_UI_IMAGE = s;

// The all-client launcher creates its clients through the multi-game
// orchestration. This fallback keeps the channel-switcher entry complete.
import { createClient as createDefaultClient } from "./hk4ecn";
import type { CreateClientOptions } from "./shared";
import s from "../assets/Nahida.cr.png";

export const DEFAULT_WINE_DISTRO_URL =
  "https://github.com/3Shain/wine/releases/download/v9.9-mingw/wine.tar.gz";
export const DEFAULT_WINE_DISTRO_TAG = "11.0-dxmt-signed-with-patches";

export function createClient(options: CreateClientOptions) {
  return createDefaultClient(options);
}

export const UPDATE_UI_IMAGE = s;

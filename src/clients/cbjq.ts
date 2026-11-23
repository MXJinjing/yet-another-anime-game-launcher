import {
  CBJQ_OS_MANIFEST,
  CBJQ_OS_DLC,
  CBJQ_OS_CHANNEL,
  CBJQ_OS_BACKGROUND_URL,
} from "./secret";
import { Server } from "./seasun/server";

import s from "../assets/Nahida.cr.png";

import type { CreateClientOptions } from "./shared";
import { createCBJQChannelClient } from "./seasun/cbjq";

export const DEFAULT_WINE_DISTRO_URL =
  "https://github.com/3Shain/wine/releases/download/v9.9-mingw/wine.tar.gz";
export const DEFAULT_WINE_DISTRO_TAG = "11.0-dxmt-signed-with-patches";
const SERVER_DEFINITION: Server = {
  id: "CBJQ",
  manifest: CBJQ_OS_MANIFEST,
  dlc: CBJQ_OS_DLC,
  channel: CBJQ_OS_CHANNEL,
  background_url: CBJQ_OS_BACKGROUND_URL,
};

export function createClient(options: CreateClientOptions) {
  return createCBJQChannelClient({
    server: SERVER_DEFINITION,
    ...options,
  });
}

export const UPDATE_UI_IMAGE = s;

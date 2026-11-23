import {
  CBJQ_CN_MANIFEST,
  CBJQ_CN_DLC,
  CBJQ_CN_CHANNEL,
  CBJQ_CN_BACKGROUND_URL,
} from "./secret";
import { Server } from "./seasun/server";

import s from "../assets/Nahida.cr.png";

import type { CreateClientOptions } from "./shared";
import { createCBJQChannelClient } from "./seasun/cbjq";

export const DEFAULT_WINE_DISTRO_URL =
  "https://github.com/3Shain/wine/releases/download/v9.9-mingw/wine.tar.gz";
export const DEFAULT_WINE_DISTRO_TAG = "11.0-dxmt-signed-with-patches";

/** It's broken due to AntiCheat */
const SERVER_DEFINITION: Server = {
  id: "CBJQCN",
  manifest: CBJQ_CN_MANIFEST,
  dlc: CBJQ_CN_DLC,
  channel: CBJQ_CN_CHANNEL,
  background_url: CBJQ_CN_BACKGROUND_URL,
};

export function createClient(options: CreateClientOptions) {
  return createCBJQChannelClient({
    server: SERVER_DEFINITION,
    ...options,
  });
}

export const UPDATE_UI_IMAGE = s;

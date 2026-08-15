import { Locale } from "@locale";
import { Server } from "@constants";
import { ChannelClientBackground } from "../../channel-client";
import {
  HoyoConnectGameBackground,
  HoyoConnectGameBackgroundType,
  HoyoConnectGameDisplay,
  HoyoConnectImage,
  HoyoConnectGamePackageMainfest,
  HoyoConnectGetAllGameBasicInfoResponse,
  HoyoConnectGetGamesResponse,
  HoyoConnectGetGamePackagesResponse,
} from "./launcher-info";
import { log } from "@logging/logger";
import { exec } from "@runtime/command-runner";

let hypConnectRequestCount = 0;

async function fetch(url: string, name: string) {
  const requestNumber = ++hypConnectRequestCount;
  log(`[hyp-connect] request #${requestNumber} ${name}: ${url}`);
  const { stdOut } = await exec(["curl", url]);
  return {
    requestNumber,
    async json() {
      const result = JSON.parse(stdOut);
      log(`[hyp-connect] request #${requestNumber} ${name} completed`);
      return result;
    },
  };
}

export type HoyoPlayRegion = "CN" | "OS";

const GET_GAMES_URL: Record<HoyoPlayRegion, string> = {
  CN: "https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getGames?launcher_id=jGHBHlcOq1&language=zh-cn",
  OS: "https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGames?launcher_id=VYTpXlbWo8&language=en-us",
};

/**
 * Fetch the HoYoPlay game catalog once for the merged launcher.
 *
 * The catalog contains the official icon, logo, thumbnail, and background
 * URLs for every game. Callers should reuse the returned map instead of
 * fetching the catalog once per game.
 */
export async function getLatestGameDisplays(
  region: HoyoPlayRegion
): Promise<Map<string, HoyoConnectGameDisplay["display"]>> {
  const url = GET_GAMES_URL[region];
  const response = await fetch(url, "getGames");
  const requestNumber = response.requestNumber;
  const ret: HoyoConnectGetGamesResponse = await response.json();
  const displays = new Map<string, HoyoConnectGameDisplay["display"]>();

  for (const game of ret.data.games) {
    displays.set(game.biz, game.display);
    const assets = Object.entries(game.display)
      .filter(
        (entry): entry is [string, HoyoConnectImage] =>
          typeof entry[1] === "object" &&
          entry[1] !== null &&
          "url" in entry[1] &&
          typeof entry[1].url === "string" &&
          entry[1].url.length > 0
      )
      .map(([name, asset]) => `${name}=${asset.url}`)
      .join(" ");
    log(`[hyp-connect] getGames #${requestNumber} ${game.biz} ${assets}`);
  }

  log(
    `[hyp-connect] getGames request #${requestNumber} catalog: ${ret.data.games.length} games`
  );
  return displays;
}

export async function getLatestAdvInfo(
  locale: Locale,
  server: Server
): Promise<HoyoConnectGameBackground[]> {
  const ret: HoyoConnectGetAllGameBasicInfoResponse = await (
    await fetch(
      server.adv_url +
        (server.id == "CN"
          ? `&language=zh-cn` // CN server has no other language support
          : `&language=${locale.get("CONTENT_LANG_ID")}`),
      "getAllGameBasicInfo"
    )
  ).json();
  const game = ret.data.game_info_list.find(x => x.game.biz == server.id);
  if (!game || game.backgrounds.length < 1)
    throw new Error(`failed to fetch game information: ${server.id}`);

  const sortedBackgrounds = game.backgrounds.sort((a, b) => {
    const isAVideo =
      a.type === HoyoConnectGameBackgroundType.BACKGROUND_TYPE_VIDEO;
    const isBVideo =
      b.type === HoyoConnectGameBackgroundType.BACKGROUND_TYPE_VIDEO;

    if (isAVideo && !isBVideo) return -1;
    if (!isAVideo && isBVideo) return 1;
    return 0;
  });
  return sortedBackgrounds;
}

/** Map raw adv backgrounds to the normalized UI shape used by the launcher. */
export function mapBackgroundsToUiContent(
  backgrounds: HoyoConnectGameBackground[]
): ChannelClientBackground[] {
  return backgrounds.map(bg => ({
    id: bg.id,
    background: bg.background.url,
    background_video: bg.video.url,
    background_theme: bg.theme.url,
    type: bg.type,
  }));
}

export async function getLatestVersionInfo(
  server: Server
): Promise<HoyoConnectGamePackageMainfest> {
  const ret: HoyoConnectGetGamePackagesResponse = await (
    await fetch(server.update_url, "getGamePackages")
  ).json();
  const game = ret.data.game_packages.find(x => x.game.biz == server.id);
  if (!game) throw new Error(`failed to fetch game information: ${server.id}`);
  return game;
}

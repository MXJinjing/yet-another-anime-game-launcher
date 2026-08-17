import { Locale } from "@locale";
import { Server } from "@constants";
import { ChannelClientBackground } from "../../channel-client";
import {
  HoyoConnectGameBackground,
  HoyoConnectGameBackgroundType,
  HoyoConnectGameDisplay,
  HoyoConnectImage,
  HoyoConnectLauncherIcon,
  HoyoConnectGamePackageMainfest,
  HoyoConnectGetAllGameBasicInfoResponse,
  HoyoConnectGetGameContentResponse,
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
  CN:
    "https://hyp-api.mih" +
    "oyo.com/hyp/hyp-connect/api/getGames?launcher_id=jGHBHlcOq1&language=zh-cn",
  OS:
    "https://sg-hyp-api.hoy" +
    "overse.com/hyp/hyp-connect/api/getGames?launcher_id=VYTpXlbWo8&language=en-us",
};

const GET_ALL_GAME_BASIC_INFO_URL: Record<HoyoPlayRegion, string> = {
  CN:
    "https://hyp-api.mih" +
    "oyo.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=jGHBHlcOq1",
  OS:
    "https://sg-hyp-api.hoy" +
    "overse.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=VYTpXlbWo8",
};

const GET_GAME_CONTENT_URL: Record<HoyoPlayRegion, string> = {
  CN:
    "https://hyp-api.mih" +
    "oyo.com/hyp/hyp-connect/api/getGameContent?launcher_id=jGHBHlcOq1",
  OS:
    "https://sg-hyp-api.hoy" +
    "overse.com/hyp/hyp-connect/api/getGameContent?launcher_id=VYTpXlbWo8",
};

function getHoyoPlayRegion(server: Server): HoyoPlayRegion {
  return server.id.endsWith("_cn") ? "CN" : "OS";
}

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

/**
 * Resolve the official game icon from the getGames catalog. Some games (for
 * example bh3_global) omit the background icon in getAllGameBasicInfo, so
 * callers fall back to this catalog asset for the library/header icon.
 */
async function getGameDisplayIcon(
  region: HoyoPlayRegion,
  biz: string
): Promise<string | undefined> {
  try {
    const displays = await getLatestGameDisplays(region);
    return displays.get(biz)?.icon.url || undefined;
  } catch (error) {
    log(
      `[hyp-connect] failed to resolve display icon for ${biz}: ${String(
        error
      )}`
    );
    return undefined;
  }
}

export async function getLatestLauncherContent(
  locale: Locale,
  server: Server
): Promise<{
  backgrounds: HoyoConnectGameBackground[];
  launcherIconButtons: HoyoConnectLauncherIcon[];
  content: HoyoConnectGetGameContentResponse["data"]["content"];
}> {
  const region = getHoyoPlayRegion(server);
  const language = region === "CN" ? "zh-cn" : locale.get("CONTENT_LANG_ID");
  const basicInfoResponse = await fetch(
    `${GET_ALL_GAME_BASIC_INFO_URL[region]}&language=${language}`,
    "getAllGameBasicInfo"
  );
  const basicInfo: HoyoConnectGetAllGameBasicInfoResponse =
    await basicInfoResponse.json();
  const normalizedServerId = server.id.toLowerCase();
  const game = basicInfo.data.game_info_list.find(entry => {
    const biz = entry.game.biz.toLowerCase();
    return (
      biz === normalizedServerId ||
      (normalizedServerId === "bh3_glb" && biz === "bh3_global")
    );
  });
  if (!game || game.backgrounds.length < 1) {
    throw new Error(`failed to fetch game information: ${server.id}`);
  }

  let content: HoyoConnectGetGameContentResponse["data"]["content"] = {
    game: game.game,
    language,
    banners: [],
    posts: [],
    social_media_list: [],
  };
  try {
    const contentResponse = await fetch(
      `${GET_GAME_CONTENT_URL[region]}&game_id=${encodeURIComponent(
        game.game.id
      )}&language=${language}`,
      "getGameContent"
    );
    const contentData: HoyoConnectGetGameContentResponse =
      await contentResponse.json();
    const remoteContent = contentData.data.content;
    content = {
      ...remoteContent,
      banners: remoteContent.banners ?? [],
      posts: remoteContent.posts ?? [],
      social_media_list: remoteContent.social_media_list ?? [],
    };
  } catch (error) {
    log(
      `[hyp-connect] getGameContent failed for ${
        server.id
      }; continuing without announcements/social media: ${String(error)}`
    );
  }

  const sortedBackgrounds = [...game.backgrounds].sort((a, b) => {
    const isAVideo =
      a.type === HoyoConnectGameBackgroundType.BACKGROUND_TYPE_VIDEO;
    const isBVideo =
      b.type === HoyoConnectGameBackgroundType.BACKGROUND_TYPE_VIDEO;

    if (isAVideo && !isBVideo) return -1;
    if (!isAVideo && isBVideo) return 1;
    return 0;
  });

  const launcherIconButtons = mapLauncherIconsToUiContent(sortedBackgrounds);
  // The first background icon doubles as the game icon. Fill it from the
  // getGames catalog when the basic-info endpoint omits it.
  let resolvedBackgrounds = sortedBackgrounds;
  if (!sortedBackgrounds[0]?.icon.url) {
    const displayIcon = await getGameDisplayIcon(region, game.game.biz);
    if (displayIcon) {
      resolvedBackgrounds = sortedBackgrounds.map((bg, index) =>
        index === 0 ? { ...bg, icon: { ...bg.icon, url: displayIcon } } : bg
      );
    }
  }

  return {
    backgrounds: resolvedBackgrounds,
    launcherIconButtons,
    content,
  };
}

/**
 * Backwards-compatible background-only helper. New clients should use
 * getLatestLauncherContent so announcements and social-media entries are
 * fetched in the same startup request sequence as the backgrounds.
 */
export async function getLatestAdvInfo(
  locale: Locale,
  server: Server
): Promise<HoyoConnectGameBackground[]> {
  const { backgrounds } = await getLatestLauncherContent(locale, server);
  return backgrounds;
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

/**
 * Parse launcher action buttons from the remote `icon` fields. These are
 * independent clickable image assets, not part of the background UI data.
 */
export function mapLauncherIconsToUiContent(
  backgrounds: HoyoConnectGameBackground[]
): HoyoConnectLauncherIcon[] {
  return backgrounds
    .filter(bg => bg.icon.url.length > 0)
    .map(bg => ({
      id: bg.id,
      url: bg.icon.url,
      hover_url: bg.icon.hover_url || undefined,
      link: bg.icon.link,
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

import type { Pull } from "./uigf";

import bannerData from "./hk4e-banners.tsv?raw";

// Public CN banner windows and featured item IDs from Snap.Metadata.
// https://github.com/SnapHutaoRemasteringProject/Snap.Metadata/blob/fb3e2692579495c6b181403da01fde1e5b8f9193
const banners = new Map<
  string,
  { start: string; end: string; featured: string[] }[]
>();
for (const line of bannerData.trim().split("\n")) {
  const [pool, start, end, featured] = line.split("\t");
  const entries = banners.get(pool) ?? [];
  entries.push({ start, end, featured: featured.split(",") });
  banners.set(pool, entries);
}

const launch = "2020-09-28";
const standardCharacterSince = new Map([
  ["10000003", launch],
  ["10000016", launch],
  ["10000035", launch],
  ["10000041", launch],
  ["10000042", launch],
  // The corresponding notices announce entry into the following version.
  ["10000069", "2022-09-28 11:00:00"], // v3.1 (notice 23151)
  ["10000079", "2023-04-12 11:00:00"], // v3.6 (notice 105440)
  ["10000109", "2025-03-26 11:00:00"], // v5.5 (notice 129628)
]);

const standardWeapons = new Set([
  "11501",
  "11502",
  "12501",
  "12502",
  "13502",
  "13505",
  "14501",
  "14502",
  "15501",
  "15502",
]);

const chinaTime = (time: string, timezone: number) =>
  new Date(Date.parse(time.replace(" ", "T") + "Z") + (8 - timezone) * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

export function hk4eFeatured(
  pull: Pull,
  timezone: number
): boolean | undefined {
  if (pull.rank_type !== "5") return undefined;
  const china = chinaTime(pull.time, timezone);
  const pool = pull.gacha_type;
  const find = (type: string) =>
    banners
      .get(type)
      ?.find(entry => entry.start <= china && china <= entry.end);
  const banner = find(pool);
  if (!banner) return undefined;
  if (banner.featured.includes(pull.item_id)) return true;
  if (pool === "302")
    return standardWeapons.has(pull.item_id) ? false : undefined;

  const since = standardCharacterSince.get(pull.item_id);
  const canDropOffBanner = since !== undefined && since <= china;
  const otherBanner = find(pool === "301" ? "400" : "301");
  // Some imports combine both character slots under one ID. A character that
  // could also drop off-banner cannot disambiguate which slot was pulled.
  if (otherBanner?.featured.includes(pull.item_id))
    return canDropOffBanner ? undefined : true;

  return canDropOffBanner ? false : undefined;
}

export function hk4eHardPity(pool?: string) {
  if (pool === "301" || pool === "200") return 90;
  if (pool === "302") return 80;
  return undefined;
}

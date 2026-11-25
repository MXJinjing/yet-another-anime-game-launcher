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
  // Some imports normalized both character slots to 301 and lost the original
  // pool ID. A featured item from the other active slot is ambiguous.
  if (
    pool !== "302" &&
    find(pool === "301" ? "400" : "301")?.featured.includes(pull.item_id)
  )
    return undefined;
  return false;
}

export function hk4eHardPity(pool?: string) {
  if (pool === "301" || pool === "200") return 90;
  if (pool === "302") return 80;
  return undefined;
}

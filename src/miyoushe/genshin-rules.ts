import type { Pull } from "./uigf";

// Times are UTC+8. Opening times use the scheduled end of maintenance.
const banners = [
  {
    // https://www.hoyolab.com/article/32500143
    start: "2024-08-28 11:00:00",
    end: "2024-09-17 17:59:59",
    characters: ["10000102", "10000047"],
    weapons: ["14516", "11503"],
  },
  {
    // https://genshin.hoyoverse.com/en/news/detail/167139
    start: "2026-11-04 11:00:00",
    end: "2026-11-24 17:59:59",
    characters: ["10000136", "10000089"],
    weapons: ["14525", "11513"],
  },
];

const chinaTime = (time: string, timezone: number) =>
  new Date(Date.parse(time.replace(" ", "T") + "Z") + (8 - timezone) * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

export function genshinFeatured(
  pull: Pull,
  timezone: number
): boolean | undefined {
  if (pull.rank_type !== "5") return undefined;
  const china = chinaTime(pull.time, timezone);
  const banner = banners.find(
    entry => entry.start <= china && china <= entry.end
  );
  if (!banner) return undefined;
  const pool = pull.gacha_type;
  if (pool === "302") return banner.weapons.includes(pull.item_id);
  if (pool !== "301" && pool !== "400") return undefined;
  const expected = banner.characters[pool === "301" ? 0 : 1];
  if (expected === pull.item_id) return true;
  // Some imports normalized both slots to 301 and lost the original pool ID.
  return banner.characters.includes(pull.item_id) ? undefined : false;
}

export function genshinPoolRule(pool: string, time?: string, timezone = 8) {
  if (pool === "301")
    return {
      hardPity: 90,
      // https://www.hoyolab.com/article/32168979
      radiance:
        time !== undefined &&
        chinaTime(time, timezone) >= "2024-08-28 11:00:00",
    };
  if (pool === "302") return { hardPity: 80, radiance: false };
  if (pool === "200") return { hardPity: 90, radiance: false };
  return undefined;
}

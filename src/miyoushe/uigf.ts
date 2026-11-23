import { miyousheGames, type MiyousheGame } from "./games";

type Pull = {
  id: string;
  gacha_type: string;
  item_id: string;
  time: string;
  uigf_gacha_type?: string;
  gacha_id?: string;
  rank_type?: string;
  count?: string;
  name?: string;
  item_type?: string;
};

type Account = {
  uid: string;
  timezone: number;
  lang?: string;
  list: Pull[];
};

export type GachaArchive = Partial<Record<MiyousheGame, Account[]>>;

const optionalPullFields = [
  "uigf_gacha_type",
  "gacha_id",
  "rank_type",
  "count",
  "name",
  "item_type",
] as const;

function invalid(): never {
  throw new Error("Invalid UIGF v4.2 data");
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}

function digits(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,19}$/.test(value)) return invalid();
  return value;
}

function parseTime(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  )
    return invalid();
  const iso = value.replace(" ", "T") + ".000Z";
  const time = new Date(iso);
  if (!Number.isFinite(+time) || time.toISOString() !== iso) return invalid();
  return value;
}

function parsePull(value: unknown, game: MiyousheGame): Pull {
  const fields = object(value);
  const pull: Pull = {
    id: digits(fields.id),
    gacha_type: digits(fields.gacha_type),
    item_id: digits(fields.item_id),
    time: parseTime(fields.time),
  };
  for (const field of optionalPullFields) {
    const fieldValue = fields[field];
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== "string") return invalid();
    pull[field] = fieldValue;
  }
  if (game === "hk4e") digits(pull.uigf_gacha_type);
  if (game === "hkrpg") digits(pull.gacha_id);
  return pull;
}

function parseAccount(value: unknown, game: MiyousheGame): Account {
  const { uid, timezone, lang, list } = object(value);
  if (
    typeof timezone !== "number" ||
    !Number.isInteger(timezone) ||
    timezone < -12 ||
    timezone > 14 ||
    (lang !== undefined && typeof lang !== "string") ||
    !Array.isArray(list)
  )
    return invalid();
  return {
    uid: digits(
      typeof uid === "number" && Number.isSafeInteger(uid) ? String(uid) : uid
    ),
    timezone,
    ...(lang === undefined ? {} : { lang }),
    list: list.map(pull => parsePull(pull, game)),
  };
}

export function parseUigf(text: string): GachaArchive {
  const document = object(JSON.parse(text));
  if (object(document.info).version !== "v4.2") return invalid();
  const archive: GachaArchive = {};
  for (const game of miyousheGames) {
    const accounts = document[game];
    if (accounts === undefined) continue;
    if (!Array.isArray(accounts)) return invalid();
    archive[game] = accounts.map(account => parseAccount(account, game));
  }
  if (!miyousheGames.some(game => archive[game]?.length)) return invalid();
  return archive;
}

function convertTime(time: string, from: number, to: number) {
  if (from === to) return time;
  const timestamp = Date.parse(time.replace(" ", "T") + "Z");
  return new Date(timestamp + (to - from) * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

export function mergeGachaArchives(
  current: GachaArchive,
  incoming: GachaArchive
): GachaArchive {
  const result: GachaArchive = {};
  for (const game of miyousheGames) {
    const accounts = new Map<string, Account & { pulls: Map<string, Pull> }>();
    for (const source of [
      ...(current[game] ?? []),
      ...(incoming[game] ?? []),
    ]) {
      const target = accounts.get(source.uid) ?? {
        ...source,
        pulls: new Map<string, Pull>(),
      };
      accounts.set(source.uid, target);
      for (const entry of source.list) {
        const id = entry.id.replace(/^0+(?=\d)/, "");
        const existing = target.pulls.get(id);
        target.pulls.set(id, {
          ...entry,
          time: convertTime(entry.time, source.timezone, target.timezone),
          ...existing,
        });
      }
    }
    if (accounts.size) {
      result[game] = [...accounts.values()].map(
        ({ pulls, uid, timezone, lang }) => ({
          uid,
          timezone,
          ...(lang === undefined ? {} : { lang }),
          list: [...pulls.values()],
        })
      );
    }
  }
  return result;
}

export function exportUigf(archive: GachaArchive) {
  return JSON.stringify(
    {
      info: {
        version: "v4.2",
        export_app: "YAAGLM",
        export_timestamp: Math.floor(Date.now() / 1000),
      },
      ...archive,
    },
    null,
    2
  );
}

export function summarizePulls(account: Account) {
  const pools = new Map<string, Pull[]>();
  const sorted = [...account.list].sort(
    (a, b) =>
      a.time.localeCompare(b.time) || Number(BigInt(a.id) - BigInt(b.id))
  );
  for (const pull of sorted) {
    const type = pull.uigf_gacha_type ?? pull.gacha_type;
    const pool = pools.get(type) ?? [];
    pool.push(pull);
    pools.set(type, pool);
  }
  return {
    first: sorted[0]?.time,
    last: sorted[sorted.length - 1]?.time,
    pools: [...pools].map(([type, pulls]) => {
      let afterTopRank = 0;
      let hasTopRank = false;
      let known = true;
      const intervals: number[] = [];
      for (const pull of pulls) {
        if (!/^[345]$/.test(pull.rank_type ?? "")) known = false;
        afterTopRank++;
        if (pull.rank_type !== "5") continue;
        if (hasTopRank && known) intervals.push(afterTopRank);
        hasTopRank = true;
        known = true;
        afterTopRank = 0;
      }
      return { type, pulls, intervals };
    }),
  };
}

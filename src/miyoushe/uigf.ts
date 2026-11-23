import { miyousheGames, type MiyousheGame } from "./games";

export type Pull = {
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
  sources?: ("file" | "game")[];
  updatedAt?: number;
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

export function parseUigf(text: string, local = false): GachaArchive {
  const document = object(JSON.parse(text));
  if (object(document.info).version !== "v4.2") return invalid();
  const archive: GachaArchive = {};
  for (const game of miyousheGames) {
    const accounts = document[game];
    if (accounts === undefined) continue;
    if (!Array.isArray(accounts)) return invalid();
    archive[game] = accounts.map(value => {
      const account = parseAccount(value, game);
      const { sources, updatedAt } = object(value);
      if (local && Array.isArray(sources)) {
        account.sources = sources.filter(
          (source): source is "file" | "game" =>
            source === "file" || source === "game"
        );
      }
      if (
        local &&
        typeof updatedAt === "number" &&
        Number.isSafeInteger(updatedAt) &&
        updatedAt > 0 &&
        Number.isFinite(+new Date(updatedAt))
      )
        account.updatedAt = updatedAt;
      return account;
    });
  }
  if (!local && !miyousheGames.some(game => archive[game]?.length))
    return invalid();
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
      if (source.updatedAt !== undefined)
        target.updatedAt = Math.max(source.updatedAt, target.updatedAt ?? 0);
      if (source.sources || target.sources)
        target.sources = [
          ...new Set([
            ...(target.sources ?? ["file"]),
            ...(source.sources ?? ["file"]),
          ]),
        ];
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
        ({ pulls, uid, timezone, lang, sources, updatedAt }) => ({
          uid,
          timezone,
          ...(lang === undefined ? {} : { lang }),
          ...(sources === undefined ? {} : { sources }),
          ...(updatedAt === undefined ? {} : { updatedAt }),
          list: [...pulls.values()],
        })
      );
    }
  }
  return result;
}

export function exportUigf(archive: GachaArchive, local = false) {
  const games = local
    ? archive
    : Object.fromEntries(
        Object.entries(archive).map(([game, accounts]) => [
          game,
          accounts.map(({ uid, timezone, lang, list }) => ({
            uid,
            timezone,
            lang,
            list,
          })),
        ])
      );
  return JSON.stringify(
    {
      info: {
        version: "v4.2",
        export_app: "YAAGLM",
        export_timestamp: Math.floor(Date.now() / 1000),
      },
      ...games,
    },
    null,
    2
  );
}

export function selectGamePullArchive(
  archive: GachaArchive,
  game: MiyousheGame,
  uid?: string
): GachaArchive | undefined {
  const accounts = archive[game] ?? [];
  const selected =
    uid === undefined
      ? accounts
      : accounts.filter(account => account.uid === uid);
  return selected.length ? { [game]: selected } : undefined;
}

function comparePulls(a: Pull, b: Pull) {
  return a.time.localeCompare(b.time) || Number(BigInt(a.id) - BigInt(b.id));
}

const genshinPoolOrder = new Map(
  ["301", "400", "302", "200", "500", "100"].map((type, index) => [type, index])
);

export function summarizePulls(account: Account, game?: MiyousheGame) {
  const pools = new Map<string, Pull[]>();
  const sorted = [...account.list].sort(comparePulls);
  for (const pull of sorted) {
    const type = pull.uigf_gacha_type ?? pull.gacha_type;
    const pool = pools.get(type) ?? [];
    pool.push(pull);
    pools.set(type, pool);
  }
  const entries = [...pools];
  if (game === "hk4e")
    entries.sort(
      ([a], [b]) =>
        (genshinPoolOrder.get(a) ?? Infinity) -
        (genshinPoolOrder.get(b) ?? Infinity)
    );
  return {
    first: sorted[0]?.time,
    last: sorted[sorted.length - 1]?.time,
    pools: entries.map(([type, pulls]) => {
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
      const pity = hasTopRank && known ? afterTopRank : undefined;
      return { type, pulls, intervals, pity };
    }),
  };
}

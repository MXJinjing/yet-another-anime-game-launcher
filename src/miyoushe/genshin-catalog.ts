import bundledCatalog from "./genshin-catalog.tsv?raw";

export type CatalogItem = {
  id: string;
  name: string;
  rank: string;
  icon?: string;
};

type Category = "characters" | "weapons";
export const catalogCommit = "db37a96e1dac3f56d0e6f015c4ff4f87c25577cd";
const versionUrl =
  "https://api.github.com/repos/theBowja/genshin-db-dist/commits/main";
const dataRoot = "https://cdn.jsdelivr.net/gh/theBowja/genshin-db-dist@";
const catalogInterval = 24 * 60 * 60 * 1000;
const commitPattern = /^[a-f0-9]{40}$/;
const iconPattern =
  /^https:\/\/(?:upload-os-bbs\.mihoyo\.com\/game_record\/genshin\/(?:character_icon|equip)|enka\.network\/ui)\/(UI_[A-Za-z0-9_]+\.png)$/;

export function genshinIconFile(icon: string) {
  return icon.match(iconPattern)?.[1];
}

export function genshinIconSources(icon: string) {
  const file = genshinIconFile(icon);
  if (!file) return [];
  return icon.startsWith("https://enka.network/")
    ? [icon]
    : ["https://enka.network/ui/" + file, icon];
}

export type CatalogSnapshot = {
  commit: string;
  checkedAt: number;
  items: CatalogItem[];
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid catalog object");
  return value as Record<string, unknown>;
}

function parseItem(value: unknown): CatalogItem {
  const { id, name, rank, icon } = object(value);
  if (
    typeof id !== "string" ||
    !/^[1-9]\d{0,9}$/.test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 100 ||
    typeof rank !== "string" ||
    !/^[1-5]$/.test(rank)
  )
    throw new Error("Invalid item");
  return {
    id,
    name,
    rank,
    ...(typeof icon === "string" && iconPattern.test(icon) ? { icon } : {}),
  };
}

function parseItems(items: unknown): CatalogItem[] {
  if (!Array.isArray(items) || !items.length || items.length > 5000)
    throw new Error("Invalid item list");
  const parsed = items.map(parseItem);
  if (new Set(parsed.map(item => item.id)).size !== parsed.length)
    throw new Error("Duplicate item ID");
  return parsed;
}

export const initialCatalog: CatalogSnapshot = {
  commit: catalogCommit,
  checkedAt: 0,
  items: parseItems(
    bundledCatalog
      .trim()
      .split("\n")
      .map(line => {
        const [id, name, rank, icon] = line.split("\t");
        return { id, name, rank, icon };
      })
  ),
};

export function parseCatalogSnapshot(value: unknown): CatalogSnapshot {
  const { commit, checkedAt, items } = object(value);
  if (
    typeof commit !== "string" ||
    !commitPattern.test(commit) ||
    typeof checkedAt !== "number" ||
    !Number.isFinite(checkedAt)
  )
    throw new Error("Invalid catalog snapshot");
  return { commit, checkedAt, items: parseItems(items) };
}

export function parseUpstreamCatalog(value: unknown, category: Category) {
  const root = object(value);
  const rows = object(object(object(root.data).ChineseSimplified)[category]);
  const icons = object(object(root.image)[category]);
  return parseItems(
    Object.entries(rows).map(([key, row]) => {
      const { id, name, rarity } = object(row);
      const image = icons[key] ? object(icons[key]) : {};
      const icon =
        image.mihoyo_icon ??
        (typeof image.filename_icon === "string"
          ? "https://enka.network/ui/" + image.filename_icon + ".png"
          : undefined);
      return { id: String(id), name, rank: String(rarity), icon };
    })
  );
}

async function requestPublicFile(url: string, request: typeof fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await request(url, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Public catalog unavailable");
    if (!response.body) throw new Error("Public catalog response is empty");
    const stream = url.endsWith(".gzip")
      ? response.body.pipeThrough(new DecompressionStream("gzip"))
      : response.body;
    const reader = stream.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let size = 0;
    let chunk = await reader.read();
    while (!chunk.done) {
      const { value } = chunk;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Public catalog exceeds the size limit");
      }
      text += decoder.decode(value, { stream: true });
      chunk = await reader.read();
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function createCatalogRefresh(
  save: (snapshot: CatalogSnapshot) => Promise<void>,
  request: typeof fetch = fetch
) {
  let pending: Promise<CatalogSnapshot> | undefined;
  return (current: CatalogSnapshot, now = Date.now()) => {
    if (pending) return pending;
    if (now - current.checkedAt < catalogInterval)
      return Promise.resolve(current);
    pending = (async () => {
      const checked = { ...current, checkedAt: now };
      try {
        await save(checked);
      } catch {
        return current;
      }
      try {
        const { sha } = object(await requestPublicFile(versionUrl, request));
        if (typeof sha !== "string" || !commitPattern.test(sha))
          throw new Error("Invalid upstream commit");
        if (sha === current.commit) return checked;
        const read = async (category: Category) =>
          parseUpstreamCatalog(
            await requestPublicFile(
              dataRoot +
                sha +
                "/data/gzips/chinesesimplified-" +
                category +
                ".min.json.gzip",
              request
            ),
            category
          );
        const [characters, weapons] = await Promise.all([
          read("characters"),
          read("weapons"),
        ]);
        const next = {
          commit: sha,
          checkedAt: now,
          items: parseItems([...characters, ...weapons]),
        };
        await save(next);
        return next;
      } catch {
        return checked;
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

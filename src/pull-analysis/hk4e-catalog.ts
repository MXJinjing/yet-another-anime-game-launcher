import { hk4eWikiPortraitBases } from "@src/constants/yaaglm-config.secret.json";
import bundledCatalog from "./hk4e-catalog.tsv?raw";
import wikiPortraits from "./hk4e-wiki-portraits.tsv?raw";

export type CatalogItem = {
  id: string;
  name: string;
  rank: string;
  icon?: string;
};

const iconPattern = /^UI_[A-Za-z0-9_]+\.png$/;

export function hk4eIconFile(icon: string) {
  return iconPattern.test(icon) ? icon : undefined;
}

const wikiURLs = new Map<string, string>();
for (const line of wikiPortraits.trim().split("\n")) {
  const [file, source, path] = line.split("\t");
  if (
    !hk4eIconFile(file) ||
    !path?.match(/^\/[A-Za-z0-9_./%-]+\.png$/) ||
    !Object.prototype.hasOwnProperty.call(hk4eWikiPortraitBases, source)
  )
    continue;
  const base =
    hk4eWikiPortraitBases[source as keyof typeof hk4eWikiPortraitBases];
  const url = new URL(base + path);
  if (url.href.startsWith(base + "/") && url.protocol === "https:") {
    wikiURLs.set(file, url.href);
  }
}

export function hk4eWikiPortraitUrl(file: string) {
  return wikiURLs.get(file);
}

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

export const initialCatalog = {
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

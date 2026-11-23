import { readFile } from "@platform/neutralino";
import {
  createCatalogRefresh,
  initialCatalog,
  parseCatalogSnapshot,
} from "./genshin-catalog";
import { replaceLocalFile } from "./local";

const catalogPath = "miyoushe-genshin-catalog.json";
export const refreshGenshinCatalog = createCatalogRefresh(snapshot =>
  replaceLocalFile(catalogPath, JSON.stringify(snapshot))
);

export async function readGenshinCatalog() {
  try {
    return parseCatalogSnapshot(JSON.parse(await readFile(catalogPath)));
  } catch {
    return initialCatalog;
  }
}

import { WINE_INF_CERT_STR } from "../clients/secret";
import { readAllLines, writeFile } from "@platform/neutralino";
import { warn } from "@logging/logger";

export async function addCertsToWine(wineBinaryDir: string) {
  const searchLoc = "; URL Associations";
  const wineInfPath = `${wineBinaryDir}/share/wine/wine.inf`;

  let wineInfContents = await readAllLines(wineInfPath);
  let found = -1;
  for (let i = 0; i < wineInfContents.length; i++) {
    if (wineInfContents[i].trim() === searchLoc) {
      found = i;
      break;
    }
  }

  // Certificate injection is an enhancement, not a prerequisite. A Wine build
  // without this section (or with a different layout) still configures and
  // launches games, so skip it instead of failing the whole environment task.
  if (found < 0) {
    await warn(
      `Could not find URL Associations section in ${wineInfPath}; skipping certificate injection`
    );
    return;
  }

  let nextBlockLoc = found;
  for (let i = found + 1; i < wineInfContents.length; i++) {
    if (wineInfContents[i].trim().length === 0) {
      nextBlockLoc = i;
      break;
    }
  }

  if (nextBlockLoc === found) {
    await warn(
      `Could not find the end of URL Associations section in ${wineInfPath}; skipping certificate injection`
    );
    return;
  }

  wineInfContents = [
    ...wineInfContents.slice(0, nextBlockLoc),
    "",
    ...WINE_INF_CERT_STR.trim().split("\n"),
    ...wineInfContents.slice(nextBlockLoc),
  ];

  await writeFile(wineInfPath, wineInfContents.join("\n"));
}

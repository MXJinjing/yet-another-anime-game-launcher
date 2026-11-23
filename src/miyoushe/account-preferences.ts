import { readFile, removeFileIfExists } from "@platform/neutralino";
import { miyousheGames, type MiyousheGame } from "./games";
import { replaceLocalFile } from "./local";

const preferencesPath = "miyoushe-account-settings.json";

export type AccountPreferences = Partial<
  Record<MiyousheGame, { role: string; verifiedDay?: string }>
>;

export async function readAccountPreferences(): Promise<AccountPreferences> {
  try {
    const value = JSON.parse(await readFile(preferencesPath));
    const preferences: AccountPreferences = {};
    for (const game of miyousheGames) {
      const entry = value?.[game];
      if (!entry || typeof entry.role !== "string") continue;
      if (!/^(cn_gf01|prod_gf_cn):\d{1,19}$/.test(entry.role)) continue;
      preferences[game] = {
        role: entry.role,
        verifiedDay:
          typeof entry.verifiedDay === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedDay)
            ? entry.verifiedDay
            : undefined,
      };
    }
    return preferences;
  } catch {
    return {};
  }
}

export function storeAccountPreferences(preferences: AccountPreferences) {
  return Object.keys(preferences).length
    ? replaceLocalFile(preferencesPath, JSON.stringify(preferences))
    : removeFileIfExists(preferencesPath);
}

export function shanghaiDay() {
  // Shift an absolute instant to UTC+8 before taking the calendar date.
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

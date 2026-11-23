import { join } from "path-browserify";
import { getGameUserDataFolder } from "@src/clients/game-data-paths";
import { readDirectory, resolve, resolveResource } from "@platform/neutralino";
import { build } from "@platform/shell";
import type { RequestMiyousheHelper } from "./local";
import type { Pull } from "./uigf";

type HistoryHeads = Readonly<Record<string, string>>;

type HistoryReply =
  | {
      state: "ok";
      source: "cache" | "remote";
      history: { uid: string; list: Pull[] };
    }
  | {
      state:
        | "no-history"
        | "history-expired"
        | "history-mismatch"
        | "account-authorization-expired"
        | "manual"
        | "limited"
        | "invalid"
        | "network"
        | "unavailable";
    };

export function readAccountWishHistory(
  request: RequestMiyousheHelper,
  accountId: string,
  uid: string,
  heads?: HistoryHeads
) {
  return request<HistoryReply>(
    "wish-history",
    [],
    JSON.stringify({ accountId, uid, heads })
  );
}

export async function readGameHistory(
  installDir: string | undefined,
  winePrefix: string | undefined,
  headsByUid: Readonly<Record<string, HistoryHeads>>
): Promise<HistoryReply> {
  try {
    const helper = resolveResource("sidecar/miyoushe-history");
    const users = winePrefix && join(winePrefix, "drive_c/users");
    const folder = getGameUserDataFolder("hk4e_cn");
    const directories: string[] = [];
    if (users && folder) {
      const entries = await readDirectory(users).catch(() => []);
      for (const { entry, type } of entries) {
        if (type === "DIRECTORY" && ![".", "..", "Public"].includes(entry))
          directories.push(
            resolve(join(users, entry, "AppData/LocalLow", folder))
          );
      }
    }
    // The expiring authorization stays in the helper process.
    const payload = JSON.stringify({
      headsByUid,
      install: installDir ? resolve(installDir) : undefined,
      directories,
    });
    const result = await Neutralino.os.execCommand(build([helper]), {
      stdIn: payload,
    });
    return result.exitCode === 0
      ? JSON.parse(result.stdOut)
      : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

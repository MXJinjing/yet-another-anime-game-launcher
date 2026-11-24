import { basename, extname, join } from "path-browserify";
import { getGameUserDataFolder } from "@src/clients/game-data-paths";
import {
  readDirectory,
  resolve,
  resolveSidecarPath,
} from "@platform/neutralino";
import { build } from "@platform/shell";
import type { Pull } from "./uigf";

export type OnlineHistoryStatus =
  | "complete"
  | "no-link"
  | "expired"
  | "rate-limited"
  | "needs-attention"
  | "unavailable"
  | "incomplete";

export type HistoryReply = (
  | {
      state: "ok";
      accounts: { uid: string; list: Pull[] }[];
      source?: "online";
    }
  | { state: "no-history" | "invalid" | "unavailable" }
) & { onlineStatus?: OnlineHistoryStatus };

export async function readGameHistory(
  installDir: string | undefined,
  executable: string | undefined,
  winePrefix: string | undefined,
  fetchOnline?: boolean
): Promise<HistoryReply> {
  try {
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
    const executableName =
      executable && basename(executable, extname(executable));
    const installCache =
      installDir && executableName
        ? resolve(join(installDir, executableName + "_Data", "webCaches"))
        : undefined;
    const result = await Neutralino.os.execCommand(
      build([await resolveSidecarPath("wish-history")]),
      { stdIn: JSON.stringify({ installCache, directories, fetchOnline }) }
    );
    return result.exitCode === 0
      ? JSON.parse(result.stdOut)
      : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

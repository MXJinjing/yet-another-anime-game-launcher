import { basename, extname, join } from "path-browserify";
import { getGameUserDataFolder } from "@src/clients/game-data-paths";
import {
  readDirectory,
  resolve,
  resolveSidecarPath,
} from "@platform/neutralino";
import { exec2 } from "@runtime/command-runner";
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

export type HistoryProgress =
  | { phase: "online"; pool: string; pages: number; records: number }
  | { phase: "cache" };

function historyProgressReader(
  onProgress: (progress: HistoryProgress) => void
) {
  let pending = "";
  return (chunk: string) => {
    const lines = (pending + chunk).split("\n");
    pending = (lines.pop() ?? "").slice(-1024);
    for (const line of lines) {
      let value: {
        phase?: unknown;
        pool?: unknown;
        pages?: unknown;
        records?: unknown;
      };
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (!value) continue;
      if (value.phase === "cache") {
        onProgress({ phase: "cache" });
      } else if (
        value.phase === "online" &&
        typeof value.pool === "string" &&
        /^(100|200|301|302|500)$/.test(value.pool) &&
        typeof value.pages === "number" &&
        Number.isSafeInteger(value.pages) &&
        value.pages >= 0 &&
        typeof value.records === "number" &&
        Number.isSafeInteger(value.records) &&
        value.records >= 0
      ) {
        onProgress({
          phase: "online",
          pool: value.pool,
          pages: value.pages,
          records: value.records,
        });
      }
    }
  };
}

export async function readGameHistory(
  installDir: string | undefined,
  executable: string | undefined,
  winePrefix: string | undefined,
  fetchOnline?: boolean,
  onProgress?: (progress: HistoryProgress) => void
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
    const result = await exec2(
      [await resolveSidecarPath("wish-history")],
      undefined,
      false,
      undefined,
      {
        stdIn: JSON.stringify({
          installCache,
          directories,
          fetchOnline,
          reportProgress: onProgress ? true : undefined,
        }),
        onStdErr: onProgress && historyProgressReader(onProgress),
      }
    );
    return JSON.parse(result.stdOut);
  } catch {
    return { state: "unavailable" };
  }
}

import { join } from "path-browserify";
import { getGameUserDataFolder } from "@src/clients/game-data-paths";
import { readDirectory, resolve, resolveResource } from "@platform/neutralino";
import { build } from "@platform/shell";
import type { Reply } from "./account";

export async function readGameHistory(
  installDir: string | undefined,
  winePrefix: string | undefined,
  mode: "cached" | "authorized",
  uid?: string
): Promise<Reply> {
  try {
    const helper = resolveResource("sidecar/miyoushe-history");
    const users = winePrefix && join(winePrefix, "drive_c/users");
    const folder = getGameUserDataFolder("hk4e_cn");
    const candidates = [""];
    if (users && folder) {
      const entries = await readDirectory(users).catch(() => []);
      for (const { entry, type } of entries) {
        if (type === "DIRECTORY" && ![".", "..", "Public"].includes(entry))
          candidates.push(
            resolve(join(users, entry, "AppData/LocalLow", folder))
          );
      }
    }
    // The helper gets filesystem locations, scope and an optional expected UID.
    // The expiring authorization itself stays in its process.
    let failure: Reply = { state: "no-history" };
    for (const directory of candidates) {
      const result = await Neutralino.os.execCommand(
        build([
          helper,
          mode,
          !directory && installDir ? resolve(installDir) : "",
          directory,
          uid ?? "",
        ]),
        {}
      );
      if (result.exitCode !== 0) return { state: "unavailable" };
      const reply: Reply = JSON.parse(result.stdOut);
      if (reply.state === "history-expired") failure = reply;
      else if (reply.state !== "no-history") return reply;
    }
    return failure;
  } catch {
    return { state: "unavailable" };
  }
}

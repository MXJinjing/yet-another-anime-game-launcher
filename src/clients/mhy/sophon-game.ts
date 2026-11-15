import { join } from "path-browserify";
import { fileOrDirExists, readFile, writeFile } from "@platform/neutralino";
import { getFreeSpace, mkdirp } from "@runtime/macos-filesystem";
import type { Storage } from "@runtime/storage";
import { TaskFailedError, type TaskProgram } from "@tasks/task-program";
import type { Server } from "@constants";
import type { Locale } from "@locale";
import type {
  SophonGameType,
  SophonOnlineGameInfo,
  SophonRegion,
} from "@sophon";
import { getSophonClient } from "../../integrations/sophon-sidecar";
import {
  isNewerGameVersion,
  readGameVersion,
  requireGameVersion,
} from "../game-version";
import { downloadAndInstallGameProgram } from "./hk4e/program-install-game";
import { checkIntegrityProgram } from "./hk4e/program-check-integrity";
import {
  predownloadGameProgram,
  updateGameProgram,
} from "./hk4e/program-update-game";

export function sophonPredownloadVersion(
  info: SophonOnlineGameInfo | undefined,
  installed: string
): string {
  const version = info?.pre_download_version;
  if (
    !info?.pre_download ||
    info.needs_resume ||
    !version ||
    !isNewerGameVersion(version, installed)
  ) {
    return "";
  }
  return !info.pre_download_from || info.pre_download_from.includes(installed)
    ? version
    : "";
}

export function sophonConfigDefaults(contents: string, server: Server): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const bom = contents.startsWith("\ufeff") ? "\ufeff" : "";
  const lines = contents.slice(bom.length).replace(/\r\n/g, "\n").split("\n");
  let start = lines.findIndex(line => /^\s*\[general\]\s*$/i.test(line));
  if (start < 0) {
    if (lines[lines.length - 1] === "") lines.pop();
    start = lines.length;
    lines.push("[General]", "");
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  const keys = new Set(
    lines
      .slice(start + 1, end)
      .map(line => line.split("=")[0].trim().toLowerCase())
  );
  const missing = Object.entries({
    channel: server.channel_id,
    sub_channel: server.subchannel_id,
    cps: server.cps,
  })
    .filter(([key]) => !keys.has(key))
    .map(([key, value]) => `${key}=${value}`);
  if (!missing.length) return contents;
  lines.splice(start + 1, 0, ...missing);
  return bom + lines.join(newline);
}

export function createSophonGame(
  server: Server,
  locale: Locale,
  storage: Storage,
  gameType: SophonGameType,
  region: SophonRegion = server.id.endsWith("_cn") ? "cn" : "os"
) {
  const client = () => getSophonClient(region);
  const downloadKey = storage.namespace;

  async function online(directory?: string) {
    const info = await (
      await client()
    ).getLatestOnlineGameInfo(region, gameType, directory);
    requireGameVersion(info.version);
    return info;
  }

  async function* repair(
    gameDir: string,
    installedVersion?: string
  ): TaskProgram {
    yield* checkIntegrityProgram({
      sophon: await client(),
      gameDir,
      gameType,
      installedVersion,
      downloadKey,
      storage,
    });
  }

  return {
    online,
    repair,
    async *install(gameDir: string, info: SophonOnlineGameInfo): TaskProgram {
      const existing = await fileOrDirExists(join(gameDir, server.executable));
      if (!existing && info.install_size > 0) {
        const required = Math.ceil(info.install_size / 1024 ** 3) * 1.2;
        if ((await getFreeSpace(gameDir, "g")) < required) {
          await locale.alert(
            "NO_ENOUGH_DISKSPACE",
            "NO_ENOUGH_DISKSPACE_DESC",
            [String(required), (required * 1.074).toFixed(1)]
          );
          throw new TaskFailedError(locale.get("NO_ENOUGH_DISKSPACE"));
        }
      }
      await mkdirp(gameDir);
      const file = join(gameDir, "config.ini");
      const contents = (await fileOrDirExists(file))
        ? await readFile(file)
        : "";
      const updated = sophonConfigDefaults(contents, server);
      if (updated !== contents) await writeFile(file, updated);
      if (existing) {
        yield* repair(gameDir);
      } else {
        yield* downloadAndInstallGameProgram({
          sophonClient: await client(),
          gameDir,
          gameType,
          installReltype: region,
          downloadKey,
        });
      }
    },
    async *update(
      gameDir: string,
      installed: string,
      version: string
    ): TaskProgram {
      yield* updateGameProgram({
        sophon: await client(),
        gameDir,
        gameType,
        server,
        updatedGameVersion: version,
        installedVersion: readGameVersion(installed) ?? undefined,
        downloadKey,
        storage,
      });
    },
    async *predownload(
      gameDir: string,
      installed: string,
      targetVersion: string
    ): TaskProgram {
      yield* predownloadGameProgram({
        sophon: await client(),
        gameDir,
        gameType,
        targetVersion,
        installedVersion: installed,
        downloadKey,
        storage,
      });
    },
  };
}

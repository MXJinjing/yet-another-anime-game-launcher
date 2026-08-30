import { join } from "path-browserify";
import { Aria2, Aria2OverallProgress } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { readFile, removeFileIfExists, writeFile } from "@platform/neutralino";
import { globalStorage, type Storage } from "@runtime/storage";
import { LauncherResourceData } from "./launcher-info";
import { Server } from "../server";

export async function* updateGameProgram({
  resourceData,
  gameDir,
  server,
  aria2,
  downloadKey,
  storage = globalStorage,
}: {
  resourceData: LauncherResourceData;
  gameDir: string;
  server: Server;
  aria2: Aria2;
  /** Per-game download control key so the primary button can offer pause. */
  downloadKey?: string;
  storage?: Storage;
}): TaskProgram {
  yield ["setUndeterminedProgress"];
  const local_manifest = join(gameDir, "manifest.json");
  const localResourceData: LauncherResourceData = await readFile(
    local_manifest
  ).then(
    content => {
      return JSON.parse(content);
    },
    () => {
      return { ...resourceData, paks: [] };
    }
  );
  const normalizePaks = (data: LauncherResourceData) =>
    data.paks.map(p => [p.hash, p] as const);
  type Pak = LauncherResourceData["paks"][number];
  const localPaks = new Map<string, Pak>(normalizePaks(localResourceData));
  const remotePaks = new Map<string, Pak>(normalizePaks(resourceData));

  const toAdd: {
    remoteName: string;
    hash: string;
  }[] = [];
  const toRemove: {
    localName: string;
  }[] = [];
  for (const [hash, localPak] of localPaks) {
    if (!remotePaks.has(hash)) {
      toRemove.push({ localName: localPak.name });
    }
  }
  for (const [hash, remotePak] of remotePaks) {
    if (!localPaks.has(hash)) {
      toAdd.push({ remoteName: remotePak.name, hash });
    }
  }
  for (const { localName } of toRemove) {
    const localPath = join(gameDir, localName);
    await removeFileIfExists(localPath);
  }
  let count = 0;
  // Track overall progress so the button's percentage covers every added pak.
  const overall = new Aria2OverallProgress(undefined, downloadKey);
  for (const { remoteName, hash } of toAdd) {
    const localPath = join(gameDir, remoteName);
    const remotePath = join(server.dlc, resourceData.pathOffset, hash).replace(
      ":/",
      "://"
    ); //....join: wtf?
    yield ["setUndeterminedProgress"];
    yield ["setStateText", "FIXING_FILES", String(count), String(toAdd.length)];
    for await (const progress of aria2.doStreamingDownload({
      uri: remotePath,
      absDst: localPath,
      downloadKey,
    })) {
      yield ["setProgress", overall.step(progress)];
    }
    overall.finishFile();
    count++;
  }
  await storage.setKey("patched", null);

  await writeFile(join(gameDir, "manifest.json"), JSON.stringify(resourceData));
}

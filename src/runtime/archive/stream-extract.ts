import { log } from "../../logging/logger";
import {
  offSpawnedProcess,
  onSpawnedProcess,
  resolve,
} from "../../platform/neutralino";
import { rawString } from "../../platform/shell";
import { wait } from "../async";
import { exec, spawn } from "../command-runner";

export async function* doStreamUnzip(
  source: string,
  destination: string
): AsyncGenerator<readonly [number, number], void, unknown> {
  const logFile = resolve("decompress.log");
  let processExit = false;
  let processExitCode = 0;
  const totalLines = Number(
    (
      await exec([
        "unzip",
        "-l",
        source,
        rawString("|"),
        "tee",
        logFile,
        rawString("|"),
        "wc",
        "-l",
      ])
    ).stdOut
      .trim()
      .split(" ")[0]
  );
  const { id } = await spawn([
    "unzip",
    "-o",
    source,
    "-d",
    destination,
    rawString("|"),
    "tee",
    logFile,
    rawString("&>"),
    "/dev/null",
  ]);
  const handler: Neutralino.events.Handler<
    Neutralino.os.SpawnProcessResult
  > = event => {
    if (!event) return;
    void log(JSON.stringify(event.detail));
    if (event.detail.id == id && event.detail.action == "exit") {
      processExit = true;
      processExitCode = Number(event.detail.data);
    }
  };
  await onSpawnedProcess(handler);
  while (!processExit) {
    await wait(200);
    const completed = Number(
      (await exec(["wc", "-l", rawString("<"), logFile])).stdOut
        .trim()
        .split(" ")[0]
    );
    yield [completed, totalLines] as const;
  }
  await offSpawnedProcess(handler);
  if (processExitCode != 0)
    throw new Error("unzip exited with code " + processExitCode);
}

export async function* doStreamUn7z(
  sources: string[],
  destination: string
): AsyncGenerator<readonly [number, number], void, unknown> {
  const logFile = resolve("decompress.log");
  let processExit = false;
  let processExitCode = 0;
  const mainFile = sources.find(file => file.endsWith(".001"));
  if (!mainFile) throw new Error("Missing main .001 file for decompression!");
  const sevenZip = resolve("./sidecar/7z/7zz");
  const totalLines = Number(
    (
      await exec([
        sevenZip,
        "l",
        mainFile,
        rawString("|"),
        "tee",
        logFile,
        rawString("|"),
        "wc",
        "-l",
      ])
    ).stdOut
      .trim()
      .split(" ")[0]
  );
  const { id } = await spawn([
    sevenZip,
    "x",
    `-o${destination}`,
    mainFile,
    rawString("|"),
    "tee",
    logFile,
    rawString("&>"),
    "/dev/null",
  ]);
  const handler: Neutralino.events.Handler<
    Neutralino.os.SpawnProcessResult
  > = event => {
    if (event?.detail.id == id && event.detail.action == "exit") {
      processExit = true;
      processExitCode = Number(event.detail.data);
    }
  };
  await onSpawnedProcess(handler);
  while (!processExit) {
    await wait(200);
    const completed = Number(
      (await exec(["wc", "-l", rawString("<"), logFile])).stdOut
        .trim()
        .split(" ")[0]
    );
    yield [completed, totalLines] as const;
  }
  await offSpawnedProcess(handler);
  if (processExitCode != 0)
    throw new Error("7z exited with code " + processExitCode);
}

export function extract7z(source: string, destination: string) {
  return exec([
    resolve("./sidecar/7z/7zz"),
    "x",
    source,
    `-o${destination}`,
    "-y",
  ]);
}

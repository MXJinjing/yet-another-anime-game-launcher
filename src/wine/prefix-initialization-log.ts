import { resolve } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { join } from "path-browserify";

export async function createWinePrefixInitializationLog() {
  const logsDir = resolve("./logs");
  await exec(["mkdir", "-p", logsDir]);
  const { stdOut } = await exec([
    "/usr/bin/mktemp",
    "-d",
    join(logsDir, "wine-initialization.XXXXXXXX"),
  ]);
  const directory = stdOut.trimEnd();
  let step = 0;

  return async (
    program: "wineboot" | "winecfg",
    run: (logFile: string) => Promise<unknown>
  ) => {
    const logFile = join(directory, `${++step}-${program}.log`);
    try {
      await run(logFile);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Wine initialization failed during ${program}.\nLog file: ${logFile}\n${reason}`,
        { cause: error }
      );
    }
  };
}

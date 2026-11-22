import { resolve } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { TaskFailedError } from "@tasks/task-program";
import { join } from "path-browserify";

/**
 * A recoverable prefix-initialization failure. Carries the log paths so the
 * task error can point the user at the actual Wine output.
 */
export class PrefixInitializationFailedError extends TaskFailedError {
  readonly logFiles: string[];
  readonly logsDirectory: string;

  constructor(logsDirectory: string, logFiles: string[], cause?: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      [
        "Wine prefix initialization failed.",
        `Logs directory: ${logsDirectory}`,
        "Log files:",
        ...logFiles.map(file => `- ${file}`),
        reason,
      ].join("\n")
    );
    this.name = "PrefixInitializationFailedError";
    this.logsDirectory = logsDirectory;
    this.logFiles = logFiles;
    this.cause = cause;
  }
}

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
  const logFiles: string[] = [];

  const runStep = async (
    program: "wineboot" | "winecfg",
    run: (logFile: string) => Promise<unknown>
  ) => {
    const logFile = join(directory, `${++step}-${program}.log`);
    logFiles.push(logFile);
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

  return Object.assign(runStep, { directory, logFiles });
}

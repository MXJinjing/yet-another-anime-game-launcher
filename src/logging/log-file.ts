import { resolve } from "../platform/neutralino/path";

const LOG_FILE_NAME = "yaaglm.log";

export function getRuntimeLogFilePath() {
  return resolve(LOG_FILE_NAME);
}

export async function appendRuntimeLogFile(level: string, message: string) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  await Neutralino.filesystem.appendFile(getRuntimeLogFilePath(), line);
}

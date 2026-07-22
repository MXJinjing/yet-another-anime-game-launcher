import { join } from "path-browserify";

const LOG_FILE_NAME = "yaagl.log";

export function getRuntimeLogFilePath() {
  return join(
    import.meta.env.PROD ? window.NL_PATH : join(window.NL_CWD, window.NL_PATH),
    LOG_FILE_NAME
  );
}

export async function appendRuntimeLogFile(level: string, message: string) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  await Neutralino.filesystem.appendFile(getRuntimeLogFilePath(), line);
}

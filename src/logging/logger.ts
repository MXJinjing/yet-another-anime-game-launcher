import { appendRuntimeLogFile } from "./log-file";
import { appendRuntimeLog, RuntimeLogLevel } from "./runtime-log";

function write(message: string, level: RuntimeLogLevel) {
  appendRuntimeLog(message, level);
  appendRuntimeLogFile(level, message).catch(() => undefined);
  return Neutralino.debug.log(message, level);
}

export function log(message: string) {
  return write(message, "INFO");
}

export function warn(message: string) {
  return write(message, "WARNING");
}

export function logerror(message: string) {
  return write(message, "ERROR");
}

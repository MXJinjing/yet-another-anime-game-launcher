export type RuntimeLogLevel = "INFO" | "WARNING" | "ERROR";

export interface RuntimeLogEntry {
  id: number;
  time: string;
  level: RuntimeLogLevel;
  message: string;
}

const MAX_LOG_ENTRIES = 1000;
let nextId = 1;
let entries: RuntimeLogEntry[] = [];
const listeners = new Set<(entries: RuntimeLogEntry[]) => void>();

function snapshot() {
  return [...entries];
}

export function appendRuntimeLog(
  message: string,
  level: RuntimeLogLevel = "INFO"
) {
  entries = [
    ...entries,
    {
      id: nextId++,
      time: new Date().toLocaleTimeString(),
      level,
      message,
    },
  ].slice(-MAX_LOG_ENTRIES);

  const current = snapshot();
  for (const listener of listeners) {
    listener(current);
  }
}

export function getRuntimeLogs() {
  return snapshot();
}

export function subscribeRuntimeLogs(
  listener: (entries: RuntimeLogEntry[]) => void
) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

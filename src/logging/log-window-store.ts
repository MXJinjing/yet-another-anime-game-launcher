import { readFile, writeFile } from "../platform/neutralino/filesystem";
import {
  chooseLogWindowSession,
  LOG_WINDOW_SESSION_FILE,
  LOG_WINDOW_SESSION_KEY,
  serializeLogWindowSession,
  type LogWindowSession,
} from "./log-window-protocol";

async function readStorageText(): Promise<string | undefined> {
  try {
    return await Neutralino.storage.getData(LOG_WINDOW_SESSION_KEY);
  } catch {
    return undefined;
  }
}

async function readFileText(): Promise<string | undefined> {
  try {
    return await readFile(LOG_WINDOW_SESSION_FILE);
  } catch {
    return undefined;
  }
}

export async function readSharedLogWindowSession(): Promise<
  LogWindowSession | undefined
> {
  const texts = await Promise.all([readStorageText(), readFileText()]);
  return chooseLogWindowSession(texts);
}

export async function writeSharedLogWindowSession(session: LogWindowSession) {
  const text = serializeLogWindowSession(session);
  const results = await Promise.allSettled([
    Neutralino.storage.setData(LOG_WINDOW_SESSION_KEY, text),
    writeFile(LOG_WINDOW_SESSION_FILE, text),
  ]);
  if (results.every(result => result.status === "rejected")) {
    const failure = results[0];
    throw failure.status === "rejected"
      ? failure.reason
      : new Error("Unable to save log window session");
  }
}

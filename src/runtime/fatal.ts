import { shutdown } from "./lifecycle";
import { closeApp } from "../platform/neutralino/system";

export async function fatal(error: unknown) {
  await Neutralino.os.showMessageBox(
    "Fatal error",
    `${error instanceof Error ? String(error) : JSON.stringify(error)}`,
    "OK"
  );
  await shutdown();
  await closeApp();
}

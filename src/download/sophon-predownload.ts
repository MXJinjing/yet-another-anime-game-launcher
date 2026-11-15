import { exec } from "@runtime/command-runner";
import { rawString } from "@platform/shell";
import { sophonPredownloadPath } from "../integrations/sophon-settings";

export async function removeExternalSophonPredownload(
  root: string,
  gameDirectory: string
) {
  const directory = await sophonPredownloadPath(root, gameDirectory);
  if (!directory) return;
  const literal = rawString("'" + directory.replaceAll("'", "'\\''") + "'");
  await exec(["/bin/rm", "-rf", literal]);
}

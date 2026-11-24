import { build } from "@platform/shell";

// Neutralino 4.11 forwards its save dialog defaultPath to AppleScript's
// default location. Supply the filename separately so it can be edited.
const saveDialogScript = [
  "on run argv",
  "activate",
  "try",
  "set destination to choose file name with prompt (item 1 of argv) default name (item 2 of argv)",
  "return POSIX path of destination",
  "on error number -128",
  'return ""',
  "end try",
  "end run",
];

export async function chooseSavePath(title: string, filename: string) {
  const result = await Neutralino.os.execCommand(
    build([
      "/usr/bin/osascript",
      ...saveDialogScript.flatMap(line => ["-e", line]),
      title,
      filename,
    ])
  );
  if (result.exitCode !== 0) throw new Error("Could not open the save dialog");
  return result.stdOut.replace(/\r?\n$/, "");
}

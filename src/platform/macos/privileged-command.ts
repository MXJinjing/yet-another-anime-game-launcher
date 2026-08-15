import { build } from "../shell";

export function runInSudo(cmd: string) {
  return build([
    "osascript",
    "-e",
    [
      "do",
      "shell",
      "script",
      `"${cmd.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
      "with",
      "administrator",
      "privileges",
    ].join(" "),
  ]);
}

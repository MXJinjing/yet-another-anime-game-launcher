import { build } from "../shell";

function quoteAppleScript(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function privilegedShellScript(cmd: string, prompt: string) {
  return [
    "do",
    "shell",
    "script",
    quoteAppleScript(cmd),
    "with",
    "administrator",
    "privileges",
    "with",
    "prompt",
    quoteAppleScript(prompt),
  ].join(" ");
}

export function runInSudo(cmd: string, prompt: string) {
  return build(["osascript", "-e", privilegedShellScript(cmd, prompt)]);
}

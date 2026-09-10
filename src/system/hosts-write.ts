import { rawString } from "../platform/shell";

/** Keep arbitrary hosts text out of both shell syntax and printf formats. */
export function hostsWriteCommand(content: string, path = "/etc/hosts") {
  return [
    "/bin/sh",
    "-c",
    'set -e; tmp=$(mktemp "$2.yaaglm.XXXXXX"); trap \'rm -f "$tmp"\' EXIT; cp -p "$2" "$tmp"; printf "%s" "$1" > "$tmp"; mv -f "$tmp" "$2"',
    "yaaglm-hosts",
    rawString("'" + content.replaceAll("'", "'\\''") + "'"),
    path,
  ];
}

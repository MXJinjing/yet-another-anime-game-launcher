export type CommandSegments = (
  | string
  | CommandSegments
  | {
      _rawString_: string;
    }
)[];

const sanitize = (str: string) =>
  `${str}`
    .replaceAll("\\", "\\\\")
    .replaceAll(" ", "\\ ")
    .replaceAll('"', '\\"')
    .replaceAll("'", "\\'")
    .replaceAll("&", "\\&")
    .replaceAll("#", "\\#")
    .replaceAll("~", "\\~")
    .replaceAll("`", "\\`")
    .replaceAll("|", "\\|")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("<", "\\<")
    .replaceAll(">", "\\>")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("*", "\\*")
    .replaceAll("$", "\\$")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll(";", "\\;")
    .replaceAll("\n", "\\\\n")
    .replaceAll("\t", "\\\\t");

export function build(
  command: CommandSegments,
  env?: { [key: string]: string }
): string {
  return (
    Object.entries(env ?? {})
      .map(([key, value]) => (value ? `${key}=${sanitize(value)} ` : ""))
      .join("") +
    command
      .map(segment => {
        if (segment instanceof Array) return `$(${build(segment)})`;
        if (typeof segment == "string") return sanitize(segment);
        return segment._rawString_;
      })
      .join(" ")
  );
}

export function rawString(str: string) {
  return { _rawString_: str };
}

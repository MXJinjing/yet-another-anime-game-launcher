import { resolve } from "../platform/neutralino";
import { rawString } from "../platform/shell";
import { exec } from "./command-runner";

export function xattrRemove(attr: string, path: string) {
  return exec(
    ["/usr/bin/xattr", "-s", "-r", "-d", attr, resolve(path)],
    {},
    true
  );
}

export function mkdirp(dir: string) {
  return exec(["mkdir", "-p", dir]);
}

export function forceMove(source: string, destination: string) {
  return exec(["mv", "-f", resolve(source), resolve(destination)]);
}

export function cp(source: string, destination: string) {
  return exec(["cp", "-p", resolve(source), resolve(destination)]);
}

export function rmrf_dangerously(target: string) {
  return exec(["rm", "-rf", target]);
}

export function getFreeSpace(path: string, unit: "m" | "k" | "g") {
  return exec([
    "/bin/df",
    "-" + unit,
    path,
    rawString("|"),
    "/usr/bin/awk",
    "{print $4}",
    rawString("|"),
    "/usr/bin/grep",
    "-v",
    "^Available",
  ]).then(output => parseInt(output.stdOut.split("\n")[0]));
}

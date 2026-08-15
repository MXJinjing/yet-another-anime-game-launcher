import { exec } from "../command-runner";

export function tar_extract(src: string, dst: string) {
  return exec(["tar", "-zxvf", src, "-C", dst]);
}

export function tar_extract_directory(
  src: string,
  dst: string,
  dir: string,
  isXZ: boolean
) {
  return exec([
    "tar",
    `--strip-components=${dir.split("/").length}`,
    "-C",
    dst,
    isXZ ? "-Jxvf" : "-zxvf",
    src,
    dir,
  ]);
}

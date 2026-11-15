import { basename, join, normalize } from "path-browserify";
import { closeApp, env, resolve } from "@platform/neutralino";
import { rawString } from "@platform/shell";
import { exec } from "@runtime/command-runner";
import { shutdown } from "@runtime/lifecycle";

function shellPath(path: string) {
  return rawString("'" + path.replaceAll("'", "'\\''") + "'");
}

async function realPath(path: string) {
  const { stdOut } = await exec([
    "/usr/bin/perl",
    "-MCwd=realpath",
    "-e",
    "print realpath($ARGV[0]) // ''",
    shellPath(path),
  ]);
  return stdOut;
}

async function verifyLauncherDataDirectory() {
  const [directory, home] = await Promise.all([
    env("YAAGL_APP_SUPPORT_DIR"),
    env("HOME"),
  ]);
  if (!directory || !home.startsWith("/") || home === "/") return;

  const support = join(home, "Library", "Application Support");
  const name = basename(directory);
  if (
    !name ||
    name === "." ||
    name === ".." ||
    directory !== join(support, name)
  ) {
    return;
  }

  const [physicalSupport, physicalDirectory, cwd] = await Promise.all([
    realPath(support),
    realPath(directory),
    realPath(resolve(".")),
  ]);
  if (
    physicalSupport &&
    physicalDirectory === join(physicalSupport, name) &&
    physicalDirectory === cwd
  ) {
    return { directory, physicalDirectory };
  }
}

export async function getLauncherDataDirectory() {
  return (await verifyLauncherDataDirectory())?.directory;
}

export async function openLauncherDataDirectory(directory: string) {
  await exec(["/usr/bin/open", "-a", "Finder", shellPath(directory)]);
}

function pathsOverlap(first: string, second: string) {
  return (
    first === second ||
    first.startsWith(second.endsWith("/") ? second : second + "/") ||
    second.startsWith(first + "/")
  );
}

const trashScript = [
  "function run(args) {",
  'ObjC.import("Foundation");',
  "const file = $.NSURL.fileURLWithPath(args[0]);",
  "const moved = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError(file, Ref(), Ref());",
  'if (!moved) throw Error("Could not move the folder to the Trash.");',
  "}",
].join(" ");

export async function clearLauncherData(
  confirmedDirectory: string,
  gameDirectories: readonly string[],
  isBusy: () => boolean
) {
  if (isBusy()) throw new Error("Launcher tasks are still running.");
  const verified = await verifyLauncherDataDirectory();
  if (!verified || verified.directory !== confirmedDirectory) {
    throw new Error("The launcher data directory could not be verified.");
  }

  const { directory, physicalDirectory } = verified;
  for (const path of gameDirectories) {
    if (!path) continue;
    const absolutePath = normalize(resolve(path)).replace(/\/$/, "") || "/";
    const physicalPath = await realPath(absolutePath);
    if (
      pathsOverlap(directory, absolutePath) ||
      (physicalPath && pathsOverlap(physicalDirectory, physicalPath))
    ) {
      throw new Error(
        `A game installation overlaps the data directory (${path}).`
      );
    }
  }
  if (isBusy()) throw new Error("Launcher tasks are still running.");

  await exec([
    "/usr/bin/osascript",
    "-l",
    "JavaScript",
    "-e",
    trashScript,
    shellPath(directory),
  ]);
  try {
    await shutdown();
  } finally {
    await closeApp();
  }
}

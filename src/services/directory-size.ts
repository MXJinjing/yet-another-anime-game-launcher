import { exec } from "../runtime/command-runner";

export type DirectorySizeExecResult = { stdOut: string };

export type DirectorySizeDependencies = {
  exec?: (command: string[]) => Promise<DirectorySizeExecResult>;
};

/**
 * Returns the directory size in bytes, or null when `du` cannot provide a
 * parseable value. This works reliably for large game files on external disks.
 */
export async function getDirectorySize(
  path: string,
  dependencies: DirectorySizeDependencies = {}
): Promise<number | null> {
  const run =
    dependencies.exec ??
    (async command =>
      (await exec(command, {}, false)) as DirectorySizeExecResult);
  try {
    const result = await run(["du", "-sk", path]);
    const sizeInKiB = Number(result.stdOut.trim().split(/\s+/)[0]);
    return Number.isFinite(sizeInKiB) && sizeInKiB >= 0
      ? sizeInKiB * 1024
      : null;
  } catch {
    return null;
  }
}

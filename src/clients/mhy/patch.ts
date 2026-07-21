import { gt } from "semver";
import { dirname, join } from "path-browserify";
import { CommonUpdateProgram } from "@common-update-ui";
import { Server } from "@constants";
import {
  writeBinary,
  forceMove,
  removeFile,
  exec,
  log,
  getKey,
  setKey,
  cp,
  resolve,
  removeFileIfExists,
  fileOrDirExists,
  getKeyOrDefault,
  mkdirp,
  xdelta3,
} from "@utils";
import { Config } from "@config";
import { disableUnityFeature } from "./unity";
import { Wine } from "@wine";
import { DXMT_FILES, DXVK_FILES } from "src/downloadable-resource";

export async function putLocal(url: string, dest: string) {
  return await writeBinary(dest, await (await fetch(url)).arrayBuffer());
}

export async function* patchProgram(
  gameDir: string,
  wine: Wine,
  server: Server,
  config: Config
): CommonUpdateProgram {
  if ((await getKeyOrDefault("patched", "NOTFOUND")) != "NOTFOUND") {
    return;
  }
  if (!config.patchOff) {
    for (const file of server.patched) {
      if (file.tag === "workaround3" && config.workaround3) continue;
      await forceMove(
        join(gameDir, file.file),
        join(gameDir, file.file + ".bak")
      );
      await putLocal(file.diffUrl, join(gameDir, file.file + ".diff"));
      await xdelta3(
        join(gameDir, file.file + ".bak"),
        join(gameDir, file.file + ".diff"),
        join(gameDir, file.file)
      );
      await log("patched " + file.file);
      await removeFile(join(gameDir, file.file + ".diff"));
    }
    for (const { file, tag } of server.removed) {
      if (tag === "workaround3" && config.workaround3) continue;
      if (await fileOrDirExists(join(gameDir, file))) {
        await forceMove(join(gameDir, file), join(gameDir, file + ".bak"));
      }
    }
    for (const file of server.added) {
      await mkdirp(join(gameDir, dirname(file.file)));
      await putLocal(file.url, join(gameDir, file.file));
    }
  }

  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  const syswow64Dir = join(wine.prefix, "drive_c", "windows", "syswow64");

  for (const f of DXMT_FILES) {
    const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
    await forceMove(wineLibPath, wineLibPath + ".bak");
    await cp(`./dxmt/${f}`, wineLibPath);
  }

  // winemetal files always go to Wine lib directories
  await cp(
    `./dxmt/winemetal.dll`,
    resolve("./wine/lib/wine/x86_64-windows/winemetal.dll")
  );

  await cp(
    `./dxmt/winemetal.so`,
    resolve("./wine/lib/wine/x86_64-unix/winemetal.so")
  );

  // winemetal.dll also to system32 for both native and builtin
  await cp(`./dxmt/winemetal.dll`, join(system32Dir, "winemetal.dll"));

  if (server.id.startsWith("hkrpg")) {
    await cp(
      `./dxmt/nvngx.dll`,
      resolve("./wine/lib/wine/x86_64-windows/nvngx.dll")
    );
    await cp(`./dxmt/nvngx.dll`, join(system32Dir, "nvngx.dll"));
  }

  if (config.reshade) {
    await cp(resolve("./reshade/dxgi.dll"), join(gameDir, "dxgi.dll"));
    await cp(
      resolve("./reshade/d3dcompiler_47.dll"),
      join(gameDir, "d3dcompiler_47.dll")
    );
  }

  if (!server.id.startsWith("hkrpg")) {
    await cp(
      resolve("./sidecar/protonextras/steam64.exe"),
      join(system32Dir, "steam.exe")
    );
    await cp(
      resolve("./sidecar/protonextras/steam32.exe"),
      join(syswow64Dir, "steam.exe")
    );
    await cp(
      resolve("./sidecar/protonextras/lsteamclient64.dll"),
      join(system32Dir, "lsteamclient.dll")
    );
    await cp(
      resolve("./sidecar/protonextras/lsteamclient32.dll"),
      join(syswow64Dir, "lsteamclient.dll")
    );
  }

  setKey("patched", "1");
}

export async function* patchRevertProgram(
  gameDir: string,
  wine: Wine,
  server: Server,
  config: Config
): CommonUpdateProgram {
  try {
    await getKey("patched");
  } catch {
    return;
  }
  if (!config.patchOff) {
    for (const file of server.patched) {
      if (await fileOrDirExists(join(gameDir, file.file + ".bak"))) {
        await forceMove(
          join(gameDir, file.file + ".bak"),
          join(gameDir, file.file)
        );
      }
    }
    for (const { file } of server.removed) {
      if (await fileOrDirExists(join(gameDir, file + ".bak"))) {
        await forceMove(join(gameDir, file + ".bak"), join(gameDir, file));
      }
    }
    for (const file of server.added) {
      if (await fileOrDirExists(join(gameDir, file.file))) {
        await removeFile(join(gameDir, file.file));
      }
    }
  }

  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  if (wine.attributes.renderBackend == "dxmt") {
    for (const f of DXMT_FILES) {
      const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
      await forceMove(wineLibPath + ".bak", wineLibPath);
    }
  }
  if (config.reshade) {
    await removeFileIfExists(join(gameDir, "dxgi.dll"));
    await removeFileIfExists(join(gameDir, "d3dcompiler_47.dll"));
  }
  setKey("patched", null);
}

// ---------------------------------------------------------------------------
// Workaround #4: replace the game's bundled mhypbase.dll with a user-provided
// older version. Some game versions (notably 6.7) immediately exit during an
// offline launch because the bundled mhypbase.dll version is incompatible
// with the launcher's offline-launch flow; replacing it with an older
// version (manually supplied by the user) restores offline-launch ability.
//
// Legal posture: the launcher DOES NOT redistribute the replacement file.
// The user supplies a path (via Settings -> Launch Fix #4) to a file that
// they themselves acquired. The launcher only:
//   1. verifies the two files differ (byte-level `cmp`)
//   2. backs up the game's current file as <file>.yaagl-replaced.bak
//   3. copies the user-supplied file into the game directory
//
// Reverting (when the user clears or changes the path) restores the backup.
//
// This runs OUTSIDE the `patchProgram` / `patched` storage gate so the
// user can change the path at any time and have it take effect on the next
// launch — independent of whether the one-time `patched` flag is set.
// ---------------------------------------------------------------------------

const MHYPBASE_FILE = "mhypbase.dll";
const MHYPBASE_BAK_SUFFIX = ".yaagl-replaced.bak";

// Returns true if the two files have different bytes (or if the source
// exists and the destination does not). Returns false if (a) the source
// does not exist, (b) both paths are absent, or (c) the bytes are
// identical. `cmp` is shell's byte-by-byte comparator and is fast even
// for multi-MB files; we use `exec` (which uses Neutralino's execCommand)
// rather than loading the bytes into the JS heap.
async function filesDiffer(a: string, b: string): Promise<boolean> {
  if (!(await fileOrDirExists(a))) return false;
  if (!(await fileOrDirExists(b))) return true;
  try {
    // `cmp -s a b` exits 0 if identical, 1 if different, 2 on error.
    // exec() throws on non-zero, so we treat throw as "differ".
    await exec(["cmp", "-s", a, b], {}, false);
    return false; // identical
  } catch {
    return true; // different (or cmp errored — treat as differ to be safe)
  }
}

export async function applyMhypBaseReplacement(
  gameDir: string,
  config: Config
): Promise<void> {
  const source = config.mhypBaseReplacementPath?.trim();
  const target = join(gameDir, MHYPBASE_FILE);
  const backup = join(gameDir, MHYPBASE_FILE + MHYPBASE_BAK_SUFFIX);

  if (!source) {
    // User has cleared the path (or never set one). Restore the original
    // from the backup so the game is back to its factory state.
    if (await fileOrDirExists(backup)) {
      await forceMove(backup, target);
      await log(`applyMhypBaseReplacement: restored original from ${backup}`);
    }
    return;
  }

  if (!(await fileOrDirExists(source))) {
    await log(
      `applyMhypBaseReplacement: source path does not exist, skipping: ${source}`
    );
    return;
  }

  // Only back up the original once — never overwrite an existing backup.
  if (await filesDiffer(source, target)) {
    if (!(await fileOrDirExists(backup))) {
      await forceMove(target, backup);
      await log(`applyMhypBaseReplacement: backed up original to ${backup}`);
    } else {
      await log(
        `applyMhypBaseReplacement: existing backup found at ${backup}, not overwriting`
      );
    }
    await cp(source, target);
    await log(`applyMhypBaseReplacement: copied ${source} -> ${target}`);
  } else {
    await log(
      "applyMhypBaseReplacement: target already matches source, no copy needed"
    );
  }
}

export async function revertMhypBaseReplacement(
  gameDir: string
): Promise<void> {
  const target = join(gameDir, MHYPBASE_FILE);
  const backup = join(gameDir, MHYPBASE_FILE + MHYPBASE_BAK_SUFFIX);
  if (await fileOrDirExists(backup)) {
    await forceMove(backup, target);
    await log(`revertMhypBaseReplacement: restored from ${backup}`);
  }
}

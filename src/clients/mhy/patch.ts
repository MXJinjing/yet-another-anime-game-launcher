import { gt } from "semver";
import { dirname, join } from "path-browserify";
import {
  CommonProgressUICommand,
  CommonUpdateProgram,
} from "@common-update-ui";
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

type PatchProgressRange = {
  start: number;
  end: number;
};

export async function putLocal(url: string, dest: string) {
  return await writeBinary(dest, await (await fetch(url)).arrayBuffer());
}

export async function* patchProgram(
  gameDir: string,
  wine: Wine,
  server: Server,
  config: Config,
  progressRange: PatchProgressRange = { start: 0, end: 0 }
): CommonUpdateProgram {
  const progressSpan = progressRange.end - progressRange.start;
  const report = async function* (
    step: number,
    total: number,
    message: string
  ): AsyncGenerator<CommonProgressUICommand> {
    if (progressSpan > 0) {
      yield [
        "setProgress",
        progressRange.start + Math.round((progressSpan * step) / total),
      ];
    }
    yield ["setRawStateText", message];
  };

  if ((await getKeyOrDefault("patched", "NOTFOUND")) != "NOTFOUND") {
    yield* report(1, 1, "补丁阶段：已检测到补丁状态，跳过重复应用");
    return;
  }

  const patchFileSteps = server.patched.length * 4;
  const removedFileSteps = server.removed.length;
  const addedFileSteps = server.added.length;
  const dxmtSteps = DXMT_FILES.length * 2;
  const totalSteps = Math.max(
    1,
    patchFileSteps +
      removedFileSteps +
      addedFileSteps +
      dxmtSteps +
      9 +
      (server.id.startsWith("hkrpg") ? 2 : 4) +
      (config.reshade ? 2 : 0)
  );
  let step = 0;

  yield* report(step, totalSteps, "补丁阶段：开始准备游戏文件");
  if (!config.patchOff) {
    for (const file of server.patched) {
      yield* report(++step, totalSteps, `补丁阶段：备份 ${file.file}`);
      await forceMove(
        join(gameDir, file.file),
        join(gameDir, file.file + ".bak")
      );
      yield* report(++step, totalSteps, `补丁阶段：下载 ${file.file} 差分补丁`);
      await putLocal(file.diffUrl, join(gameDir, file.file + ".diff"));
      yield* report(++step, totalSteps, `补丁阶段：应用 ${file.file} 差分补丁`);
      await xdelta3(
        join(gameDir, file.file + ".bak"),
        join(gameDir, file.file + ".diff"),
        join(gameDir, file.file)
      );
      await log("patched " + file.file);
      yield* report(
        ++step,
        totalSteps,
        `补丁阶段：清理 ${file.file} 临时差分文件`
      );
      await removeFile(join(gameDir, file.file + ".diff"));
    }
    for (const { file } of server.removed) {
      yield* report(++step, totalSteps, `补丁阶段：临时移除 ${file}`);
      if (await fileOrDirExists(join(gameDir, file))) {
        await forceMove(join(gameDir, file), join(gameDir, file + ".bak"));
      }
    }
    for (const file of server.added) {
      yield* report(++step, totalSteps, `补丁阶段：写入 ${file.file}`);
      await mkdirp(join(gameDir, dirname(file.file)));
      await putLocal(file.url, join(gameDir, file.file));
    }
  } else {
    yield* report(
      ++step,
      totalSteps,
      "补丁阶段：游戏文件补丁已关闭，跳过文件改动"
    );
  }

  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  const syswow64Dir = join(wine.prefix, "drive_c", "windows", "syswow64");

  for (const f of DXMT_FILES) {
    const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
    yield* report(++step, totalSteps, `补丁阶段：备份 Wine 运行库 ${f}`);
    await forceMove(wineLibPath, wineLibPath + ".bak");
    yield* report(++step, totalSteps, `补丁阶段：安装 DXMT 运行库 ${f}`);
    await cp(`./dxmt/${f}`, wineLibPath);
  }

  // winemetal files always go to Wine lib directories
  yield* report(
    ++step,
    totalSteps,
    "补丁阶段：安装 winemetal.dll 到 Wine 运行库"
  );
  await cp(
    `./dxmt/winemetal.dll`,
    resolve("./wine/lib/wine/x86_64-windows/winemetal.dll")
  );

  yield* report(
    ++step,
    totalSteps,
    "补丁阶段：安装 winemetal.so 到 Wine 运行库"
  );
  await cp(
    `./dxmt/winemetal.so`,
    resolve("./wine/lib/wine/x86_64-unix/winemetal.so")
  );

  // winemetal.dll also to system32 for both native and builtin
  yield* report(++step, totalSteps, "补丁阶段：安装 winemetal.dll 到 system32");
  await cp(`./dxmt/winemetal.dll`, join(system32Dir, "winemetal.dll"));

  if (server.id.startsWith("hkrpg")) {
    yield* report(
      ++step,
      totalSteps,
      "补丁阶段：安装 nvngx.dll 到 Wine 运行库"
    );
    await cp(
      `./dxmt/nvngx.dll`,
      resolve("./wine/lib/wine/x86_64-windows/nvngx.dll")
    );
    yield* report(++step, totalSteps, "补丁阶段：安装 nvngx.dll 到 system32");
    await cp(`./dxmt/nvngx.dll`, join(system32Dir, "nvngx.dll"));
  }

  if (config.reshade) {
    yield* report(++step, totalSteps, "补丁阶段：安装 ReShade dxgi.dll");
    await cp(resolve("./reshade/dxgi.dll"), join(gameDir, "dxgi.dll"));
    yield* report(
      ++step,
      totalSteps,
      "补丁阶段：安装 ReShade d3dcompiler_47.dll"
    );
    await cp(
      resolve("./reshade/d3dcompiler_47.dll"),
      join(gameDir, "d3dcompiler_47.dll")
    );
  }

  if (!server.id.startsWith("hkrpg")) {
    yield* report(++step, totalSteps, "补丁阶段：安装 steam64.exe");
    await cp(
      resolve("./sidecar/protonextras/steam64.exe"),
      join(system32Dir, "steam.exe")
    );
    yield* report(++step, totalSteps, "补丁阶段：安装 steam32.exe");
    await cp(
      resolve("./sidecar/protonextras/steam32.exe"),
      join(syswow64Dir, "steam.exe")
    );
    yield* report(++step, totalSteps, "补丁阶段：安装 lsteamclient64.dll");
    await cp(
      resolve("./sidecar/protonextras/lsteamclient64.dll"),
      join(system32Dir, "lsteamclient.dll")
    );
    yield* report(++step, totalSteps, "补丁阶段：安装 lsteamclient32.dll");
    await cp(
      resolve("./sidecar/protonextras/lsteamclient32.dll"),
      join(syswow64Dir, "lsteamclient.dll")
    );
  }

  yield* report(totalSteps, totalSteps, "补丁阶段：记录补丁状态");
  await setKey("patched", "1");
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
    yield ["setRawStateText", "还原补丁阶段：未检测到补丁状态，跳过还原"];
    return;
  }
  yield ["setRawStateText", "还原补丁阶段：开始还原游戏文件"];
  if (!config.patchOff) {
    for (const file of server.patched) {
      yield ["setRawStateText", `还原补丁阶段：还原 ${file.file}`];
      if (await fileOrDirExists(join(gameDir, file.file + ".bak"))) {
        await forceMove(
          join(gameDir, file.file + ".bak"),
          join(gameDir, file.file)
        );
      }
    }
    for (const { file } of server.removed) {
      yield ["setRawStateText", `还原补丁阶段：恢复 ${file}`];
      if (await fileOrDirExists(join(gameDir, file + ".bak"))) {
        await forceMove(join(gameDir, file + ".bak"), join(gameDir, file));
      }
    }
    for (const file of server.added) {
      yield ["setRawStateText", `还原补丁阶段：移除 ${file.file}`];
      if (await fileOrDirExists(join(gameDir, file.file))) {
        await removeFile(join(gameDir, file.file));
      }
    }
  }

  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  if (wine.attributes.renderBackend == "dxmt") {
    for (const f of DXMT_FILES) {
      yield ["setRawStateText", `还原补丁阶段：还原 Wine 运行库 ${f}`];
      const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
      await forceMove(wineLibPath + ".bak", wineLibPath);
    }
  }
  if (config.reshade) {
    yield ["setRawStateText", "还原补丁阶段：移除 ReShade 文件"];
    await removeFileIfExists(join(gameDir, "dxgi.dll"));
    await removeFileIfExists(join(gameDir, "d3dcompiler_47.dll"));
  }
  yield ["setRawStateText", "还原补丁阶段：清除补丁状态"];
  await setKey("patched", null);
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
const MHYPBASE_TMP_SUFFIX = ".yaagl-new.tmp";

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

async function isFile(path: string): Promise<boolean> {
  try {
    await exec(["test", "-f", path], {}, false);
    return true;
  } catch {
    return false;
  }
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function samePath(a: string, b: string): boolean {
  return trimTrailingSlash(resolve(a)) === trimTrailingSlash(resolve(b));
}

async function restoreMhypBaseBackup(target: string, backup: string) {
  if (await fileOrDirExists(backup)) {
    await forceMove(backup, target);
    await log(`restoreMhypBaseBackup: restored ${target} from ${backup}`);
  }
}

export async function applyMhypBaseReplacement(
  gameDir: string,
  config: Config
): Promise<boolean> {
  const target = join(gameDir, MHYPBASE_FILE);
  const backup = join(gameDir, MHYPBASE_FILE + MHYPBASE_BAK_SUFFIX);
  const tmp = join(gameDir, MHYPBASE_FILE + MHYPBASE_TMP_SUFFIX);

  // Toggle off or no path set -> restore original so the game boots clean.
  if (!config.workaround4) {
    await restoreMhypBaseBackup(target, backup);
    return false;
  }

  const source = config.mhypBaseReplacementPath?.trim();
  if (!source) {
    await restoreMhypBaseBackup(target, backup);
    return false;
  }

  if (!(await isFile(source))) {
    await log(
      `applyMhypBaseReplacement: source path is not a file, skipping: ${source}`
    );
    return false;
  }

  if (!(await isFile(target))) {
    await log(
      `applyMhypBaseReplacement: target mhypbase.dll is missing, skipping: ${target}`
    );
    return false;
  }

  if (samePath(source, target) || samePath(source, backup)) {
    await log(
      `applyMhypBaseReplacement: source path points at the game file or backup, skipping: ${source}`
    );
    return false;
  }

  if (!(await filesDiffer(source, target))) {
    const hasBackup = await fileOrDirExists(backup);
    await log(
      `applyMhypBaseReplacement: target already matches source, restore after launch: ${hasBackup}`
    );
    return hasBackup;
  }

  try {
    await removeFileIfExists(tmp);
    await cp(source, tmp);
    if (await filesDiffer(source, tmp)) {
      throw new Error(`temporary copy verification failed: ${tmp}`);
    }

    // Only back up the original once; never overwrite a known-good original.
    if (await fileOrDirExists(backup)) {
      await log(
        `applyMhypBaseReplacement: existing backup found at ${backup}, not overwriting`
      );
    } else {
      await forceMove(target, backup);
      await log(`applyMhypBaseReplacement: backed up original to ${backup}`);
    }

    await forceMove(tmp, target);
    await log(`applyMhypBaseReplacement: temporarily installed ${source}`);
    return true;
  } catch (e) {
    await removeFileIfExists(tmp);
    await restoreMhypBaseBackup(target, backup);
    await log(
      `applyMhypBaseReplacement: failed and restored original if needed: ${String(
        e
      )}`
    );
    return false;
  }
}

export async function revertMhypBaseReplacement(
  gameDir: string
): Promise<void> {
  const target = join(gameDir, MHYPBASE_FILE);
  const backup = join(gameDir, MHYPBASE_FILE + MHYPBASE_BAK_SUFFIX);
  const tmp = join(gameDir, MHYPBASE_FILE + MHYPBASE_TMP_SUFFIX);
  await removeFileIfExists(tmp);
  await restoreMhypBaseBackup(target, backup);
}

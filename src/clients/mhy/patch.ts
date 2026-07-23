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

export async function putLocal(url: string, dest: string) {
  return await writeBinary(dest, await (await fetch(url)).arrayBuffer());
}

export async function* patchProgram(
  gameDir: string,
  wine: Wine,
  server: Server,
  config: Config,
  progressRange?: { start: number; end: number }
): CommonUpdateProgram {
  const progressStart = progressRange?.start ?? 0;
  const progressEnd = progressRange?.end ?? 0;
  let completedSteps = 0;
  const totalSteps =
    (config.patchOff
      ? 0
      : server.patched.length * 4 +
        server.removed.length +
        server.added.length) +
    DXMT_FILES.length * 2 +
    3 +
    (server.id.startsWith("hkrpg") ? 2 : 0) +
    (config.reshade ? 2 : 0) +
    (!server.id.startsWith("hkrpg") ? 4 : 0) +
    1;

  function* report(message: string): Generator<CommonProgressUICommand> {
    completedSteps += 1;
    if (progressRange && totalSteps > 0) {
      yield [
        "setProgress",
        progressStart +
          ((progressEnd - progressStart) * completedSteps) / totalSteps,
      ];
    }
    yield ["setRawStateText", message];
  }

  if ((await getKeyOrDefault("patched", "NOTFOUND")) != "NOTFOUND") {
    yield* report("启动补丁：检测到补丁状态已存在，跳过重复应用");
    return;
  }
  if (!config.patchOff) {
    for (const file of server.patched) {
      yield* report(`启动补丁：备份待补丁文件 ${file.file}`);
      await forceMove(
        join(gameDir, file.file),
        join(gameDir, file.file + ".bak")
      );
      yield* report(`启动补丁：下载差分文件 ${file.file}`);
      await putLocal(file.diffUrl, join(gameDir, file.file + ".diff"));
      yield* report(`启动补丁：应用差分补丁 ${file.file}`);
      await xdelta3(
        join(gameDir, file.file + ".bak"),
        join(gameDir, file.file + ".diff"),
        join(gameDir, file.file)
      );
      await log("patched " + file.file);
      yield* report(`启动补丁：删除临时差分文件 ${file.file}.diff`);
      await removeFile(join(gameDir, file.file + ".diff"));
    }
    for (const { file } of server.removed) {
      yield* report(`启动补丁：临时移除游戏文件 ${file}`);
      if (await fileOrDirExists(join(gameDir, file))) {
        await forceMove(join(gameDir, file), join(gameDir, file + ".bak"));
      }
    }
    for (const file of server.added) {
      yield* report(`启动补丁：添加游戏文件 ${file.file}`);
      await mkdirp(join(gameDir, dirname(file.file)));
      await putLocal(file.url, join(gameDir, file.file));
    }
  } else {
    yield* report("启动补丁：已关闭 AC 补丁，跳过游戏文件补丁");
  }

  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  const syswow64Dir = join(wine.prefix, "drive_c", "windows", "syswow64");

  for (const f of DXMT_FILES) {
    const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
    yield* report(`启动补丁：备份 Wine 图形库 ${f}`);
    await forceMove(wineLibPath, wineLibPath + ".bak");
    yield* report(`启动补丁：安装 DXMT 图形库 ${f}`);
    await cp(`./dxmt/${f}`, wineLibPath);
  }

  // winemetal files always go to Wine lib directories
  yield* report("启动补丁：安装 winemetal.dll 到 Wine 库目录");
  await cp(
    `./dxmt/winemetal.dll`,
    resolve("./wine/lib/wine/x86_64-windows/winemetal.dll")
  );

  yield* report("启动补丁：安装 winemetal.so 到 Wine 库目录");
  await cp(
    `./dxmt/winemetal.so`,
    resolve("./wine/lib/wine/x86_64-unix/winemetal.so")
  );

  // winemetal.dll also to system32 for both native and builtin
  yield* report("启动补丁：安装 winemetal.dll 到 system32");
  await cp(`./dxmt/winemetal.dll`, join(system32Dir, "winemetal.dll"));

  if (server.id.startsWith("hkrpg")) {
    yield* report("启动补丁：安装 nvngx.dll 到 Wine 库目录");
    await cp(
      `./dxmt/nvngx.dll`,
      resolve("./wine/lib/wine/x86_64-windows/nvngx.dll")
    );
    yield* report("启动补丁：安装 nvngx.dll 到 system32");
    await cp(`./dxmt/nvngx.dll`, join(system32Dir, "nvngx.dll"));
  }

  if (config.reshade) {
    yield* report("启动补丁：安装 ReShade dxgi.dll");
    await cp(resolve("./reshade/dxgi.dll"), join(gameDir, "dxgi.dll"));
    yield* report("启动补丁：安装 ReShade d3dcompiler_47.dll");
    await cp(
      resolve("./reshade/d3dcompiler_47.dll"),
      join(gameDir, "d3dcompiler_47.dll")
    );
  }

  if (!server.id.startsWith("hkrpg")) {
    yield* report("启动补丁：安装 steam64.exe 到 system32");
    await cp(
      resolve("./sidecar/protonextras/steam64.exe"),
      join(system32Dir, "steam.exe")
    );
    yield* report("启动补丁：安装 steam32.exe 到 syswow64");
    await cp(
      resolve("./sidecar/protonextras/steam32.exe"),
      join(syswow64Dir, "steam.exe")
    );
    yield* report("启动补丁：安装 64 位 lsteamclient.dll");
    await cp(
      resolve("./sidecar/protonextras/lsteamclient64.dll"),
      join(system32Dir, "lsteamclient.dll")
    );
    yield* report("启动补丁：安装 32 位 lsteamclient.dll");
    await cp(
      resolve("./sidecar/protonextras/lsteamclient32.dll"),
      join(syswow64Dir, "lsteamclient.dll")
    );
  }

  yield* report("启动补丁：写入补丁状态标记");
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
    yield ["setRawStateText", "还原补丁：未检测到补丁状态，跳过还原"];
    return;
  }
  if (!config.patchOff) {
    for (const file of server.patched) {
      yield ["setRawStateText", `还原补丁：恢复原始文件 ${file.file}`];
      if (await fileOrDirExists(join(gameDir, file.file + ".bak"))) {
        await forceMove(
          join(gameDir, file.file + ".bak"),
          join(gameDir, file.file)
        );
      }
    }
    for (const { file } of server.removed) {
      yield ["setRawStateText", `还原补丁：恢复临时移除文件 ${file}`];
      if (await fileOrDirExists(join(gameDir, file + ".bak"))) {
        await forceMove(join(gameDir, file + ".bak"), join(gameDir, file));
      }
    }
    for (const file of server.added) {
      yield ["setRawStateText", `还原补丁：删除启动时添加文件 ${file.file}`];
      if (await fileOrDirExists(join(gameDir, file.file))) {
        await removeFile(join(gameDir, file.file));
      }
    }
  } else {
    yield ["setRawStateText", "还原补丁：AC 补丁已关闭，跳过游戏文件还原"];
  }

  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  if (wine.attributes.renderBackend == "dxmt") {
    for (const f of DXMT_FILES) {
      yield ["setRawStateText", `还原补丁：恢复 Wine 图形库 ${f}`];
      const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
      await forceMove(wineLibPath + ".bak", wineLibPath);
    }
  }
  if (config.reshade) {
    yield ["setRawStateText", "还原补丁：删除 ReShade dxgi.dll"];
    await removeFileIfExists(join(gameDir, "dxgi.dll"));
    yield ["setRawStateText", "还原补丁：删除 ReShade d3dcompiler_47.dll"];
    await removeFileIfExists(join(gameDir, "d3dcompiler_47.dll"));
  }
  yield ["setRawStateText", "还原补丁：清除补丁状态标记"];
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

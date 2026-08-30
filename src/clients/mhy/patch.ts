import { gt } from "semver";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
} from "path-browserify";
import {
  TaskFailedError,
  type TaskProgram,
  type TaskProgressCommand,
} from "@tasks/task-program";
import { Server } from "@constants";
import { log } from "@logging/logger";
import {
  fileOrDirExists,
  readFile,
  removeFile,
  removeFileIfExists,
  resolve,
  resolveResource,
  writeBinary,
  writeFile,
} from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { cp, forceMove, mkdirp } from "@runtime/macos-filesystem";
import { xdelta3 } from "@runtime/patching";
import { globalStorage, type Storage } from "@runtime/storage";
import { Config } from "@config";
import { disableUnityFeature } from "./unity";
import { Wine } from "@wine";
import { DXMT_FILES, DXVK_FILES } from "@wine/runtime-resources";

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
  progressRange: PatchProgressRange = { start: 0, end: 0 },
  storage: Storage = globalStorage
): TaskProgram {
  const progressSpan = progressRange.end - progressRange.start;
  const report = async function* (
    step: number,
    total: number,
    message: string
  ): AsyncGenerator<TaskProgressCommand> {
    if (progressSpan > 0) {
      yield [
        "setProgress",
        progressRange.start + Math.round((progressSpan * step) / total),
      ];
    }
  };

  if ((await storage.getKeyOrDefault("patched", "NOTFOUND")) != "NOTFOUND") {
    yield* report(1, 1, "启动阶段：已检测到补丁状态，跳过重复应用");
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
      resolveResource("./sidecar/protonextras/steam64.exe"),
      join(system32Dir, "steam.exe")
    );
    yield* report(++step, totalSteps, "补丁阶段：安装 steam32.exe");
    await cp(
      resolveResource("./sidecar/protonextras/steam32.exe"),
      join(syswow64Dir, "steam.exe")
    );
    yield* report(++step, totalSteps, "补丁阶段：安装 lsteamclient64.dll");
    await cp(
      resolveResource("./sidecar/protonextras/lsteamclient64.dll"),
      join(system32Dir, "lsteamclient.dll")
    );
    yield* report(++step, totalSteps, "补丁阶段：安装 lsteamclient32.dll");
    await cp(
      resolveResource("./sidecar/protonextras/lsteamclient32.dll"),
      join(syswow64Dir, "lsteamclient.dll")
    );
  }

  yield* report(totalSteps, totalSteps, "补丁阶段：记录补丁状态");
  await storage.setKey("patched", "1");
}

export async function* patchRevertProgram(
  gameDir: string,
  wine: Wine,
  server: Server,
  config: Config,
  storage: Storage = globalStorage
): TaskProgram {
  try {
    await storage.getKey("patched");
  } catch {
    yield ["setRawStateText", "还原阶段：未检测到补丁状态，跳过还原"];
    return;
  }

  const patchFileSteps = server.patched.length;
  const removedFileSteps = server.removed.length;
  const addedFileSteps = server.added.length;
  const dxmtSteps = DXMT_FILES.length;
  const totalSteps = Math.max(
    1,
    patchFileSteps +
      removedFileSteps +
      addedFileSteps +
      dxmtSteps +
      (config.reshade ? 1 : 0) +
      1
  );
  let step = 0;

  const report = async function* (
    message: string
  ): AsyncGenerator<TaskProgressCommand> {
    yield ["setRawStateText", `还原阶段：正在还原补丁(${step}/${totalSteps})`];
  };

  yield* report("还原阶段：开始还原游戏文件");
  if (!config.patchOff) {
    for (const file of server.patched) {
      ++step;
      yield* report(`还原阶段：还原 ${file.file}`);
      if (await fileOrDirExists(join(gameDir, file.file + ".bak"))) {
        await forceMove(
          join(gameDir, file.file + ".bak"),
          join(gameDir, file.file)
        );
      }
    }
    for (const { file } of server.removed) {
      ++step;
      yield* report(`还原阶段：恢复 ${file}`);
      if (await fileOrDirExists(join(gameDir, file + ".bak"))) {
        await forceMove(join(gameDir, file + ".bak"), join(gameDir, file));
      }
    }
    for (const file of server.added) {
      ++step;
      yield* report(`还原阶段：移除 ${file.file}`);
      if (await fileOrDirExists(join(gameDir, file.file))) {
        await removeFile(join(gameDir, file.file));
      }
    }
  }

  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  if (wine.attributes.renderBackend == "dxmt") {
    for (const f of DXMT_FILES) {
      ++step;
      yield* report(`还原阶段：还原 Wine 运行库 ${f}`);
      const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
      await forceMove(wineLibPath + ".bak", wineLibPath);
    }
  }
  if (config.reshade) {
    ++step;
    yield* report("还原阶段：移除 ReShade 文件");
    await removeFileIfExists(join(gameDir, "dxgi.dll"));
    await removeFileIfExists(join(gameDir, "d3dcompiler_47.dll"));
  }
  step = totalSteps;
  yield* report("还原阶段：清除补丁状态");
  await storage.setKey("patched", null);
}

// ---------------------------------------------------------------------------
// Generic runtime file replacement. The launcher only backs up and restores
// files selected by the user; it does not bundle or redistribute any game
// files. Each enabled row is validated before anything is touched, so an
// invalid row fails the whole launch with an explicit error.
//
// Backups use <target>.yaagl-runtime.bak, and temporary copies use
// <target>.yaagl-runtime.tmp. A small manifest in the game directory lets
// revert restore every backup without scanning the entire game tree.
// ---------------------------------------------------------------------------

export type RuntimeReplacementEntry = {
  enabled: boolean;
  targetRelativePath: string;
  replacementPath: string;
};

export type RuntimeReplacementManifest = {
  gameDir: string;
  backups: Array<{
    targetRelativePath: string;
    backupRelativePath: string;
  }>;
};

/** A user-fixable launch failure caused by a missing replacement source file. */
export class RuntimeReplacementFileMissingError extends TaskFailedError {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeReplacementFileMissingError";
  }
}

export function isRuntimeReplacementFileMissingError(
  error: unknown
): error is RuntimeReplacementFileMissingError {
  return error instanceof RuntimeReplacementFileMissingError;
}

type RuntimeReplacementPlan = {
  entry: RuntimeReplacementEntry;
  targetRelativePath: string;
  target: string;
  backup: string;
  tmp: string;
  source: string;
};

type RuntimeReplacementConfigShape = {
  runtimeReplacementsEnabled?: boolean;
  runtimeReplacements?: RuntimeReplacementEntry[];
  workaround4?: boolean;
  mhypBaseReplacementPath?: string;
};

const RUNTIME_BAK_SUFFIX = ".yaagl-runtime.bak";
const RUNTIME_TMP_SUFFIX = ".yaagl-runtime.tmp";
const LEGACY_BAK_SUFFIX = ".yaagl-replaced.bak";
const LEGACY_TMP_SUFFIX = ".yaagl-new.tmp";
const RUNTIME_MANIFEST_FILE = ".yaagl-runtime-replacements.json";

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

function normalizePathSeparators(path: string): string {
  return path.trim().replaceAll("\\", "/");
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function samePath(a: string, b: string): boolean {
  return (
    trimTrailingSlash(resolvePath(a)) === trimTrailingSlash(resolvePath(b))
  );
}

function isRuntimeReplacementEntry(
  value: unknown
): value is RuntimeReplacementEntry {
  if (!value || typeof value != "object") return false;
  const entry = value as Partial<RuntimeReplacementEntry>;
  return (
    typeof entry.enabled == "boolean" &&
    typeof entry.targetRelativePath == "string" &&
    typeof entry.replacementPath == "string"
  );
}

function getRuntimeReplacementConfig(config: Config): {
  enabled: boolean;
  entries: RuntimeReplacementEntry[];
} {
  const runtimeConfig = config as Config & RuntimeReplacementConfigShape;
  if (typeof runtimeConfig.runtimeReplacementsEnabled == "boolean") {
    return {
      enabled: runtimeConfig.runtimeReplacementsEnabled,
      entries: (runtimeConfig.runtimeReplacements ?? []).filter(
        isRuntimeReplacementEntry
      ),
    };
  }

  const legacyPath = runtimeConfig.mhypBaseReplacementPath?.trim() ?? "";
  if (runtimeConfig.workaround4 && legacyPath) {
    return {
      enabled: true,
      entries: [
        {
          enabled: true,
          targetRelativePath: "mhypbase.dll",
          replacementPath: legacyPath,
        },
      ],
    };
  }
  return { enabled: false, entries: [] };
}

export function isSafeTargetRelativePath(
  targetRelativePath: string,
  gameDir: string
): boolean {
  const target = normalizePathSeparators(targetRelativePath);
  if (!target) return false;
  if (
    [...target].some(char => {
      const code = char.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  )
    return false;
  if (isAbsolute(target) || /^[A-Za-z]:[/\\]/.test(target)) return false;
  const base = resolvePath(gameDir);
  const resolved = resolvePath(base, target);
  const rel = relative(base, resolved);
  return rel != "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export type SafeRuntimeManifestRecord = {
  targetRelativePath: string;
  target: string;
  backup: string;
};

export function resolveSafeRuntimeManifestRecords(
  gameDir: string,
  records: unknown[]
): SafeRuntimeManifestRecord[] | null {
  const safeRecords: SafeRuntimeManifestRecord[] = [];
  const seenTargets = new Set<string>();
  for (const value of records) {
    if (!value || typeof value != "object") return null;
    const record = value as { targetRelativePath?: unknown };
    if (typeof record.targetRelativePath != "string") return null;
    const targetRelativePath = normalizePathSeparators(
      record.targetRelativePath
    );
    if (!isSafeTargetRelativePath(targetRelativePath, gameDir)) return null;
    const target = resolvePath(gameDir, targetRelativePath);
    if (seenTargets.has(target)) return null;
    seenTargets.add(target);
    safeRecords.push({
      targetRelativePath,
      target,
      backup: target + RUNTIME_BAK_SUFFIX,
    });
  }
  return safeRecords;
}

async function hasSymlinkedTargetParent(
  gameDir: string,
  targetRelativePath: string
): Promise<boolean> {
  const segments = normalizePathSeparators(targetRelativePath).split("/");
  let current = resolvePath(gameDir);
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    try {
      await exec(["test", "-L", current], {}, false);
      return true;
    } catch {
      // `test -L` returns non-zero for a normal directory or a missing path.
    }
  }
  return false;
}

function resolveReplacementCandidates(
  gameDir: string,
  replacementPath: string
): string[] {
  const normalized = normalizePathSeparators(replacementPath);
  if (!normalized) return [];
  if (isAbsolute(normalized) || /^[A-Za-z]:[/\\]/.test(normalized)) {
    return [resolvePath(normalized)];
  }
  // Relative replacement paths are tried against the game directory first,
  // then against the launcher directory.
  return [resolvePath(gameDir, normalized), resolve(normalized)];
}

async function findFirstExistingFile(
  paths: string[]
): Promise<string | undefined> {
  for (const path of paths) {
    if (await isFile(path)) return path;
  }
  return undefined;
}

async function restoreRuntimeBackup(target: string, backup: string) {
  if (await fileOrDirExists(backup)) {
    await forceMove(backup, target);
    await log(`restoreRuntimeBackup: restored ${target} from ${backup}`);
  }
}

function runtimeManifestPath(gameDir: string): string {
  return join(gameDir, RUNTIME_MANIFEST_FILE);
}

async function readRuntimeManifest(
  gameDir: string
): Promise<RuntimeReplacementManifest | null> {
  try {
    const raw = await readFile(runtimeManifestPath(gameDir));
    const parsed = JSON.parse(raw) as Partial<RuntimeReplacementManifest>;
    if (
      !parsed ||
      typeof parsed.gameDir != "string" ||
      !Array.isArray(parsed.backups)
    ) {
      return null;
    }
    return parsed as RuntimeReplacementManifest;
  } catch {
    return null;
  }
}

async function writeRuntimeManifest(
  gameDir: string,
  backups: RuntimeReplacementManifest["backups"]
) {
  await writeFile(
    runtimeManifestPath(gameDir),
    JSON.stringify({ gameDir, backups })
  );
}

async function restoreRuntimeManifest(gameDir: string): Promise<boolean> {
  const manifest = await readRuntimeManifest(gameDir);
  if (!manifest || !samePath(manifest.gameDir, gameDir)) return false;
  const backups = resolveSafeRuntimeManifestRecords(gameDir, manifest.backups);
  if (!backups) {
    await log(
      "restoreRuntimeManifest: ignored an invalid runtime replacement manifest"
    );
    return false;
  }

  // Validate the entire manifest before moving anything. Besides lexical
  // traversal checks, reject descendant directory symlinks that could resolve
  // an otherwise-safe relative path outside the selected game directory.
  for (const record of backups) {
    if (await hasSymlinkedTargetParent(gameDir, record.targetRelativePath)) {
      await log(
        `restoreRuntimeManifest: rejected symlinked target parent for ${record.targetRelativePath}`
      );
      return false;
    }
  }
  for (const record of backups) {
    await restoreRuntimeBackup(record.target, record.backup);
    await removeFileIfExists(record.target + RUNTIME_TMP_SUFFIX);
  }
  await removeFileIfExists(runtimeManifestPath(gameDir));
  return true;
}

async function findRuntimeFiles(
  gameDir: string,
  suffixes: string[]
): Promise<string[]> {
  const results = await Promise.all(
    suffixes.map(suffix =>
      exec(["find", gameDir, "-type", "f", "-name", `*${suffix}`], {}, false)
    )
  );
  return results.flatMap(result =>
    result.stdOut
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
  );
}

async function restoreRuntimeBackupsFromScan(gameDir: string) {
  const backupFiles = await findRuntimeFiles(gameDir, [
    RUNTIME_BAK_SUFFIX,
    LEGACY_BAK_SUFFIX,
  ]);
  for (const backup of backupFiles) {
    const suffix = backup.endsWith(LEGACY_BAK_SUFFIX)
      ? LEGACY_BAK_SUFFIX
      : RUNTIME_BAK_SUFFIX;
    const target = backup.slice(0, -suffix.length);
    await restoreRuntimeBackup(target, backup);
    await removeFileIfExists(target + RUNTIME_TMP_SUFFIX);
    if (suffix == LEGACY_BAK_SUFFIX) {
      await removeFileIfExists(target + LEGACY_TMP_SUFFIX);
    }
  }
  const tmpFiles = await findRuntimeFiles(gameDir, [
    RUNTIME_TMP_SUFFIX,
    LEGACY_TMP_SUFFIX,
  ]);
  for (const tmp of tmpFiles) {
    await removeFileIfExists(tmp);
  }
  await removeFileIfExists(runtimeManifestPath(gameDir));
}

async function restoreLegacyMhypBaseBackups(gameDir: string) {
  const target = join(gameDir, "mhypbase.dll");
  await restoreRuntimeBackup(target, target + LEGACY_BAK_SUFFIX);
  await restoreRuntimeBackup(target, target + RUNTIME_BAK_SUFFIX);
  await removeFileIfExists(target + LEGACY_TMP_SUFFIX);
  await removeFileIfExists(target + RUNTIME_TMP_SUFFIX);
}

async function buildRuntimeReplacementPlans(
  gameDir: string,
  entries: RuntimeReplacementEntry[]
): Promise<RuntimeReplacementPlan[]> {
  const failures: string[] = [];
  let missingReplacementFile = false;
  const plans: RuntimeReplacementPlan[] = [];
  const seenTargets = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    if (!entry.enabled) continue;
    const targetRelativePath = normalizePathSeparators(
      entry.targetRelativePath
    );
    const replacementPath = entry.replacementPath.trim();
    const label = `第 ${index + 1} 行 (target="${
      entry.targetRelativePath
    }", replacement="${replacementPath}")`;

    if (!isSafeTargetRelativePath(targetRelativePath, gameDir)) {
      failures.push(`目标路径无效：${label}`);
      continue;
    }
    if (!replacementPath) {
      failures.push(`缺少替换文件：${label}`);
      continue;
    }

    const target = join(gameDir, targetRelativePath);
    const backup = target + RUNTIME_BAK_SUFFIX;
    const tmp = target + RUNTIME_TMP_SUFFIX;
    const legacyBackup = target + LEGACY_BAK_SUFFIX;
    const legacyTmp = target + LEGACY_TMP_SUFFIX;
    const source = await findFirstExistingFile(
      resolveReplacementCandidates(gameDir, replacementPath)
    );
    if (!source) {
      missingReplacementFile = true;
      failures.push(`替换文件不存在：${label}`);
      continue;
    }
    if (!(await isFile(target))) {
      failures.push(`待替换文件不存在：${label}`);
      continue;
    }
    if (
      samePath(source, target) ||
      samePath(source, backup) ||
      samePath(source, tmp) ||
      samePath(source, legacyBackup) ||
      samePath(source, legacyTmp)
    ) {
      failures.push(`替换文件指向目标或其备份：${label}`);
      continue;
    }

    const normalizedTarget = resolvePath(target);
    if (seenTargets.has(normalizedTarget)) {
      failures.push(`重复目标路径：${label}`);
      continue;
    }
    seenTargets.add(normalizedTarget);
    plans.push({
      entry,
      targetRelativePath,
      target,
      backup,
      tmp,
      source,
    });
  }

  if (failures.length > 0) {
    const message = `运行时文件替换配置无效：${failures.join("；")}`;
    if (missingReplacementFile) {
      throw new RuntimeReplacementFileMissingError(message);
    }
    throw new Error(message);
  }
  return plans;
}

export async function applyMhypBaseReplacement(
  gameDir: string,
  config: Config
): Promise<boolean> {
  const runtime = getRuntimeReplacementConfig(config);
  if (!runtime.enabled || runtime.entries.length == 0) {
    await revertMhypBaseReplacement(gameDir);
    return false;
  }

  // Restore any leftovers from a previous launch before applying the new set.
  await revertMhypBaseReplacement(gameDir);
  const plans = await buildRuntimeReplacementPlans(gameDir, runtime.entries);
  if (plans.length == 0) {
    await revertMhypBaseReplacement(gameDir);
    return false;
  }

  const appliedBackups: RuntimeReplacementManifest["backups"] = [];
  let applied = false;
  try {
    // Write the manifest before touching any file so a crash mid-apply still
    // leaves a complete list for revert.
    await writeRuntimeManifest(
      gameDir,
      plans.map(plan => ({
        targetRelativePath: plan.targetRelativePath,
        backupRelativePath: plan.targetRelativePath + RUNTIME_BAK_SUFFIX,
      }))
    );
    for (const plan of plans) {
      await restoreRuntimeBackup(plan.target, plan.backup);
      await restoreRuntimeBackup(plan.target, plan.target + LEGACY_BAK_SUFFIX);
      await removeFileIfExists(plan.tmp);

      if (!(await filesDiffer(plan.source, plan.target))) {
        await log(
          `applyRuntimeReplacements: target already matches source, skipping: ${plan.target}`
        );
        continue;
      }

      await cp(plan.source, plan.tmp);
      if (await filesDiffer(plan.source, plan.tmp)) {
        throw new Error(`临时副本校验失败：${plan.tmp}`);
      }
      await forceMove(plan.target, plan.backup);
      await forceMove(plan.tmp, plan.target);
      applied = true;
      appliedBackups.push({
        targetRelativePath: plan.targetRelativePath,
        backupRelativePath: plan.targetRelativePath + RUNTIME_BAK_SUFFIX,
      });
      await log(
        `applyRuntimeReplacements: 已临时替换 ${plan.target} <- ${plan.source}`
      );
    }

    await writeRuntimeManifest(gameDir, appliedBackups);
    return applied;
  } catch (e) {
    for (const plan of plans) {
      await removeFileIfExists(plan.tmp);
      await restoreRuntimeBackup(plan.target, plan.backup);
    }
    await writeRuntimeManifest(gameDir, []);
    await log(
      `applyRuntimeReplacements: failed and restored applied entries: ${String(
        e
      )}`
    );
    throw e;
  }
}

export async function revertMhypBaseReplacement(
  gameDir: string
): Promise<void> {
  if (!(await restoreRuntimeManifest(gameDir))) {
    if (await fileOrDirExists(runtimeManifestPath(gameDir))) {
      await restoreRuntimeBackupsFromScan(gameDir);
    } else {
      await restoreLegacyMhypBaseBackups(gameDir);
    }
  }
}

import { dirname, join } from "path-browserify";
import type { TaskProgram } from "@tasks/task-program";
import { log } from "@logging/logger";
import {
  fileOrDirExists,
  removeFile,
  removeFileIfExists,
  resolve,
  writeBinary,
} from "@platform/neutralino";
import { cp, forceMove, mkdirp } from "@runtime/macos-filesystem";
import { xdelta3 } from "@runtime/patching";
import { getKey, getKeyOrDefault, setKey } from "@runtime/storage";
import { Config } from "@config";
import { Wine } from "@wine";
import { DXMT_FILES, DXVK_FILES } from "@wine/runtime-resources";

export async function putLocal(url: string, dest: string) {
  return await writeBinary(dest, await (await fetch(url)).arrayBuffer());
}

export async function* patchProgram(
  gameDir: string,
  wine: Wine,
  config: Config
): TaskProgram {
  if ((await getKeyOrDefault("patched", "NOTFOUND")) != "NOTFOUND") {
    return;
  }
  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  if (wine.attributes.renderBackend == "dxmt") {
    for (const f of DXMT_FILES) {
      await forceMove(join(system32Dir, f), join(system32Dir, f + ".bak"));
      await cp(`./dxmt/${f}`, join(system32Dir, f));
    }
  }
  if (config.reshade) {
    await cp(resolve("./reshade/dxgi.dll"), join(gameDir, "dxgi.dll"));
    await cp(
      resolve("./reshade/d3dcompiler_47.dll"),
      join(gameDir, "d3dcompiler_47.dll")
    );
  }
  setKey("patched", "1");
}

export async function* patchRevertProgram(
  gameDir: string,
  wine: Wine,
  config: Config
): TaskProgram {
  try {
    await getKey("patched");
  } catch {
    return;
  }
  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  if (wine.attributes.renderBackend == "dxmt") {
    for (const f of DXMT_FILES) {
      await forceMove(join(system32Dir, f + ".bak"), join(system32Dir, f));
    }
  }
  if (config.reshade) {
    await removeFileIfExists(join(gameDir, "dxgi.dll"));
    await removeFileIfExists(join(gameDir, "d3dcompiler_47.dll"));
  }
  setKey("patched", null);
}

import { readBinary } from "@platform/neutralino";
import { binaryPatternSearch } from "@runtime/binary";
import { md5 } from "@runtime/patching";
import { join } from "path-browserify";
import { GameVersionUnreadableError } from "../launch-errors";
import { readGameVersion } from "../game-version";

export async function getGameVersion(gameDataDir: string, offset = 0x88) {
  const ggmPath = join(gameDataDir, "globalgamemanagers");
  const view = new Uint8Array(await readBinary(ggmPath));
  const index = binaryPatternSearch(
    view,
    [
      0x69, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x2d, 0x63, 0x61, 0x74, 0x65, 0x67,
      0x6f, 0x72, 0x79, 0x2e,
    ]
  );
  if (index == -1) {
    throw new GameVersionUnreadableError(
      `Game version pattern not found in ${ggmPath}`
    );
  } else {
    const len = index + offset;
    const v = new DataView(view.buffer);
    const strlen = v.getUint32(len, true);
    const str = String.fromCharCode(...view.slice(len + 4, len + strlen + 4));
    return str.split("_")[0];
  }
}

/**
 * Read the version with the legacy 0xac offset first, then the default 0x88
 * offset. Some game builds only expose the version at one of the two places.
 */
export async function getGameVersionWithFallback(gameDataDir: string) {
  const legacyOffset = await getGameVersion(gameDataDir, 0xac).catch(
    () => undefined
  );
  if (readGameVersion(legacyOffset)) return legacyOffset as string;
  try {
    return await getGameVersion(gameDataDir);
  } catch (error) {
    if (legacyOffset !== undefined) return legacyOffset;
    throw error;
  }
}

export async function getGameVersion2019(gameDataDir: string) {
  const ggmPath = join(gameDataDir, "data.unity3d");
  const view = new Uint8Array(await readBinary(ggmPath));
  const index = binaryPatternSearch(
    view,
    [0x63, 0x61, 0x74, 0x65, 0x67, 0x6f, 0x72, 0x79]
  );
  if (index == -1) {
    // workaround
    const ggmMD5 = (await md5(ggmPath)).toLowerCase();
    if (ggmMD5 == "57dad95088363b87e0c1ab614fe9431c") {
      return "3.1.0";
    }
    if (ggmMD5 == "a62a4da2e7bb1b1c3fe725173b9bcd64") {
      return "3.2.0";
    }
    if (ggmMD5 == "28fa1997e51c707d13979ad8b9aed759") {
      return "3.6.0";
    }
    if (ggmMD5 == "3602065e153d9782a0f0cf4a73a98b44") {
      return "3.8.0";
    }
    if (ggmMD5 == "01fbfd295247a36ef97109121bd3ec01") {
      return "4.3.0";
    }
    return "9.99.99";
  } else {
    for (let j = index; j < index + 0x80; j++) {
      if (view[j] == 0x2e && view[j + 2] == 0x2e) {
        return (
          String.fromCharCode(view[j - 1]) +
          "." +
          String.fromCharCode(view[j + 1]) +
          "." +
          String.fromCharCode(view[j + 3])
        );
      }
    }
    throw new GameVersionUnreadableError(
      `Failed to parse the game version from ${ggmPath}`
    );
  }
}

export async function disableUnityFeature(ggmPath: string) {
  const view = new Uint8Array(await readBinary(ggmPath));
  const index = binaryPatternSearch(
    view,
    [
      0x69, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x2d, 0x63, 0x61, 0x74, 0x65, 0x67,
      0x6f, 0x72, 0x79, 0x2e,
    ]
  );
  // Optional feature: a game build without the marker simply keeps the
  // feature enabled instead of failing the launch.
  if (index == -1) return undefined;
  const len = index + 24;
  const v = new DataView(view.buffer);
  v.setInt32(len, 0, true);
  return view.buffer;
}

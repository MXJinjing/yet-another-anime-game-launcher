import { readBinary } from "@platform/neutralino";
import { hk4eIconFile } from "./hk4e-catalog";

const cacheDir = "pull-analysis-hk4e-portraits";
const maxBytes = 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const pngEnd = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
const images = new Map<string, Promise<string | undefined>>();

function isPng(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  return (
    bytes.length >= 45 &&
    bytes.length <= maxBytes &&
    pngSignature.every((value, index) => bytes[index] === value) &&
    pngEnd.every(
      (value, index) => bytes[bytes.length - pngEnd.length + index] === value
    )
  );
}

export function readCachedHk4ePortrait(icon: string) {
  const file = hk4eIconFile(icon);
  if (!file) return;
  const loaded = images.get(file);
  if (loaded) return loaded;
  const current = (async () => {
    const data = await readBinary(`${cacheDir}/${file}`);
    if (isPng(data))
      return URL.createObjectURL(new Blob([data], { type: "image/png" }));
  })().catch(() => undefined);
  images.set(file, current);
  void current.then(url => {
    if (!url) images.delete(file);
  });
  return current;
}

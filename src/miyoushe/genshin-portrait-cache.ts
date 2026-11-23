import {
  readBinary,
  readDirectory,
  removeFileIfExists,
  resolve,
  writeBinary,
} from "@platform/neutralino";
import {
  genshinIconFile,
  genshinIconSources,
  type CatalogItem,
} from "./genshin-catalog";

const cacheDir = "miyoushe-genshin-portraits";
const maxBytes = 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const pngEnd = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
const attempted = new Set<string>();
const downloads = new Map<string, Promise<void>>();
const images = new Map<string, Promise<string | undefined>>();
const queue: { file: string; icon: string }[] = [];
let workers = 0;
let files: Promise<Set<string>> | undefined;

function catalogFiles() {
  return (files ??= (async () => {
    await Neutralino.filesystem
      .createDirectory(resolve(cacheDir))
      .catch(() => undefined);
    return new Set((await readDirectory(cacheDir)).map(entry => entry.entry));
  })().catch(error => {
    files = undefined;
    throw error;
  }));
}

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

async function fetchPortrait(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return;
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (isPng(bytes.buffer)) return bytes.buffer;
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadPortrait(
  file: string,
  icon: string,
  existing: Set<string>
) {
  for (const source of genshinIconSources(icon)) {
    const data = await fetchPortrait(source);
    if (!data) continue;
    const path = `${cacheDir}/${file}`;
    const temp = `${path}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await writeBinary(temp, data);
      await Neutralino.filesystem.moveFile(resolve(temp), resolve(path));
      existing.add(file);
    } finally {
      await removeFileIfExists(temp).catch(() => undefined);
    }
    return;
  }
}

async function cacheWorker(existing: Set<string>) {
  workers++;
  try {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (existing.has(item.file)) continue;
      const current = downloadPortrait(item.file, item.icon, existing).catch(
        () => undefined
      );
      downloads.set(item.file, current);
      await current;
      downloads.delete(item.file);
    }
  } finally {
    workers--;
  }
}

export async function warmGenshinPortraits(items: readonly CatalogItem[]) {
  const existing = await catalogFiles().catch(() => undefined);
  if (!existing) return;
  for (const { icon } of items) {
    if (!icon) continue;
    const file = genshinIconFile(icon);
    if (!file || existing.has(file) || attempted.has(file)) continue;
    attempted.add(file);
    queue.push({ file, icon });
  }
  while (queue.length && workers < 4) void cacheWorker(existing);
}

export function readCachedGenshinPortrait(icon: string) {
  const file = genshinIconFile(icon);
  if (!file) return;
  const loaded = images.get(file);
  if (loaded) return loaded;
  const current = (async () => {
    const existing = await catalogFiles();
    await downloads.get(file);
    if (!existing.has(file)) return;
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

import {
  readBinary,
  removeFileIfExists,
  resolve,
  writeBinary,
} from "@platform/neutralino";
import { hk4ePortraitBase } from "@src/constants/yaaglm-config.secret.json";
import { hk4eIconFile, initialCatalog } from "./hk4e-catalog";

const cacheDir = "pull-analysis-hk4e-portraits";
const maxBytes = 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const pngEnd = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
const images = new Map<string, Promise<string | undefined>>();
const downloads = new Map<string, Promise<ArrayBuffer | undefined>>();
const queue: (() => Promise<void>)[] = [];
const parallelDownloads = 3;
let workers = 0;
let cacheDirectory: Promise<void> | undefined;
let maintenance: Promise<void> | undefined;

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

async function fetchPortrait(file: string) {
  const category = file.startsWith("UI_AvatarIcon_")
    ? "character_icon"
    : "equip";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      new URL(`${category}/${file}`, hk4ePortraitBase),
      {
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      }
    );
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (
      let next = await reader.read();
      !next.done;
      next = await reader.read()
    ) {
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return;
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (isPng(bytes.buffer)) return bytes.buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadPortrait(file: string) {
  const data = await fetchPortrait(file);
  if (!data) return;
  cacheDirectory ??= Neutralino.filesystem
    .createDirectory(resolve(cacheDir))
    .catch(() => undefined);
  await cacheDirectory;
  const path = `${cacheDir}/${file}`;
  const pending = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeBinary(pending, data);
    await Neutralino.filesystem.moveFile(resolve(pending), resolve(path));
  } finally {
    await removeFileIfExists(pending).catch(() => undefined);
  }
  return data;
}

function drainDownloads() {
  while (workers < parallelDownloads) {
    const work = queue.shift();
    if (!work) return;
    workers++;
    void work().finally(() => {
      workers--;
      drainDownloads();
    });
  }
}

function queueDownload(file: string) {
  const existing = downloads.get(file);
  if (existing) return existing;
  const task = new Promise<ArrayBuffer | undefined>(done => {
    queue.push(async () => {
      done(await downloadPortrait(file).catch(() => undefined));
    });
  });
  downloads.set(file, task);
  void task.then(() => downloads.delete(file));
  drainDownloads();
  return task;
}

async function loadPortrait(file: string) {
  const data = await readBinary(`${cacheDir}/${file}`).catch(() => undefined);
  return data && isPng(data) ? data : queueDownload(file);
}

export function maintainHk4ePortraits() {
  return (maintenance ??= (async () => {
    const files = [
      ...new Set(
        initialCatalog.items.flatMap(({ icon }) => {
          const file = icon && hk4eIconFile(icon);
          return file ? [file] : [];
        })
      ),
    ];
    await Promise.all(
      Array.from({ length: parallelDownloads }, async () => {
        for (let file = files.shift(); file; file = files.shift()) {
          await loadPortrait(file);
        }
      })
    );
  })());
}

export function readCachedHk4ePortrait(icon: string) {
  const file = hk4eIconFile(icon);
  if (!file) return;
  const loaded = images.get(file);
  if (loaded) return loaded;
  const current = (async () => {
    const data = await loadPortrait(file);
    if (data)
      return URL.createObjectURL(new Blob([data], { type: "image/png" }));
  })().catch(() => undefined);
  images.set(file, current);
  void current.then(url => {
    if (!url) images.delete(file);
  });
  return current;
}

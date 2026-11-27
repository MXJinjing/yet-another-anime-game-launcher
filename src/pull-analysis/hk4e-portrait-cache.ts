import {
  readBinary,
  removeFileIfExists,
  resolve,
  stats,
  writeBinary,
} from "@platform/neutralino";
import { exec2 } from "@runtime/command-runner";
import { hk4ePortraitBase } from "@src/constants/yaaglm-config.secret.json";
import {
  hk4eIconFile,
  hk4eWikiPortraitUrl,
  initialCatalog,
} from "./hk4e-catalog";
import { readGachaArchive } from "./local";

const cacheDir = "pull-analysis-hk4e-portraits";
const maxBytes = 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const pngEnd = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
const images = new Map<string, Promise<string | undefined>>();
const downloads = new Map<string, Promise<ArrayBuffer | undefined>>();
type Download = {
  file: string;
  complete: (data: ArrayBuffer | undefined) => void;
};
const reportQueue: Download[] = [];
const backgroundQueue: Download[] = [];
const parallelDownloads = 3;
const parallelBackground = parallelDownloads - 1;
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

async function fetchPortrait(
  file: string
): Promise<ArrayBuffer | "missing" | undefined> {
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
    if (response.status === 404) return "missing";
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

async function fetchWikiPortrait(url: string, pending: string) {
  await exec2([
    "/usr/bin/curl",
    "--disable",
    "--fail",
    "--silent",
    "--show-error",
    "--globoff",
    "--proto",
    "=https",
    "--max-time",
    "8",
    "--max-filesize",
    String(maxBytes),
    "--output",
    resolve(pending),
    url,
  ]);
  const { size } = await stats(pending);
  if (size < 45 || size > maxBytes) return;
  const data = await readBinary(pending);
  if (isPng(data)) return data;
}

async function downloadPortrait(file: string) {
  const primary = await fetchPortrait(file);
  if (!primary) return;
  const wikiURL = primary === "missing" ? hk4eWikiPortraitUrl(file) : undefined;
  if (primary === "missing" && !wikiURL) return;
  cacheDirectory ??= Neutralino.filesystem
    .createDirectory(resolve(cacheDir))
    .catch(() => undefined);
  await cacheDirectory;
  const path = `${cacheDir}/${file}`;
  const pending = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const data = wikiURL ? await fetchWikiPortrait(wikiURL, pending) : primary;
    if (!data || data === "missing") return;
    if (!wikiURL) await writeBinary(pending, data);
    await Neutralino.filesystem.moveFile(resolve(pending), resolve(path));
    return data;
  } finally {
    await removeFileIfExists(pending).catch(() => undefined);
  }
}

function drainDownloads() {
  while (workers < parallelDownloads) {
    const work =
      reportQueue.shift() ??
      (workers < parallelBackground ? backgroundQueue.shift() : undefined);
    if (!work) return;
    workers++;
    void downloadPortrait(work.file)
      .catch(() => undefined)
      .then(data => {
        downloads.delete(work.file);
        workers--;
        work.complete(data);
        drainDownloads();
      });
  }
}

function queueDownload(file: string, forReport: boolean) {
  const existing = downloads.get(file);
  if (existing) {
    const index = forReport
      ? backgroundQueue.findIndex(task => task.file === file)
      : -1;
    if (index >= 0) {
      reportQueue.push(...backgroundQueue.splice(index, 1));
      drainDownloads();
    }
    return existing;
  }
  const task = new Promise<ArrayBuffer | undefined>(complete => {
    (forReport ? reportQueue : backgroundQueue).push({ file, complete });
  });
  downloads.set(file, task);
  drainDownloads();
  return task;
}

async function loadPortrait(file: string, forReport = false) {
  const data = await readBinary(`${cacheDir}/${file}`).catch(() => undefined);
  return data && isPng(data) ? data : queueDownload(file, forReport);
}

export function maintainHk4ePortraits() {
  return (maintenance ??= (async () => {
    const byId = new Map(
      initialCatalog.items.flatMap(({ id, icon }) => {
        const file = icon && hk4eIconFile(icon);
        return file ? [[id, file] as const] : [];
      })
    );
    const archive = await readGachaArchive().catch(() => undefined);
    const used = (archive?.hk4e ?? []).flatMap(account =>
      account.list.flatMap(({ item_id }) => byId.get(item_id) ?? [])
    );
    const files = [...new Set([...used, ...byId.values()])];
    await Promise.all(
      Array.from({ length: parallelBackground }, async () => {
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
    const data = await loadPortrait(file, true);
    if (data)
      return URL.createObjectURL(new Blob([data], { type: "image/png" }));
  })().catch(() => undefined);
  images.set(file, current);
  void current.then(url => {
    if (!url) images.delete(file);
  });
  return current;
}

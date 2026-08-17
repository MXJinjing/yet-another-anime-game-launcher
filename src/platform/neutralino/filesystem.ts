import { resolve } from "./path";

export async function appendFile(path: string, content: string) {
  await Neutralino.filesystem.appendFile(resolve(path), content);
}

export async function readFile(path: string) {
  return Neutralino.filesystem.readFile(resolve(path));
}

export async function readBinary(path: string) {
  return Neutralino.filesystem.readBinaryFile(resolve(path));
}

export async function readAllLines(path: string) {
  const content = await readFile(path);
  return content.indexOf("\r\n") >= 0
    ? content.split("\r\n")
    : content.split("\n");
}

export async function stats(path: string) {
  return Neutralino.filesystem.getStats(resolve(path));
}

export async function readAllLinesIfExists(path: string) {
  try {
    await stats(path);
  } catch {
    return [];
  }
  return readAllLines(path);
}

export async function writeBinary(path: string, data: ArrayBuffer) {
  return Neutralino.filesystem.writeBinaryFile(resolve(path), data);
}

export async function writeFile(path: string, data: string) {
  return Neutralino.filesystem.writeFile(resolve(path), data);
}

export async function removeFile(path: string) {
  return Neutralino.filesystem.removeFile(resolve(path));
}

export async function readDirectory(path: string) {
  return Neutralino.filesystem.readDirectory(resolve(path));
}

export async function removeDirectory(path: string) {
  return Neutralino.filesystem.removeDirectory(resolve(path));
}

export async function removeFileIfExists(path: string) {
  try {
    await stats(path);
  } catch {
    return;
  }
  return Neutralino.filesystem.removeFile(resolve(path));
}

export async function fileOrDirExists(path: string) {
  try {
    await stats(path);
    return true;
  } catch {
    return false;
  }
}

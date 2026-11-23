import { removeFile, writeFile } from "@platform/neutralino";
import { join } from "path-browserify";

const GPUINFO =
  '{"LUID":1009,"VendorId":4318,"DeviceId":11141,"Revision":0,"SubSysId":0,"DedicatedVideoMemory":34359738368,"DedicatedSystemMemory":0,"SharedSystemMemory":34359738368,"Description":"NVIDIA GeForce RTX 5090"}';

/**
 * The launcher advertises an NVIDIA adapter so the game enables its DLSS path.
 * Kept apart from the settings UI so launch code never imports DOM-only JSX.
 */
export async function writeMetalFxGpuInfo(
  winePrefix: string,
  enabled: boolean
) {
  const path = join(winePrefix, "gpuinfo");
  if (!enabled) {
    await removeMetalFxGpuInfo(winePrefix);
    return;
  }
  await writeFile(path, GPUINFO);
}

export async function removeMetalFxGpuInfo(winePrefix: string) {
  const path = join(winePrefix, "gpuinfo");
  try {
    await removeFile(path);
  } catch {
    // The desired disabled state is already satisfied when the file is absent.
  }
}

import { createSignal } from "solid-js";
import { Locale } from "@locale";
import { SettingSwitch } from "../../../../components/setting-switch";
import { Config } from "@config/config-def";
import { globalStorage, type Storage } from "@runtime/storage";
import { removeFile, writeFile } from "@platform/neutralino";
import { join } from "path-browserify";
import {
  readNapMetalFxEnabled,
  writeNapMetalFxEnabled,
} from "./metalfx-storage";

declare module "@config/config-def" {
  interface Config {
    napMetalFxEnable: boolean;
  }
}

const GPUINFO =
  '{"LUID":1009,"VendorId":4318,"DeviceId":11141,"Revision":0,"SubSysId":0,"DedicatedVideoMemory":34359738368,"DedicatedSystemMemory":0,"SharedSystemMemory":34359738368,"Description":"NVIDIA GeForce RTX 5090"}';

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

export default async function ({
  locale,
  config,
  storage = globalStorage,
  renderBackend,
}: {
  config: Partial<Config>;
  locale: Locale;
  storage?: Storage;
  /** Which bridge implements MetalFX for the selected Wine runtime. */
  renderBackend?: () => "dxmt" | "d3dmetal" | undefined;
}) {
  config.napMetalFxEnable = await readNapMetalFxEnabled(storage);
  const [enabled, setEnabled] = createSignal(config.napMetalFxEnable);

  const onChange = async (next: boolean) => {
    config.napMetalFxEnable = next;
    setEnabled(next);
    await writeNapMetalFxEnabled(storage, next);
  };

  // One switch drives both implementations: DXMT ships its own NGX bridge,
  // while a D3DMetal runtime provides the DLSS-to-MetalFX bridge itself.
  const requirement = () =>
    renderBackend?.() == "dxmt"
      ? locale.get("SETTING_NAP_METALFX_DXMT_NOTE")
      : locale.get("SETTING_NAP_METALFX_RUNTIME_NOTE");

  return [
    function UI() {
      return (
        <SettingSwitch
          id="napMetalFx"
          label={locale.get("SETTING_NAP_METALFX")}
          description={locale.get("SETTING_NAP_METALFX_DESC")}
          checked={enabled()}
          onChange={value => void onChange(value)}
        >
          <span class="setting-switch-requirement">{requirement()}</span>
        </SettingSwitch>
      );
    },
  ] as const;
}

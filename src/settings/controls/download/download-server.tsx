import { Box, Input, InputGroup, Text } from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { AppSelect } from "../../../components/app-select";
import { SettingSwitch } from "../../../components/setting-switch";
import { reloadConfig } from "../../../download/stream-scheduler";
import { Config, NOOP } from "../../../config/config-def";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";

declare module "../../../config/config-def" {
  interface Config {
    downloadProxyEnabled: boolean;
    downloadProxyHost: string;
    downloadSpeedLimitEnabled: boolean;
    downloadSpeedLimitValue: number;
    downloadSpeedLimitUnit: DownloadSpeedLimitUnit;
  }
}

export type DownloadSpeedLimitUnit = "K" | "M" | "G";

function isDownloadSpeedLimitUnit(
  value: string
): value is DownloadSpeedLimitUnit {
  return value == "K" || value == "M" || value == "G";
}

export async function createDownloadServerConfig({
  config,
  locale,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.downloadProxyEnabled =
      (await store.read(configEntries.downloadProxyEnabled)) ?? false;
  } catch {
    config.downloadProxyEnabled = false;
  }
  try {
    config.downloadProxyHost =
      (await store.read(configEntries.downloadProxyHost)) ?? "127.0.0.1:7890";
  } catch {
    config.downloadProxyHost = "127.0.0.1:7890";
  }
  try {
    config.downloadSpeedLimitEnabled =
      (await store.read(configEntries.downloadSpeedLimitEnabled)) ?? false;
  } catch {
    config.downloadSpeedLimitEnabled = false;
  }
  try {
    const limit =
      (await store.read(configEntries.downloadSpeedLimitValue)) ?? 1024;
    config.downloadSpeedLimitValue =
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1024;
  } catch {
    config.downloadSpeedLimitValue = 1024;
  }
  try {
    const unit = await store.read(configEntries.downloadSpeedLimitUnit);
    config.downloadSpeedLimitUnit = isDownloadSpeedLimitUnit(unit ?? "")
      ? (unit as DownloadSpeedLimitUnit)
      : "K";
  } catch {
    config.downloadSpeedLimitUnit = "K";
  }

  const [proxyEnabled, setProxyEnabled] = createSignal(
    config.downloadProxyEnabled
  );
  const [proxyHost, setProxyHost] = createSignal(config.downloadProxyHost);
  const [speedLimitEnabled, setSpeedLimitEnabled] = createSignal(
    config.downloadSpeedLimitEnabled
  );
  const [speedLimitValue, setSpeedLimitValue] = createSignal(
    config.downloadSpeedLimitValue
  );
  const [speedLimitUnit, setSpeedLimitUnit] = createSignal(
    config.downloadSpeedLimitUnit
  );

  async function onSave(apply: boolean) {
    assertValueDefined(config.downloadProxyEnabled);
    assertValueDefined(config.downloadProxyHost);
    assertValueDefined(config.downloadSpeedLimitEnabled);
    assertValueDefined(config.downloadSpeedLimitValue);
    assertValueDefined(config.downloadSpeedLimitUnit);
    if (!apply) {
      setProxyEnabled(config.downloadProxyEnabled);
      setProxyHost(config.downloadProxyHost);
      setSpeedLimitEnabled(config.downloadSpeedLimitEnabled);
      setSpeedLimitValue(config.downloadSpeedLimitValue);
      setSpeedLimitUnit(config.downloadSpeedLimitUnit);
      return NOOP;
    }

    if (config.downloadProxyEnabled != proxyEnabled()) {
      config.downloadProxyEnabled = proxyEnabled();
      await store.write(
        configEntries.downloadProxyEnabled,
        config.downloadProxyEnabled
      );
    }
    if (config.downloadProxyHost != proxyHost()) {
      config.downloadProxyHost = proxyHost();
      await store.write(
        configEntries.downloadProxyHost,
        config.downloadProxyHost
      );
    }

    // Track whether any download budget setting changed so the shared queue
    // can be reloaded once at the end (proxy settings are not part of it).
    let downloadConfigChanged = false;
    if (config.downloadSpeedLimitEnabled != speedLimitEnabled()) {
      config.downloadSpeedLimitEnabled = speedLimitEnabled();
      await store.write(
        configEntries.downloadSpeedLimitEnabled,
        config.downloadSpeedLimitEnabled
      );
      downloadConfigChanged = true;
    }
    if (config.downloadSpeedLimitValue != speedLimitValue()) {
      config.downloadSpeedLimitValue = speedLimitValue();
      await store.write(
        configEntries.downloadSpeedLimitValue,
        config.downloadSpeedLimitValue
      );
      downloadConfigChanged = true;
    }
    if (config.downloadSpeedLimitUnit != speedLimitUnit()) {
      config.downloadSpeedLimitUnit = speedLimitUnit();
      await store.write(
        configEntries.downloadSpeedLimitUnit,
        config.downloadSpeedLimitUnit
      );
      downloadConfigChanged = true;
    }
    if (downloadConfigChanged) {
      await reloadConfig();
    }
    return NOOP;
  }

  createEffect(() => {
    proxyEnabled();
    proxyHost();
    speedLimitEnabled();
    speedLimitValue();
    speedLimitUnit();
    onSave(true);
  });

  return [
    function UI() {
      return [
        <SettingSwitch
          id="downloadProxy"
          label={locale.get("SETTING_DOWNLOAD_PROXY")}
          checked={proxyEnabled()}
          onChange={setProxyEnabled}
        >
          <Show when={proxyEnabled()}>
            <Box mt={"$2"}>
              <InputGroup>
                <Input
                  value={proxyHost()}
                  placeholder="127.0.0.1:7890"
                  onChange={e => setProxyHost(e.currentTarget.value)}
                />
              </InputGroup>
              <Text userSelect={"none"} size="xs" mt={"$1"}>
                {locale.get("SETTING_DOWNLOAD_PROXY_DESC")}
              </Text>
            </Box>
          </Show>
        </SettingSwitch>,
        <SettingSwitch
          id="downloadSpeedLimit"
          label={locale.get("SETTING_DOWNLOAD_SPEED_LIMIT")}
          checked={speedLimitEnabled()}
          onChange={setSpeedLimitEnabled}
        >
          <Show when={speedLimitEnabled()}>
            <Box mt={"$2"} display="flex" alignItems="center" gap={"$2"}>
              <Input
                type="number"
                min={1}
                value={String(speedLimitValue())}
                width="120px"
                onChange={e => {
                  const value = Number(e.currentTarget.value);
                  if (Number.isFinite(value) && value > 0) {
                    setSpeedLimitValue(Math.floor(value));
                  }
                }}
              />
              <AppSelect
                value={speedLimitUnit()}
                onChange={value => {
                  if (isDownloadSpeedLimitUnit(value)) {
                    setSpeedLimitUnit(value);
                  }
                }}
                width={100}
                options={[
                  { value: "K", label: "KiB/s" },
                  { value: "M", label: "MiB/s" },
                  { value: "G", label: "GiB/s" },
                ]}
              />
            </Box>
          </Show>
        </SettingSwitch>,
      ];
    },
  ] as const;
}

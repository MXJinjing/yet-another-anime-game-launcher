import { Box, Input, InputGroup, Text } from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "../locale";
import { AppSelect } from "../components/app-select";
import { SettingSwitch } from "../components/setting-switch";
import { MAX_CONCURRENT_DOWNLOADS_KEY } from "../download-budget";
import { reloadConfig } from "../download-queue";
import { Config, NOOP } from "./config-def";
import { assertValueDefined, getKey, setKey } from "@utils";

declare module "./config-def" {
  interface Config {
    downloadProxyEnabled: boolean;
    downloadProxyHost: string;
    downloadSpeedLimitEnabled: boolean;
    downloadSpeedLimitValue: number;
    downloadSpeedLimitUnit: DownloadSpeedLimitUnit;
    downloadMaxConcurrent: number;
  }
}

export type DownloadSpeedLimitUnit = "K" | "M" | "G";

const DOWNLOAD_PROXY_ENABLED_KEY = "config_downloadProxyEnabled";
const DOWNLOAD_PROXY_HOST_KEY = "config_downloadProxyHost";
const DOWNLOAD_SPEED_LIMIT_ENABLED_KEY = "config_downloadSpeedLimitEnabled";
const DOWNLOAD_SPEED_LIMIT_VALUE_KEY = "config_downloadSpeedLimitValue";
const DOWNLOAD_SPEED_LIMIT_UNIT_KEY = "config_downloadSpeedLimitUnit";

function isDownloadSpeedLimitUnit(
  value: string
): value is DownloadSpeedLimitUnit {
  return value == "K" || value == "M" || value == "G";
}

export async function createDownloadServerConfig({
  config,
  locale,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.downloadProxyEnabled =
      (await getKey(DOWNLOAD_PROXY_ENABLED_KEY)) == "true";
  } catch {
    config.downloadProxyEnabled = false;
  }
  try {
    config.downloadProxyHost = await getKey(DOWNLOAD_PROXY_HOST_KEY);
  } catch {
    config.downloadProxyHost = "127.0.0.1:7890";
  }
  try {
    config.downloadSpeedLimitEnabled =
      (await getKey(DOWNLOAD_SPEED_LIMIT_ENABLED_KEY)) == "true";
  } catch {
    config.downloadSpeedLimitEnabled = false;
  }
  try {
    const limit = Number(await getKey(DOWNLOAD_SPEED_LIMIT_VALUE_KEY));
    config.downloadSpeedLimitValue =
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1024;
  } catch {
    config.downloadSpeedLimitValue = 1024;
  }
  try {
    const unit = await getKey(DOWNLOAD_SPEED_LIMIT_UNIT_KEY);
    config.downloadSpeedLimitUnit = isDownloadSpeedLimitUnit(unit) ? unit : "K";
  } catch {
    config.downloadSpeedLimitUnit = "K";
  }

  try {
    const concurrent = Number(await getKey(MAX_CONCURRENT_DOWNLOADS_KEY));
    config.downloadMaxConcurrent =
      Number.isFinite(concurrent) && concurrent >= 0
        ? Math.floor(concurrent)
        : 0;
  } catch {
    config.downloadMaxConcurrent = 0;
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

  const [maxConcurrent, setMaxConcurrent] = createSignal(
    config.downloadMaxConcurrent
  );

  async function onSave(apply: boolean) {
    assertValueDefined(config.downloadProxyEnabled);
    assertValueDefined(config.downloadProxyHost);
    assertValueDefined(config.downloadSpeedLimitEnabled);
    assertValueDefined(config.downloadSpeedLimitValue);
    assertValueDefined(config.downloadSpeedLimitUnit);
    assertValueDefined(config.downloadMaxConcurrent);
    if (!apply) {
      setProxyEnabled(config.downloadProxyEnabled);
      setProxyHost(config.downloadProxyHost);
      setSpeedLimitEnabled(config.downloadSpeedLimitEnabled);
      setSpeedLimitValue(config.downloadSpeedLimitValue);
      setSpeedLimitUnit(config.downloadSpeedLimitUnit);
      setMaxConcurrent(config.downloadMaxConcurrent);
      return NOOP;
    }

    if (config.downloadProxyEnabled != proxyEnabled()) {
      config.downloadProxyEnabled = proxyEnabled();
      await setKey(
        DOWNLOAD_PROXY_ENABLED_KEY,
        config.downloadProxyEnabled ? "true" : "false"
      );
    }
    if (config.downloadProxyHost != proxyHost()) {
      config.downloadProxyHost = proxyHost();
      await setKey(DOWNLOAD_PROXY_HOST_KEY, config.downloadProxyHost);
    }

    // Track whether any download budget setting changed so the shared queue
    // can be reloaded once at the end (proxy settings are not part of it).
    let downloadConfigChanged = false;
    if (config.downloadSpeedLimitEnabled != speedLimitEnabled()) {
      config.downloadSpeedLimitEnabled = speedLimitEnabled();
      await setKey(
        DOWNLOAD_SPEED_LIMIT_ENABLED_KEY,
        config.downloadSpeedLimitEnabled ? "true" : "false"
      );
      downloadConfigChanged = true;
    }
    if (config.downloadSpeedLimitValue != speedLimitValue()) {
      config.downloadSpeedLimitValue = speedLimitValue();
      await setKey(
        DOWNLOAD_SPEED_LIMIT_VALUE_KEY,
        String(config.downloadSpeedLimitValue)
      );
      downloadConfigChanged = true;
    }
    if (config.downloadSpeedLimitUnit != speedLimitUnit()) {
      config.downloadSpeedLimitUnit = speedLimitUnit();
      await setKey(
        DOWNLOAD_SPEED_LIMIT_UNIT_KEY,
        config.downloadSpeedLimitUnit
      );
      downloadConfigChanged = true;
    }
    if (config.downloadMaxConcurrent != maxConcurrent()) {
      config.downloadMaxConcurrent = maxConcurrent();
      await setKey(
        MAX_CONCURRENT_DOWNLOADS_KEY,
        String(config.downloadMaxConcurrent)
      );
      downloadConfigChanged = true;
    }
    if (downloadConfigChanged) {
      // Apply speed limit / concurrency changes to active downloads.
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
    maxConcurrent();
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
                  { value: "K", label: "KB/s" },
                  { value: "M", label: "MB/s" },
                  { value: "G", label: "GB/s" },
                ]}
              />
            </Box>
          </Show>
        </SettingSwitch>,
        <Box mt={"$3"}>
          <Text
            class="download-max-concurrent-label"
            size="sm"
            fontWeight="bold"
            userSelect={"none"}
          >
            {locale.get("SETTING_MAX_CONCURRENT_DOWNLOADS")}
          </Text>
          <Box mt={"$2"} display="flex" alignItems="center" gap={"$2"}>
            <Input
              id="downloadMaxConcurrent"
              type="number"
              min={0}
              step={1}
              value={String(maxConcurrent())}
              width="120px"
              onChange={e => {
                const value = Number(e.currentTarget.value);
                if (Number.isFinite(value) && value >= 0) {
                  setMaxConcurrent(Math.floor(value));
                }
              }}
            />
          </Box>
          <Text userSelect={"none"} size="xs" mt={"$1"}>
            {locale.get("SETTING_MAX_CONCURRENT_DOWNLOADS_DESC")}
          </Text>
        </Box>,
      ];
    },
  ] as const;
}

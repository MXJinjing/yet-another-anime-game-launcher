import {
  Box,
  Checkbox,
  FormControl,
  FormLabel,
  Input,
  InputGroup,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectTrigger,
  SelectValue,
  Text,
} from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "../locale";
import { Config, NOOP } from "./config-def";
import { assertValueDefined, getKey, setKey } from "@utils";

declare module "./config-def" {
  interface Config {
    downloadProxyEnabled: boolean;
    downloadProxyHost: string;
    downloadSpeedLimitEnabled: boolean;
    downloadSpeedLimitValue: number;
    downloadSpeedLimitUnit: DownloadSpeedLimitUnit;
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
      await setKey(
        DOWNLOAD_PROXY_ENABLED_KEY,
        config.downloadProxyEnabled ? "true" : "false"
      );
    }
    if (config.downloadProxyHost != proxyHost()) {
      config.downloadProxyHost = proxyHost();
      await setKey(DOWNLOAD_PROXY_HOST_KEY, config.downloadProxyHost);
    }
    if (config.downloadSpeedLimitEnabled != speedLimitEnabled()) {
      config.downloadSpeedLimitEnabled = speedLimitEnabled();
      await setKey(
        DOWNLOAD_SPEED_LIMIT_ENABLED_KEY,
        config.downloadSpeedLimitEnabled ? "true" : "false"
      );
    }
    if (config.downloadSpeedLimitValue != speedLimitValue()) {
      config.downloadSpeedLimitValue = speedLimitValue();
      await setKey(
        DOWNLOAD_SPEED_LIMIT_VALUE_KEY,
        String(config.downloadSpeedLimitValue)
      );
    }
    if (config.downloadSpeedLimitUnit != speedLimitUnit()) {
      config.downloadSpeedLimitUnit = speedLimitUnit();
      await setKey(
        DOWNLOAD_SPEED_LIMIT_UNIT_KEY,
        config.downloadSpeedLimitUnit
      );
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
        <FormControl id="downloadProxy">
          <FormLabel>{locale.get("SETTING_DOWNLOAD_PROXY")}</FormLabel>
          <Box>
            <Checkbox
              checked={proxyEnabled()}
              size="md"
              onChange={() => setProxyEnabled(x => !x)}
            >
              {locale.get("SETTING_ENABLED")}
            </Checkbox>
          </Box>
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
        </FormControl>,
        <FormControl id="downloadSpeedLimit">
          <FormLabel>{locale.get("SETTING_DOWNLOAD_SPEED_LIMIT")}</FormLabel>
          <Box>
            <Checkbox
              checked={speedLimitEnabled()}
              size="md"
              onChange={() => setSpeedLimitEnabled(x => !x)}
            >
              {locale.get("SETTING_ENABLED")}
            </Checkbox>
          </Box>
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
              <Select
                value={speedLimitUnit()}
                onChange={value => {
                  if (isDownloadSpeedLimitUnit(value)) {
                    setSpeedLimitUnit(value);
                  }
                }}
              >
                <SelectTrigger width="100px">
                  <SelectValue />
                  <SelectIcon />
                </SelectTrigger>
                <SelectContent>
                  <SelectListbox>
                    <SelectOption value="K">
                      <SelectOptionText>KB/s</SelectOptionText>
                      <SelectOptionIndicator />
                    </SelectOption>
                    <SelectOption value="M">
                      <SelectOptionText>MB/s</SelectOptionText>
                      <SelectOptionIndicator />
                    </SelectOption>
                    <SelectOption value="G">
                      <SelectOptionText>GB/s</SelectOptionText>
                      <SelectOptionIndicator />
                    </SelectOption>
                  </SelectListbox>
                </SelectContent>
              </Select>
            </Box>
          </Show>
        </FormControl>,
      ];
    },
  ] as const;
}

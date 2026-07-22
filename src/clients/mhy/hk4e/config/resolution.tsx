import {
  Button,
  ButtonGroup,
  FormControl,
  FormLabel,
  HStack,
  Input,
  VStack,
} from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";

declare module "@config/config-def" {
  interface Config {
    resolutionCustom: boolean;
    resolutionWidth: string;
    resolutionHeight: string;
  }
}

const CONFIG_KEY_CUSTOM = "config_resolution_custom";
const CONFIG_KEY_WIDTH = "config_resolution_width";
const CONFIG_KEY_HEIGHT = "config_resolution_height";

export default async function ({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.resolutionCustom = (await getKey(CONFIG_KEY_CUSTOM)) == "true";
  } catch {
    config.resolutionCustom = false;
  }
  try {
    config.resolutionWidth = await getKey(CONFIG_KEY_WIDTH);
  } catch {
    config.resolutionWidth = "1920";
  }
  try {
    config.resolutionHeight = await getKey(CONFIG_KEY_HEIGHT);
  } catch {
    config.resolutionHeight = "1080";
  }

  const [windowed, setWindowed] = createSignal(config.resolutionCustom);
  const [width, setWidth] = createSignal(config.resolutionWidth);
  const [height, setHeight] = createSignal(config.resolutionHeight);

  async function onSave(apply: boolean) {
    assertValueDefined(config.resolutionCustom);
    assertValueDefined(config.resolutionWidth);
    assertValueDefined(config.resolutionHeight);
    if (!apply) {
      setWindowed(config.resolutionCustom);
      setWidth(config.resolutionWidth);
      setHeight(config.resolutionHeight);
      return NOOP;
    }
    if (config.resolutionCustom != windowed()) {
      config.resolutionCustom = windowed();
      await setKey(
        CONFIG_KEY_CUSTOM,
        config.resolutionCustom ? "true" : "false"
      );
    }
    if (config.resolutionWidth != width()) {
      config.resolutionWidth = width();
      await setKey(CONFIG_KEY_WIDTH, config.resolutionWidth);
    }
    if (config.resolutionHeight != height()) {
      config.resolutionHeight = height();
      await setKey(CONFIG_KEY_HEIGHT, config.resolutionHeight);
    }
    return NOOP;
  }

  createEffect(() => {
    windowed();
    width();
    height();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl>
          <FormLabel>{locale.get("SETTING_DISPLAY_MODE")}</FormLabel>
          <VStack spacing={"$2"} alignItems="stretch">
            <ButtonGroup attached size="sm">
              <Button
                variant={windowed() ? "ghost" : "solid"}
                onClick={() => setWindowed(false)}
              >
                {locale.get("SETTING_DISPLAY_MODE_FULLSCREEN")}
              </Button>
              <Button
                variant={windowed() ? "solid" : "ghost"}
                onClick={() => setWindowed(true)}
              >
                {locale.get("SETTING_DISPLAY_MODE_WINDOWED")}
              </Button>
            </ButtonGroup>
            <FormLabel>{locale.get("SETTING_WINDOW_RESOLUTION")}</FormLabel>
            <HStack spacing={"$2"}>
              <Input
                value={width()}
                type="number"
                min={1}
                disabled={!windowed()}
                onChange={e => setWidth(e.currentTarget.value)}
              />
              <Input
                value={height()}
                type="number"
                min={1}
                disabled={!windowed()}
                onChange={e => setHeight(e.currentTarget.value)}
              />
            </HStack>
          </VStack>
        </FormControl>
      );
    },
  ] as const;
}

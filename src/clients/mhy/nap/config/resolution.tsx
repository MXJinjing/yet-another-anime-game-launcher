import { FormControl, FormLabel, Input, HStack, VStack } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "@runtime/assertions";
import { getKey, setKey } from "@runtime/storage";
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
    config.resolutionCustom = false; // default value
  }
  try {
    config.resolutionWidth = await getKey(CONFIG_KEY_WIDTH);
  } catch {
    config.resolutionWidth = "1920"; // default value
  }
  try {
    config.resolutionHeight = await getKey(CONFIG_KEY_HEIGHT);
  } catch {
    config.resolutionHeight = "1080"; // default value
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
          <VStack spacing={"$6"} alignItems="stretch">
            <HStack
              class="display-mode-row"
              w="100%"
              justifyContent="space-between"
              alignItems="center"
            >
              <FormLabel mb={0}>{locale.get("SETTING_DISPLAY_MODE")}</FormLabel>
              <div
                class="display-mode-toggle"
                role="group"
                aria-label={locale.get("SETTING_DISPLAY_MODE")}
              >
                <button
                  type="button"
                  classList={{ active: !windowed() }}
                  onClick={() => setWindowed(false)}
                >
                  {locale.get("SETTING_DISPLAY_MODE_FULLSCREEN")}
                </button>
                <button
                  type="button"
                  classList={{ active: windowed() }}
                  onClick={() => setWindowed(true)}
                >
                  {locale.get("SETTING_DISPLAY_MODE_WINDOWED")}
                </button>
              </div>
            </HStack>
            <HStack w="100%" justifyContent="space-between" alignItems="center">
              <FormLabel mb={0}>
                {locale.get("SETTING_WINDOW_RESOLUTION")}
              </FormLabel>
              <HStack spacing="$2">
                <Input
                  width="96px"
                  value={width()}
                  type="number"
                  min={1}
                  disabled={!windowed()}
                  onChange={e => setWidth(e.currentTarget.value)}
                />
                <Input
                  width="96px"
                  value={height()}
                  type="number"
                  min={1}
                  disabled={!windowed()}
                  onChange={e => setHeight(e.currentTarget.value)}
                />
              </HStack>
            </HStack>
          </VStack>
        </FormControl>
      );
    },
  ] as const;
}

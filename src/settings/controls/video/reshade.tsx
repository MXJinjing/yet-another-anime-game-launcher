import { Box, Button } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { resolve } from "../../../platform/neutralino";
import { assertValueDefined } from "../../../runtime/assertions";
import { exec } from "../../../runtime/command-runner";
import { configEntries, type ConfigStore } from "@config";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    reshade: boolean;
  }
}

export default async function ({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.reshade = (await store.read(configEntries.reshade)) ?? false;
  } catch {
    config.reshade = false; // default value
  }

  const [value, setValue] = createSignal(config.reshade);

  async function onSave(apply: boolean) {
    assertValueDefined(config.reshade);
    if (!apply) {
      setValue(config.reshade);
      return;
    }
    if (config.reshade == value()) return;
    config.reshade = value();
    await store.write(configEntries.reshade, config.reshade);
    return;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI(opts?: { disabled?: boolean }) {
      const disabled = opts?.disabled ?? !config.advancedEnable;

      async function openShadersFolder() {
        try {
          const shadersDir = resolve("./reshade/Shaders");
          // Ensure the directory exists before opening
          await exec(["mkdir", "-p", shadersDir], {}, false, "/dev/null");
          await exec(["open", shadersDir], {}, false, "/dev/null");
        } catch {
          // ignore errors when opening folder
        }
      }

      return (
        <SettingSwitch
          id="reshade"
          label="ReShade"
          checked={value()}
          onChange={setValue}
          disabled={disabled}
        >
          <Box mt="$2">
            <Button size="sm" variant="ghost" onClick={openShadersFolder}>
              {locale.get("SETTING_OPEN_SHADERS_FOLDER")}
            </Button>
          </Box>
        </SettingSwitch>
      );
    },
  ] as const;
}

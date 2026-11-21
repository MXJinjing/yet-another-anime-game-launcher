import { Box, Button, Input, Text } from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale, type LocaleTextKey } from "@locale";
import {
  configureGithubEndpoint,
  DEFAULT_GITHUB_PREFIX,
  normalizeGithubPrefix,
  testGithubPrefix,
} from "../../../integrations/github";
import { configEntries, type ConfigStore } from "@config";
import { Config, NOOP } from "../../../config/config-def";
import { log } from "../../../logging/logger";
import { assertValueDefined } from "../../../runtime/assertions";
import { SettingSwitch } from "../../../components/setting-switch";

declare module "../../../config/config-def" {
  interface Config {
    githubAcceleratedPrefixEnabled: boolean;
    githubAcceleratedPrefix: string;
  }
}

type GithubPrefixStatus =
  | "idle"
  | "testing"
  | "connected"
  | "failed"
  | "invalid";

/**
 * Probes a user-entered prefix and maps the outcome to a display status.
 *
 * The settings screen is the only caller allowed to surface a prefix error:
 * `testGithubPrefix` keeps throwing, but that rejection is contained here so
 * it never escapes into the settings tree or the boot flow.
 */
export async function probeGithubPrefix(
  value: string
): Promise<GithubPrefixStatus> {
  if (!normalizeGithubPrefix(value)) return "invalid";
  try {
    await testGithubPrefix(value);
    return "connected";
  } catch {
    return "failed";
  }
}

function statusKey(status: GithubPrefixStatus): LocaleTextKey | undefined {
  switch (status) {
    case "testing":
      return "SETTING_GITHUB_ACCELERATED_PREFIX_TESTING";
    case "connected":
      return "SETTING_GITHUB_ACCELERATED_PREFIX_CONNECTED";
    case "failed":
      return "SETTING_GITHUB_ACCELERATED_PREFIX_FAILED";
    case "invalid":
      return "SETTING_GITHUB_ACCELERATED_PREFIX_INVALID";
    default:
      return undefined;
  }
}

export async function createGithubAcceleratedPrefixConfig({
  config,
  locale,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.githubAcceleratedPrefixEnabled =
      (await store.read(configEntries.githubAcceleratedPrefixEnabled)) ?? false;
  } catch {
    config.githubAcceleratedPrefixEnabled = false;
  }

  try {
    const storedPrefix =
      (await store.read(configEntries.githubAcceleratedPrefix)) ??
      DEFAULT_GITHUB_PREFIX;
    config.githubAcceleratedPrefix =
      normalizeGithubPrefix(storedPrefix) ?? DEFAULT_GITHUB_PREFIX;
  } catch {
    config.githubAcceleratedPrefix = DEFAULT_GITHUB_PREFIX;
  }

  const [enabled, setEnabled] = createSignal(
    config.githubAcceleratedPrefixEnabled
  );
  const [prefix, setPrefix] = createSignal(config.githubAcceleratedPrefix);
  const [status, setStatus] = createSignal<GithubPrefixStatus>("idle");

  async function onSave() {
    assertValueDefined(config.githubAcceleratedPrefixEnabled);
    assertValueDefined(config.githubAcceleratedPrefix);

    const normalizedPrefix = normalizeGithubPrefix(prefix());
    const nextEnabled = enabled();
    if (nextEnabled && !normalizedPrefix) {
      setStatus("invalid");
      return NOOP;
    }

    const nextPrefix = normalizedPrefix ?? DEFAULT_GITHUB_PREFIX;
    configureGithubEndpoint({
      enabled: nextEnabled,
      prefix: nextPrefix,
    });

    if (config.githubAcceleratedPrefixEnabled != nextEnabled) {
      config.githubAcceleratedPrefixEnabled = nextEnabled;
      await store.write(
        configEntries.githubAcceleratedPrefixEnabled,
        config.githubAcceleratedPrefixEnabled
      );
    }
    if (config.githubAcceleratedPrefix != nextPrefix) {
      config.githubAcceleratedPrefix = nextPrefix;
      await store.write(
        configEntries.githubAcceleratedPrefix,
        config.githubAcceleratedPrefix
      );
    }

    return NOOP;
  }

  async function test() {
    setStatus("testing");
    setStatus(await probeGithubPrefix(prefix()));
  }

  createEffect(() => {
    enabled();
    prefix();
    // Saving a setting must never surface as an unhandled rejection; the
    // invalid-prefix case is already reflected in the switch state.
    void onSave().catch(error => {
      void log(`Failed to save GitHub acceleration setting: ${String(error)}`);
    });
  });

  return [
    function UI() {
      const currentStatusKey = () => statusKey(status());
      return (
        <SettingSwitch
          id="githubAcceleratedPrefix"
          label={locale.get("SETTING_GITHUB_ACCELERATED_PREFIX")}
          checked={enabled()}
          onChange={value => {
            setEnabled(value);
            setStatus("idle");
          }}
        >
          <Show when={enabled()}>
            <Box mt="$2" display="flex" alignItems="center" gap="$2">
              <Input
                flex={1}
                value={prefix()}
                placeholder={DEFAULT_GITHUB_PREFIX}
                aria-label={locale.get("SETTING_GITHUB_ACCELERATED_PREFIX_URL")}
                onChange={event => {
                  setPrefix(event.currentTarget.value);
                  setStatus("idle");
                }}
              />
              <Button size="xs" variant="ghost" onClick={test}>
                {locale.get("SETTING_GITHUB_ACCELERATED_PREFIX_TEST")}
              </Button>
              <Show when={currentStatusKey()}>
                <Text
                  size="xs"
                  userSelect="none"
                  style={{ "white-space": "nowrap" }}
                >
                  {locale.get(currentStatusKey()!)}
                </Text>
              </Show>
            </Box>
          </Show>
        </SettingSwitch>
      );
    },
  ] as const;
}

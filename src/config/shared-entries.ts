import {
  booleanCodec,
  finiteNumberCodec,
  stringCodec,
  withDefault,
} from "./config-codecs";
import type { ConfigEntry } from "./config-entry";

export const configEntries = {
  autoUpdateEnabled: withDefault(
    "config_auto_update_enabled",
    true,
    booleanCodec
  ),
  advancedEnable: withDefault("config_advanced_enable", false, booleanCodec),
  debugMode: withDefault("config_debug_mode", false, booleanCodec),
  disableVideoBackground: withDefault(
    "config_disable_video_background",
    false,
    booleanCodec
  ),
  downloadProxyEnabled: withDefault(
    "config_downloadProxyEnabled",
    false,
    booleanCodec
  ),
  downloadProxyHost: withDefault(
    "config_downloadProxyHost",
    "127.0.0.1:7890",
    stringCodec
  ),
  downloadSpeedLimitEnabled: withDefault(
    "config_downloadSpeedLimitEnabled",
    false,
    booleanCodec
  ),
  downloadSpeedLimitValue: withDefault(
    "config_downloadSpeedLimitValue",
    1024,
    finiteNumberCodec
  ),
  downloadSpeedLimitUnit: withDefault(
    "config_downloadSpeedLimitUnit",
    "K",
    stringCodec
  ),
  downloadMaxConcurrent: withDefault(
    "config_maxConcurrentDownloads",
    0,
    finiteNumberCodec
  ),
  githubAcceleratedPrefixEnabled: withDefault(
    "config_github_accelerated_prefix_enabled",
    false,
    booleanCodec
  ),
  githubAcceleratedPrefix: withDefault(
    "config_github_accelerated_prefix",
    "https://ghp.3shain.uk/",
    stringCodec
  ),
  metalFxEnable: withDefault("config_metalfx_enable", false, booleanCodec),
  metalFxFactor: withDefault("config_metalfx_factor", 2, finiteNumberCodec),
  metalHud: withDefault("config_metalHud", false, booleanCodec),
  proxyEnabled: withDefault("config_proxyEnabled", false, booleanCodec),
  proxyHost: withDefault("config_proxyHost", "127.0.0.1:8080", stringCodec),
  reshade: withDefault("config_reshade", false, booleanCodec),
  retina: withDefault("config_retina", false, booleanCodec),
  themeColor: withDefault("config_theme_color", "amber", stringCodec),
  vsyncDisable: withDefault("config_vsync_disable", false, booleanCodec),
  leftCmd: withDefault("left_cmd", false, booleanCodec),
  uiLocale: {
    key: "config_uiLocale",
    ...stringCodec,
  } satisfies ConfigEntry<string>,
  gameInstallDir: {
    key: "game_install_dir",
    ...stringCodec,
  } satisfies ConfigEntry<string>,
  preferredMaxFps: {
    key: "config_preferred_max_fps",
    ...stringCodec,
  } satisfies ConfigEntry<string>,
} as const;

export type SharedConfigEntry =
  (typeof configEntries)[keyof typeof configEntries];

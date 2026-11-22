/**
 * Global settings tab order. Keep this in sync with `GlobalSettings`
 * (`renderTabList` and `renderTabs`) so callers that open the dialog on a
 * specific tab do not depend on magic numbers.
 */
export const GLOBAL_SETTINGS_TAB = {
  general: 0,
  controls: 1,
  download: 2,
  wine: 3,
} as const;

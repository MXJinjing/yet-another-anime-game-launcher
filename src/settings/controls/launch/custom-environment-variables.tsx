import { Box, Button, Checkbox, Input } from "@hope-ui/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "@runtime/assertions";
import { globalStorage, type Storage } from "@runtime/storage";
import { Config, NOOP } from "@config/config-def";
import { parseCustomEnvironmentVariables } from "@config/custom-environment-variables";
import type { CustomEnvironmentVariable } from "@config/custom-environment-variables";
import { SettingSwitch } from "../../../components/setting-switch";

declare module "@config/config-def" {
  interface Config {
    customEnvironmentVariablesEnabled: boolean;
    customEnvironmentVariables: CustomEnvironmentVariable[];
  }
}

type StoredCustomEnvironmentVariables = {
  enabled: boolean;
  entries: CustomEnvironmentVariable[];
};

const CUSTOM_ENVIRONMENT_VARIABLES_KEY = "config_custom_environment_variables";

function isStoredCustomEnvironmentVariables(
  value: unknown
): value is StoredCustomEnvironmentVariables {
  if (!value || typeof value != "object") return false;
  const stored = value as Partial<StoredCustomEnvironmentVariables>;
  return typeof stored.enabled == "boolean" && Array.isArray(stored.entries);
}

function emptyEntry(): CustomEnvironmentVariable {
  return { enabled: true, key: "", value: "" };
}

export default async function ({
  locale,
  config,
  storage = globalStorage,
}: {
  locale: Locale;
  config: Partial<Config>;
  storage?: Storage;
}) {
  const { getKey, setKey } = storage;
  let stored: StoredCustomEnvironmentVariables = {
    enabled: false,
    entries: [],
  };
  try {
    const parsed = JSON.parse(await getKey(CUSTOM_ENVIRONMENT_VARIABLES_KEY));
    if (isStoredCustomEnvironmentVariables(parsed)) {
      stored = {
        enabled: parsed.enabled,
        entries: parseCustomEnvironmentVariables(parsed.entries),
      };
    }
  } catch {
    // Use the empty configuration when no saved rows exist yet.
  }

  config.customEnvironmentVariablesEnabled = stored.enabled;
  config.customEnvironmentVariables = stored.entries.map(entry => ({
    ...entry,
  }));

  const [enabled, setEnabled] = createSignal(stored.enabled);
  const [entries, setEntries] = createSignal(
    stored.entries.map(entry => ({ ...entry }))
  );

  async function onSave(apply: boolean) {
    assertValueDefined(config.customEnvironmentVariablesEnabled);
    assertValueDefined(config.customEnvironmentVariables);
    if (!apply) {
      setEnabled(config.customEnvironmentVariablesEnabled);
      setEntries(
        config.customEnvironmentVariables.map(entry => ({ ...entry }))
      );
      return NOOP;
    }

    const nextEnabled = enabled();
    const nextEntries = entries().map(entry => ({ ...entry }));
    config.customEnvironmentVariablesEnabled = nextEnabled;
    config.customEnvironmentVariables = nextEntries;
    await setKey(
      CUSTOM_ENVIRONMENT_VARIABLES_KEY,
      JSON.stringify({ enabled: nextEnabled, entries: nextEntries })
    );
    return NOOP;
  }

  createEffect(() => {
    enabled();
    entries();
    void onSave(true);
  });

  function updateEntry(
    index: number,
    patch: Partial<CustomEnvironmentVariable>
  ) {
    setEntries(previous =>
      previous.map((entry, entryIndex) =>
        entryIndex == index ? { ...entry, ...patch } : entry
      )
    );
  }

  function rowIsInvalid(index: number): boolean {
    const entry = entries()[index];
    if (!entry.enabled || !entry.key.trim()) return entry.enabled;
    const key = entry.key.trim();
    return entries()
      .slice(0, index)
      .some(previous => previous.enabled && previous.key.trim() == key);
  }

  return [
    function UI() {
      const thStyle = {
        padding: "8px 10px",
        textAlign: "left",
        color: "rgba(255, 255, 255, 0.52)",
        fontSize: "12px",
        fontWeight: 700,
        borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
        whiteSpace: "nowrap",
      } as const;
      const thNarrowStyle = {
        ...thStyle,
        padding: "8px 2px",
        textAlign: "center",
      } as const;
      const tdNarrowStyle = {
        padding: "6px 4px",
        verticalAlign: "middle",
        textAlign: "center",
        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
      } as const;

      return (
        <SettingSwitch
          id="custom-environment-variables"
          label={locale.get("SETTING_CUSTOM_ENVIRONMENT_VARIABLES_TITLE")}
          description={locale.get("SETTING_CUSTOM_ENVIRONMENT_VARIABLES_DESC")}
          checked={enabled()}
          onChange={setEnabled}
        >
          <Show when={enabled()}>
            <Box mt="$3">
              <div class="runtime-replace-table-shell">
                <table
                  class="runtime-replace-table"
                  style={{
                    width: "100%",
                    "table-layout": "fixed",
                    "border-collapse": "collapse",
                    color: "rgba(255, 255, 255, 0.88)",
                  }}
                >
                  <colgroup>
                    <col style={{ width: "44px" }} />
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "70%" }} />
                    <col style={{ width: "44px" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        class="runtime-replace-table-header"
                        style={thNarrowStyle}
                      >
                        {locale.get(
                          "SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_ENABLED"
                        )}
                      </th>
                      <th class="runtime-replace-table-header" style={thStyle}>
                        {locale.get(
                          "SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_KEY"
                        )}
                      </th>
                      <th class="runtime-replace-table-header" style={thStyle}>
                        {locale.get(
                          "SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_VALUE"
                        )}
                      </th>
                      <th
                        class="runtime-replace-table-header"
                        style={thNarrowStyle}
                      >
                        {locale.get(
                          "SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_DELETE"
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={entries()}>
                      {(entry, index) => {
                        const invalid = rowIsInvalid(index());
                        return (
                          <tr
                            style={
                              invalid
                                ? { background: "rgba(255, 82, 82, 0.09)" }
                                : undefined
                            }
                          >
                            <td
                              class="runtime-replace-enable-cell"
                              style={tdNarrowStyle}
                            >
                              <div class="runtime-replace-enable-control">
                                <Checkbox
                                  id={`custom-environment-variable-${index()}`}
                                  aria-label={locale.format(
                                    "SETTING_CUSTOM_ENVIRONMENT_VARIABLES_ROW_ENABLED",
                                    [String(index() + 1)]
                                  )}
                                  checked={entry.enabled}
                                  onChange={() =>
                                    updateEntry(index(), {
                                      enabled: !entry.enabled,
                                    })
                                  }
                                />
                              </div>
                            </td>
                            <td
                              class={`runtime-replace-edit-cell${
                                invalid
                                  ? " runtime-replace-edit-cell-invalid"
                                  : ""
                              }`}
                            >
                              <div class="runtime-replace-cell-content">
                                <Input
                                  class="runtime-replace-cell-input"
                                  size="sm"
                                  flex={1}
                                  minWidth={0}
                                  invalid={invalid}
                                  value={entry.key}
                                  onChange={event =>
                                    updateEntry(index(), {
                                      key: event.currentTarget.value,
                                    })
                                  }
                                />
                              </div>
                            </td>
                            <td class="runtime-replace-edit-cell">
                              <div class="runtime-replace-cell-content">
                                <Input
                                  class="runtime-replace-cell-input"
                                  size="sm"
                                  flex={1}
                                  minWidth={0}
                                  value={entry.value}
                                  onChange={event =>
                                    updateEntry(index(), {
                                      value: event.currentTarget.value,
                                    })
                                  }
                                />
                              </div>
                            </td>
                            <td style={tdNarrowStyle}>
                              <button
                                type="button"
                                class="runtime-replace-delete-button"
                                aria-label={locale.get(
                                  "SETTING_CUSTOM_ENVIRONMENT_VARIABLES_DELETE_ROW"
                                )}
                                onClick={() =>
                                  setEntries(previous =>
                                    previous.filter((_, i) => i != index())
                                  )
                                }
                              >
                                <span
                                  class="runtime-replace-trash-icon"
                                  aria-hidden="true"
                                />
                              </button>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </Box>
            <Button
              mt="$3"
              size="sm"
              variant="ghost"
              onClick={() =>
                setEntries(previous => [...previous, emptyEntry()])
              }
            >
              {locale.get("SETTING_CUSTOM_ENVIRONMENT_VARIABLES_ADD_ROW")}
            </Button>
          </Show>
        </SettingSwitch>
      );
    },
  ] as const;
}

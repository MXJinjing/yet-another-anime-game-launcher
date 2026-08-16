import {
  Box,
  Button,
  Checkbox,
  HStack,
  Input,
  Tooltip,
} from "@hope-ui/solid";
import { isAbsolute, relative, resolve as resolvePath } from "path-browserify";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Locale } from "@locale";
import { log } from "@logging/logger";
import { assertValueDefined } from "@runtime/assertions";
import { getKey, setKey } from "@runtime/storage";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";
import {
  isSafeTargetRelativePath,
  revertMhypBaseReplacement,
} from "../../../mhy/patch";
import type { RuntimeReplacementEntry } from "../../../mhy/patch";

declare module "@config/config-def" {
  interface Config {
    mhypBaseReplacementPath: string;
    workaround4: boolean;
    runtimeReplacementsEnabled: boolean;
    runtimeReplacements: RuntimeReplacementEntry[];
  }
}

type StoredRuntimeReplacements = {
  enabled: boolean;
  entries: RuntimeReplacementEntry[];
};

const RUNTIME_REPLACEMENTS_KEY = "config_runtime_replacements";
const LEGACY_PATH_KEY = "config_mhypbase_replacement_path";
const LEGACY_TOGGLE_KEY = "config_workaround4";

function isRuntimeReplacementEntry(
  value: unknown
): value is RuntimeReplacementEntry {
  if (!value || typeof value != "object") return false;
  const entry = value as Partial<RuntimeReplacementEntry>;
  return (
    typeof entry.enabled == "boolean" &&
    typeof entry.targetRelativePath == "string" &&
    typeof entry.replacementPath == "string"
  );
}

function isStoredRuntimeReplacements(
  value: unknown
): value is StoredRuntimeReplacements {
  if (!value || typeof value != "object") return false;
  const stored = value as Partial<StoredRuntimeReplacements>;
  return typeof stored.enabled == "boolean" && Array.isArray(stored.entries);
}

function emptyEntry(): RuntimeReplacementEntry {
  return { enabled: true, targetRelativePath: "", replacementPath: "" };
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function samePath(a: string, b: string): boolean {
  return (
    trimTrailingSlash(resolvePath(a)) === trimTrailingSlash(resolvePath(b))
  );
}

function rowIsInvalid(
  entry: RuntimeReplacementEntry,
  entries: RuntimeReplacementEntry[],
  gameDir: string
): boolean {
  if (!entry.enabled) return false;
  const target = entry.targetRelativePath.trim();
  if (
    !target ||
    !gameDir.trim() ||
    !isSafeTargetRelativePath(target, gameDir)
  ) {
    return true;
  }
  if (!entry.replacementPath.trim()) return true;
  const normalizedTarget = target.replaceAll("\\", "/");
  const replacement = entry.replacementPath.trim();
  const replacementPath = isAbsolute(replacement)
    ? resolvePath(replacement)
    : resolvePath(gameDir, replacement);
  if (samePath(replacementPath, resolvePath(gameDir, normalizedTarget))) {
    return true;
  }
  return (
    entries.filter(
      e =>
        e.enabled &&
        e.targetRelativePath.trim().replaceAll("\\", "/") == normalizedTarget
    ).length > 1
  );
}

export default async function ({
  locale,
  config,
  gameInstallDir,
}: {
  locale: Locale;
  config: Partial<Config>;
  gameInstallDir?: () => string;
}) {
  let stored: StoredRuntimeReplacements = { enabled: false, entries: [] };
  try {
    const parsed = JSON.parse(await getKey(RUNTIME_REPLACEMENTS_KEY));
    if (isStoredRuntimeReplacements(parsed)) {
      stored = {
        enabled: parsed.enabled,
        entries: parsed.entries
          .filter(isRuntimeReplacementEntry)
          .map(entry => ({ ...entry })),
      };
    }
  } catch {
    let legacyPath = "";
    let legacyToggle = false;
    try {
      legacyPath = await getKey(LEGACY_PATH_KEY);
    } catch {
      legacyPath = "";
    }
    try {
      legacyToggle = (await getKey(LEGACY_TOGGLE_KEY)) == "true";
    } catch {
      legacyToggle = false;
    }
    if (legacyPath) {
      stored = {
        enabled: legacyToggle,
        entries: [
          {
            enabled: legacyToggle,
            targetRelativePath: "mhypbase.dll",
            replacementPath: legacyPath,
          },
        ],
      };
    } else {
      stored = { enabled: legacyToggle, entries: [] };
    }
  }

  config.mhypBaseReplacementPath = stored.entries[0]?.replacementPath ?? "";
  config.workaround4 = stored.enabled;
  config.runtimeReplacementsEnabled = stored.enabled;
  config.runtimeReplacements = stored.entries.map(entry => ({ ...entry }));

  const [enabled, setEnabled] = createSignal(stored.enabled);
  const [entries, setEntries] = createSignal(
    stored.entries.map(entry => ({ ...entry }))
  );
  let saveQueue: Promise<void> = Promise.resolve();

  async function onSave(apply: boolean) {
    assertValueDefined(config.runtimeReplacementsEnabled);
    assertValueDefined(config.runtimeReplacements);
    assertValueDefined(config.mhypBaseReplacementPath);
    assertValueDefined(config.workaround4);
    const nextEnabled = enabled();
    const nextEntries = entries();
    if (!apply) {
      setEnabled(config.runtimeReplacementsEnabled);
      setEntries(config.runtimeReplacements.map(entry => ({ ...entry })));
      return NOOP;
    }
    config.runtimeReplacementsEnabled = nextEnabled;
    config.runtimeReplacements = nextEntries.map(entry => ({ ...entry }));
    config.mhypBaseReplacementPath =
      nextEntries.find(entry => entry.enabled)?.replacementPath ??
      nextEntries[0]?.replacementPath ??
      "";
    config.workaround4 =
      nextEnabled && nextEntries.some(entry => entry.enabled);
    saveQueue = saveQueue
      .then(async () => {
        await setKey(
          RUNTIME_REPLACEMENTS_KEY,
          JSON.stringify({ enabled: nextEnabled, entries: nextEntries })
        );
      })
      .catch(() => undefined);
    return NOOP;
  }

  createEffect(() => {
    enabled();
    entries();
    void onSave(true);
  });

  function updateEntry(index: number, patch: Partial<RuntimeReplacementEntry>) {
    setEntries(previous =>
      previous.map((entry, i) => (i == index ? { ...entry, ...patch } : entry))
    );
  }

  async function pickReplacement(index: number) {
    const picked = await Neutralino.os.showOpenDialog(
      locale.get("SETTING_WORKAROUND4_PICK"),
      {
        filter: [{ name: "All files", extensions: ["*"] }],
      }
    );
    if (Array.isArray(picked) && picked.length > 0) {
      updateEntry(index, { replacementPath: picked[0] });
    }
  }

  async function pickTarget(index: number) {
    const dir = gameInstallDir?.();
    if (!dir) return;
    const picked = await Neutralino.os.showOpenDialog(
      locale.get("SETTING_WORKAROUND4_PICK"),
      {
        filter: [{ name: "All files", extensions: ["*"] }],
      }
    );
    if (Array.isArray(picked) && picked.length > 0) {
      const selected = picked[0];
      const rel = relative(resolvePath(dir), resolvePath(selected));
      const inside = rel != "" && !rel.startsWith("..") && !isAbsolute(rel);
      updateEntry(index, {
        targetRelativePath: inside ? rel : selected,
      });
    }
  }

  async function restoreAll() {
    if (!gameInstallDir) return;
    try {
      await revertMhypBaseReplacement(gameInstallDir());
      await log(
        "RUNTIME_REPLACEMENTS: restore button — restored original files from backups"
      );
    } catch (e) {
      await log(`RUNTIME_REPLACEMENTS: restore failed — ${String(e)}`);
    }
  }

  return [
    function UI() {
      const gameDir = gameInstallDir?.() ?? "";
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
          id="runtime-replacements"
          label="运行期间替换文件"
          description="启动前把选中的文件覆盖到游戏目录内的目标文件，游戏退出后自动还原备份。"
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
                    <col />
                    <col />
                    <col style={{ width: "44px" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        class="runtime-replace-table-header"
                        style={thNarrowStyle}
                      >
                        启用
                      </th>
                      <th
                        class="runtime-replace-table-header"
                        style={thStyle}
                      >
                        待替换文件
                      </th>
                      <th
                        class="runtime-replace-table-header"
                        style={thStyle}
                      >
                        替换文件
                      </th>
                      <th
                        class="runtime-replace-table-header"
                        style={thNarrowStyle}
                      >
                        删除
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={entries()}>
                      {(entry, index) => {
                        const invalid = rowIsInvalid(entry, entries(), gameDir);
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
                                  id={`runtime-replacements-row-${index()}`}
                                  aria-label={`启用第 ${index() + 1} 行替换`}
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
                                invalid ? " runtime-replace-edit-cell-invalid" : ""
                              }`}
                            >
                              <HStack
                                class="runtime-replace-cell-content"
                                spacing="$1"
                                w="100%"
                              >
                                <Input
                                  class="runtime-replace-cell-input"
                                  size="sm"
                                  flex={1}
                                  minWidth={0}
                                  invalid={invalid}
                                  value={entry.targetRelativePath}
                                  onChange={e =>
                                    updateEntry(index(), {
                                      targetRelativePath: e.currentTarget.value,
                                    })
                                  }
                                />
                                <Tooltip
                                  label={locale.get(
                                    "SETTING_RUNTIME_REPLACEMENT_PICK_TOOLTIP"
                                  )}
                                >
                                  <button
                                    type="button"
                                    class="runtime-replace-icon-button"
                                    aria-label="选择待替换文件"
                                    onClick={() => pickTarget(index())}
                                  >
                                    <span class="runtime-replace-file-icon" aria-hidden="true" />
                                  </button>
                                </Tooltip>
                              </HStack>
                            </td>
                            <td
                              class={`runtime-replace-edit-cell${
                                invalid ? " runtime-replace-edit-cell-invalid" : ""
                              }`}
                            >
                              <HStack
                                class="runtime-replace-cell-content"
                                spacing="$1"
                                w="100%"
                              >
                                <Input
                                  class="runtime-replace-cell-input"
                                  size="sm"
                                  flex={1}
                                  minWidth={0}
                                  invalid={invalid}
                                  value={entry.replacementPath}
                                  onChange={e =>
                                    updateEntry(index(), {
                                      replacementPath: e.currentTarget.value,
                                    })
                                  }
                                />
                                <Tooltip
                                  label={locale.get(
                                    "SETTING_RUNTIME_REPLACEMENT_PICK_TOOLTIP"
                                  )}
                                >
                                  <button
                                    type="button"
                                    class="runtime-replace-icon-button"
                                    aria-label="选择替换文件"
                                    onClick={() => pickReplacement(index())}
                                  >
                                    <span class="runtime-replace-file-icon" aria-hidden="true" />
                                  </button>
                                </Tooltip>
                              </HStack>
                            </td>
                            <td style={tdNarrowStyle}>
                              <button
                                type="button"
                                class="runtime-replace-delete-button"
                                aria-label="删除此行"
                                onClick={() =>
                                  setEntries(previous =>
                                    previous.filter((_, i) => i != index())
                                  )
                                }
                              >
                                <span class="runtime-replace-trash-icon" aria-hidden="true" />
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
            <HStack mt="$3" spacing="$2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEntries(previous => [...previous, emptyEntry()])
                }
              >
                添加行
              </Button>
              <Button size="sm" variant="ghost" onClick={restoreAll}>
                立即还原所有备份
              </Button>
            </HStack>
          </Show>
        </SettingSwitch>
      );
    },
  ] as const;
}

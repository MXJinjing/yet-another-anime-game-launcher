import { Button, Checkbox, Input } from "@hope-ui/solid";
import { For } from "solid-js";
import type { Accessor } from "solid-js";
import { Locale } from "@locale";
import { isValidHostDomain } from "@system/hosts-validation";
import type { BlockHostRule } from "./block-hosts";

export function BlockHostsTable(props: {
  locale: Locale;
  entries: Accessor<BlockHostRule[]>;
  onEntriesChange: (entries: BlockHostRule[]) => void;
  onReset: () => void;
}) {
  function updateEntry(index: number, patch: Partial<BlockHostRule>) {
    props.onEntriesChange(
      props
        .entries()
        .map((entry, entryIndex) =>
          entryIndex == index ? { ...entry, ...patch } : entry
        )
    );
  }

  function deleteEntry(index: number) {
    props.onEntriesChange(
      props.entries().filter((_, entryIndex) => entryIndex != index)
    );
  }

  function addEntry() {
    props.onEntriesChange([...props.entries(), { enabled: true, domain: "" }]);
  }

  return (
    <>
      <div class="runtime-replace-table-shell block-hosts-table-shell">
        <table
          class="runtime-replace-table block-hosts-table"
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
            <col style={{ width: "44px" }} />
          </colgroup>
          <thead>
            <tr>
              <th
                class="runtime-replace-table-header"
                style={headerStyle(true)}
              >
                {props.locale.get("SETTING_BLOCK_NET_ENABLED")}
              </th>
              <th
                class="runtime-replace-table-header"
                style={headerStyle(false)}
              >
                {props.locale.get("SETTING_BLOCK_NET_URL")}
              </th>
              <th
                class="runtime-replace-table-header"
                style={headerStyle(true)}
              >
                {props.locale.get("SETTING_BLOCK_NET_DELETE")}
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={props.entries()}>
              {(entry, index) => {
                const invalid =
                  entry.enabled && !isValidHostDomain(entry.domain.trim());
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
                      style={narrowCellStyle}
                    >
                      <div class="runtime-replace-enable-control">
                        <Checkbox
                          id={`block-net-entry-${index()}`}
                          aria-label={`${props.locale.get(
                            "SETTING_BLOCK_NET_ENABLED"
                          )} ${index() + 1}`}
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
                      <div class="runtime-replace-cell-content block-hosts-cell-content">
                        <Input
                          class="runtime-replace-cell-input"
                          size="sm"
                          flex={1}
                          minWidth={0}
                          invalid={invalid}
                          value={entry.domain}
                          placeholder="example.com"
                          onChange={event =>
                            updateEntry(index(), {
                              domain: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                    </td>
                    <td style={narrowCellStyle}>
                      <button
                        type="button"
                        class="runtime-replace-delete-button"
                        aria-label={`${props.locale.get(
                          "SETTING_BLOCK_NET_DELETE"
                        )} ${index() + 1}`}
                        onClick={() => deleteEntry(index())}
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
      <div class="block-hosts-table-actions">
        <Button size="sm" variant="ghost" onClick={addEntry}>
          {props.locale.get("SETTING_BLOCK_NET_ADD")}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onReset}>
          {props.locale.get("SETTING_PREFERRED_MAX_FPS_RESET")}
        </Button>
      </div>
    </>
  );
}

const narrowCellStyle = {
  padding: "6px 4px",
  verticalAlign: "middle",
  textAlign: "center",
  borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
} as const;

function headerStyle(narrow: boolean) {
  return {
    padding: narrow ? "8px 2px" : "8px 10px",
    textAlign: narrow ? "center" : "left",
    color: "rgba(255, 255, 255, 0.52)",
    fontSize: "12px",
    fontWeight: 700,
    borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
    whiteSpace: "nowrap",
  } as const;
}

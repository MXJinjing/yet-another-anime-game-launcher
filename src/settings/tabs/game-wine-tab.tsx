import { Show } from "solid-js";
import { Locale } from "../../locale";
import { AppSelect } from "../../components/app-select";
import { SettingsTabPanel } from "./settings-tab-panel";

export function GameWineTab(props: {
  locale: Locale;
  wineTag?: () => string;
  wineOptions?: { tag: string; displayName: string }[];
  onWineTagChange?: (tag: string) => void;
}) {
  return (
    <SettingsTabPanel>
      <>
        <Show
          when={props.wineTag && props.wineOptions && props.onWineTagChange}
        >
          <div class="hoyoplay-setting-row">
            <span>{props.locale.get("SETTING_GAME_WINE")}</span>
            <AppSelect
              value={props.wineTag?.() ?? ""}
              onChange={tag => props.onWineTagChange?.(tag)}
              width={280}
              options={(props.wineOptions ?? []).map(item => ({
                value: item.tag,
                label:
                  item.tag === "__shared__"
                    ? props.locale.get("SETTING_GAME_WINE_SHARED")
                    : item.displayName,
              }))}
            />
          </div>
          <p class="hoyoplay-settings-muted">
            {props.locale.get("SETTING_GAME_WINE_DESC")}
          </p>
        </Show>
      </>
    </SettingsTabPanel>
  );
}

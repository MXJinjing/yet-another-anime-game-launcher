import { JSXElement } from "solid-js";
import { Locale } from "../../locale";
import {
  WineEnvironmentActions,
  WineEnvironmentInfo,
} from "../../components/wine-environment";
import { Wine } from "../../wine";
import { SettingsTabPanel } from "./settings-tab-panel";

export function WineTab(props: {
  locale: Locale;
  wine: Wine;
  wineInstalled: () => boolean;
  winePrefix: string;
  GlobalWineDistroConfig: () => JSXElement;
  WineDistroConfig: () => JSXElement;
  onResetWineEnv: () => Promise<void>;
  wineActionDisabled: () => boolean;
}) {
  return (
    <SettingsTabPanel>
      <>
        <props.GlobalWineDistroConfig />
        <WineEnvironmentInfo
          locale={props.locale}
          winePrefix={props.winePrefix}
          wineInstalled={props.wineInstalled}
        />
        <props.WineDistroConfig />
        <WineEnvironmentActions
          locale={props.locale}
          wine={props.wine}
          winePrefix={props.winePrefix}
          wineInstalled={props.wineInstalled}
          wineActionDisabled={props.wineActionDisabled}
          onResetWineEnv={props.onResetWineEnv}
        />
      </>
    </SettingsTabPanel>
  );
}

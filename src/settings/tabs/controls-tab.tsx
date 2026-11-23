import { Divider } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { SettingsTabPanel } from "./settings-tab-panel";

/**
 * Input-related Wine preferences that apply to every game: keyboard modifier
 * mapping and the game controller workaround.
 */
export function ControlsTab(props: {
  LeftCmdConfig: () => JSXElement;
  GameControllerFixConfig: () => JSXElement;
}) {
  return (
    <SettingsTabPanel>
      <>
        <props.LeftCmdConfig />
        <Divider />
        <props.GameControllerFixConfig />
      </>
    </SettingsTabPanel>
  );
}

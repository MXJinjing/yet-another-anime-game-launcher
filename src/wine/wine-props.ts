export type WineProps = {
  retina: boolean;
  leftCmd: boolean;
  gameControllerFix?: boolean;
};

/**
 * Registry script applied before a game starts. Besides the display options it
 * configures `winebus`: disabling the hidraw backend makes Wine talk to game
 * controllers through SDL instead, which fixes controllers that macOS hands
 * over in a way the raw HID path cannot use.
 *
 * The SDL backend is only enabled together with the fix, so users who never
 * turn the option on keep the stock winebus configuration.
 */
export function buildWinePropsScript(props: WineProps): string {
  const controllerFix = props.gameControllerFix
    ? `reg add "HKLM\\System\\CurrentControlSet\\Services\\winebus" /v DisableHidraw /t REG_DWORD /d 1 /f
reg add "HKLM\\System\\CurrentControlSet\\Services\\winebus" /v "Enable SDL" /t REG_DWORD /d 1 /f
`
    : "";

  return `@echo off
cd "%~dp0"
reg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v RetinaMode /t REG_SZ /d ${
    props.retina ? "y" : "n"
  } /f
reg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v LeftCommandIsCtrl /t REG_SZ /d ${
    props.leftCmd ? "y" : "n"
  } /f
${controllerFix}exit /b 0
`;
}

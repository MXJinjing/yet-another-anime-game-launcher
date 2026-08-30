import { render } from "solid-js/web";
import { createApp } from "./app";
import { HopeProvider, NotificationsProvider } from "@hope-ui/solid";
import { amber } from "@radix-ui/colors";

import { fatal } from "./runtime";
import {
  getBootDetail,
  getBootText,
  reportBootProgress,
} from "./boot-progress";
import { getChannelBootIcon } from "./boot-icon";
import { installInputEditingShortcuts } from "./input-editing-shortcuts";
import {
  CURRENT_YAAGL_CHANNEL,
  CURRENT_YAAGL_VERSION,
} from "./constants/version";

function createPlates(
  tag: string,
  color: Record<string, string>,
  colortag: string
) {
  return Object.fromEntries(
    new Array(12)
      .fill(1)
      .map(
        (_, i) =>
          [`${tag}${i + 1}`, color[`${colortag}${i + 1}`] as string] as const
      )
  );
}

if (typeof Neutralino == "undefined") {
  console.log(`This app doesn't work on browser.`);
} else {
  Neutralino.init();
  installInputEditingShortcuts();
  if (import.meta.env.PROD) {
    document.addEventListener("contextmenu", event => event.preventDefault());
  }
  const bootIcon = getChannelBootIcon(
    import.meta.env.YAAGL_CHANNEL_CLIENT || "hk4ecn"
  );
  const disposeBoot = render(
    () => (
      <div class="app-boot">
        <img class="app-boot-icon" src={bootIcon} alt="" />
        <div class="app-boot-main">
          <div class="app-boot-spinner" />
          <div class="app-boot-text">
            {getBootText()}
            {getBootDetail()}
          </div>
        </div>
        <div class="app-boot-version">
          Version: {CURRENT_YAAGL_VERSION}({CURRENT_YAAGL_CHANNEL})
        </div>
      </div>
    ),
    document.getElementById("root") as HTMLElement
  );
  Neutralino.window.show();
  reportBootProgress("BOOT_INITIALIZING", 0);
  createApp()
    .then(UI => {
      reportBootProgress("BOOT_ENTERING_MAIN_SCREEN", 100);
      // Remove the startup loading screen before mounting the real UI.
      // Solid's render() appends when the container is not empty, so without
      // this the boot screen (its spinner/text) stays in the DOM behind the
      // app and shows through transparent overlays such as the update screen.
      disposeBoot();
      render(
        () => (
          <HopeProvider
            config={{
              lightTheme: {
                colors: {
                  ...createPlates("primary", amber, "amber"), // 兔兔伯爵，出击
                },
              },
            }}
          >
            <NotificationsProvider>
              <UI />
            </NotificationsProvider>
          </HopeProvider>
        ),
        document.getElementById("root") as HTMLElement
      );
      Neutralino.window.show();
    })
    .catch(error => {
      reportBootProgress("BOOT_INITIALIZATION_FAILED", 100, String(error));
      fatal(error);
    });
}

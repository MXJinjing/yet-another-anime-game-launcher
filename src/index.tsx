import { render } from "solid-js/web";
import { createApp } from "./app";
import { HopeProvider, NotificationsProvider } from "@hope-ui/solid";
import { amber } from "@radix-ui/colors";

import { fatal } from "./runtime";
import {
  getBootProgress,
  getBootText,
  reportBootProgress,
} from "./boot-progress";

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
  if (import.meta.env.PROD) {
    document.addEventListener("contextmenu", event => event.preventDefault());
  }
  render(
    () => (
      <div class="app-boot">
        <div class="app-boot-main">
          <div class="app-boot-spinner" />
          <div class="app-boot-text">{getBootText()}</div>
          <div class="app-boot-percent">{Math.round(getBootProgress())}%</div>
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

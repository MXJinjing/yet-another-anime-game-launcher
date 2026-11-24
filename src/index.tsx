import { render } from "solid-js/web";
import { HopeProvider, NotificationsProvider } from "@hope-ui/solid";
import { amber } from "@radix-ui/colors";
import { fatal, FatalError, isFatalError } from "./runtime";
import { log } from "./logging/logger";
import {
  getBootDetail,
  getBootText,
  reportBootProgress,
} from "./boot-progress";
import { getChannelBootIcon } from "./boot-icon";
import { createBootPerformance } from "./boot-performance";
import { installInputEditingShortcuts } from "./input-editing-shortcuts";
import {
  CURRENT_YAAGL_CHANNEL,
  CURRENT_YAAGL_VERSION,
} from "./constants/version";
import { isLogWindowArgs } from "./logging/log-window-protocol";
import { installTitleBarDrag } from "./platform/neutralino/window-drag";

function launchArgs() {
  return typeof NL_ARGS === "undefined" ? [] : NL_ARGS;
}

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
} else if (isLogWindowArgs(launchArgs())) {
  // This process is only the log window. Do not load the launcher graph.
  Neutralino.init();
  installInputEditingShortcuts();
  void Neutralino.events.on("ready", () => {
    void import("./logging/log-window-app")
      .then(module => module.startLogWindow())
      .catch(error => {
        console.error(error);
      });
  });
} else {
  const bootPerformance = createBootPerformance(
    import.meta.env.DEV && import.meta.env.YAAGL_BOOT_PERF === "1"
  );
  bootPerformance.mark("frontend-script-start");
  void Neutralino.events.on("ready", () => {
    bootPerformance.mark("neutralino-ready");
  });
  Neutralino.init();
  bootPerformance.mark("neutralino-init-called");
  installInputEditingShortcuts();
  // Keep the same launcher drag band without a native overlay on the log tabs.
  installTitleBarDrag();
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
  bootPerformance.mark("window-shown");
  reportBootProgress("BOOT_INITIALIZING", 0);
  // Loaded after the branch check so the log-window process does not evaluate
  // the launcher, Wine, or download graph while this module is parsed.
  void import("./app")
    .then(({ createApp }) => createApp(bootPerformance))
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
            <NotificationsProvider zIndex={2100}>
              <UI />
            </NotificationsProvider>
          </HopeProvider>
        ),
        document.getElementById("root") as HTMLElement
      );
      bootPerformance.mark("main-ui-mounted");
      requestAnimationFrame(() => {
        bootPerformance.mark("main-ui-first-frame");
        void bootPerformance.flush();
      });
      Neutralino.window.show();
    })
    .catch(async error => {
      reportBootProgress("BOOT_INITIALIZATION_FAILED", 100, String(error));
      console.error(error);
      try {
        await log(`Boot failed: ${String(error)}`);
      } catch {
        // Logging can fail when boot infrastructure (Neutralino) is broken;
        // the message box below is the last-resort report.
      }
      // createApp failing means there is no UI to mount, which is the one
      // remaining fatal boot path. Preserve an existing FatalError and wrap
      // unknown failures so the original cause stays attached.
      await fatal(
        isFatalError(error) ? error : new FatalError(String(error), error)
      );
    });
}

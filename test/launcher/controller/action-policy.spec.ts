import { describe, expect, it } from "vitest";
import {
  resolveIntegrityAction,
  resolvePrimaryLauncherAction,
} from "@src/launcher/controller/action-policy";

const idleDownload = {
  active: false,
  actionPending: false,
  pauseRequested: false,
  paused: false,
  canPause: false,
  canResume: false,
  canCancel: false,
};

describe("launcher primary-action policy", () => {
  it("prioritizes download controls and refuses unavailable controls", () => {
    expect(
      resolvePrimaryLauncherAction({
        download: { ...idleDownload, active: true, canPause: true },
        gameTaskBusy: false,
        wineInstalled: true,
        installState: "INSTALLED",
        updateRequired: false,
        runtimeReady: true,
      })
    ).toBe("pause-download");
    expect(
      resolvePrimaryLauncherAction({
        download: {
          ...idleDownload,
          active: true,
          paused: true,
          canResume: false,
        },
        gameTaskBusy: false,
        wineInstalled: true,
        installState: "INSTALLED",
        updateRequired: false,
        runtimeReady: true,
      })
    ).toBe("none");
  });

  it("selects environment initialization, installation, update, and launch", () => {
    const base = { download: idleDownload, gameTaskBusy: false };
    expect(
      resolvePrimaryLauncherAction({
        ...base,
        wineInstalled: false,
        installState: "INSTALLED",
        updateRequired: false,
        runtimeReady: true,
      })
    ).toBe("initialize-wine");
    expect(
      resolvePrimaryLauncherAction({
        ...base,
        wineInstalled: true,
        installState: "NOT_INSTALLED",
        updateRequired: false,
        runtimeReady: true,
      })
    ).toBe("install");
    expect(
      resolvePrimaryLauncherAction({
        ...base,
        wineInstalled: true,
        installState: "INSTALLED",
        updateRequired: true,
        runtimeReady: true,
      })
    ).toBe("update");
    expect(
      resolvePrimaryLauncherAction({
        ...base,
        wineInstalled: true,
        installState: "INSTALLED",
        updateRequired: false,
        runtimeReady: true,
      })
    ).toBe("launch");
    expect(
      resolvePrimaryLauncherAction({
        ...base,
        wineInstalled: true,
        installState: "INSTALLED",
        updateRequired: false,
        runtimeReady: false,
      })
    ).toBe("continue-install");
  });

  it("prompts for an update before integrity checking when necessary", () => {
    expect(resolveIntegrityAction(true)).toBe("prompt-update");
    expect(resolveIntegrityAction(false)).toBe("check-integrity");
  });
});

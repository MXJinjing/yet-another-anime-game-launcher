import { describe, expect, it } from "vitest";
import {
  createApplicationWindowTracker,
  parseNativeWineProcesses,
  parseWindowProbeOutput,
  type NativeWineWindow,
} from "@wine/native-window-state";

function window(overrides: Partial<NativeWineWindow> = {}): NativeWineWindow {
  return {
    pid: "100",
    windowId: 42,
    layer: 0,
    onScreen: true,
    x: 0,
    y: 0,
    width: 1512,
    height: 982,
    alpha: 1,
    title: "",
    ...overrides,
  };
}

describe("native Wine window state", () => {
  it("parses only native commands that begin with a Windows executable", () => {
    expect(
      parseNativeWineProcesses(
        " 100 Z:\\\\Games\\\\Target Game.exe -screen-fullscreen 1\n" +
          " 101 C:\\\\windows\\\\system32\\\\steam.exe Z:\\\\Games\\\\Target Game.exe\n" +
          " 102 /bin/sh -c wine Z:\\\\Games\\\\Target Game.exe\n"
      )
    ).toEqual([
      {
        pid: "100",
        name: "target game.exe",
        command: "Z:\\\\Games\\\\Target Game.exe -screen-fullscreen 1",
      },
      {
        pid: "101",
        name: "steam.exe",
        command:
          "C:\\\\windows\\\\system32\\\\steam.exe Z:\\\\Games\\\\Target Game.exe",
      },
    ]);
  });

  it("parses detailed native windows emitted by the window probe", () => {
    expect(
      parseWindowProbeOutput(
        "WINDOW\t100\t42\t0\t1\t10.500\t20.250\t1512.000\t982.000\t1.000000\tThe Anime Game\n" +
          "not-a-window\n"
      )
    ).toEqual([
      {
        pid: "100",
        windowId: 42,
        layer: 0,
        onScreen: true,
        x: 10.5,
        y: 20.25,
        width: 1512,
        height: 982,
        alpha: 1,
        title: "The Anime Game",
      },
    ]);
  });

  it("keeps a tracked application window alive while minimized", () => {
    const tracker = createApplicationWindowTracker();

    expect(tracker.update([window()]).hasApplicationWindow).toBe(true);
    expect(
      tracker.update([window({ onScreen: false })]).hasApplicationWindow
    ).toBe(true);
  });

  it("rejects the observed Wine exit residue", () => {
    const tracker = createApplicationWindowTracker();
    tracker.update([window()]);

    const result = tracker.update([
      window({ layer: 26, onScreen: false }),
      window({ windowId: 41, onScreen: false, width: 500, height: 500 }),
      window({ windowId: 43, onScreen: false, width: 1512, height: 33 }),
    ]);

    expect(result).toEqual({
      hasApplicationWindow: false,
      trackedWindowIds: [42],
    });
  });

  it("does not learn an off-screen Wine helper window as the game window", () => {
    const tracker = createApplicationWindowTracker();

    expect(
      tracker.update([
        window({ windowId: 41, onScreen: false, width: 500, height: 500 }),
      ])
    ).toEqual({ hasApplicationWindow: false, trackedWindowIds: [] });
  });

  it("keeps an on-screen layer transition alive", () => {
    const tracker = createApplicationWindowTracker();
    tracker.update([window()]);

    expect(
      tracker.update([window({ layer: 26, onScreen: true })])
        .hasApplicationWindow
    ).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@src/components/app-modal", () => ({
  AppModal: vi.fn((props: Record<string, unknown>) => props),
  AppModalButton: vi.fn((props: Record<string, unknown>) => props),
}));

import { AppModal, AppModalButton } from "@src/components/app-modal";
import { GameCrashModal } from "@src/modals/game-crash-modal";
import {
  LaunchErrorModal,
  RuntimeReplacementErrorModal,
} from "@src/modals/runtime-replacement-error-modal";

const appModal = vi.mocked(AppModal);
const appModalButton = vi.mocked(AppModalButton);

const documentStub = {
  createElement: () => ({
    innerHTML: "",
    content: {
      firstChild: {
        cloneNode: () => ({}),
      },
    },
  }),
};

const locale = {
  get: (key: string) => key,
} as never;

function latestModalProps() {
  const call = appModal.mock.lastCall;
  expect(call).toBeDefined();
  return call![0] as {
    title: unknown;
    children: unknown;
    footer: unknown;
  };
}

describe("LaunchErrorModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("document", documentStub);
  });

  it("renders details and wires cancel/settings actions", () => {
    const onCancel = vi.fn();
    const onOpenSettings = vi.fn();

    LaunchErrorModal({
      opened: true,
      title: "Launch error",
      message: "The launch could not continue.",
      details: "replacement file does not exist",
      cancelLabel: "Cancel",
      settingsLabel: "Game settings",
      onCancel,
      onOpenSettings,
    });

    const props = latestModalProps();
    expect(props.title).toBe("Launch error");
    void props.footer;
    expect(props.children).toBeDefined();
    expect(appModalButton).toHaveBeenCalledTimes(2);

    const [cancelButton, settingsButton] = appModalButton.mock.calls.map(
      ([buttonProps]) => buttonProps as Record<string, unknown>
    );
    expect(cancelButton.children).toBe("Cancel");
    expect(cancelButton.onClick).toBe(onCancel);
    expect(settingsButton.children).toBe("Game settings");
    expect(settingsButton.onClick).toBe(onOpenSettings);
  });

  it("does not add an error-details block when details are omitted", () => {
    LaunchErrorModal({
      opened: false,
      title: "Game crashed",
      message: "Check the game settings.",
      cancelLabel: "Ignore",
      settingsLabel: "Game settings",
      onCancel: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    const children = latestModalProps().children as unknown[];
    expect(children[1]).toEqual(expect.any(Function));
    expect((children[1] as () => unknown)()).toBeNull();
  });
});

describe("modal wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("document", documentStub);
  });

  it("keeps runtime replacement error details and localized labels", () => {
    RuntimeReplacementErrorModal({
      opened: true,
      locale,
      details: "替换文件不存在",
      onCancel: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    const props = latestModalProps();
    expect(props.title).toBe("RUNTIME_REPLACEMENT_ERROR");
    void props.footer;
    expect(appModalButton.mock.calls[0][0].children).toBe("SETTING_CANCEL");
    expect(appModalButton.mock.calls[1][0].children).toBe(
      "GAME_CRASHED_SETTINGS"
    );
  });

  it("uses the shared launch error modal for game crashes", () => {
    const onIgnore = vi.fn();
    const onOpenSettings = vi.fn();

    GameCrashModal({
      opened: true,
      locale,
      onIgnore,
      onOpenSettings,
    });

    const props = latestModalProps();
    expect(props.title).toBe("GAME_CRASHED");
    void props.footer;
    expect(appModalButton.mock.calls[0][0].children).toBe(
      "GAME_CRASHED_IGNORE"
    );
    expect(appModalButton.mock.calls[0][0].onClick).toBe(onIgnore);
    expect(appModalButton.mock.calls[1][0].children).toBe(
      "GAME_CRASHED_SETTINGS"
    );
    expect(appModalButton.mock.calls[1][0].onClick).toBe(onOpenSettings);
  });
});

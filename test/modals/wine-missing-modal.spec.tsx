import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@src/components/app-modal", () => ({
  AppModal: vi.fn((props: Record<string, unknown>) => props),
  AppModalButton: vi.fn((props: Record<string, unknown>) => props),
}));

import { createRoot } from "solid-js";
import { AppModal, AppModalButton } from "@src/components/app-modal";
import { WineMissingModal } from "@src/modals/wine-missing-modal";

// Solid compiles the modal markup into template clones, which need a document.
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

const appModal = vi.mocked(AppModal);
const appModalButton = vi.mocked(AppModalButton);

const localeGet = vi.fn((key: string) => key);
const localeFormat = vi.fn(
  (key: string, values: string[]) => `${key}:${values.join("|")}`
);
const locale = { get: localeGet, format: localeFormat } as never;

/** Signals need an owner, otherwise Solid warns on every render. */
function inRoot(run: () => void) {
  createRoot(dispose => {
    try {
      run();
    } finally {
      dispose();
    }
  });
}

/** Solid wraps JSX attribute values in lazy getters; read them to run them. */
function renderedProps() {
  const props = appModal.mock.lastCall?.[0] as unknown as {
    title: unknown;
    children: unknown;
    footer: unknown;
  };
  void props.children;
  void props.footer;
  return props;
}

function buttons() {
  return appModalButton.mock.calls.map(
    ([props]) => props as Record<string, unknown>
  );
}

afterEach(() => {
  // Avoid leaking the minimal document stub into suites that render Hope UI.
  vi.unstubAllGlobals();
});

describe("WineMissingModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("document", documentStub);
  });

  it("offers only cancel and a way into the Wine settings", () =>
    inRoot(() => {
      const onCancel = vi.fn();
      const onOpenSettings = vi.fn();

      WineMissingModal({
        locale,
        missing: "system",
        onCancel,
        onOpenSettings,
      });

      expect(renderedProps().title).toBe("WINE_MISSING_TITLE");
      expect(localeFormat).toHaveBeenCalledWith("WINE_MISSING_DESC", [
        "system",
      ]);

      const actions = buttons();
      expect(actions).toHaveLength(2);

      const [cancel, settings] = actions;
      expect(cancel.children).toBe("SETTING_CANCEL");
      expect(cancel.onClick).toBe(onCancel);

      expect(settings.children).toBe("WINE_MISSING_SETTINGS");
      expect(settings.variant).toBe("primary");
      (settings.onClick as () => void)();
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    }));

  it("does not offer a one-click install the user never confirmed", () =>
    inRoot(() => {
      WineMissingModal({
        locale,
        missing: "system",
        onCancel: vi.fn(),
        onOpenSettings: vi.fn(),
      });

      renderedProps();
      const labels = buttons().map(button => button.children);
      expect(labels).not.toContain("WINE_MISSING_DOWNLOAD");
      expect(labels).not.toContain("WINE_MISSING_USE");
    }));
});

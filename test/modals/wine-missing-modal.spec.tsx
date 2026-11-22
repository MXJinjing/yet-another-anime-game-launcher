import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@src/components/app-modal", () => ({
  AppModal: vi.fn((props: Record<string, unknown>) => props),
  AppModalButton: vi.fn((props: Record<string, unknown>) => props),
}));

vi.mock("@src/components/app-select", () => ({
  AppSelect: vi.fn((props: Record<string, unknown>) => props),
}));

import { createRoot } from "solid-js";
import { AppModal, AppModalButton } from "@src/components/app-modal";
import { AppSelect } from "@src/components/app-select";
import { WineMissingModal } from "@src/modals/wine-missing-modal";
import type { WineDistribution } from "@src/wine";

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
const appSelect = vi.mocked(AppSelect);

const distro = (id: string): WineDistribution =>
  ({
    id,
    displayName: id.toUpperCase(),
    remoteUrl: "",
    attributes: {},
  } as WineDistribution);

const locale = {
  get: (key: string) => key,
  format: (key: string, values: string[]) => `${key}:${values.join("|")}`,
} as never;

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

  it("offers cancel, download and reuse of the only installed Wine", () =>
    inRoot(() => {
      const onCancel = vi.fn();
      const onDownloadBuiltin = vi.fn();
      const onUseInstalled = vi.fn();

      WineMissingModal({
        locale,
        missing: "system",
        installed: [distro("builtin")],
        onCancel,
        onDownloadBuiltin,
        onUseInstalled,
      });

      expect(renderedProps().title).toBe("WINE_MISSING_TITLE");
      const [cancel, download, use] = buttons();
      expect(cancel.children).toBe("SETTING_CANCEL");
      expect(cancel.onClick).toBe(onCancel);
      expect(download.children).toBe("WINE_MISSING_DOWNLOAD");
      expect(download.onClick).toBe(onDownloadBuiltin);
      expect(use.children).toBe("WINE_MISSING_USE:BUILTIN");

      (use.onClick as () => void)();
      expect(onUseInstalled).toHaveBeenCalledWith(distro("builtin"));
      // A single candidate needs no version picker.
      expect(appSelect).not.toHaveBeenCalled();
    }));

  it("lets the user pick between multiple installed distributions", () =>
    inRoot(() => {
      const onUseInstalled = vi.fn();

      WineMissingModal({
        locale,
        missing: "system",
        installed: [distro("one"), distro("two")],
        onCancel: vi.fn(),
        onDownloadBuiltin: vi.fn(),
        onUseInstalled,
      });

      renderedProps();
      const selectProps = appSelect.mock.lastCall?.[0] as unknown as {
        value: string;
        options: { value: string; label: string }[];
        onChange: (value: string) => void;
      };
      expect(selectProps.value).toBe("one");
      expect(selectProps.options).toEqual([
        { value: "one", label: "ONE" },
        { value: "two", label: "TWO" },
      ]);

      // Selecting the other distribution retargets the primary action.
      selectProps.onChange("two");
      const use = buttons()[2];
      expect(use.children).toBe("WINE_MISSING_USE:TWO");
      (use.onClick as () => void)();
      expect(onUseInstalled).toHaveBeenCalledWith(distro("two"));
    }));

  it("keeps the reuse action disabled when nothing is installed", () =>
    inRoot(() => {
      WineMissingModal({
        locale,
        missing: "system",
        installed: [],
        onCancel: vi.fn(),
        onDownloadBuiltin: vi.fn(),
        onUseInstalled: vi.fn(),
      });

      renderedProps();
      const use = buttons()[2];
      expect(use.disabled).toBe(true);
      expect(use.children).toBe("WINE_MISSING_USE:");
    }));
});

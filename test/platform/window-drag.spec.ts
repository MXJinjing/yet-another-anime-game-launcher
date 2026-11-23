import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachWindowDrag,
  WINDOW_DRAG_THRESHOLD,
  windowDragOrigin,
  windowDragRegionAt,
  type WindowDragPoint,
  type WindowDragRegion,
} from "@src/platform/neutralino/window-drag";

type Listener = (event: Record<string, unknown>) => void;

function fakeElement(top = 0): Element {
  return {
    contains: (node: unknown) => node === target,
    getBoundingClientRect: () => ({
      top,
      left: 0,
      right: 200,
      bottom: top + 40,
      width: 200,
      height: 40,
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as Element;
}

type CapturingElement = Element & {
  setPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
};

const target = { nodeType: 1 } as unknown as EventTarget;

function pointerEvent(overrides: Record<string, unknown> = {}) {
  return {
    button: 0,
    pointerId: 7,
    pointerType: "mouse",
    target,
    clientY: 10,
    screenX: 400,
    screenY: 300,
    preventDefault: () => undefined,
    ...overrides,
  };
}

function createHarness(regions: WindowDragRegion[]) {
  const documentListeners = new Map<string, Listener>();
  const windowListeners = new Map<string, Set<Listener>>();
  const frames: Array<() => void> = [];
  const body = { style: { cursor: "", userSelect: "" } };

  const documentStub = {
    body,
    addEventListener: (type: string, listener: Listener) => {
      documentListeners.set(type, listener);
    },
    removeEventListener: (type: string, listener: Listener) => {
      if (documentListeners.get(type) === listener)
        documentListeners.delete(type);
    },
  };

  const windowStub = {
    addEventListener: (type: string, listener: Listener) => {
      const set = windowListeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      windowListeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => {
      windowListeners.get(type)?.delete(listener);
    },
  };

  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  const position = vi.fn(async () => ({ x: 100, y: 60 }));
  const move = vi.fn(async () => undefined);
  const uninstall = attachWindowDrag(
    { regions: () => regions },
    { position, move }
  );

  return {
    body,
    position,
    move,
    uninstall,
    frames,
    flushFrames() {
      while (frames.length) frames.shift()?.();
    },
    pointerDown(event = pointerEvent()) {
      documentListeners.get("pointerdown")?.(event);
    },
    pointerMove(event = pointerEvent()) {
      windowListeners.get("pointermove")?.forEach(listener => listener(event));
    },
    pointerUp(event = pointerEvent()) {
      windowListeners.get("pointerup")?.forEach(listener => listener(event));
    },
    click(event: Record<string, unknown>) {
      windowListeners.get("click")?.forEach(listener => listener(event));
    },
    emit(type: string, event: Record<string, unknown> = pointerEvent()) {
      windowListeners.get(type)?.forEach(listener => listener(event));
    },
    hasWindowListener(type: string) {
      return (windowListeners.get(type)?.size ?? 0) > 0;
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("windowDragOrigin", () => {
  it("offsets the window by the pointer's screen delta", () => {
    expect(
      windowDragOrigin(
        { x: 320, y: 180 },
        { x: 400, y: 300 },
        { x: 460, y: 340 }
      )
    ).toEqual({ x: 380, y: 220 });
  });

  it("rounds sub-pixel deltas so the window stays on whole points", () => {
    expect(
      windowDragOrigin({ x: 0, y: 0 }, { x: 10.2, y: 10.6 }, { x: 10.4, y: 11 })
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("windowDragRegionAt", () => {
  it("does not start a top-strip drag on a descendant of an excluded dialog", () => {
    const dialogControl = {
      closest: vi.fn((selector: string) =>
        selector === ".window-no-drag" ? {} : null
      ),
    } as unknown as EventTarget;
    const strip = { element: fakeElement(), topInset: 38 };
    strip.element.contains = () => true;
    expect(windowDragRegionAt(dialogControl, [strip], 12)).toBeUndefined();
    expect(windowDragRegionAt(target, [strip], 12)).toBe(strip);
  });

  it("matches a target inside the region", () => {
    const region = { element: fakeElement() };
    expect(windowDragRegionAt(target, [region], 12)).toBe(region);
  });

  it("ignores targets outside every region", () => {
    const region = { element: fakeElement() };
    const outsider = { nodeType: 1 } as unknown as EventTarget;
    expect(windowDragRegionAt(outsider, [region], 12)).toBeUndefined();
    expect(windowDragRegionAt(null, [region], 12)).toBeUndefined();
  });

  it("only matches the top of a region that declares an inset", () => {
    const strip = { element: fakeElement(0), topInset: 38 };
    expect(windowDragRegionAt(target, [strip], 30)).toBe(strip);
    expect(windowDragRegionAt(target, [strip], 39)).toBeUndefined();
  });

  it("respects an offset between the region and the viewport", () => {
    const strip = { element: fakeElement(200), topInset: 38 };
    expect(windowDragRegionAt(target, [strip], 230)).toBe(strip);
    expect(windowDragRegionAt(target, [strip], 260)).toBeUndefined();
  });
});

describe("attachWindowDrag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves the window by the pointer delta, one native call per frame", async () => {
    const harness = createHarness([{ element: fakeElement() }]);
    harness.pointerDown(pointerEvent({ screenX: 400, screenY: 300 }));
    await settle();
    expect(harness.position).toHaveBeenCalledTimes(1);

    harness.pointerMove(pointerEvent({ screenX: 430, screenY: 322 }));
    harness.pointerMove(pointerEvent({ screenX: 450, screenY: 330 }));
    expect(harness.frames).toHaveLength(1);

    harness.flushFrames();
    expect(harness.move).toHaveBeenCalledTimes(1);
    expect(harness.move).toHaveBeenCalledWith(150, 90);

    harness.pointerUp();
    harness.uninstall();
  });

  it("keeps clicks intact until the pointer passes the drag threshold", async () => {
    const harness = createHarness([{ element: fakeElement() }]);
    harness.pointerDown(pointerEvent({ screenX: 400, screenY: 300 }));
    await settle();

    harness.pointerMove(
      pointerEvent({
        screenX: 400 + WINDOW_DRAG_THRESHOLD - 1,
        screenY: 300,
      })
    );
    harness.flushFrames();
    expect(harness.move).not.toHaveBeenCalled();

    harness.pointerUp();
    expect(harness.hasWindowListener("click")).toBe(false);
    harness.uninstall();
  });

  it("swallows the click that follows a drag, and only that one", async () => {
    const harness = createHarness([{ element: fakeElement() }]);
    harness.pointerDown();
    await settle();
    harness.pointerMove(pointerEvent({ screenX: 460, screenY: 340 }));
    harness.flushFrames();
    harness.pointerUp();
    expect(harness.hasWindowListener("click")).toBe(true);

    const dragged = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    harness.click(dragged);
    expect(dragged.preventDefault).toHaveBeenCalled();
    expect(dragged.stopPropagation).toHaveBeenCalled();
    expect(harness.hasWindowListener("click")).toBe(false);

    const next = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    harness.click(next);
    expect(next.preventDefault).not.toHaveBeenCalled();

    harness.uninstall();
  });

  it("ignores pointer-downs below the title-bar inset", async () => {
    const harness = createHarness([{ element: fakeElement(0), topInset: 38 }]);
    harness.pointerDown(pointerEvent({ clientY: 90 }));
    await settle();

    expect(harness.position).not.toHaveBeenCalled();
    expect(harness.hasWindowListener("pointermove")).toBe(false);

    harness.uninstall();
  });

  it("waits for the window origin before the first move", async () => {
    const harness = createHarness([{ element: fakeElement() }]);
    let resolvePosition: (point: WindowDragPoint) => void = () => undefined;
    harness.position.mockImplementationOnce(
      () =>
        new Promise<WindowDragPoint>(resolve => {
          resolvePosition = resolve;
        })
    );

    harness.pointerDown(pointerEvent({ screenX: 400, screenY: 300 }));
    harness.pointerMove(pointerEvent({ screenX: 460, screenY: 340 }));
    harness.flushFrames();
    expect(harness.move).not.toHaveBeenCalled();

    resolvePosition({ x: 100, y: 60 });
    await settle();
    harness.flushFrames();
    expect(harness.move).toHaveBeenCalledWith(160, 100);

    harness.pointerUp();
    harness.uninstall();
  });

  it("captures the pointer only once the press becomes a drag", async () => {
    const element = fakeElement() as CapturingElement;
    const harness = createHarness([{ element }]);
    harness.pointerDown();
    await settle();
    expect(element.setPointerCapture).not.toHaveBeenCalled();

    harness.pointerMove(pointerEvent({ screenX: 460, screenY: 340 }));
    expect(element.setPointerCapture).toHaveBeenCalledWith(7);

    harness.pointerUp();
    expect(element.releasePointerCapture).toHaveBeenCalledWith(7);

    harness.uninstall();
  });

  it("drops the gesture when the pointer capture is lost", async () => {
    const harness = createHarness([{ element: fakeElement() }]);
    harness.pointerDown();
    await settle();
    harness.pointerMove(pointerEvent({ screenX: 460, screenY: 340 }));
    harness.flushFrames();
    expect(harness.move).toHaveBeenCalledTimes(1);

    harness.emit("lostpointercapture");
    expect(harness.hasWindowListener("pointermove")).toBe(false);

    harness.pointerMove(pointerEvent({ screenX: 520, screenY: 420 }));
    harness.flushFrames();
    expect(harness.move).toHaveBeenCalledTimes(1);

    harness.uninstall();
  });

  it("stops following the pointer once the gesture ends", async () => {
    const harness = createHarness([{ element: fakeElement() }]);
    harness.pointerDown();
    await settle();
    harness.pointerMove(pointerEvent({ screenX: 460, screenY: 340 }));
    harness.flushFrames();

    harness.pointerUp();
    expect(harness.hasWindowListener("pointermove")).toBe(false);
    harness.pointerMove(pointerEvent({ screenX: 500, screenY: 500 }));
    harness.flushFrames();
    expect(harness.move).toHaveBeenCalledTimes(1);

    harness.uninstall();
  });

  it("releases the drag cursor once the gesture ends", async () => {
    const harness = createHarness([{ element: fakeElement() }]);
    harness.pointerDown();
    await settle();
    harness.pointerMove(pointerEvent({ screenX: 460, screenY: 340 }));
    expect(harness.body.style.cursor).toBe("default");
    expect(harness.body.style.userSelect).toBe("none");

    harness.pointerUp();
    expect(harness.body.style.cursor).toBe("");
    expect(harness.body.style.userSelect).toBe("");

    harness.uninstall();
  });

  it("uninstalls the pointer-down listener", async () => {
    const harness = createHarness([{ element: fakeElement() }]);
    harness.uninstall();
    harness.pointerDown();
    await settle();
    expect(harness.position).not.toHaveBeenCalled();
  });
});

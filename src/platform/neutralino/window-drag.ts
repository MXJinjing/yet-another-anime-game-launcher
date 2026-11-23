/**
 * Window dragging for the launcher's chrome-less windows.
 *
 * The launcher sets `transparentTitleBar` so it can paint its own title strip,
 * which means both this window and the detached log window have to move
 * themselves. The bundled runtime exposes no native "drag with the current
 * event" route, so both windows install the single gesture implemented here
 * instead of keeping separate drag code paths.
 *
 * A gesture starts on a designated region of the DOM (the title-bar strip of
 * the launcher, the tab strip of the log window), remembers the window origin
 * once, then follows the pointer's screen delta. Moves are coalesced to one
 * native call per frame so the window keeps up with the cursor.
 *
 * Both windows therefore need `titleBarDragHeight: 0` in the runtime config.
 * With the key absent the runtime installs a native drag view across the whole
 * top strip; that view consumes every mouse-down it receives, so the press
 * never reaches the page — the tab strip can be dragged, but no button inside
 * it can be clicked. A zero-height band leaves the strip to this module, which
 * keeps clicks working because a press only becomes a drag past a threshold.
 */

export interface WindowDragPoint {
  x: number;
  y: number;
}

export interface WindowDragRegion {
  /** Element whose pointer-downs can start the gesture. */
  element: Element;
  /**
   * Restrict the gesture to the top of the element, in the style of a title
   * bar. Left out, the whole element drags.
   */
  topInset?: number;
}

export interface WindowDragEndpoints {
  position: () => Promise<WindowDragPoint>;
  move: (x: number, y: number) => Promise<unknown>;
}

export interface WindowDragOptions {
  /**
   * Resolved on every pointer-down, so regions mounted after installation
   * (the log window's tab strip) still work.
   */
  regions: () => ReadonlyArray<WindowDragRegion | null | undefined>;
}

/** Pointer travel before a press counts as a drag, so clicks stay clicks. */
export const WINDOW_DRAG_THRESHOLD = 3;

/** Title-bar strip that drags the launcher window, matching the old native one. */
export const WINDOW_TITLE_BAR_HEIGHT = 38;

/** Window origin for a pointer that moved from `from` to `to`. */
export function windowDragOrigin(
  origin: WindowDragPoint,
  from: WindowDragPoint,
  to: WindowDragPoint
): WindowDragPoint {
  return {
    x: Math.round(origin.x + (to.x - from.x)),
    y: Math.round(origin.y + (to.y - from.y)),
  };
}

/** The drag region under `target`, if any, honouring the region's top inset. */
export function windowDragRegionAt(
  target: EventTarget | null,
  regions: ReadonlyArray<WindowDragRegion | null | undefined>,
  pointerY: number
): WindowDragRegion | undefined {
  if (!target) return undefined;
  for (const region of regions) {
    if (!region) continue;
    if (!region.element.contains(target as Node)) continue;
    if (region.topInset === undefined) return region;
    const top = region.element.getBoundingClientRect().top;
    if (pointerY - top <= region.topInset) return region;
  }
  return undefined;
}

/**
 * Binds the gesture to the document. Returns the uninstall hook for tests and
 * for components that install it for their own lifetime.
 */
export function attachWindowDrag(
  options: WindowDragOptions,
  endpoints: WindowDragEndpoints
): () => void {
  let gesture:
    | {
        pointerId: number;
        region: WindowDragRegion;
        from: WindowDragPoint;
        to: WindowDragPoint;
        origin?: WindowDragPoint;
        dragging: boolean;
        frame?: number;
      }
    | undefined;

  function schedule() {
    if (!gesture || gesture.frame !== undefined) return;
    gesture.frame = requestAnimationFrame(flush);
  }

  function flush() {
    if (!gesture) return;
    gesture.frame = undefined;
    // The origin request is in flight; the first move waits for it so the
    // window never jumps to a half-computed position.
    if (!gesture.origin) return;
    const origin = windowDragOrigin(gesture.origin, gesture.from, gesture.to);
    void endpoints.move(origin.x, origin.y).catch(() => undefined);
  }

  function applyDragStyles() {
    const body = document.body;
    if (!body) return;
    body.style.cursor = "default";
    body.style.userSelect = "none";
  }

  function clearDragStyles() {
    const body = document.body;
    if (!body) return;
    body.style.cursor = "";
    body.style.userSelect = "";
  }

  let clickGuard: (() => void) | undefined;

  /**
   * A completed drag must not also click the control it started on. The guard
   * removes itself when it swallows a click, and any later gesture drops it so
   * a drag that ended without a click cannot eat an unrelated one.
   */
  function suppressNextClick() {
    clickGuard?.();
    const cancel = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      clickGuard?.();
    };
    window.addEventListener("click", cancel, true);
    clickGuard = () => {
      window.removeEventListener("click", cancel, true);
      clickGuard = undefined;
    };
  }

  function stopListening() {
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("lostpointercapture", onPointerCancel, true);
  }

  function finish() {
    // Clear the gesture first: releasing the capture re-enters through
    // `lostpointercapture` on the same pointer, and that must be a no-op.
    const ended = gesture;
    gesture = undefined;
    if (!ended) return;
    if (ended.frame !== undefined) cancelAnimationFrame(ended.frame);
    if (ended.dragging) {
      clearDragStyles();
      // Capture is only taken once the press becomes a drag, so a plain click
      // still targets the control it started on.
      try {
        ended.region.element.releasePointerCapture(ended.pointerId);
      } catch {
        // The pointer is already gone.
      }
    }
    stopListening();
  }

  function onPointerDown(event: PointerEvent) {
    clickGuard?.();
    if (gesture || event.button !== 0 || event.pointerType === "touch") return;
    const region = windowDragRegionAt(
      event.target,
      options.regions(),
      event.clientY
    );
    if (!region) return;
    gesture = {
      pointerId: event.pointerId,
      region,
      from: { x: event.screenX, y: event.screenY },
      to: { x: event.screenX, y: event.screenY },
      dragging: false,
    };
    void endpoints
      .position()
      .then(position => {
        if (!gesture) return;
        gesture.origin = position;
        if (gesture.dragging) schedule();
      })
      .catch(() => undefined);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    // Safety net: a release the page never sees (window deactivated mid-drag)
    // drops the capture, which must not leave the gesture following the mouse.
    window.addEventListener("lostpointercapture", onPointerCancel, true);
  }

  function onPointerMove(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.to = { x: event.screenX, y: event.screenY };
    if (!gesture.dragging) {
      const distance = Math.hypot(
        gesture.to.x - gesture.from.x,
        gesture.to.y - gesture.from.y
      );
      if (distance < WINDOW_DRAG_THRESHOLD) return;
      gesture.dragging = true;
      applyDragStyles();
      // Keep receiving moves even if the native window briefly lags behind the
      // cursor and the pointer leaves the region.
      try {
        gesture.region.element.setPointerCapture(gesture.pointerId);
      } catch {
        // Capture is a nicety; the window listeners still receive moves.
      }
    }
    event.preventDefault();
    schedule();
  }

  function onPointerUp(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dragged = gesture.dragging;
    finish();
    if (dragged) suppressNextClick();
  }

  function onPointerCancel(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    finish();
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    finish();
    clickGuard?.();
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
}

/** Installs the gesture against the native window it runs in. */
export function installWindowDrag(options: WindowDragOptions): () => void {
  return attachWindowDrag(options, {
    position: () => Neutralino.window.getPosition(),
    move: (x, y) => Neutralino.window.move(x, y),
  });
}

/**
 * Launcher window: the top strip doubles as the title bar, covering the band the
 * native `titleBarDragHeight` would otherwise own.
 */
export function installTitleBarDrag(): () => void {
  return installWindowDrag({
    regions: () => [
      { element: document.body, topInset: WINDOW_TITLE_BAR_HEIGHT },
    ],
  });
}

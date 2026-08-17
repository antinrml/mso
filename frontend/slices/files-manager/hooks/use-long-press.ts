"use client";

import { useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

// LONG-PRESS = right-click, for the file grid/list.
//
// Touch has no contextmenu event worth relying on (Chrome Android fires one, iOS
// Safari mostly does not), so on a phone every action in the file context menu —
// Preview, Rename, Download, Move to Trash — was simply unreachable. 500 ms is the
// platform convention on both; a 10 px drift cancels it so a scroll flick never
// opens a menu.
const HOLD_MS = 500;
const DRIFT_PX = 10;

export function useLongPress(enabled: boolean, onContext: (e: MouseEvent) => void) {
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  // Set when a long-press opened the menu: the finger lifting still fires a click,
  // which would both open the file underneath and — because the menu closes on any
  // window click — dismiss the menu it just opened.
  const swallow = useRef(false);

  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  /** Wrap the item's own tap handler. Returns true when the tap was swallowed. */
  const swallowTap = (e: MouseEvent): boolean => {
    if (!swallow.current) return false;
    swallow.current = false;
    e.preventDefault();
    // Stops the native event before the menu's window-level close listener.
    e.stopPropagation();
    return true;
  };

  const handlers = enabled
    ? {
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
          if (e.pointerType === "mouse") return;
          const { clientX, clientY } = e;
          const currentTarget = e.currentTarget;
          press.current = {
            x: clientX,
            y: clientY,
            timer: window.setTimeout(() => {
              press.current = null;
              swallow.current = true;
              // Synthetic enough: the handler only reads coords and stops
              // propagation on what it is given.
              onContext({ clientX, clientY, currentTarget, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent);
            }, HOLD_MS),
          };
        },
        onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
          const p = press.current;
          if (p && (Math.abs(e.clientX - p.x) > DRIFT_PX || Math.abs(e.clientY - p.y) > DRIFT_PX)) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
      }
    : {};

  return { handlers, swallowTap };
}

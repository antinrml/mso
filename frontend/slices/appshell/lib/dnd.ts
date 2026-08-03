"use client";

// Cross-app drag & drop seam — the RECEIVING half only. Every window's content
// area is a drop target that routes a typed payload to the target app's
// registered drop handler. Payloads ride a custom mime so native browser drags
// (file uploads) keep working untouched.
//
// There is deliberately no producer helper here. One existed (makeDragProps) with
// zero callers, so nothing in the app ever wrote DND_MIME and this whole path was
// unreachable outside tests and the ?e2e=1 dev command — files-manager's own drag
// writes "text/plain" instead. To actually light this up, have a real drag source
// set DND_MIME; until then the read half is dormant by design, not by accident.

export const DND_MIME = "application/x-shell-payload";

export type DragData = { kind: string } & Record<string, unknown>;

type DropHandler = {
  accepts: (data: DragData) => boolean;
  onDrop: (data: DragData) => void;
};

const handlers = new Map<string, DropHandler[]>();

/** Register a drop handler for an app. Returns an unregister fn. */
export function registerDropHandler(appId: string, h: DropHandler): () => void {
  handlers.set(appId, [h, ...(handlers.get(appId) ?? [])]);
  return () => {
    handlers.set(appId, (handlers.get(appId) ?? []).filter((x) => x !== h));
  };
}

function handlerFor(appId: string, data: DragData): DropHandler | undefined {
  return (handlers.get(appId) ?? []).find((h) => {
    try {
      return h.accepts(data);
    } catch {
      return false;
    }
  });
}

export function appAccepts(appId: string, data: DragData): boolean {
  return !!handlerFor(appId, data);
}

/** Route a payload to an app's drop handler. Returns false when none claims it. */
export function deliverDrop(appId: string, data: DragData): boolean {
  const h = handlerFor(appId, data);
  if (!h) return false;
  h.onDrop(data);
  return true;
}

/** Parse a shell payload off a drag event (null for native/file drags). */
export function readDragData(e: React.DragEvent): DragData | null {
  try {
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return null;
    const v = JSON.parse(raw) as DragData;
    return v && typeof v.kind === "string" ? v : null;
  } catch {
    return null;
  }
}

/** True while the drag carries a shell payload (dragover can't read data). */
export function dragCarriesPayload(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DND_MIME);
}

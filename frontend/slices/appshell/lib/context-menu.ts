"use client";
/* Per-shell context-menu registry. The desktop background right-click menu is
   DATA, not hardcoded: each shell renders its own built-in items (which close
   over component-local state like Mission Control) and merges in whatever the
   consumer or apps register here — scoped to one shell id or "*" (all shells).
   Providers run at OPEN time with the click position, so items are fully
   dynamic (enable/disable, vary by where you clicked, read live state). */
import type { LucideIcon } from "lucide-react";
import type { ShellId, ShellSurface } from "../registry/shells";

export type MenuItem =
  | {
      type?: "item";
      label: string;
      icon?: LucideIcon;
      onClick: () => void;
      disabled?: boolean;
      /** macOS-style keyboard hint shown right-aligned, e.g. "⌘I". Display only. */
      shortcut?: string;
      /** Destructive action — rendered in system red (Move to Trash, Delete). */
      danger?: boolean;
      /** One-of-a-set state (role=menuitemradio + a trailing ✓ — never colour
       *  alone). `undefined` = a plain command row. */
      checked?: boolean;
    }
  | {
      /** ONE level of nested items, rendered as a side panel. Still pure data,
       *  so providers stay React-free. Deeper nesting is not rendered. */
      type: "submenu";
      label: string;
      icon?: LucideIcon;
      disabled?: boolean;
      items: MenuItem[];
    }
  | { type: "sep" };

// Context handed to a provider when the menu opens.
export type ContextMenuCtx = {
  shell: ShellId;
  surface: ShellSurface;
  /** Viewport coords of the click (for position-aware items). */
  x: number;
  y: number;
};

export type ContextMenuProvider = (ctx: ContextMenuCtx) => MenuItem[];

const providers = new Map<string, Set<ContextMenuProvider>>();

/** Register dynamic items for one shell id, or "*" for every shell. Returns an
 *  unregister fn. Called by the consumer (os-shell) and apps — never the
 *  framework's own built-ins (those stay inline in each shell). */
export function registerContextMenu(scope: ShellId | "*", provider: ContextMenuProvider): () => void {
  let set = providers.get(scope);
  if (!set) {
    set = new Set();
    providers.set(scope, set);
  }
  set.add(provider);
  return () => {
    set?.delete(provider);
  };
}

/** All registered items for a shell — the shell's own "*" group first, then its
 *  id-scoped group, each provider's output as one group (separator-joined). */
export function getContextMenuItems(ctx: ContextMenuCtx): MenuItem[] {
  const groups: MenuItem[][] = [];
  for (const scope of ["*", ctx.shell] as const) {
    const set = providers.get(scope);
    if (!set) continue;
    for (const provider of set) {
      const items = provider(ctx);
      if (items.length) groups.push(items);
    }
  }
  return joinGroups(groups);
}

/** Concatenate non-empty item groups with a separator between each. */
export function joinGroups(groups: MenuItem[][]): MenuItem[] {
  return groups
    .filter((g) => g.length)
    .flatMap((g, i) => (i === 0 ? g : [{ type: "sep" } as MenuItem, ...g]));
}

/** Where a submenu panel sits: overlapping its row's right edge, flipped to the
 *  left when it would run off-screen, lifted so the last row stays visible.
 *  Pure (rect in, coords out) — the renderer measures, this decides. */
export function submenuPos(
  row: { top: number; left: number; right: number },
  size: { w: number; h: number },
  view: { w: number; h: number },
  gap = 4,
): { x: number; y: number; flipped: boolean } {
  const flipped = row.right - gap + size.w > view.w - 8 && row.left - size.w + gap >= 8;
  const x = flipped
    ? row.left - size.w + gap
    : Math.max(8, Math.min(row.right - gap, view.w - size.w - 8));
  return { x, y: Math.max(8, Math.min(row.top - 4, view.h - size.h - 8)), flipped };
}

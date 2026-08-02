"use client";

import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useShellUI } from "@/features/appshell";
import { ControlCenterTiles } from "./control-center-tiles";

// iPhone Control Center — pulls down from the top. Only REAL toggles (this is a
// web app: no wifi/cellular/battery/brightness to fake). The tile grid is shared
// with the desktop menu-bar popover (control-center-tiles). Open state is owned by
// the mobile surface and read via the shell-UI context.
export function ControlCenter() {
  const { controlCenterOpen: open, setControlCenterOpen: onOpenChange, openAppById } = useShellUI();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="top"
        className="glass rounded-b-3xl border-border bg-[var(--glass-menu)] p-4 pt-9"
      >
        <SheetTitle className="sr-only">Control Center</SheetTitle>
        <SheetDescription className="sr-only">Quick system toggles</SheetDescription>
        <div className="mx-auto w-full max-w-md">
          {/* No onAssistant override: the tile toggles Alfa IN CONTEXT (right dock
              on desktop, bottom sheet on mobile) rather than launching the app.
              Both show the same conversation now, and the full app is already one
              tap away in the dock — this tile is the only way to reach Alfa over
              whatever app you are currently in, which on a phone did not exist. */}
          <ControlCenterTiles onClose={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

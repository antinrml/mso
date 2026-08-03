"use client";

import { useMemo } from "react";
import {
  AppShell,
  A11yCommands,
  TOPSIDE_BRAND,
  TOPSIDE_FEATURES,
  TOPSIDE_PERSIST_KEY,
  BUILTIN_APPS,
  topsideCapabilities,
  type ShellManifest,
} from "@/features/os-shell";
import { AppearanceProvider } from "@/lib/appearance";
import { QuicklinksProvider } from "@/lib/quicklinks";
import "@/features/os-shell/integrations"; // side-effect: lock guard + Quick Look + DnD wiring
import { OsApiProvider } from "@/lib/os-api";
import { AuthGate, SessionProvider, useSession, type SessionStatus } from "@/features/auth";
import { useInstalledApps, useDisabledIds } from "@/features/app-store";

// Inside the auth boundary so it can read the owner's installed runtime apps and
// merge them with the built-ins (dynamic registry). Brand + the built-in app set
// + shell features live in `os-shell/shell.manifest.ts`. The owner can disable any
// built-in app or shell feature from the App Store; we filter the manifest by that
// disabled set so they leave the dock/Launchpad/Spotlight (and feature slots).
function Shell() {
  const dynamic = useInstalledApps();
  const disabled = useDisabledIds();
  const { status } = useSession();
  const manifest: ShellManifest = useMemo(() => {
    const off = new Set(disabled);
    const apps = [...BUILTIN_APPS, ...dynamic].filter((app) => !off.has(app.id));
    // The shell looks identical signed in or out, but it is NOT the same thing:
    // signed out every host call is mock, so most apps are showing fixtures. The
    // one app that explains that — and offers the two real next steps, sign in or
    // install your own — is Docs, so it gets promoted to the front of the dock and
    // the mobile quick row while signed out. Signed in it drops back to its normal
    // place; by then you are on your own box and the docs are just reference.
    const ordered =
      status === "out"
        ? [
            ...apps.filter((a) => a.id === "docs").map((a) => ({ ...a, pinned: true })),
            ...apps.filter((a) => a.id !== "docs"),
          ]
        : apps;
    return {
      brand: TOPSIDE_BRAND,
      apps: ordered,
      features: TOPSIDE_FEATURES.filter((f) => !off.has(f.id)),
      persistKey: TOPSIDE_PERSIST_KEY,
      capabilities: topsideCapabilities,
    };
  }, [dynamic, disabled, status]);
  return <AppShell manifest={manifest} />;
}

export function OsRoot({ initialStatus }: { initialStatus?: SessionStatus }) {
  return (
    <AppearanceProvider>
      <QuicklinksProvider>
        <A11yCommands />
        {/* Skip-link: first focusable element on the page so keyboard users
            can bypass the menu bar/dock and land on the shell surface. Hidden
            until focused (`focus:not-sr-only`). Target id="main-content" is
            set on the desktop surface root in appshell/components/desktop.tsx. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[var(--z-skip-link)] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background focus:outline-2 focus:outline-ring"
        >
          Skip to main content
        </a>
        <SessionProvider initialStatus={initialStatus}>
          <AuthGate>
            <OsApiProvider>
              <Shell />
            </OsApiProvider>
          </AuthGate>
        </SessionProvider>
      </QuicklinksProvider>
    </AppearanceProvider>
  );
}

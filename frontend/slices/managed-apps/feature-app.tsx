"use client";

import { ExternalLink, RefreshCw, TerminalSquare } from "lucide-react";
import { Suspense, useCallback, useState } from "react";
import type { AppProps } from "@/features/appshell";
import { Terminal } from "@/features/os-terminal";
import type { ManagedAppFeature } from "@/lib/managed-apps/types";
import { cliCommand, featureSource } from "./feature-cli";

export function ManagedFeatureApp({ feature }: AppProps & { feature: ManagedAppFeature }) {
  const source = featureSource(feature);
  const command = cliCommand(feature);
  // No dashboard origin = no vendor UI here at all, so the CLI is not a fallback, it is
  // the view. With an origin, the vendor UI is always the opening view: the gateway
  // sockets both dashboards drive now ride the proxy (they did not when this defaulted
  // OpenClaw to a terminal), so there is no longer a surface that opens dead.
  const [generation, setGeneration] = useState(0);
  const [view, setView] = useState<"ui" | "cli">(() => (source ? "ui" : "cli"));

  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* No name row: the window header above already says which app this is. Repeating it
          cost a 48px band on every mount and pushed the app itself down the screen. */}
      <header className="flex h-9 shrink-0 items-center justify-end gap-1.5 border-b border-border px-2">
        {source ? (
          <button type="button" onClick={() => setView((current) => (current === "ui" ? "cli" : "ui"))} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground" aria-label="Toggle upstream UI or CLI"><TerminalSquare className="size-3.5" />{view === "ui" ? "CLI" : "UI"}</button>
        ) : null}
        {source ? (
          <>
            <button type="button" onClick={reload} className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Refresh feature"><RefreshCw className="size-3.5" /></button>
            <a href={source} target="_blank" rel="noreferrer" className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Open feature in dedicated tab"><ExternalLink className="size-3.5" /></a>
          </>
        ) : null}
      </header>
      {/* `|| !source` is explicit, not defensive: with no dashboard origin the CLI IS the
          app's surface here, and the alternative was an iframe with a null src. The panel
          of prose that used to sit in THIS slot was unreachable anyway — `view` initialises
          to "cli" whenever `source` is null and the toggle that could change it only
          renders when `source` is not; the note above sits outside the branch for exactly
          that reason. */}
      {/* Only when there is no origin at all, so this can never become the banner that got
          removed for appearing on every feature view: with a dashboard configured — the
          normal case — nothing renders here. Without one, the window silently opens a
          terminal, and a terminal is indistinguishable from a dashboard that broke. It
          reads as a fault in the app and sends the operator to look at the app. It is not:
          it is a deployment that serves no dashboards, and only this file knows that. */}
      {!source ? (
        <p className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
          No dashboard on this deployment — the CLI below is the view.{" "}
          <span className="font-mono">NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE</span> is unset, so{" "}
          {feature.applicationId} has no host of its own to be framed from. Setting it needs a
          rebuild, not just a restart. See docs/MANAGED-APPS.md §5.
        </p>
      ) : null}
      {view === "cli" || !source ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <Terminal initialCommand={command} />
          </Suspense>
        </div>
      ) : (
        <iframe
          key={generation}
          src={source}
          title={`${feature.applicationId} ${feature.title}`}
          className="min-h-0 flex-1 border-0 bg-background"
          // allow-same-origin stays, and is the whole point: these SPAs need their own
          // cookies and storage or they do not boot (Hermes reads localStorage inside a
          // useState initializer — an opaque origin throws SecurityError mid-render). It is
          // safe only because the frame sits on the app's OWN host: same-origin with
          // itself, cross-origin with the cockpit, so `window.top` is opaque and
          // /api/v1/exec is not a route on that host at all. This element must never be
          // pointed at a cockpit-origin URL again.
          //
          // Still no allow-popups, in either mode — re-checked now that a popup would open
          // on the APP's origin rather than the cockpit's. The flows that want it stay dead
          // regardless: Hermes' 2 call sites are provider OAuth whose callback is the
          // upstream's own 127.0.0.1 (unreachable from the browser), and OpenClaw's 4 are
          // external links, ctrl-click terminal links and an open-in-editor deep link —
          // destinations for the user's own browser, not this frame. Counted across the
          // whole installed bundles, not just the entry chunk. So granting it would buy
          // nothing and still hand upstream JS a top-level, address-bar-bearing window
          // pointed at any URL it likes.
          //
          // A banner used to sit above this frame explaining that those clicks are a
          // deliberate no-op, and which external hosts the CSP intersection kills. It was
          // removed by request: it appeared on every feature view, could not be dismissed
          // for good (the state was per-mount), and read as a permanent complaint. The
          // consequence is real and is the reason this note exists — those clicks are now
          // silent, and OpenClaw's Gemini live-audio socket fails inside the frame with
          // nothing on screen to say why. PROXY_BLOCKED_EXTERNALS in
          // lib/managed-apps/proxy-headers.ts still records exactly which hosts and why.
          sandbox="allow-forms allow-modals allow-same-origin allow-scripts allow-downloads"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}

// NoDashboardPanel lived here and explained NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE at
// length. Deleted: it was unreachable (see the render branch above), and a deployment with
// no dashboard origin gets the CLI — which is the app's real surface there, not a
// consolation prize that needs three sentences of apology. The reasoning it carried lives
// in featureSource() in feature-cli.ts, where the decision is actually made.

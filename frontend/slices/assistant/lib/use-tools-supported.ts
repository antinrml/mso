"use client";

import { useEffect, useState } from "react";
import { IS_DEMO } from "@/lib/demo";

// Can the ACTIVE provider actually call tools?
//
// Not a cosmetic question. app/api/assistant/route.ts takes a chat-only branch for
// the ChatGPT Codex OAuth backend and drops the `tools` array entirely, so on that
// provider every tool the UI advertises is unreachable. Before this, the header
// claimed "22 tools" and the banner claimed "Alfa acts on your real VPS" while the
// model answered, correctly, that it had none — which reads as a broken assistant
// rather than a chat-only provider.
//
// Optimistic default: true. A provider that CAN use tools is the common case, and
// flashing a "chat only" warning for one frame on every open would be its own lie.
// The GET is cached at module scope because several surfaces ask (chat panel
// banner, agent switcher badge) and the answer changes only when the owner picks a
// different provider in Settings.

let cached: Promise<boolean> | null = null;

function fetchSupported(): Promise<boolean> {
  cached ??= fetch("/api/config", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((c: { toolsSupported?: boolean } | null) => c?.toolsSupported !== false)
    .catch(() => true); // unreachable config is not evidence of a chat-only provider
  return cached;
}

/** Call after changing the provider so the next read re-asks. */
export function invalidateToolsSupported(): void {
  cached = null;
}

export function useToolsSupported(): boolean {
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    if (IS_DEMO) return; // demo makes no /api calls; its tools are simulated anyway
    let alive = true;
    void fetchSupported().then((v) => alive && setSupported(v));
    return () => {
      alive = false;
    };
  }, []);
  return supported;
}

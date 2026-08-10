"use client";

import { useEffect, useRef } from "react";
import { IS_DEMO } from "@/lib/demo";

const DEBOUNCE_MS = 1500;

/** Fired by the auth slice when a login lands (providers mount outside AuthGate). */
export const AUTHED_EVENT = "mso:authed";

// Both callers (appearance `tweaks` + quicklinks) mount together in os-root and each
// used to GET the whole blob, so every boot paid two authenticated round-trips — and
// every window focus while signed out fired two more 401s. One in-flight promise now
// serves both. It clears on settle, so the focus/auth retry still refetches.
let inflight: Promise<Record<string, unknown> | null> | null = null;

export function pullPrefs() {
  inflight ??= fetch("/api/prefs", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null))
    .catch(() => null) // offline / bad JSON — keep local state, stay silent
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Shared server-sync seam for the appearance + quicklinks providers. Offline-first:
// mount → GET /api/prefs → apply the stored section (server wins on initial load) →
// from then on, debounce local changes into a POST. A failed GET (401 on the login
// screen, offline) is silent — we keep localStorage state and retry on window focus
// or on the login event; PUTs stay disabled until a GET has succeeded so local
// defaults never clobber the server. `apply` must be referentially stable (useCallback).
export function usePrefsSync<T>(opts: {
  section: "tweaks" | "quicklinks";
  value: T;
  apply: (server: T) => void;
}) {
  const { section, value, apply } = opts;
  const ready = useRef(false); // a GET succeeded → POSTs allowed
  const failed = useRef(false); // last GET failed → retry on focus / auth event
  const echo = useRef(false); // next value change came from apply() → skip POST

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    const pull = async () => {
      const data = await pullPrefs();
      if (data == null) {
        failed.current = true;
        return;
      }
      if (!alive) return;
      const server = data[section];
      if (server != null) {
        echo.current = true; // don't POST back what we just applied
        apply(server as T);
      }
      ready.current = true;
      failed.current = false;
    };
    void pull();
    const retry = () => {
      if (failed.current && !ready.current) void pull();
    };
    window.addEventListener("focus", retry);
    window.addEventListener(AUTHED_EVENT, retry);
    return () => {
      alive = false;
      window.removeEventListener("focus", retry);
      window.removeEventListener(AUTHED_EVENT, retry);
    };
  }, [section, apply]);

  useEffect(() => {
    if (IS_DEMO || !ready.current) return;
    if (echo.current) {
      echo.current = false;
      return;
    }
    const t = setTimeout(() => {
      void fetch("/api/prefs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [section]: value }),
      }).catch(() => {
        /* offline-first: drop silently, next change retries */
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, section]);
}

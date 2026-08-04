"use client";

import { useEffect, useState } from "react";

/* Shared shell clock (Android home + Shade datetime, iOS status strip, …).
   30s tick — minute precision is all any mode shows. */
export function Clock({ mode }: { mode: "time" | "big" | "date" | "datetime" }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  // suppressHydrationWarning on every branch, and it is load-bearing. This text
  // cannot match between server and client for TWO independent reasons: the server
  // renders at one instant and hydration happens at another, and toLocaleTime/DateString
  // resolves against the SERVER's locale during SSR and the BROWSER's on the client.
  // React's own hydration-mismatch page lists both. Left unsuppressed it threw
  // "Hydration failed … this tree will be regenerated on the client" on every deep
  // link into an app, discarding the whole shell tree. Suppressing keeps the server
  // text in place (no layout shift) and lets the client correct it on the next tick —
  // which is exactly what this attribute exists for.
  if (mode === "big") return <div suppressHydrationWarning className="text-5xl font-medium tracking-tight">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>;
  if (mode === "date") return <div suppressHydrationWarning className="text-sm text-muted-foreground">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>;
  if (mode === "datetime") return <span suppressHydrationWarning>{now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>;
  return <span suppressHydrationWarning>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>;
}

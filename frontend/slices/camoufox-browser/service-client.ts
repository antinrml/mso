// Talking to /api/v1/camoufox/service. No React here so the retry/readiness logic
// stays testable without a DOM.

export interface CamoufoxServiceStatus {
  running: boolean;
  enabled: boolean;
  installed: boolean;
}

export async function fetchStatus(signal?: AbortSignal): Promise<CamoufoxServiceStatus> {
  const response = await fetch("/api/v1/camoufox/service", { cache: "no-store", signal });
  const payload = (await response.json()) as CamoufoxServiceStatus & { error?: string };
  // Never fall back to a synthetic "not installed": that reads as a settled fact
  // about the host when it is really an unanswered question, and it sends whoever
  // sees it looking for a missing install instead of the real fault.
  if (!response.ok) throw new Error(payload.error ?? "The browser session is unreachable");
  return payload;
}

export async function setPower(on: boolean, signal?: AbortSignal): Promise<CamoufoxServiceStatus> {
  const response = await fetch("/api/v1/camoufox/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: on ? "start" : "stop" }),
    signal,
  });
  const payload = (await response.json()) as CamoufoxServiceStatus & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Could not change the browser session");
  return payload;
}

/** systemd reports `active` the instant ExecStart forks, but the unit's script then
 *  brings up Xvfb, a window manager, the browser, x11vnc and only LAST websockify —
 *  several seconds later. Mounting the viewer on `running` alone therefore frames a
 *  502 and the user sees a dead rectangle after clicking Start. So readiness is the
 *  thing the iframe actually needs: the proxied noVNC document answering 200. */
export async function waitForViewer(signal: AbortSignal, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted) {
    try {
      const response = await fetch("/camoufox-vnc/vnc.html", { cache: "no-store", signal });
      if (response.ok) return true;
    } catch {
      // Aborted, or the rewrite target refused while the unit is still coming up.
      if (signal.aborted) return false;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

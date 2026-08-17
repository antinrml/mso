// The proxy's failures, rendered for the OPERATOR who is looking at them — because in
// the app window, they ARE the window.
//
// `failAncestors()` in the proxy route exists so the browser DISPLAYS these responses
// instead of refusing the frame outright, which was the whole point: a blank frame says
// nothing, "unauthorized" says something. It stopped one step short. What actually
// renders is `{"error":"unauthorized"}`, which names the HTTP fact and none of the causes
// an operator can act on — and the most expensive cause is invisible from that string:
//
//   A session issued BEFORE `OS_SESSION_COOKIE_DOMAIN` was set is host-only. The browser
//   never sends it to the app host, so the dashboard 401s while the cockpit that minted
//   it keeps working perfectly. Nothing is broken and nothing looks fixable. The remedy
//   is to sign out and back in, and there is no way to guess that from "unauthorized".
//
// A server cannot detect that case — a Cookie header carries no Domain, so a cookie that
// was never sent is indistinguishable from one that never existed. It can only be said.
//
// NAVIGATIONS ONLY. An upstream SPA's own `fetch()` lands on this same route, root
// mounted, and must keep receiving JSON it can parse; that is why the page is selected by
// Sec-Fetch-Dest and never by status code.

/** A request whose response a HUMAN will read: the app window's frame, or a tab. */
export function wantsErrorPage(req: Request): boolean {
  const dest = req.headers.get("sec-fetch-dest");
  // Fetch Metadata is sent by every browser that can run this cockpit, so when the
  // header is present it is the answer. The Accept sniff below is only for the clients
  // that send no Sec-Fetch-Dest at all (curl, a proxy that strips it), and it errs
  // toward JSON when it cannot tell — a machine given HTML is worse off than a human
  // given JSON.
  if (dest) return dest === "document" || dest === "iframe" || dest === "frame";
  return (req.headers.get("accept") ?? "").includes("text/html");
}

// Keyed by the exact `fail()` string in the route, so a hint can never drift onto the
// wrong failure the way a status-code key would (three different 404s live in there).
// Anything absent renders without a hint rather than with a guessed one. The values are
// authored here and are the only markup on the page, so they are interpolated raw while
// the failure string — which is also authored here, but sits next to path input — is not.
const HINTS: Record<string, string> = {
  unauthorized:
    "Sign out of the cockpit and sign in again. The session cookie is only given " +
    "<code>Domain=</code> at the moment it is ISSUED, so a session created before " +
    "<code>OS_SESSION_COOKIE_DOMAIN</code> was configured is host-only and is never sent " +
    "to this host — the cockpit keeps working, and only the dashboard fails.",
  "managed application dashboards are not served on this origin":
    "This deployment serves no managed-app dashboards. Set " +
    "<code>NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE</code> and " +
    "<code>OS_SESSION_COOKIE_DOMAIN</code> (both, or neither), then REBUILD — the " +
    "template is baked into the client bundle at build time, so a restart alone leaves " +
    "the browser pointed at the old URL.",
  "managed application upstream unavailable":
    "The application is not answering on its loopback port. Start it from its MSO " +
    "window (Details → Start), or check its logs there.",
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (ch) => ESCAPES[ch]);

/** The failure as a page. No CSS: the policy on these responses is `default-src 'none'`,
 *  which covers style-src too, so a stylesheet or a `style=` attribute would be blocked
 *  and the page would render exactly as it does now, minus the pretence. `color-scheme`
 *  is a meta tag rather than CSS, so it survives the policy and the page follows the
 *  operator's dark/light preference instead of flashing white inside a dark cockpit. */
export function errorPage(error: string, status: number): string {
  const hint = HINTS[error];
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="color-scheme" content="dark light">',
    `<title>${status} — ${escapeHtml(error)}</title>`,
    "</head><body>",
    `<h1>${escapeHtml(error)}</h1>`,
    `<p>HTTP ${status} from MSO's managed-app proxy — not from the application.</p>`,
    hint ? `<p>${hint}</p>` : "",
    "</body></html>",
  ].join("");
}

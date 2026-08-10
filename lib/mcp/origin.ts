// The origin an MCP client must be told to use. Discovery metadata is
// origin-scoped (RFC 8414 / 9728), so getting this wrong is the single most common
// way a connector fails with "MCP server does not implement OAuth".
//
// Precedence mirrors lib/managed-apps/proxy-headers: OS_PUBLIC_ORIGIN is
// deployment-owned and wins; the real Host header comes next; X-Forwarded-Host is
// client-settable and is consulted LAST.
export function publicOrigin(req: Request): string {
  const explicit = process.env.OS_PUBLIC_ORIGIN?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // Misconfigured value (a bare hostname, no scheme) — fall through to the
      // headers rather than emit a URL no client can resolve.
    }
  }
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = req.headers.get("host") ?? req.headers.get("x-forwarded-host") ?? url.host;
  return `${proto}://${host}`;
}

/** Best-effort client IP for the pre-auth rate limiter. Spoofable behind a proxy
 *  that does not overwrite the header — which is why it only ever gates rate
 *  limits, never authorization. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

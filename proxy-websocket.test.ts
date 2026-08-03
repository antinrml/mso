// The WebSocket branch of proxy.ts, split out of proxy.test.ts to stay under the
// 220-line rule. It is the one path where MIDDLEWARE, not a route handler, is all
// that stands between the public internet and an agent gateway: the upgrade never
// reaches the proxy route, so that route's verifyAuth() never runs.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "./lib/auth/session";

const approved = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/auth/device-store", () => ({ isApproved: async () => approved.value }));

const TEMPLATE = "{id}.mso.rahmanef.com";

/** Env is read at module load, so each case needs a fresh module graph. */
async function loadProxy(template: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  return (await import("./proxy")).proxy;
}

/** As it arrives from Traefik: passHostHeader:true, so Host is the public name. */
function req(host: string, path: string, headers: Record<string, string> = {}): NextRequest {
  const h = new Headers(headers);
  h.set("host", host);
  return new NextRequest(`https://${host}${path}`, { headers: h });
}

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");

// A Next route handler cannot service an Upgrade, so before this the OpenClaw
// dashboard's gateway socket had nowhere to land and every one of its feature
// windows opened on a terminal instead — one PTY per menu entry. The transport is a
// rewrite whose destination origin differs from this server's, which Next proxies
// rather than resolving internally, upgrade and all.
describe("WebSocket upgrade on an app host", () => {
  const SECRET = "x".repeat(48);
  const GATEWAY = "http://127.0.0.1:18789";

  /** A real signed cookie — the branch verifies the HMAC, so a placeholder won't do. */
  function session(): string {
    const now = Date.now();
    return signSession({ issued_at: now, expires_at: now + 3_600_000, device_id: "dev-1" }, SECRET);
  }

  function upgradeReq(host: string, path = "/", cookie?: string) {
    const headers: Record<string, string> = { upgrade: "websocket", connection: "Upgrade" };
    if (cookie) headers.cookie = `session=${cookie}`;
    return req(host, path, headers);
  }

  async function load() {
    vi.stubEnv("OS_SESSION_SECRET", SECRET);
    vi.stubEnv("OPENCLAW_DASHBOARD_URL", GATEWAY);
    approved.value = true;
    return loadProxy(TEMPLATE);
  }

  it("hands an authenticated upgrade to the app's own loopback gateway", async () => {
    const proxy = await load();
    const res = await proxy(upgradeReq("openclaw.mso.rahmanef.com", "/chat?tab=1", session()));
    // Cross-origin destination = Next proxies it; that fork IS the transport.
    expect(rewriteOf(res)).toBe(`${GATEWAY}/chat?tab=1`);
  });

  it("refuses an upgrade carrying no session — nothing downstream would have", async () => {
    const proxy = await load();
    const res = await proxy(upgradeReq("openclaw.mso.rahmanef.com"));
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBeNull();
  });

  it("refuses a forged cookie, and a real one whose device was revoked", async () => {
    const proxy = await load();
    expect((await proxy(upgradeReq("openclaw.mso.rahmanef.com", "/", "not-a-real-cookie"))).status).toBe(404);
    // Valid HMAC is not enough: revoking a device must kill its live sockets too.
    approved.value = false;
    expect((await proxy(upgradeReq("openclaw.mso.rahmanef.com", "/", session()))).status).toBe(404);
  });

  it("refuses to relay off-box when the gateway env points somewhere public", async () => {
    vi.stubEnv("OPENCLAW_DASHBOARD_URL", "http://10.0.0.9:18789");
    vi.stubEnv("OS_SESSION_SECRET", SECRET);
    approved.value = true;
    const proxy = await loadProxy(TEMPLATE);
    expect((await proxy(upgradeReq("openclaw.mso.rahmanef.com", "/", session()))).status).toBe(404);
  });

  it("leaves the cockpit host alone — the branch is app-hosts only", async () => {
    const proxy = await load();
    const res = await proxy(upgradeReq("mso.rahmanef.com", "/apps", session()));
    // Not merely "not the gateway" — the cockpit is not rewritten at all, so a
    // session-bearing upgrade there can never become a relay into an agent.
    expect(rewriteOf(res)).toBeNull();
  });

  it("does not fire for an ordinary request that merely mentions upgrade", async () => {
    const proxy = await load();
    const res = await proxy(
      req("openclaw.mso.rahmanef.com", "/chat", { upgrade: "h2c", cookie: `session=${session()}` }),
    );
    expect(rewriteOf(res)).toContain("/api/v1/managed-apps/openclaw/proxy");
  });
});

// Hermes and OpenClaw are separate projects whose upgrade assumptions are opposite,
// so what goes upstream is per-app. These pin the difference: a future "tidy-up" that
// unifies them breaks a test instead of a dashboard.
describe("per-app upgrade adapters", () => {
  const SECRET = "y".repeat(48);

  function signed(): string {
    const now = Date.now();
    return signSession({ issued_at: now, expires_at: now + 3_600_000, device_id: "dev-1" }, SECRET);
  }

  async function upstream(host: string, path: string, extra: Record<string, string> = {}) {
    vi.stubEnv("OS_SESSION_SECRET", SECRET);
    vi.stubEnv("HERMES_DASHBOARD_URL", "http://127.0.0.1:9119");
    vi.stubEnv("OPENCLAW_DASHBOARD_URL", "http://127.0.0.1:18789");
    approved.value = true;
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req(host, path, {
      upgrade: "websocket", connection: "Upgrade",
      cookie: `session=${signed()}`, origin: `https://${host}`,
      "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https",
      ...extra,
    }));
    const header = (name: string) => res.headers.get(`x-middleware-request-${name}`);
    return { rewrite: rewriteOf(res), header };
  }

  it("never relays the cockpit session cookie into an agent process", async () => {
    // OS_SESSION_COOKIE_DOMAIN widens that cookie to the app hosts, so the browser
    // sends it here. The HTTP path has always stripped it; the upgrade did not.
    for (const host of ["hermes.mso.rahmanef.com", "openclaw.mso.rahmanef.com"]) {
      expect((await upstream(host, "/")).header("cookie")).toBeNull();
    }
  });

  it("presents Hermes the loopback Host/Origin its rebinding guard demands", async () => {
    const { rewrite, header } = await upstream("hermes.mso.rahmanef.com", "/api/pty?ticket=t1&channel=c");
    expect(rewrite).toBe("http://127.0.0.1:9119/api/pty?ticket=t1&channel=c");
    // This assertion used to be the exact opposite, on the premise that Hermes binds
    // 0.0.0.0 and accepts any Origin. It binds 127.0.0.1, and FastAPI runs no HTTP
    // middleware for WebSocket routes, so Hermes repeats the DNS-rebinding check
    // inside the handler (_ws_host_origin_reason) and closed every chat socket 4403 →
    // "connection interrupted (code 1006)", reconnecting forever, while every plain
    // fetch on the same page worked.
    expect(header("host")).toBe("127.0.0.1:9119");
    expect(header("origin")).toBe("http://127.0.0.1:9119");
    // The query is untouched: ?token= / ?ticket= is the actual credential, which is
    // also why rewriting these two headers gives an attacker nothing.
    expect(header("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("presents OpenClaw the REAL browser origin, so an allowlist entry can match it", async () => {
    const { rewrite, header } = await upstream("openclaw.mso.rahmanef.com", "/chat");
    expect(rewrite).toBe("http://127.0.0.1:18789/chat");
    // Rewriting this to the loopback origin looked like consistency with the HTTP
    // path and was the opposite of a fix: OpenClaw matches its allowedOrigins against
    // the origin AS PRESENTED, so a rewritten one is exactly what would stop the
    // operator adding this host to that list from working.
    expect(header("origin")).toBe("https://openclaw.mso.rahmanef.com");
  });});

// The Camoufox VNC bridge — noVNC over websockify in front of x11vnc, i.e. live
// keyboard and mouse on a real browser session. It was hard-403'd because its only
// gate had been a check that a cookie NAMED "session" existed, which any value
// satisfied. It is open again only behind the verified check, so these tests are the
// difference between a browser app and an unauthenticated remote-control relay.
describe("the camoufox VNC bridge", () => {
  const SECRET = "y".repeat(48);
  const NOVNC = "http://127.0.0.1:6080";

  function session(secret = SECRET): string {
    const now = Date.now();
    return signSession({ issued_at: now, expires_at: now + 3_600_000, device_id: "dev-1" }, secret);
  }

  async function load(novnc = NOVNC) {
    vi.stubEnv("OS_SESSION_SECRET", SECRET);
    vi.stubEnv("CAMOUFOX_NOVNC_URL", novnc);
    approved.value = true;
    // Single-origin mode: the bridge lives on the cockpit host, not an app host.
    return loadProxy("");
  }

  const vnc = (cookie?: string, path = "/camoufox-vnc/vnc_lite.html", extra: Record<string, string> = {}) =>
    req("mso.rahmanef.com", path, cookie ? { cookie: `session=${cookie}`, ...extra } : extra);

  it("404s a request with no cookie at all", async () => {
    const proxy = await load();
    const res = await proxy(vnc());
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBeNull();
  });

  it("404s the forged cookie the old gate accepted", async () => {
    const proxy = await load();
    // `Cookie: session=anything` — this exact request used to reach websockify.
    const res = await proxy(vnc("anything"));
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBeNull();
  });

  it("404s a cookie signed with the wrong secret", async () => {
    const proxy = await load();
    const res = await proxy(vnc(session("z".repeat(48))));
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBeNull();
  });

  it("404s a valid signature once the device is no longer approved", async () => {
    const proxy = await load();
    approved.value = false;
    const res = await proxy(vnc(session()));
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBeNull();
  });

  it("rewrites an authenticated request to loopback websockify, prefix stripped", async () => {
    const proxy = await load();
    const res = await proxy(vnc(session()));
    const target = new URL(rewriteOf(res)!);
    expect(target.origin).toBe(NOVNC);
    expect(target.pathname).toBe("/vnc_lite.html"); // the /camoufox-vnc prefix is ours, not websockify's
  });

  it("carries the query string, which is where noVNC's socket path lives", async () => {
    const proxy = await load();
    const res = await proxy(vnc(session(), "/camoufox-vnc/vnc_lite.html?path=camoufox-vnc/websockify&scale=true"));
    expect(new URL(rewriteOf(res)!).search).toBe("?path=camoufox-vnc/websockify&scale=true");
  });

  it("carries an authenticated upgrade — noVNC is dead without the socket", async () => {
    const proxy = await load();
    const res = await proxy(
      vnc(session(), "/camoufox-vnc/websockify", { upgrade: "websocket", connection: "Upgrade" }),
    );
    expect(new URL(rewriteOf(res)!).pathname).toBe("/websockify");
  });

  it("refuses an off-box destination — an env typo must not make this an open relay", async () => {
    const proxy = await load("http://evil.example");
    const res = await proxy(vnc(session()));
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBeNull();
  });
});

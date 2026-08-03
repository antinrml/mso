// Middleware host gating. Two modes, and BOTH are load-bearing:
//  • split origin (NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE set) — on an app host
//    every path becomes that app's proxy and nothing else is reachable. That
//    gating is what makes the widened session cookie safe on those hosts, so the
//    "cockpit is unreachable" cases below are security tests, not routing tests.
//  • single origin (unset) — dev, demo and the rollback path, unchanged.
// A middleware rewrite is asserted through the response contract Next uses for it:
// `x-middleware-rewrite` for the destination and `x-middleware-request-*` for the
// request headers handed to the route.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";


const TEMPLATE = "{id}.mso.rahmanef.com";
const HERMES = "/api/v1/managed-apps/hermes/proxy";
const APP_HOST_HEADER = "x-os-managed-app-host";

/** Env is read at module load, so each mode needs a fresh module graph. */
async function loadProxy(template: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  return (await import("./proxy")).proxy;
}

/** As it arrives from Traefik: passHostHeader:true, so Host is the public name. */
function req(
  host: string,
  path: string,
  init: { method?: string; headers?: HeadersInit; body?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  return new NextRequest(`https://${host}${path}`, { ...init, headers });
}

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");
const stampedHost = (res: Response) => res.headers.get(`x-middleware-request-${APP_HOST_HEADER}`);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("app host → that app's proxy, and nothing else", () => {
  it.each([
    ["/", HERMES],
    ["/login", `${HERMES}/login`],
    ["/assets/index-CEmUNp2y.js", `${HERMES}/assets/index-CEmUNp2y.js`],
    // Next 308s a trailing slash away; that redirect would come back to this host
    // and be rewritten a SECOND time, one prefix deeper.
    ["/sessions/", `${HERMES}/sessions`],
  ])("rewrites %s into the proxy", async (path, expected) => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req("hermes.mso.rahmanef.com", path));
    expect(new URL(rewriteOf(res)!).pathname).toBe(expected);
  });

  it("preserves the query string", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req("hermes.mso.rahmanef.com", "/login?next=%2Fchat"));
    expect(rewriteOf(res)).toBe(`https://hermes.mso.rahmanef.com${HERMES}/login?next=%2Fchat`);
  });

  it("routes each host to its OWN app — one origin per app, never a shared one", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req("openclaw.mso.rahmanef.com", "/chat"));
    expect(new URL(rewriteOf(res)!).pathname).toBe("/api/v1/managed-apps/openclaw/proxy/chat");
    expect(stampedHost(res)).toBe("openclaw");
  });

  // The cockpit surface must not merely be un-linked here, it must not ANSWER: the
  // session cookie is sent to this host, so /api/v1/exec/run would run commands.
  it.each([
    ["the exec API", "/api/v1/exec/run"],
    ["the auth API", "/api/auth/login"],
    ["the device API", "/api/auth/devices"],
    ["a cockpit page", "/settings"],
    ["the service worker", "/sw.js"],
  ])("sends %s into the app proxy instead of the cockpit", async (_label, path) => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req("hermes.mso.rahmanef.com", path, { headers: { "sec-fetch-site": "same-origin" } }));
    const rewritten = new URL(rewriteOf(res)!).pathname;
    expect(rewritten).toBe(`${HERMES}${path}`);
    // Whatever the upstream answers, it is not the cockpit route of that name.
    expect(rewritten.startsWith(`${HERMES}/`)).toBe(true);
  });

  // The matcher cannot exclude by host, and a rewrite cannot fire for a path
  // middleware never sees — so the exclusions were dropped and these are blocked
  // here. No dashboard serves /_next/*; it is only ever the cockpit's namespace.
  it.each(["/_next/static/chunks/main.js", "/_next/image?url=%2Fx.png", "/_next"])(
    "404s %s on an app host",
    async (path) => {
      const proxy = await loadProxy(TEMPLATE);
      const res = await proxy(req("hermes.mso.rahmanef.com", path));
      expect(res.status).toBe(404);
      expect(rewriteOf(res)).toBeNull();
    },
  );

  // Hermes' index.html links `/favicon.ico`, so this one belongs to the app.
  it("still proxies /favicon.ico, which the dashboard serves itself", async () => {
    const proxy = await loadProxy(TEMPLATE);
    expect(new URL(rewriteOf(await proxy(req("hermes.mso.rahmanef.com", "/favicon.ico")))!).pathname).toBe(
      `${HERMES}/favicon.ico`,
    );
  });

  it("never stamps the cockpit document policy on an app host", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req("hermes.mso.rahmanef.com", "/"));
    // The route sets its own, scoped to the app origin — see proxy-csp.ts.
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-nonce")).toBeNull();
  });

  it("overwrites a client-supplied copy of the app-host header", async () => {
    const proxy = await loadProxy(TEMPLATE);
    // Forged, it would buy root-mounted mode: upstream cookies at Path=/ and a
    // policy naming the cockpit as a legal framer.
    const res = await proxy(req("hermes.mso.rahmanef.com", "/", { headers: { [APP_HOST_HEADER]: "openclaw" } }));
    expect(stampedHost(res)).toBe("hermes");
  });

  it("leaves a host that is not an app host on the cockpit", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req("mso.rahmanef.com", "/apps"));
    expect(rewriteOf(res)).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("ignores x-forwarded-host, which a client can set, in favour of Host", async () => {
    const proxy = await loadProxy(TEMPLATE);
    // Escaping the rewrite is the dangerous direction: this request is ON the app
    // host and claims the cockpit, which would reach /api/v1/exec with a session
    // cookie that IS sent here.
    const res = await proxy(
      req("hermes.mso.rahmanef.com", "/api/v1/exec/run", {
        method: "POST",
        headers: { "x-forwarded-host": "mso.rahmanef.com", "sec-fetch-site": "same-origin" },
      }),
    );
    expect(new URL(rewriteOf(res)!).pathname).toBe(`${HERMES}/api/v1/exec/run`);
  });
});

describe("CSRF depth-2 on an app host", () => {
  // Everything here becomes /api/… only AFTER the rewrite, so the gate has to run
  // before it or it never runs at all.
  it("passes the frame's own same-origin form POST", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(
      req("hermes.mso.rahmanef.com", "/auth/password-login", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(res.status).toBe(200);
    expect(rewriteOf(res)).not.toBeNull();
  });

  it.each([
    ["cross-site", "cross-site"],
    // The cockpit and an app host share a registrable domain, so cockpit JS
    // reaching in is same-SITE — and that reach is what the split removes.
    ["the cockpit origin (same-site)", "same-site"],
  ])("blocks a mutating request from %s", async (_label, site) => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(
      req("hermes.mso.rahmanef.com", "/api/tasks", { method: "POST", headers: { "sec-fetch-site": site } }),
    );
    expect(res.status).toBe(403);
    expect(rewriteOf(res)).toBeNull();
  });

  it("falls back to an Origin host match for non-browser clients", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const ok = await proxy(
      req("hermes.mso.rahmanef.com", "/api/tasks", {
        method: "POST",
        headers: { origin: "https://hermes.mso.rahmanef.com" },
      }),
    );
    expect(rewriteOf(ok)).not.toBeNull();
    const bad = await proxy(
      req("hermes.mso.rahmanef.com", "/api/tasks", { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(bad.status).toBe(403);
  });

  it("still routes a GET, which mutates nothing", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req("hermes.mso.rahmanef.com", "/chat", { headers: { "sec-fetch-site": "cross-site" } }));
    expect(new URL(rewriteOf(res)!).pathname).toBe(`${HERMES}/chat`);
  });
});

// The session cookie is widened to Domain=mso.rahmanef.com, so ANY host under that
// name receives it. A host in the namespace that is not one of the apps must
// therefore 404 rather than serve the cockpit — otherwise adding a DNS record is
// enough to hand a page a fully authenticated cockpit, with no code change at all.
describe("an unclaimed host inside the app namespace serves nothing", () => {
  it.each(["staging.mso.rahmanef.com", "deep.sub.mso.rahmanef.com", "xhermes.mso.rahmanef.com"])("404s %s", async (host) => {
    const proxy = await loadProxy(TEMPLATE);
    for (const path of ["/", "/api/v1/exec/run", "/api/auth/login", "/_next/static/chunks/main.js"]) {
      const res = await proxy(req(host, path));
      expect(res.status).toBe(404);
      expect(rewriteOf(res)).toBeNull();
    }
  });

  it("refuses only the namespace: the cockpit, its siblings and single-origin mode all still serve", async () => {
    const split = await loadProxy(TEMPLATE);
    for (const host of ["mso.rahmanef.com", "api-mso.rahmanef.com", "rahmanef.com"]) {
      expect((await split(req(host, "/files"))).status).toBe(200);
    }
    const single = await loadProxy("");
    expect((await single(req("staging.mso.rahmanef.com", "/files"))).status).toBe(200);
  });
});

describe("single-origin mode (template unset) is unchanged", () => {
  it("stamps a nonce + document policy on a page", async () => {
    const proxy = await loadProxy("");
    const res = await proxy(req("mso.rahmanef.com", "/files"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });

  it("waves through the paths the matcher used to exclude, with no policy", async () => {
    const proxy = await loadProxy("");
    for (const path of ["/_next/static/chunks/main.js", "/_next/image?url=%2Fx.png", "/favicon.ico"]) {
      const res = await proxy(req("mso.rahmanef.com", path));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toBeNull();
      expect(res.headers.get("x-middleware-request-x-nonce")).toBeNull();
    }
  });

  it("never treats an app-shaped host as an app host", async () => {
    const proxy = await loadProxy("");
    const res = await proxy(req("hermes.mso.rahmanef.com", "/"));
    expect(rewriteOf(res)).toBeNull();
  });

  it("still blocks a cross-site mutating /api and leaves reads alone", async () => {
    const proxy = await loadProxy("");
    const blocked = await proxy(
      req("mso.rahmanef.com", "/api/v1/exec/run", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }),
    );
    expect(blocked.status).toBe(403);
    const read = await proxy(req("mso.rahmanef.com", "/api/v1/sys/status"));
    expect(read.status).toBe(200);
    expect(read.headers.get("content-security-policy")).toBeNull();
  });

  // Full coverage of this bridge (forged cookie, revoked device, upgrade, off-box
  // destination) lives in proxy-websocket.test.ts, which has the session harness.
  it("does not let an unverified cookie near the camoufox VNC bridge", async () => {
    const proxy = await loadProxy("");
    const res = await proxy(req("mso.rahmanef.com", "/camoufox-vnc/", { headers: { cookie: "session=anything" } }));
    expect(res.status).toBe(404);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("the app-host header is never accepted from a client", () => {
  it.each(["", TEMPLATE])("strips an inbound copy on the cockpit origin (template %s)", async (template) => {
    const proxy = await loadProxy(template);
    // Reaching the proxy route with this header set would restore root-mounted mode
    // at the old same-origin URL — cookies at Path=/ and the cockpit named as a
    // permitted framer, i.e. exactly the hole the split closes.
    const res = await proxy(
      req("mso.rahmanef.com", `${HERMES}/chat`, { headers: { [APP_HOST_HEADER]: "hermes" } }),
    );
    expect(stampedHost(res)).toBeNull();
    expect(res.headers.get("x-middleware-override-headers") ?? "").not.toContain(APP_HOST_HEADER);
  });

  it("strips it from a cockpit document request too", async () => {
    const proxy = await loadProxy(TEMPLATE);
    const res = await proxy(req("mso.rahmanef.com", "/apps", { headers: { [APP_HOST_HEADER]: "hermes" } }));
    expect(stampedHost(res)).toBeNull();
  });
});

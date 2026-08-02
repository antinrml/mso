// Policy scoping + redirect plumbing for the managed-app proxy, unit-tested
// straight off the pure helpers (the policy itself is proxy-csp.test.ts; the route
// wiring is covered in app/api/v1/managed-apps/proxy.test.ts).
import { afterEach, describe, expect, it } from "vitest";
import {
  PROXY_BLOCKED_EXTERNALS,
  buildUpstreamHeaders,
  isServiceWorkerPath,
  proxyPrefix,
  publicProxyUrl,
  rewriteLocation,
} from "./proxy-headers";

const PREFIX = proxyPrefix("hermes");
const PREFIX_URL = `https://os.rahmanef.com${PREFIX}/`;

describe("publicProxyUrl", () => {
  afterEach(() => {
    delete process.env.OS_PUBLIC_ORIGIN;
  });

  it("prefers OS_PUBLIC_ORIGIN over anything a request can carry", () => {
    process.env.OS_PUBLIC_ORIGIN = "https://os.rahmanef.com";
    const spoofed = new Request(`http://localhost:4005${PREFIX}/chat`, {
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", host: "evil.example" },
    });
    expect(publicProxyUrl(spoofed, "hermes")).toBe(PREFIX_URL);
  });

  it("ignores a malformed OS_PUBLIC_ORIGIN instead of emitting junk", () => {
    process.env.OS_PUBLIC_ORIGIN = "os.rahmanef.com";
    const req = new Request(`http://localhost:4005${PREFIX}/chat`, { headers: { host: "os.rahmanef.com" } });
    expect(publicProxyUrl(req, "hermes")).toBe(`http://os.rahmanef.com${PREFIX}/`);
  });

  it("trusts the real Host header over a client-settable X-Forwarded-Host", () => {
    const spoofed = new Request(`http://localhost:4005${PREFIX}/chat`, {
      headers: { host: "os.rahmanef.com", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    });
    // The host decides which origin the whole policy is scoped to.
    expect(publicProxyUrl(spoofed, "hermes")).toBe(PREFIX_URL);
  });

  it("uses the hop the browser made, not the plain-http hop from Traefik", () => {
    const req = new Request(`http://localhost:4005${PREFIX}/chat`, {
      headers: { "x-forwarded-proto": "https,http", "x-forwarded-host": "os.rahmanef.com" },
    });
    expect(publicProxyUrl(req, "hermes")).toBe(PREFIX_URL);
  });

  it("falls back to the Host header, then to the request URL", () => {
    const withHost = new Request(`http://localhost:4005${PREFIX}/chat`, { headers: { host: "os.rahmanef.com" } });
    expect(publicProxyUrl(withHost, "hermes")).toBe(`http://os.rahmanef.com${PREFIX}/`);
    expect(publicProxyUrl(new Request(`http://localhost:4005${PREFIX}/chat`), "hermes")).toBe(
      `http://localhost:4005${PREFIX}/`,
    );
  });
});

describe("buildUpstreamHeaders", () => {
  const base = new URL("http://127.0.0.1:9119");
  const withHeaders = (init: Record<string, string>) =>
    new Request("https://hermes.os.rahmanef.com/api/config", { headers: init });

  it("forwards Hermes' own session token, because dropping it 401s every fetch", () => {
    // Loopback Hermes injects an ephemeral token into the SPA HTML and requires it
    // back as X-Hermes-Session-Token. Stripping it renders the shell and no data —
    // the exact failure this test exists to keep out.
    const out = buildUpstreamHeaders(withHeaders({ "x-hermes-session-token": "tok" }), base, "hermes");
    expect(out.get("x-hermes-session-token")).toBe("tok");
  });

  it("does not lend that header to a different app's upstream", () => {
    const out = buildUpstreamHeaders(withHeaders({ "x-hermes-session-token": "tok" }), base, "openclaw");
    expect(out.get("x-hermes-session-token")).toBeNull();
  });

  it("still refuses to relay Authorization for anyone", () => {
    // Unlike the token above, this one a browser attaches by itself once prompted.
    const out = buildUpstreamHeaders(withHeaders({ authorization: "Basic abc" }), base, "hermes");
    expect(out.get("authorization")).toBeNull();
  });

  it("keeps the cockpit session cookie on this side of the boundary", () => {
    const out = buildUpstreamHeaders(
      withHeaders({ cookie: "session=cockpit; mapp_hermes_hermes_session_at=upstream" }),
      base,
      "hermes",
    );
    expect(out.get("cookie")).toBe("hermes_session_at=upstream");
  });
});

describe("PROXY_BLOCKED_EXTERNALS", () => {
  it("names what nothing grants, and nothing the upstream policy already declares", () => {
    const hosts = PROXY_BLOCKED_EXTERNALS.map((entry) => entry.host);
    // Hermes ships no policy of its own, so its Google Fonts sheet has no source
    // to be honoured from; OpenClaw calls generativelanguage without declaring it.
    expect(hosts).toEqual(["fonts.googleapis.com", "generativelanguage.googleapis.com"]);
    // Honoured by the intersection now (OpenClaw's own connect-src lists them).
    expect(hosts).not.toContain("api.openai.com");
    expect(hosts).not.toContain("tweakcn.com");
    for (const entry of PROXY_BLOCKED_EXTERNALS) {
      expect(["style-src", "connect-src"]).toContain(entry.directive);
      expect(entry.effect.length).toBeGreaterThan(0);
    }
  });
});

describe("isServiceWorkerPath", () => {
  it("catches the script OpenClaw actually registers, at any depth", () => {
    expect(isServiceWorkerPath(["sw.js"])).toBe(true);
    expect(isServiceWorkerPath(["control-ui", "sw.js"])).toBe(true);
    expect(isServiceWorkerPath(["SW.JS"])).toBe(true);
    expect(isServiceWorkerPath(["service-worker.js"])).toBe(true);
    expect(isServiceWorkerPath(["serviceworker.js"])).toBe(true);
  });

  it("leaves ordinary assets alone", () => {
    expect(isServiceWorkerPath([])).toBe(false);
    expect(isServiceWorkerPath(["assets", "index-CEmUNp2y.js"])).toBe(false);
    expect(isServiceWorkerPath(["sw.js", "chat"])).toBe(false);
    expect(isServiceWorkerPath(["assets", "swift-BTPQlRLK.js"])).toBe(false);
  });
});

describe("rewriteLocation", () => {
  const base = new URL("http://127.0.0.1:9119");
  const target = new URL("http://127.0.0.1:9119/chat");

  it("re-bases a same-origin hop onto the proxy prefix", () => {
    expect(rewriteLocation("/login?next=%2F", target, base, "hermes")).toBe(
      `${PREFIX}/login?next=%2F`,
    );
    expect(rewriteLocation("http://127.0.0.1:9119/chat", target, base, "hermes")).toBe(
      `${PREFIX}/chat`,
    );
  });

  it("re-bases a relative Location against the URL actually requested", () => {
    const deep = new URL("http://127.0.0.1:9119/chat/threads");
    expect(rewriteLocation("42", deep, base, "hermes")).toBe(`${PREFIX}/chat/42`);
  });

  it("refuses an absolute off-origin Location instead of relaying it", () => {
    // Emitting this turns the proxy into an open redirect, and per CSP3
    // §6.6.2.6 path matching stops applying after the first hop.
    expect(rewriteLocation("https://accounts.google.com/o/oauth2/auth?client_id=x", target, base, "hermes")).toBeNull();
  });

  it("refuses a protocol-relative Location, the cheapest open-redirect payload", () => {
    expect(rewriteLocation("//evil.example", target, base, "hermes")).toBeNull();
    expect(rewriteLocation("//evil.example/path?a=b", target, base, "hermes")).toBeNull();
  });

  it("refuses a neighbouring loopback port — same host is not same origin", () => {
    expect(rewriteLocation("//127.0.0.1:1234", target, base, "hermes")).toBeNull();
    expect(rewriteLocation("http://127.0.0.1:1234/admin", target, base, "hermes")).toBeNull();
  });

  it("refuses a scheme that is not the upstream's, and keeps junk inside the prefix", () => {
    // javascript:/data: resolve to an opaque origin, so the origin check refuses them.
    expect(rewriteLocation("javascript:alert(1)", target, base, "hermes")).toBeNull();
    expect(rewriteLocation("data:text/html,<script>1</script>", target, base, "hermes")).toBeNull();
    // A malformed value the browser would treat as a relative path stays a relative
    // path — inside the prefix, which is the property that matters.
    expect(rewriteLocation("::nonsense", target, base, "hermes")).toBe(`${PREFIX}/::nonsense`);
  });

  it("treats an empty Location as no redirect at all", () => {
    // Resolves to the request target itself; the route never calls it (falsy),
    // but if it ever did, the answer must stay inside the prefix.
    expect(rewriteLocation("", target, base, "hermes")).toBe(`${PREFIX}/chat`);
  });
});

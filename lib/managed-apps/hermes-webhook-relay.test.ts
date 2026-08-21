import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TEMPLATE = "{id}.mso.rahmanef.com";
const HERMES = "/api/v1/managed-apps/hermes/proxy";
const TARGET = "http://127.0.0.1:8644/webhooks/antinrml-website";

async function loadProxy() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", TEMPLATE);
  return (await import("../../proxy")).proxy;
}

function req(host: string, path: string, init: { method?: string; headers?: HeadersInit; body?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  return new NextRequest(`https://${host}${path}`, { ...init, headers });
}

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");

afterEach(() => vi.unstubAllEnvs());

describe("Hermes signed website webhook relay", () => {
  it("relays only the exact Hermes POST path to loopback before the app-host CSRF gate", async () => {
    const proxy = await loadProxy();
    const res = await proxy(req("hermes.mso.rahmanef.com", "/webhooks/antinrml-website", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-webhook-signature-v2": "a".repeat(64),
      },
      body: "{}",
    }));
    expect(rewriteOf(res)).toBe(TARGET);
  });

  it("rejects malformed or stale machine-auth headers before loopback", async () => {
    const proxy = await loadProxy();
    const cases = [
      { "content-type": "text/plain", "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)), "x-webhook-signature-v2": "a".repeat(64) },
      { "content-type": "application/json", "x-webhook-timestamp": String(Math.floor(Date.now() / 1000) - 301), "x-webhook-signature-v2": "a".repeat(64) },
      { "content-type": "application/json", "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)), "x-webhook-signature-v2": "deadbeef" },
    ];
    for (const headers of cases) {
      const res = await proxy(req("hermes.mso.rahmanef.com", "/webhooks/antinrml-website", {
        method: "POST", headers: { ...headers, "sec-fetch-site": "cross-site" }, body: "{}",
      }));
      expect(rewriteOf(res)).not.toBe(TARGET);
      expect(res.status).toBe(403);
    }
  });

  it("does not turn other Hermes webhook paths into a public relay", async () => {
    const proxy = await loadProxy();
    const res = await proxy(req("hermes.mso.rahmanef.com", "/webhooks/anything-else", {
      method: "POST", headers: { "sec-fetch-site": "cross-site" }, body: "{}",
    }));
    expect(res.status).toBe(403);
    expect(rewriteOf(res)).toBeNull();
  });

  it("keeps GET on the normal authenticated Hermes app proxy", async () => {
    const proxy = await loadProxy();
    const res = await proxy(req("hermes.mso.rahmanef.com", "/webhooks/antinrml-website"));
    expect(new URL(rewriteOf(res)!).pathname).toBe(`${HERMES}/webhooks/antinrml-website`);
  });

  it("never exposes the relay on OpenClaw or the cockpit host", async () => {
    const proxy = await loadProxy();
    for (const host of ["openclaw.mso.rahmanef.com", "mso.rahmanef.com"]) {
      const res = await proxy(req(host, "/webhooks/antinrml-website", {
        method: "POST", headers: { "sec-fetch-site": "cross-site" }, body: "{}",
      }));
      expect(rewriteOf(res)).not.toBe(TARGET);
    }
  });
});

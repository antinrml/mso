// OS_SESSION_COOKIE_DOMAIN widens the session cookie to every host under a
// domain, so the validator is a security boundary, not cosmetics: anything it
// waves through lands verbatim in a Set-Cookie header, and anything it wrongly
// rejects only falls back to today's host-only cookie (fail closed).
import { afterEach, describe, expect, it } from "vitest";
import { hostOnlyClearHeader, sessionCookieAttrs, sessionCookieDomain } from "./session-cookie";

const req = (host: string, forwarded?: string) =>
  new Request("http://internal/api/auth/login", {
    method: "POST",
    headers: { host, ...(forwarded ? { "x-forwarded-host": forwarded } : {}) },
  });

const domainFor = (value: string | undefined, host = "os.rahmanef.com") => {
  if (value === undefined) delete process.env.OS_SESSION_COOKIE_DOMAIN;
  else process.env.OS_SESSION_COOKIE_DOMAIN = value;
  return sessionCookieDomain(req(host));
};

afterEach(() => {
  delete process.env.OS_SESSION_COOKIE_DOMAIN;
});

describe("sessionCookieDomain", () => {
  it("is host-only when unset or blank", () => {
    expect(domainFor(undefined)).toBeUndefined();
    expect(domainFor("")).toBeUndefined();
    expect(domainFor("   ")).toBeUndefined();
  });

  it("widens to the configured domain on the cockpit host", () => {
    expect(domainFor("os.rahmanef.com")).toBe("os.rahmanef.com");
  });

  it("widens on the split-origin app hosts (the whole point)", () => {
    expect(domainFor("os.rahmanef.com", "hermes.os.rahmanef.com")).toBe("os.rahmanef.com");
    expect(domainFor("os.rahmanef.com", "openclaw.os.rahmanef.com")).toBe("os.rahmanef.com");
  });

  it("normalises a leading dot, casing, port and trailing dot", () => {
    expect(domainFor(".OS.Rahmanef.com", "HERMES.os.rahmanef.com.:4005")).toBe("os.rahmanef.com");
  });

  it.each([
    ["os.rahmanef.com; Path=/", "attribute smuggling"],
    ["os.rahmanef.com Path=/", "space"],
    ["os_rahmanef.com", "underscore"],
    ["-bad.com", "leading hyphen"],
    ["bad-.com", "trailing hyphen"],
    ["com", "single label / public suffix"],
    ["localhost", "single label"],
    ["1.2.3.4", "IPv4 literal"],
    ["os..rahmanef.com", "empty label"],
    ["os.rah\nmanef.com", "interior control char"],
    ["ötzi.rahmanef.com", "non-ASCII (must be punycode)"],
  ])("fails closed to host-only for %s (%s)", (value) => {
    expect(domainFor(value, "hermes.os.rahmanef.com")).toBeUndefined();
  });

  it("tolerates surrounding whitespace from a hand-edited env file", () => {
    expect(domainFor(" os.rahmanef.com\n")).toBe("os.rahmanef.com");
  });

  it("fails closed when a label or the whole name is over length", () => {
    const long = (labels: number) => `${`${"a".repeat(60)}.`.repeat(labels)}com`;
    expect(domainFor(`${"a".repeat(64)}.com`, `x.${"a".repeat(64)}.com`)).toBeUndefined();
    // 4 × 61 + 3 = 247 chars is legal; 5 × 61 + 3 = 308 is over the 253 cap.
    expect(domainFor(long(4), long(4))).toBe(long(4));
    expect(domainFor(long(5), long(5))).toBeUndefined();
  });

  it("fails closed when the request host does not domain-match", () => {
    // Otherwise the browser drops the whole Set-Cookie and login 200s with no
    // session — a login loop with no error anywhere.
    expect(domainFor("os.rahmanef.com", "76.13.23.37")).toBeUndefined();
    expect(domainFor("os.rahmanef.com", "localhost")).toBeUndefined();
    // Suffix without a dot boundary is NOT a subdomain (RFC 6265 §5.1.3).
    expect(domainFor("os.rahmanef.com", "notos.rahmanef.com")).toBeUndefined();
  });

  it("ignores x-forwarded-host while a real Host header is present", () => {
    // Host wins, so a client-settable header cannot steer the decision.
    process.env.OS_SESSION_COOKIE_DOMAIN = "os.rahmanef.com";
    expect(sessionCookieDomain(req("os.rahmanef.com", "evil.example"))).toBe("os.rahmanef.com");
  });
});

describe("sessionCookieAttrs", () => {
  it("keeps the host-only attribute set unchanged when no domain is configured", () => {
    delete process.env.OS_SESSION_COOKIE_DOMAIN;
    expect(sessionCookieAttrs(req("os.rahmanef.com"), 86_400)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 86_400,
    });
  });

  it("adds only the Domain when configured — SameSite stays strict", () => {
    // Strict is correct across the app hosts: SameSite is per SITE (registrable
    // domain), and os.rahmanef.com / hermes.os.rahmanef.com share rahmanef.com.
    process.env.OS_SESSION_COOKIE_DOMAIN = "os.rahmanef.com";
    expect(sessionCookieAttrs(req("os.rahmanef.com"), 0)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
      domain: "os.rahmanef.com",
    });
  });
});

describe("hostOnlyClearHeader", () => {
  it("carries no Domain, so it targets the pre-widening cookie", () => {
    const header = hostOnlyClearHeader("session");
    expect(header).toBe("session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
    expect(header.toLowerCase()).not.toContain("domain");
  });
});

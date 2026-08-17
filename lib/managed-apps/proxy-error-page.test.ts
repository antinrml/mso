// The proxy's failures have two audiences and must not be readable to only one of them:
// a human reading the app window's frame, and the upstream SPA's own fetch() landing on
// the same route. These pin the split and the one hint that exists because a server
// cannot detect the condition it describes.
import { describe, expect, it } from "vitest";
import { errorPage, wantsErrorPage } from "./proxy-error-page";

const req = (headers: Record<string, string>) => new Request("https://hermes.example.com/", { headers });

describe("wantsErrorPage", () => {
  it("serves a page to the frame and to a tab", () => {
    expect(wantsErrorPage(req({ "sec-fetch-dest": "iframe" }))).toBe(true);
    expect(wantsErrorPage(req({ "sec-fetch-dest": "document" }))).toBe(true);
  });

  // The regression that matters: an upstream SPA polling its own API must keep receiving
  // JSON, and its requests carry `Accept: */*` with dest `empty`.
  it("leaves the upstream's own requests on JSON", () => {
    expect(wantsErrorPage(req({ "sec-fetch-dest": "empty", accept: "*/*" }))).toBe(false);
    expect(wantsErrorPage(req({ "sec-fetch-dest": "script" }))).toBe(false);
  });

  // Fetch Metadata wins over Accept when both are present: a browser navigating to a
  // JS chunk sends `Accept: */*` but also dest=script, and a page there would be wrong.
  it("prefers Sec-Fetch-Dest over Accept, and errs toward JSON without either", () => {
    expect(wantsErrorPage(req({ "sec-fetch-dest": "style", accept: "text/html" }))).toBe(false);
    expect(wantsErrorPage(req({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(wantsErrorPage(req({}))).toBe(false);
  });
});

describe("errorPage", () => {
  // The whole reason this module exists. A session issued before OS_SESSION_COOKIE_DOMAIN
  // was set is host-only and is never sent to the app host; the server cannot tell that
  // from "never logged in", so the page has to say it.
  it("tells a 401 to sign in again, because nothing else can", () => {
    const html = errorPage("unauthorized", 401);
    expect(html).toContain("Sign out of the cockpit and sign in again");
    expect(html).toContain("OS_SESSION_COOKIE_DOMAIN");
  });

  it("names the rebuild when the deployment serves no dashboards", () => {
    const html = errorPage("managed application dashboards are not served on this origin", 404);
    expect(html).toContain("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE");
    expect(html).toContain("REBUILD");
  });

  it("still renders a failure it has no hint for", () => {
    const html = errorPage("invalid upstream path", 400);
    expect(html).toContain("invalid upstream path");
    expect(html).toContain("HTTP 400");
  });

  // The page is served under `default-src 'none'`, so anything it referenced would be
  // blocked. It must stay self-contained rather than quietly render as a blank frame.
  it("carries no script, style or external reference the policy would block", () => {
    const html = errorPage("unauthorized", 401);
    expect(html).not.toMatch(/<script|<link|<style|style=|https?:\/\//);
  });

  it("escapes the failure string rather than trusting it as markup", () => {
    expect(errorPage('<img src=x onerror="1">', 400)).not.toContain("<img");
  });
});

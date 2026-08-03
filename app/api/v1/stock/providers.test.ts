import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENVERSE_ANON_MAX_PAGE_SIZE, searchOpenverse } from "./providers";

// Regression: page_size was hardcoded to 24. Openverse allows at most 20 for
// anonymous callers and rejects more with 401, so every stock search 502'd and
// the error blamed credentials we don't even send.
describe("searchOpenverse", () => {
  afterEach(() => vi.unstubAllGlobals());

  const capture = () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      seen.push(String(url));
      return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    });
    return seen;
  };

  it("never asks for more than the anonymous page-size cap", async () => {
    const seen = capture();
    await searchOpenverse("mountain", 1);
    const size = Number(new URL(seen[0]).searchParams.get("page_size"));
    expect(size).toBeLessThanOrEqual(OPENVERSE_ANON_MAX_PAGE_SIZE);
    expect(size).toBeGreaterThan(0);
  });

  it("surfaces the upstream status when the request is rejected", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 401 })));
    await expect(searchOpenverse("mountain", 1)).rejects.toThrow("upstream 401");
  });
});

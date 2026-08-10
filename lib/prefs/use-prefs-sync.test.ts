import { describe, it, expect, vi, afterEach } from "vitest";
import { pullPrefs } from "./use-prefs-sync";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("pullPrefs", () => {
  it("collapses concurrent callers into ONE request", async () => {
    const spy = stubFetch(async () => ok({ tweaks: { a: 1 }, quicklinks: [] }));
    // The two providers (appearance + quicklinks) mount in the same tick.
    const [a, b] = await Promise.all([pullPrefs(), pullPrefs()]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ tweaks: { a: 1 }, quicklinks: [] });
    expect(b).toBe(a);
  });

  it("refetches after settle, so the focus/auth retry still works", async () => {
    const spy = stubFetch(async () => ok({ tweaks: {} }));
    await pullPrefs();
    await pullPrefs();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("resolves null on a non-ok response instead of throwing", async () => {
    stubFetch(async () => new Response("nope", { status: 401 }));
    expect(await pullPrefs()).toBeNull();
  });

  it("resolves null when the network throws", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await pullPrefs()).toBeNull();
  });

  it("resolves null on malformed JSON rather than rejecting", async () => {
    stubFetch(async () => new Response("{not json", { status: 200 }));
    expect(await pullPrefs()).toBeNull();
  });
});

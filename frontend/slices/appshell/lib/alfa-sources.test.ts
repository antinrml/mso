import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level state, so each case gets a fresh copy.
async function fresh() {
  vi.resetModules();
  return import("./alfa-sources");
}

const ITEM = { id: "tool:x", label: "x", insert: "x", kind: "command" as const };

describe("alfa-sources loader", () => {
  beforeEach(() => vi.resetModules());

  it("returns empty sources and starts nothing when no loader is registered", async () => {
    const m = await fresh();
    expect(m.alfaSources().commands()).toEqual([]);
    expect(m.alfaSources().agents()).toEqual([]);
  });

  it("runs the loader on the FIRST alfaSources() call and never again", async () => {
    const m = await fresh();
    const load = vi.fn();
    m.registerAlfaLoader(load);
    m.alfaSources();
    m.alfaSources();
    m.alfaSources();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves what the loader registered, and notifies so the composer re-renders", async () => {
    const m = await fresh();
    const seen = vi.fn();
    m.subscribeAlfaSources(seen);
    // Mirrors production: the real loader awaits a dynamic import first.
    m.registerAlfaLoader(async () => {
      await Promise.resolve();
      m.registerAlfaSources({ agents: () => [], commands: () => [ITEM] });
    });
    expect(m.alfaSources().commands()).toEqual([]); // first paint: chunk not in yet
    await vi.waitFor(() => expect(m.alfaSources().commands()).toEqual([ITEM]));
    expect(seen).toHaveBeenCalled();
  });

  it("re-arms after a failed load, so a dead chunk is not permanent", async () => {
    const m = await fresh();
    const load = vi.fn().mockRejectedValueOnce(new Error("ChunkLoadError"));
    m.registerAlfaLoader(load);
    m.alfaSources();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    m.alfaSources();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bumps the version on every notify, and stops after unsubscribe", async () => {
    const m = await fresh();
    const seen = vi.fn();
    const off = m.subscribeAlfaSources(seen);
    const before = m.alfaSourcesVersion();
    m.notifyAlfaSources();
    expect(m.alfaSourcesVersion()).toBe(before + 1);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    m.notifyAlfaSources();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

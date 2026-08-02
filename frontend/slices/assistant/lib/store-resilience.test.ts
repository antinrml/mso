import { describe, expect, it, vi } from "vitest";

// Two regressions the module-store migration introduced. Both were reproduced by an
// audit before being fixed here, and both are invisible to a normal click-through.

describe("storage access can never throw", () => {
  // A browser that DENIES site data ("Block all cookies", a sandboxed iframe, or
  // dom.storage.enabled=false) makes the localStorage GETTER throw SecurityError —
  // so `typeof localStorage === "undefined"` throws before it can return.
  //
  // This matters more than it looks: the store is on the EAGER client entry chain
  // now (os-root → integrations → installAlfaSources → assistant barrel → store),
  // so a throw here takes the whole cockpit rather than one app window.
  it("survives a localStorage getter that throws, and still yields presets", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
      configurable: true,
    });
    vi.resetModules();
    // The import itself must not reject — that is the whole failure mode.
    const persistMod = await import("./store-persist");
    expect(() => persistMod.loadActive()).not.toThrow();
    expect(() => persistMod.load("alfa.agents", [{ id: "ag_alfa", builtin: true }])).not.toThrow();
    expect(() => persistMod.persist("alfa.agents", [])).not.toThrow();
    expect(persistMod.load("alfa.agents", [{ id: "ag_alfa", builtin: true }])).toHaveLength(1);
    // @ts-expect-error — restore for the next case
    delete globalThis.localStorage;
  });
});

describe("a second tab does not clobber the first", () => {
  it("re-reads the changed key when another tab writes it", async () => {
    const disk: Record<string, string> = {
      "alfa.agents": JSON.stringify([
        { id: "ag_alfa", builtin: true, name: "Alfa", glyph: "sparkles", color: "violet", persona: "p", skills: [], allTools: true },
      ]),
    };
    const listeners: ((e: StorageEvent) => void)[] = [];
    const fake = {
      getItem: (k: string) => disk[k] ?? null,
      setItem: (k: string, v: string) => { disk[k] = v; },
      removeItem: (k: string) => { delete disk[k]; },
      clear: () => {},
    };
    Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true, writable: true });
    vi.stubGlobal("window", {
      addEventListener: (t: string, fn: (e: StorageEvent) => void) => { if (t === "storage") listeners.push(fn); },
      removeEventListener: () => {},
    });
    vi.resetModules();
    const store = await import("./store");
    // mergeBuiltins adds any builtin preset the saved data lacks, so the list is
    // the seeded agent plus the missing builtins — but never ag_new yet.
    expect(store.agentList().map((a) => a.id)).toContain("ag_alfa");
    expect(store.agentList().map((a) => a.id)).not.toContain("ag_new");

    // Another tab creates an agent and writes the whole array back.
    disk["alfa.agents"] = JSON.stringify([
      ...JSON.parse(disk["alfa.agents"]),
      { id: "ag_new", name: "Deploy", glyph: "rocket", color: "blue", persona: "d", skills: [], allTools: true },
    ]);
    expect(listeners.length).toBeGreaterThan(0); // the listener was actually installed
    listeners.forEach((fn) => fn({ key: "alfa.agents", storageArea: fake } as unknown as StorageEvent));

    // Without the listener this still reported one agent, and the next mutation
    // here would have written that stale list back over the other tab's work.
    expect(store.agentList().map((a) => a.id)).toContain("ag_new");
  });
});

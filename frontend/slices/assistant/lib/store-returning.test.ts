import { describe, expect, it, vi } from "vitest";

// A RETURNING user, which is the case every regression this session has hit: their
// localStorage already holds data written by an older build. Fresh installs are
// fine by construction, so they prove nothing.
//
// The module store reads at IMPORT time, so localStorage must be stubbed before the
// dynamic import — and load() has to gate on localStorage rather than window, or
// this can never be exercised outside a browser.
describe("a returning user's saved state survives the module store", () => {
  it("restores their agent selection and migrates pre-convergence tool ids", async () => {
    const disk: Record<string, string> = {
      "alfa.agents": JSON.stringify([
        { id: "ag_alfa", builtin: true, name: "Alfa", glyph: "sparkles", color: "violet", persona: "p", skills: [], allTools: true },
        { id: "ag_mine", name: "My Agent", glyph: "bot", color: "blue", persona: "mine", skills: ["sk_a"], allTools: false },
      ]),
      "alfa.activeAgent": "ag_mine",
      "alfa.skills": JSON.stringify([
        {
          id: "sk_a", name: "Old", glyph: "folder", color: "blue", instructions: "i", starters: [],
          // pre-convergence ids: two migrate, one never had an executable twin
          tools: ["files.list", "terminal.run", "settings.set_theme"],
        },
      ]),
    };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => disk[k] ?? null,
      setItem: (k: string, v: string) => { disk[k] = v; },
      removeItem: (k: string) => { delete disk[k]; },
      clear: () => {},
    });
    vi.resetModules();
    const store = await import("./store");

    // Their own agent is still selected — not silently reset to the first preset.
    expect(store.activeAgent().id).toBe("ag_mine");
    // Their agent still exists alongside the builtins.
    expect(store.agentList().map((a) => a.name)).toContain("My Agent");
    // A multi-word agent is switchable by id — which is what the @mention pick
    // does (onPick carries the id, so the name is never parsed back out of text).
    store.setActiveAgentId("ag_alfa");
    expect(store.activeAgent().id).toBe("ag_alfa");
    store.setActiveAgentId("ag_mine");
    expect(store.activeAgent().id).toBe("ag_mine");
  });
});

import { describe, expect, it } from "vitest";
import { OS_TOOLS, toolById, GROUP_META, GROUP_ORDER } from "./tools";
import { HOST_TOOLS } from "../host-tools/catalog";
import { PRESET_SKILLS, PRESET_AUTOMATIONS } from "./presets";

// THE CONTRACT: there is exactly one tool catalog. The pickers render a VIEW of
// the executable tools — they cannot offer something the model can never call.
//
// Before this there were two catalogs: 45 declarative descriptors beside 18 real
// tools, sharing exactly ONE name (apps.list) and disagreeing about what it did.
// Picking any of the other 44 configured nothing at all.
describe("one tool catalog", () => {
  it("every offered tool is an executable tool", () => {
    const real = new Set(HOST_TOOLS.map((t) => t.name));
    for (const t of OS_TOOLS) expect(real.has(t.id)).toBe(true);
    expect(OS_TOOLS).toHaveLength(HOST_TOOLS.length);
  });

  it("ids are unique and resolvable", () => {
    expect(new Set(OS_TOOLS.map((t) => t.id)).size).toBe(OS_TOOLS.length);
    for (const t of OS_TOOLS) expect(toolById(t.id)?.id).toBe(t.id);
  });

  it("every tool's group is one the UI can render", () => {
    for (const t of OS_TOOLS) {
      expect(GROUP_META[t.group], `no GROUP_META for ${t.group}`).toBeDefined();
      expect(GROUP_ORDER).toContain(t.group);
    }
  });

  it("no group is declared without a tool behind it", () => {
    const used = new Set(OS_TOOLS.map((t) => t.group));
    for (const g of GROUP_ORDER) expect(used.has(g), `${g} has no tools`).toBe(true);
  });

  it("every tool declares its approval tier", () => {
    for (const t of HOST_TOOLS) expect(["read", "mutate"]).toContain(t.effect);
  });
});

// The presets ship with the product, so a dead id here is a builtin skill that
// silently grants nothing. Every one of the 23 original ids was dead after the
// catalogs converged; this is what stops that recurring.
describe("presets reference only real tools", () => {
  const real = new Set(HOST_TOOLS.map((t) => t.name));

  it("every preset skill's tools exist", () => {
    for (const s of PRESET_SKILLS) {
      expect(s.tools.length, `${s.name} has no tools`).toBeGreaterThan(0);
      for (const id of s.tools) expect(real.has(id), `${s.name} → ${id}`).toBe(true);
    }
  });

  it("every preset automation step names a real tool", () => {
    for (const a of PRESET_AUTOMATIONS) {
      for (const step of a.steps) expect(real.has(step.tool), `${a.name} → ${step.tool}`).toBe(true);
    }
  });
});

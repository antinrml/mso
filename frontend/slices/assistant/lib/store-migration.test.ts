import { describe, expect, it } from "vitest";
import { migrateRows } from "./store-persist";
import { HOST_TOOLS } from "../host-tools/catalog";

// Data written before the tool catalogs converged. The five builtin skills shipped
// with these exact ids, so a returning user has them in localStorage right now.
const LEGACY_SKILLS = [
  {
    id: "sk_files", builtin: true, name: "File Ops", glyph: "folder", color: "blue",
    instructions: "Work with files.", starters: [],
    tools: ["files.list", "files.create_folder", "files.create_file", "files.rename", "files.move", "files.delete", "files.open", "files.search"],
  },
  {
    id: "sk_sys", builtin: true, name: "Sysadmin", glyph: "gauge", color: "amber",
    instructions: "Operate the VPS.", starters: [],
    // browser.bookmark and settings.set_theme never had an executable counterpart.
    tools: ["system.stats", "system.processes", "terminal.run", "settings.set_theme", "browser.bookmark"],
  },
];

const LEGACY_AUTOMATIONS = [
  {
    id: "au_1", builtin: true, name: "Project setup", glyph: "rocket", color: "violet", agentId: "ag_alfa",
    steps: [
      { tool: "files.create_folder", argText: "/Projects" },
      { tool: "apps.launch", argText: "files" },
      { tool: "settings.set_accent", argText: "" },
    ],
  },
];

const real = new Set(HOST_TOOLS.map((t) => t.name));


describe("pre-convergence localStorage survives the read", () => {
  it("does NOT empty a returning user's builtin skills", () => {
    const files = migrateRows(LEGACY_SKILLS).find((s) => s.id === "sk_files");
    // Dropping unknown ids instead of migrating them would leave this at zero —
    // the shipped presets would look broken to exactly the users who had them.
    expect(files!.tools.length).toBeGreaterThan(0);
    expect(files!.tools).toContain("fs.list");
    expect(files!.tools).toContain("fs.mkdir");
  });

  it("maps every legacy id that has a real counterpart", () => {
    const sys = migrateRows(LEGACY_SKILLS).find((s) => s.id === "sk_sys");
    expect(sys!.tools).toContain("sys.stats");
    expect(sys!.tools).toContain("exec.run");
  });

  it("drops only the ids that never had an executable counterpart", () => {
    for (const s of migrateRows(LEGACY_SKILLS)) {
      for (const id of s.tools) expect(real.has(id), `${s.name} → ${id}`).toBe(true);
    }
    const sys = migrateRows(LEGACY_SKILLS).find((s) => s.id === "sk_sys");
    expect(sys!.tools).not.toContain("settings.set_theme");
    expect(sys!.tools).not.toContain("browser.bookmark");
  });

  it("migrates automation steps too — an earlier pass missed them entirely", () => {
    const auto = migrateRows(LEGACY_AUTOMATIONS).find((a) => a.id === "au_1");
    const tools = auto!.steps.map((s) => (s as { tool: string }).tool);
    expect(tools).toContain("fs.mkdir");
    expect(tools).toContain("app.open");
    for (const t of tools) expect(real.has(t), t).toBe(true);
  });

  it("does not duplicate when two legacy ids collapse to one", () => {
    // files.rename and files.move both map to fs.move.
    const files = migrateRows(LEGACY_SKILLS).find((s) => s.id === "sk_files");
    expect(files!.tools.filter((t) => t === "fs.move")).toHaveLength(1);
  });
});

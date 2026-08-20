import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// One temp container holding two projects. OS_FS_READ_ROOTS is pointed at it so the
// project half of the catalog is deterministic; the GLOBAL half still comes from the
// real repo (`claude-skills/`), which is exactly what these tools are supposed to
// merge, so assertions below check containment rather than exact equality.
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mso-discovery-"));
const widget = path.join(workspace, "widget");
const gadget = path.join(workspace, "gadget");
await fs.mkdir(path.join(widget, ".claude/skills/widget-deploy"), { recursive: true });
await fs.writeFile(
  path.join(widget, ".claude/skills/widget-deploy/SKILL.md"),
  "---\nname: widget-deploy\ndescription: Ship the widget service.\n---\n\n# Widget deploy\n\nstep one\n",
);
await fs.writeFile(path.join(widget, "package.json"), JSON.stringify({ name: "widget", version: "0.1.0" }));
// A project skill whose SKILL.md is a symlink: discoverable, but never trusted.
await fs.mkdir(path.join(gadget, ".codex/skills/gadget-wild"), { recursive: true });
await fs.writeFile(path.join(gadget, "SKILL.md"), "---\nname: gadget-wild\ndescription: Unverified.\n---\n\n# wild\n");
await fs.symlink(path.join(gadget, "SKILL.md"), path.join(gadget, ".codex/skills/gadget-wild/SKILL.md"));

const previous = process.env.OS_FS_READ_ROOTS;
process.env.OS_FS_READ_ROOTS = workspace;
const { DISCOVERY_TOOLS } = await import("./tools-discovery");

const tool = (name: string) => {
  const found = DISCOVERY_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
};
const run = (name: string, args: Record<string, unknown> = {}) =>
  tool(name).run(args, { scope: "read" as const });

type SkillRow = { id: string; trust: string; instructionsReadable: boolean; project?: { name: string } };

afterAll(async () => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("projects_list", () => {
  it("is a read tool with a read-only annotation", () => {
    expect(tool("projects_list").scope).toBe("read");
    expect(tool("projects_list").annotations?.readOnlyHint).toBe(true);
  });

  it("enumerates every project in the configured container with bounded metadata", async () => {
    const result = await run("projects_list") as { total: number; projects: Array<{ name: string; packageName?: string }> };
    expect(result.projects.map((p) => p.name)).toEqual(["gadget", "widget"]);
    expect(result.projects.find((p) => p.name === "widget")?.packageName).toBe("widget");
    expect(result.total).toBe(2);
  });

  it("filters and paginates", async () => {
    const result = await run("projects_list", { query: "wid", limit: 1 }) as { total: number; limit: number; projects: Array<{ name: string }> };
    expect(result).toMatchObject({ total: 1, limit: 1 });
    expect(result.projects.map((p) => p.name)).toEqual(["widget"]);
  });
});

describe("skills_list spans global and project roots", () => {
  it("returns official repo skills AND per-project skills in one catalog", async () => {
    const { skills } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[] };
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("mso"); // official, from this repo's claude-skills/
    expect(ids).toContain("widget/widget-deploy");
    expect(skills.find((s) => s.id === "widget/widget-deploy")).toMatchObject({
      trust: "local", instructionsReadable: true, project: { name: "widget" },
    });
  });

  it("marks a project skill with a symlinked SKILL.md untrusted and unreadable", async () => {
    const { skills } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[] };
    expect(skills.find((s) => s.id === "gadget/gadget-wild")).toMatchObject({
      trust: "untrusted", instructionsReadable: false,
    });
  });

  it("filters by project and by trust", async () => {
    const byProject = await run("skills_list", { project: "widget" }) as { skills: SkillRow[] };
    expect(byProject.skills.map((s) => s.id)).toEqual(["widget/widget-deploy"]);
    const official = await run("skills_list", { trust: "official", limit: 200 }) as { skills: SkillRow[] };
    expect(official.skills.every((s) => s.trust === "official")).toBe(true);
    expect(official.skills.some((s) => s.project)).toBe(false);
  });
});

describe("skills_read reads the exact catalog id only", () => {
  it("returns instructions for a trusted project skill", async () => {
    const result = await run("skills_read", { name: "widget/widget-deploy" }) as { content: string; project: { name: string }; trust: string };
    expect(result.trust).toBe("local");
    expect(result.project.name).toBe("widget");
    expect(result.content).toContain("# Widget deploy");
  });

  it("returns instructions for an official global skill", async () => {
    const result = await run("skills_read", { name: "mso" }) as { content: string; trust: string };
    expect(result.trust).toBe("official");
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("withholds instructions for an untrusted skill but still reports metadata", async () => {
    const result = await run("skills_read", { name: "gadget/gadget-wild" }) as {
      instructionsWithheld: boolean; reason: string; content?: string; trust: string;
    };
    expect(result).toMatchObject({ instructionsWithheld: true, trust: "untrusted" });
    expect(result.content).toBeUndefined();
    expect(result.reason).toContain("~/.mso/skills");
  });

  it("refuses the bare name of a project skill — the namespaced id is the address", async () => {
    await expect(run("skills_read", { name: "widget-deploy" })).rejects.toThrow(/unknown skill id/);
  });

  it("refuses an unknown id rather than guessing", async () => {
    await expect(run("skills_read", { name: "does-not-exist" })).rejects.toThrow(/skills_list/);
  });
});

import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// TWO configured containers, each holding a project called `widget`. That duplicate is
// the point: it is exactly the case that used to collapse into one row, hiding a whole
// project's skills from every client. OS_FS_READ_ROOTS is pointed at both so the project
// half of the catalog is deterministic; the GLOBAL half still comes from the real repo
// (`claude-skills/`), which is what these tools are supposed to merge, so assertions
// check containment rather than exact equality.
const base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-discovery-"));
const rootA = path.join(base, "root-a");
const rootB = path.join(base, "root-b");
const widgetA = path.join(rootA, "widget");
const widgetB = path.join(rootB, "widget");
const gadget = path.join(rootA, "gadget");

async function skill(dir: string, name: string, description: string, body = "step one\n") {
  const target = path.join(dir, name);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}`);
}

await skill(path.join(widgetA, ".claude/skills"), "widget-deploy", "Ship the widget service from root A.");
await fs.writeFile(path.join(widgetA, "package.json"), JSON.stringify({ name: "widget", version: "0.1.0" }));
await skill(path.join(widgetB, ".claude/skills"), "widget-deploy", "Ship the widget service from root B.");
// A project skill whose SKILL.md is a symlink: discoverable, but never trusted.
await fs.mkdir(path.join(gadget, ".codex/skills/gadget-wild"), { recursive: true });
await fs.writeFile(path.join(gadget, "SKILL.md"), "---\nname: gadget-wild\ndescription: Unverified.\n---\n\n# wild\n");
await fs.symlink(path.join(gadget, "SKILL.md"), path.join(gadget, ".codex/skills/gadget-wild/SKILL.md"));

const previous = process.env.OS_FS_READ_ROOTS;
process.env.OS_FS_READ_ROOTS = `${rootA}:${rootB}`;
const { DISCOVERY_TOOLS } = await import("./tools-discovery");
const { projectRefFor } = await import("@/lib/skills/project-skills");

/** Ids are COMPUTED the way the catalog computes them — never typed by hand, because
 *  the whole fix is that they depend on which configured root the project came from. */
const projectId = async (dir: string) => projectRefFor(dir, await fs.realpath(path.dirname(dir))).id;
const skillId = async (dir: string, name: string) => `${await projectId(dir)}/${name}`;

const tool = (name: string) => {
  const found = DISCOVERY_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
};
const run = (name: string, args: Record<string, unknown> = {}) => tool(name).run(args, { scope: "read" as const });

type SkillRow = { id: string; trust: string; instructionsReadable: boolean; project?: { id: string; name: string } };
type Scan = { truncated: boolean; truncationReasons: string[] };

afterAll(async () => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
  await fs.rm(base, { recursive: true, force: true });
});

describe("projects_list", () => {
  it("is a read tool with a read-only annotation", () => {
    expect(tool("projects_list").scope).toBe("read");
    expect(tool("projects_list").annotations?.readOnlyHint).toBe(true);
  });

  it("enumerates every project across BOTH containers, keeping same-named ones distinct", async () => {
    const result = await run("projects_list") as {
      total: number; scan: Scan; projects: Array<{ id: string; name: string; rootId: string; packageName?: string }>;
    };
    expect(result.projects.map((p) => p.name)).toEqual(["gadget", "widget", "widget"]);
    expect(new Set(result.projects.map((p) => p.id)).size).toBe(3);
    expect(result.total).toBe(3);
    expect(result.projects.find((p) => p.packageName === "widget")).toBeDefined();
  });

  it("reports a truthful scan report on a complete enumeration", async () => {
    const { scan } = await run("projects_list") as { scan: Scan & { scannedRoots: string[] } };
    expect(scan).toMatchObject({ truncated: false, truncationReasons: [] });
    expect(scan.scannedRoots.length).toBeGreaterThanOrEqual(2);
  });

  it("filters and paginates", async () => {
    const result = await run("projects_list", { query: "wid", limit: 1 }) as { total: number; limit: number; projects: Array<{ name: string }> };
    expect(result).toMatchObject({ total: 2, limit: 1 });
    expect(result.projects.map((p) => p.name)).toEqual(["widget"]);
  });
});

describe("skills_list spans global and project roots", () => {
  it("returns official repo skills AND per-project skills in one catalog", async () => {
    const { skills, scan } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[]; scan: Scan };
    const ids = skills.map((s) => s.id);
    const deployA = await skillId(widgetA, "widget-deploy");
    expect(ids).toContain("mso"); // official, from this repo's claude-skills/
    expect(ids).toContain(deployA);
    expect(skills.find((s) => s.id === deployA)).toMatchObject({
      trust: "local", instructionsReadable: true, project: { name: "widget" },
    });
    expect(scan).toHaveProperty("truncated");
  });

  it("keeps BOTH same-named projects' skills visible under distinct ids", async () => {
    const { skills } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[] };
    const a = await skillId(widgetA, "widget-deploy");
    const b = await skillId(widgetB, "widget-deploy");
    expect(a).not.toBe(b);
    expect(skills.map((s) => s.id)).toEqual(expect.arrayContaining([a, b]));
  });

  it("marks a project skill with a symlinked SKILL.md untrusted and unreadable", async () => {
    const { skills } = await run("skills_list", { limit: 200 }) as { skills: SkillRow[] };
    const wild = await skillId(gadget, "gadget-wild");
    expect(skills.find((s) => s.id === wild)).toMatchObject({
      trust: "untrusted", instructionsReadable: false,
    });
  });

  it("filters by an exact projectId", async () => {
    const only = await run("skills_list", { project: await projectId(widgetA) }) as { skills: SkillRow[]; ambiguousProjects?: unknown };
    expect(only.skills.map((s) => s.id)).toEqual([await skillId(widgetA, "widget-deploy")]);
    expect(only.ambiguousProjects).toBeUndefined();
  });

  it("keeps a bare ambiguous project name inclusive, and says which ids it could mean", async () => {
    const both = await run("skills_list", { project: "widget" }) as {
      skills: SkillRow[]; ambiguousProjects?: Array<{ projectId: string; name: string }>;
    };
    expect(both.skills).toHaveLength(2);
    expect(both.ambiguousProjects).toHaveLength(2);
    expect(both.ambiguousProjects!.map((p) => p.projectId).sort())
      .toEqual([await projectId(widgetA), await projectId(widgetB)].sort());
  });

  it("filters by trust", async () => {
    const official = await run("skills_list", { trust: "official", limit: 200 }) as { skills: SkillRow[] };
    expect(official.skills.every((s) => s.trust === "official")).toBe(true);
    expect(official.skills.some((s) => s.project)).toBe(false);
  });
});

describe("skills_read reads the exact catalog id only", () => {
  it("returns instructions for a trusted project skill", async () => {
    const result = await run("skills_read", { name: await skillId(widgetA, "widget-deploy") }) as
      { content: string; project: { name: string }; trust: string };
    expect(result.trust).toBe("local");
    expect(result.project.name).toBe("widget");
    expect(result.content).toContain("# widget-deploy");
    expect(result.content).toContain("root A");
  });

  it("returns instructions for an official global skill", async () => {
    const result = await run("skills_read", { name: "mso" }) as { content: string; trust: string };
    expect(result.trust).toBe("official");
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("withholds instructions for an untrusted skill but still reports metadata", async () => {
    const result = await run("skills_read", { name: await skillId(gadget, "gadget-wild") }) as
      { instructionsWithheld: boolean; reason: string; content?: string; trust: string };
    expect(result).toMatchObject({ instructionsWithheld: true, trust: "untrusted" });
    expect(result.content).toBeUndefined();
    expect(result.reason).toContain("~/.mso/skills");
  });

  it("REFUSES an ambiguous bare name and lists the exact ids", async () => {
    // Two projects called `widget`, each shipping `widget-deploy`. Guessing here would
    // hand the model another project's instructions under the name it asked for.
    await expect(run("skills_read", { name: "widget-deploy" })).rejects.toThrow(/ambiguous across projects/);
    await expect(run("skills_read", { name: "widget/widget-deploy" })).rejects.toThrow(/ambiguous across projects/);
    await expect(run("skills_read", { name: "widget-deploy" })).rejects.toThrow(await projectId(widgetA));
  });

  it("resolves an UNambiguous bare project-skill name", async () => {
    await expect(run("skills_read", { name: "gadget-wild" })).resolves.toMatchObject({
      id: await skillId(gadget, "gadget-wild"),
    });
  });

  it("refuses an unknown id rather than guessing", async () => {
    await expect(run("skills_read", { name: "does-not-exist" })).rejects.toThrow(/skills_list/);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { promises as fs } from "fs";
import path from "path";

// THE COLLISION, END TO END.
//
// `/tmp/mso-root-50323` and `/tmp/mso-root-125549` both hash to `51e156ef` at 8 hex —
// a real pair found by a probe, not a hypothetical. Each holds a project called `widget`
// shipping a skill called `deploy`. Under the old 32-bit id these two collapsed into one
// row and half the box became invisible.
//
// It is not enough that the ids differ: every surface a client actually uses must return
// the SECOND project when handed the second id. That is what this file pins —
// projects_list, skills_list, skills_read, skills_search and workflow_start.
const ROOT_A = "/tmp/mso-root-50323";
const ROOT_B = "/tmp/mso-root-125549";
const previous = {
  read: process.env.OS_FS_READ_ROOTS,
  write: process.env.OS_FS_WRITE_ROOTS,
  memory: process.env.OS_SKILL_MEMORY_STORE,
};

async function seed(root: string, marker: string) {
  const skills = path.join(root, "widget", ".claude/skills/deploy");
  await fs.mkdir(skills, { recursive: true });
  await fs.writeFile(
    path.join(skills, "SKILL.md"),
    `---\nname: deploy\ndescription: Deploy the widget service from ${marker}.\n---\n\n# deploy ${marker}\n\nRun the ${marker} pipeline.\n`,
  );
  await fs.writeFile(path.join(root, "widget", "package.json"), JSON.stringify({ name: `widget-${marker}` }));
}

beforeAll(async () => {
  await seed(ROOT_A, "alpha");
  await seed(ROOT_B, "bravo");
  process.env.OS_FS_READ_ROOTS = `${ROOT_A}:${ROOT_B}`;
  process.env.OS_FS_WRITE_ROOTS = `${ROOT_A}:${ROOT_B}`;
  process.env.OS_SKILL_MEMORY_STORE = path.join(ROOT_A, "memory.json");
});

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    const name = key === "read" ? "OS_FS_READ_ROOTS" : key === "write" ? "OS_FS_WRITE_ROOTS" : "OS_SKILL_MEMORY_STORE";
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await Promise.all([ROOT_A, ROOT_B].map((r) => fs.rm(r, { recursive: true, force: true })));
});

const { DISCOVERY_TOOLS } = await import("./tools-discovery");
const { LEARNING_TOOLS } = await import("./tools-learning");
const { shortId } = await import("@/lib/host/project-roots");
const { searchSkillMemory } = await import("@/lib/skills/search");

const tool = (name: string) => {
  const found = [...DISCOVERY_TOOLS, ...LEARNING_TOOLS].find((t) => t.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
};
const run = (name: string, args: Record<string, unknown>, scope: "read" | "write" = "read") =>
  tool(name).run(args, { scope, actor: "mcp:collision" });

const idA = () => `${shortId(ROOT_A)}/widget`;
const idB = () => `${shortId(ROOT_B)}/widget`;

describe("the 8-hex collision pair stays distinct on every surface", () => {
  it("collides at 8 hex and separates at 32 — the premise of this file", () => {
    expect(shortId(ROOT_A).slice(0, 8)).toBe(shortId(ROOT_B).slice(0, 8));
    expect(shortId(ROOT_A)).not.toBe(shortId(ROOT_B));
  });

  it("projects_list returns BOTH widgets with distinct ids", async () => {
    const result = await run("projects_list", { limit: 200 }) as {
      projects: Array<{ id: string; name: string; path: string; packageName?: string }>;
    };
    const widgets = result.projects.filter((p) => p.name === "widget");
    expect(widgets).toHaveLength(2);
    expect(widgets.map((p) => p.id).sort()).toEqual([idA(), idB()].sort());
    expect(widgets.find((p) => p.id === idB())?.packageName).toBe("widget-bravo");
  });

  it("skills_list returns both projects' deploy skills under distinct ids", async () => {
    const { skills } = await run("skills_list", { limit: 200 }) as {
      skills: Array<{ id: string; description: string; project?: { id: string } }>;
    };
    const deploys = skills.filter((s) => s.id.endsWith("/deploy"));
    expect(deploys.map((s) => s.id).sort()).toEqual([`${idA()}/deploy`, `${idB()}/deploy`].sort());
  });

  it("skills_list filtered by the SECOND project id returns only its skill", async () => {
    const only = await run("skills_list", { project: idB(), limit: 200 }) as {
      skills: Array<{ id: string; description: string }>;
    };
    expect(only.skills.map((s) => s.id)).toEqual([`${idB()}/deploy`]);
    expect(only.skills[0].description).toContain("bravo");
  });

  it("skills_read on the SECOND id returns the SECOND project's instructions", async () => {
    const result = await run("skills_read", { name: `${idB()}/deploy` }) as { content: string; project: { id: string } };
    expect(result.project.id).toBe(idB());
    expect(result.content).toContain("bravo");
    expect(result.content).not.toContain("alpha");
  });

  it("skills_read refuses the ambiguous bare name and offers both exact ids", async () => {
    await expect(run("skills_read", { name: "deploy" })).rejects.toThrow(/ambiguous across projects/);
    await expect(run("skills_read", { name: "widget/deploy" })).rejects.toThrow(new RegExp(idB()));
  });

  it("skills_search surfaces both, each carrying its own project id", async () => {
    const { hits } = await searchSkillMemory("deploy the widget service");
    const deploys = hits.filter((h) => h.kind === "skill" && h.id.endsWith("/deploy"));
    expect(deploys.map((h) => h.id).sort()).toEqual([`${idA()}/deploy`, `${idB()}/deploy`].sort());
    expect(deploys.find((h) => h.id === `${idB()}/deploy`)?.project?.id).toBe(idB());
  });

  it("workflow_start resolves the SECOND project from its exact id, not the first", async () => {
    const result = await run("workflow_start", {
      intent: "deploy the widget service", project: idB(),
    }, "write") as {
      bootstrap: { project: { id: string; path: string; matchedBy: string } };
    };
    expect(result.bootstrap.project.matchedBy).toBe("id");
    expect(result.bootstrap.project.id).toBe(idB());
    expect(result.bootstrap.project.path).toBe(path.join(ROOT_B, "widget"));
  });

  it("workflow_start resolves the FIRST project from its own id", async () => {
    const result = await run("workflow_start", {
      intent: "deploy the widget service", project: idA(),
    }, "write") as { bootstrap: { project: { id: string; path: string } } };
    expect(result.bootstrap.project.id).toBe(idA());
    expect(result.bootstrap.project.path).toBe(path.join(ROOT_A, "widget"));
  });

  it("refuses an id whose rootId is unknown rather than falling through to fuzzy", async () => {
    const bogus = "f".repeat(32);
    const result = await run("workflow_start", { intent: "x", project: `${bogus}/widget` }, "write") as {
      bootstrap: { project?: { matchedBy?: string } };
    };
    expect(result.bootstrap.project?.matchedBy).toBe("unresolved");
  });
});

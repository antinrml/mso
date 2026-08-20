import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { catalogSkills, catalogSkillsDetailed, resolveSkill } from "./catalog";
import { SKILL_SCAN_LIMITS } from "./catalog-types";
import { projectRefFor } from "./project-skills";

const temps: string[] = [];
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mso-catalog-bounds-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

async function skill(root: string, name: string, description: string, body = "") {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n${body}`);
  return dir;
}

/** Project refs the way the catalog builds them, so ids in tests are not hand-rolled. */
const refs = (...dirs: string[]) => dirs.map((dir) => projectRefFor(dir, path.dirname(dir)));

describe("project skill ids are globally unique across roots", () => {
  it("keeps same-named projects in DIFFERENT roots both visible and readable", async () => {
    const app = await temp();
    const home = await temp();
    const rootA = await temp();
    const rootB = await temp();
    const a = path.join(rootA, "widget");
    const b = path.join(rootB, "widget");
    await skill(path.join(a, ".claude/skills"), "deploy", "root A deploy");
    await skill(path.join(b, ".claude/skills"), "deploy", "root B deploy");

    const rows = await catalogSkills({ appDir: app, homeDir: home, projects: refs(a, b) });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(rows.map((r) => r.description).sort()).toEqual(["root A deploy", "root B deploy"]);
    // Both are addressable by their exact ids.
    for (const row of rows) expect(resolveSkill(rows, row.id).skill?.description).toBe(row.description);
  });

  it("namespaces a project skill as <rootId>/<project>/<skill>", async () => {
    const rootA = await temp();
    const a = path.join(rootA, "widget");
    await skill(path.join(a, ".claude/skills"), "deploy", "d");
    const [row] = await catalogSkills({ appDir: await temp(), homeDir: await temp(), projects: refs(a) });
    expect(row.project).toBeDefined();
    expect(row.id).toBe(`${row.project!.rootId}/${row.project!.name}/${row.name}`);
    expect(row.project!.rootId).toMatch(/^[a-f0-9]{8}$/);
    expect(row.project!.id).toBe(`${row.project!.rootId}/${row.project!.name}`);
  });

  it("refuses an ambiguous bare name instead of silently picking one", async () => {
    const rootA = await temp();
    const rootB = await temp();
    const a = path.join(rootA, "widget");
    const b = path.join(rootB, "widget");
    await skill(path.join(a, ".claude/skills"), "deploy", "A");
    await skill(path.join(b, ".claude/skills"), "deploy", "B");
    const rows = await catalogSkills({ appDir: await temp(), homeDir: await temp(), projects: refs(a, b) });

    const bare = resolveSkill(rows, "deploy");
    expect(bare.skill).toBeUndefined();
    expect(bare.ambiguous).toHaveLength(2);
    // `widget/deploy` is ALSO ambiguous — same project basename in two roots.
    expect(resolveSkill(rows, "widget/deploy").ambiguous).toHaveLength(2);
  });

  it("still resolves an unambiguous bare project-skill name for convenience", async () => {
    const rootA = await temp();
    const a = path.join(rootA, "widget");
    await skill(path.join(a, ".claude/skills"), "solo", "only one");
    const rows = await catalogSkills({ appDir: await temp(), homeDir: await temp(), projects: refs(a) });
    expect(resolveSkill(rows, "solo").skill?.description).toBe("only one");
  });

  it("keeps a global bare id winning over any project skill of the same name", async () => {
    const app = await temp();
    const rootA = await temp();
    const a = path.join(rootA, "mso");
    await skill(path.join(app, "claude-skills"), "mso", "official");
    await skill(path.join(a, ".claude/skills"), "mso", "project impostor");
    const rows = await catalogSkills({ appDir: app, homeDir: await temp(), projects: refs(a) });
    expect(resolveSkill(rows, "mso").skill).toMatchObject({ trust: "official", description: "official" });
  });
});

describe("catalog scans are bounded and say so", () => {
  it("caps entries in a GLOBAL skill root and reports the truncation", async () => {
    const app = await temp();
    const root = path.join(app, "claude-skills");
    await Promise.all(
      Array.from({ length: SKILL_SCAN_LIMITS.maxEntriesPerRoot + 5 }, (_, i) =>
        skill(root, `s${String(i).padStart(4, "0")}`, "many")),
    );
    const { skills, scan } = await catalogSkillsDetailed({ appDir: app, homeDir: await temp(), projects: [] });
    expect(skills.length).toBeLessThanOrEqual(SKILL_SCAN_LIMITS.maxEntriesPerRoot);
    expect(scan.truncated).toBe(true);
    expect(scan.truncationReasons.some((r) => r.startsWith("maxEntriesPerRoot"))).toBe(true);
  });

  it("reports truncated=false with no reasons when everything fit", async () => {
    const app = await temp();
    await skill(path.join(app, "claude-skills"), "one", "one");
    const { scan } = await catalogSkillsDetailed({ appDir: app, homeDir: await temp(), projects: [] });
    expect(scan).toMatchObject({ truncated: false, truncationReasons: [] });
  });

  it("caps the number of projects scanned and names the reason", async () => {
    const rootA = await temp();
    const projects = [];
    for (let i = 0; i < SKILL_SCAN_LIMITS.maxProjects + 2; i += 1) {
      const dir = path.join(rootA, `p${String(i).padStart(3, "0")}`);
      await skill(path.join(dir, ".claude/skills"), "s", "x");
      projects.push(dir);
    }
    const { scan } = await catalogSkillsDetailed({
      appDir: await temp(), homeDir: await temp(), projects: refs(...projects),
    });
    expect(scan.truncated).toBe(true);
    expect(scan.truncationReasons).toContain("maxProjects");
  });

  it("skips an oversized SKILL.md instead of loading it", async () => {
    const app = await temp();
    const root = path.join(app, "claude-skills");
    await skill(root, "sane", "sane one");
    const huge = path.join(root, "huge");
    await mkdir(huge, { recursive: true });
    await writeFile(path.join(huge, "SKILL.md"), "x".repeat(SKILL_SCAN_LIMITS.maxSkillBytes + 1));

    const rows = await catalogSkills({ appDir: app, homeDir: await temp(), projects: [] });
    expect(rows.map((r) => r.id)).toEqual(["sane"]);
  });

  it("still refuses a SKILL.md symlink whose target is not named SKILL.md", async () => {
    const app = await temp();
    const root = path.join(app, "claude-skills");
    const dir = path.join(root, "sneaky");
    await mkdir(dir, { recursive: true });
    const secret = path.join(app, "config");
    await writeFile(secret, "secret");
    await symlink(secret, path.join(dir, "SKILL.md"));
    const rows = await catalogSkills({ appDir: app, homeDir: await temp(), projects: [] });
    expect(rows).toEqual([]);
  });
});

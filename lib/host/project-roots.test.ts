import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// Two SEPARATE containers, plus a `projects/` child of the first. The point of the
// whole file: an owner who configured more than one read root must see every one of
// them, because the old behaviour looked at `~/projects` and nothing else.
const base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-roots-"));
const alpha = path.join(base, "alpha");
const beta = path.join(base, "beta");
const nested = path.join(alpha, "projects");
await fs.mkdir(nested, { recursive: true });
await fs.mkdir(beta, { recursive: true });

await fs.mkdir(path.join(alpha, "apex"));
await fs.writeFile(path.join(alpha, "apex", "package.json"), JSON.stringify({ name: "@acme/apex", version: "2.0.0" }));
await fs.mkdir(path.join(nested, "inner"));
await fs.mkdir(path.join(beta, "zulu"));
await fs.mkdir(path.join(beta, ".hidden"));
await fs.mkdir(path.join(base, "outside"));
await fs.symlink(path.join(base, "outside"), path.join(beta, "linked"));

const previous = process.env.OS_FS_READ_ROOTS;
process.env.OS_FS_READ_ROOTS = `${alpha}:${beta}`;
const { listProjects, projectRoots, resolveProjectHint } = await import("./index");

describe("project containers span every configured read root", () => {
  afterAll(async () => {
    if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
    else process.env.OS_FS_READ_ROOTS = previous;
    await fs.rm(base, { recursive: true, force: true });
  });

  it("treats each read root and its projects/ child as a container, in configured order", async () => {
    await expect(projectRoots()).resolves.toEqual([
      await fs.realpath(alpha),
      await fs.realpath(nested),
      await fs.realpath(beta),
    ]);
  });

  it("enumerates projects from ALL containers, not only the first", async () => {
    const { projects, roots, total } = await listProjects();
    expect(roots).toHaveLength(3);
    expect(projects.map((p) => p.name)).toEqual(["apex", "inner", "zulu"]);
    expect(total).toBe(3);
  });

  it("does not list a container as a project of its own parent", async () => {
    const { projects } = await listProjects();
    // `alpha/projects` is a CONTAINER, so it must not also appear as a project
    // named "projects" sitting inside alpha.
    expect(projects.map((p) => p.name)).not.toContain("projects");
  });

  it("excludes hidden directories and symlinks", async () => {
    const { projects } = await listProjects();
    expect(projects.map((p) => p.name)).not.toContain(".hidden");
    expect(projects.map((p) => p.name)).not.toContain("linked");
  });

  it("reports package and container metadata for the returned page", async () => {
    const { projects } = await listProjects({ query: "apex" });
    expect(projects).toEqual([expect.objectContaining({
      name: "apex", packageName: "@acme/apex", packageVersion: "2.0.0", root: await fs.realpath(alpha),
    })]);
  });

  it("paginates deterministically without losing the total", async () => {
    const first = await listProjects({ limit: 2, offset: 0 });
    const second = await listProjects({ limit: 2, offset: 2 });
    expect(first.projects.map((p) => p.name)).toEqual(["apex", "inner"]);
    expect(second.projects.map((p) => p.name)).toEqual(["zulu"]);
    expect(second.total).toBe(3);
  });

  it("resolves a project living in a non-first container by exact name", async () => {
    await expect(resolveProjectHint("zulu")).resolves.toMatchObject({
      name: "zulu", path: path.join(beta, "zulu"), matchedBy: "name",
    });
  });

  it("prefers an exact name in a later container over a fuzzy hit in an earlier one", async () => {
    // "apexish" substring-matches `apex` in the FIRST container. An exact directory
    // in the second must still win, or resolution depends on root order.
    await fs.mkdir(path.join(beta, "apexish"));
    await expect(resolveProjectHint("apexish")).resolves.toMatchObject({
      name: "apexish", matchedBy: "name", root: await fs.realpath(beta),
    });
    await fs.rm(path.join(beta, "apexish"), { recursive: true, force: true });
  });

  it("resolves an exact package name from any container", async () => {
    await expect(resolveProjectHint("@acme/apex")).resolves.toMatchObject({ name: "apex", matchedBy: "package" });
  });
});

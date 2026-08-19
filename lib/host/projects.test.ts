import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-projects-"));
const previousRead = process.env.OS_FS_READ_ROOTS;
process.env.OS_FS_READ_ROOTS = root;
await fs.mkdir(path.join(root, "mso"));
await fs.writeFile(path.join(root, "mso", "package.json"), JSON.stringify({ name: "mso", version: "1.2.3", scripts: { test: "vitest" } }));
const { inspectProject, projectAliasTarget, resolveProjectHint, searchFs } = await import("./index");

describe("project resolver", () => {
  afterAll(async () => {
    if (previousRead === undefined) delete process.env.OS_FS_READ_ROOTS;
    else process.env.OS_FS_READ_ROOTS = previousRead;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("maps historic MSO names to the canonical project", async () => {
    expect(projectAliasTarget("os-vps")).toBe("mso");
    await expect(resolveProjectHint("Manef Shell OS", root)).resolves.toMatchObject({
      name: "mso", path: path.join(root, "mso"), matchedBy: "alias",
    });
  });

  it("resolves package and directory names without an alias", async () => {
    await expect(resolveProjectHint("mso", root)).resolves.toMatchObject({ name: "mso", matchedBy: "name" });
  });
  it("makes fs_search resolve the historic os-vps alias immediately", async () => {
    const hits = await searchFs("os-vps", { root, maxDepth: 1 });
    expect(hits).toEqual([{ name: "mso", path: path.join(root, "mso"), kind: "dir" }]);
  });

  it("does not follow package or git metadata symlinks", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mso-project-outside-"));
    await fs.writeFile(path.join(outside, "package.json"), JSON.stringify({ name: "secret-package" }));

    const linked = path.join(root, "linked");
    await fs.mkdir(linked);
    await fs.symlink(path.join(outside, "package.json"), path.join(linked, "package.json"));
    const linkedResolution = await resolveProjectHint("linked", root);
    expect(linkedResolution).not.toBeNull();
    const linkedInspection = await inspectProject(linkedResolution!);
    expect(linkedInspection.package.name).toBeUndefined();
    expect(linkedInspection.package.scripts).toEqual([]);

    const evil = path.join(root, "evil");
    await fs.mkdir(evil);
    await fs.symlink(outside, path.join(evil, ".git"));
    const evilResolution = await resolveProjectHint("evil", root);
    expect(evilResolution).not.toBeNull();
    await expect(inspectProject(evilResolution!)).resolves.toMatchObject({ git: { available: false, statusChecked: false } });
    await fs.rm(outside, { recursive: true, force: true });
  });

});

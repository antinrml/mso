import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { validateProjectChild, validateProjectDescendant } from "./project-candidate";
import { containerFor } from "./project-containers";

// ONE validator, used by enumeration AND by every resolveProjectHint strategy. The
// previous split — a strict check in the walk, a looser `resolveReadable` in the hint
// path — is exactly how `workflow_start` could resolve a project `projects_list`
// refused to show.
const base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-candidate-"));
const root = path.join(base, "root");
const outside = path.join(base, "outside");
await fs.mkdir(path.join(root, "honest", "nested"), { recursive: true });
await fs.mkdir(path.join(root, ".hidden"), { recursive: true });
await fs.mkdir(path.join(root, "honest", ".hidden-nested"), { recursive: true });
await fs.mkdir(path.join(outside, "target"), { recursive: true });
await fs.mkdir(path.join(root, "inside-target"), { recursive: true });
await fs.writeFile(path.join(root, "afile"), "not a directory");
await fs.symlink(path.join(outside, "target"), path.join(root, "link-out"));
await fs.symlink(path.join(root, "inside-target"), path.join(root, "link-in"));
await fs.symlink(path.join(outside, "target"), path.join(root, "honest", "link-nested"));

const container = containerFor(await fs.realpath(root));
afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe("validateProjectChild — one direct entry", () => {
  it("accepts a real, visible, owned directory", async () => {
    await expect(validateProjectChild(container, "honest")).resolves.toMatchObject({ ok: true });
  });

  it("rejects a hidden name", async () => {
    await expect(validateProjectChild(container, ".hidden")).resolves.toMatchObject({ ok: false, reason: "hidden" });
  });

  it("rejects a symlink whose target escapes", async () => {
    await expect(validateProjectChild(container, "link-out")).resolves.toMatchObject({ ok: false, reason: "symlink" });
  });

  it("rejects a symlink whose target is INSIDE the container — a link is still not a child", async () => {
    await expect(validateProjectChild(container, "link-in")).resolves.toMatchObject({ ok: false, reason: "symlink" });
  });

  it("rejects a non-directory and a missing entry", async () => {
    await expect(validateProjectChild(container, "afile")).resolves.toMatchObject({ ok: false, reason: "not-directory" });
    await expect(validateProjectChild(container, "nope")).resolves.toMatchObject({ ok: false, reason: "missing" });
  });

  it("rejects a traversing or separator-bearing name", async () => {
    for (const name of ["..", "../outside", "a/b", "a\\b", ""]) {
      await expect(validateProjectChild(container, name), name).resolves.toMatchObject({ ok: false });
    }
  });

  it("rejects a directory owned by another uid, before any metadata read", async () => {
    const real = process.getuid!();
    vi.spyOn(process, "getuid").mockReturnValue(real + 4242);
    await expect(validateProjectChild(container, "honest")).resolves.toMatchObject({ ok: false, reason: "uid" });
    vi.restoreAllMocks();
  });
});

describe("validateProjectDescendant — a whole path below the container", () => {
  it("accepts a nested real path", async () => {
    await expect(validateProjectDescendant(container, path.join(container.path, "honest", "nested")))
      .resolves.toMatchObject({ ok: true });
  });

  it("accepts the container itself", async () => {
    await expect(validateProjectDescendant(container, container.path)).resolves.toMatchObject({ ok: true });
  });

  it("rejects a path with ANY hidden component below the container", async () => {
    await expect(validateProjectDescendant(container, path.join(container.path, "honest", ".hidden-nested")))
      .resolves.toMatchObject({ ok: false, reason: "hidden" });
  });

  it("rejects a path traversing a symlink at ANY depth", async () => {
    await expect(validateProjectDescendant(container, path.join(container.path, "honest", "link-nested")))
      .resolves.toMatchObject({ ok: false, reason: "symlink" });
    await expect(validateProjectDescendant(container, path.join(container.path, "link-in")))
      .resolves.toMatchObject({ ok: false, reason: "symlink" });
  });

  it("rejects a path outside the container", async () => {
    await expect(validateProjectDescendant(container, path.join(outside, "target")))
      .resolves.toMatchObject({ ok: false, reason: "escape" });
  });

  it("rejects on uid mismatch at any depth", async () => {
    const real = process.getuid!();
    vi.spyOn(process, "getuid").mockReturnValue(real + 4242);
    await expect(validateProjectDescendant(container, path.join(container.path, "honest", "nested")))
      .resolves.toMatchObject({ ok: false, reason: "uid" });
    vi.restoreAllMocks();
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// resolveProjectHint's two remaining sharp edges:
//   1. an explicit rootHint must resolve EVERY strategy inside that root — exact,
//      package and fuzzy — even when the root is not in the globally capped container
//      list, because the caller named it;
//   2. the exact-name/alias probe must reject a symlink or a hidden entry, or it
//      quietly resolves what projects_list promises to exclude.
const base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-hint-"));
const previous = process.env.OS_FS_READ_ROOTS;

const jail = path.join(base, "jail");
const named = path.join(jail, "named-root");     // reachable, but pushed out of the cap below
const outside = path.join(base, "outside");
await fs.mkdir(path.join(named, "orchard"), { recursive: true });
await fs.writeFile(path.join(named, "orchard", "package.json"), JSON.stringify({ name: "@farm/orchard" }));
await fs.mkdir(path.join(named, "greenhouse-annex"), { recursive: true });
await fs.mkdir(path.join(named, ".hidden-proj"), { recursive: true });
await fs.mkdir(outside, { recursive: true });
await fs.mkdir(path.join(outside, "elsewhere"), { recursive: true });
await fs.symlink(path.join(outside, "elsewhere"), path.join(named, "linked-proj"));
// A symlink whose target is INSIDE the jail: this one cannot be refused merely
// because the target escapes, so it proves the entry itself is rejected.
await fs.mkdir(path.join(jail, "inside-target"), { recursive: true });
await fs.symlink(path.join(jail, "inside-target"), path.join(named, "inside-link"));

// Fill the container cap with decoy roots so `named` is NOT in projectContainers().
const decoys: string[] = [];
for (let i = 0; i < 14; i += 1) {
  const d = path.join(jail, `decoy-${String(i).padStart(2, "0")}`);
  await fs.mkdir(d, { recursive: true });
  decoys.push(d);
}
process.env.OS_FS_READ_ROOTS = [...decoys, jail].join(":");

const { projectRoots, resolveProjectHint } = await import("./index");

afterAll(async () => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
  await fs.rm(base, { recursive: true, force: true });
});

describe("an explicit rootHint resolves entirely within that root", () => {
  it("is genuinely outside the globally capped container list", async () => {
    // Guards the premise: if `named` ever lands in the capped list these tests stop
    // proving anything about the rootHint path.
    await expect(projectRoots()).resolves.not.toContain(await fs.realpath(named));
  });

  it("resolves an exact directory name in the named root", async () => {
    await expect(resolveProjectHint("orchard", named)).resolves.toMatchObject({
      name: "orchard", path: path.join(named, "orchard"), matchedBy: "name",
    });
  });

  it("resolves an exact PACKAGE name in the named root", async () => {
    await expect(resolveProjectHint("@farm/orchard", named)).resolves.toMatchObject({
      name: "orchard", matchedBy: "package",
    });
  });

  it("resolves a FUZZY hint in the named root", async () => {
    await expect(resolveProjectHint("greenhouse", named)).resolves.toMatchObject({
      name: "greenhouse-annex", matchedBy: "fuzzy",
    });
  });

  it("never escapes the named root for a hint that only matches elsewhere", async () => {
    await expect(resolveProjectHint("elsewhere", named)).resolves.toBeNull();
  });
});

describe("the exact-name probe rejects what enumeration excludes", () => {
  it("refuses a symlinked project entry even by exact name", async () => {
    await expect(resolveProjectHint("linked-proj", named)).resolves.toBeNull();
  });

  it("refuses a symlinked entry whose target is INSIDE the read jail", async () => {
    // The target being legal is not the question — a symlink is not a child of this
    // container, and enumeration would never have listed it.
    await expect(resolveProjectHint("inside-link", named)).resolves.toBeNull();
  });

  it("refuses a hidden directory even by exact name", async () => {
    await expect(resolveProjectHint(".hidden-proj", named)).resolves.toBeNull();
  });

  it("refuses a name that resolves outside the root it was probed in", async () => {
    // `../outside/elsewhere` must not traverse out of the named root.
    await expect(resolveProjectHint("../outside/elsewhere", named)).resolves.toBeNull();
  });
});

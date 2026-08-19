import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-guarded-write-"));
const previousRead = process.env.OS_FS_READ_ROOTS;
const previousWrite = process.env.OS_FS_WRITE_ROOTS;
process.env.OS_FS_READ_ROOTS = dir;
process.env.OS_FS_WRITE_ROOTS = dir;
const { sha256Text } = await import("./hash");
const { writeFileGuarded } = await import("./guarded-write");

describe("guarded file writes", () => {
  beforeAll(async () => { await fs.writeFile(path.join(dir, "note.txt"), "one"); });
  afterAll(async () => {
    if (previousRead === undefined) delete process.env.OS_FS_READ_ROOTS;
    else process.env.OS_FS_READ_ROOTS = previousRead;
    if (previousWrite === undefined) delete process.env.OS_FS_WRITE_ROOTS;
    else process.env.OS_FS_WRITE_ROOTS = previousWrite;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes when the inspected hash still matches", async () => {
    const result = await writeFileGuarded({
      path: path.join(dir, "note.txt"), content: "two", expectedSha256: sha256Text("one"),
    });
    expect(result).toMatchObject({ bytes: 3, sha256: sha256Text("two"), previousSha256: sha256Text("one") });
    expect(await fs.readFile(path.join(dir, "note.txt"), "utf8")).toBe("two");
  });

  it("refuses a stale overwrite and leaves current bytes intact", async () => {
    await expect(writeFileGuarded({
      path: path.join(dir, "note.txt"), content: "three", expectedSha256: sha256Text("one"),
    })).rejects.toThrow("File changed since fs_read");
    expect(await fs.readFile(path.join(dir, "note.txt"), "utf8")).toBe("two");
  });
});

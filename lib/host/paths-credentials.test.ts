import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  appSecretCopyFilter,
  assertNoAppSecretDescendants,
  assertNoSensitiveDescendants,
  isSensitivePath,
  sensitiveExcludes,
} from "./paths";

// The per-path credential gate is exact-or-under, so a PARENT of a denied entry
// matches nothing — and the two recursive callers (`zip -r`, `fs.cp {recursive}`)
// walk right past the gate into the children. zip NARROWS (excludes), copy/move
// REFUSE: a filtered move would cp-then-rm the skipped file, and a completed one
// relocates credentials somewhere the read API no longer denies.
//
// HOME is stubbed to a temp tree so the assertions don't depend on which dotfiles
// happen to exist on the box running the suite.
let base = "";
let fakeHome = "";
let parent = ""; // ~/.local/share — denied by neither itself nor its parent

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mso-cred-")));
  fakeHome = path.join(base, "home");
  parent = path.join(fakeHome, ".local", "share");
  mkdirSync(path.join(parent, "keyrings"), { recursive: true });
  mkdirSync(path.join(fakeHome, ".ssh"), { recursive: true });
  mkdirSync(path.join(fakeHome, ".codex"), { recursive: true });
  mkdirSync(path.join(fakeHome, "safe"), { recursive: true });
});

afterAll(() => rmSync(base, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

describe("recursive credential guard", () => {
  it("blocks the agent credential stores added to the denylist", () => {
    vi.stubEnv("HOME", fakeHome);
    expect(isSensitivePath(path.join(fakeHome, ".codex"))).toBe(true);
    expect(isSensitivePath(path.join(fakeHome, ".codex", "auth.json"))).toBe(true);
  });

  it("excludes a credential dir nested under the zip base", () => {
    vi.stubEnv("HOME", fakeHome);
    expect(isSensitivePath(parent)).toBe(false); // the exact gap this guard closes
    expect(sensitiveExcludes(parent)).toEqual(expect.arrayContaining(["keyrings", "keyrings/*"]));
    expect(sensitiveExcludes(fakeHome)).toEqual(expect.arrayContaining([".ssh", ".ssh/*"]));
    expect(sensitiveExcludes(path.join(fakeHome, "safe"))).toEqual([]);
  });

  it("refuses to copy/move a parent of a credential dir, allows an unrelated one", () => {
    vi.stubEnv("HOME", fakeHome);
    expect(() => assertNoSensitiveDescendants(parent)).toThrow(/credential/i);
    expect(() => assertNoSensitiveDescendants(path.join(fakeHome, "safe"))).not.toThrow();
  });

  it("honours the OS_FS_ALLOW_SENSITIVE escape hatch", () => {
    vi.stubEnv("HOME", fakeHome);
    vi.stubEnv("OS_FS_ALLOW_SENSITIVE", "1");
    expect(sensitiveExcludes(fakeHome)).toEqual([]);
    expect(() => assertNoSensitiveDescendants(parent)).not.toThrow();
  });
});

// The app's own `.env*` are NOT on the ~/ list, and APP_DIR is fixed at module load
// from process.cwd() — so unlike the block above, these run against the real repo.
// On the DEFAULT roots (~ and ~/projects) APP_DIR is a descendant of a copyable dir,
// which is exactly how `copy(~/projects, ~/backup)` used to duplicate .env.local to
// somewhere /api/v1/fs/read still serves it.
describe("the cockpit's own .env* under a recursive write", () => {
  const appDir = realpathSync(process.cwd());
  const above = path.dirname(appDir);
  const secret = path.join(appDir, ".env.local");
  const live = existsSync(secret);

  it.skipIf(!live)("copy skips them when a PARENT of APP_DIR is the source", () => {
    const filter = appSecretCopyFilter(above);
    expect(filter).toBeTypeOf("function");
    expect(filter!(secret)).toBe(false);
    expect(filter!(path.join(appDir, "package.json"))).toBe(true);
    expect(filter!(path.join(appDir, ".env.example"))).toBe(true);
  });

  it.skipIf(!live)("move REFUSES instead — its EXDEV branch would delete a skipped file", () => {
    expect(() => assertNoAppSecretDescendants(above)).toThrow(/secret/i);
  });

  it("leaves an unrelated source completely alone", () => {
    expect(appSecretCopyFilter(path.join(base, "elsewhere"))).toBeUndefined();
    expect(() => assertNoAppSecretDescendants(path.join(base, "elsewhere"))).not.toThrow();
  });

  it("does not fire when APP_DIR IS the source (the per-path gate owns that)", () => {
    expect(appSecretCopyFilter(appDir)).toBeUndefined();
    expect(() => assertNoAppSecretDescendants(appDir)).not.toThrow();
  });
});

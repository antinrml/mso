// The defect this covers shipped: on a host where `hermes` worked fine in a
// terminal, MSO reported it as not installed. MSO runs as a systemd unit, whose
// PATH is /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin — and both managed-app
// CLIs install themselves into ~/.local/bin, which is not on it. `which` missed
// them, and detection concluded the app was absent.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let home: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, homedir: () => home }, homedir: () => home };
});

const { resolveCommand, commandExists } = await import("./runner");

/** A name no real PATH can satisfy, so only the fallback can find it. */
const CLI = "mso-fixture-cli";

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mso-runner-"));
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function install(dir: string, name = CLI): Promise<string> {
  const binDir = path.join(home, dir);
  await fs.mkdir(binDir, { recursive: true });
  const file = path.join(binDir, name);
  await fs.writeFile(file, "#!/bin/sh\necho fixture\n");
  await fs.chmod(file, 0o755);
  return file;
}

describe("resolveCommand looks where these CLIs actually install themselves", () => {
  it("finds a CLI in ~/.local/bin that PATH does not carry", async () => {
    const expected = await install(".local/bin");
    expect(await resolveCommand(CLI)).toBe(expected);
  });

  it("also covers ~/.bun/bin", async () => {
    const expected = await install(".bun/bin");
    expect(await resolveCommand(CLI)).toBe(expected);
  });

  it("returns null when the command genuinely is not installed", async () => {
    expect(await resolveCommand(CLI)).toBeNull();
    expect(await commandExists(CLI)).toBe(false);
  });

  it("ignores a match that is present but not executable", async () => {
    // A stray file of the same name must not be reported as an installed CLI —
    // spawning it would fail with EACCES long after detection claimed success.
    const binDir = path.join(home, ".local/bin");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(binDir, CLI), "not executable");
    await fs.chmod(path.join(binDir, CLI), 0o644);
    expect(await resolveCommand(CLI)).toBeNull();
  });

  it("still prefers PATH when PATH can answer", async () => {
    // The fallback is a safety net, not a redirect: a command PATH resolves must
    // keep resolving to the PATH copy.
    // Not pinned to a literal: /bin/sh and /usr/bin/sh are both correct depending
    // on whether the distro has merged /usr.
    const resolved = await resolveCommand("sh");
    expect(resolved).toMatch(/^\/(usr\/)?bin\/sh$/);
  });

  it("accepts an absolute path as itself, and rejects one that is absent", async () => {
    const file = await install(".local/bin", "direct");
    expect(await resolveCommand(file)).toBe(file);
    expect(await resolveCommand(path.join(home, "nope", "missing"))).toBeNull();
  });
});

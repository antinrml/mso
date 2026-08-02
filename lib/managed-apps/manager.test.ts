// The two defects this covers were both live in a shipped build, and both were
// invisible without a test: detection could not tell a stopped unit from a
// non-existent one, and backup refused every real install.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runner", () => ({
  runProgram: vi.fn(),
  commandExists: vi.fn().mockResolvedValue(false),
  requireProgram: vi.fn(),
}));

const { runProgram } = await import("./runner");
const { getManagedApp, performManagedAppAction } = await import("./manager");

const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
/** systemd 255 on an unknown unit: rc 0 from `show`, LoadState=not-found. */
const NOT_FOUND = ok("LoadState=not-found\nActiveState=inactive\n");
const ACTIVE = ok("LoadState=loaded\nActiveState=active\n");
const STOPPED = ok("LoadState=loaded\nActiveState=inactive\n");

/** Answer `systemctl show` per unit name, and everything else generically. */
function systemctl(byUnit: Record<string, { code: number; stdout: string; stderr: string }>) {
  vi.mocked(runProgram).mockImplementation(async (command: string, args: readonly string[]) => {
    if (command === "systemctl" && args.includes("show")) {
      const unit = args[args.length - 1];
      return byUnit[unit] ?? NOT_FOUND;
    }
    return ok("");
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("systemd detection tells a stopped unit from one that does not exist", () => {
  it("skips a not-found unit and detects the next configured name", async () => {
    // OpenClaw's real shape: the first catalog name never existed on this host.
    systemctl({ "openclaw-gateway.service": ACTIVE, "openclaw.service": NOT_FOUND });
    const view = await getManagedApp("openclaw");
    expect(view.state).toBe("running");
  });

  it("reports a loaded-but-inactive unit as stopped, without falling through", async () => {
    systemctl({ "openclaw-gateway.service": STOPPED });
    const view = await getManagedApp("openclaw");
    expect(view.state).toBe("stopped");
    // Stopped is still INSTALLED: lifecycle actions must stay offered.
    expect(view.supportedActions).toContain("start");
  });

  it("reports not-installed when no configured unit exists anywhere", async () => {
    systemctl({});
    const view = await getManagedApp("hermes");
    expect(view.state).toBe("not-installed");
    expect(view.supportedActions).toEqual([]);
  });

  it("treats a failing systemctl as no answer, not as 'unit exists'", async () => {
    // No systemctl at all (ENOENT) or no user bus: must not be read as `inactive`.
    vi.mocked(runProgram).mockResolvedValue({ code: 127, stdout: "", stderr: "not found" });
    const view = await getManagedApp("hermes");
    expect(view.state).toBe("not-installed");
  });
});

describe("backup copies a real install instead of refusing it", () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "mapp-backup-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const state = path.join(home, ".openclaw");
    await fs.mkdir(path.join(state, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(state, "agents"), { recursive: true });
    await fs.mkdir(path.join(state, "backups", "old"), { recursive: true });
    await fs.writeFile(path.join(state, "openclaw.json"), "{}");
    await fs.writeFile(path.join(state, "agents", "one.md"), "agent");
    await fs.writeFile(path.join(state, "node_modules", "pkg", "index.js"), "vendor");
    await fs.writeFile(path.join(state, "backups", "old", "stale"), "old backup");
    // Both kinds that used to abort the whole run: one inside a vendor tree, and
    // one pointing clean out of the app.
    await fs.symlink("../pkg", path.join(state, "node_modules", "link"));
    await fs.symlink("/etc/passwd", path.join(state, "escape"));
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("skips symlinks and vendor trees, keeps the state, and records what it left out", async () => {
    systemctl({ "openclaw-gateway.service": ACTIVE });
    await performManagedAppAction("openclaw", "backup");

    const root = path.join(home, ".os-vps", "backups", "openclaw");
    const [stamp] = await fs.readdir(root);
    const backup = path.join(root, stamp);

    expect(await fs.readFile(path.join(backup, "openclaw.json"), "utf8")).toBe("{}");
    expect(await fs.readFile(path.join(backup, "agents", "one.md"), "utf8")).toBe("agent");
    // The symlink out of the app is neither followed (no /etc/passwd bytes) nor
    // recreated (a restore would then write outside the tree).
    await expect(fs.lstat(path.join(backup, "escape"))).rejects.toThrow();
    await expect(fs.lstat(path.join(backup, "node_modules"))).rejects.toThrow();
    await expect(fs.lstat(path.join(backup, "backups"))).rejects.toThrow();

    const manifest = JSON.parse(await fs.readFile(path.join(backup, "manifest.json"), "utf8"));
    expect(manifest.applicationId).toBe("openclaw");
    // node_modules is skipped as a DIR, so the link inside it is never reached.
    expect(manifest.skipped).toMatchObject({ symlinks: 1, dirs: 2 });
    expect(manifest.skipped.dirNames).toContain("node_modules");
  });
});

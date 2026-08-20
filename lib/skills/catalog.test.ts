import { createHash } from "crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogSkills, readSkillFile } from "./catalog";

const temps: string[] = [];
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mso-skills-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  const { rm } = await import("fs/promises");
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function skill(dir: string, name: string, description: string) {
  const target = path.join(dir, name);
  await mkdir(target, { recursive: true });
  const md = `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
  await writeFile(path.join(target, "SKILL.md"), md);
  return { target, md };
}

// `projects: []` keeps these cases about GLOBAL root precedence. Without it the
// catalog also walks the real box's project containers, and the assertions would
// depend on which projects happen to be checked out on the machine running them.
// Per-project discovery has its own file: project-skills.test.ts.
describe("skill catalog trust and precedence", () => {
  it("finds official repo skills without ~/.claude symlinks", async () => {
    const app = await temp();
    const home = await temp();
    await skill(path.join(app, "claude-skills"), "mso", "official");
    const rows = await catalogSkills({ appDir: app, homeDir: home, projects: [] });
    expect(rows).toMatchObject([{ name: "mso", source: "mso", trust: "official", description: "official" }]);
  });

  it("does not let a generic agent root shadow an official skill", async () => {
    const app = await temp();
    const home = await temp();
    await skill(path.join(app, "claude-skills"), "mso", "official");
    await skill(path.join(home, ".claude/skills"), "mso", "host override");
    const [row] = await catalogSkills({ appDir: app, homeDir: home, projects: [] });
    expect(row).toMatchObject({ name: "mso", source: "mso", trust: "official", description: "official" });
  });

  it("allows the explicit operator root to override an official skill", async () => {
    const app = await temp();
    const home = await temp();
    await skill(path.join(app, "claude-skills"), "mso", "official");
    await skill(path.join(home, ".mso/skills"), "mso", "operator override");
    const [row] = await catalogSkills({ appDir: app, homeDir: home, projects: [] });
    expect(row).toMatchObject({ name: "mso", source: "operator", trust: "local", description: "operator override" });
  });

  it("marks a ClawHub skill verified only while its SKILL.md hash matches provenance", async () => {
    const app = await temp();
    const home = await temp();
    const { target, md } = await skill(path.join(app, "skills"), "vendor", "vendor skill");
    await mkdir(path.join(target, ".clawhub"), { recursive: true });
    const sha256 = createHash("sha256").update(md).digest("hex");
    await writeFile(path.join(target, ".clawhub/origin.json"), JSON.stringify({ registry: "https://clawhub.ai", ownerHandle: "alice", installedVersion: "1.2.3", skillFile: { sha256 } }));
    let [row] = await catalogSkills({ appDir: app, homeDir: home, projects: [] });
    expect(row).toMatchObject({ trust: "verified", provenance: { owner: "alice", version: "1.2.3", sha256 } });

    await writeFile(path.join(target, "SKILL.md"), md + "tampered\n");
    [row] = await catalogSkills({ appDir: app, homeDir: home, projects: [] });
    expect(row.trust).toBe("untrusted");
  });

  it("refuses a SKILL.md symlink whose target is not named SKILL.md", async () => {
    const dir = await temp();
    const secret = path.join(dir, "config");
    const linkDir = path.join(dir, "x");
    await mkdir(linkDir);
    await writeFile(secret, "secret");
    await symlink(secret, path.join(linkDir, "SKILL.md"));
    await expect(readSkillFile(path.join(linkDir, "SKILL.md"))).resolves.toBeNull();
  });
});

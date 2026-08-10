import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SkillInfo = { name: string; path: string; description: string };

const SKILL_FILE = "SKILL.md";

const home = () => os.homedir();
// Bundled first, host roots after. Skills that ship WITH MSO live in the repo, so a
// fresh install has a catalog before OpenClaw (or anything else) is on the box; the
// host roots then add whatever the operator installed. Same name in both = the HOST
// copy wins (see the dedupe below), so a bundled skill can be overridden without
// editing the repo. process.cwd() is the app dir — the same anchor lib/host/paths.ts
// uses for APP_DIR.
//
// ⚠ THESE ROOTS ARE READ OUTSIDE THE FS JAIL. They are not filtered by
// OS_FS_READ_ROOTS and not checked against lib/host/paths.ts's credential denylist —
// narrowing OS_FS_READ_ROOTS does NOT narrow this route. That is why the only two
// things ever opened here are a directory listing and a file named exactly SKILL.md,
// and why readSkill() below refuses one that resolves out of its root.
const roots = () => [
  path.join(process.cwd(), "skills"),
  // Where scripts/install.sh puts /mso, /mso-camoufox, /mso-apps, /mso-list and
  // /mso-image-editor. Missing until 2026-08-10, so the documents that describe how
  // to drive mso were the one catalog mso could not see: 89 skills served, zero of
  // them mso*.
  path.join(home(), ".claude/skills"),
  path.join(home(), ".agents/skills"),
  path.join(home(), ".codex/skills"),
  path.join(home(), ".openclaw/workspace/skills"),
  path.join(home(), ".local/lib/node_modules/openclaw/skills"),
];

/**
 * Read a skill file, refusing a symlink that resolves to something that is not a
 * skill file.
 *
 * `name` is already constrained to a real directory entry, so `../` is not the risk
 * — a SYMLINK is. Any root may hold `<skill>/SKILL.md` pointing anywhere on the box,
 * and because this route reads OUTSIDE the fs jail that used to be served with no
 * bounds check at all.
 *
 * The rule is "the target is still called SKILL.md", not "the target lives under a
 * root". Containment cannot be the rule here: every entry in ~/.claude/skills is a
 * symlink into this repo's claude-skills/, which is deliberately not a scanned root,
 * so a containment check would reject exactly the skills that describe how to drive
 * mso. The basename rule keeps the legitimate case and kills the one that matters —
 * `SKILL.md -> ~/.ssh/config` resolves to `config` and is refused.
 *
 * Known ceiling: it does not stop a link to some other file that happens to be named
 * SKILL.md. Anyone who can plant a symlink inside a skills root can also just write a
 * real SKILL.md there, so that is the same privilege, not a new one.
 */
async function readSkill(file: string): Promise<string | null> {
  const real = await fs.realpath(file).catch(() => null);
  if (!real || path.basename(real) !== SKILL_FILE) return null;
  return fs.readFile(real, "utf8").catch(() => null);
}

/** A skill directory may itself be a symlink — every entry install.sh creates in
 *  ~/.claude/skills is one, and `Dirent.isDirectory()` is false for those (it is an
 *  lstat). Adding the root without this found 0 of the 5 mso skills. */
async function isSkillDir(root: string, e: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }): Promise<boolean> {
  if (e.isDirectory()) return true;
  if (!e.isSymbolicLink()) return false;
  return (await fs.stat(path.join(root, e.name)).catch(() => null))?.isDirectory() ?? false;
}

const demoSkills: SkillInfo[] = [
  { name: "camoufox-browse", path: "demo://camoufox-browse", description: "Browser automation playbook for Camoufox." },
  { name: "vps-alfa", path: "demo://vps-alfa", description: "Patrol and assist VPS terminal panes." },
];

function description(md: string): string {
  const yaml = /^---\n([\s\S]*?)\n---/.exec(md)?.[1];
  const fromYaml = yaml?.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "").trim();
  if (fromYaml) return fromYaml;
  return md.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"))?.trim() ?? "";
}

async function catalog(): Promise<SkillInfo[]> {
  const found: SkillInfo[] = [];
  for (const root of roots()) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!(await isSkillDir(root, e))) continue;
      const file = path.join(root, e.name, SKILL_FILE);
      const md = await readSkill(file);
      if (md) found.push({ name: e.name, path: file, description: description(md) });
    }
  }
  // Later roots override earlier ones by name: the bundled copy is the FALLBACK, an
  // operator's own install of the same skill is what they meant to run.
  const byName = new Map(found.map((s) => [s.name, s]));
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (IS_DEMO) {
    const skill = name ? demoSkills.find((s) => s.name === name) : null;
    return skill
      ? NextResponse.json({ skill, content: `# ${skill.name}\n\n${skill.description}\n\nDemo mode only lists this skill; it does not run host automation.` })
      : NextResponse.json({ skills: demoSkills });
  }
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const skills = await catalog();
  if (!name) return NextResponse.json({ skills });

  const skill = skills.find((s) => s.name === name);
  if (!skill) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Re-checked, not trusted from catalog(): the listing and this read are separate
  // stats, and the allowlist above is what makes `name` safe in the first place.
  const content = await readSkill(skill.path);
  if (content === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ skill, content: content.slice(0, 24_000), truncated: content.length > 24_000 });
}

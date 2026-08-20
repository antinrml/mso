// Per-PROJECT skill roots, across every configured project container.
//
// A skill that lives with the repository it automates is the normal case, and MSO
// was blind to all of them: only global roots (~/.mso/skills, the MSO repo, ~/.claude
// and friends) were cataloged, so an agent working in project X could not see X's own
// SKILL.md. That is capability scoping nobody chose.
//
// Trust is EARNED per directory, never assumed from the path. A project skill reaches
// `local` only when all three hold:
//   1. containment — the skill directory realpaths back inside the project directory,
//      so a `.claude/skills -> /tmp/attacker` symlink is discovered, not followed;
//   2. ownership   — the skill directory and its SKILL.md belong to the uid MSO runs
//      as, so a world-writable drop-in cannot become executable instructions;
//   3. shape       — SKILL.md is a regular file, not a symlink to somewhere else.
// Anything else is cataloged as `untrusted`: visible for inspection, instructions
// withheld. The generic HOME agent roots (~/.claude/skills, …) keep their existing
// untrusted behaviour — this promotion is for project-scoped roots only.
import { promises as fs } from "fs";
import path from "path";
import { listProjectDirs } from "@/lib/host/project-roots";
import { SKILL_FILE, type SkillTrust } from "./catalog-types";

/** Where a project may keep skills. `.mso/skills` is the explicit MSO root — the
 *  per-project counterpart of `~/.mso/skills` — and therefore ranks above the
 *  agent-tool conventions that follow it. */
export const PROJECT_SKILL_DIRS = [
  ".mso/skills",
  ".claude/skills",
  ".hermes/skills",
  ".agents/skills",
  ".codex/skills",
] as const;

export const PROJECT_SKILL_LIMITS = {
  /** Projects scanned for skills per catalog call. */
  maxProjects: 60,
  /** Skill directories taken from one project root. */
  maxSkillsPerRoot: 100,
  /** Project skills cataloged in total. */
  maxProjectSkills: 300,
} as const;

export type ProjectRef = { name: string; path: string };
export type ProjectSkillRoot = { path: string; project: ProjectRef; priority: number };

function currentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

async function ownedByUs(target: string): Promise<boolean> {
  const uid = currentUid();
  if (uid === undefined) return true; // no uid concept (Windows); containment + shape still apply
  const stat = await fs.lstat(target).catch(() => null);
  return !!stat && stat.uid === uid;
}

function contains(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The trust decision for ONE project skill directory. Exported so the catalog and
 * its tests exercise the same three checks rather than a reimplementation.
 */
export async function projectSkillTrust(skillDir: string, projectPath: string): Promise<SkillTrust> {
  const projectReal = await fs.realpath(projectPath).catch(() => null);
  const dirReal = await fs.realpath(skillDir).catch(() => null);
  if (!projectReal || !dirReal || !contains(projectReal, dirReal)) return "untrusted";
  const file = path.join(dirReal, SKILL_FILE);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return "untrusted";
  if (!(await ownedByUs(dirReal)) || !(await ownedByUs(file))) return "untrusted";
  return "local";
}

/**
 * Every per-project skill root on the box, in deterministic order: project order
 * from `listProjectDirs()` (configured container order, then name), then
 * `PROJECT_SKILL_DIRS` order. `priority` ranks a project skill BELOW every global
 * root, so a project can never shadow an operator or official skill.
 */
export async function projectSkillRoots(projectDirs?: Array<{ dir: string }>): Promise<ProjectSkillRoot[]> {
  const dirs = (projectDirs ?? (await listProjectDirs()).dirs).slice(0, PROJECT_SKILL_LIMITS.maxProjects);
  const out: ProjectSkillRoot[] = [];
  for (const { dir } of dirs) {
    const project: ProjectRef = { name: path.basename(dir), path: dir };
    for (const [index, sub] of PROJECT_SKILL_DIRS.entries()) {
      const root = path.join(dir, sub);
      const stat = await fs.lstat(root).catch(() => null);
      if (!stat?.isDirectory() && !stat?.isSymbolicLink()) continue;
      if (!(await fs.stat(root).catch(() => null))?.isDirectory()) continue;
      out.push({ path: root, project, priority: 60 - index });
    }
  }
  return out;
}

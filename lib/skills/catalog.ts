import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { SKILL_FILE, skillIsExecutableByDefault, type SkillInfo, type SkillSource, type SkillTrust } from "./catalog-types";
import { PROJECT_SKILL_LIMITS, projectSkillRoots, projectSkillTrust, type ProjectRef } from "./project-skills";

export { SKILL_FILE, skillIsExecutableByDefault };
export type { SkillInfo, SkillSource, SkillTrust };

type RootSpec = {
  path: string;
  source: SkillSource;
  trust: SkillTrust;
  priority: number;
  verifyClawHub?: boolean;
  project?: ProjectRef;
};

type CatalogOptions = {
  appDir?: string;
  homeDir?: string;
  /** Project directories to scan for per-project skill roots. Defaults to every
   *  project across every configured container; pass `[]` to catalog global roots only. */
  projectDirs?: Array<{ dir: string }>;
};

/**
 * Root priority is a security boundary, not just display order.
 *
 * Explicit operator-owned ~/.mso/skills may override anything: placing a file there
 * is an intentional MSO action. Official repo skills beat generic agent registries,
 * so installing a same-named OpenClaw/Claude/Codex skill cannot silently replace
 * MSO's own instructions. Bundled third-party skills are verified by their ClawHub
 * SKILL.md hash. Generic discovered roots are visible but untrusted.
 *
 * Per-project roots sit BELOW all of these (priority 56–60, see project-skills.ts)
 * and are addressed by a `<project>/<name>` id, so a project skill can neither
 * outrank nor collide with an operator or official one.
 */
export function skillRoots(appDir = process.cwd(), homeDir = os.homedir()): RootSpec[] {
  return [
    { path: path.join(homeDir, ".mso/skills"), source: "operator", trust: "local", priority: 120 },
    { path: path.join(appDir, "claude-skills"), source: "mso", trust: "official", priority: 100 },
    { path: path.join(appDir, "skills"), source: "bundled", trust: "untrusted", priority: 80, verifyClawHub: true },
    { path: path.join(homeDir, ".claude/skills"), source: "claude", trust: "untrusted", priority: 20 },
    { path: path.join(homeDir, ".agents/skills"), source: "agents", trust: "untrusted", priority: 20 },
    { path: path.join(homeDir, ".codex/skills"), source: "codex", trust: "untrusted", priority: 20 },
    { path: path.join(homeDir, ".openclaw/workspace/skills"), source: "openclaw", trust: "untrusted", priority: 20 },
    { path: path.join(homeDir, ".local/lib/node_modules/openclaw/skills"), source: "openclaw", trust: "untrusted", priority: 20 },
  ];
}

/**
 * Skills intentionally live outside OS_FS_READ_ROOTS. Only an exact SKILL.md is
 * readable here. A symlink to ~/.ssh/config resolves to basename "config" and is
 * refused. A symlink to another SKILL.md is equivalent to placing a SKILL.md in a
 * skill root and is therefore handled by the trust/source policy above.
 */
export async function readSkillFile(file: string): Promise<string | null> {
  const real = await fs.realpath(file).catch(() => null);
  if (!real || path.basename(real) !== SKILL_FILE) return null;
  return fs.readFile(real, "utf8").catch(() => null);
}

async function isSkillDir(root: string, entry: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  return (await fs.stat(path.join(root, entry.name)).catch(() => null))?.isDirectory() ?? false;
}

export function skillDescription(md: string): string {
  const yaml = /^---\n([\s\S]*?)\n---/.exec(md)?.[1];
  const fromYaml = yaml?.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "").trim();
  if (fromYaml) return fromYaml;
  return md.split("\n").find((line) => line.trim() && !line.startsWith("#") && !line.startsWith("---"))?.trim() ?? "";
}

type ClawHubOrigin = {
  registry?: string;
  ownerHandle?: string;
  installedVersion?: string;
  skillFile?: { sha256?: string };
};

async function verifiedBundledSkill(dir: string, md: string): Promise<Pick<SkillInfo, "trust" | "provenance">> {
  const originPath = path.join(dir, ".clawhub/origin.json");
  const raw = await fs.readFile(originPath, "utf8").catch(() => "");
  if (!raw) return { trust: "untrusted" };
  let origin: ClawHubOrigin;
  try {
    origin = JSON.parse(raw) as ClawHubOrigin;
  } catch {
    return { trust: "untrusted" };
  }
  const expected = origin.skillFile?.sha256?.toLowerCase();
  const actual = createHash("sha256").update(md).digest("hex");
  if (!expected || expected !== actual) return { trust: "untrusted" };
  return {
    trust: "verified",
    provenance: {
      registry: origin.registry,
      owner: origin.ownerHandle,
      version: origin.installedVersion,
      sha256: actual,
    },
  };
}

async function scanRoot(spec: RootSpec, budget: { left: number }): Promise<Array<{ skill: SkillInfo; priority: number }>> {
  const entries = await fs.readdir(spec.path, { withFileTypes: true }).catch(() => []);
  const found: Array<{ skill: SkillInfo; priority: number }> = [];
  const limit = spec.project ? PROJECT_SKILL_LIMITS.maxSkillsPerRoot : entries.length;
  for (const entry of entries.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    if (found.length >= limit || (spec.project && budget.left <= 0)) break;
    if (!(await isSkillDir(spec.path, entry))) continue;
    const dir = path.join(spec.path, entry.name);
    const file = path.join(dir, SKILL_FILE);
    const md = await readSkillFile(file);
    if (!md) continue;

    let trust = spec.trust;
    let provenance: SkillInfo["provenance"];
    if (spec.verifyClawHub) {
      const verified = await verifiedBundledSkill(dir, md);
      trust = verified.trust;
      provenance = verified.provenance;
    } else if (spec.project) {
      // Path alone grants nothing: containment, ownership and SKILL.md shape decide.
      trust = await projectSkillTrust(dir, spec.project.path);
      budget.left -= 1;
    }

    found.push({
      priority: spec.priority,
      skill: {
        id: spec.project ? `${spec.project.name}/${entry.name}` : entry.name,
        name: entry.name,
        path: file,
        description: skillDescription(md),
        source: spec.source,
        trust,
        ...(spec.project ? { project: spec.project } : {}),
        ...(provenance ? { provenance } : {}),
      },
    });
  }
  return found;
}

export async function catalogSkills(options: CatalogOptions = {}): Promise<SkillInfo[]> {
  const appDir = options.appDir ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const projectRoots = (await projectSkillRoots(options.projectDirs))
    .map((root): RootSpec => ({ path: root.path, source: "project", trust: "untrusted", priority: root.priority, project: root.project }));
  const chosen = new Map<string, { skill: SkillInfo; priority: number }>();
  const budget = { left: PROJECT_SKILL_LIMITS.maxProjectSkills };

  for (const spec of [...skillRoots(appDir, homeDir), ...projectRoots]) {
    for (const candidate of await scanRoot(spec, budget)) {
      const current = chosen.get(candidate.skill.id);
      if (!current || candidate.priority > current.priority) chosen.set(candidate.skill.id, candidate);
    }
  }

  return [...chosen.values()].map(({ skill }) => skill).sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolve a catalog id. Falls back to the bare `name` so pre-id callers and the
 *  `mso skills read <name>` CLI keep working for global skills. */
export function findSkill(skills: SkillInfo[], idOrName: string): SkillInfo | undefined {
  return skills.find((s) => s.id === idOrName) ?? skills.find((s) => s.name === idOrName && !s.project);
}

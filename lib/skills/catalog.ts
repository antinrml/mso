import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export const SKILL_FILE = "SKILL.md";

export type SkillTrust = "official" | "verified" | "local" | "untrusted";
export type SkillSource = "mso" | "bundled" | "operator" | "claude" | "agents" | "codex" | "openclaw";

export type SkillInfo = {
  name: string;
  path: string;
  description: string;
  source: SkillSource;
  trust: SkillTrust;
  provenance?: {
    registry?: string;
    owner?: string;
    version?: string;
    sha256?: string;
  };
};

type RootSpec = {
  path: string;
  source: SkillSource;
  trust: SkillTrust;
  priority: number;
  verifyClawHub?: boolean;
};

type CatalogOptions = { appDir?: string; homeDir?: string };

/**
 * Root priority is a security boundary, not just display order.
 *
 * Explicit operator-owned ~/.mso/skills may override anything: placing a file there
 * is an intentional MSO action. Official repo skills beat generic agent registries,
 * so installing a same-named OpenClaw/Claude/Codex skill cannot silently replace
 * MSO's own instructions. Bundled third-party skills are verified by their ClawHub
 * SKILL.md hash. Generic discovered roots are visible but untrusted.
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

export async function catalogSkills(options: CatalogOptions = {}): Promise<SkillInfo[]> {
  const appDir = options.appDir ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const chosen = new Map<string, { skill: SkillInfo; priority: number }>();

  for (const spec of skillRoots(appDir, homeDir)) {
    const entries = await fs.readdir(spec.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
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
      }

      const candidate: SkillInfo = {
        name: entry.name,
        path: file,
        description: skillDescription(md),
        source: spec.source,
        trust,
        ...(provenance ? { provenance } : {}),
      };
      const current = chosen.get(candidate.name);
      if (!current || spec.priority > current.priority) chosen.set(candidate.name, { skill: candidate, priority: spec.priority });
    }
  }

  return [...chosen.values()].map(({ skill }) => skill).sort((a, b) => a.name.localeCompare(b.name));
}

export const skillIsExecutableByDefault = (skill: Pick<SkillInfo, "trust">): boolean => skill.trust !== "untrusted";

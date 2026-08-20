import os from "os";
import path from "path";
import { scanRoot, type RootSpec } from "./catalog-scan";
import {
  SKILL_FILE, SKILL_SCAN_LIMITS, skillIsExecutableByDefault,
  type ProjectRef, type SkillInfo, type SkillScanCursor, type SkillScanReport, type SkillSource, type SkillTrust,
} from "./catalog-types";
import { discoveredProjects, projectSkillRoots } from "./project-skills";

export { SKILL_FILE, SKILL_SCAN_LIMITS, skillIsExecutableByDefault };
export { readSkillFile, skillDescription } from "./catalog-scan";
export type { ProjectRef, SkillInfo, SkillScanCursor, SkillScanReport, SkillSource, SkillTrust };

type CatalogOptions = {
  appDir?: string;
  homeDir?: string;
  /** Projects to scan for per-project skill roots. Defaults to every project across
   *  every configured container; pass `[]` to catalog global roots only. */
  projects?: ProjectRef[];
  /** A `scan.continuation.cursor` from a truncated build, to resume it. */
  cursor?: string;
};

export function encodeSkillCursor(cursor: SkillScanCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeSkillCursor(raw: string | undefined): SkillScanCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SkillScanCursor;
    if (!parsed || typeof parsed !== "object") return undefined;
    return {
      roots: Array.isArray(parsed.roots) ? parsed.roots.filter((r) => typeof r?.root === "string") : [],
      skipRoots: Array.isArray(parsed.skipRoots) ? parsed.skipRoots.filter((r) => typeof r === "string") : [],
      projectOffset: Number.isFinite(parsed.projectOffset) ? Math.max(0, Math.floor(parsed.projectOffset)) : 0,
    };
  } catch {
    return undefined;
  }
}

/**
 * Root priority is a security boundary, not just display order.
 *
 * Explicit operator-owned ~/.mso/skills may override anything: placing a file there
 * is an intentional MSO action. Official repo skills beat generic agent registries,
 * so installing a same-named OpenClaw/Claude/Codex skill cannot silently replace
 * MSO's own instructions. Bundled third-party skills are verified by their ClawHub
 * SKILL.md hash. Generic discovered roots are visible but untrusted.
 *
 * Per-project roots sit BELOW all of these (priority 56–60) and are addressed by a
 * `<rootId>/<project>/<name>` id, so a project skill can neither outrank nor collide
 * with an operator or official one — nor with the same-named project in another root.
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

export type SkillCatalog = { skills: SkillInfo[]; scan: SkillScanReport };

/** The full build, including what it could not cover. Callers that surface
 *  completeness to a model or an operator must use this, not `catalogSkills`. */
export async function catalogSkillsDetailed(options: CatalogOptions = {}): Promise<SkillCatalog> {
  const appDir = options.appDir ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const deadlineAt = Date.now() + SKILL_SCAN_LIMITS.maxScanMs;
  const cursor = decodeSkillCursor(options.cursor);
  const resumeRoots = new Map((cursor?.roots ?? []).map((r) => [r.root, r.entriesConsumed]));
  const skipRoots = new Set(cursor?.skipRoots ?? []);
  const projectOffset = cursor?.projectOffset ?? 0;
  const reasons: string[] = [];

  let projects = options.projects;
  if (!projects) {
    const discovered = await discoveredProjects();
    projects = discovered.projects;
    reasons.push(...discovered.truncationReasons);
  }
  const remaining = projects.slice(projectOffset);
  const { roots: projectRoots, truncated: projectsCapped } = await projectSkillRoots(remaining);
  if (projectsCapped) reasons.push("maxProjects");

  const specs: RootSpec[] = [
    ...skillRoots(appDir, homeDir),
    ...projectRoots.map((root): RootSpec => ({
      path: root.path, source: "project", trust: "untrusted", priority: root.priority, project: root.project,
    })),
  ];

  const chosen = new Map<string, { skill: SkillInfo; priority: number }>();
  const cursors: SkillScanCursor["roots"] = [];
  const pendingRoots: string[] = [];
  const doneRoots: string[] = [];
  const consumedProjects = new Set<string>();
  let projectSkills = 0;
  let stoppedAt = -1;

  for (const [index, spec] of specs.entries()) {
    if (skipRoots.has(spec.path)) { doneRoots.push(spec.path); continue; }
    if (Date.now() > deadlineAt) { reasons.push("deadline"); stoppedAt = index; break; }
    if (spec.project && projectSkills >= SKILL_SCAN_LIMITS.maxProjectSkills) {
      reasons.push("maxProjectSkills");
      stoppedAt = index;
      break;
    }
    const { found, hitCap, entriesVisited } = await scanRoot(spec, deadlineAt, resumeRoots.get(spec.path) ?? 0);
    if (hitCap) {
      reasons.push(`maxEntriesPerRoot:${spec.path}`);
      cursors.push({ root: spec.path, entriesConsumed: entriesVisited });
    } else {
      doneRoots.push(spec.path);
    }
    let overflowed = false;
    for (const candidate of found) {
      // The overall cap is checked INSIDE the loop. Checking it only before scanRoot
      // let one root carry the total from just under 300 to nearly 500.
      if (spec.project && projectSkills >= SKILL_SCAN_LIMITS.maxProjectSkills) {
        reasons.push("maxProjectSkills");
        overflowed = true;
        break;
      }
      if (spec.project) projectSkills += 1;
      const current = chosen.get(candidate.skill.id);
      if (!current || candidate.priority > current.priority) chosen.set(candidate.skill.id, candidate);
    }
    if (spec.project) consumedProjects.add(spec.project.id);
    if (overflowed) { stoppedAt = index; break; }
  }

  if (stoppedAt >= 0) pendingRoots.push(...specs.slice(stoppedAt).map((r) => r.path));
  const truncationReasons = [...new Set(reasons)];
  const pendingProjects = Math.max(0, projects.length - projectOffset - consumedProjects.size);
  return {
    skills: [...chosen.values()].map(({ skill }) => skill).sort((a, b) => a.id.localeCompare(b.id)),
    scan: {
      truncated: truncationReasons.length > 0,
      truncationReasons,
      scannedRoots: specs.length,
      scannedProjects: consumedProjects.size,
      ...(truncationReasons.length ? {
        continuation: {
          pendingRoots: [...new Set(pendingRoots)],
          cursors,
          pendingProjects,
          cursorSemantics: "readdir-position" as const,
          note: "Pass `cursor` back to resume. Positions are readdir order and are valid while the directories are unchanged.",
          cursor: encodeSkillCursor({
            roots: cursors,
            skipRoots: [...new Set(doneRoots)],
            projectOffset: projectOffset + consumedProjects.size,
          }),
        },
      } : {}),
    },
  };
}

export async function catalogSkills(options: CatalogOptions = {}): Promise<SkillInfo[]> {
  return (await catalogSkillsDetailed(options)).skills;
}

/**
 * Resolve a catalog id. The exact id always wins. A bare name is a CONVENIENCE, and
 * only when it is unambiguous: two projects may legitimately ship `deploy`, and
 * silently picking one would hand a model the wrong instructions. An ambiguous hint
 * returns the candidate ids instead of a guess.
 */
export function resolveSkill(skills: SkillInfo[], idOrName: string): { skill?: SkillInfo; ambiguous?: string[] } {
  const exact = skills.find((s) => s.id === idOrName);
  if (exact) return { skill: exact };
  const loose = skills.filter((s) =>
    s.name === idOrName || (s.project ? `${s.project.name}/${s.name}` === idOrName : false));
  if (loose.length === 1) return { skill: loose[0] };
  if (loose.length > 1) return { ambiguous: loose.map((s) => s.id) };
  return {};
}

/** Unambiguous-only lookup, for callers that just want a skill or a 404. */
export function findSkill(skills: SkillInfo[], idOrName: string): SkillInfo | undefined {
  return resolveSkill(skills, idOrName).skill;
}

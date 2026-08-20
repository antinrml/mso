// Reading ONE skill root: the bounded walk, the SKILL.md reader, and the ClawHub
// provenance check. Split from catalog.ts so the assembly/precedence logic there stays
// readable — and so every read on this side goes through the same byte-capped,
// O_NOFOLLOW reader rather than a convenient `fs.readFile`.
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import { SKILL_FILE, SKILL_SCAN_LIMITS, type ProjectRef, type SkillInfo, type SkillSource, type SkillTrust } from "./catalog-types";
import { projectSkillTrust } from "./project-skills";

export type RootSpec = {
  path: string;
  source: SkillSource;
  trust: SkillTrust;
  priority: number;
  verifyClawHub?: boolean;
  project?: ProjectRef;
};

/**
 * Skills intentionally live outside OS_FS_READ_ROOTS. Only an exact SKILL.md is
 * readable here: the path is realpath'd and its basename checked, so a link to
 * ~/.ssh/config resolves to basename "config" and is refused, while a link to another
 * SKILL.md stays equivalent to placing one in a skill root (handled by trust policy).
 * The realpath is then opened O_NOFOLLOW under a byte cap — an oversized SKILL.md is
 * skipped rather than loaded, because it is untrusted content.
 */
export async function readSkillFile(file: string): Promise<string | null> {
  const real = await fs.realpath(file).catch(() => null);
  if (!real || path.basename(real) !== SKILL_FILE) return null;
  return readBoundedRegularFile(real, SKILL_SCAN_LIMITS.maxSkillBytes);
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
  const raw = await readBoundedRegularFile(path.join(dir, ".clawhub/origin.json"), 64 * 1024);
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
    provenance: { registry: origin.registry, owner: origin.ownerHandle, version: origin.installedVersion, sha256: actual },
  };
}

/** Bounded `opendir` walk of ONE skill root — global roots included, which previously
 *  had no entry budget at all. Names are capped before anything is stat'd or read. */
async function skillDirNames(root: string, deadlineAt: number): Promise<{ names: string[]; hitCap: boolean }> {
  const names: string[] = [];
  let hitCap = false;
  const handle = await fs.opendir(root).catch(() => null);
  if (!handle) return { names, hitCap };
  try {
    for await (const entry of handle) {
      if (names.length >= SKILL_SCAN_LIMITS.maxEntriesPerRoot || Date.now() > deadlineAt) { hitCap = true; break; }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      names.push(entry.name);
    }
  } catch {
    // A root that vanishes mid-walk yields what we already have.
  }
  return { names: names.sort((a, b) => a.localeCompare(b)), hitCap };
}

export async function scanRoot(spec: RootSpec, deadlineAt: number): Promise<{ found: Array<{ skill: SkillInfo; priority: number }>; hitCap: boolean }> {
  const { names, hitCap } = await skillDirNames(spec.path, deadlineAt);
  const found: Array<{ skill: SkillInfo; priority: number }> = [];
  for (const name of names) {
    const dir = path.join(spec.path, name);
    if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) continue;
    const file = path.join(dir, SKILL_FILE);
    const md = await readSkillFile(file);
    if (md === null) continue;

    let trust = spec.trust;
    let provenance: SkillInfo["provenance"];
    if (spec.verifyClawHub) {
      const verified = await verifiedBundledSkill(dir, md);
      trust = verified.trust;
      provenance = verified.provenance;
    } else if (spec.project) {
      // Path alone grants nothing: containment, ownership and SKILL.md shape decide.
      trust = await projectSkillTrust(dir, spec.project.path);
    }

    found.push({
      priority: spec.priority,
      skill: {
        id: spec.project ? `${spec.project.id}/${name}` : name,
        name,
        path: file,
        description: skillDescription(md),
        source: spec.source,
        trust,
        ...(spec.project ? { project: spec.project } : {}),
        ...(provenance ? { provenance } : {}),
      },
    });
  }
  return { found, hitCap };
}


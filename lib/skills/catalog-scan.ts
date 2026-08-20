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
 * Skills intentionally live outside OS_FS_READ_ROOTS, so the read itself is the guard.
 *
 * The SUPPLIED path is opened, not a canonicalized substitute. The previous version
 * realpath'd first and then opened the *target* with O_NOFOLLOW, which enforced the
 * nofollow promise against a path the caller never gave us: a `SKILL.md -> other/SKILL.md`
 * symlink passed the basename check and was read. Now the final component must itself be
 * a regular file — `O_NOFOLLOW` fails with ELOOP on any symlink, whatever it points at —
 * and the byte cap is checked against `fstat` before any bytes move, because an oversized
 * SKILL.md is untrusted content we decline rather than truncate.
 *
 * Parent containment is a SEPARATE concern and belongs to the caller (`scanRoot` for the
 * root, `projectSkillTrust` for a project): canonicalizing the parent here would drag the
 * final component through `realpath` again and reopen exactly this hole.
 */
export async function readSkillFile(file: string): Promise<string | null> {
  if (path.basename(file) !== SKILL_FILE) return null;
  return readBoundedRegularFile(file, SKILL_SCAN_LIMITS.maxSkillBytes);
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
async function skillDirNames(root: string, deadlineAt: number, skipEntries = 0): Promise<{ names: string[]; hitCap: boolean; entriesVisited: number }> {
  const names: string[] = [];
  let hitCap = false;
  let entriesVisited = skipEntries;
  let seen = 0;
  const handle = await fs.opendir(root).catch(() => null);
  if (!handle) return { names, hitCap, entriesVisited };
  try {
    for await (const entry of handle) {
      seen += 1;
      if (seen <= skipEntries) continue;
      // EVERY dirent costs budget, accepted or not. Counting only directories meant a
      // root holding a million regular files still required a million iterations before
      // the advertised entry cap was reached.
      if (entriesVisited - skipEntries >= SKILL_SCAN_LIMITS.maxEntriesPerRoot || Date.now() > deadlineAt) { hitCap = true; break; }
      entriesVisited += 1;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      names.push(entry.name);
    }
  } catch {
    // A root that vanishes mid-walk yields what we already have.
  }
  return { names: names.sort((a, b) => a.localeCompare(b)), hitCap, entriesVisited };
}

export async function scanRoot(spec: RootSpec, deadlineAt: number, skipEntries = 0): Promise<{ found: Array<{ skill: SkillInfo; priority: number }>; hitCap: boolean; entriesVisited: number }> {
  const { names, hitCap: dirCap, entriesVisited } = await skillDirNames(spec.path, deadlineAt, skipEntries);
  let hitCap = dirCap;
  const found: Array<{ skill: SkillInfo; priority: number }> = [];
  for (const name of names) {
    // The deadline is enforced THROUGH the per-skill stat/read work too, not only in
    // the dirent loop, which is where a slow filesystem actually spends its time.
    if (Date.now() > deadlineAt) { hitCap = true; break; }
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
  return { found, hitCap, entriesVisited };
}


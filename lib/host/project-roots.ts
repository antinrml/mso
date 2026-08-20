// The project WALK: bounded enumeration of the containers project-containers.ts
// authorized, plus the truthful, RESUMABLE report of everything it could not cover.
//
// Three rules earned the hard way:
//   1. `truncated:false` means "this is all of it". Any cap sets `truncated:true` with
//      a named reason — a silent slice that claims completeness is how a model ends up
//      telling the owner a project does not exist.
//   2. EVERY dirent counts against the entry cap, accepted or not. Counting only the
//      entries we kept meant a container of a million regular files still cost a
//      million iterations before the "400 entry" cap was reached.
//   3. A cap is only honest if it can be continued. Every cap emits a cursor, and
//      passing it back resumes where the walk stopped.
import { promises as fs } from "fs";
import path from "path";
import { validateProjectChild } from "./project-candidate";
import { decodeCursor, encodeCursor } from "./project-cursor";
import {
  overflowRoots, projectContainers,
  PROJECT_LIMITS, type ProjectContainer, type ProjectRow, type ScanReport, type ScanCursor,
} from "./project-containers";

export {
  authorizedRoots, configuredRootPaths, containerFor, projectContainers, projectRoots, shortId, PROJECT_LIMITS,
} from "./project-containers";
export type { AuthorizedRoot, ProjectContainer, ProjectRow, ScanReport, ScanCursor } from "./project-containers";
export { decodeCursor, encodeCursor } from "./project-cursor";

type Walk = { dirs: string[]; entriesVisited: number; hitEntryCap: boolean; skipped: number };

/**
 * Bounded `opendir` iteration. Every dirent yielded increments the budget, so a
 * container full of rejected entries costs the cap and no more. `skipEntries` resumes a
 * previously truncated walk at the same readdir position.
 */
async function walkContainer(container: ProjectContainer, containerPaths: Set<string>, skipEntries: number, deadlineAt: number): Promise<Walk> {
  const names: string[] = [];
  let entriesVisited = skipEntries;
  let seen = 0;
  let hitEntryCap = false;
  let skipped = 0;
  const handle = await fs.opendir(container.path).catch(() => null);
  if (!handle) return { dirs: [], entriesVisited, hitEntryCap: false, skipped: 0 };
  try {
    for await (const entry of handle) {
      seen += 1;
      if (seen <= skipEntries) continue;
      // EVERY dirent costs budget — that is the whole point of counting here rather
      // than after the accept/reject decision.
      if (entriesVisited - skipEntries >= PROJECT_LIMITS.maxEntriesPerRoot || Date.now() > deadlineAt) {
        hitEntryCap = true;
        break;
      }
      entriesVisited += 1;
      if (!entry.isDirectory() || entry.name.startsWith(".")) { skipped += 1; continue; }
      names.push(entry.name);
    }
  } catch {
    // A directory that vanishes mid-walk yields what we already have.
  }
  names.sort((a, b) => a.localeCompare(b));

  const dirs: string[] = [];
  for (const name of names) {
    // The deadline is enforced THROUGH the metadata work too, not only in the dirent
    // loop: 400 lstat+realpath+stat triples on a cold or networked filesystem is where
    // a slow scan actually spends its time.
    if (Date.now() > deadlineAt) { hitEntryCap = true; break; }
    // `~/projects` under `~` is a CONTAINER, not a project inside its parent.
    if (containerPaths.has(path.join(container.path, name))) { skipped += 1; continue; }
    const candidate = await validateProjectChild(container, name);
    if (!candidate.ok) { skipped += 1; continue; }
    dirs.push(candidate.path);
  }
  return { dirs, entriesVisited, hitEntryCap, skipped };
}

export type ProjectDirs = {
  containers: ProjectContainer[];
  dirs: Array<{ container: ProjectContainer; dir: string }>;
  scan: ScanReport;
};

/** The one walk. `listProjectDirs()` is this over every discovered container; an
 *  explicit `rootHint` is this over exactly one. */
export async function listProjectDirsIn(
  containers: ProjectContainer[],
  options: { explicit?: boolean; cursor?: ScanCursor } = {},
): Promise<ProjectDirs> {
  const deadlineAt = Date.now() + PROJECT_LIMITS.maxScanMs;
  const dirs: Array<{ container: ProjectContainer; dir: string }> = [];
  const reasons: string[] = [];
  const scannedRoots: string[] = [];
  const skippedRoots = options.explicit ? [] : await overflowRoots();
  const containerPaths = new Set(containers.map((c) => c.path));
  const resumeRoots = new Map((options.cursor?.roots ?? []).map((r) => [r.root, r.entriesConsumed]));
  const skipRoots = new Set(options.cursor?.skipRoots ?? []);
  const cursors: ScanCursor["roots"] = [];
  const pendingRoots: string[] = [];
  let skippedProjects = 0;

  if (skippedRoots.length) { reasons.push("maxRoots"); pendingRoots.push(...skippedRoots.map((r) => r.path)); }
  for (const container of containers) {
    if (skipRoots.has(container.path)) continue;
    if (Date.now() > deadlineAt) {
      reasons.push("deadline");
      skippedRoots.push({ path: container.path, reason: "deadline" });
      pendingRoots.push(container.path);
      continue;
    }
    const walk = await walkContainer(container, containerPaths, resumeRoots.get(container.path) ?? 0, deadlineAt);
    scannedRoots.push(container.path);
    skippedProjects += walk.skipped;
    if (walk.hitEntryCap) {
      reasons.push(`maxEntriesPerRoot:${container.path}`);
      cursors.push({ root: container.path, entriesConsumed: walk.entriesVisited });
    }
    let capped = false;
    for (const dir of walk.dirs) {
      if (dirs.length >= PROJECT_LIMITS.maxProjects) { reasons.push("maxProjects"); capped = true; break; }
      dirs.push({ container, dir });
    }
    if (capped) {
      // Resume this container from where its accepted entries stopped, and leave the
      // remaining containers pending rather than pretending they were covered.
      cursors.push({ root: container.path, entriesConsumed: walk.entriesVisited - walk.dirs.length + dirs.length });
      pendingRoots.push(...containers.slice(containers.indexOf(container) + 1).map((c) => c.path));
      break;
    }
  }

  const truncationReasons = [...new Set(reasons)];
  const done = [...new Set(scannedRoots)].filter((r) => !cursors.some((c) => c.root === r) && !pendingRoots.includes(r));
  return {
    containers,
    dirs,
    scan: {
      truncated: truncationReasons.length > 0,
      truncationReasons,
      scannedRoots,
      skippedRoots,
      skippedProjects,
      ...(truncationReasons.length ? {
        continuation: {
          pendingRoots: [...new Set(pendingRoots)],
          cursors,
          cursorSemantics: "readdir-position" as const,
          note: "Pass `cursor` back to resume. Positions are readdir order and are valid while the directory is unchanged.",
          cursor: encodeCursor({ roots: cursors, skipRoots: done }),
        },
      } : {}),
    },
  };
}

/** Every project directory across every container, in container-then-name order. */
export async function listProjectDirs(cursor?: ScanCursor): Promise<ProjectDirs> {
  return listProjectDirsIn(await projectContainers(), { cursor });
}

export { listProjects } from "./project-list";
export type { ListProjectsResult } from "./project-list";

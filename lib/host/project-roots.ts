// The project WALK: bounded enumeration of the containers project-containers.ts
// authorized, plus the truthful report of everything it could not cover.
//
// `truncated:false` means "this is all of it". Hitting a root, entry, project or time
// cap sets `truncated:true` with a named reason, because a silent slice that claims
// completeness is how a model ends up telling the owner a project does not exist.
import { promises as fs } from "fs";
import path from "path";
import { isCredentialPath, isUnderRoot } from "./paths";
import { boundedGitMeta, packageMeta } from "./project-meta";
import {
  authorizedRoots, ownedByUs, overflowRoots, projectContainers,
  PROJECT_LIMITS, type ProjectContainer, type ProjectRow, type ScanReport,
} from "./project-containers";

export {
  authorizedRoots, containerFor, projectContainers, projectRoots, PROJECT_LIMITS,
} from "./project-containers";
export type { AuthorizedRoot, ProjectContainer, ProjectRow, ScanReport } from "./project-containers";

type Walk = { dirs: string[]; hitEntryCap: boolean; skipped: number };

/**
 * Bounded `opendir` iteration. Names are collected into an array capped at
 * `maxEntriesPerRoot`, so a container with a million entries costs a bounded walk and
 * a bounded array rather than one `readdir` that materializes the lot before slicing.
 */
async function walkContainer(container: ProjectContainer, containers: Set<string>, authorized: string[], deadlineAt: number): Promise<Walk> {
  const names: string[] = [];
  let hitEntryCap = false;
  let skipped = 0;
  const handle = await fs.opendir(container.path).catch(() => null);
  if (!handle) return { dirs: [], hitEntryCap: false, skipped: 0 };
  try {
    for await (const entry of handle) {
      if (names.length >= PROJECT_LIMITS.maxEntriesPerRoot || Date.now() > deadlineAt) { hitEntryCap = true; break; }
      // isDirectory() is false for a symlink, so a link out of the container is
      // dropped here rather than realpath-checked (and possibly followed) later.
      if (!entry.isDirectory() || entry.name.startsWith(".")) { if (!entry.isDirectory()) skipped += 1; continue; }
      names.push(entry.name);
    }
  } catch {
    // A directory that vanishes mid-walk yields what we already have.
  }
  names.sort((a, b) => a.localeCompare(b));

  const dirs: string[] = [];
  for (const name of names) {
    const full = path.join(container.path, name);
    if (containers.has(full) || isCredentialPath(full)) { skipped += 1; continue; }
    const stat = await fs.lstat(full).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) { skipped += 1; continue; }
    // Defence in depth against a swap between opendir and here: the entry must still
    // canonicalize to itself, inside its exact container AND inside an authorized root.
    const real = await fs.realpath(full).catch(() => null);
    if (real !== full || !isUnderRoot(real, container.path) || !authorized.some((a) => isUnderRoot(real, a))) { skipped += 1; continue; }
    if (!(await ownedByUs(real))) { skipped += 1; continue; }
    dirs.push(full);
  }
  return { dirs, hitEntryCap, skipped };
}

export type ProjectDirs = {
  containers: ProjectContainer[];
  dirs: Array<{ container: ProjectContainer; dir: string }>;
  scan: ScanReport;
};

/** The one walk. `listProjectDirs()` is this over every discovered container; an
 *  explicit `rootHint` is this over exactly one. */
export async function listProjectDirsIn(containers: ProjectContainer[], extraAuthorized: string[] = []): Promise<ProjectDirs> {
  const deadlineAt = Date.now() + PROJECT_LIMITS.maxScanMs;
  const authorized = [...(await authorizedRoots()).map((r) => r.path), ...extraAuthorized];
  const paths = new Set(containers.map((c) => c.path));
  const dirs: Array<{ container: ProjectContainer; dir: string }> = [];
  const reasons: string[] = [];
  const scannedRoots: string[] = [];
  const skippedRoots = extraAuthorized.length ? [] : await overflowRoots();
  let skippedProjects = 0;

  if (skippedRoots.length) reasons.push("maxRoots");
  for (const container of containers) {
    if (Date.now() > deadlineAt) {
      reasons.push("deadline");
      skippedRoots.push({ path: container.path, reason: "deadline" });
      continue;
    }
    const walk = await walkContainer(container, paths, authorized, deadlineAt);
    scannedRoots.push(container.path);
    skippedProjects += walk.skipped;
    if (walk.hitEntryCap) reasons.push(`maxEntriesPerRoot:${container.path}`);
    for (const dir of walk.dirs) {
      if (dirs.length >= PROJECT_LIMITS.maxProjects) { reasons.push("maxProjects"); break; }
      dirs.push({ container, dir });
    }
    if (reasons.includes("maxProjects")) break;
  }

  const truncationReasons = [...new Set(reasons)];
  return {
    containers,
    dirs,
    scan: { truncated: truncationReasons.length > 0, truncationReasons, scannedRoots, skippedRoots, skippedProjects },
  };
}

/** Every project directory across every container, in container-then-name order. */
export async function listProjectDirs(): Promise<ProjectDirs> {
  return listProjectDirsIn(await projectContainers());
}

export type ListProjectsResult = {
  roots: string[];
  containers: Array<{ id: string; path: string; derived: boolean; authorizedRoot: string }>;
  total: number;
  offset: number;
  limit: number;
  scan: ScanReport;
  projects: ProjectRow[];
};

/** Bounded, paginated enumeration. Metadata is read only for the returned PAGE —
 *  `total` counts directories, so a wide box does not pay for 400 package reads. */
export async function listProjects(options: { query?: string; limit?: number; offset?: number } = {}): Promise<ListProjectsResult> {
  const { containers, dirs, scan } = await listProjectDirs();
  const query = options.query?.trim().toLowerCase();
  const matched = query ? dirs.filter(({ dir }) => path.basename(dir).toLowerCase().includes(query)) : dirs;
  const limit = Math.min(Math.max(Math.round(options.limit ?? PROJECT_LIMITS.defaultPageSize), 1), PROJECT_LIMITS.maxPageSize);
  const offset = Math.max(Math.round(options.offset ?? 0), 0);
  const page = matched.slice(offset, offset + limit);
  const projects = await Promise.all(page.map(async ({ container, dir }) => {
    const [pkg, git] = await Promise.all([packageMeta(dir), boundedGitMeta(dir)]);
    const name = path.basename(dir);
    return {
      id: `${container.id}/${name}`,
      name,
      path: dir,
      rootId: container.id,
      root: container.path,
      authorizedRoot: container.authorizedRoot,
      ...(pkg.name ? { packageName: pkg.name } : {}),
      ...(pkg.version ? { packageVersion: pkg.version } : {}),
      ...(git.available ? { git: { branch: git.branch, head: git.head?.sha?.slice(0, 12) } } : {}),
    };
  }));
  return {
    roots: containers.map((c) => c.path),
    containers: containers.map(({ id, path: p, derived, authorizedRoot }) => ({ id, path: p, derived, authorizedRoot })),
    total: matched.length,
    offset,
    limit,
    scan,
    projects,
  };
}

// EVERY configured project container, not just ~/projects.
//
// MSO used to hard-code `~/projects` as "where projects live". That was invisible
// scoping: an owner who set OS_FS_READ_ROOTS to two or three checkout areas still
// had project resolution, skill discovery and the MCP bootstrap looking at exactly
// one of them, and nothing said so. A capability that silently covers a subset of
// what the owner configured is worse than one that refuses.
//
// A container is a directory that HOLDS projects. Every read root is one, plus its
// `projects/` subdirectory when it has one (the default `~` + `~/projects` pair is
// this case). The filesystem root is deliberately NOT a container: "/" as a read
// root means browse-anywhere, not "every top-level system directory is a project".
import { promises as fs } from "fs";
import path from "path";
import { isCredentialPath, readRootList } from "./paths";
import { boundedGitMeta, packageMeta } from "./project-meta";

export const PROJECT_LIMITS = {
  /** Containers scanned per call. */
  maxRoots: 12,
  /** Directory entries read per container before the listing is truncated. */
  maxEntriesPerRoot: 400,
  /** Projects enumerated in total, across all containers. */
  maxProjects: 400,
  defaultPageSize: 50,
  maxPageSize: 200,
} as const;

export type ProjectRow = {
  name: string;
  path: string;
  root: string;
  packageName?: string;
  packageVersion?: string;
  git?: { branch?: string; head?: string };
};

async function realDir(p: string): Promise<string | null> {
  const real = await fs.realpath(p).catch(() => null);
  if (!real) return null;
  const stat = await fs.stat(real).catch(() => null);
  return stat?.isDirectory() ? real : null;
}

/**
 * Deterministic: configured read-root order, each root followed by its `projects/`
 * child, deduped by realpath. Order is the contract — two calls on an unchanged box
 * must enumerate identically, or pagination lies.
 */
export async function projectRoots(): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const configured of readRootList()) {
    for (const candidate of [configured, path.join(configured, "projects")]) {
      const real = await realDir(candidate);
      if (!real || real === "/" || seen.has(real) || isCredentialPath(real)) continue;
      seen.add(real);
      out.push(real);
      if (out.length >= PROJECT_LIMITS.maxRoots) return out;
    }
  }
  return out;
}

/** A project directory: real, owner-visible, not hidden, not a symlink, not a
 *  credential path, and not a container in its own right (`~/projects` under `~`). */
async function projectDirsIn(root: string, containers: Set<string>): Promise<string[]> {
  const entries = (await fs.readdir(root, { withFileTypes: true }).catch(() => []))
    // isDirectory() is false for a symlink, so a link out of the container is
    // dropped here rather than realpath-checked later.
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, PROJECT_LIMITS.maxEntriesPerRoot);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (containers.has(full) || isCredentialPath(full)) continue;
    out.push(full);
  }
  return out;
}

/** Every project directory across every container, in root-then-name order. */
export async function listProjectDirs(): Promise<{ roots: string[]; dirs: Array<{ root: string; dir: string }>; truncated: boolean }> {
  const roots = await projectRoots();
  const containers = new Set(roots);
  const dirs: Array<{ root: string; dir: string }> = [];
  let truncated = false;
  for (const root of roots) {
    for (const dir of await projectDirsIn(root, containers)) {
      if (dirs.length >= PROJECT_LIMITS.maxProjects) { truncated = true; break; }
      dirs.push({ root, dir });
    }
    if (truncated) break;
  }
  return { roots, dirs, truncated };
}

export type ListProjectsResult = {
  roots: string[];
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
  projects: ProjectRow[];
};

/** Bounded, paginated enumeration. Metadata is read only for the returned PAGE —
 *  `total` counts directories, so a wide box does not pay for 400 package reads. */
export async function listProjects(options: { query?: string; limit?: number; offset?: number } = {}): Promise<ListProjectsResult> {
  const { roots, dirs, truncated } = await listProjectDirs();
  const query = options.query?.trim().toLowerCase();
  const matched = query ? dirs.filter(({ dir }) => path.basename(dir).toLowerCase().includes(query)) : dirs;
  const limit = Math.min(Math.max(Math.round(options.limit ?? PROJECT_LIMITS.defaultPageSize), 1), PROJECT_LIMITS.maxPageSize);
  const offset = Math.max(Math.round(options.offset ?? 0), 0);
  const page = matched.slice(offset, offset + limit);
  const projects = await Promise.all(page.map(async ({ root, dir }) => {
    const [pkg, git] = await Promise.all([packageMeta(dir), boundedGitMeta(dir)]);
    return {
      name: path.basename(dir),
      path: dir,
      root,
      ...(pkg.name ? { packageName: pkg.name } : {}),
      ...(pkg.version ? { packageVersion: pkg.version } : {}),
      ...(git.available ? { git: { branch: git.branch, head: git.head?.sha?.slice(0, 12) } } : {}),
    };
  }));
  return { roots, total: matched.length, offset, limit, truncated, projects };
}

import { promises as fs } from "fs";
import path from "path";
import { normalizeProjectKey, projectAliasesFor, projectAliasTarget } from "./project-aliases";
import { boundedGitMeta, fullGitMeta, packageMeta } from "./project-meta";
import { resolveReadable } from "./paths";
import { listProjectDirs, projectRoots } from "./project-roots";

export type ProjectResolution = {
  hint: string;
  name: string;
  path: string;
  root?: string;
  packageName?: string;
  aliases: string[];
  matchedBy: "path" | "name" | "alias" | "package" | "fuzzy";
};

async function resolvedDir(p: string): Promise<string | null> {
  const resolved = await resolveReadable(p).catch(() => null);
  if (!resolved) return null;
  return (await fs.stat(resolved).catch(() => null))?.isDirectory() ? resolved : null;
}

async function resolutionFor(dir: string, hint: string, matchedBy: ProjectResolution["matchedBy"], root?: string): Promise<ProjectResolution> {
  const name = path.basename(dir);
  const meta = await packageMeta(dir);
  return { hint, name, path: dir, ...(root ? { root } : {}), packageName: meta.name, aliases: projectAliasesFor(name), matchedBy };
}

/**
 * Resolve a project hint across EVERY configured container, not just `~/projects`.
 *
 * Deterministic order, exact before fuzzy: an absolute/`~` path wins outright; then
 * an exact directory name or known alias, probed container by container in
 * configured order; then one bounded scan that scores exact package names above
 * substring matches. Scanning first would let a fuzzy hit in the first container
 * beat an exact directory in the second, which is the kind of answer nobody can
 * reproduce.
 */
export async function resolveProjectHint(hint: string, rootHint?: string): Promise<ProjectResolution | null> {
  const raw = hint.trim();
  if (!raw) return null;
  const pathHint = raw.startsWith("projects/") ? `~/${raw}` : raw;
  if (/^(?:~\/|\/|\.\.?\/)/.test(pathHint)) {
    const resolved = await resolvedDir(pathHint);
    if (resolved) return resolutionFor(resolved, raw, "path");
  }

  const roots = rootHint ? [await resolveReadable(rootHint).catch(() => null)].filter((r): r is string => !!r) : await projectRoots();
  const query = normalizeProjectKey(raw);
  const aliasTarget = projectAliasTarget(raw);

  // Known aliases and exact directory names are the common path. Resolve them in
  // one bounded stat per container instead of scanning and parsing every package.
  const directName = aliasTarget ?? (/^[a-z0-9._-]+$/i.test(raw) ? raw : undefined);
  if (directName) {
    for (const root of roots) {
      const candidate = await resolvedDir(path.join(root, directName));
      if (candidate) return resolutionFor(candidate, raw, aliasTarget ? "alias" : "name", root);
    }
  }

  const { dirs } = rootHint
    ? { dirs: (await listProjectDirs()).dirs.filter(({ root }) => roots.includes(root)) }
    : await listProjectDirs();
  const candidates = await Promise.all(dirs.map(async ({ root, dir }) => {
    const name = path.basename(dir);
    const meta = await packageMeta(dir);
    const nameKey = normalizeProjectKey(name);
    const packageKey = normalizeProjectKey(meta.name ?? "");
    let score = 0;
    let matchedBy: ProjectResolution["matchedBy"] = "fuzzy";
    if (nameKey === query) { score = 100; matchedBy = "name"; }
    else if (aliasTarget && nameKey === normalizeProjectKey(aliasTarget)) { score = 98; matchedBy = "alias"; }
    else if (packageKey && packageKey === query) { score = 94; matchedBy = "package"; }
    else if (nameKey.includes(query) || query.includes(nameKey)) score = 65;
    else if (packageKey && (packageKey.includes(query) || query.includes(packageKey))) score = 60;
    return { name, dir, root, meta, score, matchedBy };
  }));
  // Ties break on name then path, so the same box always answers the same way.
  const best = candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.dir.localeCompare(b.dir))[0];
  if (!best || best.score < 60) return null;
  return {
    hint: raw, name: best.name, path: best.dir, root: best.root, packageName: best.meta.name,
    aliases: projectAliasesFor(best.name), matchedBy: best.matchedBy,
  };
}

export async function inspectProject(project: ProjectResolution, options: { includeGitStatus?: boolean } = {}) {
  return {
    git: options.includeGitStatus ? await fullGitMeta(project.path) : await boundedGitMeta(project.path),
    package: await packageMeta(project.path),
  };
}

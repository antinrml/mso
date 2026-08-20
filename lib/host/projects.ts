import { promises as fs } from "fs";
import path from "path";
import { normalizeProjectKey, projectAliasesFor, projectAliasTarget } from "./project-aliases";
import { boundedGitMeta, fullGitMeta, packageMeta } from "./project-meta";
import { isUnderRoot, resolveReadable } from "./paths";
import { containerFor, listProjectDirsIn, projectContainers, type ProjectContainer } from "./project-roots";

export type ProjectResolution = {
  hint: string;
  /** Globally unique `<rootId>/<name>`, matching projects_list. */
  id: string;
  name: string;
  path: string;
  rootId: string;
  root: string;
  packageName?: string;
  aliases: string[];
  matchedBy: "path" | "name" | "alias" | "package" | "fuzzy";
};

async function resolutionFor(container: ProjectContainer, dir: string, hint: string, matchedBy: ProjectResolution["matchedBy"]): Promise<ProjectResolution> {
  const name = path.basename(dir);
  const meta = await packageMeta(dir);
  return {
    hint, id: `${container.id}/${name}`, name, path: dir, rootId: container.id, root: container.path,
    packageName: meta.name, aliases: projectAliasesFor(name), matchedBy,
  };
}

/**
 * The exact-name / alias probe. It must refuse exactly what `projects_list` refuses,
 * or a hint quietly reaches a hidden directory or walks a symlink that enumeration
 * would never have shown — resolving through `resolveReadable` alone only proves the
 * TARGET is inside a read root, not that the ENTRY is a real child of this container.
 */
async function probeExactChild(container: ProjectContainer, name: string): Promise<string | null> {
  if (!name || name.startsWith(".") || name.includes("/") || name.includes("\\")) return null;
  const full = path.join(container.path, name);
  const stat = await fs.lstat(full).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return null;
  const real = await fs.realpath(full).catch(() => null);
  if (real !== full || !isUnderRoot(real, container.path)) return null;
  // The container itself came from an authorized root (or an explicit, readable
  // rootHint), so containment there is the jail check.
  return full;
}

/** The containers a hint may resolve inside. An explicit `rootHint` wins: the caller
 *  named that root, so it is used even when the global container list is at its cap —
 *  it still has to pass `resolveReadable`, so it is inside the read jail either way. */
async function containersFor(rootHint?: string): Promise<ProjectContainer[]> {
  if (!rootHint) return projectContainers();
  const real = await resolveReadable(rootHint).catch(() => null);
  if (!real || !(await fs.stat(real).catch(() => null))?.isDirectory()) return [];
  return [containerFor(real)];
}

/**
 * Resolve a project hint across EVERY configured container, not just `~/projects`.
 *
 * Deterministic order, exact before fuzzy: an absolute/`~` path wins outright; then
 * an exact directory name or known alias, probed container by container in configured
 * order; then one bounded scan that scores exact package names above substring
 * matches. Scanning first would let a fuzzy hit in the first container beat an exact
 * directory in the second, which is the kind of answer nobody can reproduce.
 */
export async function resolveProjectHint(hint: string, rootHint?: string): Promise<ProjectResolution | null> {
  const raw = hint.trim();
  if (!raw) return null;
  const containers = await containersFor(rootHint);
  if (!containers.length) return null;

  const pathHint = raw.startsWith("projects/") ? `~/${raw}` : raw;
  if (/^(?:~\/|\/|\.\.?\/)/.test(pathHint)) {
    const resolved = await resolveReadable(pathHint).catch(() => null);
    const isDir = resolved ? (await fs.stat(resolved).catch(() => null))?.isDirectory() === true : false;
    // With an explicit rootHint a path hint may not leave that root — otherwise
    // `../elsewhere` would silently escape the root the caller scoped the search to.
    const owner = isDir ? containers.find((c) => isUnderRoot(resolved!, c.path)) : undefined;
    if (isDir && (!rootHint || owner)) return resolutionFor(owner ?? containerFor(resolved!), resolved!, raw, "path");
    if (rootHint && isDir && !owner) return null;
  }

  const query = normalizeProjectKey(raw);
  const aliasTarget = projectAliasTarget(raw);

  // Known aliases and exact directory names are the common path. Resolve them in one
  // bounded lstat per container instead of scanning and parsing every package.
  const directName = aliasTarget ?? (/^[a-z0-9._-]+$/i.test(raw) ? raw : undefined);
  if (directName) {
    for (const container of containers) {
      const candidate = await probeExactChild(container, directName);
      if (candidate) return resolutionFor(container, candidate, raw, aliasTarget ? "alias" : "name");
    }
  }

  // Package/fuzzy runs over the SAME containers the exact probe used — including an
  // explicit rootHint that is absent from the globally capped list. Filtering a global
  // walk by root was the bug: a named-but-uncapped root could never match here.
  const { dirs } = await listProjectDirsIn(containers, rootHint ? containers.map((c) => c.path) : []);
  const candidates = await Promise.all(dirs.map(async ({ container, dir }) => {
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
    return { name, dir, container, meta, score, matchedBy };
  }));
  // Ties break on name then path, so the same box always answers the same way.
  const best = candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.dir.localeCompare(b.dir))[0];
  if (!best || best.score < 60) return null;
  return {
    hint: raw, id: `${best.container.id}/${best.name}`, name: best.name, path: best.dir,
    rootId: best.container.id, root: best.container.path, packageName: best.meta.name,
    aliases: projectAliasesFor(best.name), matchedBy: best.matchedBy,
  };
}

export async function inspectProject(project: ProjectResolution, options: { includeGitStatus?: boolean } = {}) {
  return {
    git: options.includeGitStatus ? await fullGitMeta(project.path) : await boundedGitMeta(project.path),
    package: await packageMeta(project.path),
  };
}

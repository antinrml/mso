import { promises as fs } from "fs";
import path from "path";
import { normalizeProjectKey, projectAliasesFor, projectAliasTarget } from "./project-aliases";
import { boundedGitMeta, fullGitMeta, packageMeta } from "./project-meta";
import { homeDir, isUnderRoot } from "./paths";
import { validateProjectChild, validateProjectDescendant, validateRootHint } from "./project-candidate";
import { configuredRootPaths, containerFor, listProjectDirsIn, projectContainers, type ProjectContainer } from "./project-roots";

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

function expandHome(p: string): string {
  const h = homeDir();
  if (p === "~") return h;
  if (p.startsWith("~/")) return path.join(h, p.slice(2));
  return path.resolve(p);
}

/**
 * The containers a hint may resolve inside. An explicit `rootHint` wins: the caller
 * named that root, so it is used even when the global container list is at its cap.
 *
 * It is validated with the SAME rules as a project entry — a symlinked or hidden
 * rootHint is refused rather than canonicalized into something the caller never named,
 * which is what `resolveReadable()` did. It must also still sit inside an authorized
 * read root, so naming a root never widens the jail.
 */
async function containersFor(rootHint?: string): Promise<ProjectContainer[]> {
  if (!rootHint) return projectContainers();
  const absolute = expandHome(rootHint);
  const validated = await validateRootHint(absolute);
  if (!validated.ok) return [];
  // Checked against EVERY configured root, not the scan-capped subset: naming a root
  // must never widen the jail, but the jail must not shrink just because 12 other roots
  // are configured ahead of it.
  const authorized = await configuredRootPaths();
  if (!authorized.some((root) => isUnderRoot(validated.path, root))) return [];
  return [containerFor(validated.path)];
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
    // A path hint gets the SAME component-by-component validation an enumerated entry
    // gets — hidden, symlinked or foreign-uid components are refused at every depth,
    // rather than canonicalized away by a single resolveReadable() call.
    const absolute = expandHome(pathHint);
    for (const container of containers) {
      if (!isUnderRoot(absolute, container.path)) continue;
      const candidate = await validateProjectDescendant(container, absolute);
      if (candidate.ok) return resolutionFor(container, candidate.path, raw, "path");
      return null; // it belongs to this container and was refused; do not try a wider one
    }
    return null;
  }

  const query = normalizeProjectKey(raw);
  const aliasTarget = projectAliasTarget(raw);

  // Known aliases and exact directory names are the common path. Resolve them in one
  // bounded lstat per container instead of scanning and parsing every package.
  const directName = aliasTarget ?? (/^[a-z0-9._-]+$/i.test(raw) ? raw : undefined);
  if (directName) {
    for (const container of containers) {
      const candidate = await validateProjectChild(container, directName);
      if (candidate.ok) return resolutionFor(container, candidate.path, raw, aliasTarget ? "alias" : "name");
    }
  }

  // Package/fuzzy runs over the SAME containers — and therefore the same validator —
  // the exact probe used, including an explicit rootHint absent from the capped list.
  const { dirs } = await listProjectDirsIn(containers, { explicit: Boolean(rootHint) });
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

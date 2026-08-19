import { promises as fs } from "fs";
import path from "path";
import { runCommand } from "./exec";
import { normalizeProjectKey, projectAliasesFor, projectAliasTarget } from "./project-aliases";
import { resolveReadable } from "./paths";

export type ProjectResolution = {
  hint: string;
  name: string;
  path: string;
  packageName?: string;
  aliases: string[];
  matchedBy: "path" | "name" | "alias" | "package" | "fuzzy";
};

type PackageMeta = { name?: string; version?: string; scripts: string[] };
type GitMeta = {
  available: boolean;
  branch?: string;
  clean?: boolean;
  changes?: string[];
  head?: { sha: string; subject?: string; date?: string };
  statusChecked: boolean;
  error?: string;
};

async function readRegularText(file: string): Promise<string> {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return "";
  return fs.readFile(file, "utf8").catch(() => "");
}

async function packageMeta(dir: string): Promise<PackageMeta> {
  try {
    const raw = await readRegularText(path.join(dir, "package.json"));
    if (!raw) return { scripts: [] };
    const parsed = JSON.parse(raw) as {
      name?: unknown; version?: unknown; scripts?: unknown;
    };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      scripts: parsed.scripts && typeof parsed.scripts === "object" ? Object.keys(parsed.scripts) : [],
    };
  } catch {
    return { scripts: [] };
  }
}

async function boundedGitMeta(dir: string): Promise<GitMeta> {
  const gitDir = path.join(dir, ".git");
  const gitStat = await fs.lstat(gitDir).catch(() => null);
  if (!gitStat?.isDirectory() || gitStat.isSymbolicLink()) return { available: false, statusChecked: false };
  const head = await readRegularText(path.join(gitDir, "HEAD"));
  if (!head) return { available: false, statusChecked: false };
  const candidateRef = head.trim().startsWith("ref: ") ? head.trim().slice(5) : undefined;
  const ref = candidateRef && /^refs\/(?:heads|remotes)\/[a-z0-9._\/-]+$/i.test(candidateRef) && !candidateRef.includes("..")
    ? candidateRef
    : undefined;
  const branch = ref?.replace(/^refs\/heads\//, "");
  let sha = ref ? (await readRegularText(path.join(gitDir, ref))).trim() : head.trim();
  if (!sha && ref) {
    const packed = await readRegularText(path.join(gitDir, "packed-refs"));
    sha = packed.split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? "";
  }
  return { available: true, branch, statusChecked: false, ...(sha ? { head: { sha } } : {}) };
}

async function fullGitMeta(dir: string): Promise<GitMeta> {
  const marker = "__MSO_HEAD__";
  const result = await runCommand(`git status --short --branch && printf '\n${marker}\n' && git log -1 --format='%H%n%s%n%aI'`, dir);
  if (result.code !== 0)
    return { available: false, statusChecked: true, error: (result.stderr || result.stdout).trim().slice(0, 220) };
  const [statusPart, headPart = ""] = result.stdout.split(`\n${marker}\n`);
  const statusLines = statusPart.split("\n").filter(Boolean);
  const changes = statusLines.slice(1, 81);
  const [sha = "", subject = "", date = ""] = headPart.trim().split("\n");
  return {
    available: true,
    branch: statusLines[0]?.replace(/^##\s*/, ""),
    clean: changes.length === 0,
    changes,
    statusChecked: true,
    head: { sha, subject, date },
  };
}

export async function resolveProjectHint(hint: string, rootHint = "~/projects"): Promise<ProjectResolution | null> {
  const raw = hint.trim();
  if (!raw) return null;
  const pathHint = raw.startsWith("projects/") ? `~/${raw}` : raw;
  if (/^(?:~\/|\/|\.\.?\/)/.test(pathHint)) {
    const resolved = await resolveReadable(pathHint).catch(() => null);
    if (resolved && (await fs.stat(resolved).catch(() => null))?.isDirectory()) {
      const meta = await packageMeta(resolved);
      return { hint: raw, name: path.basename(resolved), path: resolved, packageName: meta.name, aliases: projectAliasesFor(path.basename(resolved)), matchedBy: "path" };
    }
  }

  const root = await resolveReadable(rootHint);
  const query = normalizeProjectKey(raw);
  const aliasTarget = projectAliasTarget(raw);

  // Known aliases and exact directory names are the common path. Resolve them in
  // one bounded stat/read instead of scanning and parsing every project package.
  const directName = aliasTarget ?? (/^[a-z0-9._-]+$/i.test(raw) ? raw : undefined);
  if (directName) {
    const candidate = await resolveReadable(path.join(root, directName)).catch(() => null);
    if (candidate && (await fs.stat(candidate).catch(() => null))?.isDirectory()) {
      const meta = await packageMeta(candidate);
      const name = path.basename(candidate);
      return {
        hint: raw,
        name,
        path: candidate,
        packageName: meta.name,
        aliases: projectAliasesFor(name),
        matchedBy: aliasTarget ? "alias" : "name",
      };
    }
  }

  const entries = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).slice(0, 300);
  const candidates = await Promise.all(entries.map(async (entry) => {
    const dir = path.join(root, entry.name);
    const meta = await packageMeta(dir);
    const nameKey = normalizeProjectKey(entry.name);
    const packageKey = normalizeProjectKey(meta.name ?? "");
    let score = 0;
    let matchedBy: ProjectResolution["matchedBy"] = "fuzzy";
    if (nameKey === query) { score = 100; matchedBy = "name"; }
    else if (aliasTarget && nameKey === normalizeProjectKey(aliasTarget)) { score = 98; matchedBy = "alias"; }
    else if (packageKey && packageKey === query) { score = 94; matchedBy = "package"; }
    else if (nameKey.includes(query) || query.includes(nameKey)) score = 65;
    else if (packageKey && (packageKey.includes(query) || query.includes(packageKey))) score = 60;
    return { entry, dir, meta, score, matchedBy };
  }));
  const best = candidates.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))[0];
  if (!best || best.score < 60) return null;
  return {
    hint: raw, name: best.entry.name, path: best.dir, packageName: best.meta.name,
    aliases: projectAliasesFor(best.entry.name), matchedBy: best.matchedBy,
  };
}

export async function inspectProject(project: ProjectResolution, options: { includeGitStatus?: boolean } = {}) {
  return {
    git: options.includeGitStatus ? await fullGitMeta(project.path) : await boundedGitMeta(project.path),
    package: await packageMeta(project.path),
  };
}

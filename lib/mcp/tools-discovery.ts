import { listProjects, PROJECT_LIMITS } from "@/lib/host";
import { catalogSkills, findSkill, readSkillFile, skillIsExecutableByDefault } from "@/lib/skills/catalog";
import { type McpTool, str, opt, S, READ_ONLY } from "./tool-kit";

// GLOBAL discovery: every project container the owner configured, and every skill
// root inside them. MSO used to answer both questions from `~/projects` and the
// global skill roots alone, which quietly told a connected client that a
// multi-project box had one project and no project skills. All three tools are
// `read` — enumerating what exists changes nothing, and a read token is exactly the
// grant an agent should need to plan its work.

const SKILL_CONTENT_LIMIT = 24_000;
const SKILL_PAGE_MAX = 200;

const page = (a: Record<string, unknown>, max: number, fallback: number) => ({
  limit: Math.min(Math.max(Math.round(typeof a.limit === "number" ? a.limit : fallback), 1), max),
  offset: Math.max(Math.round(typeof a.offset === "number" ? a.offset : 0), 0),
});

export const DISCOVERY_TOOLS: McpTool[] = [
  {
    name: "projects_list",
    description:
      "Enumerate the owner's projects across EVERY configured project container (each OS_FS_READ_ROOTS entry and its projects/ subdirectory), not just ~/projects. " +
      "Returns name, absolute path, its container root, package name/version and bounded Git branch/head read straight off .git with no shell. " +
      "USE THIS FIRST when the user names a project you have not located — it is one call, needs no shell scope, and is the input to workflow_start's project hint. " +
      "Hidden directories, symlinks and credential paths are excluded; results are paginated.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "projects.list", max: 30, windowMs: 60_000 },
    inputSchema: S({
      query: { type: "string", description: "Optional case-insensitive substring matched against the directory name." },
      limit: { type: "number", minimum: 1, maximum: PROJECT_LIMITS.maxPageSize, description: `Page size. Default ${PROJECT_LIMITS.defaultPageSize}.` },
      offset: { type: "number", minimum: 0, description: "Page offset into the deterministic root-then-name ordering. Default 0." },
    }),
    run: (a) => listProjects({ query: opt(a, "query"), ...page(a, PROJECT_LIMITS.maxPageSize, PROJECT_LIMITS.defaultPageSize) }),
  },
  {
    name: "skills_list",
    description:
      "List every SKILL.md MSO can see: the global roots (operator ~/.mso/skills, official MSO skills, hash-verified bundles, generic agent registries) AND the per-project roots " +
      "(.mso/skills, .claude/skills, .hermes/skills, .agents/skills, .codex/skills) of every project across every configured container. " +
      "Each row carries the exact catalog id to pass to skills_read — a project skill is addressed as <project>/<name>, so two projects may ship the same skill name — plus trust, source and its project. " +
      "Trust is earned, not assumed: a project skill is only `local` after realpath containment, owner uid and a regular non-symlink SKILL.md.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "skills.list", max: 30, windowMs: 60_000 },
    inputSchema: S({
      project: { type: "string", description: "Optional project name or absolute path; keeps only skills belonging to that project." },
      trust: { type: "string", enum: ["official", "verified", "local", "untrusted"], description: "Optional exact trust filter." },
      query: { type: "string", description: "Optional case-insensitive substring matched against id and description." },
      limit: { type: "number", minimum: 1, maximum: SKILL_PAGE_MAX, description: "Page size. Default 100." },
      offset: { type: "number", minimum: 0, description: "Page offset into the id-sorted catalog. Default 0." },
    }),
    run: async (a) => {
      const project = opt(a, "project");
      const trust = opt(a, "trust");
      const query = opt(a, "query")?.toLowerCase();
      const all = await catalogSkills();
      const matched = all.filter((skill) => {
        if (project && skill.project?.name !== project && skill.project?.path !== project) return false;
        if (trust && skill.trust !== trust) return false;
        if (query && !`${skill.id} ${skill.description}`.toLowerCase().includes(query)) return false;
        return true;
      });
      const { limit, offset } = page(a, SKILL_PAGE_MAX, 100);
      return {
        total: matched.length,
        offset,
        limit,
        skills: matched.slice(offset, offset + limit).map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: skill.source,
          trust: skill.trust,
          instructionsReadable: skillIsExecutableByDefault(skill),
          ...(skill.project ? { project: skill.project } : {}),
          ...(skill.provenance ? { provenance: skill.provenance } : {}),
        })),
      };
    },
  },
  {
    name: "skills_read",
    description:
      "Read one skill's SKILL.md by its EXACT catalog id from skills_list or skills_search (a project skill is <project>/<name>). " +
      "Instructions are returned for official, hash-verified, operator-local and ownership-verified project skills. " +
      "An untrusted skill returns metadata only — inspect it as a file and move it into ~/.mso/skills after review to promote it. " +
      "The reader opens only a realpath'd file named SKILL.md, so a link pointing elsewhere is refused rather than followed.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "skills.read", max: 60, windowMs: 60_000 },
    inputSchema: S({
      name: { type: "string", description: "Exact catalog id from skills_list. Fuzzy names are not resolved here." },
    }, ["name"]),
    run: async (a) => {
      const id = str(a, "name");
      const skill = findSkill(await catalogSkills(), id);
      if (!skill) throw new Error(`unknown skill id "${id}" — call skills_list for the exact ids`);
      const meta = {
        id: skill.id, name: skill.name, description: skill.description, source: skill.source, trust: skill.trust,
        ...(skill.project ? { project: skill.project } : {}),
      };
      if (!skillIsExecutableByDefault(skill)) {
        return {
          ...meta,
          instructionsWithheld: true,
          reason: `trust=${skill.trust}: MSO does not feed unreviewed skill instructions to a model. Read ${skill.path} as a file, then move the reviewed skill into ~/.mso/skills to promote it.`,
        };
      }
      const content = await readSkillFile(skill.path);
      if (content === null) throw new Error(`skill "${id}" no longer has a readable SKILL.md`);
      return { ...meta, content: content.slice(0, SKILL_CONTENT_LIMIT), truncated: content.length > SKILL_CONTENT_LIMIT };
    },
  },
];

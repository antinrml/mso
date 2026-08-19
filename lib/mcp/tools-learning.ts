import { inspectProject, resolveProjectHint } from "@/lib/host";
import { finishWorkflow, markRecipeUsed, startWorkflow } from "@/lib/skills/memory";
import { searchSkillMemory } from "@/lib/skills/search";
import { allows } from "./scope";
import { type McpTool, str, opt, S } from "./tool-kit";
import { toolsetInfo } from "./toolset";

const visibleTools = async (scope: "read" | "write" | "exec"): Promise<McpTool[]> => {
  const { TOOLS } = await import("./tools");
  return TOOLS.filter((tool) => allows(scope, tool.scope));
};

export const LEARNING_TOOLS: McpTool[] = [
  {
    name: "workflow_start",
    description:
      "The ONE startup call for a multi-step task. It starts the workflow, searches trusted skills and prior recipes, " +
      "resolves project aliases, reports the current toolset/version, and inspects repository context when available. " +
      "Do not call skills_search first for the same task; this already includes it.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.start" as const, targetArg: "project" },
    inputSchema: S({
      intent: { type: "string", description: "The user's task in one complete sentence." },
      project: { type: "string", description: "Optional project/workspace or alias, e.g. os-vps, mso, projects/mso." },
      constraints: { type: "string", description: "Optional important constraints, such as no downtime or WebP only." },
    }, ["intent"]),
    run: async (a, context) => {
      const intent = str(a, "intent");
      const projectHint = opt(a, "project");
      const project = projectHint ? await resolveProjectHint(projectHint).catch(() => null) : null;
      const tools = await visibleTools(context.scope);
      const started = await startWorkflow({
        actor: context.actor,
        intent,
        project: project?.path ?? projectHint,
        constraints: opt(a, "constraints"),
      });
      const search = await searchSkillMemory(intent, {
        topK: 8,
        toolDocs: tools.map((tool) => ({
          name: tool.name, description: tool.description, scope: tool.scope, inputSchema: tool.inputSchema,
        })),
      });
      if (search.recommendedRecipe) await markRecipeUsed(search.recommendedRecipe.id);
      const repository = project
        ? await inspectProject(project, { includeGitStatus: context.scope === "exec" }).catch(() => undefined)
        : undefined;
      const toolset = toolsetInfo(tools, context.scope);
      return {
        ...started,
        bootstrap: {
          ready: true,
          toolset,
          project: project ?? (projectHint ? { hint: projectHint, matchedBy: "unresolved" } : undefined),
          repository,
          trace: [
            `[MSO] connected · ${context.scope} scope · ${toolset.toolCount} tools · ${toolset.version}/${toolset.hash}`,
            project ? `[Project] ${project.hint} → ${project.path} (${project.matchedBy})` : `[Project] ${projectHint ?? "not specified"}`,
            "[Plan] inspect → change → test/build when needed → verify → workflow_finish",
          ],
          policy: {
            simple: "Use bounded tools for one or two direct operations.",
            repository: "For repository-wide search, git, tests, builds, or 3+ related checks, use one narrow exec_run batch when exec scope is available.",
            progress: "Show only high-level feature/tool badges and outcomes; never private chain-of-thought.",
            finish: "Call workflow_finish only after independent verification.",
          },
        },
        search,
        instruction: "Use the returned project, trusted skill, and safe recipe directly. Verify the result, then call workflow_finish.",
      };
    },
  },
  {
    name: "workflow_finish",
    description:
      "Finish the active learned workflow after verification. MSO saves the redacted tool sequence, durations and outcome, merges it with a semantically equivalent recipe, " +
      "and keeps the fastest successful path for the next request. Never put credentials or raw file contents in summary.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.finish" as const, targetArg: "workflow_id" },
    inputSchema: S({
      workflow_id: { type: "string", description: "Optional id returned by workflow_start. Omit to finish this client's active workflow." },
      summary: { type: "string", description: "Concise outcome and verification result; no secrets." },
      success: { type: "boolean", description: "True only after the requested result is verified." },
    }, ["summary", "success"]),
    run: (a, context) => finishWorkflow({
      actor: context.actor,
      workflowId: opt(a, "workflow_id"),
      summary: str(a, "summary"),
      success: a.success === true,
    }),
  },
];

import { finishWorkflow, markRecipeUsed, startWorkflow } from "@/lib/skills/memory";
import { searchSkillMemory } from "@/lib/skills/search";
import { type McpTool, str, opt, S } from "./tool-kit";

const toolDocs = async () => {
  const { TOOLS } = await import("./tools");
  return TOOLS.map((t) => ({ name: t.name, description: t.description, scope: t.scope, inputSchema: t.inputSchema }));
};

export const LEARNING_TOOLS: McpTool[] = [
  {
    name: "workflow_start",
    description:
      "Start a learned workflow for a multi-step task. USE THIS before the first operational tool call when the task will likely need two or more calls. " +
      "MSO groups subsequent tool activity under this workflow and returns semantically similar skills, tools and the fastest successful recipe from prior runs.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.start" as const, targetArg: "project" },
    inputSchema: S({
      intent: { type: "string", description: "The user's task in one complete sentence." },
      project: { type: "string", description: "Optional project/workspace, e.g. projects/mso." },
      constraints: { type: "string", description: "Optional important constraints, such as no downtime or WebP only." },
    }, ["intent"]),
    run: async (a, context) => {
      const started = await startWorkflow({
        actor: context.actor,
        intent: str(a, "intent"),
        project: opt(a, "project"),
        constraints: opt(a, "constraints"),
      });
      const search = await searchSkillMemory(str(a, "intent"), { topK: 8, toolDocs: await toolDocs() });
      if (search.recommendedRecipe) await markRecipeUsed(search.recommendedRecipe.id);
      return {
        ...started,
        search,
        instruction: "Reuse a relevant successful recipe when safe. After verification, call workflow_finish so MSO can keep the fastest successful path.",
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

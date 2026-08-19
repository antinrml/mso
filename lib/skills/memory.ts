/* eslint-disable max-lines -- the atomic store, redaction policy and recipe merge must evolve together; splitting them would expose partially-safe persistence helpers. */
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { embedSkillText, hybridSemanticScore, normalizeSemanticText, SKILL_EMBEDDING_VERSION } from "./semantic";

export type WorkflowStepState = "completed" | "failed" | "denied" | "rate_limited";

export type WorkflowStep = {
  id: string;
  tool: string;
  state: WorkflowStepState;
  target?: string;
  /** Replayable, explicitly allowlisted scalar arguments. Never raw payloads. */
  args?: Record<string, string | number | boolean>;
  durationMs?: number;
  ts: string;
};

type WorkflowStepInput = Omit<WorkflowStep, "args"> & { args?: Record<string, unknown> };

export type ActiveWorkflow = {
  id: string;
  actor: string;
  intent: string;
  project?: string;
  constraints?: string;
  startedAt: string;
  steps: WorkflowStep[];
};

export type LearnedRecipe = {
  id: string;
  intent: string;
  normalizedIntent: string;
  project?: string;
  summary: string;
  embeddingVersion: string;
  embedding: number[];
  bestSteps: WorkflowStep[];
  lastSteps: WorkflowStep[];
  attempts: number;
  successes: number;
  failures: number;
  averageDurationMs: number;
  fastestDurationMs?: number;
  lastDurationMs: number;
  averageWallDurationMs: number;
  lastWallDurationMs: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

type SkillMemoryStore = {
  version: 1;
  active: Record<string, ActiveWorkflow>;
  recipes: Record<string, LearnedRecipe>;
};

export type FinishWorkflowResult = {
  workflow: ActiveWorkflow;
  recipe: LearnedRecipe;
  currentDurationMs: number;
  previousFastestMs?: number;
  improvedByMs?: number;
  improvedPct?: number;
};

const EMPTY = (): SkillMemoryStore => ({ version: 1, active: {}, recipes: {} });
let cache: SkillMemoryStore | null = null;
let cachePath = "";
let writeChain: Promise<unknown> = Promise.resolve();

function storePath(): string {
  const env = process.env.OS_SKILL_MEMORY_STORE?.trim();
  if (process.env.VITEST && !env) return path.join(os.tmpdir(), `mso-skill-memory-test-${process.pid}.json`);
  return (env || path.join(os.homedir(), ".mso", "skill-memory.json")).replace(/^~(?=$|\/)/, os.homedir());
}

async function loadStore(): Promise<SkillMemoryStore> {
  const file = storePath();
  if (cache && cachePath === file) return cache;
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      cache = EMPTY();
      cachePath = file;
      return cache;
    }
    throw e;
  }
  const parsed = JSON.parse(raw) as Partial<SkillMemoryStore>;
  cache = {
    version: 1,
    active: parsed.active && typeof parsed.active === "object" ? parsed.active : {},
    recipes: parsed.recipes && typeof parsed.recipes === "object" ? parsed.recipes : {},
  };
  cachePath = file;
  return cache;
}

async function persist(store: SkillMemoryStore): Promise<void> {
  const file = storePath();
  const snapshot = JSON.stringify(store, null, 2);
  const run = writeChain.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, file);
  });
  writeChain = run.catch(() => undefined);
  await run;
}

function actorKey(actor?: string): string {
  if (!actor) throw new Error("workflow memory needs an authenticated MCP actor");
  return actor;
}

function safeMemoryText(value: string, max: number): string {
  const out = value
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[opaque-id]")
    .trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

function safeTarget(tool: string, target?: string): string | undefined {
  if (!target) return undefined;
  let out = target
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  if (tool === "exec_run") {
    // Keep the command shape, not every argument. Quoted payloads and long opaque
    // values are where credentials most often hide.
    out = out
      .replace(/(['"])[\s\S]*?\1/g, "[value]")
      .replace(/\b[a-f0-9]{32,}\b/gi, "[id]")
      .split(/\s+/)
      .slice(0, 12)
      .join(" ");
  }
  out = out.replace(new RegExp(`^${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "~");
  return out.length > 160 ? `${out.slice(0, 160)}…` : out;
}

const SAFE_TOOL_ARGS: Record<string, readonly string[]> = {
  fs_list: ["path", "includeHidden"],
  fs_read: ["path"],
  fs_search: ["query", "root"],
  fs_usage: ["path"],
  apps_logs: ["id"],
  screen_capture: ["shell", "width", "height"],
  fs_write: ["path"], // content is intentionally impossible to persist
  fs_mkdir: ["path"],
  fs_move: ["from", "to"],
  fs_copy: ["from", "to"],
  fs_delete: ["path"],
  apps_power: ["id", "action"],
  exec_run: ["command", "cwd"],
  browser_power: ["on"],
};

function safeArgs(tool: string, args?: Record<string, unknown>): Record<string, string | number | boolean> | undefined {
  if (!args) return undefined;
  const keys = SAFE_TOOL_ARGS[tool];
  if (!keys) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
    else if (typeof value === "string" && value) {
      const safe = key === "command" ? safeTarget("exec_run", value) : safeMemoryText(value, 240);
      if (safe) out[key] = safe;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function enrichBestSteps(best: WorkflowStep[], current: WorkflowStep[]): WorkflowStep[] {
  if (best.length !== current.length || best.some((step, i) => step.tool !== current[i]?.tool)) return best;
  return best.map((step, i) => ({
    ...step,
    args: step.args ?? current[i]?.args,
    target: step.target ?? current[i]?.target,
  }));
}

function elapsedMs(steps: WorkflowStep[], wallMs: number): number {
  const sum = steps.reduce((n, s) => n + (s.durationMs ?? 0), 0);
  return sum > 0 ? sum : wallMs;
}

function recipeText(intent: string, project?: string, summary?: string): string {
  return [intent, project, summary].filter(Boolean).join("\n");
}

function closestRecipe(store: SkillMemoryStore, intent: string, project?: string): LearnedRecipe | undefined {
  let best: { recipe: LearnedRecipe; score: number } | undefined;
  for (const recipe of Object.values(store.recipes)) {
    const semantic = hybridSemanticScore(recipeText(intent, project), recipeText(recipe.intent, recipe.project));
    const exact = recipe.normalizedIntent === normalizeSemanticText(intent) ? 0.2 : 0;
    const projectBonus = project && recipe.project && normalizeSemanticText(project) === normalizeSemanticText(recipe.project) ? 0.08 : 0;
    const score = semantic + exact + projectBonus;
    if (!best || score > best.score) best = { recipe, score };
  }
  return best && best.score >= 0.48 ? best.recipe : undefined;
}

export async function startWorkflow(input: {
  actor?: string;
  intent: string;
  project?: string;
  constraints?: string;
}): Promise<{ workflow: ActiveWorkflow; replacedWorkflowId?: string }> {
  const actor = actorKey(input.actor);
  const intent = safeMemoryText(input.intent, 1000);
  if (!intent) throw new Error("intent must be a non-empty string");
  const store = await loadStore();
  const replacedWorkflowId = store.active[actor]?.id;
  const workflow: ActiveWorkflow = {
    id: randomUUID(),
    actor,
    intent,
    project: input.project ? safeMemoryText(input.project, 240) || undefined : undefined,
    constraints: input.constraints ? safeMemoryText(input.constraints, 500) || undefined : undefined,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  store.active[actor] = workflow;
  await persist(store);
  return { workflow, ...(replacedWorkflowId ? { replacedWorkflowId } : {}) };
}

export async function activeWorkflowForActor(actor?: string): Promise<ActiveWorkflow | null> {
  if (!actor) return null;
  const store = await loadStore();
  const workflow = store.active[actor];
  if (!workflow) return null;
  // Ignore abandoned sessions after six hours. The next workflow_start replaces it.
  if (Date.now() - new Date(workflow.startedAt).getTime() > 6 * 60 * 60_000) return null;
  return workflow;
}

export async function recordWorkflowStep(actor: string | undefined, workflowId: string | undefined, step: WorkflowStepInput): Promise<void> {
  if (!actor || !workflowId) return;
  const store = await loadStore();
  const workflow = store.active[actor];
  if (!workflow || workflow.id !== workflowId) return;
  if (["skills_search", "workflow_start", "workflow_finish"].includes(step.tool)) return;
  workflow.steps.push({
    ...step,
    target: safeTarget(step.tool, step.target),
    args: safeArgs(step.tool, step.args),
  });
  // A runaway client must not grow one JSON document forever.
  if (workflow.steps.length > 300) workflow.steps.splice(0, workflow.steps.length - 300);
  await persist(store);
}

export async function finishWorkflow(input: {
  actor?: string;
  workflowId?: string;
  summary: string;
  success: boolean;
}): Promise<FinishWorkflowResult> {
  const actor = actorKey(input.actor);
  const store = await loadStore();
  const workflow = store.active[actor];
  if (!workflow) throw new Error("no active workflow for this MCP client — call workflow_start first");
  if (input.workflowId && input.workflowId !== workflow.id) throw new Error("workflow_id does not match this client's active workflow");

  const now = new Date();
  const wallMs = Math.max(0, now.getTime() - new Date(workflow.startedAt).getTime());
  const durationMs = elapsedMs(workflow.steps, wallMs);
  const existing = closestRecipe(store, workflow.intent, workflow.project);
  const previousFastestMs = existing?.fastestDurationMs;
  const summary = safeMemoryText(input.summary, 1200) || (input.success ? "completed" : "failed");
  const vector = embedSkillText(recipeText(workflow.intent, workflow.project, summary));
  const timestamp = now.toISOString();

  let recipe: LearnedRecipe;
  if (existing) {
    const attempts = existing.attempts + 1;
    const successes = existing.successes + (input.success ? 1 : 0);
    const failures = existing.failures + (input.success ? 0 : 1);
    const faster = input.success && (existing.fastestDurationMs == null || durationMs < existing.fastestDurationMs);
    recipe = {
      ...existing,
      intent: workflow.intent,
      normalizedIntent: normalizeSemanticText(workflow.intent),
      project: workflow.project,
      summary,
      embeddingVersion: SKILL_EMBEDDING_VERSION,
      embedding: vector,
      lastSteps: workflow.steps,
      bestSteps: faster ? workflow.steps : (input.success ? enrichBestSteps(existing.bestSteps, workflow.steps) : existing.bestSteps),
      attempts,
      successes,
      failures,
      averageDurationMs: Math.round((existing.averageDurationMs * existing.attempts + durationMs) / attempts),
      fastestDurationMs: input.success ? Math.min(existing.fastestDurationMs ?? durationMs, durationMs) : existing.fastestDurationMs,
      lastDurationMs: durationMs,
      averageWallDurationMs: Math.round((existing.averageWallDurationMs * existing.attempts + wallMs) / attempts),
      lastWallDurationMs: wallMs,
      updatedAt: timestamp,
    };
  } else {
    recipe = {
      id: randomUUID(),
      intent: workflow.intent,
      normalizedIntent: normalizeSemanticText(workflow.intent),
      project: workflow.project,
      summary,
      embeddingVersion: SKILL_EMBEDDING_VERSION,
      embedding: vector,
      bestSteps: input.success ? workflow.steps : [],
      lastSteps: workflow.steps,
      attempts: 1,
      successes: input.success ? 1 : 0,
      failures: input.success ? 0 : 1,
      averageDurationMs: durationMs,
      fastestDurationMs: input.success ? durationMs : undefined,
      lastDurationMs: durationMs,
      averageWallDurationMs: wallMs,
      lastWallDurationMs: wallMs,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  store.recipes[recipe.id] = recipe;
  delete store.active[actor];
  // Keep the memory bounded. Prefer recipes that worked and were used recently.
  const recipes = Object.values(store.recipes);
  if (recipes.length > 200) {
    recipes
      .sort((a, b) => {
        const qa = a.successes * 10 - a.failures + new Date(a.lastUsedAt ?? a.updatedAt).getTime() / 1e13;
        const qb = b.successes * 10 - b.failures + new Date(b.lastUsedAt ?? b.updatedAt).getTime() / 1e13;
        return qa - qb;
      })
      .slice(0, recipes.length - 200)
      .forEach((r) => delete store.recipes[r.id]);
  }
  await persist(store);

  const improvedByMs = input.success && previousFastestMs != null && durationMs < previousFastestMs
    ? previousFastestMs - durationMs
    : undefined;
  return {
    workflow,
    recipe,
    currentDurationMs: durationMs,
    ...(previousFastestMs != null ? { previousFastestMs } : {}),
    ...(improvedByMs != null
      ? { improvedByMs, improvedPct: Math.round((improvedByMs / previousFastestMs!) * 1000) / 10 }
      : {}),
  };
}

export async function listLearnedRecipes(): Promise<LearnedRecipe[]> {
  const store = await loadStore();
  return Object.values(store.recipes).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function markRecipeUsed(id: string): Promise<void> {
  const store = await loadStore();
  const recipe = store.recipes[id];
  if (!recipe) return;
  recipe.lastUsedAt = new Date().toISOString();
  await persist(store);
}

/** Test-only cache reset; harmless in production and avoids module-reset tricks. */
export function resetSkillMemoryCache(): void {
  cache = null;
  cachePath = "";
  writeChain = Promise.resolve();
}

import { catalogSkills, readSkillFile, type SkillInfo } from "./catalog";
import { listLearnedRecipes, type LearnedRecipe } from "./memory";
import { embedSkillText, hybridSemanticScore, SKILL_EMBEDDING_VERSION } from "./semantic";

export type SkillSearchToolDoc = {
  name: string;
  description: string;
  scope: string;
  inputSchema?: { properties?: Record<string, unknown> };
};

export type SkillSearchHit = {
  kind: "recipe" | "skill" | "tool";
  id: string;
  name: string;
  /** Set when the hit is a skill that lives inside a project checkout. */
  project?: { name: string; path: string };
  score: number;
  description: string;
  source?: string;
  trust?: string;
  scope?: string;
  successRate?: number;
  fastestDurationMs?: number;
  attempts?: number;
  steps?: Array<{ tool: string; target?: string; args?: Record<string, string | number | boolean>; durationMs?: number }>;
  missingTools?: string[];
};

export type SkillSearchOptions = {
  topK?: number;
  includeUntrusted?: boolean;
  toolDocs?: SkillSearchToolDoc[];
  appDir?: string;
  homeDir?: string;
  /** Forwarded to catalogSkills; `[]` restricts the search to global roots. */
  projectDirs?: Array<{ dir: string }>;
};

function skillQuality(skill: SkillInfo): number {
  if (skill.trust === "official") return 0.09;
  if (skill.trust === "verified") return 0.07;
  if (skill.trust === "local") return 0.08;
  return -0.12;
}

function recipeQuality(recipe: LearnedRecipe): number {
  const successRate = recipe.attempts ? recipe.successes / recipe.attempts : 0;
  const evidence = Math.min(recipe.attempts, 6) / 6;
  return successRate * 0.13 + evidence * 0.05 + (recipe.successes > 0 ? 0.02 : 0);
}

export async function searchSkillMemory(query: string, options: SkillSearchOptions = {}): Promise<{
  engine: string;
  query: string;
  hits: SkillSearchHit[];
  recommendedRecipe?: SkillSearchHit;
}> {
  const q = query.trim();
  if (!q) throw new Error("query must be a non-empty string");
  const topK = Math.min(Math.max(Math.round(options.topK ?? 8), 1), 20);
  const hits: SkillSearchHit[] = [];
  const availableTools = options.toolDocs?.length ? new Set(options.toolDocs.map((t) => t.name)) : null;

  const recipes = await listLearnedRecipes();
  for (const recipe of recipes) {
    const text = [
      recipe.intent,
      recipe.project,
      recipe.summary,
      recipe.bestSteps.map((s) => `${s.tool} ${s.target ?? ""}`).join(" "),
    ].filter(Boolean).join("\n");
    const raw = hybridSemanticScore(q, text, recipe.embeddingVersion === SKILL_EMBEDDING_VERSION ? recipe.embedding : embedSkillText(text));
    const missingTools = availableTools
      ? [...new Set(recipe.bestSteps.map((s) => s.tool).filter((tool) => !availableTools.has(tool)))]
      : [];
    hits.push({
      kind: "recipe",
      id: recipe.id,
      name: recipe.intent,
      score: Math.max(0, Math.min(1, raw + recipeQuality(recipe) - missingTools.length * 0.15)),
      description: recipe.summary,
      source: "learned",
      trust: "local",
      successRate: recipe.attempts ? Math.round((recipe.successes / recipe.attempts) * 1000) / 10 : 0,
      fastestDurationMs: recipe.fastestDurationMs,
      attempts: recipe.attempts,
      steps: recipe.bestSteps.map((s) => ({ tool: s.tool, target: s.target, args: s.args, durationMs: s.durationMs })),
      ...(missingTools.length ? { missingTools } : {}),
    });
  }

  const skills = await catalogSkills({ appDir: options.appDir, homeDir: options.homeDir, projectDirs: options.projectDirs });
  for (const skill of skills) {
    if (!options.includeUntrusted && skill.trust === "untrusted") continue;
    const content = skill.trust === "untrusted" ? "" : (await readSkillFile(skill.path))?.slice(0, 18_000) ?? "";
    const text = `${skill.id}\n${skill.name}\n${skill.project?.name ?? ""}\n${skill.description}\n${content}`;
    hits.push({
      kind: "skill",
      id: skill.id,
      name: skill.name,
      ...(skill.project ? { project: skill.project } : {}),
      score: Math.max(0, Math.min(1, hybridSemanticScore(q, text) + skillQuality(skill))),
      description: skill.description,
      source: skill.source,
      trust: skill.trust,
    });
  }

  for (const tool of options.toolDocs ?? []) {
    const params = Object.keys(tool.inputSchema?.properties ?? {}).join(" ");
    const text = `${tool.name}\n${tool.description}\n${params}`;
    hits.push({
      kind: "tool",
      id: tool.name,
      name: tool.name,
      score: Math.min(1, hybridSemanticScore(q, text) + 0.055),
      description: tool.description,
      source: "mcp",
      trust: "official",
      scope: tool.scope,
    });
  }

  const sorted = hits
    .filter((h) => h.score >= 0.04)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, topK)
    .map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }));
  return {
    engine: SKILL_EMBEDDING_VERSION,
    query: q,
    hits: sorted,
    recommendedRecipe: sorted.find((h) => h.kind === "recipe" && h.score >= 0.22),
  };
}

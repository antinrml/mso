import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";
import { catalogSkills, readSkillFile, type SkillInfo } from "@/lib/skills/catalog";
import { listLearnedRecipes } from "@/lib/skills/memory";
import { searchSkillMemory } from "@/lib/skills/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const demoSkills: SkillInfo[] = [
  { name: "camoufox-browse", path: "demo://camoufox-browse", description: "Browser automation playbook for Camoufox.", source: "bundled", trust: "verified" },
  { name: "vps-alfa", path: "demo://vps-alfa", description: "Patrol and assist VPS terminal panes.", source: "mso", trust: "official" },
];

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  const query = req.nextUrl.searchParams.get("q")?.trim();
  if (IS_DEMO) {
    if (query) {
      const q = query.toLowerCase();
      return NextResponse.json({
        engine: "demo",
        query,
        hits: demoSkills
          .filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q))
          .map((s) => ({ kind: "skill", id: s.name, name: s.name, score: 1, description: s.description, source: s.source, trust: s.trust })),
      });
    }
    const skill = name ? demoSkills.find((s) => s.name === name) : null;
    return skill
      ? NextResponse.json({ skill, content: `# ${skill.name}\n\n${skill.description}\n\nDemo mode only lists this skill; it does not run host automation.` })
      : NextResponse.json({ skills: demoSkills, recipes: [] });
  }
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (query) {
    const { TOOLS } = await import("@/lib/mcp/tools");
    return NextResponse.json(await searchSkillMemory(query, {
      topK: Number(req.nextUrl.searchParams.get("top") ?? 8),
      includeUntrusted: req.nextUrl.searchParams.get("include_untrusted") === "1",
      toolDocs: TOOLS.map((t) => ({ name: t.name, description: t.description, scope: t.scope, inputSchema: t.inputSchema })),
    }));
  }

  const skills = await catalogSkills();
  if (!name) {
    const recipes = (await listLearnedRecipes()).map((r) => ({
      id: r.id, intent: r.intent, project: r.project, summary: r.summary, attempts: r.attempts,
      successes: r.successes, failures: r.failures, fastestDurationMs: r.fastestDurationMs, updatedAt: r.updatedAt,
    }));
    return NextResponse.json({ skills, recipes });
  }

  const skill = skills.find((s) => s.name === name);
  if (!skill) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const content = await readSkillFile(skill.path);
  if (content === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ skill, content: content.slice(0, 24_000), truncated: content.length > 24_000 });
}

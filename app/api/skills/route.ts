import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";
import { catalogSkills, readSkillFile, type SkillInfo } from "@/lib/skills/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const demoSkills: SkillInfo[] = [
  { name: "camoufox-browse", path: "demo://camoufox-browse", description: "Browser automation playbook for Camoufox.", source: "bundled", trust: "verified" },
  { name: "vps-alfa", path: "demo://vps-alfa", description: "Patrol and assist VPS terminal panes.", source: "mso", trust: "official" },
];

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (IS_DEMO) {
    const skill = name ? demoSkills.find((s) => s.name === name) : null;
    return skill
      ? NextResponse.json({ skill, content: `# ${skill.name}\n\n${skill.description}\n\nDemo mode only lists this skill; it does not run host automation.` })
      : NextResponse.json({ skills: demoSkills });
  }
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const skills = await catalogSkills();
  if (!name) return NextResponse.json({ skills });

  const skill = skills.find((s) => s.name === name);
  if (!skill) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const content = await readSkillFile(skill.path);
  if (content === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ skill, content: content.slice(0, 24_000), truncated: content.length > 24_000 });
}

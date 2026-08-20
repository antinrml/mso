// The catalog's shared vocabulary. Split from catalog.ts so per-project discovery
// can depend on the types without an import cycle back through the scanner.

export const SKILL_FILE = "SKILL.md";

export type SkillTrust = "official" | "verified" | "local" | "untrusted";
export type SkillSource = "mso" | "bundled" | "operator" | "claude" | "agents" | "codex" | "openclaw" | "project";

export type SkillInfo = {
  /** The exact catalog id, and the ONLY key `skills_read` accepts. Global skills are
   *  addressed by bare name; a project skill is `<project>/<name>`, so two projects
   *  may ship `deploy` without either one shadowing the other — or an official skill. */
  id: string;
  name: string;
  path: string;
  description: string;
  source: SkillSource;
  trust: SkillTrust;
  /** Present only for a skill discovered inside a project checkout. */
  project?: { name: string; path: string };
  provenance?: {
    registry?: string;
    owner?: string;
    version?: string;
    sha256?: string;
  };
};

export const skillIsExecutableByDefault = (skill: Pick<SkillInfo, "trust">): boolean => skill.trust !== "untrusted";

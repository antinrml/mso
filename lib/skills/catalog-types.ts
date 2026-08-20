// The catalog's shared vocabulary. Split from catalog.ts so per-project discovery
// can depend on the types without an import cycle back through the scanner.

export const SKILL_FILE = "SKILL.md";

export const SKILL_SCAN_LIMITS = {
  /** Directory entries READ from one skill root — global or per-project. */
  maxEntriesPerRoot: 200,
  /** Projects scanned for skills per catalog call. */
  maxProjects: 60,
  /** Project skills cataloged in total. */
  maxProjectSkills: 300,
  /** A SKILL.md larger than this is skipped, not truncated: it is untrusted content
   *  and reading it is the cost we are bounding. */
  maxSkillBytes: 256 * 1024,
  /** Wall-clock ceiling for one whole catalog build. */
  maxScanMs: 4000,
} as const;

export type SkillTrust = "official" | "verified" | "local" | "untrusted";
export type SkillSource = "mso" | "bundled" | "operator" | "claude" | "agents" | "codex" | "openclaw" | "project";

/** A project as the skill catalog sees it. `rootId` is the container id from
 *  `lib/host/project-roots`, which is what makes two same-named projects in different
 *  configured roots distinguishable rather than collapsed. */
export type ProjectRef = { id: string; name: string; path: string; rootId: string };

export type SkillInfo = {
  /** The exact catalog id, and the ONLY key `skills_read` resolves without ambiguity.
   *  A global skill is its bare name; a project skill is `<rootId>/<project>/<name>`,
   *  so two projects — in the same root or in different ones — can ship `deploy`
   *  without either shadowing the other or an official skill. */
  id: string;
  name: string;
  path: string;
  description: string;
  source: SkillSource;
  trust: SkillTrust;
  /** Present only for a skill discovered inside a project checkout. */
  project?: ProjectRef;
  provenance?: {
    registry?: string;
    owner?: string;
    version?: string;
    sha256?: string;
  };
};

/** What a catalog build could NOT cover. Mirrors lib/host's ScanReport so the two
 *  discovery surfaces report incompleteness the same way. */
export type SkillScanReport = {
  truncated: boolean;
  truncationReasons: string[];
  scannedRoots: number;
  scannedProjects: number;
};

export const skillIsExecutableByDefault = (skill: Pick<SkillInfo, "trust">): boolean => skill.trust !== "untrusted";

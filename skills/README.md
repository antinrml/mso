# MSO skill catalog

MSO exposes markdown playbooks from several roots, but discovery is **not** the same as trust.

## Trust and precedence

Highest precedence wins when two roots contain the same skill name:

1. `~/.mso/skills` — **local** operator override. This is the only host root that may intentionally replace an MSO skill.
2. `<MSO_ROOT>/claude-skills` — **official** MSO skills. These are always cataloged directly from the repo; Claude does not need to be installed and no symlink is required.
3. `<MSO_ROOT>/skills` — bundled third-party skills. A ClawHub skill is **verified** only while its current `SKILL.md` SHA-256 matches `.clawhub/origin.json`; otherwise it is **untrusted**.
4. Generic discovery roots (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, OpenClaw roots) — **untrusted** by default and cannot shadow the three roots above.

The assistant lists/loads only `official`, `verified`, and `local` instructions by default. Untrusted skills remain visible in the catalog for inspection, but their instructions are not fed directly to the model. Review one as a normal file, then copy/move the approved skill into `~/.mso/skills` if you intentionally want to trust it.

## Contract

Each skill is a directory containing `SKILL.md` with YAML frontmatter (`name`, `description`). MSO returns catalog metadata including `source`, `trust`, and verified provenance when available.

Skill roots are intentionally read outside the normal filesystem jail, because agent skill registries may live outside `OS_FS_READ_ROOTS`. The reader therefore opens only a file named exactly `SKILL.md` after `realpath`; a symlink such as `SKILL.md -> ~/.ssh/config` is refused. Root trust/precedence handles the remaining instruction-supply-chain risk.

## Bundled third-party skill

`camoufox-browse` comes from ClawHub (`zenaufa`, installed version 1.0.7). Its `.clawhub/origin.json` records the artifact and skill hashes. Do not edit its `SKILL.md` in place: a modification intentionally invalidates verification. Put MSO-specific policy in an official wrapper skill instead.

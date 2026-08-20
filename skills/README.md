# MSO skill catalog

MSO exposes markdown playbooks from several roots — **global roots and the per-project roots of every project on the box** — but discovery is **not** the same as trust.

## Trust and precedence

Highest precedence wins when two roots contain the same catalog id:

1. `~/.mso/skills` — **local** operator override. This is the only host root that may intentionally replace an MSO skill.
2. `<MSO_ROOT>/claude-skills` — **official** MSO skills. These are always cataloged directly from the repo; Claude does not need to be installed and no symlink is required.
3. `<MSO_ROOT>/skills` — bundled third-party skills. A ClawHub skill is **verified** only while its current `SKILL.md` SHA-256 matches `.clawhub/origin.json`; otherwise it is **untrusted**.
4. Generic HOME discovery roots (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, OpenClaw roots) — **untrusted** by default and cannot shadow the three roots above.
5. **Per-project roots**, inside every project across every configured container: `.mso/skills`, then `.claude/skills`, `.hermes/skills`, `.agents/skills`, `.codex/skills`. Ranked below every global root.

The assistant lists/loads only `official`, `verified`, and `local` instructions by default. Untrusted skills remain visible in the catalog for inspection, but their instructions are not fed directly to the model. Review one as a normal file, then copy/move the approved skill into `~/.mso/skills` if you intentionally want to trust it.

## Ids: a project skill cannot shadow anything

A global skill is addressed by its bare **name**. A project skill is `<project>/<name>`.
So two projects may both ship `deploy`, and neither can displace the operator or
official skill of the same name — the collision is impossible rather than resolved.
`skills_read` / `skills.read` accept the **exact id only**; they do not fuzzy-resolve
`deploy` into `widget/deploy`.

## Project skills earn `local` trust; they do not inherit it

Living in a project grants nothing by itself. A project skill is promoted to `local`
only when all three hold:

1. **Containment** — the skill directory realpaths back inside its project, so a
   `.claude/skills -> /tmp/attacker` symlink is *discovered*, not followed.
2. **Ownership** — the skill directory and its `SKILL.md` belong to the uid MSO runs as.
3. **Shape** — `SKILL.md` is a regular file, not a symlink to somewhere else.

Anything else is cataloged `untrusted`. The generic HOME agent roots keep their existing
untrusted behaviour; this promotion applies to project-scoped roots only.

Scans are bounded: 60 projects, 100 skills per root, 300 project skills and 24,000
characters of instructions per read.

## Contract

Each skill is a directory containing `SKILL.md` with YAML frontmatter (`name`, `description`). MSO returns catalog metadata including `id`, `source`, `trust`, its `project` when it has one, and verified provenance when available.

Skill roots are intentionally read outside the normal filesystem jail, because agent skill registries may live outside `OS_FS_READ_ROOTS`. The reader therefore opens only a file named exactly `SKILL.md` after `realpath`; a symlink such as `SKILL.md -> ~/.ssh/config` is refused. Root trust/precedence handles the remaining instruction-supply-chain risk.

## Bundled third-party skill

`camoufox-browse` comes from ClawHub (`zenaufa`, installed version 1.0.7). Its `.clawhub/origin.json` records the artifact and skill hashes. Do not edit its `SKILL.md` in place: a modification intentionally invalidates verification. Put MSO-specific policy in an official wrapper skill instead.

## Semantic search and learned recipes

The catalog — global roots and every project's roots together — is indexed with the
live MCP tool schemas and successful workflow recipes, and each skill hit carries its
project. `workflow_start` searches the same unified catalog, so a workflow named against
one project still finds the relevant skill in another.
`skills_search` / `skills.search` and `GET /api/skills?q=...` use
the local `mso-local-hybrid-v1` encoder, so searches work across English, Indonesian
and minor typos without a cloud embedding API. Untrusted skill instructions remain
excluded by default.

A multi-step MCP client can bracket work with `workflow_start` and
`workflow_finish`. MSO records only redacted terminal tool steps, explicitly allowlisted scalar
arguments, timings and the verified outcome in `~/.mso/skill-memory.json`, merges semantically equivalent
intents, and retains the fastest successful sequence as a future recipe. Failed
attempts remain evidence but never replace a successful path. Recipes are ranked
with trust, semantic relevance, observed success rate, speed and current tool
availability; they are suggestions, not permission to skip scope or approval gates.

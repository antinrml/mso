# Bundled skills

Skills that ship WITH MSO, so a fresh install has a catalog before anything else is
installed on the host. `/api/skills` reads this directory first, then the host-owned
roots (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`,
`~/.openclaw/workspace/skills`, `~/.local/lib/node_modules/openclaw/skills`) — a host
copy of the same name wins, so an operator can override a bundled skill without
editing the repo.

`~/.claude/skills` is where `scripts/install.sh` symlinks mso's own agent skills
(`/mso`, `/mso-camoufox`, `/mso-apps`, `/mso-list`, `/mso-image-editor`). It was
missing from the root list until 2026-08-10, which meant the documents describing how
to drive mso were the one catalog mso itself could not see.

**These roots are read OUTSIDE the fs jail** — not filtered by `OS_FS_READ_ROOTS`, not
checked against the credential denylist in `lib/host/paths.ts`. Narrowing your read
roots does not narrow this route. The route therefore opens exactly two things: a
directory listing, and a file named exactly `SKILL.md` that still resolves under one
of these roots after `realpath` (so a symlinked `SKILL.md` cannot serve `~/.ssh/config`).

Each skill is a directory containing `SKILL.md` with YAML frontmatter (`name`,
`description`). That is the whole contract; the route reads nothing else.

## Provenance

`camoufox-browse` is NOT ours. It comes from the ClawHub registry
(https://clawhub.ai), slug `camoufox-browse`, owner handle `zenaufa`, version 1.0.7 —
see `camoufox-browse/.clawhub/origin.json` for the artifact hashes it was installed
with. It is vendored here so MSO lists it without OpenClaw installed. It carries no
license file of its own; if that matters for your deployment, delete the directory —
the route degrades to whatever the host roots provide.

# Bundled skills

Skills that ship WITH MSO, so a fresh install has a catalog before anything else is
installed on the host. `/api/skills` reads this directory first, then the host-owned
roots (`~/.agents/skills`, `~/.codex/skills`, `~/.openclaw/workspace/skills`,
`~/.local/lib/node_modules/openclaw/skills`) — a host copy of the same name wins, so
an operator can override a bundled skill without editing the repo.

Each skill is a directory containing `SKILL.md` with YAML frontmatter (`name`,
`description`). That is the whole contract; the route reads nothing else.

## Provenance

`camoufox-browse` is NOT ours. It comes from the ClawHub registry
(https://clawhub.ai), slug `camoufox-browse`, owner handle `zenaufa`, version 1.0.7 —
see `camoufox-browse/.clawhub/origin.json` for the artifact hashes it was installed
with. It is vendored here so MSO lists it without OpenClaw installed. It carries no
license file of its own; if that matters for your deployment, delete the directory —
the route degrades to whatever the host roots provide.

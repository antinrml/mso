# Changelog

**Generated — do not edit.** `node scripts/gen-changelog.mjs`, run by `bun run ship`.
Newest first. `docs/PROGRESS.md` is the source of truth for *why* a change was made;
this is the *what*, and it is what Settings → About shows as “What's new”.

## 2026-08-11

**Added**

- `ship` one command that changelogs, pushes, rebuilds and verifies
- `shells` Windows/iOS/Android to their 2026 specs, plus a backup for local state

**Fixed**

- `ai` Codex DOES do tool calling — implement it instead of announcing it cannot
- `pwa,chat` notch clearance, a doubled iOS inset, and an assistant that was lying

**Tests**

- `e2e` a browser that actually loads the page — and the three bugs it found

**Docs**

- `progress` log the shell-spec pass, the springs, and the backup

## 2026-08-10

**Added**

- give Alfa the reach MCP has, and a gate so they cannot drift apart again
- `mcp` managed-app logs and lifecycle, tiered by blast radius not by layer
- `mcp` an MCP server so ChatGPT, Claude.ai or Cursor can drive this VPS

**Fixed**

- `cli` four missing verbs, a prod-breaking build, and a silently-wrong --base
- close the four cheap findings from the tool-surface parity audit
- `mcp` the audit trail was recording refused commands as successes
- `audit` stop a test run appending to the owner's forensic trail
- `mcp` record what an MCP token did — the trail it was bypassing
- `a11y,perf` name the dock icons, announce login errors, stop the resize storm
- `perf,ux` halve the boot API calls, unstick the dead chunk spinner, cut 9 orphans

**Faster**

- get the shell chrome and the Alfa catalog out of first load

**Changed**

- delete five retired subsystems nothing could reach

**Docs**

- `progress` log the three-surface parity audit and what it fixed
- `progress` log the MCP server and what was verified live
- cut five finished plans, trim PROGRESS's tail, log the audit follow-up

## 2026-08-04

**Fixed**

- `hydration` render the shell after mount — zero mismatches anywhere
- `hydration` kill 3 of 4 React #418 sources; mobile contrast + back labels
- `css` un-break every border-color utility, and make Android's Back visible

## 2026-08-03

**Added**

- `ci` real dependency + build gates, and fix the sharp CVE they caught
- migrate pnpm -> bun, and fix what the audit actually found
- `shell` Docs app, a state-aware dock, and quicklinks back to the owner
- `cli` print a paste-ready command under every device
- `cli` complete API coverage, doctor, completion, global options
- `cli` device pending + revoke all, per-command help, version
- `cli` add `mso` CLI + agent skills so the web UI is one frontend, not the product

**Fixed**

- `a11y` raise 4 mobile touch targets to the WCAG 24x24 floor
- `security` close 3 of 4 rm -rf bypasses, and stop a corrupt file wiping the device allowlist
- `cli` name the near-miss flag, and report what's left after a revoke
- `cli` make `device` a subcommand group and say what an unknown command was

**Faster**

- keep the OS shell out of every route, stop sleeping on every stats poll

**Changed**

- delete 836 net lines of metadata and dead exports nothing reads
- `quicklinks` owner's links become owner's data, repo keeps a neutral fallback
- rename os-vps -> mso across code, config and prod wiring

**Docs**

- reconcile every live doc against what the box actually does
- `progress` record the 2026-08-03 bun migration, audit and gate work

**Chores**

- drop the one-shot contrast tuner nothing invokes

## 2026-08-02

**Other**

- Initial commit

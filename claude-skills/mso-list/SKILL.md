---
name: mso-list
description: List every mso app + its functions and check they actually work end-to-end (live probe of all /api/v1 calls). Trigger on /mso-list, "list os features", "check all os functions", "audit os apps", "what works in the os", "are the os functions working".
---

# /mso-list — audit all OS apps + functions

Enumerate every mso app, its user-facing functions / AI-Inspector actions, and
verify the backing calls work against the live host. Pairs with [/mso] (control)
and [/mso-camoufox] (browser deep-dive).

## 1. Live probe (run this first)

```bash
cd /home/rahman/projects/mso && node ~/.claude/skills/mso-list/audit.js
```
Signs in and probes **13 of the ~36 `/api/v1` routes** — the read + fs-mutate
core, not the whole surface. Override with `OS_BASE`, `OS_PASSWORD`, `OS_DEVICE`.
No extra deps. A function is "working" only if its endpoint returns 2xx here; a
route it does not probe is UNKNOWN, not passing. `mso -h` and `docs/CLI.md` are
the complete list.

## 2. App → function matrix

| App | Functions | Backing call | Notes |
|---|---|---|---|
| **shell** | open/close/min/max/snap, dock, launchpad, Spotlight ⌘K, AI Inspector ⌘I, menu File/Edit/View | local store | no host call |
| **files-manager** | navigate, breadcrumb/back/fwd, favorites (real roots), live tree, new folder/file, rename, move (drag), copy/cut/paste, trash*, upload, details | `fs.list/mkdir/write/move/copy/remove/usage` | trash to /.Trash fails on live (outside write root) |
| **code-editor** | live tree, open (fs.read), edit, save (fs.write), new file, tabs | `fs.read/write/list` | |
| **terminal** | ls/cat/cd (+13 builtins), mkdir/rm/mv/cp/touch (live fs), unknown cmd → host shell | `fs.*`, `exec.run` | live passthrough |
| **browser** | a real Firefox (Camoufox) streamed over noVNC | `/api/v1/camoufox/*` | driven by hand, not by API — see [/mso-camoufox] |
| **system-monitor** | gauges, sparklines, process table, refresh | `sys.stats/processes` | |
| **reel-editor** | timeline, clips, keyframes, render→.webm, Inspector "Render" | client canvas | render is client-side |
| **media-studio** | layers, tools, filters, export, Inspector add/export/undo | client | |
| **media-viewer** | image/video/audio view, download, open-in-editor | `fs.read` | |
| **app-store / create-app** | install/uninstall, create runtime app | localStorage registry | no host call; Convex was removed in Phase 15 |
| **runtime-app** | html→iframe, command runtime→Run console | `exec.run` | |
| **os-settings** | theme/accent/device, server mock/live, AI key, devices approve, MCP tokens | `/api/prefs`, `/api/config`, `/api/auth/devices`, `/api/mcp/tokens` | |
| **assistant (Alfa)** | streaming chat, agents/skills/automations | `/api/assistant` | needs ANTHROPIC_API_KEY |
| **AI Inspector** (every app) | Properties (live state) + scoped AI chat | `usePublishInspector` + `/api/assistant` | AI tab needs ANTHROPIC_API_KEY |

## 3. Caveats that make a function "look broken"

- **AI tab / Alfa**: blank/"no key" until a provider key is set in
  `~/projects/mso/.env.local` or Settings → AI. Backend route is fine; it just has
  no key. (Prod is systemd, not Dokploy — restart the unit after editing the env.)
- **Live mode**: file/exec/sys functions only hit the VPS when Settings → Server →
  **Live**. In Mock they use the in-browser sim. Token must be present.
- **Trash on live**: `/.Trash` is outside the write root → move fails. Known gap.
- **Browser in-page nav**: works via the injected click-through; heavy SPAs / login
  flows still constrained — see [/mso-camoufox].

Report = the probe table + which apps are fully green vs gated (AI key / live mode).

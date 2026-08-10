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
Signs in (device-password, password + approved device from env or defaults) and
hits every `/api/v1` endpoint, printing a pass/fail table. Override with env
`OS_BASE`, `OS_CONVEX`, `OS_PASSWORD`, `OS_DEVICE`. Needs the `convex` dep (run
from the repo). A function is "working" only if its endpoint returns 2xx here.

## 2. App → function matrix

| App | Functions | Backing call | Notes |
|---|---|---|---|
| **shell** | open/close/min/max/snap, dock, launchpad, Spotlight ⌘K, AI Inspector ⌘I, menu File/Edit/View | local store | no host call |
| **files-manager** | navigate, breadcrumb/back/fwd, favorites (real roots), live tree, new folder/file, rename, move (drag), copy/cut/paste, trash*, upload, details | `fs.list/mkdir/write/move/copy/remove/usage` | trash to /.Trash fails on live (outside write root) |
| **code-editor** | live tree, open (fs.read), edit, save (fs.write), new file, tabs | `fs.read/write/list` | |
| **terminal** | ls/cat/cd (+13 builtins), mkdir/rm/mv/cp/touch (live fs), unknown cmd → host shell | `fs.*`, `exec.run` | live passthrough |
| **browser** | omnibar nav, back/fwd/reload, bookmarks, history, in-page link/form click-through | `/api/v1/proxy` | see [/mso-camoufox] |
| **system-monitor** | gauges, sparklines, process table, refresh | `sys.stats/processes` | |
| **reel-editor** | timeline, clips, keyframes, render→.webm, Inspector "Render" | client canvas | render is client-side |
| **media-studio** | layers, tools, filters, export, Inspector add/export/undo | client | |
| **media-viewer** | image/video/audio view, download, open-in-editor | `fs.read` | |
| **app-store / create-app** | install/uninstall, create runtime app | Convex `features/apps` | |
| **runtime-app** | html→iframe, command runtime→Run console | `exec.run` | |
| **os-settings** | theme/accent/device, server mock/live, AI key, devices approve | Convex + local | |
| **assistant (Alfa)** | streaming chat, agents/skills/automations | `/api/assistant` | needs ANTHROPIC_API_KEY |
| **AI Inspector** (every app) | Properties (live state) + scoped AI chat | `usePublishInspector` + `/api/assistant` | AI tab needs ANTHROPIC_API_KEY |

## 3. Caveats that make a function "look broken"

- **AI tab / Alfa**: blank/"no key" until `ANTHROPIC_API_KEY` is set in the Dokploy
  mso env (or Settings → AI). Backend route is fine; it just has no key.
- **Live mode**: file/exec/sys functions only hit the VPS when Settings → Server →
  **Live**. In Mock they use the in-browser sim. Token must be present.
- **Trash on live**: `/.Trash` is outside the write root → move fails. Known gap.
- **Browser in-page nav**: works via the injected click-through; heavy SPAs / login
  flows still constrained — see [/mso-camoufox].

Report = the probe table + which apps are fully green vs gated (AI key / live mode).

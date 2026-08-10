---
name: mso-apps
description: Drive ANY mso app from the CLI — one app→function→command matrix for Files, Code Editor, Terminal, System Monitor, Browser, Media Viewer, Media Studio, Reel Editor, Settings, Assistant, App Store. Trigger on /mso-apps, "drive an os app", "os files / terminal / code editor / system monitor / settings from cli", "what os app does X", "operate mso feature".
---

# /mso-apps — every mso app from the CLI

One reference for operating each app. Everything routes through three transports
([/mso] owns them): `mso` (host fs/exec/sys + generic `crud`), `/mso-camoufox`
(a real logged-in browser), `image-editor.sh` (editor-document CRUD). Deep dives:
[/mso] (control + crud), [/mso-image-editor] (editor docs), [/mso-list] (LIVE audit
of every function).

```bash
OS=mso
IE=/home/rahman/.claude/skills/mso-image-editor/image-editor.sh
```

## App → function → CLI

| App | Functions | Drive it with |
|---|---|---|
| **Files** | list/open/new/rename/move/copy/delete, usage | `$OS ls\|cat\|write\|mkdir\|mv\|cp\|rm\|usage` · `$OS crud {list,get,set,del}` |
| **Code Editor** | tree, open, edit, save, new file | `$OS cat <f>` / `$OS write <f> <content>` (or edit directly — this box IS the VPS) |
| **Terminal** | fs builtins + host shell passthrough | `$OS exec "<cmd>"` · `$OS ps` |
| **System Monitor** | CPU/mem/disk gauges, process table | `$OS stats` · `$OS ps` (read-only) |
| **Browser** | navigate, click/type, read — by HAND, over VNC | `$OS camoufox start && $OS camoufox session` → open the noVNC URL. There is no scriptable verb; see [/mso-camoufox] |
| **Media Viewer** | view image/video/audio, download | `$OS cat`/copy → **Read** the image here; `$OS exec "ffprobe <f>"` for AV |
| **Media Studio** | layers/text/shapes/adjust/style canvas | `$IE …` (it's the image editor) — see [/mso-image-editor] |
| **Image Editor** | full editor-document CRUD + render | `$IE open\|new\|run\|inspect\|save\|view` · `$OS crud set <doc.json> <cmd>` |
| **Reel Editor** | timeline/clips/keyframes, render→.webm | asset prep `$OS exec "ffmpeg …"`; timeline + render are browser-only |
| **Settings** | devices, AI key (BYOK), server mock/live, theme | `node ~/projects/mso/scripts/approve-device.js <id>`; key → `~/.mso/config.json`; theme/server = UI |
| **Assistant (Alfa)** | streaming chat + editor tool-calling | `POST /api/assistant` (needs BYOK key); for editing prefer deterministic `$IE`/`crud` |
| **App Store / Create-App** | install/uninstall, runtime apps | built-ins = `shell.manifest.ts` (+redeploy); runtime cmd app == `$OS exec`; install = UI |

## Notes

- **Generic CRUD** is the spine: `mso crud {list|get|set|del}` works on any host
  resource; `set <x.doc.json> <editor-cmd>` edits an editor document atomically
  (one server op). Files/code/terminal/monitor are fully CLI-driven; Studio/Reel
  **render** in the real app (open in the browser) — there is no headless renderer.
- **What CRUD reaches (honest scope):** host files + editor docs + `~/.mso/*.json`
  (config/devices). It does NOT reach browser-local state — theme, server mock/live
  toggle, window layout, the installed-app registry all live in localStorage
  (per-browser); set those in the UI. System stats are read-only.
- **Raster ops are browser-only by design:** brush/paint pixels, layer masks, and
  background removal need the live editor (no headless canvas). The CLI works at
  the document level (layers/text/shape/adjust/style/transform); paint there, save,
  and it round-trips back to the file.
- **Stateless edits:** each `crud set` is independent — no persistent undo/redo or
  tool/brush state across calls; selection defaults to the last layer (target any
  other with `layerName=`/`layerId=`). Keep file backups for "undo".
- **"Working" = the live probe passes.** Run `node ~/.claude/skills/mso-list/audit.js`
  for the authoritative per-function pass/fail (this matrix is the map; the audit
  is the truth). AI features (Alfa, Inspector) need a BYOK Anthropic key.
- Direct action is often best: this box IS the VPS, so Bash + the native file
  tools beat round-tripping through `mso` for heavy/local work. Use `mso` to
  reproduce exactly what an app does or to honour its bounded fs semantics.

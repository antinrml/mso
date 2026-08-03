# mso — Slice Catalog

> **Generated from `frontend/slices/` on 2026-07-28.** The previous version listed six
> slices that no longer existed (`browser` and five `shell-*` slices that converged into
> `appshell/features/*`) and omitted five that do. If this table and the directory ever
> disagree again, the directory is right.

Every OS app is a vertical slice. Slices are authored lift-ready (props-driven, no
hardcoded consumer URLs/env/roles). Slices read the host through the `lib/os-api`
contract, served by `lib/host` (fs/exec/sys) or `MockAdapter`.

## Slices (20)

| Slug | Kind | Category | Purpose |
|---|---|---|---|
| `app-store` | full | ui | App Store — discover & install apps |
| `appshell` | full | ui | AppShell — manifest-driven desktop + mobile shell |
| `assistant` | full | ai | Alfa — AI assistant chat |
| `auth` | full | auth | Auth — HMAC signed-cookie gate |
| `camoufox-browser` | full | ui | Browser — real Firefox over VNC |
| `code-editor` | full | ui | Code — overlay syntax editor |
| `create-app` | frontend | ui | Create App — author an os-rr app from a manifest |
| `files-manager` | full | infra | Files — VPS file manager |
| `image-editor` | frontend | ui | Image Editor — layered raster editor |
| `image-picker` | ui | ui | Image Picker — one-button image/wallpaper chooser (gallery · upload · link · Unsplash · reposition) |
| `managed-apps` | — | — | Managed applications — Hermes + OpenClaw lifecycle, update centre, dashboard proxy. **No `slice.json`** — `scripts/check-slices.mjs` skips it, so it is the one slice with no validated contract |
| `media-studio` | full | ui | Media Studio — photo / image editor |
| `media-viewer` | full | ui | Preview — media quick-look |
| `os-settings` | full | ui | Settings — appearance + VPS server |
| `os-shell` | full | ui | os-shell — Manef Shell OS consumer of the AppShell framework |
| `os-terminal` | full | infra | Terminal — xterm.js pty app |
| `quicklinks` | full | ui | Quicklinks — website shortcuts with favicons |
| `reel-editor` | frontend | ui | Reel — video timeline editor |
| `shell-settings` | full | ui | Shell feature — Settings (appearance panels) |
| `system-monitor` | full | infra | System Monitor — CPU / RAM / disk |

## Shell features (12) — `appshell/features/*`

Each mounts into a named `<Slot>` via `defineFeature`. `appshell/defaults.ts` bundles
them as `DEFAULT_FEATURES`. `desktop-icons` and `force-quit` live here but are imported
directly by `appshell/components/desktop.tsx` rather than being slot features.

| Feature |
|---|
| `clipboard` |
| `control-center` |
| `desktop-icons` |
| `force-quit` |
| `inspector` |
| `lock-screen` |
| `notifications` |
| `quick-look` |
| `search` |
| `share` |
| `shortcut-help` |
| `widgets` |

`shell-settings` is a flat UI-primitives slice, not a feature unit.

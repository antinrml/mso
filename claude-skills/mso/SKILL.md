---
name: mso
description: Control the mso web OS + its VPS host from here. Drive the live OS at mso.rahmanef.com — browse/read/write files anywhere on the VPS, run shell commands, manage apps, check system status, deploy. Trigger on /mso, "control the os", "control my vps", "drive mso", "open the OS", "run on the vps", "browse the vps files".
---

# /mso — control the VPS OS

Operate **mso** (live web OS at https://mso.rahmanef.com) and its VPS host.
mso is **self-contained**: it runs AS a host process (systemd, :4005) and does
fs/exec/sys itself — NO Control Room agent, NO Convex. This box (`srv614914`) IS
the VPS, so you can also act directly via Bash.

## Two ways to act

1. **Direct (you run AS rahman on this box)** — just use Bash. Fastest for local work.
2. **Through mso** (`mso`) — drives the host the SAME `/api/v1` the web OS
   uses, so behaviour matches what the user sees. Use to reproduce/debug the OS or
   get its bounded fs semantics.

```bash
SH=mso
$SH health                      # session ok?
$SH ls ~/projects               # list (READ = whole filesystem)
$SH cat ~/projects/mso/README.md
$SH exec "df -h && uptime"      # run anything (full shell)
$SH write ~/scratch/note.txt "hi"   # WRITE bounded to home + ~/projects
$SH mkdir ~/scratch/new ; $SH mv ~/a.txt ~/projects/a.txt
$SH stats ; $SH ps              # telemetry + processes
```

### Generic resource CRUD (`crud`)

One pattern for every host resource (`mso crud`):

```bash
$SH crud list ~/projects                 # → fs.list
$SH crud get  ~/notes/a.md               # → fs.read
$SH crud set  ~/notes/a.md "plain text"  # write a file
$SH crud set  ~/x.doc.json layer.add kind=text text=Hi   # edit an editor DOC (atomic, 1 call)
$SH crud del  ~/notes/a.md ; $SH crud cmds   # delete ; list editor commands
```

`crud set <path.json> <editor-cmd k=v…>` is a SINGLE atomic server op (route reads
the doc file → applies the command → writes it back in place; missing file is
seeded, an existing non-doc file is REFUSED, not clobbered). Truly CRUD-able =
host files + editor docs + the `~/.mso/*.json` config/device files. NOT
crud-able (live in the browser): theme/server toggle, window layout, the app
registry (localStorage); sys stats are read-only. To VIEW an edited doc, open it
in the real editor (see [/mso-image-editor] `view`). Raster ops (brush pixels,
masks, background removal) are browser-only by design — there is no headless
renderer.

`mso` needs `jq`. It logs in (POST `/api/auth/login`) with `OS_LOGIN_PASSWORD`
from `/home/rahman/projects/mso/.env.local` + an approved device id (default
`46e72…`), keeps the session cookie in a temp jar. Override base with `OS_BASE`.
If login 403s → device pending → `node ~/projects/mso/scripts/approve-device.js <id>`.

## mso endpoints (cookie-auth, what the OS calls)

All under `/api/v1`, gated by the signed session cookie (sent automatically).

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/fs/list?path=` | — | `{path,parent,roots,entries[]}`; READ = whole fs; hidden incl |
| GET | `/fs/read?path=` | — | raw utf8 string (≤5 MiB) |
| GET | `/fs/usage?path=` | — | `{used,total}` |
| POST | `/fs/write` | `{path,content}` | atomic; **home+~/projects only** |
| POST | `/fs/mkdir` | `{path}` | bounded |
| DELETE | `/fs/delete` | `{path}` | recursive; bounded |
| POST | `/fs/move` / `/fs/copy` | `{from,to}` | bounded |
| POST | `/exec/run` | `{cmd,cwd?}` | one-shot `/bin/bash`, 30s, 1 MiB out, cwd bounded |
| GET | `/sys/stats` / `/sys/processes` | — | telemetry / `ps` |
| GET | `/api/auth/me` | — | session check |

**Bounds env** (in `mso/.env.local`): `OS_FS_READ_ROOTS` (default `/` here →
browse anywhere), `OS_FS_WRITE_ROOTS` (default home+projects). Logic in
`mso/lib/host/`. Change → `sudo systemctl restart mso`.

## Real browser

Camoufox (anti-fingerprinting Firefox on a headless X display, streamed over
noVNC). See `/mso-camoufox`. The old `os-browser` Playwright sidecar and its
`browser.sh` driver were deleted 2026-08-10 — the unit had been stopped and
disabled for months and nothing in the app called it.

## The web OS (mso)

- Repo `/home/rahman/projects/mso` (`git@github.com:rahmanef63/mso.git`).
- Live `mso.rahmanef.com`. **Auth = password + device approval** (signed cookie, no
  Convex). New device → "pending" → approve in Settings → Devices, or CLI.
- **Settings → Server → Live** routes file/exec/sys through `/api/v1` (host ops are
  internal now). Mock is the default (demo with no host access).
- **AI Inspector** (⌘I): per-app props + scoped Alfa chat. Alfa needs a key —
  Settings → AI (BYOK, `~/.mso/config.json`) or `ANTHROPIC_API_KEY` env.
- Persistence is local: window layout + installed apps in localStorage; devices +
  config in `~/.mso/*.json`.

## Operate / deploy

- **Off Dokploy.** Prod = the local working dir served by systemd `mso.service`
  (`next start` :4005). Editing + rebuilding the repo IS deploying.
- **Deploy a change**: edit → `cd ~/projects/mso && pnpm typecheck && pnpm build`
  → `sudo systemctl restart mso` → verify. `git push` is version-control only.
- **Status**: `mso exec "systemctl is-active mso"`; site 200 check.
- Audit everything: `node ~/.claude/skills/mso-list/audit.js` (13 endpoints).

## Safety

- Restarting `mso` is fine (task target). Do NOT restart
  `vps-control-room-*` without warning the user — separate live product.
- `exec` is full shell as `rahman`. Confirm destructive commands (rm -rf, service
  changes) with the user first.
- Never echo `.env.local`, the session secret, the login password, or device store.

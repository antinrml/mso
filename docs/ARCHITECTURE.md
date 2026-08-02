# os-vps (Manef Shell OS) — Architecture

> ## ⚠ HISTORY, NOT CURRENT STATE
>
> This file was accurate on **2026-07-25** and has NOT been maintained since. Several
> passages are now false, and at least one was dangerous: it described a managed-app
> "single-origin mode" as a supported fallback after the code had removed it *because
> it was a privilege-escalation hole*. Known-wrong areas: the Browser app (a retired
> Playwright sidecar is described as live), workspace modes (reversed — Hermes and
> OpenClaw are ordinary apps), the upstream feature-discovery pipeline (deleted), the
> slice list, and the `/api/v1` route list.
>
> **For what exists today, read `PROGRESS.md` (newest entry at top) and the code.**
> This file is kept for the REASONING it records — why the origin split exists, why
> the CSP is shaped as it is — which remains valuable and is hard to recover.
>
> The earlier Convex + Control-Room-agent design (see `DESIGN-RECONCILE.md`, early
> `PROGRESS.md` phases) was removed: os-vps runs **as a host process** and talks to
> its own machine directly. No database, no external agent.

## What it is

A single Next.js 16 app that you run on a VPS as a normal (non-root) user. It
serves a desktop/iOS-style web UI and exposes a small host API (`/api/v1`) that
does fs / exec / sys work straight through Node `fs` + `child_process`, bounded
by realpath-checked roots. Auth is a signed-cookie session. Optional Playwright
service powers the Browser app. It also acts as the control plane for separate
applications already on the box (Hermes, OpenClaw) — managing them through their own
CLIs and HTTP surfaces, and framing each one's dashboard from an origin of its own.

```
phone / browser ──https──> os.rahmanef.com ─────────┐
                  signed-cookie auth (lib/auth)     │
                                                    ├─> os-vps (Next.js :4005) ──┬── lib/host → Node fs / child_process (host, non-root)
 the app iframe ──https──> hermes.os.rahmanef.com ──┤   ONE process, 3 origins    └── os-browser (Playwright :4002, loopback, optional)
 the app iframe ──https──> openclaw.os.rahmanef.com ┘
                             ▲ proxy.ts rewrites EVERY path on an app host into
                               /api/v1/managed-apps/<id>/proxy → loopback Hermes :9119 /
                               OpenClaw :18789. Nothing else is reachable there — the cockpit
                               API, /api/auth/* and its pages are not routes on those hosts
                               (and /_next/* is refused outright)
```

Traefik points all three hosts at the same `172.17.0.1:4005` with `passHostHeader:
true`; the Host header is what picks the branch. See **Managed applications** below
for why the dashboards need origins of their own.

## Layout (mirrors `resources/` so slices stay lift-ready)

```
os-vps/
├── app/                      Next 16 App Router
│   ├── layout.tsx            fonts + theme + providers
│   ├── globals.css           Tailwind 4 + glass theme tokens
│   ├── [[...slug]]/page.tsx  one catch-all route → os-root → <OsDesktop/> (auth-gated)
│   └── api/
│       ├── v1/               host Cloud API — fs · exec · sys · term · stock · browser ·
│       │                     managed-apps (state/actions/logs/features + dashboard proxy)
│       ├── health/           tiny liveness probe (200 OK) for uptime checks
│       ├── auth/             login · logout · me · devices
│       ├── config/           BYOK AI key (read/write ~/.os-vps/config.json)
│       └── assistant/        Claude SSE stream (BYOK)
├── components/ui/            shadcn (new-york) primitives — app-wide
├── components/shared/        cross-slice primitives (file-tree, …) via @/shared/*
├── lib/
│   ├── host/                 THE host facade — every /api/v1 route goes through here
│   │   ├── fs.ts             list/read/write/mkdir/move/copy/remove/usage/upload/search
│   │   ├── exec.ts           one-shot shell + destructive-command guard
│   │   ├── pty.ts            interactive PTY sessions (node-pty) behind /api/v1/term/*
│   │   ├── sys.ts            cpu/mem/disk/uptime/processes
│   │   ├── host-error.ts / api-error.ts  HostError + apiError + readJson/requireString kit
│   │   ├── paths.ts          read/write root jail + realpath bounds check
│   │   ├── audit.ts          append-only JSONL audit (~/.os-vps/audit.log) — writes serialized through a chained promise so bursty callers land in submission order
│   │   ├── rate-limit.ts     fixed-window in-memory limiter
│   │   └── index.ts          barrel
│   ├── auth/                 session.ts (HMAC sign/verify) · require-session.ts ·
│   │                         device-store.ts (~/.os-vps/auth-devices.json)
│   ├── config/               store.ts (~/.os-vps/config.json — BYOK key + model)
│   ├── managed-apps/         Hermes/OpenClaw control plane: catalog · manager · runner ·
│   │                         features + feature-parser · and the dashboard reverse proxy
│   │                         (origin · proxy-csp · proxy-headers · proxy-html)
│   ├── agent/                server.ts — server-only client for the os-browser service
│   ├── os-api/               the UI ↔ host boundary: types · MockAdapter · HttpAdapter
│   ├── ai/                   Claude stream helper
│   ├── appearance/           theme/accent/dir/wallpaper/server-mode store
│   └── demo.ts               IS_DEMO flag (NEXT_PUBLIC_OS_DEMO=1 → force mock)
├── frontend/slices/<slug>/   app slices (UI + types + config + metadata trio), plus:
│   ├── appshell/             generic shell framework — <AppShell manifest>, window
│   │                         runtime, desktop+mobile surfaces, registries, ResponsiveProvider,
│   │                         primitives (MasterDetail · AppFrame · WindowPreview · useResponsive ·
│   │                         useFocusedHotkey · useViewportWindow), pub/sub buses.
│   │                         Brand/feature-agnostic → lifts to rr.
│   ├── shell-search / shell-inspector / shell-notifications / shell-control-center /
│   │                         shell-widgets   pluggable features mounted via <Slot region>
│   ├── managed-apps/         Hermes/OpenClaw surfaces: the manage window, per-feature
│   │                         windows (iframe + CLI fallback), icons, workspace app lists
│   └── os-shell/             os-vps consumer: shell.manifest.ts (brand+apps+features)
│                             + re-export barrel (@/features/os-shell)
├── os-browser/               Playwright Chromium service (gitignored, deploy-local)
├── public/demo-media/        real sample media so the mock demo can open files
├── scripts/                  approve-device.js · gen-demo-media.mjs · …
└── docs/  proxy.ts  next.config.mjs  tsconfig.json ...
```

Path aliases (tsconfig): `@/*` → root, `@/features/*` → `frontend/slices/*`,
`@/shared/*` → `components/shared` + `lib/shared`. Same shape as `resources/` so
a slice lifts by copy, no rewrite.

## Runtime — one tier

There is no backend tier. The browser hits same-origin route handlers; the
handlers call `lib/host`; `lib/host` touches the kernel. That's it.

```
browser
  │  React 19 + os-shell window manager (module store, drag/resize 100% client)
  ▼
/api/v1/*   Next route handlers (server)         every route: verifyAuth() first
  │  fs · exec · sys · term · stock · browser
  ▼
lib/host    fs / child_process, root-jailed, realpath-checked, audited, rate-limited
  ▼
host kernel (as the unprivileged service user — NOT root)
```

- **Hot path is client-only.** Window drag/resize never re-renders the desktop:
  state lives in a module-level store read via `useSyncExternalStore`; only the
  dragged window subscribes to its own rect.
- **Persistence is local.** Window layout + installed-app registry → `localStorage`
  (the demo also persists its mock FS to `localStorage`, key `os-vps:demo-fs`).
  Device allowlist → `~/.os-vps/auth-devices.json`; BYOK key/model →
  `~/.os-vps/config.json`; audit trail → `~/.os-vps/audit.log`.
- **Apps lazy-mount.** A window mounts its app component only when opened.
- **Shared shell primitives.** `MasterDetail` + `AppFrame` + `useResponsive`
  back the responsive layout of system-monitor / assistant / os-settings (more
  apps to follow). `<WindowPreview>` powers the mobile app switcher without
  re-mounting the live app (kills the terminal double-PTY bug).
  `useFocusedHotkey()` scopes keystrokes to the focused window so background
  apps don't steal shortcuts.

## The host boundary — `lib/host` + `lib/os-api`

`lib/os-api` is the UI-facing contract (os-rr Cloud API shape): one `OsApi`
interface, two adapters —

- **MockAdapter** — in-browser simulation. Default + forced when `IS_DEMO`. The
  whole OS is demoable with zero host.
- **HttpAdapter** — `fetch` to same-origin `/api/v1`, used in **Live** mode
  (Settings → Server). Sends the session cookie; no token in JS.

Server side, **every `/api/v1` route calls `verifyAuth()` then goes through
`lib/host`** — routes never call `fs`/`child_process` directly. `lib/host`
enforces:

- **FS jail** — `OS_FS_READ_ROOTS` / `OS_FS_WRITE_ROOTS` (default: home + `~/projects`).
  Symlinks are realpath-resolved **before** the bounds check; a root dir itself
  refuses writes. READ may be widened to `/` (read-only browse) without widening WRITE.
- **Exec guard** — `destructiveReason()` refuses catastrophic commands
  (`rm -rf /`, `mkfs`, `dd of=/dev/…`, fork bomb, `chmod/chown -R /`) unless
  `OS_EXEC_ALLOW_DESTRUCTIVE=1`. Exec itself stays one-shot — the interactive
  shell is the PTY (below).
- **Rate limit** — exec is fixed-window limited per device.
- **Audit** — exec/fs-mutation/term/browser/auth actions append to the JSONL log.

### Terminal PTY — `/api/v1/term/*`

Live Terminal sessions are real PTYs (`node-pty`), managed by `lib/host/pty.ts`:
spawn the owner's login shell, stream output as SSE (`/api/v1/term/stream`,
ring-buffered so a `Last-Event-ID` reconnect resumes exactly where it dropped),
plus `open`/`input`/`resize`/`close` routes. 8 concurrent sessions max, 30-min
idle reap; `term.open`/`term.close` are audited (keystrokes are not — high
volume, and the owner has a full shell by design). The exec destructive filter
does **not** apply here, by design: a pty carries raw keystrokes with no command
boundary to inspect, and an interactive shell composes commands from fragments
anyway — the gate is the same signed session + approved device as every route.
Mock mode never touches it; if the PTY fails the Terminal app falls back to
one-shot exec.

### Stock search — `/api/v1/stock/search`

A thin server-side proxy for the image picker's Stock tab: keyless **Openverse**
by default, **Unsplash** when `OS_UNSPLASH_ACCESS_KEY` is set. The key never
reaches the client.

### API error contract

Every `/api/v1` route returns errors as `{ error: string }` via `apiError()`
(`lib/host/api-error.ts`): curated `HostError` messages pass through as 400
(they're client-safe UX); everything else is masked to "Operation failed" and
logged server-side with the route name, so raw Node errors (ENOENT/EACCES with
absolute paths) never leak. Inputs are validated by a dependency-free
`readJson`/`requireString`/`requireInt` kit — no zod.

## Auth (`lib/auth`)

Signed-cookie sessions — no Convex, no Clerk.

- **Factor 1**: `OS_LOGIN_PASSWORD` (weak/memorable), checked constant-time.
- **Factor 2**: the device must be in the approved allowlist
  (`~/.os-vps/auth-devices.json`). A correct password on a new device registers
  it `pending`; **no session is issued until approved**
  (`node scripts/approve-device.js <deviceId> "name"`).
- On success: an HMAC-SHA256 cookie signed with `OS_SESSION_SECRET` (≥32 bytes),
  `httpOnly` + `Secure` + `SameSite=strict`, default 24h.
- `requireSession()` verifies signature + expiry only (device approval is a
  login-time gate, not re-checked per request). `getSessionActor()` → `device_id`
  for the audit trail.

## Managed applications — Hermes and OpenClaw (`lib/managed-apps`)

MSO is the shell / control plane. Hermes and OpenClaw stay **separate applications**:
their own runtime, config, data, versions, health, logs and backups. MSO does not copy,
fork or merge their source, does not scrape their DOM, and writes nothing under
`~/.hermes/` or `~/.openclaw/` — reading those trees is how discovery works, but the
only writes are into `~/.os-vps/`. Everything else goes through the app's own CLI, its
own HTTP surface, or systemd/docker. Full operator guide: `docs/MANAGED-APPS.md`.

- **catalog** (`lib/managed-apps/catalog.ts:13`) — one definition per app: `command`,
  candidate `serviceNames`, candidate `containerNames`, the **loopback** dashboard URL,
  the state dir name, and env overrides for a non-default install (`HERMES_HOME`,
  `HERMES_WEB_DIST`, `OPENCLAW_CONTROL_UI_DIST`, `*_DASHBOARD_URL`).
- **manager** (`lib/managed-apps/manager.ts`) — detect → state → health → version →
  actions → backup → logs. Detection asks `systemctl [--user] show -p LoadState -p ActiveState`
  per candidate unit, then `docker ps -a`, then `which <command>`; the detected type decides which
  actions exist at all (systemd/docker → start·stop·restart·backup, a bare package →
  backup only). `show` rather than `is-active` because `is-active` prints `inactive` for a unit
  that does not exist, so a phantom name would win detection forever (that was a live defect:
  OpenClaw read `stopped` while serving). Health is `GET <dashboardUrl>/health`; version is the
  first line of `<command> --version`. One in-flight action per app (`manager.ts:186`), so a
  double-click cannot interleave a stop with a restart. Live now: both apps `systemd` / `running`
  / `healthy: true` through `listManagedApps()`.
- **backup** (`manager.ts:141`) copies the app's state dir (`HERMES_HOME` honoured) to
  `~/.os-vps/backups/<id>/<timestamp>/` (per-app dir 0700, `manifest.json` 0600), skipping
  `node_modules`/`.venv`/`venv`/`__pycache__`/`.git`/`.cache`/`backups` and **skipping symlinks**
  rather than following or recreating them — following one copies bytes from outside the app,
  recreating an absolute one aims a future restore outside the tree; the manifest records both
  counts. It is a read of their state, never a write to it. 366 MB and 237 MB on this host, from
  2.7 GB and 1.7 GB. There is still no restore code (`docs/MANAGED-APPS.md` §6).
- **logs** (`manager.ts:196`) — `journalctl -n 100` (user unit first, then system) or
  `docker logs --tail 100`, then redaction (`manager.ts:18`): bearer tokens and
  `api_key|token|secret|password|authorization` assignments are replaced, each line
  clipped to 8 KB. Another app's log lines are untrusted input, so nothing is echoed raw.
- **runner** (`lib/managed-apps/runner.ts:12`) — `execFile` with `shell: false` and an
  argv array, always: no string is ever handed to a shell, output is capped at 128 KB,
  every call carries a timeout. This is why an app id or unit name cannot become a
  command, and why `lib/host`'s destructive-command guard is not needed here.
- **features** (`lib/managed-apps/features.ts`) — each app's navigation is **discovered
  from that app's own installed bundle and plugin API**, never hard-coded. Hermes: the
  `{path,label}` nav table inside its built SPA (falling back to its route record, then to
  `web/src/App.tsx` for a git install) spliced with `/api/dashboard/plugins` the way
  upstream's own `buildNavItems()` does.
  OpenClaw: its `app-route-paths-*.js` chunk over HTTP, with the copy on disk as fallback.
  Routes the upstream only serves behind a flag or a plugin panel are marked unavailable
  rather than shipped as dead tiles; the live counts per app are in
  `docs/MANAGED-APPS.md` §4, since they move with every upstream release. Results cache 60 s; a parse
  shorter than the guard (`feature-parser.ts:16`) is discarded, so an unreachable or
  restructured upstream yields **nothing** rather than routes that 404.

| Route | Method | Notes |
|---|---|---|
| `/api/v1/managed-apps` | GET | every app's view (state, health, version, actions) |
| `/api/v1/managed-apps/[id]` | GET · POST | POST = `start`·`stop`·`restart`·`backup` |
| `/api/v1/managed-apps/[id]/logs` | GET | last 100 lines, redacted |
| `/api/v1/managed-apps/[id]/features` | GET | discovered navigation |

Every one of them calls `verifyAuth()` first. The action POST additionally: refuses in
demo mode, rate-limits to 12/min per app, and audits both outcomes as
`managed-app.action`.

**Workspace modes — REMOVED in `a2c3882`; this describes the old design.** They
(`frontend/slices/os-shell/workspace-mode.ts`, deleted) decided *which* app's
features populate the dock/launchpad: `plain | hermes | openclaw`, stored in
`localStorage` under `os-vps:workspace-mode` and read through `useSyncExternalStore`.
This is orthogonal to Shell Style (macos/windows/dashboard/ios/android) — a workspace is
which apps exist, a shell is what they look like. Switching writes one key and fires one
event: nothing restarts, no service is touched. Each discovered feature becomes an
ordinary `AppDescriptor` (`frontend/slices/managed-apps/dynamic-features.tsx:25`), so
windowing, URL slugs, Spotlight and the dock pick it up with no surface edits.

### The dashboard proxy and the origin split

Each app's own dashboard is reverse-proxied and rendered in an OS window as an iframe.
The upstream target must be loopback or the route refuses it
(`app/api/v1/managed-apps/[id]/proxy/[[...path]]/route.ts:114`) — the proxy is not a
general-purpose fetcher. Cookies are namespaced (`mapp_<id>_`) and pinned to that app's
mount, the os-vps `session` cookie is never forwarded upstream, `authorization` is never
forwarded and `www-authenticate` never returned (together they would make the proxy a
credential relay), off-origin redirects are refused rather than passed on (they are an
open redirect **and** a CSP path-matching bypass), and an upstream service worker is
never handed to the browser (`lib/managed-apps/proxy-headers.ts`). The emitted CSP is
ours, but it is **intersected** with the upstream's own per directive
(`lib/managed-apps/proxy-csp.ts:182`): a
source survives only if both policies allow it, upstream script hashes are carried over
(never nonces), and the external hosts an upstream declares for itself are honoured —
so OpenClaw's sha256-pinned inline scripts and its narrow `connect-src` survive while
its `frame-ancestors 'none'` does not.

**The trust boundary is the browser realm, and it is drawn by giving each app its own
origin.** The iframe needs `allow-same-origin` or these SPAs do not boot at all. On the
cockpit origin that made upstream JS same-origin *with the cockpit*: it could take
`window.top.fetch` and call `/api/v1/exec/run` with the user's session. No CSP closes
that — a policy binds a realm, not a reference across realms. So each dashboard is
served from its **own host on this same process**: `hermes.os.rahmanef.com`,
`openclaw.os.rahmanef.com`. `window.top` is then cross-origin and opaque (measured in
Chromium 148; the properties and the same-origin control are listed in
`docs/MANAGED-APPS.md` §5). One host **per app**, not one shared host:
a shared one puts Hermes and OpenClaw back in a single origin where they can script each
other.

Two halves make that real:

| Half | Where | What it does |
|---|---|---|
| Host rewrite | `proxy.ts:123` | on an app host, EVERY path is rewritten into that app's proxy and stamped with `x-os-managed-app-host`; `/_next/*` 404s. The cockpit API does not exist on those origins. |
| Namespace gate | `proxy.ts:121` + `lib/managed-apps/origin.ts:71` | a host inside the app namespace that is not an app (`staging.os.…`, a `*.os` wildcard) 404s. The parent — the cockpit — is never matched, so this cannot lock the operator out. |

Supporting details that are load-bearing rather than incidental: the `Host` header is
authoritative and `x-forwarded-host` is deliberately ignored for this decision
(`proxy.ts:112`); the CSRF check runs **before** the rewrite, or it would stop applying
once the path became `/api/…`; the proxy route only accepts root-mounted mode when
middleware stamped the header, and middleware deletes any inbound copy, so the mode
cannot be claimed from the cockpit origin (`route.ts:92`); `frame-ancestors` names the
cockpit from deployment env only (`lib/managed-apps/origin.ts:101`) — a missing value
emits `'none'`, so a
misconfiguration refuses the frame visibly instead of inviting an unknown framer. Because
the app is root-mounted on its own host, the proxy no longer rewrites the document at
all: no `<base href>`, no URL rebasing, no fetch shim, nothing to pin.

The session cookie gained an optional `Domain` (`lib/auth/session-cookie.ts:68`) so it
reaches those hosts. `SameSite=Strict` is unchanged and still correct: SameSite is
evaluated per **site** (scheme + registrable domain), and the app hosts share
`rahmanef.com` with the cockpit — cross-origin is not cross-site. Logout clears the
cookie with *and* without the Domain (`session-cookie.ts:108`), because those are
distinct jar entries.

**What the split does not do.** It is a browser-realm boundary, nothing more. A plugin
installed into Hermes runs inside the Hermes daemon with Hermes' privileges — and Hermes
executes shell commands on this VPS. Installing an untrusted plugin or extension into
either app is handing that daemon arbitrary code execution on the host, as the service
user, whatever the browser thinks about origins. The split also cannot stop an upstream
from broadening its **own** `connect-src` to a third-party https host it declares (it can
never name the cockpit — `lib/managed-apps/proxy-csp.ts:174` refuses that specifically).

**Single-origin mode is GONE, and this paragraph used to recommend it.** ~~The
dashboards are proxied under `/api/v1/managed-apps/<id>/proxy` on the cockpit's own
origin; that is the dev, demo and rollback path.~~ Removed in `38d010d` ("serve
dashboards from an app host or not at all"). It cannot be made safe: a CSP binds a
realm, not a reference across realms, so upstream JS reaches
`window.top.fetch('/api/v1/exec')` from a frame and a whole cockpit realm from
`window.open('/')`. The route now hard-404s it
(`app/api/v1/managed-apps/[id]/proxy/[[...path]]/route.ts`: "managed application
dashboards are not served on this origin"). A deployment with no app host simply does
not show upstream dashboards — the windows fall back to the CLI view. **Do not
"restore" this as a convenience.**

**Known gaps.** Backup runs but has no counterpart: there is no restore code, so a rollback is
a manual `cp -a` of a snapshot, and the manifest carries no inventory or checksum to check one
against. No update center yet (check-update, channels, update, rollback, uninstall, install
wizard). The docker and `package` detection branches have no test and no install here to
exercise them. OpenClaw's control UI is WebSocket-driven and this proxy is
fetch-based — a Next route handler cannot service an `Upgrade` — so its panels stay empty
and those features open on a CLI view instead, with the reason stated in the window
(`frontend/slices/managed-apps/feature-cli.ts:41`). No notifications, no resource-aware
behaviour, no start-on-boot. The workspace switcher is reachable from right-click on every
shell and from the Dashboard sidebar, but is not yet a visible control in the macOS /
Windows / iOS / Android chrome. No integration or journey tests — the coverage is unit
tests around the parsers, detection and backup behaviour (`lib/managed-apps/manager.test.ts`),
the policy intersection, the header rules and the host gating.

## Browser app (`os-browser`, optional)

A separate Playwright Chromium service (`os-browser/`, systemd, **loopback**
:4002, gitignored). `lib/agent/server.ts` proxies the `/api/v1/browser/*` routes
to it (secret-gated, server-only). Renders any site, drivable from the UI, with
a persistent profile (`~/.os-vps/chrome-profile`) so logins stick. Leave
`OS_BROWSER_URL`/`OS_BROWSER_SECRET` unset to disable the app — everything else
still works.

## Deployment

- **prod** — `os-vps.service` :4005 (systemd, `User=rahman`, WorkingDir
  `/home/rahman/projects/os-vps`).
- **demo** — `os-vps-demo.service` :4006 (`NEXT_PUBLIC_OS_DEMO=1`, separate
  WorkingDir `/home/rahman/projects/os-vps-demo`, mock-only, no host access).
- **os-browser** — `os-browser.service` :4002 (loopback).
- **managed-app origins** — `hermes.os.rahmanef.com` and `openclaw.os.rahmanef.com`, each
  its own DNS record and TLS cert, both routed to the same `172.17.0.1:4005` by
  `/etc/dokploy/traefik/dynamic/os-vps-managed-apps.yml` (`passHostHeader: true`, so the
  process sees the public name). Adding an app to the catalog means adding a router there and a
  DNS record **in the same change**: the host template applies to every catalog id, so a new
  app's iframe points at `<newid>.os.…` the moment it exists, and with no record for that name
  the window just fails to load — there is no per-app fallback to the single-origin URL.

Ship: commit to `main`, push (pre-push hook runs typecheck + lint CI), then
restart prod + sync/rebuild demo manually.

`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` + `OS_SESSION_COOKIE_DOMAIN` are **one decision
in two variables** — set both or neither (`.env.example` spells out why (2) without (1)
hands the session to every host under the domain). `NEXT_PUBLIC_*` is inlined into the
client bundle, so set them **before `pnpm build`**, not just before the restart: built
without the template, the browser still points the iframe at the old same-origin proxy
URL that the server has already stopped answering, and the app window comes up blank.
`OS_PUBLIC_ORIGIN` is a third, optional variable behind the same decision: it names the
cockpit origin the app hosts allow as their framer and the origin their policy is scoped
to. Unset, it falls back to the template's parent name — correct for
`{id}.os.<domain>`, and worth setting explicitly for anything else.

`package.json` carries a `pnpm.overrides` pin for `postcss` to keep the build
deterministic across transitive resolutions — bump it deliberately, never via
auto-update.

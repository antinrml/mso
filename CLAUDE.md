# mso (product name: **MSO**)

Mobile-first web cockpit for a headless VPS, from any browser. Desktop-style UI
metaphor over a vertical-slice stack; value is utility (terminal/files/monitor/
browser), not an OS. Repo/service/domain keep the `mso` slug; "MSO" is the
UI brand. **Self-contained**: a single Next.js app, no database, no external
agent — it runs AS a host process and controls its own machine.

- Stack: Next 16 (App Router) · React 19 · Tailwind 4 · shadcn/ui · TypeScript.
  **No `middleware.ts` — `proxy.ts`** (Next 16 rename).
- Auth: password + device approval → HMAC signed-cookie session (`lib/auth/`).
  No Convex, no Clerk.
- Host access: `lib/host/` does fs/exec/sys directly (Node `fs` + `child_process`),
  bounded by `OS_FS_READ_ROOTS` / `OS_FS_WRITE_ROOTS`.
- Layout: `app/` + `frontend/slices/<slug>/`; barrel-only cross-slice imports
  (`@/features/<slug>`).

## Read first
- `docs/PROGRESS.md` — **THE source of truth for what exists.** Newest entry at top;
  read the top few and you know the current state. Everything else in `docs/` is
  history or a plan, and history goes stale.
- `README.md` — what it is, features, security model, quickstart.
- `.env.example` — most env vars. NOT all: it is missing several that only appear in
  `.env.local` and in code, so grep `process.env` before assuming one does not exist.
- **The code wins over any doc.** `docs/ARCHITECTURE.md` is HISTORY, not current — it
  still describes a retired Playwright browser sidecar, a managed-app "single-origin
  mode" that was removed for security, and workspace modes that were reversed. It is
  kept for the reasoning it records, not as a description of today.
- `frontend/slices/assistant/CONTRACT.md` — current, and authoritative for what an
  Agent / Tool / Skill / Playbook is and what reaches the model.

**The doc set, and the one rule.** `docs/PROGRESS.md` is the SSOT; everything else is
history, a live plan, or reference. Append to PROGRESS when you ship — do not start a
second log. (`docs/CHANGELOG.md` was exactly that and was merged back in; the root
`progress.md` is gitignored local scratch and claims authority it does not have.)
Deleted 2026-07-28 as dead: `SHELL-INTEGRATION-PLAN.md` and `SYNC-PLAN.md` (both target
sibling repos that do not exist on this machine), `browser-agent-plan.md` (the retired
Playwright sidecar), `SIXFIX-PLAN.md` (a finished dated fix list). Nothing linked to any
of them. Deleted 2026-07-30 in the same spirit: `PLAN.md` (the "master plan" — every
section contradicted by shipped code, and its one unique asset, a Control-Room-vs-MSO
table, is descriptive rather than decision-carrying) and `MULTISHELL-PLAN.md` (its sibling
repo is gone, all six phases are checked off, and PROGRESS.md:574 reverses its one unique
decision). Both recoverable with `git show bccd0b1:docs/<name>`.

## Architecture
```
browser ──https──> mso (Next.js :4005) ──── lib/host → Node fs/child_process (host)
              signed-cookie auth (lib/auth)
```
The Browser app is **Camoufox** — a real anti-fingerprinting Firefox on a headless
X display on this host, streamed in over noVNC through `/camoufox-vnc/*` (gated in
`proxy.ts` by the same verified-session check that guards `/api/v1/exec`). It
replaced BOTH the old Playwright sidecar (`os-browser`, :4002, retired) and the
sandboxed-iframe browser that briefly followed it — an iframe cannot render most of
the web, because X-Frame-Options refuses framing on the majority of real sites.
`os-browser/` stays in-repo only as dev tooling (scripts/e2e use its Playwright
install). See the Browser/camoufox note further down for the systemd user unit.
- `/api/v1/*` = the host API (fs/exec/sys/term/apps/camoufox/managed-apps), every
  route `verifyAuth` (session cookie) first. There is no `/api/v1/browser`.
  Client picks mock (default) vs live in Settings → Server.
- `/api/auth/*` = login/logout/me/devices. `/api/config` = BYOK AI key.
- Persistence is local: window layout + app registry in localStorage; device
  allowlist + config in `~/.mso/*.json`.

## AppShell framework (the shell is generic + rr-liftable)
The shell is NOT one slice. It is split so the whole desktop+mobile shell can lift
to `resources/` (rr) and drive any project from one manifest:
- `frontend/slices/appshell/` — the **generic, brand-free** framework: window runtime
  + desktop/mobile surfaces, app/feature/brand registries, `<Slot region>`,
  `ResponsiveProvider`/`useResponsive` + the 4 DRY primitives, the pub/sub buses
  (toast/activity/inspector), and `<AppShell manifest>` (the one entry point). It
  imports NO brand/feature and NO mso `@/lib/*` — only the universal `@/lib/utils`
  (`cn`). Everything project-specific arrives via `manifest.capabilities`.
- `appshell/features/{search,inspector,notifications,control-center,widgets,quick-look,
  clipboard,share,shortcut-help,lock-screen}` — each shell **feature** lives NESTED inside
  the appshell slice (converged to the rr-canonical shape; they were flat top-level
  `shell-*` slices before). Each mounts into a named `<Slot>` via `defineFeature({ id,
  slots, provider? })` and is consumer-free (data via capabilities, not `@/lib`).
  `appshell/defaults.ts` bundles all 10 as `DEFAULT_FEATURES` (one-line install:
  `features: DEFAULT_FEATURES`); the barrel re-exports it LAST so the `defineFeature`
  ES-cycle resolves. Buses live in core so apps fire them without depending on a feature
  slice. (`shell-settings` stays a flat UI-primitives slice — not a feature unit.)
- `os-shell` — the thin mso **consumer**: `shell.manifest.ts` (MSO brand + app
  list + slugs + features) + `capabilities.ts` (adapts `@/lib/appearance`+`os-api`+
  `ai/stream` to `ShellCapabilities`) + a re-export barrel (`@/features/os-shell`
  re-exports appshell verbatim, so all app slices stay unedited).
- **Windowing** (`appshell/lib/store.ts`): `openWindow(app,title,size,payload,{multi})`.
  Default = single instance per app (reuse/focus); `AppDescriptor.multi` (e.g. Files)
  spawns a fresh window each open. `focusApp(id)` reveals the front-most existing
  window without spawning — used by `UrlSync` so deep-links/back-forward don't
  duplicate a multi app. **Window coords (`win.x/y`) are relative to the desktop
  `<section top-[30px]>`, NOT the viewport** — snap/maximize geometry must use
  `workArea()` (section-relative: `top=GAP`, `bottom=vh-TOPBAR-DOCK_RESERVE`), the
  drag snap preview must be `position:absolute` (shares the surface), and drag
  commits must use `offsetLeft/offsetTop`, never viewport `getBoundingClientRect`.
- **`window-content.tsx` loads app bundles with `useState`/`useEffect`, NOT
  `React.lazy`+`Suspense`.** Window opens come from the synchronous external store
  (`useSyncExternalStore`); a Suspense boundary suspending in that path misses its
  retry ping — the chunk resolves but the spinner only clears on the next render
  (a click). A `setState` on import-resolve always re-renders. Don't reintroduce
  Suspense here. Dock hover warms the chunk (`app.load()`), so it stays instant.
- **Dock = macOS behaviour**: clicking a running app focuses its front window
  (`focusApp`, never spawns); hovering shows its open windows to switch + a "New
  Window" entry for `multi` apps. Opening surfaces (Launchpad/Spotlight) spawn.
- **`ShellCapabilities`** is the injection seam: `useAppearance`, `useCpuPercent`,
  `useSearch`→`SearchHit[]`, `useSystemStats`, `useChat`, `useServerToggle`. Defaults
  merged in `CapabilitiesProvider` so optional caps degrade (accessors stay
  unconditional). Add an app = manifest edit; add a shell feature = new
  `appshell/features/<feat>/` + `defineFeature` + add to `DEFAULT_FEATURES`. No surface
  edits (open/closed).

## Routing — the OS is addressable (keep windowing!)
- ONE catch-all route `app/[[...slug]]/page.tsx` (no per-app pages). Windowing is
  untouched; only the **focused** app + its launch path is mirrored to the URL
  (`/files/home/rahman`, `/code`). `appshell` `UrlSync` does it.
- **URL writes use the History API, NOT `router.push`.** Opening a window is pure
  client state — `router.push` triggers a full RSC transition + remount (slow, flashy
  + breaks the sync). Use `window.history.push/replaceState`; Next 16 syncs
  `usePathname`. Deep links / ⌘-middle-click `<Link>` / back-forward still navigate.
- App URL slugs are assigned centrally in `shell.manifest.ts` (`AppDescriptor.slug`,
  falls back to `id`); app slices stay URL-agnostic. Dock + Launchpad use `<Link href>`
  with **`prefetch={false}`** — MANDATORY: left-click is intercepted (never navigates),
  so default prefetch would fire one RSC render of the dynamic catch-all per link
  (24 on load) and peg the VPS. The href is only for middle/⌘-click. Never drop it.
- The catch-all **must `notFound()` reserved paths** (`slug[0]==="_next"`): otherwise a
  missing `/_next/static/*` chunk falls through and returns the app HTML with 200 →
  wrong-MIME refusal, no recovery. 404 lets the client router hard-reload onto the new build.
- `next/Image` ONLY where the optimizer helps (browser favicons via the fixed Google s2
  host in `next.config` `images.remotePatterns`). Host-fs images + the live Playwright
  screenshot stream stay raw `<img>` on purpose (dynamic/auth'd bytes).

## Deploy / ops (prod :4005 + demo :4006 are systemd, not Dokploy)
- `mso.service` (:4005, WorkingDir `/home/rahman/projects/mso`) serves
  mso.rahmanef.com via `next start`. Demo `mso-demo.service` (:4006, WorkingDir
  `/home/rahman/projects/mso-demo`, `NEXT_PUBLIC_OS_DEMO=1` → no auth, mock data).
- **Deploy prod:** `pnpm build` **THEN** `sudo systemctl restart mso.service`. ALWAYS
  build-then-restart, never the reverse, and never rebuild again after restarting
  without restarting once more — `next start` loads the build manifest at boot, so if
  the on-disk `.next/static` chunks don't match the running process's HTML refs, every
  CSS/JS chunk 404s → unstyled/broken UI. On any chunk mismatch: `rm -rf .next && pnpm
  build && restart` (clean rebuild). Verify with
  `curl -sI :4005/_next/static/chunks/<the-css-the-HTML-refs> | grep content-type` → must be `text/css`.
- **Service worker** is served from `app/api/sw/route.ts` with a **`beforeFiles`
  rewrite `/sw.js`→`/api/sw`** (in `next.config`): a literal `app/sw.js/route.ts`
  gets shadowed by the optional catch-all, and routes under `/api` are never caught.
  The SW bakes `BUILD_ID` into its cache name so its bytes change every deploy →
  the browser detects a new SW → the "Versi baru" reload toast fires (a static
  `public/sw.js` is byte-identical across deploys, so the toast never fired). It
  caches ONLY icons+manifest, never chunks/HTML.
- **New routes need a clean build.** Adding a new `app/**/route.ts` or page folder
  may not register under incremental Turbopack — `rm -rf .next && pnpm build`.
- **`git add` aborts on a bad pathspec** and stages NOTHING new — after a
  `git rm`, don't re-list the removed file in `git add`; prefer `git add -A` and
  check `git status --short` before committing (a broken commit shipped once this way).
- **Deploy demo:** from `/home/rahman/projects/mso-demo`: `git fetch origin -q &&
  git reset --hard origin/main -q && pnpm build && sudo systemctl restart
  mso-demo.service`. Mind the cwd — running the sync from the prod dir is a classic slip.
- **The Browser app powers a systemd USER unit**, `camoufox-vnc.service` in
  `~/.config/systemd/user/`, whose `ExecStart` points at **`scripts/camoufox-vnc-service`
  in THIS repo** (it used to live untracked under `~/.openclaw/workspace/`, so a fresh
  clone could not start the Browser at all and the `-nopw` → `-rfbauth` hardening had no
  version control). The script refuses to start without a VNC password file. Two further
  host-side facts the repo cannot carry, and the feature dies quietly without either: (1) `loginctl enable-linger rahman`, or the unit stops at
  logout and never starts at boot; (2) the drop-in
  `/etc/systemd/system/mso.service.d/user-bus.conf` setting
  `Environment=XDG_RUNTIME_DIR=/run/user/1001` — a system unit running as `User=rahman`
  gets NO user-bus address, so without it every `systemctl --user` call fails with
  "Failed to connect to bus: No medium found". `lib/camoufox/service.ts` reports that
  as an error rather than as "not installed", so the panel tells you which one it is.
  (3) The unit is deliberately left **`disabled`** with `Restart=no` + `RuntimeMaxSec=2h`:
  the UI toggle is plain `start`/`stop` and must NEVER go back to `enable --now`, or every
  click re-arms boot autostart — that is how it once ran 26 h with zero viewers. Ship
  `Restart=no` and the lease together; a lease under `Restart=always` is a 2-hourly reboot
  loop. (4) `CAMOUFOX_PROFILE` points at `~/.local/share/camoufox/profiles/linkedin`, NOT
  `~/.cache` — it holds the live logins, and a wrong path makes `mkdir -p` create an empty
  profile with no error. This unit has no copy or installer in the repo, so (1)–(4) exist
  nowhere else. (5) That profile holds a **live Google session** (`SID`,
  `__Secure-1PSID`, `SAPISID`) as well as LinkedIn's `li_at` — cookie theft there is
  account takeover with no password and no 2FA prompt. So: the profile dir is `chmod 700`
  on every start (Firefox writes `cookies.sqlite` 0644 by default), the VNC password goes
  in the viewer URL's **fragment** and never its query string, and every start snapshots
  `cookies.sqlite*` + `key4.db` + `cert9.db` into `~/.local/state/camoufox/session-backup/`
  (3 generations, 0700). Restore after an accidental wipe: stop the unit,
  `cp -p ~/.local/state/camoufox/session-backup/1/* <profile>/`, start. Roll back to `2`
  or `3` if generation `1` already captured the logged-out state.
- Verify shell behaviour on the demo (no auth): desktop via os-browser at 1280, mobile
  via Playwright (`os-browser/node_modules/playwright`, CommonJS) at 390. Drive Spotlight
  with Meta+k; click the dock by the BOTTOM-most `a[href="/<slug>"]` (the centre ones are
  the hidden Launchpad). `X-Content-Type-Options: nosniff` is set on all routes, so wrong
  MIME is fatal — keep static Content-Types correct.

## Rules in force
- **Only ONE session edits mso at a time.** One checkout, one `HEAD`, one index.
  Two concurrent fix-loops collided three times on 2026-06-15: a `git reset --hard`
  wiped uncommitted work twice, and a shared-index sweep bundled one session's files
  into the other's commit. Before a long loop, `git log --oneline -10` — unexpected
  recent commits mean another session is live, so stop and run solo. (It happened
  again on 2026-07-28: `779f2ba` landed mid-session from elsewhere. Staging explicit
  paths instead of `git add -A` is what kept the commits clean.)
- Max 200 lines/file, single responsibility, shadcn primitives only, theme tokens
  not hex, mobile-first. Barrel-only cross-slice imports.
- `/api/v1` host ops go through `lib/host` (bounds + realpath checks) — never call
  `fs`/`child_process` straight from a route.
- Solo-dev: push direct to `main` once `pnpm typecheck` + `pnpm build` are green.
  Conventional commits + Claude co-author.

## CLI (`bin/mso`) — the web UI is only one frontend
`bin/mso` reaches the same `/api` surface from a shell; `scripts/install.sh` symlinks
it to `~/.local/bin/mso` and symlinks `claude-skills/*` into `~/.claude/skills/`
(`/mso`, `/mso-camoufox`, `/mso-apps`, `/mso-list`, `/mso-image-editor`,
`/mso-browser-list`). `mso -h` lists every verb; `mso api <METHOD> <path> [json]` is
the escape hatch for anything without a named verb.
- **Every CLI caller must send `Origin: <base>`.** `proxy.ts` blocks mutating `/api`
  that cannot prove same-origin; a browser proves it with `Sec-Fetch-Site`, and the
  documented fallback is an `Origin` whose host matches `Host`. Without it login
  itself 403s `cross_origin_blocked` — before any device check, so the error looks
  like an approval problem and is not.
- One shared CLI device id lives in `~/.mso/cli.device.id` (auto-created, approve
  once with `mso approve $(cat ~/.mso/cli.device.id)`). `audit.js` and
  `image-editor.sh` read the same file — do not reintroduce per-script hardcoded ids.
- Local verbs (`-h`, `approve`, `devices`, `service`, `build`) never log in, so they
  still work while the service is down.

## Local dev
```bash
pnpm install
cp .env.example .env.local   # set OS_LOGIN_PASSWORD + OS_SESSION_SECRET
pnpm typecheck
pnpm dev                     # OS desktop at :3000 (mock data by default)
node scripts/approve-device.js <deviceId> "my device"   # approve a login device
```

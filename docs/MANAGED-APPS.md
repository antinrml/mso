# Managed applications — Hermes and OpenClaw

> **Mostly current, with one reversal.** Workspace modes and the upstream
> feature-discovery pipeline were REMOVED in `a2c3882` — Hermes and OpenClaw are
> ordinary app windows now. Sections describing per-feature windows, the SPA-bundle
> parsers or `workspace-mode.ts` are history. Everything about the origin split, the
> proxy, the update centre and the approval model is still accurate.
>
> Originally shipped `c411187` (registry) → `52cfff5` (workspace modes) → `0feaab4` (discovery) →
> `5b4b5c9` (routes/icons) → `c597d08` (proxy hardening) → `d880f68` (origin split). Re-checked
> against the code and the live host 2026-07-25; where those disagree the code is what is
> documented, and the divergence is called out. Writing this pass surfaced two defects — systemd
> detection and backup — both repaired in the same phase; §3 and §6 describe the repaired behaviour.
> **Update centre added 2026-07-25** (jobs, update/channel/rollback/uninstall, restore): §6a is the
> new section, §1, §3 and §8 were corrected against it — restore is now the one writer into an app's
> own state dir, so the old absolute "nothing is ever written" invariant no longer held as stated.

Per-app specifics (units, ports, install layouts, upstream quirks) live in
[HERMES-INTEGRATION.md](./HERMES-INTEGRATION.md) and
[OPENCLAW-INTEGRATION.md](./OPENCLAW-INTEGRATION.md); this doc is the subsystem — contract,
lifecycle, discovery, proxy, gaps.

## 1. What it is, and the boundary it keeps

MSO is the **shell**. Hermes and OpenClaw are **separate applications** that happen to run on the
same VPS: their own runtime, config, data, versions, health, logs and backups. MSO gives them a
window, a status card, a dock, and a switch — nothing else.

Three channels, nothing else: their **own CLI** for the version probe (`runner.ts:12` — the CLI
feature view types the same verbs into an ordinary PTY instead); **systemd/docker** for detect,
start/stop/restart, logs (`manager.ts:29`, `:121`, `:196`); their **own loopback HTTP surface** for
health, discovery and the proxied dashboard (`manager.ts:65`, `features.ts`, `…/proxy/…/route.ts`).

Non-goals, stated so nobody re-litigates them:

- **No source copying, forking or vendoring** — no upstream file is in this repo. **No DOM
  scraping** — discovery parses an upstream's *own* route/nav table out of its built bundle,
  never a rendered page.
- **Nothing under `~/.hermes/` or `~/.openclaw/` is written except by a restore the operator asked
  for.** Those trees are the upstream's source of truth and its own upgrader owns them. A casual
  cockpit write would fork the config away from what the installer expects, make upgrades
  unpredictable, and make MSO the owner of a data model it does not define — so detection, health,
  discovery, version and backup are all read-only, and an update mutates that tree only by running
  the app's **own** updater. `restore.ts` is the single exception and the only writer in the
  subsystem: it puts back bytes MSO itself copied out, behind the five gates in §6a. That is why
  MSO refuses to persist a channel by editing `~/.openclaw` and runs an update instead.
- **No shared identity** — MSO's session never reaches an upstream, the proxy strips it
  (`proxy-headers.ts:56`); you still log into Hermes as Hermes. **No plugin management** —
  MSO neither installs nor enables plugins in either app.

### The one thing not to misunderstand

The origin split in §5 is a **browser-realm boundary**: it stops upstream *page JS* from reaching
the cockpit's API. It does nothing about the daemon. A plugin installed into Hermes runs inside the
Hermes process with Hermes' privileges, and Hermes executes shell commands on this VPS — so
installing an untrusted plugin into either app hands that daemon arbitrary code execution on the
host, the same blast radius as `curl … | sh`. No iframe, sandbox attribute or CSP here changes that.

## 2. The contract

`ManagedAppId = "hermes" | "openclaw"` — a closed union (`lib/managed-apps/types.ts:1`) narrowed by
`isManagedAppId()` (`catalog.ts:43`) at the top of every route. There is no "add an app at runtime"
path: a new app is a catalog entry plus a doc. One definition per app (`types.ts:15`, values at
`catalog.ts:13`):

| Field | What it is for |
|---|---|
| `id` / `name` / `description` / `gradient` | the union member, display strings, tile brand |
| `command` | the CLI on `PATH`. Version probe, `package` detection, CLI feature view |
| `serviceNames` | systemd unit candidates, tried in order. Plural because installers name the unit differently; each candidate's existence is checked, so order is a preference, not the answer |
| `containerNames` | ordered docker container candidates, for a containerised install of the same app |
| `dashboardUrl` | the **loopback** HTTP surface: health, discovery, proxy upstream |
| `stateDirName` | the app's state dir under `$HOME` (`.hermes`, `.openclaw`) — read for discovery, copied for backup, never written; the fallback when `homeDir` is unset |
| `assetDir?` / `homeDir?` | overrides for the built-SPA dir and the install home; **when set**, `homeDir` is what discovery reads (`features.ts:23`) **and** what backup copies (`manager.ts:142`) — same precedence in both |

**Why both service names and container names.** Detection has to answer "how is this installed *here*" —
a user unit on one host, a system unit on the next, a container on a third — and the install type then
decides which actions exist at all (`manager.ts:80`): systemd and docker get the full set, a bare CLI on
`PATH` gets `backup` only, because there is no supervisor to start or stop.

**Why the dashboard URL must be loopback.** The proxy re-validates its target on every request and
502s unless the scheme is `http:` and the host is `127.0.0.1`, `localhost` or `::1`
(`proxy/[[...path]]/route.ts:114`). That route carries the owner's session and is the one route
untrusted upstream JS can drive, so its target must be a service on this machine — without the check,
`HERMES_DASHBOARD_URL=http://169.254.169.254/…` makes the cockpit an authenticated SSRF gateway.

**Env overrides** (`.env.example`, all optional; `expandHome()` at `catalog.ts:7` expands a leading
`~` because these are hand-written):

| Var | Default | Read by |
|---|---|---|
| `HERMES_DASHBOARD_URL` | `http://127.0.0.1:9119` | health, discovery, proxy |
| `OPENCLAW_DASHBOARD_URL` | `http://127.0.0.1:18789` | health, discovery, proxy |
| `HERMES_HOME` | `~/.hermes` | discovery **and** the backup source |
| `HERMES_WEB_DIST` | `<home>/hermes-agent/hermes_cli/web_dist` | discovery only |
| `OPENCLAW_CONTROL_UI_DIST` | `~/.local/lib/node_modules/openclaw/dist/control-ui` | discovery only |

`homeDir` is the only field that moves the backup source (`manager.ts:142`), and only Hermes has one in
the catalog — there is no `OPENCLAW_HOME`, so OpenClaw's source is always `~/.openclaw`. One wart left:
`ManagedAppView.dashboardAvailable` (`types.ts:41`) is computed and never read.

## 3. Lifecycle

**Detection** (`manager.ts:42`), first match wins: each `serviceNames` entry probed with `systemctl
--user show -p LoadState -p ActiveState <unit>` then the same in the system scope → `docker ps -a
--format {{.Names}}` against `containerNames` → `which <command>` → `not-installed`.

`show`, not `is-active`, and this is the systemd trap worth remembering: **`is-active` cannot say
"no such unit"** — on systemd 255 an unknown unit prints `inactive` with rc 4 and an empty stderr,
byte-identical to a stopped one, so reading that as "exists but stopped" pins detection to the
first configured name forever. `LoadState=not-found` is unambiguous and one call returns
`ActiveState` with it (`manager.ts:29`); a non-zero exit is *no answer* — no `systemctl`, no user
bus — so the next scope is tried and nothing is concluded. Both apps through the real
`listManagedApps()` right now (real `systemctl`, real CLIs, no mocks):
`hermes | systemd | running | healthy=true | dash=true | Hermes Agent v0.19.0 (2026.7.20) ·
upstream a61183b5` and `openclaw | systemd | running | healthy=true | dash=true | OpenClaw
2026.7.1-2 (0790d9f)`.

`systemctl --user show -p LoadState -p ActiveState openclaw.service openclaw-gateway.service`
shows what that rests on: the first `not-found`, the second `loaded` + `active`. OpenClaw matches
`openclaw-gateway.service` — card "running", logs from that unit's journal, lifecycle actions on
the unit that exists; Hermes matches `hermes-dashboard.service`. The docker and `package` branches
are reachable now that a phantom unit cannot win the loop, but nothing here exercises them (§8.6).

**State** (`types.ts:7`), derived at `manager.ts:92` — the union's sixth member, `error`, is never
produced:

| State | Means |
|---|---|
| `not-installed` | no unit, no container, no binary — no actions offered |
| `stopped` | installed (`LoadState=loaded`, or the container exists), `ActiveState` not `active`. Lifecycle actions are still offered |
| `starting` | a `start` is in flight in this process (the lock below) |
| `running` | active, and health did not answer "no" |
| `unhealthy` | active, but the health probe answered non-2xx |

**Health** (`manager.ts:65`): `GET <dashboardUrl>/health`, 4 s timeout, redirects followed
(default `fetch`), `response.ok` → boolean; throw → `null`; never probed while stopped → `null`.
Weaker than it looks for an app with no `/health`: Hermes' `302 → /login` chain ends `200`, so it
reports `healthy: true` (HERMES-INTEGRATION.md §2). The probe proves the dashboard answers HTTP.

**Version** (`manager.ts:74`): `<command> --version`, first line, capped at 160 chars.

**Actions**: `start | stop | restart | backup` (`types.ts:4`) — systemd via `systemctl --user <action>`
then the system scope (`manager.ts:121`), docker via `docker <action>`. Everything runs through
`execFile` with `shell: false` (`runner.ts:12`) — no argument reaches a shell — 30 s, 128 KB cap.

**Operation lock** (`manager.ts:15`, taken at `:186`, released in `finally`): one action per app,
in-memory, process-local; a second throws → `409`. Not a file lock and it does not survive a restart —
it stops double-clicks and makes `starting` observable, nothing more. On top of it,
`rateLimited("managed-app:<id>", 12, 60_000)` (`[id]/route.ts:23`) — fixed-window, **per app**.

**Audit**: each action appends `managed-app.action` with `target=<id>`, `detail=<action>`, `ok` and
`actor` (the approved device id from the session, via `getSessionActor()`) to `~/.mso/audit.log`.
Long operations are logged **twice**: the route writes the launch (`detail=update.<action>` +
`meta.jobId` + `meta.argv`), and `job-audit.ts` writes the outcome (`detail=job.<kind>.<status>` +
`meta.jobId/exitCode/error`) — matched on `jobId`, and the actor is carried across by
`rememberJobActor()` because the job outlives the request. Without the second line the trail said an
uninstall had been *launched* and nothing said whether it worked: job records prune at 20/app or 30
days, so that was the only durable trace. It is written once per job id, from `job-runner.ts`'s
`finish()` — the one place that sees every ending, including a job nobody polls — and from the poll
route as a backstop for a record this process did not run (a deploy reconciles those to
`interrupted`). Log output is redacted first
(`manager.ts:18`): `Bearer …` and `key|token|secret|password|authorization` assignments become
`[redacted]`, 8 KB per line.

**Demo mode**: `verifyAuth()` returns `false` whenever `IS_DEMO` (`lib/agent/server.ts:12`), so the whole
subsystem 401s in a demo build; the action route also answers `403` (`[id]/route.ts:20`) as a backstop.

### Endpoints

| Endpoint | Method | Auth + gates |
|---|---|---|
| `/api/v1/managed-apps` | GET | `verifyAuth`; 503 on failure |
| `/api/v1/managed-apps/[id]` | GET | `verifyAuth`, id validated |
| `/api/v1/managed-apps/[id]` | POST `{action}` | `verifyAuth` → demo 403 → rate limit 429 → action allowlist 400 → lock/unsupported 409, audited |
| `/api/v1/managed-apps/[id]/logs` | GET | `verifyAuth`; last 100 journald/docker lines, redacted |
| `/api/v1/managed-apps/[id]/features` | GET | `verifyAuth`; 60 s cache; 503 if discovery throws |
| `/api/v1/managed-apps/[id]/update` | GET | `verifyAuth`, id validated; **cache read only, never probes** — `cachedUpdateStatus()`, `checkedAt: null` until something has probed (§6a) |
| `/api/v1/managed-apps/[id]/update` | POST `{action}` | same gates as the action route; `check` spends `managed-app-check:<id>` (10/60 s) and the four destructive actions the `managed-app:<id>` bucket (12/60 s); `check` answers inline, the rest answer `202 {job}` |
| `/api/v1/managed-apps/[id]/jobs` | GET | `verifyAuth`; history without transcripts |
| `/api/v1/managed-apps/[id]/jobs/[jobId]` | GET | `verifyAuth`; `?since=` poll; 404 for another app's job |
| `/api/v1/managed-apps/[id]/backups` | GET | `verifyAuth`; snapshots a rollback can choose from |
| `/api/v1/managed-apps/[id]/proxy/[[...path]]` | GET/HEAD/POST/PUT/PATCH/DELETE | `verifyAuth`; in split mode also requires the middleware host stamp, else 404 (§5) |

**Detection is not on the dashboard's path.** Neither the proxy nor discovery consults it (both go
straight at `dashboardUrl`), so a detection miss never takes a dashboard down — which is exactly how
a wrong card survives unnoticed: the card is the only place it shows.

## 4. Feature discovery

Each app's **own navigation** becomes MSO app tiles. Nothing is hardcoded as a feature
list: if discovery finds nothing, the OS shows nothing.

**Hermes** (`features.ts:49`) — its built SPA off disk, then its plugin API: `<dist>/index.html` →
the `assets/index-*.js` it names (`:42`) → the `{ path, labelKey, label }` nav table
(`feature-parser.ts:64`), falling back to the route→component record in the same bundle (`:75`) and
then to `<home>/hermes-agent/web/src/App.tsx`, because a git install keeps the nav SSOT in
TypeScript. Plugin tabs from `GET <dashboardUrl>/api/dashboard/plugins` (public, unauthenticated, no
credential involved) are spliced in the way upstream's own `buildNavItems()` does (`:94`), honouring
`position: before:/after:`, `override` and `hidden`. A stopped dashboard costs the plugin tabs only.

**OpenClaw** (`features.ts:75`) — its route table, live then on disk: `./assets/app-route-paths-*.js`
named by `GET <dashboardUrl>/`, parsed for the `key: { path, aliases }` map (`feature-parser.ts:126`);
else the `index-*.js` chunk's page + settings route factories (`:133`); else the same chunk inside
the installed package, which is what keeps the launchpad populated while the gateway is down.

**Tripwires.** A route must match `^/(?!/)[A-Za-z0-9/_-]*$` (`feature-parser.ts:19`), and a run is
accepted only with ≥ 5 entries including `/sessions` (Hermes) or ≥ 12 including `/chat` (OpenClaw)
— otherwise `checked()` discards **the whole run** (`:58`). So an upstream bundle reshuffle that breaks a
regex yields an empty list, never a plausible-looking partial one: the workspace keeps the shared apps
(Terminal, Files, Assistant, Monitor, Settings) and loses the upstream tiles until the parser is updated,
while the proxy, the management card and the CLI view carry on. Discovery failure is **silent by design**
— `/features` answers `503` only if discovery throws, not when it finds nothing.

Routable-but-dead keys are marked `available: false` (`feature-parser.ts:12`: `workboard` behind a
feature flag, `plugin` a plugin host) and the dock filters them out (`dynamic-features.tsx:49`). Results
are cached 60 s per app, in-process (`features.ts:15`); nothing invalidates on upstream upgrade, so a new
nav entry appears within a minute. Live counts move with every release and live in the per-app docs.

Each key gets its own lucide icon from a per-key map, with a hashed palette fallback so a wall of
new upstream tiles still reads as distinct (`feature-icons.ts:73`), and may map to a **read-only**
CLI subcommand (`feature-cli.ts:21`) — no verified subcommand means no CLI toggle, and the three commands
that start a wizard when bare (`openclaw config`, `openclaw doctor`, `hermes model`) are mapped to
documented read-only forms so opening a tab never writes. `feature-cli.test.ts` pins those maps against
the verbatim `--help` verb lists.

## 5. The proxy and its containment

The dashboards render in an OS window as an iframe over a reverse proxy. The iframe keeps
`allow-same-origin` (`feature-app.tsx:107`) because these SPAs need their own cookies and storage or
they do not boot at all. That is the whole security problem:

- **On the cockpit origin** that also made upstream JS same-origin with the cockpit, so it could
  take `window.top.fetch` and POST `/api/v1/exec/run` with the owner's session. Proven in real
  Chromium. **No CSP can stop it** — a policy binds a realm, not a reference across realms.
- **Cross-origin**, `window.top` is opaque. Verified in Chromium 148: `top.location`, `top.origin`,
  `top.fetch` and `document.domain = "rahmanef.com"` all throw `SecurityError`, with a same-origin
  control in the same run that *does* break through.

Hence the **origin split**: each dashboard is served from its own host
(`hermes.mso.rahmanef.com`, `openclaw.mso.rahmanef.com`) pointed at this same process. One host
*per app*, never one shared host — a shared one would put Hermes and OpenClaw back in a single
origin where they can script each other (`origin.ts:12`).

`proxy.ts` (Next 16's middleware) enforces the other half. The **`Host` header** decides which
app a request belongs to and `X-Forwarded-Host` is deliberately ignored, because a request able
to claim the cockpit host while on an app host would escape the rewrite (`proxy.ts:112`). On an
app host **every path** is rewritten into that app's proxy (`:146`), so `/api/v1/exec/run` does
not exist there, and `/_next/*` 404s (`:129`). A host **inside the namespace that is not an app**
also 404s (`:121`, `origin.ts:71`): the session cookie is widened to `mso.rahmanef.com`, so a new
`X.mso.rahmanef.com` record must not be able to serve an authenticated cockpit — the parent name
is never matched, so this cannot lock the operator out. The rewrite stamps
`x-os-managed-app-host` and **deletes any inbound copy** on every request (`:132`, `:182`,
`:196`); the route trusts it only in split mode (`route.ts:92`), since forged it would buy
root-mounted mode on the cockpit origin. CSRF depth-2 runs **before** the rewrite (`:128`) —
afterwards the path already looks like `/api/…`.

### Containment, item by item

| Control | Where | Why |
|---|---|---|
| loopback-only upstream + path segment validation | `route.ts:114`, `:104` | the proxy carries the owner's authority, so an arbitrary target is authenticated SSRF; empty, `.`, `..`, `\` and NUL segments are rejected before the upstream URL is built |
| request header allowlist | `proxy-headers.ts:14` | `authorization` is never forwarded; with `www-authenticate` withheld too, the proxy cannot become a credential relay |
| response header allowlist | `proxy-headers.ts:30` | upstream `x-frame-options` / `content-security-policy` / `permissions-policy` are never echoed, so an upstream cannot un-frame itself or replace our policy |
| cookie namespacing + path pinning | `proxy-headers.ts:46`, `:56`, `:112`, `:121` | upstream cookies become `mapp_<id>_<name>` with `Domain` dropped, `SameSite=Lax`, `Secure` mirroring the browser's hop, and `Path` = the proxy prefix (single-origin) or `/` (the app owns its host root). An upstream can neither read nor overwrite the cockpit `session` cookie, nor a sibling app's |
| request body cap | `route.ts:33`, `:63` | 1 MB, counted **as it streams**, because a chunked request has no `content-length` to test |
| service-worker refusal | `route.ts:109`, `proxy-headers.ts:182` | a SW registered from proxied bytes installs on this origin and keeps answering after the window closes; `worker-src blob:` is the real control, the 404 means the script never reaches the browser |
| redirect refusal | `route.ts:158`, `proxy-headers.ts:160` | a `Location` resolving off the upstream origin is refused, not relayed: it is an open redirect, and per CSP3 §6.6.2.6 one hop drops path matching for every source in the policy |
| upstream timeout + HTML/CSS buffering | `route.ts:129`, `proxy-html.ts:17` | 20 s then 502; a rewritable body is buffered to 2 MB and one that outgrows the cap is streamed unrewritten rather than truncated |

### The CSP is intersected, not replaced

Ours is the only policy the browser sees, but the upstream's is not discarded: it is
**intersected per directive** (`proxy-csp.ts:214`) — a source survives only if both policies allow
it, and the tighter side wins. Rules that matter:

- Every fetch directive is scoped to the app's absolute proxy URL. CSP matches such sources by **path
  prefix**, which is what leaves `/api/v1/exec`, `/api/v1/fs` and `/api/v1/term` outside the policy in
  single-origin mode; `'self'` is deliberately absent everywhere. No `'unsafe-eval'` (neither bundle
  contains `eval(` or `new Function(`), `worker-src` is `blob:` only.
- `frame-ancestors` is always ours — being framed by the cockpit is the point, so an upstream
  `frame-ancestors 'none'` can never win; `base-uri` is ours only in single-origin mode, where we
  inject `<base href>`. Upstream **hashes** are copied in, upstream **nonces** never are: a nonce
  matches a script element whatever its URL, re-opening the origin scoping (`proxy-csp.ts:134`).
- An external `https:` host the upstream **declares** is honoured (its own UI needs it), with no
  wildcards and **never the cockpit origin** (`:174`) — `connect-src https://mso.rahmanef.com` out
  of a compromised upstream is the thing scoping exists to stop. Hosts that *nothing* grants are
  disclosed in the window rather than failing silently (`proxy-headers.ts:228`).

### Origin-split vs single-origin — RESOLVED, single-origin is gone

This section used to be a comparison table presenting single-origin as the "dev, demo,
rollback" path, including the row `window.top` reach → **open**. That was the reason it
had to go, not a caveat to live with.

`38d010d` ("serve dashboards from an app host or not at all") removed it. The route now
returns 404 when no app host is configured
(`app/api/v1/managed-apps/[id]/proxy/[[...path]]/route.ts`), because a CSP binds a realm
and not a reference across realms: upstream JS in a same-origin frame reaches
`window.top.fetch('/api/v1/exec')`, and `window.open('/')` hands it a whole cockpit realm.
No header can intervene.

So there is exactly one supported mode:

| | origin-split (the only mode) |
|---|---|
| trigger | `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` contains `{id}` |
| iframe `src` | `https://<id>.mso.rahmanef.com/<route>` — the app owns its host root |
| document rewriting | none — the upstream's own URLs resolve as shipped |
| cookie `Path` | `/`, namespaced to the app host |
| `window.top` reach | opaque (cross-origin) |
| needs | DNS + TLS per host, a Traefik router, the widened session cookie |

Without a host template the dashboards are simply not proxied — the windows fall back to
the CLI view and to opening the app in the user's own browser. **Do not reintroduce a
cockpit-origin path proxy as a convenience.**

### Turning it on is THREE steps, and the third one has no error message

Reported by the same operator as §7's user-bus gap, and it cost an afternoon: the Hermes
window showed a terminal, so the dashboard looked broken. It was not — this deployment had
no app host, and nothing anywhere said so.

| Step | Skipping it looks like |
|---|---|
| 1. Set **both** `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` and `OS_SESSION_COOKIE_DOMAIN`, add the DNS record + a reverse-proxy route per app host | The window opens a terminal, silently |
| 2. **Rebuild**, not just restart — `NEXT_PUBLIC_*` is baked into the client bundle | Same terminal: the server is in split mode and the browser is still running the old bundle |
| 3. **Sign out and back in** | The frame 401s while the cockpit keeps working |

Step 3 is the one with no signal, and it cannot be given one server-side. `Domain=` is
attached to the session cookie only when it is ISSUED (`login/route.ts`, via
`sessionCookieAttrs`) and there is no sliding refresh, so every pre-existing session stays
host-only and is never sent to `<id>.<parent>`. A Cookie header carries no Domain, so a
cookie that was never sent is indistinguishable from one that never existed — the server
cannot tell "stale session" from "not logged in".

So all three now say it where it will be read, none of them relying on this file:

- **Step 1** — the window itself. `feature-app.tsx` renders one line above the terminal
  when `featureSource()` is null, naming the variable. Only in that case: with a dashboard
  configured nothing renders, so it cannot become the always-on banner that was removed.
- **Steps 2 and 3** — the failure page. The proxy route's errors are what the frame
  displays (that is what `failAncestors()` is for), and `proxy-error-page.ts` turns them
  from `{"error":"unauthorized"}` into a page that names the re-login. Navigations only,
  chosen by `Sec-Fetch-Dest`: an upstream SPA's own `fetch()` hits the same route and keeps
  getting JSON.
- **Before any of it** — `mso doctor` prints the template when set, `off` when neither var
  is set, and FAILS when exactly one is, which is the configuration §5 warns is unsafe.

Live verification (unauthenticated, so 401 is the expected success signal):

```
H=hermes.mso.rahmanef.com   # no trailing slash on the proxy URL: Next 308s it away first
curl -sI -H "Host: $H" 127.0.0.1:4005/                 # 401 + frame-ancestors 'self' <cockpit>
curl -s  -H "Host: $H" 127.0.0.1:4005/_next/static/x.js          # 404 — /_next is cockpit-only
curl -s -X POST -H "Host: $H" 127.0.0.1:4005/api/v1/exec/run     # 403 cross_origin_blocked
curl -s -H 'Host: staging.mso.rahmanef.com' 127.0.0.1:4005/       # 404 — unclaimed namespace host
curl -s -H 'Host: mso.rahmanef.com' 127.0.0.1:4005/api/v1/managed-apps/hermes/proxy   # 401; 404 signed in
```

Residual, by design: the proxy is **HTTP only** — a route handler cannot service an `Upgrade` — so
OpenClaw's socket-driven panels load their chrome and stay empty, and those features open on the CLI
view instead (`feature-cli.ts:41`, `:60`). The `connect-src` residual is §8.8.

## 6. Backup

`backup` (`manager.ts:141`) copies the app's state dir recursively, timestamps preserved, to
`~/.mso/backups/<id>/<ISO-stamp>/` (parent `0700`), then writes `manifest.json` (`0600`)
containing `{applicationId, createdAt, source, skipped: {symlinks, dirs, dirNames}}`. The source is
`expandHome(homeDir)` when the catalog has one, else `homedir() + stateDirName` — so a Hermes
install relocated with `HERMES_HOME` is what actually gets copied.

Two things are left out, both matched by **basename** so they apply at any depth (`manager.ts:139`,
`:155`). First `node_modules`, `.venv`, `venv`, `__pycache__`, `.git`, `.cache`, `backups` —
re-installable bytes, not state, and `backups` is the app's **own** backup dir (1.1 GB under
`~/.hermes`, `du -sh ~/.hermes/backups`) which a backup has no business copying into a second one.
Second **symlinks, skipped rather than followed or recreated**: following one copies bytes from
outside the app, recreating an absolute one aims a future restore outside the tree. A skip and not a
refusal for a reason worth keeping — refusing the run on the first link is what the predecessor did,
and with `find ~/.hermes -type l | wc -l` → 58 and `~/.openclaw` → 2063 that meant the action failed
on every real install and never ran once. The skip is recorded, not silent: the counts go in the
manifest, because a restore is only safe if you know what the copy never had. Adding
`-not -path '*/node_modules/*'` and the other six names to that `find` leaves 1 and 9 — the rest sit
inside pruned trees and are never reached, so those are the order of `skipped.symlinks`.

`du -sh --exclude=node_modules --exclude=.venv --exclude=venv --exclude=__pycache__ --exclude=.git
--exclude=.cache --exclude=backups ~/.hermes ~/.openclaw` gives the size: **366 MB** and **237 MB**,
against 2.7 GB and 1.7 GB unexcluded, with 227 GB free on `/home` (`df -h /home`). `~/.mso/backups/`
is created by the first run; this host has one snapshot per app, from the first real backup runs.
`manager.test.ts` covers the shape in a fixture home: state files copied, `node_modules/` and `backups/`
absent, an `/etc/passwd` symlink neither followed nor recreated, manifest counters as claimed.

## 6a. Update centre — update, rollback, uninstall

Everything destructive is a **job** (`jobs.ts` + `job-runner.ts` + `job-store.ts`): the POST starts
one and returns an id, the client polls `/jobs/<id>?since=`. A route handler cannot hold an
`openclaw update` open — upstream's own default step timeout is 1800 s and it restarts services on
the way out. The child is spawned by this process and **dies with it** (`mso.service` is
`KillMode=control-group`, `Delegate=no`, so `detached` buys a process group, never a cgroup); the
durable part is the record under `~/.mso/managed-app-jobs/` (0700 dir, 0600 files), and a job
whose owner pid is gone — or which stopped heart-beating for 45 s — reconciles to `interrupted`
rather than sitting at `running` and stranding the lock. **Do not deploy while an update runs.**

A job takes the **same** `lock.ts` lock as start/stop/restart/backup, so an update and a `restart`
can never interleave. Every argv is an array through `spawn(shell: false)`; a channel/tag/branch is
allowlisted (`update-cli.ts`) *before* it becomes an element, and the job layer refuses any argument
carrying a control character as a tripwire on that. Transcripts go through the same `redact()` as
the logs route, per **complete line** (a secret split across two stdout chunks would walk past a
per-chunk regex), tail-capped at 256 KB.

**A backup runs inside the operation, before anything spawns** (`prepare`), for update, uninstall
and rollback — a throw there ends the job `failed` with the CLI never invoked. Uninstall
additionally requires the caller to echo the app id in the body. `dryRun` skips the backup, because
a preview writes nothing — and because a preview is therefore the one unprotected path, MSO first
asks the installed CLI whether it still advertises `uninstall --dry-run` (`assertPreviewSupported`,
one `--help` spawn) and refuses the preview if it does not. `--yes` cannot simply be dropped from a
preview: `hermes uninstall` hits `_require_tty()` before it reads `--dry-run` unless `--yes` was
passed, and `openclaw uninstall --non-interactive` exits 1 without it. Jobs spawn with stdin closed,
so a preview without the confirmation flag is exit 1 and no output.

The argv, verified against each CLI's own `--help` on this host: `hermes update --yes [--branch N]`,
`hermes uninstall --yes [--dry-run]` (never `--full`), `openclaw update --yes [--dry-run --json]
[--channel C] [--tag T] [--no-restart]`, `openclaw uninstall --non-interactive --yes --service
--state [--dry-run]` (never `--all`/`--workspace`). `--json` is a dry-run-only flag: in a real run it
silences the progress stream the UI exists to show. No interactive verb is ever invoked.

**Install is NOT automated** — both installers are interactive, so `capabilities.installCommand`
carries the exact command for the operator to run. **Channel switching is an update run** for
OpenClaw (upstream persists a channel only through one) and is *refused* for Hermes, whose
`--branch` rewrites a working tree and is exposed only as a per-update pin.

**A rollback pin is OpenClaw-only** (`--tag`). Hermes has none: its pin is `--branch`, i.e. a
checkout switch, and `hermes update` auto-stashes local changes first. A restore puts working-tree
files back while `.git` — which the backup prunes — is untouched, so the tree is dirty against an
unchanged HEAD and the pin would stash exactly what was just restored (with `--yes` that is a
*non-interactive* update: default re-applies the stash, `updates.non_interactive_local_changes:
discard` drops it, a conflicting apply ends in `git reset --hard`) while the job reports success. The
route refuses a pin for Hermes with a 400 and the panel does not render the field (`app-support.ts`
`rollbackPin`, mirrored against `UpdateAdapter.pin` by a test).

**Restore now exists** (`restore.ts`), and it **overwrites; it never deletes**. Five gates first: the
app must not be running (a live app would flush its WALs back over the restore), the backup id must
match the minted stamp, its manifest must name this app, the manifest's recorded source must still
be exactly this app's state dir, and that dir must be a real non-symlink directory that is not
`$HOME` or an ancestor of it. A destination symlink aborts the whole run — `fs.copyFile` opens with
`O_CREAT|O_TRUNC` and follows links, which is the exact escape. A `pre-restore` snapshot is taken as
the undo. Because a snapshot has no `node_modules`/`.venv`/`.git`, a rename-aside-and-replace would
leave a broken install; so files created since the snapshot stay, and the result says so
(`overwriteOnly: true`, `notRestored`). An MSO snapshot is a **state** backup, not an install image.

## 7. Operations

| Var | Read at | Notes |
|---|---|---|
| `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` | **build** (client) + runtime (server, middleware) | e.g. `{id}.mso.rahmanef.com`. Presence of `{id}` is what turns split mode on |
| `OS_SESSION_COOKIE_DOMAIN` | runtime | adds `Domain=` so the session reaches the app hosts (`lib/auth/session-cookie.ts:68`) |
| `OS_PUBLIC_ORIGIN` | runtime | the origin named in `frame-ancestors` and used to scope the policy; unset falls back to the template's parent, and a value that resolves to nothing fails closed to `frame-ancestors 'none'`. The `HERMES_*` / `OPENCLAW_*` vars (§2) are runtime too |

The two split-origin vars are **one decision with two switches: set both, or neither.**
`OS_SESSION_COOKIE_DOMAIN` without the template hands the session to every host under the domain
while each of them still serves the whole cockpit; the template without the cookie domain gives
app hosts that 401 on every request.

**Deploy order** — forced by the build-time/runtime split:

1. DNS for `hermes.os.…` and `openclaw.os.…`, then the Traefik router
   (`/etc/dokploy/traefik/dynamic/mso-managed-apps.yml`: one `web` + one `websecure` router per host,
   `service: mso-service`, `certResolver: letsencrypt`; that shared service forwards to
   `http://172.17.0.1:4005` with `passHostHeader: true`, which is why middleware can trust `Host`).
2. Set both env vars in `.env.local`.
3. `pnpm build` — `NEXT_PUBLIC_*` is baked into the client bundle here. Built without it, the
   browser still points at the old same-origin URL the server has stopped answering, and the
   window comes up blank.
4. `sudo systemctl restart mso.service` — never restart before building (`CLAUDE.md`).

**Verify** with the curls in §5, plus `https://hermes.mso.rahmanef.com/` → `401` unauthenticated and the
dashboard rendering in an app window when signed in. Both app hosts resolve to the cockpit's own A/AAAA.

**Turning the feature OFF** (there is no "roll back to single-origin" any more — that mode was
removed for security, see §7): remove the two Traefik routers (or the DNS records) **FIRST**. With the
template unset an app host no longer matches an app and no longer 404s, so a still-resolving host would
serve the full cockpit. Then unset both env vars, `pnpm build`, restart; the dashboards stop being
proxied and the windows fall back to the CLI view. Domain cookies already in a jar survive, and logout
can only clear cookies it knows about (`lib/auth/session-cookie.ts:108`), so revoke the devices
(Settings → Devices) or wait out `SESSION_EXPIRY_HOURS`.

**Workspace modes are GONE** (`a2c3882`). Hermes and OpenClaw are ordinary app windows now — each
upstream already ships its own sidebar, so re-hosting its navigation in the MSO shell bought nothing and
rested on six regexes against minified third-party bundles. `os-shell/workspace-mode.ts` and the whole
upstream feature-discovery pipeline (`lib/managed-apps/features.ts`, `feature-parser.ts`,
`dynamic-features.tsx`, `feature-icons.ts`, the `/features` route) were deleted with it.
Switching writes the key and fires an event — nothing restarts, no server call. The mode decides which
apps the dock/launchpad show (`:85`, applied in `app/os-root.tsx:39`) and which discovered features
mount (`dynamic-features.tsx:25`). Right-click → **Workspace** works in every shell
(`integrations.ts:87`); a visible switcher exists only in the Dashboard sidebar.

## 8. Gaps

1. **No install flow, and no cancel verb.** Install stays a copyable command (both installers are
   interactive) — MSO does not fake one. A hung job is bounded only by its timeout (SIGTERM to the
   process group, SIGKILL 10 s later); there is no Cancel button, and adding one means exporting
   `signalTree` from `job-runner.ts`. Hermes has no channel and no dry-run verb, so those controls
   are absent for it by design, not by omission.
2. **OpenClaw panels stay empty** — its control UI is WebSocket-driven, the proxy is fetch-based.
   Takes a Node-runtime WS proxy outside the App Router (or an upstream HTTP fallback) with the
   same origin/cookie containment re-derived for sockets. Until then those open on the CLI view.
3. **The backup a restore rests on is still thin**: no size cap, and a manifest that records counts
   and what was skipped but carries no per-file inventory or checksum, so nothing can *prove* a
   snapshot is complete — restore verifies provenance (§6a), never integrity. Takes an inventory +
   checksum and a size guard. Restore also refuses rather than stopping the app; that is deliberate
   (§6a), but it means a rollback is two clicks, not one.
4. **No notifications** — a crash or unhealthy flip shows only while the card is open, polling
   every 10 s. Takes a server-side watcher plus the toast/activity bus.
5. **No resource-aware behaviour, no start-on-boot** — actions are never declined under memory
   pressure, and `systemctl enable/disable` is not exposed.
6. **No integration or journey tests**, and the **docker and `package` detection branches have no test
   and no install here to exercise them** — everything verified about detection is systemd. Unit
   coverage is solid on the parsers, header plumbing, systemd/backup behaviour, CSP intersection and
   split-origin behaviour (`lib/managed-apps/*.test.ts`, `app/api/v1/managed-apps/proxy*.test.ts`);
   nothing drives a browser login → dashboard → action.
7. **Workspace switcher parity** — visible control only in the Dashboard shell; macOS, Windows,
   iOS and Android have the right-click submenu only.
8. **An upstream can widen its own `connect-src`** to a third-party `https` host it declares
   (never to the cockpit). Tightening means dropping `HONOUR_EXTERNAL` (`proxy-csp.ts:125`) and
   accepting the breakage it was added to avoid.
9. **Dead edges**: `state: "error"` never produced, `dashboardAvailable` unread, `filterAppsForWorkspace`
   still filtering a legacy `managed-applications` id no descriptor uses.
10. **The completion audit is per process**: `job-audit.ts` remembers what it has written in memory,
   so a job that ends, is never polled, and outlives a restart can be logged a second time when its
   record is finally read. Duplicate append-only lines carrying the same `jobId` are the deliberate
   trade against a durable "already audited" store.

All of it lives in `lib/managed-apps/` (contract, catalog, manager, runner, discovery, origin math,
proxy), `app/api/v1/managed-apps/` (routes), `proxy.ts` (host gating), and
`frontend/slices/managed-apps/` (UI).

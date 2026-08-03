# Hermes — integration notes

> **⚠ SUPERSEDED IN PART (`a2c3882`, 2026-07-28).** Every passage about *feature
> discovery* — parsing Hermes's built SPA bundle to spawn one MSO window per
> upstream nav route — describes DELETED code (`lib/managed-apps/features.ts`,
> `feature-parser.ts`, `dynamic-features.tsx`, `feature-icons.ts`, the `/features`
> route, `os-shell/workspace-mode.ts`). Hermes is an ordinary app window now,
> opening on its own dashboard, because it already ships its own sidebar. Passages about
> the origin split, the proxy, the CLI fallback and the update centre are still accurate.
> Any mention of managed-app "single-origin mode" is also dead — see MANAGED-APPS.md §7.

> Originally re-checked against the installed source under `~/.hermes` (read-only) and the
> live process on 2026-07-25. Shipped `c411187` → `d880f68`. Where this file and the code
> disagree, the code is what is documented and the divergence is called out.

The subsystem itself — contract, lifecycle, proxy internals, CSP intersection, backup,
deploy order, gaps — is [MANAGED-APPS.md](./MANAGED-APPS.md). This file is only what is true
of **Hermes**. Its sibling [OPENCLAW-INTEGRATION.md](./OPENCLAW-INTEGRATION.md) has the same
seven sections in the same order, so the two read side by side.

**Hermes is a separate application.** MSO gives it a window, a status card, a dock and a
switch. Nothing in this repo copies, forks or vendors its source, scrapes its DOM, or writes
a byte under `~/.hermes/`. Read-only inspection of that tree is how discovery works.

---

## 1. What it is and where it lives

Hermes Agent — a tool-calling AI agent with a FastAPI/uvicorn web dashboard and a separate
messaging gateway (Telegram / WhatsApp / Discord). MSO uses it for exactly three things:
one status card, its own dashboard pages as MSO app tiles, and a read-only CLI view.

| | Value | Verified by |
|---|---|---|
| Version | `Hermes Agent v0.19.0 (2026.7.20) · upstream a61183b5` | `hermes --version` (line 1) |
| Install method | `git` | `~/.hermes/.install_method` |
| CLI | `/home/rahman/.local/bin/hermes` | `which hermes` |
| Install dir | `~/.hermes/hermes-agent` (1.5 GB — git checkout + its own venv) | `hermes --version`, `du -sh` |
| State dir | `~/.hermes` (2.7 GB — **the install lives inside the state dir**) | `catalog.ts:22`, `du -sh` |
| Dashboard port | `9119`, bound `0.0.0.0` | `ss -tlnp`, unit `--host 0.0.0.0` |
| Public today | **yes** — `ai.rahmanef.com` | `/etc/dokploy/traefik/dynamic/ai-hermes.yml` → `http://172.17.0.1:9119`, `passHostHeader: true` |
| MSO app host | `hermes.mso.rahmanef.com` → mso `:4005` → proxy → `127.0.0.1:9119` | `mso-managed-apps.yml`, `curl` below |

Two **user** systemd units, both in `~/.config/systemd/user/`, both `Restart=always`. There
is no system-scope unit for either.

| Unit | ExecStart | What it is |
|---|---|---|
| `hermes-dashboard.service` | `~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main dashboard --host 0.0.0.0 --port 9119 --skip-build --no-open` | the web dashboard MSO proxies |
| `hermes-gateway.service` | `… -m hermes_cli.main gateway run` | the messaging gateway — **not in MSO's catalog** |

The dashboard unit also sets `HERMES_HOME=/home/rahman/.hermes` and
`HERMES_DASHBOARD_PUBLIC_URL=https://ai.rahmanef.com`, and `WorkingDirectory=/home/rahman/.hermes`.

**`--host 0.0.0.0` is load-bearing twice over.** It is why Traefik can reach the dashboard
across the docker bridge for `ai.rahmanef.com`, and it is why Hermes runs its *gated* auth
middleware rather than the loopback one (§3). MSO does not depend on it: the proxy targets
`127.0.0.1:9119` and would keep working if the bind were narrowed.

---

## 2. How MSO detects and controls it

Catalog entry at `lib/managed-apps/catalog.ts:14`.

| Field | Value |
|---|---|
| `command` | `hermes` |
| `serviceNames` | `["hermes-dashboard.service", "hermes.service"]` |
| `containerNames` | `["hermes", "hermes-dashboard"]` |
| `dashboardUrl` | `http://127.0.0.1:9119` (`HERMES_DASHBOARD_URL`) |
| `stateDirName` | `.hermes` |
| overrides | `HERMES_HOME` (discovery **and** the backup source), `HERMES_WEB_DIST` (discovery only) |

**Detection resolves on the first candidate, and now for the right reason.** `systemctl --user show
-p LoadState -p ActiveState hermes-dashboard.service` → `loaded` + `active`, so `detect()`
(`manager.ts:42`) accepts it and reports `installationType: "systemd"`. `hermes.service` is
`not-found` here and is skipped rather than accepted — which used to be the bug: `is-active` prints
`inactive` (rc 4) for an unknown unit on systemd 255, so the loop never advanced. OpenClaw is where
that bit — see [OPENCLAW-INTEGRATION.md §2](./OPENCLAW-INTEGRATION.md).

**Actions.** `start`/`stop`/`restart` run `systemctl --user <action> hermes-dashboard.service`, and try
the system scope only if that fails (`manager.ts:121`) — always via `execFile`, never a shell
(`runner.ts:12`). `backup` copies the Hermes home.

- Only the **dashboard** unit is touched. `hermes-gateway.service` keeps running through a dashboard
  restart, and MSO offers no control over it at all. The dashboard reports the gateway's state in its
  own `/api/status` (`gateway_running`, `gateway_state`, `gateway_platforms`) — look there after one.
- **`backup` follows `HERMES_HOME`** (`manager.ts:142`). It is not set in the *cockpit's* process —
  the dashboard unit exports it for itself and that env does not reach mso — so the source falls
  back to `~/.hermes`, the same path; a relocated install would now be copied instead of missed.
  With the exclusions in [MANAGED-APPS.md §6](./MANAGED-APPS.md) the copy is **366 MB** rather than
  2.7 GB: the venv and `hermes-agent/node_modules` are pruned, and so is `~/.hermes/backups` — 1.1 GB
  of Hermes' *own* snapshots. Symlinks are skipped, not refused: `find ~/.hermes -type l | wc -l` →
  **58**, 57 inside those pruned trees, the last `lsp/bin/typescript-language-server`. Refusing on the
  first symlink is what used to fail this install every time.
- Hermes' own `hermes backup` / `hermes import` still archive and re-import; MSO's copy has no restore side.

**What "healthy" means for Hermes: less than it looks.** `health()` (`manager.ts:65`) does
`GET http://127.0.0.1:9119/health` with `fetch`, which follows redirects, and returns
`response.ok`. `/health` is **not** on Hermes' public-path allowlist, so:

```
GET /health   → 302  location: /login?next=%2Fhealth
GET /login    → 200  text/html
```

The chain ends 200, so MSO reports `healthy: true`. It proves the dashboard answers HTTP —
nothing about the agent, the gateway, or whether anyone can log in. The real signal is
`GET /api/status`, which *is* public (`hermes_cli/dashboard_auth/public_paths.py:39`) and
returns version, `gateway_state`, per-platform channel state, `active_sessions` and
`can_update_hermes`. MSO does not read it.

**Version** is the first line of `hermes --version`, capped at 160 chars. The command also
prints the install directory and install method on later lines; those are discarded.

**Logs**: `journalctl --user -u hermes-dashboard.service -n 100 --no-pager -o short-iso`,
then redaction (`manager.ts:18`). Six lines today — the dashboard is quiet once up.

Live view from `listManagedApps()` against this host: `installationType: "systemd"`,
`state: "running"`, `healthy: true`, `dashboardAvailable: true`,
`supportedActions: ["start","stop","restart","backup"]`.

---

## 3. Auth model, and how the proxy lives with it

Hermes runs **gated** auth because the bind is non-loopback. Its own `/api/status` reports the
shape: `auth_required: true`, `auth_providers: ["basic"]`, `auth_flows: ["cookie"]`. The
`basic` provider's credential belongs to Hermes and lives in Hermes' own state; MSO never reads
it, and no MSO code path reads `~/.hermes/config.yaml`, `auth.json` or `.env` (grep of
`lib/managed-apps/`: the only upstream reads are the built SPA, `web/src/App.tsx`, and the
public plugins endpoint).

**Its five cookies** (`hermes_cli/dashboard_auth/cookies.py:67-82`):

| Bare name | Contents | `Max-Age` (`cookies.py:96`, `:104`, `:194`) |
|---|---|---|
| `hermes_session_at` | access token | whatever the provider's `expires_in` said |
| `hermes_session_rt` | refresh token (omitted entirely when empty) | 30 days (`_RT_MAX_AGE`) |
| `hermes_session_provider` | which provider minted the session (routing hint, no secret) | 30 days (same constant) |
| `hermes_session_pkce` | PKCE state + CSRF nonce + provider hint | 10 min |
| `hermes_sso_attempt` | one-shot auto-SSO loop guard (boolean breadcrumb) | 60 s |

All five are `HttpOnly`, `SameSite=Lax`, and their **names change with the request shape**:
`_resolved_name()` (`cookies.py:107`) prepends `__Host-` on HTTPS at `Path=/`, `__Secure-` on
HTTPS behind a path prefix, and nothing over HTTP. The switch is `request.url.scheme ==
"https"` (`cookies.py:338`), and uvicorn runs with `proxy_headers=bool(auth_required)`
(`web_server.py:19860`), so `X-Forwarded-Proto` would decide it.

**The proxy never forwards `x-forwarded-proto`** — it is not on the request allowlist
(`proxy-headers.ts:14`) — and it connects over plain `http` to loopback, so Hermes always takes
the bare-name branch for proxied traffic. MSO adds the transport hardening back on the browser
side: `rewriteSetCookie()` (`proxy-headers.ts:112`) renames `hermes_session_at` →
`mapp_hermes_hermes_session_at`, drops `Domain`, forces `SameSite=Lax`, keeps `HttpOnly` and
`Max-Age`, pins `Path` (`/` root-mounted, the proxy prefix otherwise) and appends `Secure` when
the *browser's* hop was HTTPS (`isSecureRequest()`, `:128`).

Why the namespace matters concretely: the cockpit's own cookie is called `session`, and any of
Hermes' five could as easily have been named that. The rest of the rule — only `mapp_hermes_*`
travels up, no `authorization`, no `www-authenticate` back — is in
[MANAGED-APPS.md §5](./MANAGED-APPS.md).

**Login flow, as it actually runs in the frame:**

1. `GET /` → `302 /login?next=%2F`. The `next` is built by `_safe_next_target()`
   (`dashboard_auth/middleware.py:244`).
2. `/login` renders a username/password form plus **one inline `<script>`**
   (`login_page.py:412`). Hermes ships no CSP, so `'unsafe-inline'` in MSO's own policy is
   what keeps that script alive (§5).
3. Submit → `POST /auth/password-login` (JSON, `credentials: 'same-origin'`) → `200
   {"ok":true,"next":"<path>"}` + `Set-Cookie`.
4. `window.location.assign((data && data.next) || '/')` (`login_page.py:436`).

### The upstream quirk MSO works around

Hermes validates the post-login target twice, and **rejects every path under `/api/`**:

```python
# ~/.hermes/hermes-agent/hermes_cli/dashboard_auth/routes.py:561
def _validate_post_login_target(raw: str) -> str:
    ...
    if not decoded.startswith("/") or decoded.startswith("//"):
        return ""
    ...
    if decoded == "/api" or decoded.startswith("/api/"):
        return ""
    return decoded
```

with the same rule at `middleware.py:271` (inside `_safe_next_target`, `:244`) on the way in.
The upstream rationale is sound: a post-login redirect onto an API endpoint renders raw JSON,
and is indistinguishable from someone weaponising the redirect.

In **single-origin mode** the proxy mount is `/api/v1/managed-apps/hermes/proxy`, so that
rule refuses it: Hermes answers `next: "/"` no matter what the hidden field says, step 4
navigates the frame to the cockpit root, and the cockpit's own `frame-ancestors 'none'`
refuses to display it — an opaque, blank frame. `proxy-html.ts:63` still rebases the hidden
`next` field (correct for an upstream without that rule), and `reentryPath()`
(`feature-cli.ts:84`) is the actual rescue: it re-points the frame back onto the prefix, and
treats a bare `/` as the fallback it is by sending the window to its own route instead of
the dashboard home. Three escapes in a row raises a "stuck" panel rather than looping.

In **origin-split mode** — production — the mount is `/` on `hermes.mso.rahmanef.com`, `next`
is a plain path Hermes accepts, and the whole workaround is inert: `reentryTarget()` returns
`null` without touching `frame.contentWindow.location` (`feature-cli.ts:122`), which it must,
because that read throws cross-origin and a throw is the "it escaped" branch.

---

## 4. The dashboard's shape, and what works through the proxy

A Vite-built React SPA at `~/.hermes/hermes-agent/hermes_cli/web_dist`, served by uvicorn.
The shell is minimal and **root-absolute**:

```html
<script type="module" crossorigin src="/assets/index-CEmUNp2y.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-BbJ3HYO2.css">
```

- **No inline script in the SPA shell** (the only inline script is on `/login`).
- **No service worker** anywhere in `web_dist` — Hermes is not why the proxy refuses SW
  scripts (`route.ts:109`); OpenClaw is.
- Its stylesheet carries 10 root-absolute `url()`s (7 `/assets/*.woff2`, 3
  `/fonts-terminal/JetBrainsMono-*.woff2`), which is why `text/css` is rewritten too in
  single-origin mode (`proxy-html.ts:11`).

Root-mounted on `hermes.mso.rahmanef.com` those root-absolute URLs already resolve, so the
proxy rewrites the document **not at all** — no `<base href>`, no rebasing, no fetch shim,
nothing to hash-pin.

**What does not work:** anything on a socket. Hermes opens six WebSocket routes —
`/api/console` (`web_server.py:17667`), `/api/pty` (`:18017`), `/api/ws` (`:18204`),
`/api/pub` (`:18235`), `/api/events` (`:18263`), `/api/audio/speak-stream` (`:4533`). A Next
route handler cannot service an `Upgrade`, and the proxy is `fetch`-based, so the **Chat**
page loads its chrome and sits dead.

**Everything else is REST**, and Hermes' asset and cookie shape is fully carried by the proxy,
so the remaining 19 pages are expected to render. That expectation is *not* browser-verified
here: there are no integration tests in this subsystem
([MANAGED-APPS.md §8](./MANAGED-APPS.md)) and this pass verified the transport, not each paint.

Because only `chat` is socket-bound (`SOCKET_FEATURES.hermes = new Set(["chat"])`,
`feature-cli.ts:43`), Hermes features **default to the UI view** — `defaultView()` switches
to CLI only for an app whose every panel needs the socket. Chat opens on the UI with a
notice explaining why it is empty and a one-click switch to `hermes chat` in a real PTY.

Also inert in the frame, in either mode: new-window links. `allow-popups` is deliberately
absent from the sandbox (`feature-app.tsx:107`), so all six `window.open(` sites in the entry
chunk do nothing, and nothing is lost either way — four are the provider-OAuth hop
(`auth_url` / `verification_url`, across two duplicated code paths) whose callback is the
upstream's own `127.0.0.1` and unreachable from a browser regardless; two are a generic
"open this link in a new tab" helper, a destination for the user's own browser rather than
this frame. (`feature-app.tsx:99` says "2 call sites"; the measured count is six.) The window
says the clicks do nothing rather than letting them look broken.

---

## 5. Its own CSP and framing headers, and what the intersection does

Hermes **serves no policy at all**. `curl -sS -D- -o /dev/null http://127.0.0.1:9119/login`
returns exactly `HTTP/1.1 200`, `date`, `server: uvicorn`, `cache-control: no-store, no-cache,
must-revalidate`, `content-length: 10044`, `content-type: text/html; charset=utf-8` — nothing
else; `/` and `/health` answer a bare `302 Found` carrying only `date`, `server`,
`content-length` and `location`. (It has to be a GET: `/login` is `GET`-only and answers `405`
to `curl -sI`.) No `content-security-policy`, no `x-frame-options`, no `permissions-policy`
anywhere, so Hermes is framable as shipped and `contentSecurityPolicy()` (`proxy-csp.ts:214`)
has nothing to intersect — every directive stays as MSO wrote it. What the browser gets on
`hermes.mso.rahmanef.com`, computed from the live headers:

```
default-src H; script-src H 'unsafe-inline' blob:; style-src H 'unsafe-inline';
img-src H data: blob:; font-src H data: https:; media-src H data: blob:;
worker-src blob:; connect-src H data: blob:; frame-src H; form-action H;
base-uri H; frame-ancestors 'self' https://mso.rahmanef.com; object-src 'none'
        …where H = https://hermes.mso.rahmanef.com/
```

Three consequences specific to Hermes:

- **`'unsafe-inline'` in `script-src` is what keeps `/login` working.** Root-mounted, MSO
  injects nothing and therefore pins nothing (`proxy-csp.ts:233`), so the inline handler at
  `login_page.py:412` is covered only by `'unsafe-inline'`. This is safe *because* Hermes
  ships no policy; it is also the thing that would break first if it ever started shipping
  one (§7).
- **`img-src` loses `https:`** root-mounted. Hermes references no external image host at
  all, and the wildcard would have been a credentialed existence oracle over
  `OS_FS_READ_ROOTS` (the session cookie is `Domain`-widened to reach this host, so a
  `new Image().src = "<cockpit>/api/v1/fs/raw?path=…"` fires with it).
- **`fonts.googleapis.com` is refused.** The bundle references it once
  (`web_dist/assets/index-CEmUNp2y.js`), but `style-src` has no `https:` and Hermes declares
  no policy for the intersection to honour, so nothing grants it. Not silent: it is the one
  Hermes entry in `PROXY_BLOCKED_EXTERNALS` (`proxy-headers.ts:228`) and the window says
  *"Theme webfonts (Inter, IBM Plex, …) fall back to system faces."* `font-src` keeps `https:`
  — webfont *files* are CORS-anonymous, carry no cookie, and blocking them broke visibly.

`frame-ancestors` is always MSO's (`proxy-csp.ts:104`) — being framed by the cockpit is the
whole point. Live check, unauthenticated, so `401` is the success signal:

```
$ curl -sI https://hermes.mso.rahmanef.com/
HTTP/2 401
content-security-policy: default-src 'none'; frame-ancestors 'self' https://mso.rahmanef.com
x-middleware-rewrite: /api/v1/managed-apps/hermes/proxy
```

---

## 6. Feature discovery for Hermes

`discoverHermes()` (`features.ts:49`) reads Hermes' **own nav table** off disk, then splices
in its **own plugin manifests** over HTTP. Nothing is hardcoded as a feature.

1. Read `<dist>/index.html` and follow the `<script src="/assets/…js">` it names; if that
   fails, the newest `assets/index-*.js` (`features.ts:42`). `<dist>` is `HERMES_WEB_DIST`,
   else `<HERMES_HOME|~/.hermes>/hermes-agent/hermes_cli/web_dist`.
2. Parse the `{ path, labelKey?, label }` nav table (`parseHermesNavBundle`,
   `feature-parser.ts:64`). The regex keys on `path:` immediately followed by an optional
   `labelKey:` and then `label:` — property names, which survive minification. **18 entries
   today.**
3. Empty? Parse the route→component record in the same bundle (`:75`) — titles then come
   from the `key=label` table at `feature-parser.ts:7`. **17 entries today**, so this
   fallback is live and correct, just label-poorer.
4. Still empty? Parse `~/.hermes/hermes-agent/web/src/App.tsx` — a git install keeps the nav
   SSOT in TypeScript and the same shapes match. Present here, `path: "/sessions"` at
   line 165.
5. Splice plugin tabs from `GET /api/dashboard/plugins` — **public and unauthenticated**
   by upstream's own declaration (`public_paths.py:48`), so no credential is involved —
   honouring `position: before:/after:`, `override` and `hidden` exactly the way upstream's
   `buildNavItems()` does (`web/src/App.tsx:233` vs `feature-parser.ts:94`, including the
   "target not found → append" behaviour).

Live result, reproduced end to end: **18 built-ins + 2 plugin tabs = 20 features**, all
`available`.

- `nav-bundle` (18): `/chat` `/sessions` `/files` `/analytics` `/models` `/logs` `/cron`
  `/skills` `/plugins` `/mcp` `/channels` `/webhooks` `/pairing` `/profiles` `/config`
  `/env` (titled "Keys") `/system` `/docs` (titled "Documentation").
- `plugin-api` (2): `/achievements` spliced after `/analytics`, `/kanban` after `/skills`.
- Skipped on purpose (`feature-parser.ts:14`): `/` (a redirect) and `/profiles/new` (a form).

**The tripwire.** `checked()` (`feature-parser.ts:58`) accepts a run only if it has **≥ 5
entries and includes `/sessions`**; otherwise it discards the *whole* run. So a bundle
reshuffle that breaks the regex yields **zero** Hermes tiles, never a plausible-looking
partial list.

**Exact symptom when an upgrade breaks it:** the Hermes workspace keeps only the shared apps
(Terminal, Files, Assistant, Monitor, Settings) and every Hermes tile disappears from dock
and Launchpad. `/api/v1/managed-apps/hermes/features` still answers `200 {"features":[]}` —
a `503` only happens if discovery *throws*. The status card, the proxy and the CLI view are
unaffected, so the dashboard is still reachable via the Hermes app window. Results cache 60 s
(`features.ts:15`), so a fix or a new upstream nav entry appears within a minute; nothing
invalidates on upgrade.

**CLI view.** 13 of the 20 keys map to a verified read-only subcommand
(`feature-cli.ts:22`): `chat`, `sessions`, `logs`, `cron`, `skills`, `plugins`, `mcp`,
`pairing`, `kanban`, `config` → `config show`, `models` → `config get model`, `webhooks` →
`webhook`, `profiles` → `profile`. The other seven — `files`, `analytics`, `achievements`,
`channels`, `env`, `system`, `docs` — have **no `hermes` subcommand at all**, so the toggle
is simply absent rather than shelling something bogus. `models` maps to `config get model`
and not `hermes model` on purpose: bare `hermes model` is *"Interactively select your
inference provider and default model"* and saves the pick, so it would write on window open.

---

## 7. Upgrade and operational notes

Hermes updates itself: `hermes update` (and `hermes uninstall`). MSO has **no update
centre** — no check-update, channels, update, rollback or install wizard (see
[MANAGED-APPS.md §8](./MANAGED-APPS.md)). Nothing in MSO's action set writes upstream state,
which is why the current surface is safe. Pending on this host right now, per the public
`/api/status`: `can_update_hermes: true`, and `config_version: 28` against
`latest_config_version: 33` — a config migration Hermes wants (`hermes config migrate`).
MSO neither reports nor performs either.

**The dashboard unit never builds.** `--skip-build` means uvicorn serves whatever `web_dist`
the last build left ("Skipping web UI build (--skip-build); using dist at …" in its startup
log), so discovery reflects that dist and not the installed Python version. After a
`hermes update` that ships frontend changes, rebuild with Hermes' own tooling or the tiles
describe the previous release.

Re-check after any Hermes upgrade:

| Check | Why |
|---|---|
| tile count (open the Hermes workspace) | a nav-table reshape trips the tripwire → 0 tiles |
| `systemctl --user list-units '*hermes*'` | if `hermes-dashboard.service` is renamed, no configured unit is `loaded` any more and the card reads `not-installed` with no actions — a rename means a catalog edit |
| sign in inside an app window | see the CSP note below |
| `curl -s 127.0.0.1:9119/api/dashboard/plugins` | a new bundled plugin adds a tile automatically; `override`/`hidden` manifests are skipped |
| `ls …/web_dist/assets` | discovery follows `index.html`, so a new asset hash self-heals; a *missing* `index.html` falls back to the newest `index-*.js` |

**The one upgrade that would actually break the frame: Hermes starting to ship its own
CSP.** Today it ships none, so MSO's `script-src … 'unsafe-inline'` covers the inline login
handler. If a future release sent, say, `script-src 'self'`, the intersection would drop
`'unsafe-inline'` (nothing on the upstream side allows it) and — root-mounted — MSO pins no
hash of its own (`proxy-csp.ts:233`), so Hermes' *own* inline login script would be blocked
and the password form would stop submitting inside the frame. A release that instead ships
hashes for its inline scripts is fine: hashes are copied across (`proxy-csp.ts:190`), nonces
never are. Sign-in through the app window is therefore the smoke test after an upgrade, not
just "does the dashboard render".

**Known divergences from this integration, all upstream-neutral:**

- `hermes-gateway.service` is invisible to MSO. Messaging channel breakage shows up only in
  the dashboard's own Channels page or `hermes status`.
- `backup` runs but has no restore side (§2). To roll back, use `hermes import` or `cp -a`.
- `healthy: true` means "answers HTTP" (§2). For a real answer, read `/api/status`.
- `ManagedAppView.dashboardAvailable` is computed and no UI consumes it.

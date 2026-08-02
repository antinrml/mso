# Security Policy

Manef Shell OS is Public Alpha / Developer Preview software. It has not had a
third-party security audit. Only the latest commit on `main` is supported; there
are no release branches yet.

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities.

Use GitHub's private vulnerability reporting flow for this repository:

1. Open the repository on GitHub.
2. Go to **Security** → **Report a vulnerability**.
3. Include the affected version or commit, reproduction steps, impact, and any
   logs with secrets removed.

If private vulnerability reporting is unavailable, open a minimal public issue
asking the maintainer to enable private advisory intake. Do not include exploit
details, passwords, session secrets, API keys, private file contents, or full
environment files in that public issue.

## Deployment warning

An authenticated MSO session can run commands and access files as the Linux user
that owns the process. Treat it like SSH in a browser.

- Run MSO as a dedicated non-root user.
- Prefer Tailscale or another VPN for real deployments.
- If using a public domain, put HTTPS, firewall rules, and strict access control
  in front of the app.
- Do not expose the raw app port directly to the public internet.
- Do not commit `.env.local`, API keys, or data from `~/.os-vps`.
- Use demo mode (`NEXT_PUBLIC_OS_DEMO=1`) for public showcases.

## Managed applications and per-app origins

MSO can manage separate applications that already run on the box (Hermes, OpenClaw)
and frame each one's own dashboard in a window. Those apps keep their own runtime,
config, data and privileges; MSO talks to them through their CLIs, their HTTP surfaces
and systemd, and writes nothing into their state directories.

The dashboards are framed with `allow-same-origin`, because their SPAs do not boot
without it. On the cockpit's own origin that also made upstream JavaScript same-origin
**with the cockpit**, so it could take `window.top.fetch` and call `/api/v1/exec/run`
with the signed-in session. No Content-Security-Policy can prevent that: a policy binds
a realm, not a reference held across realms. Each dashboard is therefore served from its
own host on the same process (`hermes.os.<domain>`, `openclaw.os.<domain>`), which makes
`window.top` cross-origin and opaque. Middleware enforces the other half: on one of those
hosts **every** path is rewritten into that app's dashboard proxy (and `/_next/*` is refused
outright), so no cockpit route — not `/api/v1/exec/run`, not `/api/auth/*`, not a page — can
be reached there at all.

**This boundary is browser-realm only.** A plugin or extension installed into Hermes or
OpenClaw runs inside that daemon, with that daemon's privileges, and those daemons execute
shell commands on the host. Installing an untrusted plugin into either application is
handing it arbitrary code execution as the user that runs it. Separate origins do not
change that, and neither does anything else MSO can do.

Operational rules for anyone maintaining a split-origin deployment:

- **Never create a `*.os.<domain>` wildcard record, and never point a new
  `X.os.<domain>` name at the app port** without deciding what serves it. The session
  cookie is widened to that whole namespace. MSO 404s unknown names in the namespace as a
  backstop, but DNS is the primary control.
- **`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` and `OS_SESSION_COOKIE_DOMAIN` are one
  decision.** Set both or neither. The second alone widens the session cookie to every
  host under the domain while each of them still serves the full cockpit API.
- **`SameSite=Strict` keeps working only while the app hosts share the cockpit's
  registrable domain.** Moving one to a different domain makes those requests cross-site
  and the framed dashboard stops authenticating; that is a design change, not a config
  tweak.
- Leaving both variables unset is the default and is safe: MSO then serves no upstream
  dashboard at all, and the feature windows fall back to their CLI view. The old
  single-origin mode (dashboards under a path on the cockpit origin) has been removed —
  it handed upstream JS a realm holding your session, and no header could take it back.
- **MSO expects HTTPS** (or `localhost`). The session cookie is `Secure`, so a plain-http
  deployment on an IP cannot log in at all — that is deliberate, not a bug to work around.
- A managed-app **backup** copies that application's state directory into
  `~/.os-vps/backups/<app>/<timestamp>/`, including any credentials the application keeps there —
  `~/.openclaw/credentials/` and `identity/` are in scope, and so is anything secret in
  `openclaw.json` or under `~/.hermes`. Treat those copies exactly like the application's own
  config: never publish them, and include them when you rotate that application's secrets. The
  copy directory is created `0700` and the manifest `0600`, but nothing encrypts the contents.
  Symlinks are skipped rather than followed, so a link inside the state dir cannot pull bytes in
  from outside it, and a restore cannot be aimed outside the tree by an absolute link
  ([docs/MANAGED-APPS.md](./docs/MANAGED-APPS.md) §6).

## In scope

- Auth bypass: session forgery without `OS_SESSION_SECRET`, device-approval
  bypass, or rate-limit defeat that enables practical brute force.
- Filesystem jail escape: reading or writing outside `OS_FS_READ_ROOTS` /
  `OS_FS_WRITE_ROOTS`, or reaching denied credential material such as `.env*` or
  `~/.os-vps/*` through the file APIs.
- Unauthenticated access to live host routes such as `/api/v1/*`,
  `/api/assistant`, `/api/config`, or `/api/auth/devices`.
- CSRF or clickjacking that triggers host actions cross-origin.
- Escape from a managed-app origin: reaching any cockpit route, the cockpit realm, or a
  sibling managed app's origin from inside a framed dashboard on `hermes.os.<domain>` /
  `openclaw.os.<domain>`, or getting the proxy to fetch something other than its own
  loopback upstream.

## Out of scope

- An already-authenticated owner session doing documented owner actions such as
  running commands or accessing files within configured roots.
- Bypassing the destructive-command guard with shell tricks. It is an accident
  tripwire, not a sandbox.
- Deployments that ignore the minimum posture: non-root user, strong secrets,
  Tailscale/VPN or protected HTTPS, and narrow filesystem roots.
- What a plugin installed into Hermes or OpenClaw can do inside that daemon, including
  running host commands. That is the application's trust model, not MSO's boundary.
- Single-origin mode (`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` unset) behaving as
  documented: a framed dashboard's JavaScript can reach the cockpit realm there. Serving
  the dashboards from their own origins is the fix, and it is a deployment choice.

## Key rotation

BYOK AI credentials are stored server-side in `~/.os-vps/config.json`, never in
the client bundle. To rotate a key, stop MSO, edit the config file or remove the
provider from Settings → AI, then restart/sign in again.

To rotate auth secrets:

- Change `OS_SESSION_SECRET` and restart to invalidate sessions.
- Change `OS_LOGIN_PASSWORD` and restart to require the new password.
- Remove entries from `~/.os-vps/auth-devices.json` to revoke devices.

## Audit log retention

The JSONL audit trail defaults to `~/.os-vps/audit.log` and can grow over time.
Use logrotate or your normal host log retention system. Do not publish audit
logs without checking for private paths, command names, or other sensitive
context.

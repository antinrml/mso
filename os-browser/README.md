# os-browser — RETIRED sidecar, kept for its Playwright install

> **This is no longer the Browser app.** The Browser app is **Camoufox** — a real
> anti-fingerprinting Firefox on a headless X display, streamed in over noVNC and
> gated in `proxy.ts` by the same verified-session check that guards `/api/v1/exec`.
> Chromium-behind-a-screenshot could not get past sites that block automation, which
> is exactly why it was replaced.
>
> What that means concretely, as of **2026-08-03**:
> - The `os-browser` systemd unit is **stopped and `disable`d** — it does not start at boot.
> - The `/api/v1/browser/*` routes it proxied through **no longer exist**.
> - No app code calls it; the only mention left is a comment in `lib/agent/server.ts`
>   recording that the bridge was retired.
>
> **This directory is kept on purpose anyway**: `os-browser/node_modules` holds the
> repo's ONLY Playwright install, which `scripts/e2e` and desktop/mobile verification
> use. Deleting it breaks those until reinstalled. The service below still runs if you
> start it by hand — just never `enable` it.

A tiny HTTP wrapper around a REAL Playwright Chromium running on the VPS. One
persistent profile (`~/.mso/chrome-profile`) keeps logins across restarts.

## Run

```bash
npm install
npx playwright install chromium --with-deps   # system deps need sudo once

OS_BROWSER_SECRET=$(openssl rand -hex 16) node server.mjs
# listens on 127.0.0.1:4002 — it REFUSES to start without a secret (≥16 chars)
```

Then in the main app's `.env.local`:

```bash
OS_BROWSER_URL=http://127.0.0.1:4002
OS_BROWSER_SECRET=<the same secret>
```

## Env

| Var | Default | Purpose |
|---|---|---|
| `OS_BROWSER_SECRET` | — (required, ≥16) | Shared secret; never reaches the client |
| `OS_BROWSER_PORT` | `4002` | Listen port |
| `OS_BROWSER_HOST` | `127.0.0.1` | **Keep loopback.** Override only behind a private bridge |
| `OS_BROWSER_PROFILE` | `~/.mso/chrome-profile` | Persistent browser profile dir |

## Security

Loopback + shared secret, by design. Never expose :4002 publicly — the
service will navigate anywhere and holds logged-in sessions in its profile.
Firewall it; see [docs/INSTALL.md](../docs/INSTALL.md#6-optional--the-remote-browser-app-os-browser).

---
name: mso-camoufox
description: Drive the Camoufox anti-detection browser that MSO hosts — power the VNC session on/off, get the noVNC URL and one-time password, restore/snapshot the logged-in profile, and reach sites that block headless automation. Trigger on /mso-camoufox, "camoufox", "anti-detection browser", "real firefox on the vps", "the browser that beats cloudflare", "vnc browser", "novnc session".
---

# /mso-camoufox — the real-Firefox browser MSO hosts

Camoufox is a hardened Firefox build with anti-fingerprinting patches. MSO runs it
on a headless X display and exposes the live screen over noVNC, so it is a browser
you *watch and click*, not a headless scraper. Use it when a site blocks the plain
headless browser (Cloudflare, DataDome, LinkedIn, anything that fingerprints).

**Camoufox IS the Browser app.** It replaced both the Playwright sidecar
(`os-browser`, `:4002` — deleted 2026-08-10) and the
sandboxed-iframe browser that briefly followed it, because X-Frame-Options makes an
iframe unable to render most of the real web.

## Power it from the CLI

```bash
mso camoufox status    # {installed, running, enabled}
mso camoufox start     # systemctl --user start camoufox-vnc.service
mso camoufox stop
mso camoufox session   # {password: "…"} — the one-time noVNC password
```

`start`/`stop` go through `/api/v1/camoufox/service`, which shells
`systemctl --user` — no sudo, no polkit rule. `installed:false` means the unit
file is missing, not that the browser is off.

## Watch / drive the screen

Once running, the live screen is proxied by MSO itself:

```
https://mso.rahmanef.com/camoufox-vnc/#password=<from `mso camoufox session`>
```

`proxy.ts` rewrites `/camoufox-vnc/*` to the local websockify on `127.0.0.1:6080`
(loopback-checked) behind the SAME verified-session check that guards
`/api/v1/exec`. Nothing about camoufox is exposed on a public port.

**The password goes in the URL fragment, never the query string** — a fragment is
not sent to the server and does not land in access logs or `Referer`.

Inside MSO the same thing is the **Browser** app's Camoufox tab.

## What the unit actually starts

`scripts/camoufox-vnc-service` (a *user* unit, `~/.config/systemd/user/camoufox-vnc.service`):

| piece | default | env override |
|---|---|---|
| X display | `:92` @ `1440x920x24` | `CAMOUFOX_DISPLAY_NUM`, `CAMOUFOX_GEOMETRY` |
| VNC / noVNC ports | `5902` / `6080` | `CAMOUFOX_VNC_PORT`, `CAMOUFOX_NOVNC_PORT` |
| profile | `~/.local/share/camoufox/profiles/linkedin` (chmod 700) | `CAMOUFOX_PROFILE` |
| browser binary | `~/.cache/camoufox/browsers/official/…/camoufox` | `CAMOUFOX_BROWSER` |
| start URL | none (restores last session) | `CAMOUFOX_START_URL` |
| VNC password file | `~/.vnc/passwd` | `CAMOUFOX_VNC_PASSWD` |

Also runs `matchbox-window-manager` so windows have no titlebar and fill the display.

## The profile is the valuable part — and the crown jewels

The profile holds a **live Google session** (`SID`, `__Secure-1PSID`, `SAPISID`) and
LinkedIn's `li_at`. Stealing those cookies is account takeover with no password and no
2FA prompt. So the unit re-`chmod 700`s the profile on every start (Firefox writes
`cookies.sqlite` 0644) and snapshots `cookies.sqlite*`, `key4.db`, `cert9.db` into
`~/.local/state/camoufox/session-backup/` — 3 generations, 0700.

Never `mso cat` or paste the profile contents anywhere.

To restore a broken session:

```bash
mso camoufox stop
mso exec 'cp -p ~/.local/state/camoufox/session-backup/1/* ~/.local/share/camoufox/profiles/linkedin/'
mso camoufox start
```

Use a separate profile per identity (`CAMOUFOX_PROFILE=…`) rather than logging one
profile in and out — the anti-detection value comes from a profile that looks aged.

## Gotchas

- **`enabled:false` is REQUIRED, not an accident.** The unit ships `disabled` with
  `Restart=no` + `RuntimeMaxSec=2h`. Power is plain `start`/`stop` — never
  `enable --now`, or every click re-arms boot autostart (that is how it once ran 26h
  with zero viewers). And a 2h lease under `Restart=always` is a 2-hourly reboot loop:
  ship `Restart=no` and the lease together or neither.
- **`CAMOUFOX_PROFILE` must point at `~/.local/share/…`, not `~/.cache/…`.** A wrong
  path makes `mkdir -p` create an empty profile with no error — you get a
  logged-out browser and no clue why.
- **The unit exists only on the host.** There is no copy or installer for it in the
  repo beyond `scripts/camoufox-vnc-service`; `loginctl enable-linger rahman` and the
  `user-bus.conf` drop-in have to be set up by hand.
- **Needs a user bus.** MSO reaches `systemctl --user` only because
  `mso.service.d/user-bus.conf` sets `XDG_RUNTIME_DIR=/run/user/1001` and rahman has
  `loginctl enable-linger`. If start fails with "Failed to connect to bus", that
  drop-in or the linger is gone — not a camoufox problem.
- **It is heavy.** Xvfb + Firefox + websockify. Check `mso stats` before starting it
  on a loaded box, and stop it when you are done.
- **Authorized use only.** Anti-detection browsing is for sites you have a right to
  access — your own accounts, your own tenants. Do not use it to evade a block that
  is telling you no.

## Related

- `/mso` — the CLI and everything else on the host
  `scripts/e2e` for screenshots
- `skills/camoufox-browse` (bundled in MSO's own catalog) — the scripting-level
  Camoufox skill for the in-app assistant, from ClawHub

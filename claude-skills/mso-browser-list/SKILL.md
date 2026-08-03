---
name: mso-browser-list
description: The RETIRED os-browser Playwright sidecar, kept only as dev tooling for e2e/desktop verification — its systemd unit is stopped and disabled, and the mso Browser app does NOT use it. For the actual Browser app use /mso-camoufox. Trigger on /mso-browser-list, "os-browser sidecar", "playwright install for e2e", "start the headless chromium service". Do NOT trigger on "why doesn't the browser work" or "browser status" — those mean Camoufox.
---

# /mso-browser-list — os-browser sidecar deep check

> ## ⚠️ This is NOT the Browser app any more
>
> The **Browser app is Camoufox** — a real anti-fingerprinting Firefox on a headless
> X display, streamed in over noVNC. Use **[/mso-camoufox]** for it.
>
> The `os-browser` Playwright sidecar described below was **retired**, and on
> **2026-08-03 its systemd unit was stopped and `disable`d** — it no longer starts at
> boot and nothing in the mso app calls it (the only remaining mentions in the code
> are comments saying it was removed). Do **not** `systemctl restart os-browser` to
> "fix the Browser"; that starts a service the app does not use.
>
> The `os-browser/` directory stays in the repo on purpose as **dev tooling** — it
> holds the repo's only Playwright install, which `scripts/e2e` and desktop/mobile
> verification use. This skill is still valid for driving THAT, if you start the
> service by hand (`sudo systemctl start os-browser`). It is not a user-facing feature.

The sidecar is a **real headless Chromium** (Playwright) on the host as systemd
`os-browser` (loopback :4002, persistent context = cookies/cache/session on disk).
Renders ANY site — no X-Frame-Options/CSP problem. Companion to [/mso] and [/mso-list].

## 1. Live check (run first)

```bash
node ~/.claude/skills/mso-browser-list/browser-check.js
```
Navigates several sites via the service and reports title + screenshot bytes +
text length. If the service is DOWN that is now the DEFAULT (see the banner) — `sudo systemctl start os-browser` to run these checks, and stop it again after.

## 2. Drive it from CLI

`~/.claude/skills/mso/browser.sh` still exists, but it talks to `/api/v1/browser/*`,
and **those routes were deleted with the sidecar** — `app/api/v1/` today is
`apps camoufox editor exec fs managed-apps stock sys term`. So the CLI path below is
DEAD until/unless someone re-adds the routes. Talk to the service directly instead:

```bash
sudo systemctl start os-browser                     # it is disabled; start by hand
curl -s -H "x-os-browser-secret: $(grep -oP '(?<=^OS_BROWSER_SECRET=).*' \
  /home/rahman/projects/mso/os-browser/.env)" \
  -X POST 127.0.0.1:4002/goto -d '{"url":"https://example.com"}'
sudo systemctl stop os-browser                      # leave it off
```

## 3. What still works, and what does not

| | Status |
|---|---|
| The service itself (Playwright Chromium, loopback :4002, secret-gated) | works when started by hand |
| `os-browser/node_modules/playwright` — the repo's ONLY Playwright | works; this is why the dir is kept |
| `scripts/e2e` + desktop/mobile verification | works (uses the Playwright install, not the service) |
| mso Browser app rendering through it | **gone** — the app is Camoufox now |
| `/api/v1/browser/*` routes | **deleted** |
| `OS_BROWSER_URL` / `OS_BROWSER_SECRET` wired into the app | **gone** — the only mention left in app code is a comment in `lib/agent/server.ts` saying it was retired |
| Bookmarks / AI Inspector / omnibar for it | **gone** with the app integration |

## 4. Architecture (what is left)

```
you ──secret──▶ 127.0.0.1:4002   (systemd os-browser, DISABLED — start by hand)
                     └ Playwright Chromium, one persistent context
```
Service secret: `/home/rahman/projects/mso/os-browser/.env`.
Code: `/home/rahman/projects/mso/os-browser/server.mjs`.
Prod is **systemd on this box, not Dokploy** — ignore any `172.18.0.1` /
docker-bridge address in older notes; that was the Dokploy era.

## 5. Known limits

- One shared page (single context) — no multi-tab.
- Chromium only. It is exactly what could NOT render sites that block automation,
  which is why the Browser app moved to Camoufox.

## 6. If something is "broken"

1. **Is this even the right skill?** If the user means the Browser app in mso, it is
   Camoufox → use [/mso-camoufox]. This skill cannot help with that.
2. Service not running → expected, it is `disable`d. `sudo systemctl start os-browser`
   for a one-off. **Never `enable` it** — that re-arms boot autostart.
3. e2e/Playwright failing → check `os-browser/node_modules/playwright` exists; the
   service does not need to be running for that.

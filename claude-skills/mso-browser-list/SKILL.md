---
name: mso-browser-list
description: Status of the mso Browser — a REAL headless Chromium (Playwright) on the VPS. List its functions, check the service renders real sites, and how to drive it from CLI. Trigger on /mso-browser-list, "browser functions", "why doesn't the browser work", "check the os browser", "browser status", "test the browser", "screenshot the browser".
---

# /mso-browser-list — Browser app deep check

The Browser is a **real headless Chromium** (Playwright) running on the host as
systemd `os-browser` (loopback :4002, persistent context = cookies/cache/session
on disk). The mso app shows live screenshots + sends clicks/keys; the CLI drives
the SAME session. Renders ANY site — no X-Frame-Options/CSP problem. Companion to
[/mso] and [/mso-list].

## 1. Live check (run first)

```bash
node ~/.claude/skills/mso-browser-list/browser-check.js
```
Navigates several sites via the service and reports title + screenshot bytes +
text length. If the service is DOWN: `sudo systemctl status os-browser`.

## 2. Drive it from CLI (you can SEE the page)

```bash
SH=/home/rahman/.claude/skills/mso/browser.sh
$SH go <url> ; $SH shot /tmp/b.png   # then Read /tmp/b.png to view
$SH content ; $SH click X Y ; $SH type "…" ; $SH key Enter ; $SH scroll 600
```

## 3. Browser functions

| Function | How | Status |
|---|---|---|
| Navigate (omnibar) | POST `/api/v1/browser/navigate` → service `goto` | works (any site) |
| Render | live screenshot `<img>` from `/api/v1/browser/screenshot` | works |
| Click / type / key / scroll | mouse/keyboard mapped to 1280×800 viewport | works |
| Back / Forward / Reload | service history | works |
| Bookmarks / history | localStorage | works |
| Persistent session/cache | Playwright `launchPersistentContext(~/.mso/chrome-profile)` | works — logins stick |
| AI Inspector (browser) | url/title + actions + scoped chat | works (chat needs key) |
| CLI access (screenshot/content/drive) | `browser.sh` + the service API | works |

## 4. Architecture

```
mso Browser app  ──Bearer──▶  /api/v1/browser/*  ──secret──▶  172.18.0.1:4002
CLI (browser.sh) ──secret──▶  127.0.0.1:4002        (systemd os-browser)
                                   └ Playwright Chromium, 1 persistent context (shared session)
```
Env (Dokploy mso): `OS_BROWSER_URL=http://172.18.0.1:4002`, `OS_BROWSER_SECRET`.
Service secret: `/home/rahman/projects/os-browser/.env`. Code: `…/os-browser/server.mjs`.

## 5. Known limits

- **One shared page** (single context) — the web app + CLI share ONE browser tab.
  Multi-tab would need multiple pages/contexts (future).
- Screenshot view is interactive via click-mapping, not native scrolling — use the
  scroll action. Video/canvas update only on screenshot refresh.
- Heavy/slow pages: increase the refresh poll if a load is still settling.

## 6. If blank / not working

1. `node ~/.claude/skills/mso-browser-list/browser-check.js` — is the service up + rendering?
2. Service down → `sudo systemctl restart os-browser` (check chromium/deps).
3. Web app blank but service OK → `OS_BROWSER_URL`/`OS_BROWSER_SECRET` not set in the
   Dokploy env, or container can't reach `172.18.0.1:4002` (ufw on docker_gwbridge).
4. "Establishing session…" → not signed in / token expired.

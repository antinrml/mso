# mso — Progress Log

Running log of what shipped each phase. Newest at top.

> **Architecture note:** Phases 0–14 below were built on **Convex self-hosted +
> a Control-Room host-agent bridge**. That stack was **removed** in Phase 15 —
> mso is now a self-contained Next.js app (`lib/host` + signed-cookie auth).
> Read those phases as history. **This file is the source of truth for what exists** —
> `ARCHITECTURE.md` is no longer maintained and carries a stale-warning banner.

## 2026-08-04 — every `border-<color>` utility in the app was dead, and that is why Android had no visible Back (DONE)

Started from a user report — "stuck in the Android shell, there is no back button, and
the mobile back affordance is hidden generally". Both turned out to share one root cause
that had nothing to do with the shells.

**`app/globals.css` overrode every border-colour utility in the codebase.** The line
`* { box-sizing: border-box; border-color: var(--color-border); }` sat **outside any
`@layer`**, and unlayered CSS beats every layered rule in the cascade. Tailwind 4 emits
all utilities into layers, so that single `*` selector silently won against all of them.
Measured in the live page before the fix — `border-red-500`, `border-primary` and
`border-foreground/70` all computed to `rgba(0,0,0,0.1)`, byte-identical to an element
with no class at all. **64 usages across 48 files**, including 15 `border-primary`
selection states, 10 `border-destructive/*` danger states and 6 `border-ring`. Wrapping
the rule in `@layer base` fixes all of them at once; `box-sizing` moved with it because
`box-border`/`box-content` were subject to the same trap. After: `border-primary` →
`rgb(31,109,240)`. A visible side effect on the desktop shell: the CPU meter bar in the
Today widget now renders — it had been drawing its fill in the default 10% grey.

**The Android NavBar was transparent, so Back/Home/Recents were invisible.** The row
carried `text-foreground` with no background of its own, and the Android wallpaper is
dark — dark-on-dark. It now carries `bg-background/80 backdrop-blur-xl border-t`, which
restores the token contract (background and foreground are a legible pair by
construction, whatever the theme). Home/Recents switched from `border-foreground/70` to
`border-current` so an outline always follows its own button's colour; the back chevron
went `size-5` → `size-6`. Measured after: scrim `oklab(0.968…/0.8)`, icon `rgb(28,28,31)`
— roughly 15:1. The 48×48 targets were already correct; nothing was ever missing, it was
unreadable.

On standardising the two mobile shells: iOS exits an app with a labelled blue **"Done"**
top-right, Android with the bottom NavBar back. Those are the correct platform metaphors
and were deliberately kept — the actual defect was that one of the two could not be seen.
Both are now visible, labelled, and ≥44 px.

## 2026-08-03 (UX) — a real browser pass, a demo instance back, and I broke prod proving it (DONE)

First pass that opened the product in a browser instead of reading the code. Also the
first time this session damaged production, so that first.

**I broke :4005, with the exact hazard I had documented hours earlier.** Measuring bundle
output meant running `bun run build` twice in the prod checkout with no restart after.
`next build` wipes `distDir` first, so the running server was serving 500s with
`Content-Type: text/plain` for its own chunks and the browser refused to execute them.
Fixed by a restart; smoke green after. Two lessons worth more than the measurement:
`scripts/verify-build.sh` exists precisely for this and I did not use it, and **a broken
deploy silently corrupts whatever you are measuring** — see the retraction below.

**RETRACTED: "the mobile-first product renders the desktop shell on phones."** I reported
`data-shell=macos` at 390px, 412px and on a real iPhone UA, with a screenshot of a macOS
menu bar on a phone-sized viewport. It was entirely an artifact of the breakage above:
React never hydrated (its chunks were refused), so the effect that computes responsive
state never ran and the deliberate SSR default — desktop — stayed on screen. After the
restart: **390px → `ios`, 412px → `ios`, 1280px → `macos`, zero horizontal overflow.**
Responsive shell selection works correctly. Nothing was wrong.

**Measured on a healthy prod** (Playwright, `os-browser/node_modules`):

| | desktop 1280 | mobile 390 |
|---|---|---|
| LCP | 380 ms | 160 ms |
| CLS | 0.008 | 0 |
| TTFB | 24 ms | 20 ms |
| transfer / requests | 194 KB / 29 | 231 KB / 30 |

Against a 2500 ms "good" LCP threshold there is nothing meaningful left to win here.

**Fixed: 4 touch targets under the WCAG 2.5.8 24×24 floor, all on mobile** — the three
iOS home-screen page dots were 19×19 (`p-1.5` around a 7px dot) and the home indicator
was 17px tall. Both got a `min-h`/`min-w` floor; the dot and the 134px bar are visually
unchanged, only the hit area grew. Mobile now reports one "tiny" control and it is the
`sr-only` skip link, which is 1×1 by design and expands on focus.

**A11y came back stronger than expected**, recorded so nobody re-audits it: 77 icon
buttons, **zero** without an accessible name; the skip link exists and its
`#main-content` target resolves; the Launchpad overlay is both `inert` and
`aria-hidden`, so its 16 app links are correctly out of the tab order (a naive
`querySelectorAll` sweep counts them as unnamed — mine did, wrongly);
`prefers-reduced-motion` collapses durations to 1ms rather than 0 so `animationend`
still fires. Two of my own grep-based claims were wrong and the browser corrected both.

**`mso-demo.service` is back**, :4006, loopback-only — see CLAUDE.md. Demo mode disables
login, so a public bind would publish an unauthenticated shell; mock-data-only keeps the
blast radius small but exposing it stays the owner's call.

**Hardening:** `/etc/logrotate.d/mso-audit` now rotates `~/.mso/audit.log` (weekly, 5 MB
cap, 8 generations, `su rahman rahman` since the file is 0600). Growth is only ~88 KB/mo
today, but it is append-only with no cap in code and this box serves prod.

**STILL OPEN — React hydration error #418**, reproducible on BOTH mobile and desktop with
clean localStorage, so it is not the theme-restore inline script. A hydration mismatch
makes React discard and re-render the tree client-side. Identifying the offending node
needs a non-minified dev build; not chased here rather than guessed at.

## 2026-08-03 (docs) — reconciling every live doc against what the box actually does (DONE)

A sweep for claims that had quietly become false. History files (`AUDIT-*`,
`SCORECARD-*`, dated plans, this log's older entries) were left alone on purpose —
they describe what was true then. Only *live instructional* docs were touched.

What was actually wrong:

- **`.env.example` was missing 6 settable vars.** Reconciled against `process.env` in
  code: `CAMOUFOX_NOVNC_URL`, `CAMOUFOX_VNC_PASSWD_TEXT`, `OS_MEMORY_STORE`,
  `OS_THREADS_DIR`, `NEXT_PUBLIC_COMMIT_SHA`, `NEXT_DEPLOYMENT_ID`. CLAUDE.md's
  standing caveat ("it is missing several… grep `process.env`") is now a precise list
  of what stays out and why: framework-injected (`NEXT_RUNTIME`,
  `NEXT_PUBLIC_BUILD_ID`), systemd's (`NOTIFY_SOCKET`, `WATCHDOG_USEC`), the OS's
  (`PATH`, `SHELL`), test-only (`E2E_BASE_URL`, `OPENCLAW_HOME`), and `OS_BROWSER_*`,
  which belong to the retired sidecar rather than this app.
- **`CONTRIBUTING.md` told contributors to run `scripts/check-slices.mjs`** — deleted
  earlier the same day — and claimed "280+ tests" (1136). Its checklist now matches the
  four guards that really run, and warns that the hook is untracked and that
  `--skip build` is deliberate.
- **The `/mso-browser-list` skill was the worst offender.** It described `os-browser` as
  *the* Browser app, triggered on "why doesn't the browser work" and "browser status",
  and told the reader to `systemctl restart os-browser`. All false: the Browser app is
  Camoufox, the unit is stopped + `disable`d, `/api/v1/browser/*` was deleted, the
  `OS_BROWSER_URL`/`172.18.0.1` wiring is Dokploy-era (prod is systemd), and its `.env`
  path pointed at `~/projects/os-browser` instead of `~/projects/mso/os-browser`.
  Rewritten, and its `description` now explicitly routes those trigger phrases to
  `/mso-camoufox`. `browser-check.js` printed the same dead architecture line; fixed.
- **`CLAUDE.md` documented a demo that does not exist** — no `mso-demo.service`, no
  `/home/rahman/projects/mso-demo`. The `NEXT_PUBLIC_OS_DEMO=1` flag is still real; the
  second checkout and :4006 unit are not. Its verification recipe also said to drive the
  demo "via os-browser", which is doubly gone — now points at Playwright directly.
- **`docs/SLICE-CATALOG.md` listed 20 slices; there are 21** (`docs` was missing).
- `docs/FAQ.md` still advertised "280+ vitest tests" and only two audit passes.
- `os-browser/README.md` opened "headless Chromium service for the Browser app".

Every claim written in this pass was checked against the box rather than assumed —
including one of my own: I wrote "four guards" and the hook has five `# Guard` lines.
Four run; the fifth is a Convex auto-deploy that no-ops here because there is no
`convex/` dir. Said so rather than rounding.

## 2026-08-03 (later) — the two open items closed, and the health lens finds a silent way to lose the device allowlist (DONE)

Clearing both items the entry below left open.

**Three of the four `rm -rf /` bypasses are closed.** The patterns anchor the catastrophic
argument on `\s`, `$` or `*`, so a `/` followed by `;`, `)` or `"` walked straight past them.
Rather than widen each regex — which leaks a new way in for every character you forget —
`matchDestructive` now splits the command on shell separators (`[;&|()"'\`\n]+`) and tests
each segment, so `echo hi; rm -rf /`, `(rm -rf /) &`, `bash -c "rm -rf /"` and
`echo $(rm -rf /)` all land on a segment where the trailing `/` sits at end-of-string.
**Ordering inside that function is load-bearing and pinned by a test:** the whole string is
tested BEFORE the segments, because the fork-bomb pattern is built out of `(){}|&;:` — the
very characters being split on — so segment-only testing would silently stop detecting it.

The fourth (`HOME=/ rm -rf "$HOME"`) stays an `it.fails()`: the destructive argument only
exists after the shell expands the variable, which no static filter can see. Expected-fails
went 4 → 1 and the suite turns red if that ever starts being caught.

Accepted cost, pinned as its own test: quoted prose is now refused too —
`git commit -m "never run rm -rf / on prod"` is indistinguishable from
`bash -c "rm -rf /"` except by program name. Erring toward refusal; the escape hatch is
`OS_EXEC_ALLOW_DESTRUCTIVE=1`. Ordinary commands (`ls -la /`, `cd / && ls`, `find / -name x`,
`systemctl status mso`) were checked and still pass.

**The health lens (the one that died) found a real data-loss path.**
`lib/auth/device-store.ts`'s `read()` returned an empty store for EVERY failure — and it
feeds a read-modify-write whose callers `recordPending` and `approveDevice` write
unconditionally. So one unparseable byte in `~/.mso/auth-devices.json` meant the next login
attempt from an unapproved device read "no devices", then **persisted that** — wiping every
approved device and locking the owner out of their own host. `recordPending` is reachable
from the internet by anyone holding the password. Now only `ENOENT` (legit first run) yields
an empty store; corrupt JSON or EACCES throws. Costs a 500 on login; the old behaviour cost
the allowlist. `device-store.test.ts` is new (it had none) and its two key cases were
verified to fail against the old code.

**`lib/host/fs-upload.ts` had zero tests** despite being a write boundary behind
`/api/v1/fs/upload`. `fs-upload.test.ts` now pins the two things that matter: a part cannot
escape the destination (parent/deep/mid-path traversal, absolute paths, segment-only inputs)
and the 100 MiB cap stops bytes reaching disk, leaving no `.tmp` behind.

**The rest of the health lens came back clean**, and it is worth recording so nobody re-runs
it: 1 `@ts-expect-error` in total (in a test, justified), **zero** real `any` in non-test code,
1 empty `catch` (the inline theme script in `app/layout.tsx`, where a corrupt localStorage
must not block render), and 21 files with `eslint-disable` — all narrow, single-rule, and
carrying a reason. No secret has ever been committed: the two `OS_SESSION_SECRET=` hits in
git history are `$(openssl …)`, `$SECRET` and a regex, not values. `exec.ts` is NOT untested
as a filename scan suggests — `exec-filter.test.ts` covers it.

1136 tests / 115 files (was 1115 / 113).

## 2026-08-03 — pnpm→bun, a 5-lens audit, and the gates that were never actually gating (DONE)

Four commits: `268747f` (bun + audit fixes), `844eef3` (−836 lines), `674455b` (dependency
+ build gates, sharp CVE), `c201e8f` (cleanup). All live on :4005 and pushed.

**bun replaces pnpm as the installer — the runtime did NOT move.** `bun.lock` is committed,
`pnpm-lock.yaml` is gone, `.nvmrc`/`engines.node` still pin Node 22, and prod's `ExecStart`
is still `/usr/bin/npm run start`. `next`/`tsc`/`eslint`/`vitest` carry `#!/usr/bin/env node`
shebangs and `bun run` honours them, so every tool still executes under Node. Measured, not
assumed: install warm 3.5 s → 2.6 s (marginal), script startup **318 ms → 8 ms** (the actual
win — `verify` chains four). `pnpm.onlyBuiltDependencies` → `trustedDependencies`,
`pnpm.overrides` → `overrides`. Two traps now documented in CLAUDE.md and DEVELOPMENT.md:
`bun test` silently shadows the `test` script and exits 0 having run nothing, and `bunx`
downloads-and-runs a missing package (so `post-deploy-smoke.sh` calls
`node_modules/.bin/vitest` directly, never `bunx`).

**A 5-lens audit ran; the 5th lens died and its ground was never covered.** Lenses:
over-engineering, security, Next16/React19, bun blast-radius, repo health. Each finding was
handed to an adversarial verifier told to refute it. The **repo-health lens hit a
StructuredOutput retry cap and returned nothing** — so test-coverage reality, error
swallowing, eslint gaps and TypeScript escapes remain **unaudited**. The security core came
back clean under four separate attempts: all 51 routes `verifyAuth` first, path bounds
realpath before checking, and the CSRF gate in `proxy.ts` is not spoofable.

**The largest real cost was one line.** `next.config.mjs` is evaluated **twice** (once by
`next build`, once when `next start` boots), so a `Date.now()` `deploymentId` fallback
emitted two different `?dpl=` values for the same chunk — the HTML referenced both and the
browser downloaded, parsed and executed ~160 KB gzip of entry chunks **twice on every cold
load**. Confirmed live, now zero `?dpl=`. Note the key must be **absent**, not `undefined`:
`undefined` still emits an empty `?dpl=`, which leaves `chunk.js` and `chunk.js?dpl=` as two
distinct URLs and the double download intact. `env: { NEXT_PUBLIC_BUILD_ID }` is unaffected —
`env` is inlined at build time for server *and* client, which is why it never had this bug.

Other perf: System Monitor (1.5 s) and Managed Apps (10 s) polled with no visibility gate, so
a backgrounded tab spent host CPU forever; the menu-bar CPU chip ran a *second* poller against
the endpoint the shared store already polled (~55 → ~20 req/min); `hermes --version` (0.44 s
CPU) re-forked every 10 s, now cached 60 s and dropped on any lifecycle action; xterm left the
entry chunk (340 → 334 KB gzip) — `os-terminal/index.ts` eagerly re-exported the module it
also code-split, and `shell.manifest.ts` imports that barrel eagerly.

**Security fixed:** the Camoufox profile (live Google `SID`/`__Secure-1PSID`/`SAPISID` +
LinkedIn `li_at`) and `~/.vnc` were readable through `fs/read` and `fs/zip` — absent from
`SENSITIVE_HOME` while `OS_FS_READ_ROOTS` is `~`; four live session cookie jars sat `0664` at
derivable `/tmp` paths (code fixed *and* the existing files chmod'd); a **distributed** login
lockout where six IPs inside their own 5/min allowance filled the 30/min global budget and the
owner's *correct* password then got 429 — the global budget is now charged only by a failed
password compare, with a regression test verified to fail on the old code; `~/.mso` now created
`mode: 0o700`; the CLI login body moved from argv to stdin.

**−836 net lines.** 20 `slice.json` + `check-slices.mjs` (604 lines; one consumer validating 3
of 12 fields, and `docs/AUDIT-2026-06-11` had already flagged 8 as describing a Convex auth
this app does not have), `layouts.ts` (a strict subset of `profiles.ts`), two `CredentialStore`
impls, `useBadges`/`useProfiles`, three documented-but-unread `ShellManifest`/`Brand`/
`FeatureDescriptor` fields, three image-editor barrel re-exports, and `makeDragProps` — the
*producing* half of the DnD seam, which had no callers, meaning nothing ever wrote `DND_MIME`
and the receiving half was unreachable. `os-browser.service` (retired sidecar, 135 MB, still
autostarting) stopped + disabled; the directory stays as the repo's only Playwright.

**The gates were theatre; now they are not.** Three discoveries, in order of how badly each was
believed:
1. `bun audit` had **never been run**. First run found sharp <0.35.0 HIGH (libvips
   CVE-2026-33327/33328/35590/35591) sitting transitively under next. next@16.2.12 pins
   `^0.34.5` and has **no fixed release** — only canary moved — so `overrides` is the only fix.
   sharp 0.35.3, libvips 8.17.3 → 8.18.3, `/_next/image` still 200. sharp 0.35 also removed its
   install script, so `bun pm untrusted` is now **two** entries, not three.
2. Adding `audit` to `verify` **gates nothing**: sc-git's `ci.js` has a hardcoded
   `STEPS = ['typecheck','lint','test','build']` and never invokes `verify`. The real gate had
   to go in `.git/hooks/pre-push`.
3. **"Just remove `--skip build`" would have been an outage on every push.** `ci.js` builds in
   `process.cwd()`, which for the hook *is* `mso.service`'s WorkingDirectory, and `next build`
   deletes everything in `distDir` except `/^(cache|dev|lock)/` as its first act — and repeat
   builds rename every chunk and mint a new `BUILD_ID`, so already-served HTML stays broken
   afterwards too. `--skip build` is load-bearing safety. `scripts/verify-build.sh` builds a
   throwaway copy of HEAD in `mktemp` instead; `node_modules` is **copied, not symlinked**
   (Turbopack hard-fails on a symlink pointing outside the filesystem root) and `.env.local` is
   deliberately not copied, so no secret lands in `/tmp`.

`scripts/audit.mjs` exists because `bun audit` **fails closed** — offline it exits 1, the same
code as a real advisory — so wired raw into a hook every network blip becomes a fake security
failure. The wrapper treats empty stdout as "unreachable, skip"; CI keeps the raw fail-closed
command on purpose, because a release gate must not pass an audit it could not perform. Also:
`--json` silently ignores both `--audit-level` and `--ignore`, and bun's JSON carries only an
opaque numeric id, so the readable GHSA is parsed out of the advisory URL.

**Also fixed: the post-deploy gate was half dead.** `scripts/e2e/smoke.test.ts` probed
`/api/version` and `/api/v1/sys/cpu` — **neither ever existed in this repo** (no git history for
either path). It had been asserting `404 == 200` since it was written, which is exactly how a
gate stops being run. Repointed at `/api/health` + `/api/v1/sys/stats`; 4/4 green.

Push now costs ~70 s (was ~47 s) and prints `audit: clean at high/critical.` +
`build: HEAD compiles (out-of-tree).` — **if those two lines are missing, the wiring is gone.**
The hook is untracked, so an sc-git hook reinstall silently reverts all of this *and* re-adds
the deleted `check-slices.mjs` line, which would block every push.

**Still open:** (1) `lib/host/exec-filter.test.ts` documents four `it.fails()` bypasses of the
`rm -rf /` guard (`;` chain, subshell, `bash -c "…"`, `HOME=/ rm -rf "$HOME"`). Exec is
human-approval-gated and an authenticated owner has full shell anyway, so this degrades the
DANGER badge rather than being RCE — but a regex over shell strings is the wrong shape; the fix
is to split on shell metacharacters and check each segment. (2) The repo-health lens above.
→ **Both closed the same day; see the entry above this one.**

## 2026-07-30 — v0.2.0: Alfa can act on the host, and a release gate that found four reasons it should not ship yet (DONE)

An adversarial gate before announcing the agentic harness: five probes (contract vs code,
the approval boundary, live behaviour, doc truth, ship blockers), each handed to a skeptic
told to refute it against one bar — *would this embarrass or endanger someone who
self-hosts MSO because the release said the AI can act on their host?* 46 findings, 44
survived, 4 blocked the release. All four are fixed here.

**1. `app.open` was a way around the approval boundary.** It is `effect: "read"` on the
stated grounds that opening a window "touches nothing on the host". True for fourteen apps
and false for two: `claude-code` mounts a PTY that immediately runs
`claude --dangerously-skip-permissions`, and `os-terminal` mounts a login shell. The app
name comes from the model, so prompt injection reached it, and `pty.ts` already records
that keystrokes are unaudited and the destructive-command regex cannot apply there.
`registry.test.ts` kept `pty.open` away from the model; nothing kept away the window that
wraps one. `run()` now refuses both by id, the description no longer advertises a terminal,
and a test pins both halves.

**2. The same tool silently lied about the other twelve.** It called
`openWindow(app, app)` with the model's raw string, but the registry keys by **id** while
`shell.manifest.ts` gives most apps a different **slug** — and the description advertises
the slugs. So "open Files" rendered `Unknown app: files` and returned `opened files`. Both
the user and the model were told it had worked. It now resolves slug-or-id against
`BUILTIN_APPS` using the same predicate as `use-url-sync`, and throws on a name it cannot
resolve.

**3. The Agents UI asserted a permission boundary that did not exist.** A "Generalist /
Curated — by skill" switch, a per-agent Skills grant list, and counters reading
"Ops · 2 skills · 11 tools" — while `use-host-commands.ts` returns `HOST_AI_TOOLS`
unconditionally, with no agent in scope. All 18 tools went every time. Not exploitable —
mutating tools still park a card — but someone who curated a System-only agent was handing
the model `fs.read` over their entire read jail and believing they had not. CONTRACT.md
already required this removal in writing; this commit performs it and marks it done.

**4. The zero-friction provider turns the headline feature off.** The ChatGPT OAuth path
never forwards the tools array (`codex-stream.ts` sends no `tools` field), so Alfa answers
fluently and cannot call anything — and "chat-only" appeared only in code comments. The
sign-in button now says so. **This is what the live instance was running**, which is why
the harness was doing nothing there.

**Docs.** README's Security warning said nothing about the assistant being able to act on
the host; it now names all 18 tools by tier, says that everything Alfa reads goes to the
model provider on every turn, states that a read file is untrusted input and the card is
the only thing between it and an `exec.run`, and says plainly that Agents and Skills are
organisation rather than permissions. Also removed a shipped pre-launch TODO that called
the maintainer's own auth-gated cockpit a demo.

Version 0.2.0 — first tag since `wave1-safety`, 191 commits back. typecheck + lint + 1,096
tests + build green; the manual `workflow_dispatch` CI passed from a clean checkout at
run 30564867120, which is the only lockfile-drift check that exists.

## 2026-07-30 — A repo-wide dead-weight sweep before the agentic-harness release (DONE)

`bccd0b1`..HEAD. An adversarial audit — six parallel sweeps (orphan modules, whole
directories, dependencies, dead code in live files, docs, assets), each one's findings then
handed to a skeptic whose job was to REFUTE them. 47 candidates, 22 survived. The skeptic
earned its keep: it killed a proposed 21-line barrel trim that would have been a build
break (appshell's own `features/*` subtree imports the barrel BY ALIAS, so a
"used outside this directory?" predicate reports live exports as dead), and it saved
`os-browser/` by *starting* it — dormant, not dead, and still the repo's only Playwright
install, which `scripts/gen-readme-media.mjs` imports.

**Cut, in order of size.** `mock-os/` (101 files, 5.7k lines, 6.6 MB) — an HTML+babel design
prototype deliberately excluded from the build, the lint pass and the coverage report, i.e.
excluded from everything, which is the definition of weight without load. `docs/PLAN.md` and
`docs/MULTISHELL-PLAN.md`: the first contradicted by shipped code in every section, the
second's sibling repo gone and its one unique decision reversed by PROGRESS.md:574. 15
`slice.manifest.json` stubs (`"generated": "stub"`, 8 naming a `convex/` directory that does
not exist) — `image-picker` and `quicklinks` stay, being hand-written docs rather than
stubs. `rr.json`, an inert consumer manifest describing the Convex stack removed in Phase
15. `appshellConfig`, a config export declaring no config. Six symbols with exactly one
repo-wide hit each, their own declaration. `docs/media/hero-desktop.png`, 1.2 MB the README
stopped referencing when it moved to `mso-hero.webp`, plus `openApp()` and the throwaway
`~/readme-showcase` folder that existed only to dress that one screenshot.

**Two comments that were simply false**, which is worse than dead code because it is read as
fact: `vitest.config.mts` said coverage was inert pending an install that had already
happened, and `CONTRIBUTING.md` said there is no CI.

**One bug the sweep surfaced.** The service worker cached `/icon-192.png` and
`/icon-512.png`, which have never existed — `app/manifest.ts` has always pointed at the
SVGs. Next's catch-all answers an unknown path with the app HTML and a 200, so `addAll()`
never threw; it cached the HTML shell under two icon URLs, which is precisely what the
comment above it promises the SW never does.

**CI moved off hosted runners.** `ci.yml` ran on every push to `main` at ~80 s of billed
runner time, duplicating a `pre-push` hook that already gates typecheck/lint/test/check
locally. It is `workflow_dispatch` now. Three of its steps are genuinely not reproducible
locally — clean-checkout `pnpm install --frozen-lockfile` (the only lockfile-drift check),
`bash -n scripts/install.sh`, and `pnpm build` — so the file says to run it by hand before a
release rather than being deleted.

**Deliberately NOT cut**, each with a reason: `os-browser/` (a documented, whitelisted,
working service); `docs/{ARCHITECTURE,AUDIT-2026-06-11,SCORECARD-2026-06-14}.md`
(banner-kept history, and AUDIT-06-11 is cited by name from three source files);
`scripts/e2e*` (dormant, revived by one `node os-browser/server.mjs`);
`useBadges`/`useLayouts`/`useProfiles`/`listProfiles` (dead here, but rr's `appshell` calls
`listProfiles` — cutting forks the lifted slice and they return on the next merge); the
3,060 unread token entries in `registry-data.json` (a verbatim upstream mirror; pruning it
forks the file and breaks `check-contrast`'s pairs); the `postcss` devDependency (a one-line
win that costs a 258 KB lockfile regeneration on the eve of a release).

Deleted docs and trees are recoverable with `git show bccd0b1:<path>`; the untracked ones —
`mock-os/Apple-clone-app/`, `public/MSO_Brand_Assets_Current/`, 13 one-shot June probe
scripts — are in `~/archive/mso-cleanup-2026-07-30/`, since git could never bring those
back. Net: 1,047 → 930 tracked files, −6.3k lines, −9 MB. typecheck + lint + 1,095 tests +
build + cycles + slices green.

## 2026-07-30 — Hermes reached the iframe; three gates were closing it (DONE)

The Hermes window rendered `{"error":"managed application upstream unavailable"}`. Three
separate gates, each one uncovered only after the previous was open, and each one a real
gap in the install path rather than a fault in a running app.

**1. The install never installed the dashboard** (`scripts/managed-app-install`).
`hermes gateway install` creates `hermes-gateway.service` — Telegram/Discord/WhatsApp
plumbing — and binds nothing on 9119, which is the port `HERMES_DASHBOARD_URL` points at.
So a Hermes MSO had just reported as *installed, running, healthy* served a connection
refused. This host hid the gap for months because its 9119 unit was hand-written and
predates the installer; deleting it on 2026-07-29 is what exposed the bug. There is no
`hermes dashboard install` upstream, so the unit is ours now, written at install time.
`hermes serve` is not a substitute — it answers `/api/*` and 404s the web UI by design.
No `--skip-build`: the first start builds `web_dist` in ~1 min, every later start finds
it current and is up in 2 s, and `--skip-build` would turn a missing dist into a
permanently broken service instead of a slow first boot.

**2. The proxy stripped the credential the SPA needs** (`lib/managed-apps/proxy-headers.ts`).
On a loopback bind Hermes mints an ephemeral token per process, injects it into the SPA
HTML, and requires it back as `X-Hermes-Session-Token` on every `/api/*` fetch. It was not
on the request allowlist, so the shell rendered perfectly and every request under it 401'd:
sidebar, no data. Forwarded per-app (`APP_REQUEST_HEADERS`), not globally — it is one
upstream's credential. Safe in a way `authorization` is not: no browser attaches this header
on its own, so it can never become ambient credential.

**3. The WebSocket upgrade failed Hermes' own rebinding guard** (`proxy.ts`,
`upstreamSocketHeaders`). FastAPI runs no HTTP middleware for WebSocket routes, so Hermes
repeats the DNS-rebinding Host/Origin check inside the handler and closed every chat socket
`4403` → "connection interrupted (code 1006)", reconnecting forever, while every plain fetch
on the same page worked. The upgrade now presents the loopback Host/Origin **for Hermes
only**: OpenClaw matches its `allowedOrigins` against the origin AS PRESENTED, so the same
rewrite would break it. Rewriting these two headers gives an attacker nothing — `?token=` /
`?ticket=` in the query is the credential, and it rides through untouched. The test that
asserted the opposite was asserting a false premise (that Hermes binds `0.0.0.0`).

**OpenClaw, found while testing.** Its Control UI refused the socket with "Browser origin not
allowed": `gateway.controlUi.allowedOrigins` held only the retired `oc.rahmanef.com`, restored
from a 2026-07-25 backup by the `job.restore.succeeded` at 19:55 on 2026-07-29 — config
restore replaying pre-split state. `onboard` has no flag for it, so the installer sets it from
`MSO_INSTALL_APP_ORIGIN` (`managedAppOrigin(id)`), origin only, never a wildcard. Remaining
step is auth by design: the Control UI wants the gateway token pasted (`reason=token_missing`).

Verified end to end against the live cockpit with Playwright as an approved device: Sessions,
Models, Skills, Cron and Chat all load, all three sockets (`/api/ws`, `/api/events`,
`/api/pty`) stay open, model badge reads *live*, zero failed requests.

## 2026-07-28 — Alfa becomes one assistant; the browser becomes real; four security fixes (DONE)

`ab03b3e`..`c30e6e6`, 18 commits. Three threads: reversing a design that had drifted into
fiction, making the browser and the assistant actually work on a phone, and closing four
security holes. **Read the failures section at the end — four of these commits shipped
defects that only a later audit caught, and that pattern is the most useful thing here.**

**Hermes and OpenClaw are ordinary apps, not shell modes** (`a2c3882`). MSO could swap its
entire shell into a per-app "workspace mode": localStorage picked a mode, the app list was
filtered to a per-mode set, and a pipeline scraped each upstream's BUILT SPA bundle with six
regexes to spawn one MSO window per upstream nav route. Both dashboards already ship their own
sidebar, so all of that rebuilt navigation they hand us for free — held up by regexes against
minified third-party JS. Deleted: `os-shell/workspace-mode.ts`, the `WorkspaceModeControl`
capability, the Dashboard `<select>`, the Control Centre tile, the right-click submenu, and the
whole discovery pipeline (`features.ts`, `feature-parser.ts`, `dynamic-features.tsx`,
`feature-icons.ts`, the `/features` route). −1,048 net. `noDock` came off both descriptors first,
or they would have vanished from the dock, start menu, Android home and Dashboard sidebar.

**The Browser is a real Firefox** (`5017353`, `c8be397`, `779f2ba`). The iframe browser could
only ever render the minority of the web that permits framing — X-Frame-Options refuses the
rest — so it was chrome around a blank rectangle. It is now Camoufox (anti-fingerprinting
Firefox) on a headless X display, streamed over noVNC. Two mobile blockers had to go with it:
`vnc_lite.html` has no focusable input at all, so on touch the OS keyboard never opened and the
remote browser could not receive a keystroke; and `scale=true` painted a 1440x920 desktop at
0.273x inside a 393px window with ~60% empty letterbox — the "black rectangle" the owner
reported. `vnc.html` + `resize=remote` gives 1:1 pixels, and needs a window manager on the
display (matchbox) or the browser window never reflows on the RANDR change. `779f2ba` gave the
window power over the host session, so hiding the app no longer leaves a browser, an Xvfb and an
x11vnc running for nobody.

**Alfa is one conversation across every feature** (`5e025ff`, `818a77d`, `ed8e8fd`). It used to
be two disconnected chats: the Assistant app ran the real agent, while the Inspector ran a
second toolless chat whose state was thrown away on every app switch (`key={appId}` remount).
Now one module store, one engine registered lazily by the panel, and many views onto it —
including a bottom sheet on mobile, where Alfa did not exist at all because `rightPanel` is
rendered only by the macOS and Windows shells. Every turn is tagged with the app it came from, so
a task carried Files → Terminal → Browser reads as one story. `@agent` and `/skill` completion
landed in ONE composer every AI input shares; `/` fires only as the first character, because this
is a VPS cockpit and `ls /home/rahman` must not open a menu.

**The AI subsystem stopped lying** (`52949ec`, `badef71`, `3287f61`, `79938be`, `87ac78a`,
`c30e6e6`). There were two tool catalogs: 45 hand-written descriptors beside 18 executable tools,
sharing exactly ONE name (`apps.list`) and disagreeing about what it did. The other 44 described
capabilities the model could never call. `OS_TOOLS` is a VIEW of `HOST_TOOLS` now. The agent was a
per-mount hook, so the sheet and dock could not read it — which is why `@agent` was cosmetic; it
is a module store now and a pick actually switches, with "Answering as <name>" so the switch is
visible. The persona moved from a fake user turn (injected once, when history was empty, freezing
turn zero's agent forever) into a per-request system prompt. `CONTRACT.md` in the assistant slice
now states what an Agent, Tool, Skill and Playbook each are, and lists the gaps rather than hiding
them.

**Security** (`a8a3c72`, `a980729`, `c8be397`, `5017353`):
- An **unauthenticated permanent lockout of the owner**. The login limiter incremented its global
  counter before the per-IP check and unconditionally, so one flooding IP burned the process-wide
  budget and every other caller — including the owner, from a different address, with the correct
  password — got 429 for as long as the flood ran. No credential, from the public internet,
  indefinitely.
- A **credential-copy escape**. `copy(~/projects → ~/backup)` duplicated the cockpit's own
  `.env.local` past the credential gate, and `/api/v1/fs/read` would then serve
  `OS_SESSION_SECRET`. Reachable on the DEFAULT roots.
- The **camoufox VNC bridge** was gated only by the presence of a cookie NAMED `session`, so
  `Cookie: session=x` from anywhere reached a live keyboard and mouse. It is behind the same
  verified-session check as `/api/v1/exec` now.
- **x11vnc ran `-nopw`** fronting a logged-in browser profile. Password set, and the launcher now
  refuses to start without one.

**Also**: real product marks for Hermes/OpenClaw/Camoufox instead of approximate lucide glyphs;
skills bundled in-repo so a fresh install has a catalog; `zip` exit 18 no longer throws away a
complete archive over one unreadable file; `-x */name/*` fixed to also match at the archive root.

**What broke, and how it was caught.** Four commits shipped defects that passed typecheck, ~1000
tests AND a live browser check, and were found only by a later adversarial audit:
- `52949ec` pruned unknown tool ids from saved data. `mergeBuiltins` lets a SAVED copy win over
  the fresh preset, so every existing install would have had its five builtin skills emptied.
  Fresh installs were fine — which is exactly why nothing caught it. Fixed in `badef71` by
  MIGRATING ids instead of dropping them.
- `5e025ff` cached the resolved engine forever and kept two busy flags, so sends went to a dead
  closure and a send mid-run was swallowed after the composer had cleared the text. A mutate tool
  asked for from the mobile sheet hung the agent forever with no Approve button anywhere. Fixed in
  `ed8e8fd`.
- `3287f61` put the store on the eager client entry chain with an unguarded `localStorage` read,
  so a browser with site data blocked would lose the whole cockpit rather than one window — and
  `79938be`, meant to fix it, did not: `typeof localStorage` ALSO throws when the getter throws.
  It also froze the store at page load, so a second tab silently clobbered agents created in the
  first. Both fixed in `c30e6e6`.

Every one failed only for a returning user, a second tab, a denied-storage browser, or a second
interaction. **A fresh-install happy path proves nothing in this codebase.**

**Deliberately not done**: agent tool scoping stays fiction-free by deletion rather than
enforcement (a per-agent tool array would also cold-miss the prompt cache on every switch, and the
per-call approval card is a better lock); the `Skill` → `Playbook` rename; wiring
`Skill.starters`; caching `/api/skills` (~90 files per call).

## 2026-07-24/25 — Managed applications: Hermes + OpenClaw, each on its own origin (DONE)

> **Partly superseded by `a2c3882` (2026-07-28):** the *workspace modes* and *feature
> discovery* work below was REVERSED — Hermes and OpenClaw are ordinary app windows now,
> and the SPA-bundle parsers are deleted. The origin split, the proxy hardening, the
> update centre and the registry all stand unchanged. Kept because the work happened and
> the reasoning is why the reversal was right.

MSO becomes the **control plane** for applications that stay separate. Hermes and OpenClaw keep
their own runtime, config, data, versions, health, logs and backups; nothing is copied, forked or
merged into this repo, no DOM is scraped, and nothing under `~/.hermes/` or `~/.openclaw/` is ever
written — the only writes land in `~/.mso/`. Everything goes through their own CLIs, their own
loopback HTTP surfaces, and systemd/docker. Shipped as `c411187` → `52cfff5` → `0feaab4` →
`5b4b5c9` → `d1fbd85` → `c597d08` → `d880f68`. (`3b45b8e`, same session, closed an unrelated
hole: the camoufox VNC rewrite was gated only by the *presence* of a cookie named `session`, so it
is commented out and answers 403 until a real check can run in the nodejs middleware runtime.)
`tsc` + `eslint` clean, vitest **90 files / 965 passing**, deployed on `:4005`.

- **Registry** (`c411187`) — `lib/managed-apps/`: catalog (command, candidate unit + container
  names, loopback dashboard URL, state dir, env overrides), manager (detect → state → health →
  version → actions → backup → logs, one in-flight action per app), runner (`execFile`,
  `shell: false`, argv arrays, 128 KB cap, timeouts — no string ever reaches a shell). Four routes
  under `/api/v1/managed-apps`, every one `verifyAuth()` first; actions are demo-blocked,
  rate-limited 12/min and audited as `managed-app.action`. Backup copies `~/<stateDir>` into
  `~/.mso/backups/<id>/<stamp>/` and (as first shipped) refused a tree containing symlinks —
  replaced later this phase, see the fix bullet; logs are journalctl / `docker logs` with
  bearer/token/secret/password redaction.
- **Workspace modes + real feature discovery** — **REVERSED in `a2c3882`, all of this is deleted.** (`52cfff5`, `0feaab4`, `5b4b5c9`) — `plain | hermes
  | openclaw` in `localStorage` (`mso:workspace-mode`), orthogonal to Shell Style, with a
  right-click Workspace submenu on all five shells sharing one store with the Dashboard select.
  Each app's navigation is parsed from **its own installed bundle + plugin API**, not hard-coded:
  Hermes 18 nav entries + 2 plugin tabs (verified against `web_dist/assets/index-*.js` and
  `/api/dashboard/plugins`), OpenClaw 26 routes from `app-route-paths-*.js` of which 24 are
  offered (`workboard`/`plugin` are flag-gated → `available:false`). 60 s cache, min-length parse
  guard, and an unreachable upstream yields nothing rather than tiles that 404.
- **Proxy hardening** (`5b4b5c9`, `c597d08`) — upstream must be loopback; cookies namespaced
  `mapp_<id>_` and pinned to the mount so the mso `session` never crosses; `authorization` /
  `www-authenticate` never relayed; off-origin redirects refused (open redirect **and** a CSP
  path-matching bypass); upstream service workers 404'd; request bodies counted as they stream
  (a chunked body has no `content-length`); route errors carry `frame-ancestors` or the browser
  refuses to display them. The emitted CSP is now **intersected** with the upstream's own per
  directive — OpenClaw's sha256-pinned inline scripts and narrow `connect-src` survive, its
  `frame-ancestors 'none'` does not, and only hashes are ever copied, never nonces.
- **Every session cookie verified** (`d1fbd85`) — cookies are isolated by neither port nor path, so
  a planted second `session=` sorting first made every request fail HMAC and logged the owner out
  of their own cockpit. Each candidate is checked; the first that holds up wins.
- **Origin split** (`d880f68`) — the iframe needs `allow-same-origin` or the SPAs do not boot, and
  on the cockpit origin that made upstream JS same-origin *with the cockpit*: `window.top.fetch`
  → `/api/v1/exec/run` with the user's session, which no CSP can stop (a policy binds a realm, not
  a reference across realms). Each dashboard now has its **own host on this same process**
  (`{id}.mso.rahmanef.com`, DNS + `/etc/dokploy/traefik/dynamic/mso-managed-apps.yml`), so
  `window.top` is opaque — measured in Chromium 148, with a same-origin control that still breaks
  through. `proxy.ts` rewrites every path on an app host into that app's proxy and 404s the rest
  (matcher widened to `/(.*)`, CSRF check moved ahead of the rewrite, `Host` authoritative over
  `x-forwarded-host`); an unclaimed name in the namespace 404s so a DNS edit alone cannot hand out
  an authenticated cockpit. Root-mounted means the document is no longer rewritten at all (no
  `<base href>`, no rebasing, no fetch shim, nothing to pin), the policy is origin-scoped,
  `frame-ancestors` names the cockpit from deployment env only, and `img-src` drops its `https:`
  wildcard (the widened cookie would make `new Image().src` an existence oracle). The session
  cookie gained an optional `Domain` and is cleared with **and** without it; `SameSite=Strict` is
  unchanged and still correct because the app hosts share the registrable domain.
- **Verified live**, not just unit-tested: `https://hermes.mso.rahmanef.com/` and
  `openclaw.…` answer over TLS with a valid cert; `/api/v1/exec/run` and `/api/v1/sys/stats` on an
  app host come back as the proxy's own 401 with `x-middleware-rewrite:
  /api/v1/managed-apps/<id>/proxy/…` (the cockpit route is not reachable there); `staging.os.…`
  and `/_next/*` on an app host 404; the cockpit itself is untouched.
- **Env is one decision in two variables** — `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` +
  `OS_SESSION_COOKIE_DOMAIN`, set **before** `pnpm build` (the `NEXT_PUBLIC_` one is inlined into
  the client bundle). Unset = single-origin mode, still the dev/demo/rollback path, with the
  `window.top` reach open and the path-scoped CSP as the only containment.
- **Two defects found by writing the docs, and fixed in the same phase.** Documenting the
  subsystem against the live host is what surfaced them; both were live in a shipped build and both
  were invisible without a test, so `lib/managed-apps/manager.test.ts` (5 cases) now pins them.
  (1) **Detection** ran `systemctl is-active <unit>` and treated anything that was not "could not be
  found" as "the unit exists but is inactive" — but on systemd 255 an *unknown* unit prints
  `inactive` with rc 4 and an empty stderr, so the first configured name always won. OpenClaw's
  catalog led with `openclaw.service`, which does not exist here, so its card read `stopped` with
  `healthy: null`, empty logs (`-- No entries --`) and 409 on every lifecycle action while its
  gateway served. Now `systemctl [--user] show -p LoadState -p ActiveState` per scope: rc ≠ 0 is "no
  answer" and falls through, `LoadState=not-found` skips the name, otherwise `ActiveState` decides.
  `catalog.ts` also lists `openclaw-gateway.service` first, though ordering no longer decides
  correctness. Live after the fix, both apps through the real `listManagedApps()`: `hermes | systemd
  | running | healthy=true | dash=true` and `openclaw | systemd | running | healthy=true |
  dash=true`. (2) **Backup** walked the tree and threw on the first symlink; `~/.hermes` has 58 and
  `~/.openclaw` 2063, so the action failed for every real install and `~/.mso/backups/` was never
  created (a success would have copied 2.7 GB + 1.7 GB). The guard is gone; `fs.cp` now takes a
  filter that skips `node_modules`/`.venv`/`venv`/`__pycache__`/`.git`/`.cache`/`backups` — the last
  being the app's *own* 1.1 GB backup dir — and skips symlinks (neither followed, which would copy
  bytes from outside the app, nor recreated, which would let a restore write outside the tree). The
  source now honours `homeDir`, so `HERMES_HOME` is no longer ignored, and `manifest.json` gained
  `source` + `skipped: {symlinks, dirs, dirNames}`. Measured with those exclusions: 366 MB and
  237 MB, on 227 GB free.
- **Open, and documented as open**: no restore code, so a rollback is a manual `cp -a` and the
  manifest has no inventory or checksum to verify a snapshot; no update center (check-update,
  channels, update, rollback, uninstall, install wizard); OpenClaw's control UI is WebSocket-driven
  and a route handler cannot service an `Upgrade`, so its panels stay empty and those features open
  on a CLI view with the reason stated; the docker and `package` detection branches have no test and
  no install here to exercise them; no notifications, no resource-aware behaviour, no start-on-boot;
  no integration or journey tests; `state: "error"` is never produced and `managed-app.action` audit
  lines still carry `actor: null`; the workspace switcher is not yet a visible control in the
  macOS/Windows/iOS/Android chrome; an upstream can still broaden its own `connect-src` to a
  third-party https host it declares (never to the cockpit). **The split is a browser-realm boundary
  only** — a plugin installed into either app runs inside that daemon and can run host commands.
- Docs: `ARCHITECTURE.md` (request-path diagram + the managed-app section), `SECURITY.md`
  (origin split as a first-class boundary + operational tripwires), `README.md`, the operator guide
  in `docs/MANAGED-APPS.md`, and per-app `docs/HERMES-INTEGRATION.md` +
  `docs/OPENCLAW-INTEGRATION.md` (units, ports, auth models, discovery, upgrade tripwires). All
  re-checked against the code and the live host after the two fixes above.

## 2026-07-16 (round 8) — iOS editors long-tail: a11y + Dialog→sheet (DONE)

Closed the round-7 logged editor tail (owner-requested). Presentation-only (canvases untouched per
§6). **a11y:** coarse-pointer 44px across editor chrome in 10 files (code-editor, image-editor,
reel-editor, media-viewer, image-picker). **Dialog→sheet:** 6 raw `<Dialog>`s → house
`ResponsiveDialog`/FormDrawer (bottom sheet on touch) — reel settings + file-browser, media-studio
save-image, files zip, os-settings model-catalog (trigger-hoist + ScrollArea→Body), image-picker
(h-[440px]→flex-1); code-editor close-guard keeps its correct centered iOS alert. Added `select` to
the globals coarse rule. tsc + eslint clean, vitest 689, deployed `:4005` health 200. Detail in
`IOS-PARITY-REFACTOR-PLAN.md` §8 (round 8).

## 2026-07-16 (round 7) — iOS touch-target a11y sweep (P4 long-tail) (DONE)

Owner requested the iOS-parity optional long-tail. A **10-agent adversarial re-audit** found **0
mis-gates** (seam discipline held — the other four shells are provably unaffected) + **63 gaps** (49
sub-44px touch targets, 8 dialog→sheet, 6 regressions from the round 1–6 AI work — the 14px app root
makes `h-8`=28px / `h-9`=31.5px fall short). Fixed the high-ROI subset: one `@media(pointer:coarse)`
`globals.css` rule for all inputs/selects/menuitems (~25 targets), 2 shared primitives
(`responsive-toolbar`, file-tree `dir`), **46 per-slice button/row 44px appends** (6-agent disjoint
fan-out), and widget-picker Dialog→`ResponsiveDialog` sheet. Editors long-tail + the model-catalog
scroll-restructure logged as remaining. `tsc` + `eslint` clean, vitest **689** green, deployed `:4005`
health 200. Full detail in `IOS-PARITY-REFACTOR-PLAN.md` §8 (round 7).

## 2026-07-16 (round 6) — "Alfa, forget this" tool (DONE)

Twin of `memory.remember`: a `memory.forget` host-tool (read-tier) that matches saved
facts by phrase (substring), deletes each match via `/api/memory`, and reports what it
removed. Catalog entry + HOST_SYSTEM guidance + registry test. tsc + lint + vitest green.
Also added the gitignored root `progress.md` (local session log).

## 2026-07-16 (round 5) — "Alfa, remember this" tool (DONE)

Alfa can now save facts to memory itself, not just via Settings: a `memory.remember`
host-tool (read-tier — runs immediately, no approval card, since it's a benign owner-scoped
write) that POSTs to `/api/memory`. One catalog entry (`host-tools/catalog.ts`) + a HOST_SYSTEM
guidance line; the registry test covers it as a read tool. tsc + lint + vitest green. It
complements the manual Settings → Alfa memory panel (both write the same `~/.mso/memory.json`).
**Not redeployed** — build + restart to activate.

## 2026-07-16 (round 4) — Alfa chat history (YAML threads) + cross-session memory (DONE)

Ports 2 & 3 of the models-rahmanef-com picks. tsc + lint + vitest (full suite + 4 new store
tests) green. Store logic is unit-tested; the full UI click-through (send → persist → resume;
add fact → Alfa recalls it) is best exercised on the deploy (it needs a real provider key to stream).

- **Chat history** — Alfa was stateless; now every completed turn persists to a YAML thread under
  `~/.mso/threads/` (`lib/ai/threads.ts` — path-jailed filenames, atomic write). `/api/threads`
  (list/get/save/delete). A History drawer (`thread-list.tsx`) in the Alfa header lists saved chats;
  resume restores BOTH the display bubbles and the wire history so the chat continues; New starts
  fresh. Persistence factored into a `use-thread-persistence` hook. YAML (not JSON) per the owner's
  request — readable session files (`yaml` dep added).
- **Cross-session memory** — durable facts recalled into Alfa's system prompt, matched to the latest
  user turn by word overlap (`lib/ai/memory.ts`; `~/.mso/memory.json`). `/api/memory`
  (list/add/delete). The assistant route recalls + injects for EVERY provider path (codex/anthropic/openai).
- **Token savers** — Settings → AI → Output style: Normal / Caveman (terse) / Ponytail (lazy senior
  dev) → appended to the system prompt (`OsConfig.tokenSaver`).
- New Settings **"Alfa memory"** panel (`memory-section.tsx`) under the AI section: output-style
  picker + add/delete facts. **Not redeployed** — build + restart to activate.

## 2026-07-16 (round 3) — Model catalog browser (DONE)

First of three models-rahmanef-com feature ports the owner picked (catalog browser ·
chat history · cross-session memory). tsc + lint + vitest green.

- **Model catalog browser** — `/api/models` now carries capability/pricing meta (context
  window, $/M input+output, tool/reasoning/vision support) from the models.dev catalog; a
  searchable **Browse** dialog (`model-catalog.tsx`) in Settings → AI lists the selected
  provider's models with that meta, click to set the model. Pure UI over the vendored
  `@rahmanef/models` catalog; degrades to "No catalog" for custom/OAuth providers (not in
  models.dev). **Not redeployed** — build + restart to activate.

Chat history (YAML thread store) + cross-session memory are next.

## 2026-07-16 (round 2) — BYOK OAuth: "Sign in with OpenAI" (Codex device-code) (DONE)

Phase D1 of DRAWER-MENU-BYOK-PLAN — the explicit ask ("oauth ai openai"). tsc + lint +
vitest (301) green; the Codex device-flow **start verified against the live OpenAI
endpoint** (HTTP 200 + user_code). The poll→token→chat round-trip needs the owner's
ChatGPT authorization to exercise.

- **OAuth framework** — token bundles in the 0600 host config (`OsConfig.oauthTokens`),
  transient handshake state in-memory (`lib/ai/oauth/flow-state.ts`), a per-provider
  start/poll route (`app/api/oauth/[provider]/route.ts`). OAuth providers surface in the
  connected-list (kind `oauth`), selectable + deletable.
- **OpenAI Codex** (device-code) — `lib/ai/oauth/codex.ts` (start/poll/exchange/refresh +
  `decodeAccountId` + models) + a **bespoke ChatGPT-backend Responses streamer**
  (`lib/ai/codex-stream.ts`): the platform `/chat/completions` path does NOT work — Codex
  hits `chatgpt.com/backend-api/codex/responses` with the OAuth bearer, the account id
  decoded from the token JWT, and SSE `response.output_text.delta`. Public Codex-CLI client
  id (no secret, no registration). The assistant route bypasses `resolveModel` for
  `openai-codex`, refreshes the token (120 s margin) before each call, streams via `streamCodex`.
- **UI** — Settings AI panel: "Sign in with OpenAI (ChatGPT)" → device-code (shows the user
  code, opens the verification page, polls to completion). `oauth-connect.tsx`; the active
  provider's key row + Test hide for OAuth providers.
- **Caveats (documented):** Codex is a reverse-engineered CONSUMER endpoint — needs a ChatGPT
  Plus/Pro subscription, can break if OpenAI changes it, and is **chat-only (no Alfa tools)**.
  Tokens are stored plaintext in the 0600 host file (mso's existing posture; at-rest
  encryption is a later pass). **Not redeployed** — build + restart to activate.

## 2026-07-16 — Shell action contract (drawer + OS menu) + BYOK add-provider (DONE)

Closed the gap the Apple mock flagged: feature slices now feed the shell's
menu/drawer format, and BYOK matches models-rahmanef-com's "add provider". Built
from a 3-probe audit → `DRAWER-MENU-BYOK-PLAN.md`. tsc + lint + vitest (299) green;
behaviorally verified on an isolated `:4011` dev server (prod never touched).

- **Shell action contract — one bus, both surfaces.** The AI-Inspector bus already
  publishes live per-app `actions` (all 14 apps). Surfaced them as (a) the desktop
  menu-bar app menu (`menu-bar.tsx` reads `useInspectorInfo(focusedId).actions`) and
  (b) a mobile in-app bottom-sheet drawer — a trailing "•••" in the iOS
  (`mobile-shell.tsx`) + Android (`android-shell.tsx`) app headers opens the new
  `AppActionsSheet` (shadcn Sheet side=bottom). No per-slice edits, no new bus. Did
  NOT rebuild to the mock's `prepare(ctx)→os` merge model. Verified: iOS/Android
  "•••" → New folder/Refresh/Empty Trash for Files; desktop Files menu lists the same.
- **BYOK add-provider — custom endpoint + validate + list/delete.** Streaming already
  consumed `resolved.baseUrl`+`protocol`; added the storage+UI: `OsConfig.customProviders`
  (`lib/config/store.ts`), SSRF guard (`lib/host/ssrf.ts` + test), a `protocol` override on
  `resolveModel` (`lib/models/resolve.js`), `/api/config` GET-list / POST-custom / DELETE,
  `/api/models/test` (1-token validation), and the Settings AI panel: custom-provider form
  (`custom-provider-form.tsx` + `custom-provider-config.ts` + test, ported from
  models-rahmanef-com), connected-provider list with delete (`provider-list.tsx`), Test badge.
  **OAuth deferred** (Phase D — big lift; the mock's "Sign in with OpenAI" is Codex device-code,
  not the platform API).
- Guards: iOS/Android edits live in their single-mount shells; the desktop menu addition is
  additive (empty actions → nothing renders); a null custom conn keeps built-ins registry-pinned
  → macOS/Windows/Dashboard byte-unchanged. **Not redeployed** — `pnpm build` + `sudo systemctl
  restart mso.service` to activate.

## 2026-06-15 — upload-DoS P0 closed (independent QA loop)

An independent QA `/loop` rated mso and shipped the one **P0 a parallel audit
session missed** — an authenticated DoS in `/api/v1/fs/upload`. Both on `origin/main`:

- **`b4b90c5`** — `fs/upload` no longer buffers every multipart part into RAM
  (`req.formData()` OOM-kills the host process that *is* the cockpit). New
  `lib/host/multipart.ts` streaming parser + `lib/host/fs-upload.ts` spool-to-tmp
  with backpressure + atomic rename within write-root bounds; `proxyClientMaxBodySize`
  500mb → 256mb.
- **`4ddc70f`** — cap **raw** pulled bytes (oversized preamble/header could still
  grow the buffer unbounded) + `lib/host/multipart.test.ts` (6 tests incl. both
  bypass vectors). `tsc` clean, vitest 293 passing.

**Not redeployed** — `pnpm build` + `sudo systemctl restart mso.service` to
activate. The concurrent-session collision lesson from that handoff is now a standing
rule in `CLAUDE.md` ("only ONE session edits mso at a time"); the handoff note
itself was deleted on 2026-07-28 once its remaining content had expired.

## Where things stand (2026-06-11) — recovery anchor

Four rounds shipped to `main` today, all green (typecheck + lint + vitest 162 +
build), prod + demo redeployed. Details in the dated entries below.

- **R1** `818a8ca` — full 6-pass audit → `docs/AUDIT-2026-06-11.md` +
  `docs/SHELL-FIDELITY-PLAN.md` (the roadmap the fidelity work follows).
- **R2** `89f4210` — audit fix wave 1–4: 5 app P0s + the P1 tail + hygiene
  (deleted media-studio's ~1,870-line orphan, tailwind-merge→3, global-error) +
  security hardening (sensitive denylist, audit redaction, child-env scrub).
- **R3** `82aeaaa` — dynamic per-shell context menu (`appshell/lib/context-menu.ts`
  registry, all 5 shells) + live/interactive wallpaper (TSX registry + sandboxed
  HTML iframe, `liveWallpaper` capability).
- **R4** `f31b893` — fidelity Phase A+B: per-shell `data-shell` tokens
  (font/radius/icon/ease/dur) + window open/close/minimize motion + geo glide.

**Next move (not started):** SHELL-FIDELITY-PLAN **Phase C** — one
`<WindowPreview>` primitive feeding Mission Control / Windows taskbar hover /
Android recents / iOS switcher; it also fixes the audited switcher
double-session bug (iOS mounts live `WindowContent` per card today). Then
Phase D per-shell signature behaviours. Deferred from the audit (documented):
the UX error-doctrine sweep, confirm/undo pass, focused-window hotkey capability.

---

## 2026-06-11 (round 4) — Shell fidelity Phase A+B: per-shell tokens + window motion (DONE)

First two phases of `SHELL-FIDELITY-PLAN.md`. CSS-first, zero new deps.

- **Phase A — per-shell design tokens.** `data-shell={id}` on the Surface root;
  globals.css defines `--shell-font / -radius-win / -radius-ui / -icon-radius /
  -ease / -dur-fast|dur|dur-slow` with per-OS overrides: macOS/iOS 10px + SF
  stack + `cubic-bezier(.32,.72,0,1)`; Windows 8px/4px + Segoe + decelerate
  curve; Android 300ms + Roboto + **circular** icon mask (50%). The window
  radius fork (`rounded-md` vs `rounded-[var(--radius-win)]`) collapsed to
  `--shell-radius-win`; app icons use `--shell-icon-radius`; menu bar / taskbar /
  window titles use `--shell-font` (CHROME only — app content keeps the theme
  preset's typeface, so the recent preset-font work is not regressed).
- **Phase B — window lifecycle motion.** `winOpen` on mount; `winClose` /
  `winMin` via a component-LOCAL phase that finalizes the SYNCHRONOUS store
  action on `animationend` (store contract unchanged — `closeAll`/tests stay
  sync; guarded editors skip the animation so the confirm dialog isn't over a
  faded frame). `.win-geo` glides maximize/snap/restore; the drag + resize hooks
  set `transition:none` mid-gesture so per-frame moves never lag. Mobile
  `appOpen` durations tokenized. `prefers-reduced-motion` collapses to ~1ms.
- Verified on demo (Playwright, computed styles + screenshots): macOS window
  10px + SF titlebar, Windows 8px + Segoe + caption buttons, Android icons 50%,
  geo-transition + open animation live, zero page errors. Gates green, 162 tests.
  Prod + demo rebuilt.
- Next in the plan: Phase C (one `<WindowPreview>` primitive → Mission Control /
  taskbar hover / recents / iOS switcher; also kills the switcher double-session
  bug), then per-shell signature behaviours (Win taskbar grouping + Alt-Tab +
  snap-layouts; iOS zoom-from-icon + status bar; Android notification shade +
  ripple).

## 2026-06-11 (round 3) — Dynamic per-shell context menu + live/interactive wallpaper (DONE)

Two requested features, both on new brand-free appshell registries (rr-liftable).

- **Dynamic per-shell context menu** — `appshell/lib/context-menu.ts`:
  `registerContextMenu(ShellId | "*", provider)` → `getContextMenuItems(ctx)`;
  providers run at OPEN time with `{shell, surface, x, y}` so items are fully
  dynamic. `useShellContextMenu(shell)` + `<ShellContextMenu>` merge each shell's
  built-ins with the registry. Wired into ALL FIVE shells: macOS + Windows
  (built-ins → registry), Dashboard (Home-view right-click), iOS + Android home
  (long-press / contextmenu, skips controls). os-shell injects dynamic items in
  `integrations.ts` ("New Files window" desktop-only, "Change wallpaper…",
  "Lock screen" mobile, "Open System Monitor" on dashboard). Fixed a latent bug:
  the Windows desktop menu hung off a div shadowed by the window section — moved
  to the section with the currentTarget guard (macOS pattern).
- **Live / interactive wallpaper** — one capability field
  (`ShellAppearance.liveWallpaper`, wins over image + preset), two sources:
  (1) **from code (TSX)** via `appshell/lib/wallpaper-registry.ts`
  `registerWallpaper({id,label,render,interactive?})` — os-shell ships Drift
  (token-colored CSS blobs) + Starfield (rAF canvas, pauses when hidden,
  pointer-attracts when interactive); (2) **from the frontend (HTML)** — user
  pastes a page in Settings, rendered by the shell in a **sandboxed iframe**
  (`sandbox="allow-scripts"` only — opaque origin, no cookies/parent DOM/authed
  `/api`), size-capped + shape-validated (`normalizeLiveWallpaper`). A "receives
  clicks" toggle turns the desktop window layer `pointer-events-none
  [&>*]:pointer-events-auto` so empty-desktop clicks reach the wallpaper (it works
  as a live website); windows/dock/menus stay on top. UI:
  `os-settings/components/live-wallpaper-rows.tsx`; SECURITY.md documents the
  sandbox model.
- Gates: typecheck + lint + build green, vitest 154 → 162 (context-menu registry
  + wallpaper-normalizer tests). New files ≤200 LOC; appshell stayed brand-free.
  Prod rebuilt + restarted.

## 2026-06-11 (round 2) — Audit fix wave 1–4: P0/P1 bugs + hygiene + security hardening (DONE)

Acted on `AUDIT-2026-06-11.md`. 73 files, +973/−300; typecheck + lint + build
green, vitest 136 → 154. 6 disjoint agents did the app slices; shell core +
lib + security done by hand. Prod rebuilt + restarted.

- **App P0s fixed:** image-editor export now renders the DOC rect at doc
  resolution (Transformer/shadow hidden during capture) + a failed project load
  no longer clobbers the file (load-success gate); Settings SSH "Laptop" target
  editable (server-targets dedupe precedence inverted); code-editor ⌘S saves
  instead of opening the browser dialog (scoped stopPropagation); files-manager
  "Download" actually downloads (raw-URL anchor).
- **App P1s:** files rename-collision + same-dir cut-paste guards + failed-listing
  error state; image-editor delete/duplicate keep paint pixels + imports stored as
  data URLs (not dead `blob:`) + editor hotkeys scoped to the focused window;
  code-editor stale-buffer/openPath/inspector-save fixes + dirty-tab close guard;
  assistant abort seam end-to-end (Stop button, `req.signal`, no token bleed after
  close) + partial reply kept on error + conversation survives tab switch; browser
  unmount closes remote pages (keepalive) + "service offline — Retry" state;
  settings AI-key save errors surfaced; login errors visible in pending state +
  English strings; quicklinks hydrate shape-guarded; prefs writes serialized.
- **Shell core (hand):** resize commits via `offsetLeft/offsetTop` (no +30px
  drift); Spotlight `useSearch` memoized (no infinite search loop); pollers gated
  on `document.hidden`; `hydrateBoot` dedupes a multi-app window by payload (no
  Files dup on `/files/*` reload); restored + resized windows clamped on-screen
  (`clampRect` + resize listener); window stacking + ⌘Tab + close-focus now follow
  z (focus recency); dock/Window-menu read a reactive windows map (no stale hover
  lists); `inEditable` guards on ⌘I + ⌘⇧V; context menu above the dock; dead
  `.dark .wp-material` → `[data-theme=dark]`; dashboard wallpaper no longer hidden;
  clipboard/recents SSR snapshots stabilized.
- **Hygiene:** deleted media-studio's ~1,870-line orphan editor (manifest
  trimmed); `tailwind-merge` 2 → 3 (Tailwind 4 class tables); `app/global-error.tsx`;
  `agent-log` route reads `readAuditTail()` (no lib/host bypass); `.env.example`
  gains `OS_FS_ALLOW_SENSITIVE` + `OS_PREFS_PATH`; ARCHITECTURE catch-all fix.
- **Security hardening:** sensitive-file denylist extended (`.aws`/`.kube`/
  `.docker`/`.config/gcloud`/`.netrc`/`.git-credentials`/`*_history`); browser
  fill/type audit lines redact typed values; spawned shells (exec + PTY) run with
  the app's own secrets scrubbed from env (`lib/host/child-env.ts`) — `printenv`
  no longer leaks the session secret/BYOK key; SECURITY.md notes the `/proc`
  residual. New tests: child-env scrub, clampRect, server-targets, quicklinks,
  prefs serialization.
- Deferred (documented, not done this wave): UX error-doctrine sweep, confirm/undo
  pass, focused-window hotkey capability, the SHELL-FIDELITY-PLAN phases.

## 2026-06-11 — Full audit + shell fidelity plan (docs only, no code changes)

- **`docs/AUDIT-2026-06-11.md`** — six parallel audit passes (security, shell
  core, app slices, fidelity inventory, Next/React best-practice, DX) over
  HEAD `84e857c`; single-source P1s re-verified by hand. Headlines: security
  clean (no P0/P1 — hardening list only); 5 app P0s (image-editor export
  renders viewport + failed-load clobbers files, Settings SSH target
  uneditable, code-editor ⌘S broken while typing, Files Download stub);
  5 shell P1s (resize +30px drift `use-window-drag.ts:96`, Spotlight infinite
  search loop `os-shell/capabilities.ts:42`, deep-link reload duplicates Files
  windows `store-persist.ts:60`, no offscreen re-clamp, z-order by creation
  not focus). Fix waves 1–5 prioritized at the bottom (data safety first).
- **`docs/SHELL-FIDELITY-PLAN.md`** — make the 5 shells feel native to their
  OSes while staying light: shared foundations first (per-shell `data-shell`
  token layer, motion scale + window lifecycle animation, system font stacks,
  one `<WindowPreview>` primitive, z-ladder tokens, shell code-splitting),
  then per-shell top cuts (macOS scale-minimize + Spaces strip; Win11 taskbar
  grouping + snap-layouts popup + Alt-Tab; iOS zoom-from-icon + status bar +
  edit mode; Android status bar + notification shade + ripple + back-bus;
  Dashboard ops-console identity). Phases A–F + authenticity cheat sheet.
  Hard constraints: no new deps, CSS-first motion, verify on demo :4006.
- No code changed; prod untouched.

## 2026-06-10 (round 3) — Full upstream sync into rr: shell framework + every OS app slice (DONE)

- **rr (`resources`) is no longer "basic"** — the whole mso feature set is
  now consumable from the catalog by any project (`npx rr add <slug>`):
  - **appshell 1.4.0** in rr = byte-synced to this repo's framework (Android
    Material-You rebuild, macOS dock behaviour, window store + snap geometry,
    UrlSync, shell registry minus the phantom "mobile" id, store-persist split,
    Clock/HomeIndicator/pull-down/swipe-close/overview-key, `useQuickLinks`
    capability + `QuicklinkIcon`). The 10 shell features (search/inspector/
    notifications/control-center/widgets/clipboard/share/quick-look/
    shortcut-help/lock-screen) synced into rr's bundled `appshell/features/*`.
  - **Dashboard shell LIFTED into the framework** (rr bundles it; brand via
    `useBrand`, stats via the capability seam) — mso keeps its consumer copy.
  - **12 app slices upgraded** in rr via per-slice 3-way merges that keep rr's
    self-contained `lib/host.ts` seams (mock adapters + `configure*()` for real
    wiring): browser (multitab/screencast/AI panel), os-terminal (exec emulator
    + injectable PTY), file-explorer, assistant, reel-editor, image-editor,
    app-store, media-viewer, system-monitor, image-picker (incl. the CSS-escape
    security fix), code-editor.
  - **3 new lifts**: media-studio 1.0.0, quicklinks 1.0.0, shell-settings 1.0.0
    (+ catalog entries, previews, agent.md). Skipped: os-settings (MSO-
    specific), create-app (already bundled in rr app-store).
  - rr gates all green: tsc · eslint 0 · vitest 448 · slices:check 68 slices.
- **Backported here from rr's lint-zero sweep** (keeps the trees
  line-mergeable): desktop.tsx snap-key ternary→if/else; InspectorAI drops the
  unused `appId` destructure. Behaviour identical — prod NOT redeployed for
  this; next deploy picks it up.

## 2026-06-10 (round 2) — Theme preset owns the typeface; font pipeline actually works now (DONE)

- **Font picker merged into theme presets**: the tweakcn preset's
  `cssVars.theme` font-sans/font-mono IS the typeface config — the separate
  "Font family" picker + `fontFamily` tweak are gone (legacy stored/synced
  values scrubbed on hydrate; `fontScale` a11y sizing stays). Preset chips show
  which face they ship.
- **Preset webfonts load for real** (`lib/appearance/presets/fonts.ts`):
  `applyPreset()` now injects ONE Google Fonts css2 link for the named families
  (local/system/Geist names skipped; offline degrades to the Geist fallback in
  the stack; `clearPreset()` removes it).
- **Two silent root-cause bugs fixed — no custom font EVER rendered before**:
  (1) Geist `variable` classes were on `<body>` while `:root --font-ui`
  referenced `var(--font-geist-sans)` → guaranteed-invalid custom property →
  body fell back to the Tailwind preflight stack; Geist classes moved to
  `<html>`. (2) `@theme inline { --font-mono: var(--font-mono) }` was a
  self-referential var() cycle that killed monospace tokens; chrome token
  renamed `--font-mono-ui` (terminal consumers updated).
- E2e-verified on demo: picking "Elegant Luxury" → computed body font Poppins,
  `document.fonts.check` true, link href carries Poppins+IBM Plex Mono; Stock
  reset removes the link and restores Geist (which itself renders for the first
  time). Zero console errors.

---

## 2026-06-10 — Shell parity sweep: Android rebuilt · Dashboard store-driven · wallpaper presets retired (DONE)

Two audits (provider/wrapper consistency + a 12-feature × 5-shell parity
matrix) drove this round; every gap found was built, not just listed.

- **Android shell rebuilt for parity**: status-bar row removed (user call: the
  SCREEN header goes, the wallpaper clock stays) — big clock + date back on the
  wallpaper; pull-DOWN on home now opens the REAL Control Center feature
  (`controlCenter` slot + `ShellUIProvider`; the fake wifi/bt Shade is deleted),
  via the new shared `usePullDown` hook (fires at threshold, pointercancel-safe,
  scroll-aware). Root is transparent so the shared `<Wallpaper>` (auto →
  `wp-material`, or the user's custom image) finally shows. `home` is derived
  from the pathname (iOS pattern) → deep links / back-forward work in Android
  now. Search pill → Spotlight. App header pads `--sai-top` (notch). Drawer
  close handle ≥36px hit; Recents ✕ 36px on coarse pointers.
- **Resume-don't-duplicate** (iOS + Android): a home tap on a running app now
  `focusApp`s its window instead of spawning a second one (Files used to
  multiply on every tap).
- **Dashboard shell store-driven**: dropped its private `route` state — panes
  are real store windows (`openWindow`/`minimizeWindow`, focused-window
  derivation), so URL sync, deep links and title sync work; added a Running
  sidebar section (resume/✕), an app filter, and the missing
  `[container-type:inline-size]` on the pane.
- **Windows shell**: ⌘Tab AppSwitcher + NotificationCenter mounted (clock is
  now the notifications button), F3 Task View via the extracted
  `use-overview-key` hook, Start menu closes on Esc.
- **macOS**: Launchpad gets a live search field + `inert` while closed (its ~20
  links were tab-reachable invisible); desktop context menu gains "Close all";
  Launchpad z drops to 8400 (was colliding with the clipboard overlay at 8500).
- **iOS**: status clock in the top safe-area strip (shared `<Clock>`); switcher
  ✕ 36px on coarse pointers.
- **Wallpaper presets retired**: aurora/dusk/mist/graphite/noir picker grid is
  gone from Settings → Appearance — theme presets own color identity; wallpaper
  is "auto" (per-shell native backdrop) or a custom image. Legacy stored keys
  coerce to "auto" on every hydrate path (`normalizeWallpaper`); shell-backdrop
  CSS (`wp-aurora/graphite/win11/material/ios`) stays.
- **Provider/wrapper audit fixes**: `AppRegistryProvider`+`ResponsiveProvider`
  hoisted above the feature-provider seam (a `FeatureDescriptor.provider`
  calling `useResponsive` no longer throws by construction); capabilities merge
  memoized + `undefined`-stripped; pre-hydration theme script kills the
  dark-mode light flash; Settings used raw `env(safe-area-inset-bottom)` and
  ignored the iOS +34px pill bump (now `var(--sai-bottom)`); profiles read
  `sv:shell` via the registry SSOT (`getShellPrefs`); `MOBILE_W` deduped;
  appearance/quicklinks context values memoized; phantom `"mobile"` ShellId
  deleted; mobile dock ids moved from a hardcode in generic appshell to
  `AppDescriptor.pinned` set by the MSO manifest.

---

## 2026-06-09 (round 2) — Mobile maximized: prefs sync · terminal key bar · deep-link fixes (DONE)

Phone testing surfaced the real gaps — everything below e2e-verified on prod
(Playwright login + device approval at 390×844, then revoked).

- **Cross-device prefs sync** (`4b7cf04`): phone no longer boots to fresh
  defaults (wrong wallpaper/theme, empty quicklinks, mock mode). Appearance
  tweaks + quicklinks persist to `~/.mso/prefs.json` (atomic 0600) via
  session-gated `/api/prefs` (mirrors `/api/config`). localStorage hydrates
  first, server wins on initial GET, changes debounce 1.5 s POST per section,
  last-write-wins. POSTs disabled until a GET succeeds (pre-auth defaults can
  never clobber server prefs); login fires `mso:authed` to re-pull without a
  reload. `wallpaperStyle` is computed → stripped both sides. Demo: zero calls.
  Device-specific state (window layout, clipboard, profiles, recents) stays
  local on purpose.
- **Terminal touch key bar** (`ce97b6a`): control-room-style accessory row for
  the PTY terminal — Esc, Tab, sticky Ctrl/Alt (arms next key-bar press OR next
  soft-keyboard char via xterm `onData` intercept; Alt = ESC-prefix), arrows,
  Home/End/PgUp/PgDn, ^C ^D ^L ^Z, `| ~ / -`, clipboard paste. Shows on
  `pointer:coarse` or compact panes; `pointerdown.preventDefault` keeps xterm
  focus + soft keyboard up. Mock/exec terminal unchanged (line-based, no bar).
- **Mobile Done resets URL** (`9bf592f`): `minimizeWindow` left `focused`
  intact so UrlSync never re-fired — URL stuck on `/files` after dismiss.
  UrlSync now derives from the *visible* (focused AND not-minimized) app;
  dismiss → `replaceState("/")`, deep-link onto a minimized app restores it.
  Also covers the Android shell home button.
- **Persisted layout vs deep links** (`29bc59b`, found by e2e): boot
  `hydrate()` rebuilt the store from `mso:layout` AFTER UrlSync opened the
  deep-linked window — returning devices got the grid or a stale URL rewrite.
  New `hydrateBoot()` merges (live windows keep id/payload/focus on top,
  persisted single-instance dupes drop, multi apps coexist via id remap);
  profile/layout apply keeps replace semantics. +7 store-persist tests.
- Tests 124 → **136**. Verified: PTY echo/history/^C through the key bar on
  prod, prefs file write + server-hydrate after localStorage wipe, deep-link
  with saved layout (Files focused over restored windows, URL intact), demo
  regression-free.

## 2026-06-09 — Hardening + Phase E responsive sweep + PTY terminal + stock search (DONE)

- **API hardening** (`dec2c5f`): `HostError` + `apiError` across all 35 `/api/v1`
  routes — curated messages pass through as 400 (they're UX), everything else is
  masked to "Operation failed" + logged server-side with the route name, so raw
  Node errors (ENOENT/EACCES with absolute paths) never reach the client.
  Dependency-free input validation (`readJson`/`requireString` kit in
  `lib/host/api-error.ts`, no zod) on exec + fs mutations; `verifySession` now
  requires a numeric `expires_at`. Tests 41→124 (session sign/verify, path
  bounds/symlink escapes, destructive-filter table, pty e2e).
- **A11y/UX** (`3602d0e`): specific aria-labels (window controls, browser nav,
  appearance swatches); settings config errors surface as a toast; loading spinners.
- **200-line rule** (`c123786`): files-manager `app`/`use-files` + browser
  `use-remote-browser` split into focused modules.
- **Phase 3+4 responsive sweep DONE** — browser, media-viewer, image-editor/
  media-studio (compact prop + pane-relative sheet), reel-editor compact tabs,
  app-store chips + `TouchList`, create-app `@xl` two-col, assistant composer
  safe-area + compact save-button fix. Container-first (`useContainer`/
  `@container`) throughout — no new `matchMedia`. Tracker: MOBILE-RESPONSIVE-PLAN.md.
- **system-monitor**: live process table — fixed a real `ps` parse bug
  (multi-word comm names broke the positional split in `lib/host/sys.ts`);
  compact card rows via `TouchList`.
- **Stock search**: `/api/v1/stock/search` — keyless Openverse by default,
  optional `OS_UNSPLASH_ACCESS_KEY` → Unsplash (key stays server-side).
  image-picker "Stock" tab is live with debounce/attribution/error states.
- **PTY terminal**: `node-pty` + `@xterm/xterm`. `lib/host/pty.ts` session
  manager (ring buffer + `Last-Event-ID` resume, 8-session cap, 30-min idle
  reap, `term.open`/`term.close` audited); `/api/v1/term/{open,stream,input,
  resize,close}` SSE bridge. Live mode = a real interactive shell (vim/top/ssh
  work); mock untouched; falls back to one-shot exec if the PTY fails.
- **Skipped on purpose**: response-shape unification. The error shape
  (`{ error: string }`) is already uniform via `apiError`; a full `{ok,data}`
  wrapper would be client churn for no user value.

---

## 2026-06-06 — Multi-shell OS: macOS · Windows 11 · Android · iOS · Dashboard (P1–P6 complete)

Ported the multi-shell system matured in app-rahmanef's appshell fork back into the
framework (two-way merge — close guards/winId/Button-sweep/dock deep-links all kept).
`registry/shells.tsx` + per-surface shell prefs (Settings → Appearance → Shell);
Windows 11 chrome (taskbar/Start/Snap-Assist, caption-button windows), Android
Material-You shell, Dashboard cockpit (os-shell consumer, single-pane over AppHost +
useSystemStats home), iOS NC pull-down + app long-press; chrome-aware snap re-tile
(WindowState.snapZone + applyChromeInsets); wallpaper=auto → per-OS presets. Lifted
to rr as appshell 1.2.0 (resources 2f653ea, all slice gates green). Tracker:
docs/MULTISHELL-PLAN.md (deleted 2026-07-30; `git show bccd0b1:docs/MULTISHELL-PLAN.md`).
Deployed: build + systemctl restart, site 200.

## 2026-05-31 — Phase 18: Maximize Next.js — addressable OS (routing/Link/Image) (DONE)

Stopped treating the shell as a client-only SPA (one route, all client state) and
leaned into Next App Router — **without touching the windowing model** (user keeps
multi-window OS; URL just mirrors the focused app).

- **Catch-all route** `app/[[...slug]]/page.tsx` replaces the single index page.
  A generic `UrlSync` (appshell core) mirrors the FOCUSED app + its launch path to
  the URL (`/files/home/rahman`, `/code`, `/terminal`). Deep links open that window
  on load; back/forward walks focus history. Two-way + loop-guarded (refs for
  pathname, live focus read from the store). Opt-out via `manifest.routing=false`.
- **History API, not router.push.** Opening a window is pure client state, so
  `UrlSync` rewrites the address bar with `window.history.push/replaceState` (Next 16
  syncs `usePathname`) — instant, no RSC roundtrip, no remount. router.push caused a
  full route transition + UrlSync remount on every open (caught + fixed in verify).
- **App slugs** assigned centrally in the manifest (`AppDescriptor.slug`, falls back
  to `id`) so app slices stay URL-agnostic: files/code/terminal/monitor/…
- **Link-based launch.** Dock + Launchpad render `<Link href>` (real anchors):
  ⌘/middle-click opens an app in a new tab (deep link); plain left-click stays an
  in-place window open (preventDefault → openWindow, URL synced by UrlSync).
- **Per-route metadata** — `generateMetadata` derives `<title>` from the slug
  ("Code — MSO"), verified server-side via curl.
- **next/Image** for browser favicons (fixed Google s2 host in `images.remotePatterns`).
  Host-fs images + the live Playwright screenshot stream stay raw `<img>` on purpose
  — dynamic/auth'd bytes the optimizer can't help with (documented in next.config).
- Shipped A→fix chain (`4987d7d` route+Link+Image · `4a72f36` loop fix · `d482513`
  History API). Verified on demo: deep-link /code + /files/home/rahman, dock→URL,
  back/forward focus history, 12 dock hrefs, server titles. prod :4005 + demo :4006 200.

---

## 2026-05-31 — Phase 17: AppShell framework — manifest-driven, features as slices (DONE)

Restructured the monolithic `os-shell` slice into a generic, rr-liftable shell
framework + pluggable feature slices. **Pure restructure — zero frontend change**
(parity-verified by before/after screenshots at desktop 1280 + phone 390).

- **`appshell` slice (generic, brand-free)** — the shell runtime/chrome moved here
  from os-shell: window store, surfaces (desktop window-mgr + iOS mobile shell),
  app registry, the pub/sub buses (toast/activity/inspector), and the chrome
  skeleton (menu-bar/dock/launcher/wallpaper/windows). Lifts to rr as-is.
- **One responsive source of truth** — `<ResponsiveProvider>` + `useResponsive()`
  replaced the two duplicate `useIsMobile` (inline + `@/hooks/use-mobile`).
  `useContainer()` + safe-area tokens. DRY primitives `AppFrame`/`MasterDetail`/
  `ResponsiveToolbar`/`TouchList` built + exported (adoption deferred — that's a
  frontend change).
- **Manifest-driven** — `<AppShell manifest>` is the single entry point; a project
  supplies `{ brand, apps, features }`. `FeatureRegistryProvider` + `<Slot region>`
  compose the surfaces from config (open/closed: add a feature = manifest edit).
  Brand (name/logo) now flows from the manifest into the menu-bar.
- **Features as slices** — `shell-search` (overlay/Spotlight), `shell-inspector`
  (rightPanel + AI), `shell-notifications` (toast + Dynamic Island), `shell-control-center`,
  `shell-widgets` (Today). Mobile features read surface state via a `ShellUI`
  context instead of props. Buses stay in core so apps don't depend on feature
  slices. `os-shell` is now a thin consumer: `shell.manifest.ts` (MSO brand +
  app list + features) + a re-export barrel, so all app slices stay untouched.
- Shipped per phase (A `7be0491` · B `7be0491` · C `08ed734` · D `cd716ab`),
  typecheck + build green each, prod :4005 + demo :4006 verified 200.

Lift-prep done (Phase F `ee2b7a9`): de-genericised appshell's last consumer
literals (persist key + idle name → manifest), de-Convex'd os-shell metadata,
added trios. Capability injection done (Phase G `b16ac0a`): appshell core no
longer imports `@/lib/{appearance,os-api}` — appearance + CPU readout come via
`manifest.capabilities`; mso adapts its store/host in `os-shell/capabilities.ts`.
The framework core is now brand- AND consumer-free (only the universal `cn`
helper remains). Verified behaviour-neutral (theme toggle, CPU chip, wallpaper,
device detection, mobile surface all intact).

Feature-slice capability injection done (`eb671fa`): the `shell-*` slices no longer
import `@/lib/*` either (except the universal `cn`). Their data deps now arrive via
`ShellCapabilities` — `useSearch` (Spotlight → `SearchHit[]`), `useSystemStats`
(Today widgets), `useChat` (scoped AI stream), `useServerToggle` (optional control-
center server tile). mso wires the real `@/lib` sources in `os-shell/capabilities.ts`.
The **entire shell** (core + features) is now consumer-free. Verified behaviour-neutral
(Spotlight search + theme command, mobile Today telemetry "CPU 61% 8 cores").

Remaining: adopt the responsive primitives across app UIs (the visible mobile
sweep — deferred, it changes the frontend).

---

## 2026-05-31 — Docs reconcile (DONE)

Docs had drifted: PLAN / ARCHITECTURE / DESIGN-RECONCILE / SLICE-CATALOG still
described Convex + the agent bridge (gone since Phase 15), and this log stopped at
Phase 14. Fixed: ARCHITECTURE + PLAN rewritten to the self-contained reality;
DESIGN-RECONCILE stamped ARCHIVE with a "what actually shipped" diagram;
SLICE-CATALOG re-keyed to the host contract + all 14 slices listed; this log
brought current. `MOBILE-RESPONSIVE-PLAN` flagged as not-yet-built (DRY primitives
`useResponsive`/`AppFrame`/`MasterDetail`/`ResponsiveToolbar`/`TouchList` = 0 files).

---

## 2026-05-30/31 — Phase 16: Files CRUD + DnD upload polish (DONE)

- **DnD upload of files AND folders** (`82ac15d`) — binary-safe. `lib/host/fs.ts`
  `uploadInto` (jailed, atomic tmp+rename, 100 MiB/file); multipart `/api/v1/fs/upload`;
  `webkitGetAsEntry` recursive walk (`read-drop.ts`); split Upload Files/Folder UI.
- **One-action New Folder + Spotlight folder search** (`5d46c6b`) — `cmd.newFolder`
  (mkdir → auto-select → inline rename); `searchFs` (dirs under `~/projects`, jailed,
  skips node_modules/.git/…) + `/api/v1/fs/search`; Spotlight opens apps AND folders.
- **Rename pre-selects the name** (`37c699c`) — typing replaces, Finder-style.
- **Demo FS persists to localStorage** (`2fee6a1`) — mock tree mirrored to
  `mso:demo-fs` so a visitor's sandbox survives reload (structure, not bytes).
- **Whole-window drop zone** (`15ace18`) — the entire Files window is a drop target
  (drops on toolbar/padding no longer fall through to the browser), with a "Drop files
  & folders" overlay + Uploading/Uploaded toasts + a flat-file fallback.

---

## 2026-05-30 — Phase 15: Self-contained pivot + security + MSO rebrand (DONE)

The big architecture change: **dropped Convex + the external Control-Room agent.**
mso now runs AS a host process and controls its own machine directly.

- **Self-contained host layer** — `lib/host/` (fs/exec/sys/paths) is the single
  facade for `/api/v1`; signed-cookie auth (`lib/auth/`, HMAC `OS_SESSION_SECRET` +
  password + device approval) replaced `@convex-dev/auth`. Layout/registry →
  localStorage; device allowlist + BYOK config → `~/.mso/*.json`. No Convex, no agent.
- **Security pass** (`4a293cd`) — append-only JSONL audit (`lib/host/audit.ts`,
  `~/.mso/audit.log`); exec destructive-command guard (`rm -rf /`, mkfs, dd,
  fork bomb…) bypass via `OS_EXEC_ALLOW_DESTRUCTIVE`; exec rate-limit; tight default
  FS scope (read+write = home + ~/projects); 24h sessions; README threat model.
- **Rebrand mso → MSO** (`56b3707`) — dropped the "OS" overclaim in all
  user-facing strings (it's a cockpit/utility, not an OS). Repo/service/domain slug
  unchanged.
- **os-browser to loopback** — Playwright service rebound 127.0.0.1:4002 (was 0.0.0.0);
  stale ufw 4002 docker-bridge rules cleaned.

---

## 2026-05-30 — Phase 14: Real browser (Playwright) — drivable + screenshots + persistent session (DONE)

The iframe-proxy couldn't beat google's CSP. Replaced it with a REAL headless
Chromium on the host (Playwright, Apache-2.0) — renders any site, drivable from
the CLI, with a persistent session/cache so logins stick + no per-site API needed.

- **Host service** `os-browser` (new repo `/home/rahman/projects/os-browser`,
  systemd, loopback :4002, secret-gated): `chromium.launchPersistentContext`
  (userDataDir `~/.mso/chrome-profile` = cookies/cache/session on disk). HTTP
  API: navigate/screenshot/state/content/click/type/key/scroll/back/forward/reload.
  ufw: docker0 + docker_gwbridge on 4002 (non-public).
- **mso**: `lib/agent/server.ts` `browserConfigured()`+`browserFetch()`; 11
  `app/api/v1/browser/*` routes (Convex-auth-gated → `172.18.0.1:4002`). Browser
  slice rewritten to a single REMOTE view: live screenshot `<img>`, click mapped to
  the 1280×800 viewport, keyboard/wheel forwarded, settle-poll after actions.
  Deleted tab-strip/new-tab/blocked-overlay (real browser needs none). Dokploy env
  `OS_BROWSER_URL` + `OS_BROWSER_SECRET` set.
- **CLI**: `~/.claude/skills/os/os-browser.sh` (go/shot/content/click/type/key/
  scroll/state/back/…) drives the SAME session — screenshots land in /tmp so they
  can be viewed. `/os-browser-list` rewritten to check the real service.
- Verified on host: google/github/HN/example all render (screenshots viewed),
  content extracted, session persists.

---

## 2026-05-30 — Phase 13: Browser fix + full function audit + /os-list, /os-browser-list (DONE)

- **Browser "tidak berfungsi" diagnosed**: backend was 100% fine (proxy renders with
  a valid token). Real causes were client-side: (a) token async-null → iframe
  flashed a 401, (b) in-page links escaped the frame → frame-blocked.
- **Fixes**: browser waits for `useAuthToken()` ("Establishing session…") + re-keys
  iframe on token (no 401 flash); proxy injects a click/submit interceptor →
  `postMessage({__osb,url})` → app re-proxies + syncs omnibar (in-page nav works).
- **Full live audit** (signed in via device-password, real token): **13/13 /api/v1
  functions 2xx** — sys stats/processes, fs list/read/usage/mkdir/write/move/copy/
  delete, exec, apps, proxy. Browser proxy RENDERS example/wikipedia/HN/httpbin/
  google (base+nav injected, X-Frame-Options stripped).
- **New skills**: `/os-list` (`~/.claude/skills/os-list/`, audit.js probes every
  endpoint + app→function matrix) and `/os-browser-list` (browser-check.js tests
  the proxy across real sites). Both sign in + run live.

---

## 2026-05-30 — Phase 12: Deep VPS browse + dynamic favorites + browser proxy + /os skill (DONE)

- **Tree bug fix (couldn't descend live)**: `DirChildren` built child paths from the
  REQUESTED path ("/") not the host's canonical path → "/projects" → outside roots.
  Now uses the agent-returned `r.path` as the base → full real tree browsable
  (home → projects → any depth).
- **Agent read = whole filesystem** (explorer.ts): `OS_AGENT_FS_READ_ROOTS` (set `/`
  in .env.local) — same access the pty already grants. WRITES stay bounded to
  home + ~/projects (`OS_AGENT_FS_WRITE_ROOTS`). read ops (read/usage) now follow
  read-roots, not write-roots.
- **Dynamic favorites**: FsList now carries `roots` + `parent`; the agent returns
  Home / Projects / Filesystem; mock returns its shortcuts. Files sidebar renders
  favorites from `roots` (no more hardcoded /Media that 404 on the VPS). Portable
  `~` = home in both adapters (mock norm maps "~"→"/"); Files + both trees default
  to `~`, with `/` reachable via the Filesystem root.
- **Browser actually works**: `app/api/v1/proxy` (Convex-token-gated via query)
  fetches the page server-side, strips X-Frame-Options/CSP, injects `<base>` →
  iframe renders. (Limits: omnibar nav only; in-page links/heavy-SPA/auth-walled
  still constrained.)
- **`/os` skill** (`~/.claude/skills/os/`): playbook + `os.sh` to drive the VPS via
  the agent endpoints (ls/cat/write/mkdir/rm/mv/cp/exec/usage) — same bridge the
  browser shell uses. Smoke-tested.

---

## 2026-05-30 — Phase 11: Shared live file-tree + AI Inspector (every app) (DONE)

Two cross-cutting features. tsc + build green.

**Shared live file-tree** (`components/shared/file-tree/`, import `@/shared/file-tree`):
- Reusable recursive tree that **lazy-loads each dir via OsApi fs.list** (mock OR
  the real VPS in Live mode → syncs the host), expand/collapse, selection, and
  **inline create-file / create-folder** (hover affordance per folder) + refresh.
- **code-editor**: dropped the static seed tree (deleted components/file-tree.tsx
  + SEED_TREE) → mounts the shared `<FileTree>`; onOpenFile routes through
  `useEditor.open` which fs.read's the live file.
- **files-manager**: added `<FileTree>` to the sidebar (Favorites top · tree
  scrolls middle · Storage bottom). Folder click → navigate main pane; file click
  → new `cmd.openPath` (code-editor / media-viewer handoff).

**AI Inspector** (os-shell, ⌘I / menu View + ✨ status button):
- `os-shell/lib/inspector.ts` — typed module bus (mock-os OSBus pattern made real):
  apps `usePublishInspector(appId, {subject, props, actions, context, suggestions}, deps)`
  to publish their live state + callable actions. Keyed by appId; panel reads the
  FOCUSED app's descriptor.
- `components/inspector.tsx` — right-docked panel, tabs **Properties** (live state
  rows + one-click actions) | **AI** (`inspector-ai.tsx`: scoped Alfa chat — prepends
  the app's context + props so replies are grounded in what you're looking at;
  reuses the real /api/assistant stream, moved to neutral `lib/ai/stream.ts` to
  avoid a slice cycle). Suggestion chips per app.
- **All 14 apps publish descriptors**: browser (URL/title/tabs/bookmarks + reload/
  newtab/bookmark/home), code-editor (file/lang/lines/unsaved + save/new),
  files-manager (path/items/selected/storage + newfolder/refresh/empty-trash),
  media-studio, media-viewer, reel-editor, system-monitor (cpu/mem/disk/procs/mode
  + refresh), os-terminal (cwd/cmds/mode + clear), os-settings, app-store,
  create-app, assistant. Each wired to REAL state/handlers.

---

## 2026-05-30 — Phase 10: Live backend — fs write + exec + real render (DONE)

Closed the 4 "still mock" gaps so the OS actually drives the VPS. tsc + build green.

**Agent (vps-rahmanef, live systemd `vps-control-room-agent`)** — additive, CR not
touched:
- `agent/src/fs/mutate.ts` — read/write/mkdir/delete/move/copy/usage, **same
  allowed-roots bounds as the read explorer** (home + ~/projects), symlink-resolved
  before the check; atomic write (tmp→rename); refuses to modify a root.
- `agent/src/exec/run.ts` — one-shot shell (`/bin/bash`), cwd bounded to roots,
  30s timeout, 1 MiB output cap → `{stdout,stderr,code}`.
- Registered `GET /fs/read|/fs/usage`, `POST /fs/write|/fs/mkdir|/fs/delete|/fs/move|
  /fs/copy|/exec` in `health-server.ts`, all behind `requireGatewayAuth`.
- Built + restarted; smoke-tested via loopback: all ops OK, `/etc/passwd`→400
  (bounds hold), no-auth→401, real `whoami`/disk. Agent still 0.0.0.0:4001,
  CR frontend `active`, container→172.18.0.1:4001/health 200.

**mso frontend:**
- OsApi `exec` simplified to one-shot `run(cmd, cwd?) => {stdout,stderr,code}`
  (dropped unused pid/stream/kill) across types + mock + http adapters.
- 9 new `app/api/v1` proxy routes (fs read/write/mkdir/delete/move/copy/usage,
  exec/run, apps) — Convex-auth-gated, same pattern as fs/list.
- `sys/processes` now REAL (parses `ps` via exec) instead of `[]`.
- **os-terminal**: Live mode wires mkdir/rm/mv/cp/touch to OsApi fs; unknown
  command → host shell passthrough (`exec.run`). Mock UX unchanged.
- **files-manager** mutations (already wired) now hit the real VPS in Live.
- **reel-editor**: fake progress bar → **real client-side render** (Canvas 2D →
  `MediaRecorder` → downloadable `.webm`), real progress + cancel. No ffmpeg/deps.
- **runtime-app**: non-html installed apps → live exec console (Run → `exec.run`
  → stdout/stderr/exit), replacing the static manifest card.

Parity now ~100% depth / 100% coverage. Live mutations + exec + render all real;
behind device-approval auth + gateway secret + non-public agent (ufw DROP).
Remaining non-goals: interactive pty (vim/top) — one-shot exec only; audio in
reel render (canvas stream is video-only).

---

## 2026-05-29 — Phase 9: Finish all apps (full parity sweep) (DONE)

Lifted every below-par app to ~full mock-os parity (7 parallel subagents, each
its own slice, rr-clean ≤200 lines/file, mock-backed). tsc + build green.

- **reel-editor** (55→~90): comp presets + fps, clip drag/resize/split/dup/move,
  per-clip keyframes + lane graphs, clip props + text entrance anims, live
  preview canvas, undo/redo, NL "AI edit", mock render overlay, shortcuts.
- **media-studio** (65→~90): clip masks, safe-area guides, HTML-embed + image
  layers, per-layer custom CSS, JSON/HTML import, real undo+redo (50-deep,
  debounced), color palette, JSON/HTML export modal.
- **assistant** (35→~85): tabbed Chat/Agents/Skills/Automations + agent/skill/
  automation editors + grouped tool picker (localStorage). Chat still the REAL
  Claude stream; active agent persona prepended to the sent messages.
- **media-viewer** (70→~90): audio waveform player, video transport, image
  zoom + dims + checkerboard, type chip, download, open-in-editor handoff.
- **files-manager** (75→~90): drag-drop move, Trash (~/.Trash + Empty Trash),
  real file-picker upload, selected-item details strip.
- **os-settings** (75→~90): About pane (version + live sys/storage + Reset),
  Server test-connection chip, reduce-transparency (already had shell-style).
- **mobile shell** (60→~85): status bar (clock + signal/wifi/battery), home
  grid + dock + page dots, app-switcher (swipe-up cards, tap-focus, swipe-to-
  close), home-indicator drag gestures.

Already ≥80% and left as-is: browser, app-store, create-app, system-monitor,
os-terminal. Parity now ~88% depth, 100% app coverage.

---

## 2026-05-29 — Phase 8: Dynamic app registry + modular polish (DONE)

Made the app layer **dynamic** (apps added at runtime appear live) while keeping
slices **modular** (each self-contained behind its barrel; one declarative list).

Core (shell + Convex):
- **Window payload**: `openWindow(app, title, size?, payload?)` + `WindowState.payload`;
  every app component now receives a `payload?: unknown` prop (`AppProps` exported
  from os-shell). Re-open with new payload updates + focuses.
- **Convex `features/apps`**: per-owner runtime app registry — `create`,
  `setInstalled`, `remove`, `listInstalled`, `listAll`. 
- **Dynamic registry**: `app-store/lib/use-installed-apps` turns installed rows
  into `AppDescriptor`s (icon via a glyph→Lucide map; `RuntimeApp` host renders
  html entries in a sandboxed iframe, else a manifest card). `app/os-root.tsx`
  now merges `BUILTIN_APPS` + `useInstalledApps()` inside the auth boundary —
  no more hardcoded-only list.

Wired (subagents, parallel, disjoint slices):
- **create-app** → real Create App form (name→slug, runtime autofill, glyph +
  gradient picker, live manifest preview) → `apps.create` → app appears in dock.
- **app-store** → 6-app catalog merged with live install state; Get/Uninstall →
  `apps.setInstalled`; installed apps surface in dock/launchpad.
- **open-file-by-payload** → files-manager routes a file to code-editor (`{path}`,
  read via fs.read) or media-viewer (`{path,name,kind}`, remote→"open in editor"
  handoff) through `openWindow` payload.
- **shell** → full menu bar (File/Edit/View + existing os-rr/app/Log Out) + a
  toast system (`lib/toast` store + `ToastHost`, barrel-exported for any slice);
  Spotlight fires toasts on run.
- tsc green, build green. Parity now: app coverage 100%, depth ~80%, registry
  modular + dynamic.

---

## 2026-05-29 — Phase 7: App parity sweep + live host bridge ON (DONE)

Raised feature parity across the 6 thinnest apps (parallel re-author from
`mock-os/`, rr-clean, ≤200 lines/file) AND turned the real-VPS file bridge on.

**Parity upgrades** (each its own slice, mock-backed, shadcn/tokens):
- files-manager → grid/list, breadcrumb + back/fwd, favorites sidebar, multi-
  select, context menu, cut/copy/paste, rename, new-folder, storage bar, sort,
  open-by-ext. Added `fs.move`/`fs.copy` to the OsApi contract (types + mock +
  http). Live mutations fail gracefully ("read-only on live host").
- code-editor → multi-tab, file-tree explorer, Cmd+S save, status bar, new file.
- browser → back/fwd/reload/home + bounds, per-tab history, security icon,
  loading bar, bookmarks + bar, new-tab quick-links, blocked-site overlay, menu.
- os-terminal → 17-command shell (ls/cd/cat/mkdir/rm/mv/cp/df/ps/neofetch/…),
  cwd, history arrows, colored prompt; ls/cat hit OsApi fs live.
- media-studio → tools (V/T/R/O/S), layers (vis/opacity/reorder/rename), 5
  aspect presets, 8 filter chips, per-layer transform, zoom, Export JSON, undo.
- system-monitor → 4 circular gauges (CPU/Mem/Disk/GPU-mock), CPU + net
  sparklines (rolling), process table (host placeholder when empty).
- tsc green, build green.

**Live host bridge ENABLED** (real VPS directory listing):
- Agent (vps-rahmanef, systemd `vps-control-room-agent`) was loopback-only
  (127.0.0.1:4001) → unreachable from the Dokploy swarm container. Rebound to
  `AGENT_HEALTH_HOST=0.0.0.0` (keeps loopback for the CR frontend, which calls
  127.0.0.1:4001 — CR NOT broken) + restarted. ufw INPUT policy is DROP, so
  4001 stays blocked from the public iface.
- The mso swarm task egresses via `docker_gwbridge` (172.18.0.x); added
  `ufw allow in on docker_gwbridge to any port 4001`. Verified from inside the
  live container: `http://172.18.0.1:4001/health` → 200.
- Set Dokploy mso env `OS_AGENT_URL=http://172.18.0.1:4001` + `OS_AGENT_SECRET`
  (existing env preserved). Flip Settings → Server → **Live** to list the real
  VPS tree. Agent fs is **read-only** (only `/fs/list`) — listing is real,
  mutations stay mock/local.

Security: agent reachable from host containers + tailnet, NOT public (ufw DROP +
only docker0/docker_gwbridge allowed on 4001); every call still gated by the
mso Convex-auth route + the agent's `x-control-room-secret`.

---

## 2026-05-29 — Phase 6B: BYOK AI assistant (DONE, deployed)

Alfa now talks to a real Claude model. BYOK: the Anthropic key lives in Convex
(owner config) or falls back to the server `ANTHROPIC_API_KEY` env.

- `features/appConfig` — owner singleton {anthropicApiKey, model}. `getConfig`
  (masked: hasKey + last-4 + model), `getApiKey` (raw, server-route only),
  `setConfig` (requireUser). Key is write-only from the UI.
- `app/api/assistant/route.ts` — Node-runtime SSE stream. Auth-gated by the
  caller's Convex Bearer (`authedConvex` in `lib/agent/server.ts`, added next to
  `verifyAuth`). Resolves key = Convex BYOK || `ANTHROPIC_API_KEY`; 501 if none.
  `@anthropic-ai/sdk` `messages.stream`, model default `claude-opus-4-8`
  (configurable), `system` block with `cache_control: ephemeral`, thinking off
  for snappy chat + final-answer-only system instruction. Emits `delta`/`done`/
  `error` SSE events; last-20-turns context window; max_tokens 4096.
- `assistant/lib/stream.ts` — client SSE reader → async generator of text
  deltas, sends history + `useAuthToken()` Bearer. Replaced the mock engine
  (deleted `lib/engine.ts`); `app.tsx` streams real tokens, maps error codes to
  friendly notes.
- Settings → **AI (Alfa)** panel (`os-settings/components/ai-section.tsx`):
  password key field (shows masked), model field, Save. Reactive via Convex.
- tsc green, build green (`/api/assistant` route present), convex deployed.

Note: no key is committed. Until the owner pastes a key in Settings (or
`ANTHROPIC_API_KEY` is set on the Dokploy frontend env), the assistant returns
a "no key" note. Caching: system prompt is < the 4096-token min, so it won't
actually cache yet — the breakpoint is in place for when the prompt grows.

---

## 2026-05-29 — Phase 6A: Device-approval auth (DONE, deployed)

Replaced email/password with the Control Room device-approval model, mapped
onto Convex + `@convex-dev/auth`. Auth portal guard hardened:

- **Factor 1**: shared password in backend env `OS_LOGIN_PASSWORD` (set to the
  owner password). Checked constant-time in `convex/auth.ts`; fail-closed if
  unset/short → nobody gets in.
- **Factor 2**: the device must be `approved` in the new `devices` table. A
  correct password on a new device registers it `pending` and throws
  `device_pending` — **no token is issued until approved**. So any authenticated
  session ⇒ approved device (the gate is at token issuance, not just UI).
- `convex/auth.ts` → `ConvexCredentials({ id: "device-password", authorize })`;
  single shared owner account (`createAccount`/`retrieveAccount`, no per-account
  secret — the device IS the credential).
- `features/devices`: `touch` (internal, called post-password from authorize),
  `approve`/`revoke` (mutation, requireUser = approved device), `listDevices`
  (query), `bootstrapApprove` (internal, CLI-only for the first device).
- Login UI: password-only + a "pending" panel showing the device id (copyable)
  + "Check again". Settings → **Devices** panel (reactive list, approve/revoke,
  "This device" badge). New `auth/lib/device.ts` (128-bit hex id in localStorage).
- Bootstrap path (first device, no approver yet):
  `npx convex run features/devices/mutations:bootstrapApprove '{"deviceId":"<id>"}'`.
- tsc green, build green, convex deployed to api-os.

Caveat: revoke takes effect on next token refresh (≤ refresh-token TTL); the
gate is at sign-in. Old email/password users/accounts are now orphaned (unused).

---

## 2026-05-29 — Phase 5: Spotlight ⌘K command palette (DONE)

Cleared the top autonomous backlog item. macOS-style Spotlight over the whole
desktop — open any app + run shell actions from one box.

- `os-shell/components/spotlight.tsx` — ⌘K/Ctrl+K palette: subsequence search
  (typing "cdr" → "Code Editor"), Arrow/Enter/Esc nav, mouse hover sync, glass
  sheet. Sources: all 12 apps (open) + actions (Launchpad, Minimize all, Close
  all, Toggle theme). ≤200 lines, shadcn/token styling, no fuzzy lib.
- Store: `spotlightOpen` state + `setSpotlightOpen`/`toggleSpotlight` +
  bulk `minimizeAll`/`closeAll` ops; `useSpotlightOpen` hook.
- Global ⌘K hotkey in `desktop.tsx` (works desktop + mobile); Search button in
  the menu-bar status cluster.
- tsc green, `next build` green.

Remaining backlog is BLOCKED on user decisions:
- Real AI assistant — needs `ANTHROPIC_API_KEY` (none in env/`.env.local`).
- Live VPS data — needs prod agent-bridge reachability (infra call:
  rebind+firewall vs Traefik expose). Mock keeps prod up until decided.
- Phase 3b live exec/pty terminal — depends on the same prod reachability.

---

## 2026-05-29 — Phase 4: Full app suite (DONE)

Maximized the os-rr app set — every prototype app now exists as a best-practice
rr slice (re-authored from `mock-os/`, not copied). 8 new app slices built by
parallel agents, each shadcn + theme tokens + ≤200 lines/file + metadata trio,
self-contained mock data (data layer wires later via OsApi):

- `code-editor` — gutter + overlay textarea + regex syntax highlight; fs.read/write.
- `media-studio` — tool rail + canvas (live CSS filters) + adjust/layers panel.
- `reel-editor` — multi-track timeline, playhead, transport, clip props, mock render.
- `browser` — omnibar + tabs + sandboxed iframe.
- `media-viewer` — image (zoom)/video/pdf preview, offline data-URI samples (noDock).
- `app-store` — catalog grid, search, category filter, install toggle.
- `create-app` — manifest form (name/runtime/accent/desc) + live icon preview.
- `assistant` — "Alfa" chat UI, streaming local mock engine (TODO: real /api route).

Registry now mounts 12 apps (`app/os-root.tsx`). Added shadcn primitives:
textarea, slider, badge, tabs. tsc green, `next build` green.

Backlog: real AI (Anthropic via /api/assistant), live data for these apps once
the prod agent bridge is decided, Spotlight ⌘K command palette.

---

## 2026-05-29 — Phase 3: Live host bridge (CODE DONE, locally verified)

Wired OsApi `live` mode to the real Control Room host agent — securely.

Design: browser → **same-origin `/api/v1` route handlers** (Convex-auth-gated)
→ host agent with `x-control-room-secret`. The agent stays loopback-private; its
gateway secret is server-only env (`OS_AGENT_SECRET`), never in the browser.

- [x] Studied the agent auth guard (`vps-rahmanef/agent/src/terminal/auth.ts`):
      JSON API gated by `x-control-room-secret` (timing-safe), pty WS by HMAC
      `session` cookie, binds 127.0.0.1:4001, fail-closed (<32-char secret).
- [x] `convex/me.ts` `getMe` — server-side session verification probe.
- [x] `lib/agent/server.ts` — `agentFetch` (adds secret) + `verifyAuth`.
- [x] Route handlers: `/api/v1/sys/stats` (→ agent `/health` telemetry),
      `/api/v1/fs/list` (→ agent `/fs/list`), `/api/v1/sys/processes` (→ `[]`).
- [x] OsApi live mode → same-origin base + Convex Bearer token (`useAuthToken`).
- [x] **Local e2e verified** vs the running agent: no-token→401; with token→real
      cpu/mem/disk telemetry + real `/home/rahman` listing.
- [ ] **PROD reachability** — Dokploy container can't reach the loopback agent;
      needs an infra decision (rebind+firewall, or Traefik expose). NOT done
      unilaterally — prod live mode returns 501 until decided; mock keeps prod up.
- Deferred Phase 3b: live `exec`/pty terminal (agent `/terminals` + `/ws/terminals`).

---

## 2026-05-29 — Phase 2: Auth & Convex persistence (DONE)

Made the deployed Convex backend real — OS gated behind `@convex-dev/auth`,
window layout persisted per-user to `features/windows`. (Re-sequenced after the
Phase 3 deploy; auth is the prerequisite for any Convex-backed UI.)

- [x] Self-hosted auth keys set on backend: JWT_PRIVATE_KEY + JWKS (RS256, via
      `sc-convex/set-auth-env.js` REST — avoids the CLI `--` PEM bug) +
      SUPER_ADMIN_EMAIL. CONVEX_SITE_ORIGIN/CLOUD_ORIGIN already container-level.
- [x] PBKDF2 password hashing in `convex/auth.ts` (Scrypt times out behind the
      Dokploy proxy → "connection lost").
- [x] `auth:*` actions routed via `ConvexHttpClient` (WS reconnect mid-flight
      aborts in-flight actions) — `app/ConvexClientProvider.tsx`. Switched from
      the nextjs server provider to `@convex-dev/auth/react` ConvexAuthProvider.
- [x] `convex/_generated` committed (un-gitignored) — frontend imports typed
      api; Docker build has it (no codegen in image).
- [x] `auth` slice: Password sign-in/up `LoginScreen` + `AuthGate`
      (Authenticated/Unauthenticated/AuthLoading). Log Out in the menu bar.
- [x] `os-shell` layout persistence → Convex `windows.getLayout`/`saveLayout`
      (localStorage instant cache, Convex authoritative, debounced).
- [x] tsc green (now incl. convex), `next build` green, shipped.

Note: backend env keys (JWT_PRIVATE_KEY/JWKS) are stored on the Convex
deployment only — NOT in the repo. Rotating = re-issue all sessions.

---

## 2026-05-29 — Phase 3: Ship (DONE)

Live: https://mso.rahmanef.com + Convex self-hosted https://api-mso.rahmanef.com
(+ site-os / dash-os), all HTTP 200. Repo `git@github.com:rahmanef63/mso.git`.

- Canonical `si-coder deploy.js`: GitHub repo + push, Dokploy project/app
  `mso` + compose `mso-db` (Convex template), admin-key gen, schema push
  (auth + windows + systemMonitor indexes), Hostinger DNS (os/api-os/site-os/
  dash-os), frontend build → `done`.
- pnpm Dockerfile (`ARG NEXT_PUBLIC_CONVEX_URL` build-arg inlining).
- Disabled `cacheComponents` (dynamic app; was blocking prerender on auth cookie).
- `next lint` removed in Next 16 → placeholder; typecheck is the CI gate.
- sc-git pre-push hook installed → `convex/` pushes auto-deploy.
- Admin key in gitignored `.env.local`.

---

## 2026-05-29 — Phase 1: Design reconcile (DONE)

Adopted the `mock-os` (os-rr) macOS-style design, re-authored into rr slices.

- globals.css → os-rr glass tokens (light/dark, accent, 5 wallpapers, traffic
  lights). `lib/appearance` (theme/accent/dir/wallpaper/server cfg).
- `lib/os-api` — the VPS boundary: MockAdapter ↔ HttpAdapter (os-rr Cloud API
  contract). Convex = auth/persistence; OsApi = host hot path.
- os-shell rebuilt: menu bar (live sys stat), glass dock, traffic-light windows
  + edge-snap/maximize, launcher, wallpaper, mobile shell.
- Apps: system-monitor + os-terminal rewired to OsApi; new files-manager +
  os-settings. Default light/aqua/aurora.

---

## 2026-05-29 — Phase 0: Foundation (DONE)

rr-conventional scaffold (Next 16 + React 19 + Tailwind 4 + Convex self-hosted
+ @convex-dev/auth). os-shell window manager, system-monitor, os-terminal;
Convex features windows + systemMonitor. Docs + mock/ placeholder. tsc green.

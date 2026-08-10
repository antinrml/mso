# mso — Progress Log

Running log of what shipped each phase. Newest at top.

> **Architecture note:** Phases 0–14 below were built on **Convex self-hosted +
> a Control-Room host-agent bridge**. That stack was **removed** in Phase 15 —
> mso is now a self-contained Next.js app (`lib/host` + signed-cookie auth).
> Read those phases as history. **This file is the source of truth for what exists** —
> `ARCHITECTURE.md` is no longer maintained and carries a stale-warning banner.

## 2026-08-10 — audit follow-up: −4.4k lines, two eager chains off first load (DONE)

A 13-agent audit (6 dimension scanners, each with an adversarial verifier that had to
refute its own dimension's claims, then a synthesis pass). 48 claims, **41 survived, 7
were killed** — and the kills were worth as much as the finds. Shipped in five commits.

**Behaviour fixes.**
- `/api/prefs` was fetched **twice on every load** — the appearance and quicklinks
  providers each pulled the whole 1.6 KB blob to read one key, both outside AuthGate,
  and both retry on window focus, so a signed-out tab-back fired two 401s. One shared
  in-flight promise, cleared on settle so the retry still refetches.
- **A failed app-chunk import left a spinner forever.** `window-content.tsx` caught the
  rejection and dropped it — which also disabled the recovery its own comment named:
  `register-sw.tsx` self-heals a stale chunk from `unhandledrejection`, and a *handled*
  rejection never fires that event. It now shows the failure with a reload button and
  rethrows. This is the deploy-day path (new build, old chunk ref), so it mattered.
- **Spotlight reported a dead host API as "No matches"** — indistinguishable from an
  empty result, so an expired session looked like an empty folder. It keeps the error.
- `ResponsiveProvider` allocated a fresh state object on every `resize`, so React's
  `Object.is` bailout could never fire — and this value is read at the shell root, so
  every event re-rendered the whole tree, each one paying a synchronous
  `getComputedStyle`. Now one rAF-coalesced measurement that bails when the geometry
  is unchanged. Mobile fires `resize` on every URL-bar collapse and keyboard open.

**a11y** (all pure additions): dock app icons had **no accessible name** at all (a
`<Link>` around a lucide `<svg>`; the hover panel holding the title is `invisible`, so
out of the a11y tree) — ~20 blank links. Login errors had **no live region anywhere in
the auth slice**, so "Incorrect password." was silent; the password field had only a
placeholder. Android recents cards were pointer-only `div`s. The toast stack was pinned
at a hardcoded 36 px while iOS floors `--sai-top` at 44, so it opened under the notch.

**Perf — two eager chains, both measured on the live build.**
1. One **267 KB** chunk (82 KB gzip) in the initial `<script>` set carried macOS chrome
   *and* iOS chrome *and* all 10 shell features to every visitor, because `DesktopChrome`
   shared a module with `Surface`. It moved to `components/shells/macos/`; all five
   shells now register through `register-shells.tsx` with `lazy()`. −68 KB on a phone,
   −42 KB on a desktop.
2. `installAlfaSources()` ran at module scope, so every signed-in load pulled the host-tool
   catalog + its 12 `run()` closures + agent presets (**88 KB**) into the initial bundle
   AND fired `GET /api/skills` — **90 serial `SKILL.md` reads, 602,672 bytes off disk,
   60–80 ms**, for a menu nothing renders until the user types `/`. os-shell registers a
   *loader* now; the composer's first render pulls it, and the skills fetch waits for the
   first `/`. Both needed a subscribe/notify seam, because the composer computes its item
   list during render on purpose — see `chat-composer.tsx:45`, which documents the exact
   bug a `useMemo` reintroduces here.

**Deleted, ~2.0k lines of code + ~1.7k of docs**, each verified to have zero consumers:
the `os-browser` Playwright sidecar's source (unit stopped *and* disabled for months, no
`/api/v1/browser` route, Browser has been Camoufox for two rewrites), the e2e shell
harness (`e2e.sh:12` pointed `$BROWSER` at a script that does not exist, so all 7 checks
aborted on line 17), Share + Quick Look (registries with no producers — the only callers
of `openQuickLook`/`share` were the `?e2e=1` commands), cross-app DnD (the one `setData`
in the tree writes `text/plain`, never the payload mime, so the read half could only ever
return null), `AppHeader`/`AppInspector` + the vaul drawer branch behind it, shell-settings'
unreachable half, the manifest's never-set `routing`/`titleSync` flags, `publicProxyUrl` +
`PROXY_BLOCKED_EXTERNALS`, `hostOf`, `resolveModel`'s `info` option, `assetDir` + two dead
env vars, and 5 finished plan docs. `multipart.ts`'s hand-rolled O(n·m) subsequence scan
and copy-concat became `Buffer#indexOf` / `Buffer.concat` (`buf` had to become a Buffer:
`Uint8Array#indexOf` searches for a single byte value, not a subsequence).

**Two of PROGRESS's own "deliberately NOT cut" entries were reversed** (`os-browser/`,
`scripts/e2e*`) — see the note at the 2026-08-03 entry. `AUDIT-2026-06-11.md` was NOT cut:
its stated reason, five source comments citing it by finding number, still holds.

**What the verifiers killed, which is the more useful half.** Deleting the 3 non-default
OS personas (~2,000 lines) — reachable three ways (Settings picker, desktop right-click
"View as", a palette command each). Spaces + session Profiles — "palette-only" is not
unreachable when ⌘K *is* the launcher. `defineFeature`/`Slot` as dead configurability —
`shell.manifest.ts:80` injects an 11th feature through it and the App Store's feature
toggles filter on it. `SHELL-FIDELITY-PLAN.md` — a live *unstarted* roadmap whose §8 table
is where `globals.css`'s live `--shell-*` tokens come from. A contrast-script "134 hidden
failures" — arithmetic over two JSON keys that never co-occur; acting on it would have
broken four presets. And "optimize `/api/skills?name=X`" — 🔒 `name` is raw user input
validated **nowhere else**; the enumeration allowlist is the only thing making `../`
structurally impossible, so the proposed `path.join` reopens traversal.

## 2026-08-04 (hydration, final) — the fourth cause closed; zero mismatches anywhere (DONE)

The architectural one the previous entry deliberately left open.

**The shell now renders only after mount.** Which shell to draw depends on three things
the server cannot know — the viewport (`useResponsive` measures `window.innerWidth`), the
persisted per-surface choice (`localStorage` `sv:shell`) and the wallpaper preference — so
SSR always guessed desktop/macOS and a phone client then rendered iOS. Two different trees
is a guaranteed mismatch, and React answered by discarding the hydrated tree and
re-rendering the entire shell client-side. Because Radix derives ids from `useId`, the
divergence surfaced in the dev overlay as mismatched `DropdownMenuTrigger` ids — a symptom
that sent the first look at it in the wrong direction.

`Surface` now returns a skeleton (`#main-content` + sizing + `bg-background`) until a
one-shot post-hydration flag flips, so the server HTML and the tree React hydrates are
identical by construction.

**This is an improvement, not a trade-off, on the UX side.** The old behaviour PAINTED the
macOS desktop on a phone and then swapped it for iOS — a flash of the wrong operating
system. A brief flash of the themed background is strictly better, and `bg-background` is
already the right light/dark value because the pre-hydration script in `app/layout.tsx`
sets `data-theme` before first paint. Nothing is lost to SEO: the catch-all is fully
dynamic and auth-gated, and the shell was never usable without JS.

**The measured cost, stated plainly: mobile LCP 160 ms → 320 ms**, because the shell is no
longer painted from SSR. Desktop LCP 380 → 420 ms. Both remain far under the 2500 ms
"good" threshold, and desktop CLS improved 0.008 → 0.001. The old 160 ms was painting a
shell that was then thrown away and rebuilt, so it was never a real 160 ms to the content
the user wanted.

**Verified end to end on the production build:** hydration clean on desktop and mobile,
**0 JS errors across all 17 apps in both mobile shells** (was 17/17 erroring), 17/17 still
render, shell resolution still correct (390 → ios, 412 → ios, 1280 → macos), no horizontal
overflow, skip link and its `#main-content` target both intact, smoke 4/4. Mobile
sub-24 px touch targets are down to one — the `sr-only` skip link, which is 1×1 by design.

## 2026-08-04 (hydration + mobile polish) — three of four hydration mismatches killed (DONE)

Chasing React #418, which had been firing on every page load and every app. A hydration
mismatch is not cosmetic: React discards the hydrated tree and re-renders the whole shell
on the client. Localised with a **non-minified dev build in a throwaway `git archive`
tree on :4007** — the minified production message names nothing. Four distinct causes,
three fixed.

1. **The `nonce` attribute on the theme-restore inline script.** Browsers blank the
   `nonce` content attribute once CSP has consumed it (anti-exfiltration), so the DOM
   reports `nonce=""` while the server HTML carried the real value. Dev build showed it
   verbatim: `+ nonce="NjA3NDAxNWIt…"` / `- nonce=""`. Fixed with
   `suppressHydrationWarning` on that one script. The nonce itself must stay — proxy.ts
   mints it per request and the strict CSP will not run the script without it.
2. **`useWidgetState`'s `getServerSnapshot` returned the live `state`.** React uses
   `getServerSnapshot` for the *first client render while hydrating*, and by then the
   module-level `state` had already been read from `localStorage`. So the server rendered
   the desktop widget layer off and hydration rendered it on, throwing the whole tree
   away. Now returns a frozen SSR default matching `load()`'s no-localStorage branch.
3. **`Clock` could not match, for two independent reasons**: it captures `new Date()` at
   SSR time and again at hydration time, and `toLocaleTimeString`/`toLocaleDateString`
   resolve against the *server's* locale during SSR and the *browser's* on the client.
   Both are named on React's own hydration-mismatch page. `suppressHydrationWarning` on
   each branch — which is precisely the attribute's purpose — keeps the server text (no
   layout shift) and lets the client correct it on the next tick.

**Result: the home route is hydration-clean on desktop and mobile in the production
build.** Verified against :4005, not just dev.

**STILL OPEN, and architectural rather than a bug.** Deep-linking into an app at phone
width still mismatches. The dev trace points at a Radix `DropdownMenuTrigger`'s
`useId`-generated `id`, which is a *symptom*: `responsive-provider.ts`'s `initial()`
deliberately returns **desktop** for SSR, so the server renders the macOS shell (menu bar
full of dropdowns) while the client computes mobile and renders iOS. Different trees →
different `useId` sequence. Closing it means changing what the server renders for the
shell (a neutral skeleton, or no shell until mount), which trades away SSR'd content and
risks a flash. Left for a deliberate decision rather than changed in passing.

**Mobile polish shipped alongside**, all from actually looking at the rendered pixels:
- Android home labels and clock were `foreground` (dark) directly on a dark wallpaper.
  Now white + text-shadow, matching the treatment iOS home/app-library already used.
  The colour is set on the **home grid container**, not inside `AppCell` — that same
  cell is reused by the App Drawer, a light sheet where white would be invisible.
  Caught before shipping by checking the cell's other call site.
- `Clock mode="date"` hard-codes `text-muted-foreground`, correct on a card and invisible
  on a wallpaper. Overridden locally with a `[&_div]:` descendant selector — (0,1,1)
  beats the class deterministically, with no `!important` and no API change to a
  component four shells share.
- Files' history back said `aria-label="Back"`, identical to the two shell-level
  exit-app controls, so a screen reader announced "Back" three times with three
  different meanings. It is now "Previous folder"; "Back" is reserved for leaving an app.

**Feature sweep: 17/17 apps render in both mobile shells**, each with a reachable exit
(iOS "Done", Android NavBar + header). No blank screens, no fatals.

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
[**REVERSED 2026-08-10**: `os-browser/`'s source, `scripts/e2e*` and
`SCORECARD-2026-06-14.md` were deleted. The service had been stopped AND disabled
for months with no `/api/v1/browser` route left to call it, which took the e2e
harness with it — `e2e.sh` also pointed at a `$BROWSER` script that does not exist,
so all 7 checks aborted on line 17. `AUDIT-2026-06-11.md` stays, for exactly the
reason given here.]
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
`IOS-PARITY-REFACTOR-PLAN.md` §8, round 8 (doc deleted 2026-08-10).

## 2026-07-16 (round 7) — iOS touch-target a11y sweep (P4 long-tail) (DONE)

Owner requested the iOS-parity optional long-tail. A **10-agent adversarial re-audit** found **0
mis-gates** (seam discipline held — the other four shells are provably unaffected) + **63 gaps** (49
sub-44px touch targets, 8 dialog→sheet, 6 regressions from the round 1–6 AI work — the 14px app root
makes `h-8`=28px / `h-9`=31.5px fall short). Fixed the high-ROI subset: one `@media(pointer:coarse)`
`globals.css` rule for all inputs/selects/menuitems (~25 targets), 2 shared primitives
(`responsive-toolbar`, file-tree `dir`), **46 per-slice button/row 44px appends** (6-agent disjoint
fan-out), and widget-picker Dialog→`ResponsiveDialog` sheet. Editors long-tail + the model-catalog
scroll-restructure logged as remaining. `tsc` + `eslint` clean, vitest **689** green, deployed `:4005`
health 200. Full detail was in `IOS-PARITY-REFACTOR-PLAN.md` §8, round 7 (doc deleted 2026-08-10).

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

---

*34 older entries (2026-05-29 → 2026-06-15) were trimmed on 2026-08-10 to keep
this file readable as the source of truth it claims to be. Nothing referenced them
by line, and they are one command away: `git show 421ab7f:docs/PROGRESS.md`.*

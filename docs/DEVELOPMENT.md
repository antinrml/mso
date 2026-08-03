# Development

## Setup

```bash
git clone git@github.com:rahmanef63/mso.git && cd mso
curl -fsSL https://bun.sh/install | bash   # if bun is missing (see "Package manager" below)
bun install
cp .env.example .env.local   # set OS_LOGIN_PASSWORD + OS_SESSION_SECRET (openssl rand -hex 32)
bun run dev                     # http://localhost:3000
node scripts/approve-device.js <deviceId> "my laptop"   # deviceId shows on the login screen
```

## Layout

Every feature is a self-contained **vertical slice** under `frontend/slices/<slug>/`
(its own components, hooks, and a `lib/host.ts` seam for host I/O). One manifest,
`frontend/slices/os-shell/shell.manifest.ts`, wires slices into the shell — so
**adding an app = one slice + one manifest entry**. Host access is bounded in
`lib/host` (Node `fs`/`child_process`, filesystem-jailed) behind signed-cookie auth
(`lib/auth`). See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quality gates

```bash
bun run verify   # typecheck + lint + test + check (cycles / slices / contrast)
```

A **pre-push hook** runs the same CI locally and blocks the push on failure. None of
these touch `.next`, so they're safe to run against the prod checkout.

## Deploy — and the build hazard ⚠️

mso deploys via **systemd on the VPS**, not `git push` (no webhook, no Dokploy/
Vercel). A deploy is:

```bash
bun run build && sudo systemctl restart mso.service   # build THEN restart, in that order
```

**Never run `bun run build` inside the running prod checkout just to "verify" a change.**
`next start` loads the build manifest at boot; overwriting `.next` under the live
process makes the already-served HTML reference chunk hashes that no longer exist on
disk → every JS/CSS chunk 404/500s → **the live site is broken until you restart**.

To test runtime behaviour without risking prod, use a **separate checkout / a demo
instance** on a different port — e.g. a build with `NEXT_PUBLIC_OS_DEMO=1` (no login,
no host access, forced mock data), served on `:4006` via its own systemd unit. For a
non-destructive static check, `bun run typecheck && bun run lint` is the cheap gate.

Recovery if a chunk mismatch is live: `sudo systemctl restart mso.service`.

## Package manager: bun installs, Node runs

**bun is the installer. The runtime is still Node 22** — `.nvmrc` and `engines.node`
mean what they say, and prod's `ExecStart` is `npm run start`. `next`, `tsc`, `eslint`
and `vitest` all ship a `#!/usr/bin/env node` shebang, and `bun run <script>` honours a
shebang, so the tools execute under Node exactly as before. Migrated from pnpm 10.32.1
on 2026-08-03; `bun.lock` is committed and `pnpm-lock.yaml` is gone.

Three things that will bite:

- **`bun run test`, never `bun test`.** `bun test` is bun's own builtin runner. It
  shadows the `test` script, ignores `vitest.config.mts` (losing the `**/zz-*` exclude
  and the named root includes for `proxy.test.ts` / `proxy-websocket.test.ts`), cannot
  run suites that use `vi.mock`, and **exits 0 having run nothing** — so `verify` goes
  green while testing zero files. Same trap in CI.
- **`node-pty` must stay in `trustedDependencies`.** It has no Linux prebuild, so it
  compiles at install time (hence the C++ toolchain + python3 requirement), and bun
  skips lifecycle scripts unless the package is trusted. Its binding loads eagerly via
  `lib/host/pty.ts` → `lib/host/index.ts`, which every `/api/v1` route imports — so a
  skipped build is not a Terminal outage, it is the entire host API failing at import.
  Gate any dependency change on `node -e "require('node-pty')"`.
- **Never `bunx`/`bun x` in a deploy script.** Unlike `pnpm exec`, bunx *downloads* a
  missing package and runs it. On the box that serves an authenticated remote shell,
  that turns a capability check into a fetch-and-execute. Call `node_modules/.bin/<tool>`
  directly (see `scripts/post-deploy-smoke.sh`).

`sharp`, `unrs-resolver` and `protobufjs` postinstalls stay **untrusted/blocked** — pnpm
blocked exactly the same three, and all three work from their prebuilt binaries. Don't
"fix" the `bun pm untrusted` warning by trusting them.

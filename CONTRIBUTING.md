# Contributing

Solo-maintainer project — PRs and issues welcome, scope kept deliberately small.

## Setup

```bash
bun install
cp .env.example .env.local   # set OS_LOGIN_PASSWORD + OS_SESSION_SECRET
bun run dev                     # :3000, mock data by default (no host access needed)
```

Node `>=20.9` (see `.nvmrc`). The mock adapter means you can develop every app
without a VPS or any credentials.

## Before you open a PR

A `pre-push` hook blocks the push on failure, so this checklist mostly describes what
already happens. It runs four guards: typecheck + lint + test (via sc-git's `ci.js`),
`check-cycles.mjs`, `scripts/audit.mjs`, and `scripts/verify-build.sh`. Budget ~70 s
per push. `.github/workflows/ci.yml` is **manual** (`gh workflow run CI`) — run it
before cutting a release or after touching `package.json`, `bun.lock` or
`scripts/install.sh`, because a clean-checkout `bun install --frozen-lockfile` is
the one thing the local hook cannot reproduce.

Two things about that hook are easy to get wrong:

- **The hook is UNTRACKED** (`.git/hooks/pre-push`), so nothing in this repo can carry
  it. Re-running an sc-git hook installer overwrites it and silently drops the audit
  and build guards. A healthy push prints `audit: clean at high/critical.` and
  `build: HEAD compiles (out-of-tree).` — if those two lines are missing, it is gone.
- **`ci.js` is invoked with `--skip build`, on purpose.** It would run the build in
  the current directory, which on the VPS *is* `mso.service`'s WorkingDirectory, and
  `next build` deletes `distDir` before it compiles. `scripts/verify-build.sh` builds
  a throwaway copy of `HEAD` in a temp dir instead. Do not "fix" the skip.

- [ ] `bun run verify` — typecheck + lint + test + check + audit, in one command
- [ ] `bun run build`
- [ ] (optional) `bash scripts/verify-build.sh` — build `HEAD` out-of-tree; safe to
      run against the prod checkout, unlike a bare `bun run build`
- [ ] (optional) `bun run smoke` — e2e smoke against a running server

## Conventions (the short version)

Full conventions live in [CLAUDE.md](./CLAUDE.md) and
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). The ones reviewers will hold
you to:

- **Vertical slices**: every app lives in `frontend/slices/<slug>/`; cross-slice
  imports go through the barrel `@/features/<slug>` only.
- **Host seam**: each app's only host coupling is its `lib/host.ts`. API routes
  never touch `fs`/`child_process` directly — always through `lib/host/*`
  (bounds + realpath checks).
- **Max ~200 lines/file**, single responsibility, shadcn/ui primitives only,
  theme tokens not raw hex, mobile-first.
- **Routing**: one catch-all route; URL writes via the History API, never
  `router.push`; dock/launcher links keep `prefetch={false}`.
- Conventional commits (`feat:`, `fix:`, `docs:`…).

## Security issues

Do **not** open a public issue — see [SECURITY.md](./SECURITY.md).

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

A `pre-push` hook runs typecheck + lint + test + the slice/cycle checks and blocks
the push if any fail, so this checklist is mostly a description of what already
happens. `.github/workflows/ci.yml` is **manual** (`gh workflow run CI`) — run it
before cutting a release or after touching `package.json`, `bun.lock` or
`scripts/install.sh`, because a clean-checkout `bun install --frozen-lockfile` is
the one thing the local hook cannot reproduce.

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run test` — vitest unit + integration (280+ tests)
- [ ] `bun run build`
- [ ] (optional) `node scripts/check-cycles.mjs` — no value-level import cycles
- [ ] (optional) `node scripts/check-slices.mjs` — no slice-boundary violations
- [ ] (optional) `bun run smoke` — e2e smoke against a local `bun run start`

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

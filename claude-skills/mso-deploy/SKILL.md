---
name: mso-deploy
description: Ship MSO safely using its verified release path: preflight, out-of-tree verification, commit and push gates, build then restart, health and chunk checks, and visual proof.
metadata:
  mso:
    risk: high
    policy: verify-ship-prove
---

# /mso-deploy — production release recipe

Call `workflow_start` with the complete change and deployment intent. Confirm the resolved project is the production MSO checkout and inspect `CLAUDE.md` plus the top of `docs/PROGRESS.md` before shipping.

## Required order

1. Targeted tests and `bun run verify`.
2. `bash scripts/verify-build.sh` for an out-of-tree compile check.
3. Review clean diff and append the shipped reasoning to `docs/PROGRESS.md`.
4. Run `bun run ship "<conventional commit>"`.
5. Verify `mso.service` is active, `/api/health` reports the new build, and a CSS/JS chunk referenced by live HTML serves the correct MIME type.
6. Run the live smoke test and `screen_capture` for visual proof.
7. Call `workflow_finish(success=true)` only after all checks pass.

`git push` alone is not deployment. The production checkout's `.next` is live: build then restart immediately, never restart before build, and never leave an in-place build without the matching restart. Long release commands should run as a background host job with their log and exit code polled, not by inserting fixed `sleep` delays into every check.

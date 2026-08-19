---
name: mso-deploy
description: Ship MSO safely using its verified release path: preflight, out-of-tree verification, commit and push gates, build then restart, health and chunk checks, and visual proof.
metadata:
  mso:
    risk: high
    policy: verify-ship-prove
---

# /mso-deploy — production release recipe

Call `workflow_start` with the complete change and deployment intent, then carry its exact `workflow_id` on every operational call. Confirm the resolved project is the production MSO checkout and inspect `CLAUDE.md` plus the top of `docs/PROGRESS.md` before shipping.

## Required order

1. Targeted tests and `bun run verify`.
2. `bash scripts/verify-build.sh` for an out-of-tree compile check.
3. Review clean diff and append the shipped reasoning to `docs/PROGRESS.md`.
4. Run `bun run ship "<conventional commit>"`. From MCP, the script automatically returns after handing build/restart to `mso-self-update.service`; that return means **scheduled**, not deployed.
5. Poll `systemctl --user is-active mso-self-update.service` and `~/.mso/self-update.log` until the unit is inactive and the log ends in `UPDATE OK`. Never use fixed `sleep` delays as proof.
6. Verify `mso.service` is active, `/api/health` reports the new build, and CSS/JS chunks referenced by live HTML serve the correct MIME types.
7. Run the live smoke test and `screen_capture` for visual proof.
8. Call `workflow_finish(success=true)` only after all checks pass.

`git push` alone is not deployment. The production checkout's `.next` is live: build then restart immediately, never restart before build, and never leave an in-place build without the matching restart. `nohup` is not a detach boundary inside `mso.service`; the service manager terminates the whole cgroup. The owner transient user unit is the supported long-running release boundary.

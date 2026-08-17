#!/usr/bin/env bash
# self-update.sh — pull main, prove it compiles, build, restart. The body of the
# Settings → About update button.
#
# RUN BY systemd-run, NOT by mso.service (lib/host/self-update.ts explains why: the
# last step restarts mso.service, and systemd kills the whole cgroup — a child of the
# service would die mid-build with .next already deleted).
#
# Order is the same load-bearing order as scripts/ship.sh, with ONE addition: the
# out-of-tree verification. ship.sh is run by a human who is watching; this is run by
# an operator who pressed a button and walked away, so a commit that does not compile
# must be found BEFORE `next build` deletes the .next the live service is serving
# from. That build is unrecoverable in place — there is no old .next to put back.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LOG="${MSO_UPDATE_LOG:-$HOME/.mso/self-update.log}"
mkdir -p "$(dirname "$LOG")"
# Truncate, then take over both streams: the panel polls this file, and a log that
# grew forever would eventually be the biggest thing in ~/.mso.
exec >"$LOG" 2>&1

# systemd hands a unit /usr/local/sbin:…:/usr/bin and nothing else. bun lives in
# ~/.bun/bin — the same gap that made managed apps read as "not installed".
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
export NO_COLOR=1 TERM=dumb

step() { printf '\n[%s] == %s\n' "$(date -Is)" "$*"; }
die()  { printf '\n[%s] FAILED: %s\n' "$(date -Is)" "$*"; printf 'the running MSO was left untouched.\n'; exit 1; }

REBUILD_ONLY=0
[ "${1:-}" = "--rebuild-only" ] && REBUILD_ONLY=1

step "self-update starting (rebuild-only=$REBUILD_ONLY)"
git rev-parse --short HEAD | sed 's/^/at /'

if [ "$REBUILD_ONLY" -eq 0 ]; then
  step "fetching origin/main"
  git fetch --quiet origin main || die "could not reach the remote"
  step "fast-forwarding"
  # --ff-only, never a merge: this checkout must stay a mirror of main. A refusal
  # here means someone committed on the host, and silently merging their work into
  # a deploy is worse than stopping.
  git merge --ff-only origin/main || die "cannot fast-forward — the checkout has diverged from origin/main"
  git log -1 --format='now at %h — %s'

  step "installing dependencies"
  # Cheap when nothing changed (~250ms), and a pulled commit may have moved a
  # dependency. node-pty is in trustedDependencies, so its native build runs here.
  bun install || die "bun install failed"
  node -e "require('node-pty')" || die "node-pty did not load after install — every /api/v1 route imports it"
fi

step "verifying the build out-of-tree (this does not touch the live .next)"
bash scripts/verify-build.sh >/dev/null || die "HEAD does not compile — nothing was deployed"

step "building in place"
bun run build >/dev/null || die "build failed after it had already passed out-of-tree — check disk space"

step "restarting mso.service"
sudo -n systemctl restart mso.service || die "could not restart mso.service"
sleep 4

# The chunk-mismatch check CLAUDE.md warns about, verified rather than remembered —
# the same check scripts/ship.sh ends with. If the HTML references a chunk the
# restarted process does not serve, every asset 404s and the UI comes up unstyled.
PORT="${PORT:-4005}"
CSS=$(curl -fsS --max-time 10 "http://127.0.0.1:$PORT/" | grep -o '/_next/static/[^"]*\.css' | head -1)
if [ -z "$CSS" ]; then
  die "no CSS reference in the served HTML — recover with: rm -rf .next && bun run build && sudo systemctl restart mso.service"
fi
TYPE=$(curl -fsSI --max-time 10 "http://127.0.0.1:$PORT$CSS" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')
case "$TYPE" in
  text/css*) ;;
  *) die "chunk mismatch: $CSS served as '${TYPE:-nothing}'. Recover with: rm -rf .next && bun run build && sudo systemctl restart mso.service" ;;
esac

step "done — now at $(git rev-parse --short HEAD)"
printf 'UPDATE OK\n'

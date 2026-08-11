#!/usr/bin/env bash
# The whole ship, in the order that cannot be got wrong.
#
#   bun run ship
#
# Exists because "push to main" is NOT a deploy here. Prod is systemd with no
# webhook, so a pushed commit changes nothing the owner can see until someone
# rebuilds — and the rebuild has a hazard of its own (`next build` wipes .next in
# the LIVE working directory, so the site 404s every chunk until the restart lands).
# Doing it by hand meant remembering four steps in one order; forgetting the last
# one left main ahead of the running site with no signal that they had diverged.
#
# Order is load-bearing, and the changelog step is subtler than it looks:
#   1. commit      — the message must be IN history before the changelog can list it.
#   2. changelog   — regenerate, then fold into that same commit with --amend. The
#                    amend rewrites the SHA, which is exactly why gen-changelog.mjs
#                    emits no hashes: the content has to survive it, or the staleness
#                    gate would disagree with itself on the next push.
#   3. push        — the pre-push hook runs the gates (scripts/gates.sh), including
#                    the changelog staleness check that this ordering satisfies.
#   4. build       — in place, because the next line restarts immediately.
#   5. restart     — build THEN restart, always. Never the reverse.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MSG="${1:-}"
[ -n "$MSG" ] || { echo "usage: bun run ship \"<conventional commit message>\"" >&2; exit 1; }

echo "▶ 1/5 commit"
git add -A
if git diff --cached --quiet; then
  echo "  nothing staged — skipping commit"
  COMMITTED=0
else
  git commit -q -m "$MSG"
  COMMITTED=1
fi

echo "▶ 2/5 changelog"
node scripts/gen-changelog.mjs
if ! git diff --quiet -- docs/CHANGELOG.md; then
  git add docs/CHANGELOG.md
  if [ "$COMMITTED" = "1" ]; then
    git commit -q --amend --no-edit   # fold it into the commit it describes
  else
    git commit -q -m "docs(changelog): regenerate"
  fi
fi

echo "▶ 3/5 push (gates run here, ~70s)"
git push origin main

echo "▶ 4/5 build"
bun run build >/dev/null

echo "▶ 5/5 restart"
sudo -n systemctl restart mso.service
sleep 4

# The chunk-mismatch check from CLAUDE.md, run every time rather than remembered:
# if the HTML references a chunk the restarted process does not serve, every asset
# 404s and the UI is unstyled. Cheaper to check than to notice.
CSS=$(curl -fsS http://127.0.0.1:4005/ | grep -o '/_next/static/[^"]*\.css' | head -1 || true)
if [ -z "$CSS" ]; then
  echo "❌ no CSS reference in the served HTML — the app is not rendering." >&2; exit 1
fi
TYPE=$(curl -fsSI "http://127.0.0.1:4005$CSS" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')
case "$TYPE" in
  text/css*) ;;
  *) echo "❌ chunk mismatch: $CSS served as '${TYPE:-nothing}'. Fix: rm -rf .next && bun run build && restart" >&2; exit 1 ;;
esac

echo
echo "✅ shipped $(git rev-parse --short HEAD) → https://mso.rahmanef.com"
echo "   What's new is in Settings → About (docs/CHANGELOG.md, regenerated above)."

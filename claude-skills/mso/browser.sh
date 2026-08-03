#!/usr/bin/env bash
# browser.sh — drive the REAL headless browser (Playwright Chromium) the mso
# Browser app uses. Same persistent session/cache, so logged-in state is shared.
# Screenshots land in /tmp so they can be Read (viewed) directly.
#
#   browser.sh go <url>        navigate (bare words → google search)
#   browser.sh shot [file]     screenshot → /tmp/os-browser.png (or file); prints path
#   browser.sh content         page innerText (read what's on screen)
#   browser.sh state           current url + title
#   browser.sh click <x> <y>   click viewport px (1280x800)
#   browser.sh type <text>     type text
#   browser.sh key <Key>       press a key (Enter, Backspace, Tab, ArrowDown…)
#   browser.sh scroll <dy>     wheel by dy px
#   browser.sh back|forward|reload
#   browser.sh health
set -euo pipefail

ENVF="${OS_BROWSER_ENV:-/home/rahman/projects/mso/os-browser/.env}"
# shellcheck disable=SC1090
set -a; . "$ENVF" 2>/dev/null || true; set +a
SEC="${OS_BROWSER_SECRET:-}"
B="${OS_BROWSER_BASE:-http://127.0.0.1:4002}"
[ -n "$SEC" ] || { echo "no OS_BROWSER_SECRET in $ENVF" >&2; exit 1; }
H=(-H "x-os-browser-secret: $SEC")
J=(-H 'content-type: application/json')

cmd="${1:-help}"; shift || true
case "$cmd" in
  go|navigate) curl -fsS "${H[@]}" "${J[@]}" -d "$(jq -n --arg u "${1:?url}" '{url:$u}')" "$B/navigate"; echo ;;
  shot|screenshot) f="${1:-/tmp/os-browser.png}"; curl -fsS "${H[@]}" "$B/screenshot" -o "$f"; echo "saved $f ($(stat -c%s "$f") bytes) — Read it to view" ;;
  content) curl -fsS "${H[@]}" "$B/content" ;;
  state) curl -fsS "${H[@]}" "$B/state"; echo ;;
  click) curl -fsS "${H[@]}" "${J[@]}" -d "$(jq -n --argjson x "${1:?x}" --argjson y "${2:?y}" '{x:$x,y:$y}')" "$B/click"; echo ;;
  type) curl -fsS "${H[@]}" "${J[@]}" -d "$(jq -n --arg t "${*:?text}" '{text:$t}')" "$B/type"; echo ;;
  key) curl -fsS "${H[@]}" "${J[@]}" -d "$(jq -n --arg k "${1:?key}" '{key:$k}')" "$B/key"; echo ;;
  scroll) curl -fsS "${H[@]}" "${J[@]}" -d "$(jq -n --argjson d "${1:?dy}" '{dy:$d}')" "$B/scroll"; echo ;;
  back|forward|reload) curl -fsS "${H[@]}" "${J[@]}" -d '{}' "$B/$cmd"; echo ;;
  health) curl -fsS "$B/health"; echo ;;
  *) sed -n '2,20p' "$0" ;;
esac

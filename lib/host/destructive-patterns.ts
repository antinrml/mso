// SERVER + CLIENT safe — pure regex, NO node imports. The catastrophic-command
// denylist, extracted from exec.ts so two callers share one source of truth:
//   • exec.ts (server) enforces it — refuses the command with code 126.
//   • the assistant's approval card (client) advisely flags a command the server
//     will refuse, so a human isn't tricked into approving a guaranteed error.
// exec.ts layers the OS_EXEC_ALLOW_DESTRUCTIVE override on top of this.

// High-confidence catastrophic patterns: commands that wreck the whole box and
// are almost never run on purpose through a web cockpit. Genuine disk surgery
// should go over SSH.
export const DESTRUCTIVE: { re: RegExp; why: string }[] = [
  { re: /\brm\b(?:\s+-\S*)*\s+-\S*[rf]\S*\s+(?:--no-preserve-root\s+)?\/(?:\s|$|\*)/, why: "rm -rf on /" },
  { re: /--no-preserve-root/, why: "rm --no-preserve-root" },
  { re: /\bmkfs(?:\.\w+)?\b/, why: "mkfs (format a filesystem)" },
  { re: /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|vd|xvd|disk|hd)/, why: "dd to a block device" },
  { re: />\s*\/dev\/(?:sd|nvme|vd|xvd|hd)\w/, why: "redirect to a block device" },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: "fork bomb" },
  { re: /\b(?:chmod|chown)\b(?:\s+-\S*)*\s+-\S*R\S*\s+\S+\s+\/(?:\s|$)/, why: "recursive chmod/chown on /" },
  { re: /\bsystemctl\b[^\n;|&]*\b(?:stop|restart|disable|mask|isolate|kill)\b/, why: "systemctl stop/restart/disable — manage services over SSH" },
  { re: /\bservice\s+\S+\s+(?:stop|restart)\b/, why: "service stop/restart — manage services over SSH" },
  { re: /\b(?:shutdown|reboot|poweroff|halt)\b/, why: "shutdown/reboot/poweroff" },
  { re: /\binit\s+[06]\b/, why: "init 0/6" },
  { re: /\bkill\s+(?:-(?:9|KILL|SIGKILL)\s+)?1(?:\s|$)/, why: "kill PID 1" },
];

// Shell metacharacters that start a new command, open a subshell, or open/close a
// quoted string. The patterns above anchor the catastrophic argument on `\s`, `$` or
// `*`, so a `/` followed by `;`, `)` or `"` used to slip straight past them:
//   echo hi; rm -rf /; echo bye     `/` then `;`
//   (rm -rf /) &                    `/` then `)`
//   bash -c "rm -rf /"              `/` then `"`
// Splitting on these puts each command on its own, where the trailing `/` lands at
// end-of-segment and the existing patterns can see it. Widening every regex instead
// was the alternative and is the wrong shape — a regex over a shell string leaks a
// new way in for every character you forget.
const SEPARATORS = /[;&|()"'`\n]+/;

// The reason a command matches the denylist, or null. Pure (no env override —
// that's exec.ts's job); safe to call from the browser.
export function matchDestructive(cmd: string): string | null {
  // WHOLE STRING FIRST, and it must stay first: the fork-bomb pattern is built out
  // of `(){}|&;:` — the very characters SEPARATORS splits on — so testing only the
  // segments would stop detecting it.
  for (const part of [cmd, ...cmd.split(SEPARATORS)]) {
    if (!part) continue;
    for (const d of DESTRUCTIVE) if (d.re.test(part)) return d.why;
  }
  return null;
}

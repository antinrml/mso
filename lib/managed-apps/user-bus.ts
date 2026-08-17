import "server-only";
import { existsSync } from "node:fs";

/** Where a user's systemd instance keeps its bus socket. */
const runtimeDirFor = (uid: number): string => `/run/user/${uid}`;

/**
 * The environment `systemctl --user` needs, when the current process has not been
 * given one.
 *
 * `systemctl --user` reaches the calling user's systemd instance through
 * XDG_RUNTIME_DIR. A login shell always has it. A systemd SYSTEM unit with
 * `User=` never does — units start from a clean environment with no login
 * session — so inside the packaged `mso.service` every `systemctl --user …`
 * answers:
 *
 *     Failed to connect to bus: No medium found
 *
 * At the call site that is a non-zero exit with no structure to it, which is
 * indistinguishable from "no such unit". One missing variable therefore broke two
 * separate user-visible things:
 *
 *   1. `scripts/managed-app-install` died at `systemctl --user daemon-reload`,
 *      after writing the app's unit file but before enabling it. The install had
 *      done all of its real work; it reported failure and left a unit on disk
 *      that nothing had ever started.
 *   2. `detect()` in manager.ts discarded the `--user` answer, found nothing in
 *      the system scope, and concluded an app that was installed and running was
 *      "not installed".
 *
 * Resolved HERE, per call, rather than demanded from the unit file, because the
 * same code runs two ways: under `bun run dev` from a terminal, where the
 * variable is already set and must be left exactly as it is, and under systemd,
 * where it never is. Patching only the generated unit would leave every cockpit
 * that is already installed broken until its owner happened to re-run the
 * installer.
 *
 * @returns env overrides to merge into the child, or `undefined` when there is
 *   nothing to add — either the caller already has a runtime dir, or no usable
 *   bus exists and no guess would help.
 */
export function userBusEnv(): Record<string, string> | undefined {
  // Judged by whether a bus is actually reachable, NOT by whether the variable
  // is merely set. Both matter:
  //
  //   - Set and usable (a terminal, `machinectl shell`, an operator pointing at
  //     a non-default runtime dir on purpose): leave it completely alone.
  //   - Set but with nothing behind it: the unit hard-codes
  //     `XDG_RUNTIME_DIR=/run/user/%U`, which is a static string evaluated when
  //     the service starts. At boot mso.service can win the race against
  //     systemd-logind creating that directory. Trusting the variable's mere
  //     presence would disable this fallback exactly when it is needed.
  const current = process.env.XDG_RUNTIME_DIR;
  if (current && existsSync(`${current}/bus`)) return undefined;

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) return undefined; // not POSIX; there is no user bus to find

  const dir = runtimeDirFor(uid);
  // Only claim the path when the socket is really there. `loginctl enable-linger`
  // is what keeps `/run/user/<uid>` alive between logins; without linger it is
  // torn down with the last session, and naming a directory that does not exist
  // would trade one confusing failure for another one.
  if (!existsSync(`${dir}/bus`)) return undefined;
  return { XDG_RUNTIME_DIR: dir };
}

/**
 * True when this process cannot talk to a user systemd instance at all.
 *
 * Used to tell an operator *why* an app looks absent, instead of asserting the
 * false conclusion that it is not installed — the mistake
 * `lib/camoufox/service.ts` already refuses to make.
 */
export function userBusUnavailable(): boolean {
  const current = process.env.XDG_RUNTIME_DIR;
  if (current && existsSync(`${current}/bus`)) return false;
  return userBusEnv() === undefined;
}

// The update-centre contract. Separate from types.ts only because that file is
// already at the repo's 200-line ceiling — types.ts stays the app + job
// contract, this is the update/backup/restore one.

import type { ManagedAppId } from "./types";

/** The four values `openclaw update --channel` accepts, verbatim from its
 *  `--help`. Hermes has no equivalent — see `ManagedAppChannel.kind`. */
export const MANAGED_APP_UPDATE_CHANNELS = ["stable", "extended-stable", "beta", "dev"] as const;

/** What an app calls its update track, and whether MSO will move it. */
export interface ManagedAppChannel {
  /** OpenClaw: the npm channel (`stable`). Hermes: the git branch it compares
   *  against. `null` when the app did not say — never a guess. */
  value: string | null;
  /** What `value` MEANS. A branch is not a channel: switching one rewrites a
   *  working tree, switching the other picks a registry dist-tag. */
  kind: "channel" | "branch" | null;
  /** Selectable values. Empty when MSO will not switch it. */
  available: string[];
  switchable: boolean;
  /** Why not, when `switchable` is false. */
  reason: string | null;
}

/** What MSO can actually drive for this app, so the UI never offers a flow the
 *  CLI has no non-interactive form for. */
export interface ManagedAppUpdateCapabilities {
  check: boolean;
  apply: boolean;
  dryRun: boolean;
  channel: boolean;
  rollback: boolean;
  uninstall: boolean;
  /** Install is NEVER automated — both installers are interactive — so this is
   *  the exact command for the operator to run, always populated. */
  installCommand: string | null;
  /** Populated only if uninstall ever loses its non-interactive form; both
   *  CLIs have one today, so it is null and MSO runs the uninstall itself. */
  uninstallCommand: string | null;
}

/** One normalised answer for two CLIs that agree on nothing. Every field an app
 *  cannot answer is `null`, and the UI says so rather than inventing a value. */
export interface ManagedAppUpdateStatus {
  applicationId: ManagedAppId;
  currentVersion: string | null;
  /** `null` for Hermes: it counts commits behind a ref and never names a
   *  target version. */
  latestVersion: string | null;
  /** `null` = the check could not run. NOT the same as `false`. */
  updateAvailable: boolean | null;
  /** The upstream one-liner, redacted — what the CLI actually said. */
  detail: string | null;
  channel: ManagedAppChannel;
  /** `git` | `package` | `docker` | … as the app reports it. */
  installKind: string | null;
  capabilities: ManagedAppUpdateCapabilities;
  /** `null` = never probed by this server. A READ of the status serves the last
   *  probe and never spawns one, so "no answer yet" is a state the panel sees. */
  checkedAt: string | null;
  /** Set when the probe itself failed (or the CLI is missing); the version
   *  fields are then null. */
  error: string | null;
}

export interface ManagedAppUpdateOptions {
  /** OpenClaw only. Hermes' preview is `update --check`, i.e. the check verb. */
  dryRun?: boolean;
  /** OpenClaw only, and it is applied by an UPDATE RUN — upstream persists the
   *  channel only after a successful core update (`--channel` on `update`). */
  channel?: string;
  /** OpenClaw `--tag`: a dist-tag or an exact version. Package specs
   *  (`github:owner/repo#ref`) are refused — see update-cli.ts. */
  tag?: string;
  /** Hermes `--branch`: switches the checkout, auto-stashing local changes. */
  branch?: string;
  /** OpenClaw `--no-restart`. Off by default on purpose (update-cli.ts). */
  noRestart?: boolean;
}

/** One snapshot under `~/.mso/backups/<id>/`, as its manifest records it. */
export interface ManagedAppBackup {
  /** The stamp directory name. It is also a path segment and an API parameter,
   *  so it is pattern-checked before it is ever joined to a path. */
  id: string;
  applicationId: ManagedAppId;
  createdAt: string;
  /** The state dir it was copied FROM. */
  source: string;
  reason: "manual" | "pre-update" | "pre-uninstall" | "pre-restore" | "unknown";
  /** `null` on a manifest written before these counters existed. */
  files: number | null;
  bytes: number | null;
  skipped: { symlinks: number; dirs: number; dirNames: string[] };
}

export interface ManagedAppRestoreResult {
  applicationId: ManagedAppId;
  backupId: string;
  /** The realpath'd state dir that was written to. */
  target: string;
  filesRestored: number;
  bytesRestored: number;
  /** The state as it was BEFORE this restore overwrote it. The undo. */
  safetyBackupId: string;
  /** Names a snapshot NEVER contains (backup prunes them), so a restore cannot
   *  bring them back — they are left exactly as they are on disk. */
  notRestored: string[];
  /** Files added since the snapshot are left in place: a restore overwrites,
   *  it does not delete. Stated in the response because it changes what
   *  "rolled back" means. */
  overwriteOnly: true;
}

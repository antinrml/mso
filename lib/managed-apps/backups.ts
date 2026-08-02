import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHome } from "./catalog";
import type { ManagedAppDefinition, ManagedAppId } from "./types";
import type { ManagedAppBackup } from "./update-types";

// Snapshots of an app's state dir, and the only place that decides WHERE that
// dir is. Lifted out of manager.ts unchanged (same prune list, same symlink
// skip, same manifest) because three callers now need it: the `backup` action,
// the mandatory pre-update/pre-uninstall snapshot, and the pre-restore undo.
// A second copy of "what is the state dir" is how a restore ends up writing
// somewhere a backup never read.

/** Re-installable bytes that are not state. Names, not paths: they recur at
 *  depth. Measured on this host — excluding these takes ~/.hermes from 2.7G to
 *  366M and ~/.openclaw from 1.7G to 237M, and `backups` is the app's OWN
 *  backup dir (1.1G for Hermes), which a backup has no business duplicating. */
export const BACKUP_SKIPPED_DIRS = ["node_modules", ".venv", "venv", "__pycache__", ".git", ".cache", "backups"] as const;
const SKIPPED = new Set<string>(BACKUP_SKIPPED_DIRS);

/** The stamp `createBackup` mints: `toISOString()` with `:` and `.` swapped for
 *  `-`. It is a URL segment and a filename, so nothing that fails this regex is
 *  ever joined to a path. */
const BACKUP_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export function isManagedAppBackupId(value: unknown): value is string {
  return typeof value === "string" && BACKUP_ID_RE.test(value);
}

/** The app's own state dir: the catalog's `homeDir` override when set, else
 *  `~/<stateDirName>`. THE definition of "the app's own dir" — backup reads it,
 *  restore writes it, and they must never disagree. */
export function stateDirFor(definition: ManagedAppDefinition): string {
  return expandHome(definition.homeDir) || path.join(os.homedir(), definition.stateDirName);
}

export function backupsRoot(id: ManagedAppId): string {
  return path.join(os.homedir(), ".os-vps", "backups", id);
}

export async function createBackup(definition: ManagedAppDefinition, reason: ManagedAppBackup["reason"]): Promise<ManagedAppBackup> {
  const source = stateDirFor(definition);
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupsRoot(definition.id), id);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const skipped = { symlinks: 0, dirs: 0 };
  let files = 0;
  let bytes = 0;
  await fs.cp(source, target, {
    recursive: true,
    preserveTimestamps: true,
    // Symlinks are SKIPPED — neither followed nor recreated. Following one
    // copies bytes from outside the app; recreating an absolute one aims a
    // future restore outside the tree. Both installs are full of them (2063
    // under ~/.openclaw, nearly all inside node_modules), and refusing the
    // whole backup over them — which is what this used to do — meant the
    // feature never once ran.
    filter: async (entry) => {
      if (SKIPPED.has(path.basename(entry))) {
        skipped.dirs += 1;
        return false;
      }
      const stat = await fs.lstat(entry);
      if (stat.isSymbolicLink()) {
        skipped.symlinks += 1;
        return false;
      }
      if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
      }
      return true;
    },
  });
  const manifest: ManagedAppBackup = {
    id,
    applicationId: definition.id,
    createdAt: new Date().toISOString(),
    source,
    reason,
    files,
    bytes,
    skipped: { ...skipped, dirNames: [...BACKUP_SKIPPED_DIRS] },
  };
  // What was left out is part of what the backup IS — a restore that silently
  // lacks node_modules is only safe if you knew it never had them.
  await fs.writeFile(path.join(target, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  return manifest;
}

/** `null` = no manifest, unreadable, or one that does not name an application.
 *  Restore treats that as "not a snapshot of this app" and refuses; the listing
 *  is more forgiving and shows the row with what the stamp alone can tell. */
export async function readBackupManifest(id: ManagedAppId, backupId: string): Promise<ManagedAppBackup | null> {
  if (!isManagedAppBackupId(backupId)) return null;
  try {
    const raw = JSON.parse(await fs.readFile(path.join(backupsRoot(id), backupId, "manifest.json"), "utf8")) as Partial<ManagedAppBackup>;
    if (typeof raw?.applicationId !== "string" || !raw.applicationId) return null;
    return {
      id: backupId,
      applicationId: raw.applicationId as ManagedAppId,
      createdAt: raw.createdAt ?? stampToIso(backupId),
      source: raw.source ?? "",
      reason: raw.reason ?? "unknown",
      files: raw.files ?? null,
      bytes: raw.bytes ?? null,
      skipped: raw.skipped ?? { symlinks: 0, dirs: 0, dirNames: [] },
    };
  } catch {
    return null;
  }
}

/** The stamp IS a timestamp, so a snapshot whose manifest was lost is still
 *  datable — but its `applicationId` is not, which is why restore needs one. */
function stampToIso(backupId: string): string {
  return backupId.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
}

/** Newest first. A directory that does not match the stamp pattern is not one
 *  of ours and is ignored rather than listed. */
export async function listBackups(id: ManagedAppId): Promise<ManagedAppBackup[]> {
  const names = await fs.readdir(backupsRoot(id)).catch(() => [] as string[]);
  const backups: ManagedAppBackup[] = [];
  for (const name of names.filter(isManagedAppBackupId).sort().reverse()) {
    backups.push(
      (await readBackupManifest(id, name)) ?? {
        id: name,
        applicationId: id,
        createdAt: stampToIso(name),
        source: "",
        reason: "unknown",
        files: null,
        bytes: null,
        skipped: { symlinks: 0, dirs: 0, dirNames: [] },
      },
    );
  }
  return backups;
}

// What a bounded scan could not cover, and how to continue it. Types only — kept
// separate so both the project walk and the skill catalog can describe incompleteness
// in the same shape without importing each other's scanners.

/**
 * An EXACT resumable position, not a description of one.
 *
 * The previous shape recorded "entries consumed" derived from sorted accepted rows and a
 * global result count, which could point past dirents that were never processed — and it
 * had no way at all to advance past the `maxRoots` prefix, so a 13th configured root was
 * permanently unreachable. This is a raw stream position instead:
 *
 *   rootIndex      index into the UNCAPPED configured-root list to start from, so the
 *                  cap window slides forward across calls;
 *   containerIndex 0 = the root itself, 1 = its derived `projects/` child;
 *   entriesConsumed raw dirents FULLY PROCESSED in that container. A dirent that was
 *                  read but not validated before a cap or deadline tripped is NOT
 *                  counted, so it is re-processed rather than skipped.
 */
export type ScanCursor = {
  rootIndex: number;
  containerIndex: number;
  entriesConsumed: number;
  /** Canonical path the position was recorded against; a mismatch discards the position
   *  rather than resuming into a different directory. */
  containerPath?: string;
};

export type ScanReport = {
  truncated: boolean;
  truncationReasons: string[];
  scannedRoots: string[];
  skippedRoots: Array<{ path: string; reason: string }>;
  /** Entries rejected by containment, hidden-name, symlink or ownership checks. */
  skippedProjects: number;
  /** Present ONLY when truncated. Every cap emits a way to continue — a cap the caller
   *  cannot resume is just data loss with a label on it. */
  continuation?: {
    pendingRoots: string[];
    /** The exact stream position the next call resumes from. */
    position: ScanCursor;
    cursorSemantics: "readdir-stream-position";
    note: string;
    cursor: string;
  };
};


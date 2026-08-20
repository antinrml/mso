// What a bounded scan could not cover, and how to continue it. Types only — kept
// separate so both the project walk and the skill catalog can describe incompleteness
// in the same shape without importing each other's scanners.

/** A resumable position. Positional in readdir order — see encodeCursor's note. */
export type ScanCursor = {
  roots: Array<{ root: string; entriesConsumed: number }>;
  /** Containers already fully covered by the previous page; skipped on resume. */
  skipRoots: string[];
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
    cursors: Array<{ root: string; entriesConsumed: number }>;
    cursorSemantics: "readdir-position";
    note: string;
    cursor: string;
  };
};


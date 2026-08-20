// The leaf: scan budgets and container identity. Nothing here imports anything of ours,
// so both the root list and the container builder can depend on it without a cycle.
import { createHash } from "crypto";

export const PROJECT_LIMITS = {
  /** Authorized OS_FS_READ_ROOTS entries honoured per call. */
  maxRoots: 12,
  /** Directory entries READ from one container before the walk stops. */
  maxEntriesPerRoot: 400,
  /** Projects enumerated in total, across all containers. */
  maxProjects: 400,
  /** Wall-clock ceiling for one whole enumeration. */
  maxScanMs: 4000,
  defaultPageSize: 50,
  maxPageSize: 200,
} as const;

export type AuthorizedRoot = {
  id: string;
  configured: string;
  path: string;
  /** Position in the UNCAPPED configured list. A cursor stores this so a later call can
   *  slide the `maxRoots` window forward instead of re-scanning the same prefix. */
  index: number;
};

/**
 * 128 bits of sha256 over the canonical container path.
 *
 * This was 8 hex characters — 32 bits — and a review found a REAL collision in the
 * fixture space it was tested in: `/tmp/mso-root-50323` and `/tmp/mso-root-125549`
 * both hashed to `51e156ef`. Two colliding roots holding same-named projects would
 * have merged back into one row, re-creating the exact bug root-qualified ids exist to
 * fix. 32 hex characters make that computationally unreachable — and, belt and braces,
 * nothing DEDUPES on this value: the internal key is the full canonical path (see
 * `containerKey`), so even a collision cannot merge two containers.
 */
export const shortId = (real: string) => createHash("sha256").update(real).digest("hex").slice(0, 32);

/** The internal identity. Always the full canonical path — never the hash — so
 *  dedupe/precedence can never be decided by a truncated digest. */
export const containerKey = (real: string) => real;

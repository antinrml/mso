// WHICH configured roots a scan may touch, and where a continuation picks them back up.
//
// Two lists on purpose. Authorization is uncapped — a root the owner configured is inside
// the jail whether or not this call had budget to walk it. A SCAN is capped, and the cap
// is a sliding window over that list, which is the only thing that makes `maxRoots`
// continuable at all.
import { promises as fs } from "fs";
import { isCredentialPath, readRootList } from "./paths";
import { PROJECT_LIMITS, shortId, type AuthorizedRoot } from "./project-identity";

export async function allConfiguredRoots(): Promise<AuthorizedRoot[]> {
  const out: AuthorizedRoot[] = [];
  const seen = new Set<string>();
  for (const configured of readRootList()) {
    const real = await fs.realpath(configured).catch(() => null);
    if (!real || real === "/" || seen.has(real)) continue;
    if (!(await fs.stat(real).catch(() => null))?.isDirectory()) continue;
    if (isCredentialPath(real)) continue;
    seen.add(real);
    out.push({ id: shortId(real), configured, path: real, index: out.length });
  }
  return out;
}

/**
 * The roots ONE scan will honour: `maxRoots` of them, starting at `startIndex`.
 *
 * The start offset is what makes `maxRoots` continuable. Without it the second call
 * rebuilt the identical capped prefix and the 13th configured root was unreachable
 * forever, however many times the caller followed the cursor.
 */
export async function authorizedRoots(startIndex = 0): Promise<AuthorizedRoot[]> {
  return (await allConfiguredRoots()).slice(startIndex, startIndex + PROJECT_LIMITS.maxRoots);
}

/**
 * EVERY configured root, canonicalized, with NO cap.
 *
 * `authorizedRoots()` caps at `maxRoots` because a SCAN has to be bounded. Authorization
 * is a different question: a root the owner configured is inside the jail whether or not
 * this call had budget to walk it. Using the capped list as the jail predicate is what
 * made an explicitly named `rootHint` unresolvable once 12 other roots were configured.
 */
export async function configuredRootPaths(): Promise<string[]> {
  return (await allConfiguredRoots()).map((r) => r.path);
}

/** Roots configured but NOT honoured, so the caller can say so rather than imply the
 *  configuration was fully covered. */
export async function overflowRoots(startIndex = 0): Promise<{ roots: Array<{ path: string; reason: string }>; nextIndex: number }> {
  const all = await allConfiguredRoots();
  const end = startIndex + PROJECT_LIMITS.maxRoots;
  const remaining = all.slice(end);
  return {
    roots: remaining.map((r) => ({ path: r.path, reason: "maxRoots" })),
    // Where a continuation must pick the root list back up.
    nextIndex: remaining.length ? end : all.length,
  };
}


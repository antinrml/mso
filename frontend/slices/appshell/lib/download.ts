// Save a URL to disk the way a browser actually requires — one implementation.
//
// There were SIX of these, and they disagreed on the two details that decide
// whether the file arrives:
//
//  1. THE ANCHOR MUST BE IN THE DOCUMENT. Firefox ignores `download` on a
//     detached element, so `a.click()` navigates (or does nothing) instead of
//     saving. Two of the six clicked a detached anchor — the Settings → Backup
//     export was one of them, which is the last feature that should silently fail.
//  2. A blob: URL MUST NOT BE REVOKED IN THE SAME TICK. Firefox/Safari have not
//     started fetching it yet, and the save lands 0 bytes. One copy revoked after
//     0 ms, another after 2000, a third never.
//
// Both are lore that a helper can hold instead of six call sites remembering it.

/** Long enough for the browser to have started the fetch; short enough that a
 *  big blob is not pinned in memory. One copy used 0 ms and reported it was
 *  sufficient, another used 2000 — this takes the safe end, because the cost of
 *  being wrong is a corrupt download and the cost of waiting is nothing. */
const REVOKE_DELAY_MS = 2_000;

/**
 * @param doc injectable ONLY so this can be tested without a DOM environment
 *   (the repo runs vitest in `node`, and adding jsdom to save one file is a
 *   worse trade than one defaulted parameter).
 */
export function saveAs(href: string, filename: string, doc: Document = document): void {
  const a = doc.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  a.remove();
  // Only ours to revoke. A data:/http: URL has no object to release, and calling
  // revokeObjectURL on one is a silent no-op that reads as if it mattered.
  if (href.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(href), REVOKE_DELAY_MS);
}

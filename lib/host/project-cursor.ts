// Encoding for a resumable scan position.
//
// A cap is only honest if the caller can continue past it; a truncated result with no
// way to fetch the rest is data loss with a label on it.
import type { ScanCursor } from "./project-containers";

/** Cursors are positional in readdir order. That is a deliberate trade: making them
 *  name-ordered would require visiting every dirent to find the next N names, which is
 *  the unbounded walk the entry cap exists to prevent. Valid while the directory is
 *  unchanged; `note` says so in the payload. */
export function encodeCursor(cursor: ScanCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): ScanCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ScanCursor;
    if (!parsed || typeof parsed !== "object") return undefined;
    return {
      roots: Array.isArray(parsed.roots) ? parsed.roots.filter((r) => typeof r?.root === "string") : [],
      skipRoots: Array.isArray(parsed.skipRoots) ? parsed.skipRoots.filter((r) => typeof r === "string") : [],
    };
  } catch {
    return undefined;
  }
}


// Encoding for a resumable scan position.
//
// A cap is only honest if the caller can continue past it; a truncated result with no
// way to fetch the rest is data loss with a label on it.
import type { ScanCursor } from "./project-containers";

/** Cursors are raw readdir STREAM positions. That is a deliberate trade: a name-ordered
 *  cursor would require visiting every dirent to find the next N names, which is the
 *  unbounded walk the entry cap exists to prevent. Rows within a returned page are
 *  sorted for presentation; WHICH rows land in a truncated page is stream order. Valid
 *  while the directory is unchanged; `note` says so in the payload. */
export function encodeCursor(cursor: ScanCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): ScanCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ScanCursor;
    if (!parsed || typeof parsed !== "object") return undefined;
    const int = (v: unknown) => (Number.isFinite(v) ? Math.max(0, Math.floor(v as number)) : 0);
    return {
      rootIndex: int(parsed.rootIndex),
      containerIndex: int(parsed.containerIndex),
      entriesConsumed: int(parsed.entriesConsumed),
      ...(typeof parsed.containerPath === "string" ? { containerPath: parsed.containerPath } : {}),
    };
  } catch {
    return undefined;
  }
}


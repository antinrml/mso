// Encoding for a resumable skill-catalog position. Same contract as the project walk's
// cursor: a cap the caller cannot continue past is data loss with a label on it.
import type { SkillScanCursor } from "./catalog-types";

export function encodeSkillCursor(cursor: SkillScanCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeSkillCursor(raw: string | undefined): SkillScanCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SkillScanCursor;
    if (!parsed || typeof parsed !== "object") return undefined;
    return {
      doneRoots: Array.isArray(parsed.doneRoots) ? parsed.doneRoots.filter((r) => typeof r === "string") : [],
      projectOffset: Number.isFinite(parsed.projectOffset) ? Math.max(0, Math.floor(parsed.projectOffset)) : 0,
      ...(parsed.resume && typeof parsed.resume.root === "string"
        ? { resume: { root: parsed.resume.root, entriesConsumed: Math.max(0, Math.floor(parsed.resume.entriesConsumed ?? 0)) } }
        : {}),
    };
  } catch {
    return undefined;
  }
}


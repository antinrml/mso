import {
  Folder, FileText, Image, Code2, FileVideo, Music, FileArchive,
  FileJson, FileSpreadsheet, Terminal, Globe, type LucideIcon,
} from "lucide-react";
import { kindForName, isPreviewable, type ViewKind } from "@/features/media-viewer";
import type { FsEntry } from "./host";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]);
const VIDEO = new Set(["mp4", "mov", "webm", "avi", "mkv"]);
const AUDIO = new Set(["mp3", "wav", "aiff", "m4a", "flac"]);
const CODE = new Set(["ts", "tsx", "js", "jsx", "py", "go", "rs", "css"]);
const ARCHIVE = new Set(["zip", "gz", "tar", "rar", "7z"]);

// Map an entry to its display icon. Dirs always Folder; files by kind, then by the
// few exts that deserve their own glyph. The media families come from the viewer's
// table so a .heic gets a picture icon and a .m4v a film one — the local sets below
// only survive for the non-media groupings the viewer has no opinion about.
export function iconFor(entry: FsEntry): LucideIcon {
  if (entry.kind === "dir") return Folder;
  const ext = entry.ext?.toLowerCase() ?? "";
  const kind = kindForName(entry.name);
  if (kind === "image") return Image;
  if (kind === "video") return FileVideo;
  if (kind === "audio") return Music;
  if (ext === "json") return FileJson;
  if (ext === "csv") return FileSpreadsheet;
  if (ext === "sh") return Terminal;
  if (ext === "html") return Globe;
  if (CODE.has(ext)) return Code2;
  if (ARCHIVE.has(ext)) return FileArchive;
  return FileText;
}

// Tailwind text-color class keyed by ext family — color-coded icons. Uses
// palette utilities (not hex) so it tracks the active theme.
export function colorFor(entry: FsEntry): string {
  if (entry.kind === "dir") return "text-primary";
  const ext = entry.ext?.toLowerCase() ?? "";
  if (IMAGE.has(ext)) return "text-amber-500";
  if (VIDEO.has(ext)) return "text-pink-500";
  if (AUDIO.has(ext)) return "text-emerald-500";
  if (ext === "json") return "text-slate-400";
  if (ext === "csv") return "text-green-500";
  if (ext === "pdf") return "text-red-500";
  if (ARCHIVE.has(ext)) return "text-violet-400";
  if (CODE.has(ext) || ext === "sh" || ext === "html") return "text-sky-400";
  return "text-muted-foreground";
}

// Which OS app opens this file on a double-click.
//
// Text and code go to the EDITOR, not to Preview: for a file you can change, "open"
// means edit. Everything Preview can render but nothing can edit (media, PDF,
// documents) goes to Preview — including the formats it can only offer a download
// for, because a window that names the format beats a double-click that does
// nothing, which is what an unknown extension used to do.
export function appForFile(entry: FsEntry): "media-viewer" | "code-editor" | null {
  if (entry.kind === "dir") return null;
  const kind = kindForName(entry.name);
  if (kind === "text" || kind === "markdown" || kind === "csv" || kind === "html") return "code-editor";
  return "media-viewer";
}

/** "Preview" — the OTHER route, offered in the context menu. Rendering is what
 *  Preview is for, so a .md, .csv or .html can be READ without opening an editor,
 *  and the ← → paging works for every previewable file in the folder. */
export const canPreview = (entry: FsEntry): boolean =>
  entry.kind === "file" && isPreviewable(kindForName(entry.name));

// True for raster/vector image files — used to show a real thumbnail in grid
// view (rendered via /api/v1/fs/raw) instead of a generic icon. Same table as the
// viewer: a format it calls an image is one the grid should try to thumbnail, and
// a browser that cannot decode it falls back to the icon on its own.
export function isImage(entry: FsEntry): boolean {
  return entry.kind === "file" && kindForName(entry.name) === "image";
}

// Media kind for the media-viewer payload — the viewer's OWN table, so Files and
// Preview can never disagree about what a `.heic` or a `.csv` is. (The viewer
// re-derives it from the name anyway; this keeps the payload informative.)
export const mediaKind = (entry: FsEntry): ViewKind => kindForName(entry.name);

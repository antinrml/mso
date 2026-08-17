// What Preview can actually show, keyed by extension — ONE table, used both by the
// viewer (what to render) and by Files (what to route here, what to icon).
//
// The rule for what belongs in which bucket is "what a browser can render from raw
// bytes", not "what the OS calls a document". So .docx and .zip are `none` — no
// browser opens them, and a viewer that pretends otherwise renders a blank frame
// and blames the file. `none` still gets a window: a card that names the format and
// offers the download, which is the honest end of the road.
//
// TEXT IS FETCHED, NOT FRAMED. /api/v1/fs/raw serves unknown types as
// application/octet-stream on purpose (lib/host/fs.ts), so text and HTML never
// become an active same-origin document — the viewer reads the bytes and renders
// them itself, HTML into a fully sandboxed iframe. Do not "fix" that by adding
// text/html to the server's MIME map.

export type ViewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "csv" | "html" | "text" | "none";

const BY_EXT: Record<string, ViewKind> = {};
const put = (kind: ViewKind, exts: string) => {
  for (const ext of exts.split(" ")) BY_EXT[ext] = kind;
};

// Windows + macOS defaults first, then the web ones. Formats no browser decodes
// (heic, tiff, wmv, avi on most builds) are still listed: the element tries, fails,
// and the viewer falls back to the download card — which beats "unsupported file"
// on a machine whose browser CAN play it (Safari and heic, for one).
put("image", "png jpg jpeg jfif gif webp avif bmp ico svg tif tiff heic heif");
put("video", "mp4 m4v mov webm ogv mkv avi wmv mpg mpeg 3gp");
put("audio", "mp3 wav m4a aac flac ogg oga opus aiff aif wma");
put("pdf", "pdf");
put("markdown", "md markdown mdx");
put("csv", "csv tsv");
put("html", "html htm xhtml");
put(
  "text",
  "txt log json xml yaml yml toml ini cfg conf env properties " +
    "js mjs cjs jsx ts tsx css scss sass less " +
    "py rb php go rs java kt swift c h cpp hpp cs sql " +
    "sh bash zsh fish ps1 bat cmd " +
    "srt vtt patch diff lock gitignore gitattributes editorconfig dockerfile makefile plist",
);
// Deliberately `none` — a browser cannot render these, so say so and offer the
// bytes: Office/iWork/OpenDocument, archives, disk images, installers, binaries,
// design files, fonts and databases.
put(
  "none",
  "doc docx xls xlsx ppt pptx rtf odt ods odp pages numbers key " +
    "zip rar 7z tar gz tgz bz2 xz dmg iso exe msi deb rpm pkg apk " +
    "psd ai sketch fig xd ttf otf woff woff2 " +
    "db sqlite sqlite3 bin dat so dll dylib class jar o a",
);

/** File name (or path) → what Preview would render. */
export function kindForName(name: string): ViewKind {
  const base = name.split("/").pop() ?? name;
  // Extension-less names that ARE text on every developer machine (Makefile,
  // Dockerfile, LICENSE, README) — checked before the dot rule so they open as
  // text rather than as an unknown blob.
  if (!base.includes(".")) {
    return /^(makefile|dockerfile|license|licence|readme|changelog|authors|notice|procfile|caddyfile|vagrantfile|gemfile|rakefile)$/i.test(base)
      ? "text"
      : "none";
  }
  return kindForExt(base.split(".").pop() ?? "");
}

export function kindForExt(ext: string): ViewKind {
  return BY_EXT[ext.toLowerCase()] ?? "none";
}

/** True when Preview has something better than a download card to show. */
export const isPreviewable = (kind: ViewKind): boolean => kind !== "none";

/** The kinds whose bytes the viewer fetches and renders itself. */
export const isTextual = (kind: ViewKind): boolean =>
  kind === "text" || kind === "markdown" || kind === "csv" || kind === "html";

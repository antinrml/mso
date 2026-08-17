// POSIX path math for the shell's apps — ONE implementation.
//
// There were three, and they disagreed at the edges. Files' `joinPath` did not
// strip a trailing slash from the base ("/a/" + "b" → "/a//b"), the Code editor's
// did, and Preview's sibling lookup carried a third copy of the same regex. These
// strings are not cosmetic: they become the `path=` of an /api/v1/fs request, and a
// doubled slash is a different path to a host that resolves it literally.
//
// Lives in `lib/` rather than in a slice because three slices need it and
// cross-slice imports are barrel-only. Same category as `@/lib/utils` (cn):
// universal, brand-free, no React and no host access — the appshell framework may
// import it without acquiring a dependency it could not lift.

/** `join("/a", "b")` → `/a/b`; tolerant of a trailing slash on either side. */
export function joinPath(base: string, name: string): string {
  const dir = base.replace(/\/+$/, "");
  const leaf = name.replace(/^\/+/, "");
  return dir ? `${dir}/${leaf}` : `/${leaf}`;
}

/** The containing directory, or `/` at the root. Never returns "". */
export function parentPath(p: string): string {
  const n = p.replace(/\/+$/, "") || "/";
  const cut = n.lastIndexOf("/");
  return cut <= 0 ? "/" : n.slice(0, cut);
}

/** The last segment: `/a/b.txt` → `b.txt`. `/` → "". */
export function baseName(p: string): string {
  return p.replace(/\/+$/, "").split("/").pop() ?? "";
}

/** Lowercased extension without the dot, or "" when there is none. */
export function extOf(p: string): string {
  const base = baseName(p);
  return base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
}
